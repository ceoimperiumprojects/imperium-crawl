//! L1 → L2 → (L3) auto-escalation. Port of `src/stealth/index.ts` (the
//! escalation loop only — knowledge-engine, cookie accumulation, and L3/L4
//! browser dispatch are wired in later sprints).

use std::collections::HashMap;
use std::time::{Duration, Instant};

use imperium_crawl_core::constants::{DEFAULT_TIMEOUT_MS, MAX_BODY_LENGTH};
use imperium_crawl_core::{ContentKind, CrawlError, FetchResult, Result, StealthLevel};

use crate::detector::{AntiBotDetector, AntiBotSignal};
use crate::headers::{header_map_for_url, random_profile};
use crate::tls::TlsClient;

/// Per-request stealth options.
#[derive(Debug, Clone)]
pub struct StealthOptions {
    /// Starting stealth level. Default: `L1Headers`.
    pub start_level: StealthLevel,
    /// Maximum stealth level to escalate to. Default: `L3Browser`. L3/L4
    /// require external browser crates wired into the `StealthClient`; without
    /// them we cap at L2.
    pub max_level: StealthLevel,
    /// Retries per level on transient errors (timeouts, 5xx). Default: 2.
    pub max_retries_per_level: u8,
    /// Override User-Agent for both L1 and (best-effort) L2 requests.
    pub user_agent_override: Option<String>,
    /// Per-request timeout. Default: `DEFAULT_TIMEOUT_MS` (30s).
    pub timeout: Duration,
}

impl Default for StealthOptions {
    fn default() -> Self {
        Self {
            start_level: StealthLevel::L1Headers,
            max_level: StealthLevel::L3Browser,
            max_retries_per_level: 2,
            user_agent_override: None,
            timeout: Duration::from_millis(DEFAULT_TIMEOUT_MS),
        }
    }
}

/// Stealth client: orchestrates L1 (reqwest + headers) → L2 (wreq/BoringSSL)
/// → (L3 browser — pending Sprint 4).
#[derive(Clone)]
pub struct StealthClient {
    l1: reqwest::Client,
    l2: TlsClient,
}

impl StealthClient {
    /// Build a new stealth client with default L1 (reqwest) and L2 (wreq)
    /// configurations.
    pub fn new() -> Result<Self> {
        let l1 = reqwest::Client::builder()
            .timeout(Duration::from_millis(DEFAULT_TIMEOUT_MS))
            .gzip(true)
            .brotli(true)
            .redirect(reqwest::redirect::Policy::limited(10))
            .build()
            .map_err(|e| CrawlError::Network(format!("reqwest client build failed: {e}")))?;
        let l2 = TlsClient::new()?;
        Ok(Self { l1, l2 })
    }

    /// Top-level fetch with auto-escalation.
    pub async fn fetch(&self, url: &str, opts: &StealthOptions) -> Result<FetchResult> {
        let mut current = opts.start_level;
        let mut last_error: Option<CrawlError> = None;
        let mut last_signal = AntiBotSignal::None;

        loop {
            // Skip levels we can't run yet.
            match current {
                StealthLevel::L1Headers | StealthLevel::L2Tls => { /* implemented */ }
                StealthLevel::L3Browser | StealthLevel::L4Camofox => {
                    return Err(CrawlError::Other(format!(
                        "stealth level {} requires browser crate (Sprint 4+); last signal: {:?}",
                        current.as_str(),
                        last_signal
                    )));
                }
            }

            // Try this level up to `max_retries_per_level + 1` times.
            let attempts = opts.max_retries_per_level.saturating_add(1);
            let mut level_ok: Option<FetchResult> = None;

            for attempt in 0..attempts {
                let result = match current {
                    StealthLevel::L1Headers => self.fetch_l1(url, opts).await,
                    StealthLevel::L2Tls => self.fetch_l2(url, opts).await,
                    _ => unreachable!("guarded above"),
                };

                match result {
                    Ok(res) => {
                        // Anti-bot detection on response.
                        let signal =
                            AntiBotDetector::classify(res.status, &res.headers, &res.body);
                        if matches!(signal, AntiBotSignal::None) {
                            level_ok = Some(res);
                            break;
                        }
                        tracing::debug!(
                            target: "imperium_crawl_stealth",
                            "level {} blocked by {:?} on attempt {}/{} ({})",
                            current.as_str(),
                            signal,
                            attempt + 1,
                            attempts,
                            url,
                        );
                        last_signal = signal;
                        // Don't retry same level on a hard block — escalate.
                        break;
                    }
                    Err(e) => {
                        tracing::debug!(
                            target: "imperium_crawl_stealth",
                            "level {} error on attempt {}/{}: {}",
                            current.as_str(),
                            attempt + 1,
                            attempts,
                            e
                        );
                        last_error = Some(e);
                        // Retry transient errors at the same level.
                        continue;
                    }
                }
            }

            if let Some(res) = level_ok {
                return Ok(res);
            }

            // Decide next level.
            if current == opts.max_level {
                // Out of escalations.
                if let Some(e) = last_error {
                    return Err(e);
                }
                return Err(CrawlError::Blocked(format!(
                    "all stealth levels exhausted; last signal: {:?}",
                    last_signal
                )));
            }
            current = match current.next() {
                Some(next) => {
                    // Don't exceed user's max_level cap.
                    if level_value(next) > level_value(opts.max_level) {
                        // Should not happen — but be defensive.
                        if let Some(e) = last_error {
                            return Err(e);
                        }
                        return Err(CrawlError::Blocked(format!(
                            "max level {} reached; last signal: {:?}",
                            opts.max_level.as_str(),
                            last_signal
                        )));
                    }
                    next
                }
                None => {
                    if let Some(e) = last_error {
                        return Err(e);
                    }
                    return Err(CrawlError::Blocked(format!(
                        "no further escalation; last signal: {:?}",
                        last_signal
                    )));
                }
            };
        }
    }

