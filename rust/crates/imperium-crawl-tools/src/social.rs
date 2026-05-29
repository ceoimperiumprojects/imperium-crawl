//! Sprint 12 — Social parsers: youtube (shell-out yt-dlp), reddit (JSON), instagram (stub).
//! Ported from `../../../src/tools/{youtube,reddit,instagram}.ts`.

use async_trait::async_trait;
use imperium_crawl_core::{
    constants::MAX_QUERY_LENGTH, CrawlError, Result, Tool, ToolArgs, ToolOutput, ToolSchema,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::html::fetcher::{DefaultFetcher, Fetcher};

// ── YouTube ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YouTubeArgs {
    /// Either a youtube.com URL or a youtube ID.
    pub url: String,
    /// "info" | "transcript" | "download"
    #[serde(default = "default_yt_action")]
    pub action: String,
    /// For downloads.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_path: Option<String>,
    /// For downloads: e.g. "best", "mp4", "mp3".
    #[serde(default = "default_yt_format")]
    pub format: String,
}

fn default_yt_action() -> String {
    "info".into()
}
fn default_yt_format() -> String {
    "best".into()
}

pub struct YouTubeTool;

impl YouTubeTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for YouTubeTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl Tool for YouTubeTool {
    fn schema(&self) -> ToolSchema {
        ToolSchema {
            name: "youtube".into(),
            description: "YouTube tools via yt-dlp subprocess: info, transcript, download.".into(),
            input_schema: serde_json::json!({
                "type":"object","required":["url"],
                "properties":{
                    "url":{"type":"string","maxLength":8192},
                    "action":{"type":"string","enum":["info","transcript","download"],"default":"info"},
                    "output_path":{"type":"string"},
                    "format":{"type":"string","default":"best"}
                }
            }),
            output_schema: serde_json::json!({"type":"object"}),
            requires_api_key: None,
            requires_browser: false,
        }
    }
    async fn execute(&self, args: ToolArgs) -> Result<ToolOutput> {
        let parsed: YouTubeArgs = serde_json::from_value(args)
            .map_err(|e| CrawlError::InvalidArg(format!("args: {e}")))?;
        which_yt_dlp()?;
        match parsed.action.as_str() {
            "info" => {
                let out = tokio::process::Command::new("yt-dlp")
                    .args(["--dump-json", "--skip-download", &parsed.url])
                    .output()
                    .await
                    .map_err(|e| CrawlError::Subprocess(format!("yt-dlp: {e}")))?;
                if !out.status.success() {
                    return Err(CrawlError::Subprocess(format!(
                        "yt-dlp info failed: {}",
                        String::from_utf8_lossy(&out.stderr)
                    )));
                }
                let info: serde_json::Value =
                    serde_json::from_slice(&out.stdout).map_err(|e| CrawlError::Parse(e.to_string()))?;
                Ok(ToolOutput::json(info))
            }
            "transcript" => {
                let dir = tempfile::tempdir().map_err(|e| CrawlError::Io(e))?;
                let template = dir.path().join("%(id)s.%(ext)s");
                let out = tokio::process::Command::new("yt-dlp")
                    .args([
                        "--write-auto-sub",
                        "--write-sub",
                        "--sub-lang",
                        "en.*",
                        "--skip-download",
                        "--sub-format",
                        "vtt",
                        "-o",
                        template.to_str().unwrap_or(""),
                        &parsed.url,
                    ])
                    .output()
                    .await
                    .map_err(|e| CrawlError::Subprocess(format!("yt-dlp: {e}")))?;
                if !out.status.success() {
                    return Err(CrawlError::Subprocess(format!(
                        "yt-dlp transcript failed: {}",
                        String::from_utf8_lossy(&out.stderr)
                    )));
                }
                let mut transcripts = Vec::new();
                let mut rd = tokio::fs::read_dir(dir.path()).await?;
                while let Some(entry) = rd.next_entry().await? {
                    let path = entry.path();
                    if path.extension().and_then(|s| s.to_str()) == Some("vtt") {
                        if let Ok(txt) = tokio::fs::read_to_string(&path).await {
                            transcripts.push(serde_json::json!({
                                "file": path.display().to_string(),
                                "content": txt,
                            }));
                        }
                    }
                }
                Ok(ToolOutput::json(serde_json::json!({
                    "url": parsed.url,
                    "transcripts": transcripts,
                })))
            }
            "download" => {
                let output_path = parsed
                    .output_path
                    .as_deref()
                    .ok_or_else(|| CrawlError::MissingArg("output_path".into()))?;
                let out = tokio::process::Command::new("yt-dlp")
                    .args(["-f", &parsed.format, "-o", output_path, &parsed.url])
                    .output()
                    .await
                    .map_err(|e| CrawlError::Subprocess(format!("yt-dlp: {e}")))?;
                if !out.status.success() {
                    return Err(CrawlError::Subprocess(format!(
                        "yt-dlp download failed: {}",
                        String::from_utf8_lossy(&out.stderr)
                    )));
                }
                Ok(ToolOutput::json(serde_json::json!({
                    "url": parsed.url,
                    "output_path": output_path,
                    "stdout": String::from_utf8_lossy(&out.stdout).into_owned(),
                })))
            }
            other => Err(CrawlError::InvalidArg(format!("unknown action: {other}"))),
        }
    }
}

