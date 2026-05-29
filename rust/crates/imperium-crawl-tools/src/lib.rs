//! All tool implementations for imperium-crawl.
//!
//! Each tool lives in its own module. `build_registry()` returns the
//! `ToolRegistry` used by the CLI and (future) HTTP API.
//!
//! Tools that fetch URLs share a `StealthFetcher` (L1→L2 auto-escalation via
//! `imperium-crawl-stealth`) so anti-bot-protected sites (Reddit, Cloudflare,
//! etc.) work without the caller specifying a level.

use imperium_crawl_core::{Config, Tool, ToolRegistry};
use std::sync::Arc;

use crate::html::{Fetcher, StealthFetcher};

pub mod feeds;
pub mod html;
#[cfg(feature = "search")]
pub mod search;
#[cfg(feature = "pdf")]
pub mod pdf;
pub mod interaction;
pub mod api;
pub mod monitoring;
pub mod social;
pub mod ai;
pub mod skills;

/// Build the shared fetcher used by all URL-based tools. If the stealth crate
/// can't build a client (extremely rare — only on TLS init failure) fall back
/// to the plain reqwest fetcher.
fn shared_fetcher() -> Arc<dyn Fetcher> {
    match StealthFetcher::new() {
        Ok(s) => Arc::new(s),
        Err(_) => match html::DefaultFetcher::new() {
            Ok(d) => Arc::new(d),
            Err(_) => Arc::new(html::DefaultFetcher::default()),
        },
    }
}

/// Build a `ToolRegistry` containing every tool whose runtime requirements
/// are met by the current environment (API keys present, browser available, …).
pub fn build_registry() -> ToolRegistry {
    let mut reg = ToolRegistry::new();
    let fetcher = shared_fetcher();

    // ── S5: HTML tools ──
    reg.register(Arc::new(html::ScrapeTool::new(fetcher.clone())));
    reg.register(Arc::new(html::CrawlTool::new(fetcher.clone())));
    reg.register(Arc::new(html::ExtractTool::new(fetcher.clone())));
    reg.register(Arc::new(html::ReadabilityTool::new(fetcher.clone())));
    reg.register(Arc::new(html::MapTool::new(fetcher.clone())));

    // ── S6: Search (Brave) ──
    #[cfg(feature = "search")]
    {
        if std::env::var("BRAVE_API_KEY").is_ok() {
            if let Ok(t) = search::SearchTool::from_env() {
                reg.register(Arc::new(t));
            }
            if let Ok(t) = search::NewsSearchTool::from_env() {
                reg.register(Arc::new(t));
            }
            if let Ok(t) = search::ImageSearchTool::from_env() {
                reg.register(Arc::new(t));
            }
            if let Ok(t) = search::VideoSearchTool::from_env() {
                reg.register(Arc::new(t));
            }
        }
    }

    // ── S8: Feeds + downloads ──
    reg.register(Arc::new(feeds::RssTool::new(fetcher.clone())));
    reg.register(Arc::new(feeds::DownloadTool::new()));
    reg.register(Arc::new(feeds::BatchDownloadTool::new()));
    reg.register(Arc::new(feeds::BatchScrapeTool::new(fetcher.clone())));

    // ── S11: Monitoring ──
    reg.register(Arc::new(monitoring::MonitorTool::new(fetcher.clone())));
    reg.register(Arc::new(monitoring::WatchTool::new(fetcher.clone())));

    // ── S12: Social ──
    reg.register(Arc::new(social::YouTubeTool::new()));
    reg.register(Arc::new(social::RedditTool::new(fetcher)));

    // ── S15: Skills ──
    // `RunSkillTool` needs a registry to dispatch into. We snapshot the
    // current registry (the rest of the tool surface) and pass that to
    // skill tools so user skills can chain into any registered tool.
    let config = Arc::new(Config::load().unwrap_or_default());
    let dispatch: Arc<ToolRegistry> = Arc::new(reg.clone());
    reg.register(Arc::new(skills::CreateSkillTool::new(config.clone())));
    reg.register(Arc::new(skills::RunSkillTool::new(
        config.clone(),
        dispatch,
    )));
    reg.register(Arc::new(skills::ListSkillsTool::new(config)));

    reg
}

/// Backward-compat: legacy `registry()` returns `Vec<Arc<dyn Tool>>`.
pub fn registry() -> Vec<Arc<dyn Tool>> {
    let r = build_registry();
    r.names()
        .into_iter()
        .filter_map(|n| r.get(&n))
        .collect()
}