    /// L1: plain `reqwest` with a realistic header profile.
    async fn fetch_l1(&self, url: &str, opts: &StealthOptions) -> Result<FetchResult> {
        let start = Instant::now();
        let mut profile = random_profile();
        if let Some(ua) = &opts.user_agent_override {
            profile.user_agent = ua.clone();
        }
        let header_map = header_map_for_url(&profile, url);

        let mut req = self.l1.get(url).timeout(opts.timeout);
        for (k, v) in &header_map {
            req = req.header(k, v);
        }

        let response = req
            .send()
            .await
            .map_err(|e| classify_reqwest_error(e, url, opts.timeout))?;

        let status = response.status().as_u16();
        let final_url = response.url().to_string();

        // Collect headers (lowercase keys; Set-Cookie joined).
        let mut headers: HashMap<String, String> = HashMap::new();
        let mut set_cookies: Vec<String> = Vec::new();
        for (k, v) in response.headers().iter() {
            let key = k.as_str().to_ascii_lowercase();
            let val = v.to_str().unwrap_or("").to_string();
            if key == "set-cookie" {
                set_cookies.push(val);
            } else {
                headers.insert(key, val);
            }
        }
        if !set_cookies.is_empty() {
            headers.insert("set-cookie".into(), set_cookies.join(", "));
        }

        let content_type = headers
            .get("content-type")
            .map(String::as_str)
            .unwrap_or("application/octet-stream");
        let kind = ContentKind::from_mime(content_type);

        let bytes = response
            .bytes()
            .await
            .map_err(|e| CrawlError::Network(format!("L1 body read failed: {e}")))?;
        let body: Vec<u8> = if bytes.len() > MAX_BODY_LENGTH {
            bytes[..MAX_BODY_LENGTH].to_vec()
        } else {
            bytes.to_vec()
        };

        Ok(FetchResult {
            url: url.to_string(),
            final_url,
            status,
            kind,
            body,
            headers,
            stealth_level: StealthLevel::L1Headers,
            duration_ms: start.elapsed().as_millis() as u64,
        })
    }

    /// L2: `wreq` with Chrome BoringSSL emulation.
    async fn fetch_l2(&self, url: &str, opts: &StealthOptions) -> Result<FetchResult> {
        self.l2.fetch_with_timeout(url, opts.timeout).await
    }
}

/// Numeric ordering for level cap comparison.
fn level_value(l: StealthLevel) -> u8 {
    match l {
        StealthLevel::L1Headers => 1,
        StealthLevel::L2Tls => 2,
        StealthLevel::L3Browser => 3,
        StealthLevel::L4Camofox => 4,
    }
}

/// Map a `reqwest::Error` to our domain error, preserving timeout vs network distinction.
fn classify_reqwest_error(e: reqwest::Error, url: &str, timeout: Duration) -> CrawlError {
    if e.is_timeout() {
        CrawlError::Timeout {
            timeout_ms: timeout.as_millis() as u64,
            context: format!("L1 reqwest fetch: {url}"),
        }
    } else if e.is_connect() {
        CrawlError::Network(format!("L1 connect failed for {url}: {e}"))
    } else {
        CrawlError::Network(format!("L1 reqwest error for {url}: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_builds() {
        let _ = StealthClient::new().expect("StealthClient should build");
    }

    #[test]
    fn default_opts_sensible() {
        let opts = StealthOptions::default();
        assert_eq!(opts.start_level, StealthLevel::L1Headers);
        assert_eq!(opts.max_level, StealthLevel::L3Browser);
        assert_eq!(opts.max_retries_per_level, 2);
    }

    #[test]
    fn level_value_monotonic() {
        assert!(level_value(StealthLevel::L1Headers) < level_value(StealthLevel::L2Tls));
        assert!(level_value(StealthLevel::L2Tls) < level_value(StealthLevel::L3Browser));
        assert!(level_value(StealthLevel::L3Browser) < level_value(StealthLevel::L4Camofox));
    }
}
