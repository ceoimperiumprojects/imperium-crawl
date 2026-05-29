//! L2 stealth: TLS fingerprint spoofing via `wreq` (BoringSSL Chrome JA3/JA4).
//!
//! Port of `src/stealth/tls.ts` (which uses `impit`). We use `wreq-util`'s
//! Chrome emulation profiles so the JA3/JA4/HTTP2 frame signature matches a
//! real Chrome browser.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use imperium_crawl_core::constants::{DEFAULT_TIMEOUT_MS, MAX_BODY_LENGTH};
use imperium_crawl_core::{ContentKind, CrawlError, FetchResult, Result, StealthLevel};

use crate::headers::random_chrome_emulation;

/// Wrapper around `wreq::Client` configured with a Chrome BoringSSL emulation
/// profile. One instance per `StealthClient`; clones are cheap (wreq uses
/// Arc internally).
#[derive(Clone)]
pub struct TlsClient {
    inner: wreq::Client,
}

impl TlsClient {
    /// Build a new L2 client with a random recent Chrome emulation profile
    /// (Chrome 131..=140 from `wreq-util`). Per-request emulation override is
    /// also supported via `fetch_with_emulation`.
    pub fn new() -> Result<Self> {
        Self::with_emulation(random_chrome_emulation())
    }

    /// Build a client pinned to a specific Chrome emulation. Useful for tests
    /// or sticky sessions where JA3 stability matters.
    pub fn with_emulation(emulation: wreq_util::Emulation) -> Result<Self> {
        let timeout = Duration::from_millis(DEFAULT_TIMEOUT_MS);
        let inner = wreq::Client::builder()
            .emulation(emulation)
            .cookie_store(true)
            .timeout(timeout)
            .build()
            .map_err(|e| CrawlError::Network(format!("wreq client build failed: {e}")))?;
        Ok(Self { inner })
    }

    /// Build a client with proxy. Useful for proxy-pinned sessions.
    pub fn with_emulation_and_proxy(
        emulation: wreq_util::Emulation,
        proxy_url: &str,
    ) -> Result<Self> {
        let proxy = wreq::Proxy::all(proxy_url)
            .map_err(|e| CrawlError::Network(format!("invalid proxy URL: {e}")))?;
        let timeout = Duration::from_millis(DEFAULT_TIMEOUT_MS);
        let inner = wreq::Client::builder()
            .emulation(emulation)
            .proxy(proxy)
            .cookie_store(true)
            .timeout(timeout)
            .build()
            .map_err(|e| CrawlError::Network(format!("wreq client build failed: {e}")))?;
        Ok(Self { inner })
    }

    /// GET a URL via the BoringSSL/Chrome-emulated TLS stack.
    pub async fn fetch(&self, url: &str) -> Result<FetchResult> {
        self.fetch_with_timeout(url, Duration::from_millis(DEFAULT_TIMEOUT_MS))
            .await
    }

    /// GET with a custom per-request timeout.
    pub async fn fetch_with_timeout(&self, url: &str, timeout: Duration) -> Result<FetchResult> {
        let start = Instant::now();

        let request = self.inner.get(url);
        let response = tokio::time::timeout(timeout, request.send())
            .await
            .map_err(|_| CrawlError::Timeout {
                timeout_ms: timeout.as_millis() as u64,
                context: format!("L2 wreq fetch: {url}"),
            })?
            .map_err(|e| CrawlError::Network(format!("L2 wreq fetch failed: {e}")))?;

        let status = response.status().as_u16();

        // Capture headers (lowercase keys, comma-joined values for duplicates).
        let mut headers: HashMap<String, String> = HashMap::new();
        // Collect Set-Cookie separately so multiple values survive (joined by `, `).
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

        let final_url = response.uri().to_string();

        // Read body with size cap.
        let bytes = tokio::time::timeout(timeout, response.bytes())
            .await
            .map_err(|_| CrawlError::Timeout {
                timeout_ms: timeout.as_millis() as u64,
                context: format!("L2 wreq body read: {url}"),
            })?
            .map_err(|e| CrawlError::Network(format!("L2 wreq body read failed: {e}")))?;

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
            stealth_level: StealthLevel::L2Tls,
            duration_ms: start.elapsed().as_millis() as u64,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_tls_client_builds() {
        let _ = TlsClient::new().expect("TlsClient should build with default emulation");
    }

    #[test]
    fn pinned_emulation_builds() {
        let _ = TlsClient::with_emulation(wreq_util::Emulation::Chrome131)
            .expect("Chrome131 emulation should build");
    }
}
