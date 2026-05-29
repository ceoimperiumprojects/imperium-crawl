//! `scrape` tool — fetch URL and return content in markdown / html / structured / links / metadata.
//! Ported from `../../../src/tools/scrape.ts`.

use async_trait::async_trait;
use imperium_crawl_core::{
    constants::{MAX_TIMEOUT_MS, MAX_URL_LENGTH},
    normalize_url, ContentKind, CrawlError, Result, Tool, ToolArgs, ToolOutput, ToolSchema,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use super::fetcher::{DefaultFetcher, Fetcher};
use super::markdown::html_to_markdown;
use super::structured::{extract_links, extract_structured_data, LinkEntry, PageMeta};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScrapeArgs {
    pub url: String,
    #[serde(default = "default_format")]
    pub format: String, // "markdown" | "html"
    #[serde(default)]
    pub include: Vec<String>, // "markdown" | "html" | "structured_data" | "links" | "metadata"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stealth_level: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proxy: Option<String>,
}

fn default_format() -> String {
    "markdown".to_string()
}

impl ScrapeArgs {
    pub fn validate(&self) -> Result<()> {
        if self.url.is_empty() || self.url.len() > MAX_URL_LENGTH {
            return Err(CrawlError::InvalidArg(format!("url length out of range")));
        }
        if !matches!(self.format.as_str(), "markdown" | "html") {
            return Err(CrawlError::InvalidArg("format must be markdown|html".into()));
        }
        if let Some(t) = self.timeout {
            if t == 0 || t > MAX_TIMEOUT_MS {
                return Err(CrawlError::InvalidArg("timeout out of range".into()));
            }
        }
        Ok(())
    }
}

pub struct ScrapeTool {
    pub fetcher: Arc<dyn Fetcher>,
}

impl ScrapeTool {
    pub fn with_default() -> Result<Self> {
        Ok(Self { fetcher: Arc::new(DefaultFetcher::new()?) })
    }
    pub fn new(fetcher: Arc<dyn Fetcher>) -> Self {
        Self { fetcher }
    }
}

#[async_trait]
impl Tool for ScrapeTool {
    fn schema(&self) -> ToolSchema {
        ToolSchema {
            name: "scrape".into(),
            description:
                "Scrape a URL and return content in multiple formats (markdown, html, structured data, links, metadata)."
                    .into(),
            input_schema: serde_json::json!({
                "type": "object",
                "required": ["url"],
                "properties": {
                    "url": {"type":"string","maxLength":MAX_URL_LENGTH},
                    "format": {"type":"string","enum":["markdown","html"],"default":"markdown"},
                    "include": {"type":"array","items":{"type":"string","enum":["markdown","html","structured_data","links","metadata"]}},
                    "stealth_level": {"type":"integer","minimum":1,"maximum":4},
                    "timeout": {"type":"integer","minimum":1,"maximum":MAX_TIMEOUT_MS},
                    "proxy": {"type":"string"}
                }
            }),
            output_schema: serde_json::json!({"type":"object"}),
            requires_api_key: None,
            requires_browser: false,
        }
    }

    async fn execute(&self, args: ToolArgs) -> Result<ToolOutput> {
        let parsed: ScrapeArgs = serde_json::from_value(args)
            .map_err(|e| CrawlError::InvalidArg(format!("args: {e}")))?;
        parsed.validate()?;
        let url = normalize_url(&parsed.url)?;

        let res = self.fetcher.fetch(&url).await?;
        let html = res.body_string_lossy();

        let include: std::collections::HashSet<String> =
            parsed.include.iter().cloned().collect();
        let primary = parsed.format.clone();

        let mut output = serde_json::Map::new();
        output.insert("url".into(), res.final_url.clone().into());
        output.insert("stealth_level".into(), res.stealth_level.as_str().into());
        output.insert("status".into(), serde_json::json!(res.status));

        let is_json_response = matches!(res.kind, ContentKind::Json);

        // markdown
        if primary == "markdown" || include.contains("markdown") {
            let md = if is_json_response {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&html) {
                    format!("```json\n{}\n```", serde_json::to_string_pretty(&v).unwrap_or_default())
                } else {
                    format!("```\n{}\n```", html)
                }
            } else {
                html_to_markdown(&html)
            };
            output.insert("markdown".into(), md.into());
        }

        if primary == "html" || include.contains("html") {
            output.insert("html".into(), html.clone().into());
        }

        if primary == "markdown" {
            if let Some(md) = output.get("markdown").cloned() {
                output.insert("content".into(), md);
            }
        } else {
            output.insert("content".into(), html.clone().into());
        }

        // structured_data / metadata — compute once on demand
        let need_sd = include.contains("structured_data") || include.contains("metadata");
        let sd_cache: Option<super::structured::StructuredData> =
            if need_sd { Some(extract_structured_data(&html)) } else { None };

        if let Some(sd) = &sd_cache {
            if include.contains("structured_data") {
                output.insert(
                    "structured_data".into(),
                    serde_json::to_value(sd).unwrap_or(serde_json::Value::Null),
                );
            }
        }

        if include.contains("links") {
            let links: Vec<LinkEntry> = extract_links(&html, &res.final_url);
            output.insert(
                "links".into(),
                serde_json::to_value(&links).unwrap_or(serde_json::Value::Null),
            );
        }

        if include.contains("metadata") {
            if let Some(sd) = &sd_cache {
                let meta_out: PageMeta = sd.meta.clone();
                let mut m = serde_json::to_value(&meta_out).unwrap_or_default();
                if let serde_json::Value::Object(ref mut obj) = m {
                    if !sd.open_graph.is_empty() {
                        obj.insert(
                            "openGraph".into(),
                            serde_json::to_value(&sd.open_graph).unwrap_or_default(),
                        );
                    }
                }
                output.insert("metadata".into(), m);
            }
        }

        Ok(ToolOutput::json(serde_json::Value::Object(output))
            .with_duration(res.duration_ms)
            .with_stealth(res.stealth_level.as_str()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct StubFetcher {
        body: String,
        kind: ContentKind,
    }

    #[async_trait]
    impl Fetcher for StubFetcher {
        async fn fetch(&self, url: &str) -> Result<imperium_crawl_core::FetchResult> {
            Ok(imperium_crawl_core::FetchResult {
                url: url.into(),
                final_url: url.into(),
                status: 200,
                kind: self.kind.clone(),
                body: self.body.as_bytes().to_vec(),
                headers: Default::default(),
                stealth_level: imperium_crawl_core::StealthLevel::L1Headers,
                duration_ms: 1,
            })
        }
    }

    #[tokio::test]
    async fn scrape_returns_markdown_by_default() {
        let stub = Arc::new(StubFetcher {
            body: "<html><head><title>T</title></head><body><h1>Hello</h1></body></html>".into(),
            kind: ContentKind::Html,
        });
        let tool = ScrapeTool::new(stub);
        let out = tool
            .execute(serde_json::json!({"url":"https://example.com"}))
            .await
            .unwrap();
        let md = out.data["markdown"].as_str().unwrap();
        assert!(md.contains("Hello"));
        assert_eq!(out.data["status"], 200);
    }

    #[tokio::test]
    async fn scrape_includes_metadata_when_requested() {
        let stub = Arc::new(StubFetcher {
            body: r#"<html lang="en"><head><title>T</title><meta name="description" content="d"></head><body></body></html>"#.into(),
            kind: ContentKind::Html,
        });
        let tool = ScrapeTool::new(stub);
        let out = tool
            .execute(serde_json::json!({
                "url":"https://example.com",
                "include":["metadata"]
            }))
            .await
            .unwrap();
        assert_eq!(out.data["metadata"]["title"], "T");
        assert_eq!(out.data["metadata"]["description"], "d");
        assert_eq!(out.data["metadata"]["language"], "en");
    }

    #[tokio::test]
    async fn scrape_html_format() {
        let stub = Arc::new(StubFetcher {
            body: "<html><body>x</body></html>".into(),
            kind: ContentKind::Html,
        });
        let tool = ScrapeTool::new(stub);
        let out = tool
            .execute(serde_json::json!({"url":"https://example.com","format":"html"}))
            .await
            .unwrap();
        assert!(out.data["html"].as_str().unwrap().contains("body"));
    }
}
