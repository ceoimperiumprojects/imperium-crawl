//! Sprint 8 — RSS + downloads.
//!
//! Currently implements:
//! - `rss` tool (parses RSS 2.0 + Atom via `rss` and `atom_syndication` crates).
//! - `download` tool (single-file download to disk).
//! - `batch_download` (concurrent download with semaphore cap).
//! - `batch_scrape` (concurrent scrape of N URLs).

use async_trait::async_trait;
use imperium_crawl_core::{
    constants::{MAX_CONCURRENCY, MAX_URL_LENGTH, MAX_URLS},
    normalize_url, CrawlError, Result, Tool, ToolArgs, ToolOutput, ToolSchema,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::AsyncWriteExt;

use crate::html::fetcher::{DefaultFetcher, Fetcher};

// ── RSS ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RssArgs {
    pub url: String,
    #[serde(default = "default_limit")]
    pub limit: usize,
    #[serde(default = "default_format")]
    pub format: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub since: Option<String>,
}

fn default_limit() -> usize {
    20
}
fn default_format() -> String {
    "json".into()
}

impl RssArgs {
    pub fn validate(&self) -> Result<()> {
        if self.url.is_empty() || self.url.len() > MAX_URL_LENGTH {
            return Err(CrawlError::InvalidArg("url length out of range".into()));
        }
        if self.limit == 0 || self.limit > 100 {
            return Err(CrawlError::InvalidArg("limit must be 1..=100".into()));
        }
        if !matches!(self.format.as_str(), "json" | "markdown") {
            return Err(CrawlError::InvalidArg("format must be json|markdown".into()));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeedItem {
    pub title: String,
    pub link: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub categories: Vec<String>,
}

pub struct RssTool {
    pub fetcher: Arc<dyn Fetcher>,
}

impl RssTool {
    pub fn with_default() -> Result<Self> {
        Ok(Self { fetcher: Arc::new(DefaultFetcher::new()?) })
    }
    pub fn new(fetcher: Arc<dyn Fetcher>) -> Self {
        Self { fetcher }
    }
}

#[async_trait]
impl Tool for RssTool {
    fn schema(&self) -> ToolSchema {
        ToolSchema {
            name: "rss".into(),
            description: "Fetch and parse RSS 2.0 / Atom feeds. Returns structured items.".into(),
            input_schema: serde_json::json!({
                "type":"object","required":["url"],
                "properties": {
                    "url": {"type":"string","maxLength":MAX_URL_LENGTH},
                    "limit": {"type":"integer","minimum":1,"maximum":100,"default":20},
                    "format": {"type":"string","enum":["json","markdown"],"default":"json"},
                    "since": {"type":"string","description":"YYYY-MM-DD"}
                }
            }),
            output_schema: serde_json::json!({"type":"object"}),
            requires_api_key: None,
            requires_browser: false,
        }
    }

    async fn execute(&self, args: ToolArgs) -> Result<ToolOutput> {
        let parsed: RssArgs = serde_json::from_value(args)
            .map_err(|e| CrawlError::InvalidArg(format!("args: {e}")))?;
        parsed.validate()?;
        let url = normalize_url(&parsed.url)?;
        let res = self.fetcher.fetch(&url).await?;
        let bytes = res.body.as_slice();

        let mut items: Vec<FeedItem> = Vec::new();
        let feed_title;
        let mut feed_link = String::new();
        let mut feed_description = String::new();
        let mut feed_language = String::new();

        if let Ok(channel) = rss::Channel::read_from(bytes) {
            feed_title = channel.title().to_string();
            feed_link = channel.link().to_string();
            feed_description = channel.description().to_string();
            if let Some(lang) = channel.language() {
                feed_language = lang.to_string();
            }
            for item in channel.items() {
                items.push(FeedItem {
                    title: item.title().unwrap_or("(untitled)").to_string(),
                    link: item.link().unwrap_or("").to_string(),
                    date: item.pub_date().map(String::from),
                    author: item.author().map(String::from),
                    summary: item
                        .description()
                        .map(|s| s.chars().take(500).collect::<String>()),
                    categories: item.categories().iter().map(|c| c.name().to_string()).collect(),
                });
            }
        } else if let Ok(feed) = atom_syndication::Feed::read_from(bytes) {
            feed_title = feed.title().to_string();
            if let Some(first) = feed.links().first() {
                feed_link = first.href().to_string();
            }
            if let Some(sub) = feed.subtitle() {
                feed_description = sub.to_string();
            }
            if let Some(lang) = feed.lang() {
                feed_language = lang.to_string();
            }
            for entry in feed.entries() {
                let link = entry.links().first().map(|l| l.href().to_string()).unwrap_or_default();
                let author = entry.authors().first().map(|a| a.name().to_string());
                let summary = entry.summary().map(|t| {
                    t.to_string().chars().take(500).collect::<String>()
                });
                let categories: Vec<String> =
                    entry.categories().iter().map(|c| c.term().to_string()).collect();
                items.push(FeedItem {
                    title: entry.title().to_string(),
                    link,
                    date: Some(entry.updated().to_rfc3339()),
                    author,
                    summary,
                    categories,
                });
            }
        } else {
            return Err(CrawlError::Parse("not a valid RSS or Atom feed".into()));
        }

        if let Some(since) = &parsed.since {
            if let Ok(since_dt) = chrono::NaiveDate::parse_from_str(since, "%Y-%m-%d") {
                items.retain(|i| {
                    if let Some(d) = &i.date {
                        if let Ok(dt) = chrono::DateTime::parse_from_rfc2822(d) {
                            return dt.date_naive() >= since_dt;
                        }
                        if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(d) {
                            return dt.date_naive() >= since_dt;
                        }
                    }
                    true
                });
            }
        }

        items.truncate(parsed.limit);

        if parsed.format == "markdown" {
            let mut md = String::new();
            if !feed_title.is_empty() {
                md.push_str(&format!("# {}\n", feed_title));
            }
            if !feed_link.is_empty() {
                md.push_str(&format!("Source: {}\n\n", feed_link));
            }
            for it in &items {
                md.push_str(&format!("## {}\n- Link: {}\n", it.title, it.link));
                if let Some(d) = &it.date {
                    md.push_str(&format!("- Date: {}\n", d));
                }
                if let Some(a) = &it.author {
                    md.push_str(&format!("- Author: {}\n", a));
                }
                if !it.categories.is_empty() {
                    md.push_str(&format!("- Categories: {}\n", it.categories.join(", ")));
                }
                if let Some(s) = &it.summary {
                    md.push_str(&format!("\n{}\n\n", s));
                }
            }
            return Ok(ToolOutput::json(serde_json::Value::String(md)));
        }

        let items_count = items.len();
        Ok(ToolOutput::json(serde_json::json!({
            "feed": {
                "title": feed_title,
                "link": feed_link,
                "description": feed_description,
                "language": feed_language,
            },
            "items_count": items_count,
            "items": items,
        })))
    }
}

// ── Download ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadArgs {
    pub url: String,
    pub output_path: String,
    #[serde(default = "default_timeout")]
    pub timeout_secs: u64,
}

fn default_timeout() -> u64 {
    60
}

pub struct DownloadTool;

impl DownloadTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for DownloadTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for DownloadTool {
    fn schema(&self) -> ToolSchema {
        ToolSchema {
            name: "download".into(),
            description: "Download a single file to disk.".into(),
            input_schema: serde_json::json!({
                "type":"object","required":["url","output_path"],
                "properties": {
                    "url": {"type":"string","maxLength":MAX_URL_LENGTH},
                    "output_path": {"type":"string"},
                    "timeout_secs": {"type":"integer","minimum":1,"maximum":600,"default":60}
                }
            }),
            output_schema: serde_json::json!({"type":"object"}),
            requires_api_key: None,
            requires_browser: false,
        }
    }
    async fn execute(&self, args: ToolArgs) -> Result<ToolOutput> {
        let parsed: DownloadArgs = serde_json::from_value(args)
            .map_err(|e| CrawlError::InvalidArg(format!("args: {e}")))?;
        let url = normalize_url(&parsed.url)?;
        let path = PathBuf::from(parsed.output_path);
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                tokio::fs::create_dir_all(parent).await?;
            }
        }
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(parsed.timeout_secs))
            .gzip(true)
            .brotli(true)
            .build()
            .map_err(|e| CrawlError::Other(e.to_string()))?;
        let start = std::time::Instant::now();
        let mut res = client
            .get(&url)
            .send()
            .await
            .map_err(|e| CrawlError::Network(e.to_string()))?;
        let status = res.status();
        if !status.is_success() {
            return Err(CrawlError::Http {
                status: status.as_u16(),
                message: format!("download failed: {status}"),
            });
        }
        let mut file = tokio::fs::File::create(&path).await?;
        let mut total_bytes: u64 = 0;
        while let Some(chunk) = res
            .chunk()
            .await
            .map_err(|e| CrawlError::Network(e.to_string()))?
        {
            total_bytes += chunk.len() as u64;
            file.write_all(&chunk).await?;
        }
        file.flush().await?;
        Ok(ToolOutput::json(serde_json::json!({
            "url": url,
            "path": path.display().to_string(),
            "bytes": total_bytes,
            "duration_ms": start.elapsed().as_millis() as u64,
        })))
    }
}

