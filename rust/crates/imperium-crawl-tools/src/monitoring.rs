//! Sprint 11 — Change tracking: monitor + watch.
//! Ported from `../../../src/tools/{monitor,watch}.ts`.

use async_trait::async_trait;
use imperium_crawl_core::{
    constants::MAX_URL_LENGTH, normalize_url, CrawlError, Result, Tool, ToolArgs, ToolOutput,
    ToolSchema,
};
use serde::{Deserialize, Serialize};
use sha2::Digest;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use crate::html::fetcher::{DefaultFetcher, Fetcher};
use crate::html::markdown::html_to_markdown;

// ── Watch ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchArgs {
    pub url: String,
    #[serde(default = "default_output_dir")]
    pub output_dir: String,
    #[serde(default = "default_hash_on")]
    pub hash_on: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub webhook: Option<String>,
}

fn default_output_dir() -> String {
    "./data/watch".into()
}
fn default_hash_on() -> String {
    "markdown".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WatchState {
    pub url: String,
    pub last_hash: String,
    pub last_checked: String,
    pub last_changed: Option<String>,
    pub hash_on: String,
    pub check_count: u64,
    pub change_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchResult {
    pub url: String,
    pub changed: bool,
    pub first_run: bool,
    pub previous_hash: Option<String>,
    pub current_hash: String,
    pub hash_on: String,
    pub snapshot_file: String,
    pub diff: Option<String>,
    pub webhook_fired: bool,
    pub webhook_status: Option<u16>,
    pub state: WatchState,
    pub checked_at: String,
}

fn hash_hex(s: &str) -> String {
    let mut h = sha2::Sha256::new();
    h.update(s.as_bytes());
    hex_encode(&h.finalize())
}

fn slug_hex(url: &str) -> String {
    let mut h = sha2::Sha256::new();
    h.update(url.as_bytes());
    let bytes = h.finalize();
    hex_encode(&bytes[..8])
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

fn unified_diff(prev: &str, next: &str, max_lines: usize) -> String {
    let prev_lines: Vec<&str> = prev.split('\n').collect();
    let next_lines: Vec<&str> = next.split('\n').collect();
    let prev_set: std::collections::HashSet<&&str> = prev_lines.iter().collect();
    let next_set: std::collections::HashSet<&&str> = next_lines.iter().collect();
    let mut out = Vec::new();
    let mut removed = 0;
    let mut added = 0;
    for line in &prev_lines {
        if !next_set.contains(line) {
            out.push(format!("- {}", line));
            removed += 1;
        }
    }
    for line in &next_lines {
        if !prev_set.contains(line) {
            out.push(format!("+ {}", line));
            added += 1;
        }
    }
    let header = format!(
        "@@ -{} +{} @@ ({removed} removed, {added} added)",
        prev_lines.len(),
        next_lines.len()
    );
    let truncated = if out.len() > max_lines {
        format!("\n... ({} more lines)", out.len() - max_lines)
    } else {
        String::new()
    };
    let body = out.into_iter().take(max_lines).collect::<Vec<_>>().join("\n");
    format!("{header}\n{body}{truncated}")
}

pub struct WatchTool {
    pub fetcher: Arc<dyn Fetcher>,
}

impl WatchTool {
    pub fn with_default() -> Result<Self> {
        Ok(Self { fetcher: Arc::new(DefaultFetcher::new()?) })
    }
    pub fn new(fetcher: Arc<dyn Fetcher>) -> Self {
        Self { fetcher }
    }

    pub async fn run_once(&self, args: &WatchArgs) -> Result<WatchResult> {
        let out_dir = PathBuf::from(&args.output_dir);
        tokio::fs::create_dir_all(&out_dir).await?;
        let state_file = out_dir.join(".state.json");

        let mut state_map: HashMap<String, WatchState> = if state_file.exists() {
            let txt = tokio::fs::read_to_string(&state_file).await.unwrap_or_default();
            serde_json::from_str(&txt).unwrap_or_default()
        } else {
            HashMap::new()
        };

        let url = normalize_url(&args.url)?;
        let res = self.fetcher.fetch(&url).await?;
        let html = res.body_string_lossy();
        let signature = match args.hash_on.as_str() {
            "content" => html.clone(),
            _ => html_to_markdown(&html),
        };
        let current_hash = hash_hex(&signature);
        let slug = slug_hex(&url);
        let snapshot_file = out_dir.join(format!("{slug}.snapshot.txt"));
        let previous_file = out_dir.join(format!("{slug}.previous.txt"));

        let existing = state_map.get(&url).cloned();
        let first_run = existing.is_none();
        let changed = match &existing {
            None => false,
            Some(s) => s.last_hash != current_hash,
        };

        let previous_sig: Option<String> = if snapshot_file.exists() {
            tokio::fs::read_to_string(&snapshot_file).await.ok()
        } else {
            None
        };
        if changed {
            if let Some(p) = &previous_sig {
                let _ = tokio::fs::write(&previous_file, p).await;
            }
        }
        tokio::fs::write(&snapshot_file, &signature).await?;

        let now_iso = chrono::Utc::now().to_rfc3339();
        let new_state = WatchState {
            url: url.clone(),
            last_hash: current_hash.clone(),
            last_checked: now_iso.clone(),
            last_changed: if changed {
                Some(now_iso.clone())
            } else {
                existing.as_ref().and_then(|s| s.last_changed.clone())
            },
            hash_on: args.hash_on.clone(),
            check_count: existing.as_ref().map(|s| s.check_count).unwrap_or(0) + 1,
            change_count: existing.as_ref().map(|s| s.change_count).unwrap_or(0)
                + if changed { 1 } else { 0 },
        };
        state_map.insert(url.clone(), new_state.clone());
        tokio::fs::write(&state_file, serde_json::to_string_pretty(&state_map)?).await?;

        let diff = if changed {
            previous_sig.as_ref().map(|p| unified_diff(p, &signature, 200))
        } else {
            None
        };

        let mut webhook_fired = false;
        let mut webhook_status: Option<u16> = None;
        if changed {
            if let Some(hook) = &args.webhook {
                let payload = serde_json::json!({
                    "event": "watch.change",
                    "url": url,
                    "previous_hash": existing.as_ref().map(|s| &s.last_hash),
                    "current_hash": current_hash,
                    "detected_at": now_iso,
                    "diff": diff,
                });
                if let Ok(client) = reqwest::Client::builder().build() {
                    if let Ok(resp) = client.post(hook).json(&payload).send().await {
                        webhook_fired = true;
                        webhook_status = Some(resp.status().as_u16());
                    }
                }
            }
        }

        Ok(WatchResult {
            url,
            changed,
            first_run,
            previous_hash: existing.map(|s| s.last_hash),
            current_hash,
            hash_on: args.hash_on.clone(),
            snapshot_file: snapshot_file.display().to_string(),
            diff,
            webhook_fired,
            webhook_status,
            state: new_state,
            checked_at: now_iso,
        })
    }
}

#[async_trait]
impl Tool for WatchTool {
    fn schema(&self) -> ToolSchema {
        ToolSchema {
            name: "watch".into(),
            description: "One-shot change detector. Scrape a URL, hash content, diff against last snapshot.".into(),
            input_schema: serde_json::json!({
                "type":"object","required":["url"],
                "properties":{
                    "url":{"type":"string","maxLength":MAX_URL_LENGTH},
                    "output_dir":{"type":"string"},
                    "hash_on":{"type":"string","enum":["content","readability","markdown"]},
                    "webhook":{"type":"string"}
                }
            }),
            output_schema: serde_json::json!({"type":"object"}),
            requires_api_key: None,
            requires_browser: false,
        }
    }
    async fn execute(&self, args: ToolArgs) -> Result<ToolOutput> {
        let parsed: WatchArgs = serde_json::from_value(args)
            .map_err(|e| CrawlError::InvalidArg(format!("args: {e}")))?;
        let r = self.run_once(&parsed).await?;
        Ok(ToolOutput::json(serde_json::to_value(&r).unwrap_or_default()))
    }
}

// ── Monitor ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorArgs {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub urls: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub topic: Option<String>,
    #[serde(default = "default_monitor_dir")]
    pub output_dir: String,
    #[serde(default = "default_min_change")]
    pub min_change_pct: f64,
    #[serde(default = "default_hash_on")]
    pub hash_on: String,
}

fn default_monitor_dir() -> String {
    "./data/monitor".into()
}
fn default_min_change() -> f64 {
    5.0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopicConfig {
    pub name: String,
    pub urls: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_change_pct: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorConfig {
    pub topics: Vec<TopicConfig>,
}

pub struct MonitorTool {
    pub fetcher: Arc<dyn Fetcher>,
}

impl MonitorTool {
    pub fn with_default() -> Result<Self> {
        Ok(Self { fetcher: Arc::new(DefaultFetcher::new()?) })
    }
    pub fn new(fetcher: Arc<dyn Fetcher>) -> Self {
        Self { fetcher }
    }
}

fn slugify(s: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for c in s.chars().flat_map(|c| c.to_lowercase()) {
        if c.is_ascii_alphanumeric() {
            out.push(c);
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    out.trim_matches('-').chars().take(40).collect::<String>()
}

#[async_trait]
impl Tool for MonitorTool {
    fn schema(&self) -> ToolSchema {
        ToolSchema {
            name: "monitor".into(),
            description: "Portfolio change tracker: run watch on a list of URLs, emit a markdown digest.".into(),
            input_schema: serde_json::json!({
                "type":"object",
                "properties":{
                    "config":{"type":"string","description":"Path to JSON config with topics"},
                    "urls":{"type":"array","items":{"type":"string"}},
                    "topic":{"type":"string"},
                    "output_dir":{"type":"string"},
                    "min_change_pct":{"type":"number","minimum":0,"maximum":100},
                    "hash_on":{"type":"string","enum":["content","readability","markdown"]}
                }
            }),
            output_schema: serde_json::json!({"type":"object"}),
            requires_api_key: None,
            requires_browser: false,
        }
    }
    async fn execute(&self, args: ToolArgs) -> Result<ToolOutput> {
        let parsed: MonitorArgs = serde_json::from_value(args)
            .map_err(|e| CrawlError::InvalidArg(format!("args: {e}")))?;
        let cfg: MonitorConfig = if let Some(path) = &parsed.config {
            let txt = tokio::fs::read_to_string(path).await?;
            serde_json::from_str(&txt)
                .map_err(|e| CrawlError::Parse(format!("config: {e}")))?
        } else if let Some(urls) = &parsed.urls {
            MonitorConfig {
                topics: vec![TopicConfig {
                    name: parsed.topic.clone().unwrap_or_else(|| "default".into()),
                    urls: urls.clone(),
                    min_change_pct: None,
                }],
            }
        } else {
            return Err(CrawlError::InvalidArg("must provide config or urls".into()));
        };

        let out_dir = PathBuf::from(&parsed.output_dir);
        tokio::fs::create_dir_all(&out_dir).await?;

        let watch_tool = WatchTool::new(self.fetcher.clone());

        let mut topic_reports = Vec::new();
        for topic in &cfg.topics {
            let topic_dir = out_dir.join(slugify(&topic.name));
            tokio::fs::create_dir_all(&topic_dir).await?;
            let threshold = topic.min_change_pct.unwrap_or(parsed.min_change_pct);
            let mut changes = Vec::new();
            for url in &topic.urls {
                let watch_args = WatchArgs {
                    url: url.clone(),
                    output_dir: topic_dir.display().to_string(),
                    hash_on: parsed.hash_on.clone(),
                    webhook: None,
                };
                match watch_tool.run_once(&watch_args).await {
                    Ok(r) => changes.push(serde_json::json!({
                        "url": r.url,
                        "changed": r.changed,
                        "first_run": r.first_run,
                        "previous_hash": r.previous_hash,
                        "current_hash": r.current_hash,
                    })),
                    Err(e) => changes.push(serde_json::json!({
                        "url": url,
                        "error": e.to_string(),
                    })),
                }
            }
            let meaningful = changes
                .iter()
                .filter(|c| c["changed"].as_bool().unwrap_or(false))
                .count();
            let urls_checked = topic.urls.len();
            topic_reports.push(serde_json::json!({
                "name": topic.name,
                "urls_checked": urls_checked,
                "changes": changes,
                "meaningful_changes": meaningful,
                "threshold_pct": threshold,
            }));
        }

        let now = chrono::Utc::now().to_rfc3339();
        Ok(ToolOutput::json(serde_json::json!({
            "generated_at": now,
            "topics": topic_reports,
        })))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use imperium_crawl_core::{ContentKind, FetchResult, StealthLevel};

    struct CounterStub {
        counter: std::sync::atomic::AtomicU32,
    }
    #[async_trait]
    impl Fetcher for CounterStub {
        async fn fetch(&self, url: &str) -> Result<FetchResult> {
            let n = self.counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let body = format!("<html><body><h1>Page</h1><p>Call number {n}</p></body></html>");
            Ok(FetchResult {
                url: url.into(),
                final_url: url.into(),
                status: 200,
                kind: ContentKind::Html,
                body: body.into_bytes(),
                headers: Default::default(),
                stealth_level: StealthLevel::L1Headers,
                duration_ms: 1,
            })
        }
    }

    #[tokio::test]
    async fn watch_first_run_then_change() {
        let dir = tempfile::tempdir().unwrap();
        let stub = Arc::new(CounterStub {
            counter: std::sync::atomic::AtomicU32::new(0),
        });
        let tool = WatchTool::new(stub);
        let args = WatchArgs {
            url: "https://example.com/watch-test".to_string(),
            output_dir: dir.path().display().to_string(),
            hash_on: "markdown".to_string(),
            webhook: None,
        };
        let r1 = tool.run_once(&args).await.unwrap();
        assert!(r1.first_run);
        let r2 = tool.run_once(&args).await.unwrap();
        assert!(!r2.first_run);
        assert!(r2.changed);
    }

    #[test]
    fn slugify_normalizes() {
        assert_eq!(slugify("Hello, World!"), "hello-world");
        assert_eq!(slugify("Tech & AI"), "tech-ai");
    }
}
