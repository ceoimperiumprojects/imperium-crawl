//! Fetcher abstraction shared by all HTML tools.
//!
//! Production code will swap `DefaultFetcher` (plain reqwest) for the
//! `StealthClient` from the `imperium-crawl-stealth` crate once Sprint 2 is
//! merged. The trait is in place now so tools don't have a hard dep on stealth.

use async_trait::async_trait;
use imperium_crawl_core::{
    constants::DEFAULT_TIMEOUT_MS, ContentKind, CrawlError, FetchResult, Result, StealthLevel,
};
use std::collections::HashMap;
use std::time::{Duration, Instant};

#[async_trait]
pub trait Fetcher: Send + Sync {
    async fn fetch(&self, url: &str) -> Result<FetchResult>;
}

/// Plain reqwest fetcher. Sets a realistic User-Agent and Accept-Language.
/// Honors the `PROXY_URL` env var if set.
#[derive(Debug, Clone)]
pub struct DefaultFetcher {
    pub user_agent: String,
    pub timeout: Duration,
    pub client: reqwest::Client,
}

impl DefaultFetcher {
    pub fn new() -> Result<Self> {
        let user_agent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36".to_string();
        let timeout = Duration::from_millis(DEFAULT_TIMEOUT_MS);
        let mut builder = reqwest::Client::builder()
            .user_agent(&user_agent)
            .timeout(timeout)
            .gzip(true)
            .brotli(true)
            .redirect(reqwest::redirect::Policy::limited(10));

        if let Ok(proxy_url) = std::env::var("PROXY_URL") {
            if !proxy_url.trim().is_empty() {
                let proxy = reqwest::Proxy::all(&proxy_url)
                    .map_err(|e| CrawlError::Config(format!("proxy: {e}")))?;
                builder = builder.proxy(proxy);
            }
        }

        let client = builder
            .build()
            .map_err(|e| CrawlError::Other(format!("reqwest build: {e}")))?;
        Ok(Self { user_agent, timeout, client })
    }
}

impl Default for DefaultFetcher {
    fn default() -> Self {
        Self::new().expect("default fetcher build")
    }
}

#[async_trait]
impl Fetcher for DefaultFetcher {
    async fn fetch(&self, url: &str) -> Result<FetchResult> {
        let parsed = imperium_crawl_core::validate_url(url)?;
        let start = Instant::now();
        let res = self
            .client
            .get(parsed.as_str())
            .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
            .header("Accept-Language", "en-US,en;q=0.9")
            .send()
            .await
            .map_err(|e| CrawlError::Network(format!("GET {url}: {e}")))?;
        let status = res.status().as_u16();
        let final_url = res.url().to_string();
        let mut headers = HashMap::new();
        for (k, v) in res.headers().iter() {
            if let Ok(s) = v.to_str() {
                headers.insert(k.as_str().to_ascii_lowercase(), s.to_string());
            }
        }
        let mime = headers.get("content-type").cloned().unwrap_or_default();
        let kind = ContentKind::from_mime(&mime);
        let body = res
            .bytes()
            .await
            .map_err(|e| CrawlError::Network(format!("read body: {e}")))?
            .to_vec();
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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn default_fetcher_builds() {
        let f = DefaultFetcher::new().unwrap();
        assert!(f.user_agent.contains("Chrome"));
    }
}