// ── Batch download ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchDownloadArgs {
    pub urls: Vec<String>,
    pub output_dir: String,
    #[serde(default = "default_dl_concurrency")]
    pub concurrency: usize,
}

fn default_dl_concurrency() -> usize {
    5
}

pub struct BatchDownloadTool;

impl BatchDownloadTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for BatchDownloadTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for BatchDownloadTool {
    fn schema(&self) -> ToolSchema {
        ToolSchema {
            name: "batch_download".into(),
            description: "Download multiple URLs concurrently to a directory.".into(),
            input_schema: serde_json::json!({
                "type":"object","required":["urls","output_dir"],
                "properties":{
                    "urls":{"type":"array","items":{"type":"string"},"maxItems":MAX_URLS},
                    "output_dir":{"type":"string"},
                    "concurrency":{"type":"integer","minimum":1,"maximum":MAX_CONCURRENCY,"default":5}
                }
            }),
            output_schema: serde_json::json!({"type":"object"}),
            requires_api_key: None,
            requires_browser: false,
        }
    }
    async fn execute(&self, args: ToolArgs) -> Result<ToolOutput> {
        let parsed: BatchDownloadArgs = serde_json::from_value(args)
            .map_err(|e| CrawlError::InvalidArg(format!("args: {e}")))?;
        if parsed.urls.is_empty() {
            return Err(CrawlError::InvalidArg("urls is empty".into()));
        }
        if parsed.urls.len() > MAX_URLS {
            return Err(CrawlError::InvalidArg("too many urls".into()));
        }
        if parsed.concurrency == 0 || parsed.concurrency > MAX_CONCURRENCY {
            return Err(CrawlError::InvalidArg("concurrency out of range".into()));
        }
        let out_dir = PathBuf::from(&parsed.output_dir);
        tokio::fs::create_dir_all(&out_dir).await?;
        let sem = Arc::new(tokio::sync::Semaphore::new(parsed.concurrency));
        let results: Arc<tokio::sync::Mutex<Vec<serde_json::Value>>> =
            Arc::new(tokio::sync::Mutex::new(Vec::with_capacity(parsed.urls.len())));
        let mut handles = Vec::new();
        for (i, url) in parsed.urls.iter().enumerate() {
            let sem = sem.clone();
            let url = url.clone();
            let out_dir = out_dir.clone();
            let results = results.clone();
            handles.push(tokio::spawn(async move {
                let _permit = sem.acquire().await.ok();
                let file_name = format!("dl-{:04}", i);
                let path = out_dir.join(&file_name);
                let tool = DownloadTool::new();
                let r = tool
                    .execute(serde_json::json!({
                        "url": url,
                        "output_path": path.display().to_string()
                    }))
                    .await;
                let mut g = results.lock().await;
                match r {
                    Ok(o) => g.push(serde_json::json!({"url": url, "status":"ok", "result": o.data})),
                    Err(e) => g.push(serde_json::json!({"url": url, "status":"error", "error": e.to_string()})),
                }
            }));
        }
        for h in handles {
            let _ = h.await;
        }
        let res = Arc::try_unwrap(results)
            .map(|m| m.into_inner())
            .unwrap_or_else(|_| Vec::new());
        let total = res.len();
        let ok = res.iter().filter(|v| v["status"] == "ok").count();
        Ok(ToolOutput::json(serde_json::json!({
            "total": total,
            "succeeded": ok,
            "failed": total - ok,
            "results": res,
        })))
    }
}

