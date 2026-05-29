//! `crawl` tool — priority-based site crawler.
//! Ported from `../../../src/tools/crawl.ts`.

use async_trait::async_trait;
use imperium_crawl_core::{
    constants::{
        DEFAULT_CONCURRENCY, DEFAULT_MAX_DEPTH, DEFAULT_MAX_PAGES, MAX_CONCURRENCY,
        MAX_CRAWL_CONTENT_PER_PAGE, MAX_PAGES, MAX_URL_LENGTH,
    },
    normalize_url, CrawlError, Result, Tool, ToolArgs, ToolOutput, ToolSchema,
};
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Arc;
use tokio::sync::{Mutex, Semaphore};

use super::fetcher::{DefaultFetcher, Fetcher};
use super::markdown::html_to_markdown;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrawlArgs {
    pub url: String,
    #[serde(default = "default_max_depth")]
    pub max_depth: u32,
    #[serde(default = "default_max_pages")]
    pub max_pages: usize,
    #[serde(default = "default_concurrency")]
    pub concurrency: usize,
}

fn default_max_depth() -> u32 {
    DEFAULT_MAX_DEPTH as u32
}
fn default_max_pages() -> usize {
    DEFAULT_MAX_PAGES
}
fn default_concurrency() -> usize {
    DEFAULT_CONCURRENCY
}

impl CrawlArgs {
    pub fn validate(&self) -> Result<()> {
        if self.url.is_empty() || self.url.len() > MAX_URL_LENGTH {
            return Err(CrawlError::InvalidArg("url length out of range".into()));
        }
        if self.max_pages == 0 || self.max_pages > MAX_PAGES {
            return Err(CrawlError::InvalidArg("max_pages out of range".into()));
        }
        if self.concurrency == 0 || self.concurrency > MAX_CONCURRENCY {
            return Err(CrawlError::InvalidArg("concurrency out of range".into()));
        }
        Ok(())
    }
}

fn is_same_origin(base: &str, other: &str) -> bool {
    match (url::Url::parse(base), url::Url::parse(other)) {
        (Ok(b), Ok(o)) => b.host_str() == o.host_str() && b.scheme() == o.scheme(),
        _ => false,
    }
}

const CONTENT_PATTERNS: &[&str] = &[
    "/blog/", "/article", "/post/", "/news/", "/story/", "/guide/", "/tutorial/", "/docs/", "/doc/", "/learn/",
];
const LOW_VALUE_PATTERNS: &[&str] = &[
    "/tag/", "/category/", "/author/", "/search", "/login", "/signup", "/register", "/cart", "/checkout", "/account", "/admin", "/feed",
];
const CONTENT_ANCHOR_PATTERNS: &[&str] = &[
    "read more", "continue reading", "full article", "learn more", "view details",
];

fn score_url(url: &str, depth: u32, anchor_text: &str) -> i32 {
    let mut score: i32 = 100 - (depth as i32) * 20;
    if let Ok(u) = url::Url::parse(url) {
        let path = u.path().to_ascii_lowercase();
        if CONTENT_PATTERNS.iter().any(|p| path.contains(p)) {
            score += 30;
        }
        if LOW_VALUE_PATTERNS.iter().any(|p| path.contains(p)) {
            score -= 40;
        }
        let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
        if segments.len() <= 2 {
            score += 10;
        }
        if segments.len() >= 5 {
            score -= 10;
        }
        if path.ends_with(".xml") || path.ends_with(".json") || path.ends_with(".rss") || path.ends_with(".atom") {
            score -= 40;
        }
        // 4-digit year + 2-digit month path component
        if regex_year_month(&path) {
            score += 30;
        }
    } else {
        score -= 50;
    }
    let anchor = anchor_text.to_ascii_lowercase();
    if CONTENT_ANCHOR_PATTERNS.iter().any(|p| anchor.contains(p)) {
        score += 20;
    }
    score
}

fn regex_year_month(path: &str) -> bool {
    // cheap manual scan: look for "/YYYY/MM/"
    let bytes = path.as_bytes();
    if bytes.len() < 9 {
        return false;
    }
    for i in 0..bytes.len() - 8 {
        if bytes[i] == b'/'
            && bytes[i + 1].is_ascii_digit()
            && bytes[i + 2].is_ascii_digit()
            && bytes[i + 3].is_ascii_digit()
            && bytes[i + 4].is_ascii_digit()
            && bytes[i + 5] == b'/'
            && bytes[i + 6].is_ascii_digit()
            && bytes[i + 7].is_ascii_digit()
            && (i + 8 >= bytes.len() || bytes[i + 8] == b'/')
        {
            return true;
        }
    }
    false
}

#[derive(Debug, Clone)]
struct QueueEntry {
    url: String,
    depth: u32,
    score: i32,
}

pub struct CrawlTool {
    pub fetcher: Arc<dyn Fetcher>,
}

impl CrawlTool {
    pub fn with_default() -> Result<Self> {
        Ok(Self { fetcher: Arc::new(DefaultFetcher::new()?) })
    }
    pub fn new(fetcher: Arc<dyn Fetcher>) -> Self {
        Self { fetcher }
    }
}

#[async_trait]
impl Tool for CrawlTool {
    fn schema(&self) -> ToolSchema {
        ToolSchema {
            name: "crawl".into(),
            description: "Priority-based site crawler. Returns markdown content per page.".into(),
            input_schema: serde_json::json!({
                "type":"object","required":["url"],
                "properties": {
                    "url": {"type":"string","maxLength":MAX_URL_LENGTH},
                    "max_depth": {"type":"integer","minimum":0,"maximum":10,"default":DEFAULT_MAX_DEPTH},
                    "max_pages": {"type":"integer","minimum":1,"maximum":MAX_PAGES,"default":DEFAULT_MAX_PAGES},
                    "concurrency": {"type":"integer","minimum":1,"maximum":MAX_CONCURRENCY,"default":DEFAULT_CONCURRENCY}
                }
            }),
            output_schema: serde_json::json!({"type":"object"}),
            requires_api_key: None,
            requires_browser: false,
        }
    }

