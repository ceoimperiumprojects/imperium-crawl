//! Adapter from the `imperium-crawl-stealth` `StealthClient` to the `Fetcher`
//! trait used by HTML tools. Auto-escalates L1 → L2 (and later L3) so tools
//! work against anti-bot-protected sites (Reddit, Cloudflare, etc).

use async_trait::async_trait;
use imperium_crawl_core::{FetchResult, Result};
use imperium_crawl_stealth::{StealthClient, StealthOptions};

use super::fetcher::Fetcher;

/// `Fetcher` that delegates to a shared `StealthClient`.
#[derive(Clone)]
pub struct StealthFetcher {
    client: StealthClient,
    opts: StealthOptions,
}

impl StealthFetcher {
    pub fn new() -> Result<Self> {
        let client = StealthClient::new()?;
        let mut opts = StealthOptions::default();
        // Tools that use this fetcher can't yet talk to L3 (chromiumoxide
        // wiring lands in Sprint 4). Cap at L2 so a block error escapes
        // immediately rather than asking for the browser dispatch.
        opts.max_level = imperium_crawl_core::StealthLevel::L2Tls;
        Ok(Self { client, opts })
    }

    pub fn with_options(mut self, opts: StealthOptions) -> Self {
        self.opts = opts;
        self
    }
}

#[async_trait]
impl Fetcher for StealthFetcher {
    async fn fetch(&self, url: &str) -> Result<FetchResult> {
        self.client.fetch(url, &self.opts).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stealth_fetcher_builds() {
        let _ = StealthFetcher::new().expect("stealth fetcher should build");
    }
}