// ── Batch scrape ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchScrapeArgs {
    pub urls: Vec<String>,
    #[serde(default = "default_dl_concurrency")]
    pub concurrency: usize,
    #[serde(default = "default_format")]
    pub format: String,
}

pub struct BatchScrapeTool {
    pub fetcher: Arc<dyn Fetcher>,
}

impl BatchScrapeTool {
    pub fn with_default() -> Result<Self> {
        Ok(Self { fetcher: Arc::new(DefaultFetcher::new()?) })
    }
    pub fn new(fetcher: Arc<dyn Fetcher>) -> Self {
        Self { fetcher }
    }
}

#[async_trait]
impl Tool for BatchScrapeTool {
    fn schema(&self) -> ToolSchema {
        ToolSchema {
            name: "batch_scrape".into(),
            description: "Scrape multiple URLs concurrently and return markdown content.".into(),
            input_schema: serde_json::json!({
                "type":"object","required":["urls"],
                "properties":{
                    "urls":{"type":"array","items":{"type":"string"},"maxItems":MAX_URLS},
                    "concurrency":{"type":"integer","minimum":1,"maximum":MAX_CONCURRENCY,"default":5},
                    "format":{"type":"string","enum":["json","markdown"],"default":"json"}
                }
            }),
            output_schema: serde_json::json!({"type":"object"}),
            requires_api_key: None,
            requires_browser: false,
        }
    }
    async fn execute(&self, args: ToolArgs) -> Result<ToolOutput> {
        let parsed: BatchScrapeArgs = serde_json::from_value(args)
            .map_err(|e| CrawlError::InvalidArg(format!("args: {e}")))?;
        if parsed.urls.is_empty() {
            return Err(CrawlError::InvalidArg("urls is empty".into()));
        }
        let sem = Arc::new(tokio::sync::Semaphore::new(parsed.concurrency));
        let results: Arc<tokio::sync::Mutex<Vec<serde_json::Value>>> =
            Arc::new(tokio::sync::Mutex::new(Vec::new()));
        let mut handles = Vec::new();
        for url in parsed.urls.iter() {
            let url = url.clone();
            let fetcher = self.fetcher.clone();
            let sem = sem.clone();
            let results = results.clone();
            handles.push(tokio::spawn(async move {
                let _permit = sem.acquire().await.ok();
                let r = fetcher.fetch(&url).await;
                let mut g = results.lock().await;
                match r {
                    Ok(res) => {
                        let html = res.body_string_lossy();
                        let md = crate::html::markdown::html_to_markdown(&html);
                        g.push(serde_json::json!({
                            "url": res.final_url,
                            "status": res.status,
                            "markdown": md
                        }));
                    }
                    Err(e) => g.push(serde_json::json!({"url": url, "error": e.to_string()})),
                }
            }));
        }
        for h in handles {
            let _ = h.await;
        }
        let res = Arc::try_unwrap(results).map(|m| m.into_inner()).unwrap_or_default();
        let total = res.len();
        Ok(ToolOutput::json(serde_json::json!({
            "total": total,
            "results": res,
        })))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use imperium_crawl_core::{ContentKind, FetchResult, StealthLevel};

    struct InlineStub(String, ContentKind);
    #[async_trait]
    impl Fetcher for InlineStub {
        async fn fetch(&self, url: &str) -> Result<FetchResult> {
            Ok(FetchResult {
                url: url.into(),
                final_url: url.into(),
                status: 200,
                kind: self.1.clone(),
                body: self.0.as_bytes().to_vec(),
                headers: Default::default(),
                stealth_level: StealthLevel::L1Headers,
                duration_ms: 1,
            })
        }
    }

    #[tokio::test]
    async fn rss_parses_rss20_feed() {
        let xml = r#"<?xml version="1.0"?>
            <rss version="2.0">
              <channel>
                <title>Test Feed</title>
                <link>https://example.com</link>
                <description>A test</description>
                <item>
                    <title>Item One</title>
                    <link>https://example.com/1</link>
                    <description>desc one</description>
                </item>
                <item>
                    <title>Item Two</title>
                    <link>https://example.com/2</link>
                </item>
              </channel>
            </rss>"#;
        let stub = Arc::new(InlineStub(
            xml.to_string(),
            ContentKind::Other("application/rss+xml".into()),
        ));
        let tool = RssTool::new(stub);
        let out = tool
            .execute(serde_json::json!({"url":"https://example.com/feed"}))
            .await
            .unwrap();
        assert_eq!(out.data["items_count"], 2);
        assert_eq!(out.data["feed"]["title"], "Test Feed");
    }

    #[tokio::test]
    async fn rss_returns_markdown_when_requested() {
        let xml = r#"<?xml version="1.0"?>
            <rss version="2.0"><channel>
                <title>F</title>
                <link>https://e.com</link>
                <description>d</description>
                <item><title>One</title><link>https://e.com/1</link></item>
            </channel></rss>"#;
        let tool = RssTool::new(Arc::new(InlineStub(
            xml.into(),
            ContentKind::Other("application/rss+xml".into()),
        )));
        let out = tool
            .execute(serde_json::json!({"url":"https://e.com/feed","format":"markdown"}))
            .await
            .unwrap();
        let md = out.data.as_str().unwrap();
        assert!(md.contains("F"));
        assert!(md.contains("One"));
    }
}