    async fn execute(&self, args: ToolArgs) -> Result<ToolOutput> {
        let parsed: CrawlArgs = serde_json::from_value(args)
            .map_err(|e| CrawlError::InvalidArg(format!("args: {e}")))?;
        parsed.validate()?;

        let start_url = normalize_url(&parsed.url)?;
        let semaphore = Arc::new(Semaphore::new(parsed.concurrency));
        let visited: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));
        let queue: Arc<Mutex<Vec<QueueEntry>>> = Arc::new(Mutex::new(vec![QueueEntry {
            url: start_url.clone(),
            depth: 0,
            score: 200,
        }]));
        let results: Arc<Mutex<Vec<serde_json::Value>>> = Arc::new(Mutex::new(Vec::new()));

        loop {
            // pop batch
            let batch: Vec<QueueEntry> = {
                let mut q = queue.lock().await;
                let mut v = visited.lock().await;
                let mut out = Vec::new();
                while out.len() < parsed.concurrency && !q.is_empty() {
                    // pop highest-score first
                    let mut best_idx = 0;
                    let mut best_score = q[0].score;
                    for (i, e) in q.iter().enumerate() {
                        if e.score > best_score {
                            best_idx = i;
                            best_score = e.score;
                        }
                    }
                    let e = q.remove(best_idx);
                    if !v.contains(&e.url) {
                        v.insert(e.url.clone());
                        out.push(e);
                    }
                }
                out
            };

            if batch.is_empty() {
                break;
            }
            let pages_so_far = { results.lock().await.len() };
            if pages_so_far >= parsed.max_pages {
                break;
            }

            let mut handles = Vec::new();
            for entry in batch {
                if results.lock().await.len() >= parsed.max_pages {
                    break;
                }
                let fetcher = self.fetcher.clone();
                let queue = queue.clone();
                let results = results.clone();
                let semaphore = semaphore.clone();
                let max_depth = parsed.max_depth;
                let max_pages = parsed.max_pages;
                let start_url = start_url.clone();
                let h = tokio::spawn(async move {
                    let _permit = match semaphore.acquire().await {
                        Ok(p) => p,
                        Err(_) => return,
                    };
                    let res = match fetcher.fetch(&entry.url).await {
                        Ok(r) => r,
                        Err(_) => return,
                    };
                    let html = res.body_string_lossy();
                    let mut content = html_to_markdown(&html);
                    if content.len() > MAX_CRAWL_CONTENT_PER_PAGE {
                        content.truncate(MAX_CRAWL_CONTENT_PER_PAGE);
                        content.push_str("\n\n[Content truncated]");
                    }
                    {
                        let mut r = results.lock().await;
                        if r.len() >= max_pages {
                            return;
                        }
                        r.push(serde_json::json!({
                            "url": res.final_url,
                            "depth": entry.depth,
                            "content": content,
                        }));
                    }

                    if entry.depth < max_depth {
                        // Extract links into owned data BEFORE awaiting on
                        // the mutex — scraper's Html is not Send, so it must
                        // be dropped inside this synchronous block.
                        let new_entries: Vec<QueueEntry> = {
                            let doc = Html::parse_document(&html);
                            let mut acc: Vec<QueueEntry> = Vec::new();
                            if let Ok(sel) = Selector::parse("a[href]") {
                                for el in doc.select(&sel) {
                                    let href = match el.value().attr("href") {
                                        Some(h) => h,
                                        None => continue,
                                    };
                                    let abs = match url::Url::parse(&entry.url)
                                        .and_then(|b| b.join(href))
                                    {
                                        Ok(u) => u.to_string(),
                                        Err(_) => continue,
                                    };
                                    let abs = match normalize_url(&abs) {
                                        Ok(u) => u,
                                        Err(_) => continue,
                                    };
                                    if !is_same_origin(&start_url, &abs) {
                                        continue;
                                    }
                                    let anchor_text: String =
                                        el.text().collect::<String>();
                                    let s = score_url(
                                        &abs,
                                        entry.depth + 1,
                                        &anchor_text,
                                    );
                                    acc.push(QueueEntry {
                                        url: abs,
                                        depth: entry.depth + 1,
                                        score: s,
                                    });
                                }
                            }
                            acc
                        };
                        if !new_entries.is_empty() {
                            let mut q = queue.lock().await;
                            for e in new_entries {
                                q.push(e);
                            }
                        }
                    }
                });
                handles.push(h);
            }
            for h in handles {
                let _ = h.await;
            }
        }

        let results = Arc::try_unwrap(results)
            .map(|m| m.into_inner())
            .unwrap_or_else(|_| Vec::new());

        let r_count = results.len();
        Ok(ToolOutput::json(serde_json::json!({
            "pages_crawled": r_count,
            "results": results,
        })))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn score_url_boosts_content_paths() {
        let s_content = score_url("https://example.com/blog/post-1", 0, "Read more");
        let s_login = score_url("https://example.com/login", 0, "");
        assert!(s_content > s_login);
    }

    #[test]
    fn score_url_detects_year_month() {
        let s = score_url("https://example.com/2024/01/some-post", 0, "");
        assert!(s >= 100);
    }

    #[test]
    fn validate_rejects_bad_concurrency() {
        let a = CrawlArgs {
            url: "https://example.com".into(),
            max_depth: 1,
            max_pages: 10,
            concurrency: 0,
        };
        assert!(a.validate().is_err());
    }
}