fn which_yt_dlp() -> Result<()> {
    // Try `which yt-dlp` synchronously via std::process
    let r = std::process::Command::new("which").arg("yt-dlp").output();
    match r {
        Ok(o) if o.status.success() => Ok(()),
        _ => Err(CrawlError::Subprocess(
            "yt-dlp binary not found in PATH. Install via `pip install yt-dlp`.".into(),
        )),
    }
}

// ── Reddit ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RedditArgs {
    pub action: String, // search | posts | comments | subreddit
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub query: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subreddit: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub post_url: Option<String>,
    #[serde(default = "default_sort")]
    pub sort: String,
    #[serde(default = "default_time")]
    pub time: String,
    #[serde(default = "default_reddit_limit")]
    pub limit: usize,
}

fn default_sort() -> String {
    "hot".into()
}
fn default_time() -> String {
    "week".into()
}
fn default_reddit_limit() -> usize {
    25
}

pub struct RedditTool {
    pub fetcher: Arc<dyn Fetcher>,
}

impl RedditTool {
    pub fn with_default() -> Result<Self> {
        Ok(Self { fetcher: Arc::new(DefaultFetcher::new()?) })
    }
    pub fn new(fetcher: Arc<dyn Fetcher>) -> Self {
        Self { fetcher }
    }

    async fn reddit_json(&self, path: &str) -> Result<serde_json::Value> {
        let sep = if path.contains('?') { '&' } else { '?' };
        let url = format!("https://www.reddit.com{}{}raw_json=1", path, sep);
        let res = self.fetcher.fetch(&url).await?;
        if !res.is_success() {
            return Err(CrawlError::Http {
                status: res.status,
                message: format!("Reddit fetch returned {}", res.status),
            });
        }
        let body = res.body_string_lossy();
        serde_json::from_str::<serde_json::Value>(&body)
            .map_err(|e| CrawlError::Parse(format!("Reddit JSON: {e}")))
    }
}

#[async_trait]
impl Tool for RedditTool {
    fn schema(&self) -> ToolSchema {
        ToolSchema {
            name: "reddit".into(),
            description: "Search Reddit, browse subreddits, get posts & comments via public JSON API.".into(),
            input_schema: serde_json::json!({
                "type":"object","required":["action"],
                "properties":{
                    "action":{"type":"string","enum":["search","posts","comments","subreddit"]},
                    "query":{"type":"string","maxLength":MAX_QUERY_LENGTH},
                    "subreddit":{"type":"string","maxLength":200},
                    "post_url":{"type":"string","maxLength":8192},
                    "sort":{"type":"string","enum":["hot","new","top","rising"]},
                    "time":{"type":"string","enum":["hour","day","week","month","year","all"]},
                    "limit":{"type":"integer","minimum":1,"maximum":1000,"default":25}
                }
            }),
            output_schema: serde_json::json!({"type":"object"}),
            requires_api_key: None,
            requires_browser: false,
        }
    }

