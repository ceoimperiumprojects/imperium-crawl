//! Proxy parsing + round-robin rotation with cooldown health tracking.
//! Port of `src/stealth/proxy.ts`.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use imperium_crawl_core::{CrawlError, Result};

const COOLDOWN: Duration = Duration::from_secs(60);

/// Parsed proxy URL with normalized components.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedProxy {
    pub url: String,
    pub protocol: String,
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
}

#[derive(Debug, Clone, Copy, Default)]
struct Health {
    success_count: u64,
    failure_count: u64,
    cooldown_until: Option<Instant>,
}

fn default_port(protocol: &str) -> u16 {
    match protocol {
        "socks4" | "socks5" => 1080,
        "https" => 443,
        _ => 8080,
    }
}

/// Parse a proxy URL into its components. Accepts http(s), socks4, socks5.
pub fn parse_proxy_url(raw: &str) -> Result<ParsedProxy> {
    let trimmed = raw.trim();
    // Cheap protocol gate (mirrors TS regex).
    let lower = trimmed.to_ascii_lowercase();
    let ok = lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("socks4://")
        || lower.starts_with("socks5://");
    if !ok {
        return Err(CrawlError::Config(format!(
            "invalid proxy URL (must start with http/https/socks4/socks5): {trimmed}"
        )));
    }

    let parsed = url::Url::parse(trimmed)
        .map_err(|e| CrawlError::Config(format!("invalid proxy URL '{trimmed}': {e}")))?;

    let protocol = parsed.scheme().trim_end_matches(':').to_string();
    let host = parsed
        .host_str()
        .ok_or_else(|| CrawlError::Config(format!("proxy URL missing host: {trimmed}")))?
        .to_string();
    let port = parsed.port().unwrap_or_else(|| default_port(&protocol));

    let username = if parsed.username().is_empty() {
        None
    } else {
        Some(parsed.username().to_string())
    };
    let password = parsed.password().map(|p| p.to_string());

    Ok(ParsedProxy {
        url: trimmed.to_string(),
        protocol,
        host,
        port,
        username,
        password,
    })
}

/// Round-robin proxy pool with cooldown health tracking. Skips proxies that
/// failed recently (60s cooldown). Falls back to the proxy with the soonest
/// cooldown expiry if all are unhealthy.
pub struct ProxyPool {
    proxies: Vec<ParsedProxy>,
    // Health state is per-proxy, indexed alongside `proxies`.
    health: Mutex<Vec<Health>>,
    index: AtomicUsize,
}

impl ProxyPool {
    /// Construct a pool from raw URLs. Invalid URLs are silently skipped
    /// (matches TS behavior with a warn log).
    pub fn new(urls: impl IntoIterator<Item = impl Into<String>>) -> Self {
        let mut proxies = Vec::new();
        let mut health = Vec::new();
        for raw in urls {
            let raw_string: String = raw.into();
            match parse_proxy_url(&raw_string) {
                Ok(p) => {
                    proxies.push(p);
                    health.push(Health::default());
                }
                Err(e) => {
                    tracing::warn!(target: "imperium_crawl_stealth", "skipping invalid proxy: {e}");
                }
            }
        }
        Self {
            proxies,
            health: Mutex::new(health),
            index: AtomicUsize::new(0),
        }
    }

    /// Number of healthy + cooldown proxies in the pool.
    pub fn len(&self) -> usize {
        self.proxies.len()
    }

    /// Whether the pool has zero proxies.
    pub fn is_empty(&self) -> bool {
        self.proxies.is_empty()
    }

    /// Get the next available proxy URL, skipping those in cooldown. Returns
    /// `None` only if the pool is empty.
    pub fn next(&self) -> Option<&str> {
        if self.proxies.is_empty() {
            return None;
        }

        let now = Instant::now();
        let health = match self.health.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(), // poisoned lock — keep going
        };

        let start = self.index.load(Ordering::Relaxed);
        let n = self.proxies.len();

        // Try to find a healthy proxy (not in cooldown).
        for i in 0..n {
            let idx = (start + i) % n;
            let h = health[idx];
            let healthy = match h.cooldown_until {
                None => true,
                Some(until) => now >= until,
            };
            if healthy {
                self.index.store((idx + 1) % n, Ordering::Relaxed);
                return Some(&self.proxies[idx].url);
            }
        }

