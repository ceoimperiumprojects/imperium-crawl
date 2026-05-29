//! Sprint 5 — HTML tools: scrape, crawl, extract, readability, map.
//!
//! Each tool is a separate submodule and registers as `Tool` in the crate
//! registry. Tools accept any `Fetcher` impl. The CLI default uses
//! `StealthFetcher` (L1→L2 escalation via `imperium-crawl-stealth`) so
//! anti-bot-protected sites work out of the box.

pub mod crawl;
pub mod extract;
pub mod fetcher;
pub mod map;
pub mod markdown;
pub mod readability_tool;
pub mod scrape;
pub mod stealth_fetcher;
pub mod structured;

pub use crawl::CrawlTool;
pub use extract::ExtractTool;
pub use fetcher::{DefaultFetcher, Fetcher};
pub use map::MapTool;
pub use readability_tool::ReadabilityTool;
pub use scrape::ScrapeTool;
pub use stealth_fetcher::StealthFetcher;