    async fn execute(&self, args: ToolArgs) -> Result<ToolOutput> {
        let parsed: RedditArgs = serde_json::from_value(args)
            .map_err(|e| CrawlError::InvalidArg(format!("args: {e}")))?;
        let limit = parsed.limit.min(1000);
        match parsed.action.as_str() {
            "search" => {
                let q = parsed.query.as_deref().ok_or_else(|| CrawlError::MissingArg("query".into()))?;
                let path = format!(
                    "/search.json?q={}&sort={}&t={}&limit={limit}",
                    urlencoding(q),
                    parsed.sort,
                    parsed.time
                );
                let data = self.reddit_json(&path).await?;
                Ok(ToolOutput::json(extract_posts(&data, "reddit", q.to_string())))
            }
            "posts" | "subreddit" => {
                let sub = parsed
                    .subreddit
                    .as_deref()
                    .ok_or_else(|| CrawlError::MissingArg("subreddit".into()))?;
                let path = format!(
                    "/r/{}/{}.json?t={}&limit={limit}",
                    sub, parsed.sort, parsed.time
                );
                let data = self.reddit_json(&path).await?;
                Ok(ToolOutput::json(extract_posts(&data, "reddit", sub.to_string())))
            }
            "comments" => {
                let post_url = parsed
                    .post_url
                    .as_deref()
                    .ok_or_else(|| CrawlError::MissingArg("post_url".into()))?;
                let parsed_url = url::Url::parse(post_url)
                    .map_err(|e| CrawlError::InvalidArg(format!("post_url: {e}")))?;
                let mut path = parsed_url.path().to_string();
                if !path.ends_with(".json") {
                    if path.ends_with('/') {
                        path.push_str(".json");
                    } else {
                        path.push_str(".json");
                    }
                }
                let data = self.reddit_json(&format!("{}?limit={}", path, limit)).await?;
                Ok(ToolOutput::json(serde_json::json!({
                    "url": post_url,
                    "raw": data,
                })))
            }
            other => Err(CrawlError::InvalidArg(format!("unknown action: {other}"))),
        }
    }
}

fn urlencoding(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.bytes() {
        if c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.' | b'~') {
            out.push(c as char);
        } else {
            out.push_str(&format!("%{:02X}", c));
        }
    }
    out
}

fn extract_posts(data: &serde_json::Value, platform: &str, ctx: String) -> serde_json::Value {
    let children = data
        .get("data")
        .and_then(|d| d.get("children"))
        .and_then(|c| c.as_array())
        .cloned()
        .unwrap_or_default();
    let mut posts = Vec::new();
    for c in children {
        let d = c.get("data").cloned().unwrap_or(serde_json::Value::Null);
        posts.push(serde_json::json!({
            "id": d.get("id"),
            "title": d.get("title"),
            "url": d.get("permalink").and_then(|p| p.as_str())
                .map(|p| format!("https://www.reddit.com{}", p)),
            "author": d.get("author"),
            "score": d.get("score"),
            "comments_count": d.get("num_comments"),
            "subreddit": d.get("subreddit"),
            "selftext": d.get("selftext"),
        }));
    }
    let len = posts.len();
    serde_json::json!({
        "platform": platform,
        "context": ctx,
        "total": len,
        "items": posts,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn yt_dlp_check_can_fail_gracefully() {
        // PATH may or may not have yt-dlp; just ensure the function returns one of two states.
        match which_yt_dlp() {
            Ok(_) => {}
            Err(CrawlError::Subprocess(_)) => {}
            Err(e) => panic!("unexpected error: {e}"),
        }
    }

    #[test]
    fn urlencoding_replaces_specials() {
        assert_eq!(urlencoding("hello world"), "hello%20world");
        assert_eq!(urlencoding("a&b"), "a%26b");
    }

    #[test]
    fn extract_posts_handles_empty() {
        let v = serde_json::json!({"data":{"children":[]}});
        let r = extract_posts(&v, "reddit", "x".into());
        assert_eq!(r["total"], 0);
    }
}