        // All in cooldown — pick the one whose cooldown expires soonest.
        let mut best_idx: usize = 0;
        let mut best_until: Option<Instant> = None;
        for (i, h) in health.iter().enumerate() {
            if let Some(until) = h.cooldown_until {
                if best_until.map_or(true, |b| until < b) {
                    best_until = Some(until);
                    best_idx = i;
                }
            } else {
                // Healthy proxy slipped through — return it.
                self.index.store((i + 1) % n, Ordering::Relaxed);
                return Some(&self.proxies[i].url);
            }
        }
        self.index.store((best_idx + 1) % n, Ordering::Relaxed);
        Some(&self.proxies[best_idx].url)
    }

    /// Mark a proxy URL as having succeeded — clears cooldown.
    pub fn mark_success(&self, proxy_url: &str) {
        if let Some(idx) = self.find_index(proxy_url) {
            if let Ok(mut h) = self.health.lock() {
                h[idx].success_count += 1;
                h[idx].cooldown_until = None;
            }
        }
    }

    /// Mark a proxy URL as failed — sets cooldown for `COOLDOWN` seconds.
    pub fn mark_failed(&self, proxy_url: &str) {
        if let Some(idx) = self.find_index(proxy_url) {
            if let Ok(mut h) = self.health.lock() {
                h[idx].failure_count += 1;
                h[idx].cooldown_until = Some(Instant::now() + COOLDOWN);
            }
        }
    }

    fn find_index(&self, url: &str) -> Option<usize> {
        self.proxies.iter().position(|p| p.url == url)
    }
}

impl Default for ProxyPool {
    fn default() -> Self {
        Self {
            proxies: Vec::new(),
            health: Mutex::new(Vec::new()),
            index: AtomicUsize::new(0),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_basic_http() {
        let p = parse_proxy_url("http://user:pass@example.com:3128").unwrap();
        assert_eq!(p.protocol, "http");
        assert_eq!(p.host, "example.com");
        assert_eq!(p.port, 3128);
        assert_eq!(p.username.as_deref(), Some("user"));
        assert_eq!(p.password.as_deref(), Some("pass"));
    }

    #[test]
    fn parse_socks5_default_port() {
        let p = parse_proxy_url("socks5://localhost").unwrap();
        assert_eq!(p.protocol, "socks5");
        assert_eq!(p.port, 1080);
    }

    #[test]
    fn parse_rejects_bad_scheme() {
        assert!(parse_proxy_url("ftp://example.com").is_err());
        assert!(parse_proxy_url("not a url").is_err());
    }

    #[test]
    fn pool_round_robin() {
        let pool = ProxyPool::new(vec![
            "http://a.example:8080",
            "http://b.example:8080",
            "http://c.example:8080",
        ]);
        assert_eq!(pool.len(), 3);
        let a = pool.next().unwrap().to_string();
        let b = pool.next().unwrap().to_string();
        let c = pool.next().unwrap().to_string();
        let d = pool.next().unwrap().to_string();
        assert_ne!(a, b);
        assert_ne!(b, c);
        assert_eq!(a, d); // cycled
    }

    #[test]
    fn pool_skips_failed() {
        let pool = ProxyPool::new(vec!["http://a.example:8080", "http://b.example:8080"]);
        pool.mark_failed("http://a.example:8080");
        // Should now return b twice in a row (a in cooldown).
        let first = pool.next().unwrap();
        let second = pool.next().unwrap();
        assert_eq!(first, "http://b.example:8080");
        assert_eq!(second, "http://b.example:8080");
    }

    #[test]
    fn pool_empty_returns_none() {
        let pool: ProxyPool = ProxyPool::new(Vec::<String>::new());
        assert!(pool.is_empty());
        assert!(pool.next().is_none());
    }

    #[test]
    fn pool_skips_invalid_urls() {
        let pool = ProxyPool::new(vec!["http://valid:8080", "not-a-url"]);
        assert_eq!(pool.len(), 1);
    }
}
