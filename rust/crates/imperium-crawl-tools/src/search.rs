//! Sprint 6 — Brave Search API tools: search, news_search, image_search, video_search.
//!
//! Ported from:
//! - `../../../src/tools/search.ts`
//! - `../../../src/tools/news-search.ts`
//! - `../../../src/tools/image-search.ts`
//! - `../../../src/tools/video-search.ts`
//! - `../../../src/brave-api/index.ts`
//!
//! Auth: `X-Subscription-Token: <BRAVE_API_KEY>` header. API base from
//! `imperium_crawl_core::constants::BRAVE_API_BASE`.

use async_trait::async_trait;
use imperium_crawl_core::{
    constants::{BRAVE_API_BASE, MAX_QUERY_LENGTH},
    CrawlError, Result, Tool, ToolArgs, ToolOutput, ToolSchema,
};
use serde::{Deserialize, Serialize};
use std::time::Duration;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

/// Shared Brave Search API client.
#[derive(Debug, Clone)]
pub struct BraveClient {
    api_key: String,
    http: reqwest::Client,
}

impl BraveClient {
    pub fn new(api_key: impl Into<String>) -> Result<Self> {
        let http = reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .gzip(true)
            .build()
            .map_err(|e| CrawlError::Other(format!("reqwest build: {e}")))?;
        Ok(Self {
            api_key: api_key.into(),
            http,
        })
    }

    pub fn from_env() -> Result<Self> {
        let key = std::env::var("BRAVE_API_KEY").map_err(|_| {
            CrawlError::MissingApiKey("BRAVE_API_KEY env var not set".into())
        })?;
        if key.trim().is_empty() {
            return Err(CrawlError::MissingApiKey("BRAVE_API_KEY is empty".into()));
        }
        Self::new(key)
    }

    /// Issue a GET to `endpoint` (e.g. "/web/search") with query params.
    pub async fn issue_request(
        &self,
        endpoint: &str,
        params: &[(&str, String)],
    ) -> Result<serde_json::Value> {
        let url = format!("{BRAVE_API_BASE}{endpoint}");
        let res = self
            .http
            .get(&url)
            .header("Accept", "application/json")
            .header("Accept-Encoding", "gzip")
            .header("X-Subscription-Token", &self.api_key)
            .query(params)
            .send()
            .await
            .map_err(|e| CrawlError::Network(format!("Brave GET {endpoint}: {e}")))?;
        let status = res.status();
        if !status.is_success() {
            let text = res.text().await.unwrap_or_else(|_| "<no body>".into());
            return Err(CrawlError::Http {
                status: status.as_u16(),
                message: format!("Brave API {status}: {text}"),
            });
        }
        let body: serde_json::Value = res
            .json()
            .await
            .map_err(|e| CrawlError::Parse(format!("Brave JSON: {e}")))?;
        Ok(body)
    }
}

/// Common search query parameters.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchArgs {
    pub query: String,
    #[serde(default = "default_count")]
    pub count: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub country: Option<String>,
    /// "pd" past day, "pw" past week, "pm" past month, "py" past year.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub freshness: Option<String>,
}

fn default_count() -> u32 {
    10
}

impl SearchArgs {
    fn validate(&self) -> Result<()> {
        if self.query.trim().is_empty() {
            return Err(CrawlError::InvalidArg("query must not be empty".into()));
        }
        if self.query.len() > MAX_QUERY_LENGTH {
            return Err(CrawlError::InvalidArg(format!(
                "query exceeds MAX_QUERY_LENGTH ({})",
                MAX_QUERY_LENGTH
            )));
        }
        if self.count == 0 || self.count > 20 {
            return Err(CrawlError::InvalidArg(format!(
                "count must be 1..=20, got {}",
                self.count
            )));
        }
        if let Some(f) = &self.freshness {
            if !matches!(f.as_str(), "pd" | "pw" | "pm" | "py") {
                return Err(CrawlError::InvalidArg(format!(
                    "freshness must be pd|pw|pm|py, got {f}"
                )));
            }
        }
        Ok(())
    }

    fn to_params(&self) -> Vec<(&'static str, String)> {
        let mut out: Vec<(&'static str, String)> = vec![
            ("q", self.query.clone()),
            ("count", self.count.to_string()),
        ];
        if let Some(c) = &self.country {
            out.push(("country", c.clone()));
        }
        if let Some(f) = &self.freshness {
            out.push(("freshness", f.clone()));
        }
        out
    }
}

fn parse_args(args: ToolArgs) -> Result<SearchArgs> {
    serde_json::from_value(args).map_err(|e| CrawlError::InvalidArg(format!("args: {e}")))
}

fn input_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "required": ["query"],
        "properties": {
            "query": {"type": "string", "minLength": 1, "maxLength": MAX_QUERY_LENGTH},
            "count": {"type": "integer", "minimum": 1, "maximum": 20, "default": 10},
            "country": {"type": "string", "maxLength": 10},
            "freshness": {"type": "string", "enum": ["pd","pw","pm","py"]},
        }
    })
}

fn output_schema() -> serde_json::Value {
    serde_json::json!({ "type": "object" })
}

// ── Web search ──

pub struct SearchTool {
    pub client: BraveClient,
}

impl SearchTool {
    pub fn from_env() -> Result<Self> {
        Ok(Self { client: BraveClient::from_env()? })
    }
}

#[async_trait]
impl Tool for SearchTool {
    fn schema(&self) -> ToolSchema {
        ToolSchema {
            name: "search".into(),
            description: "Web search via the Brave Search API. Requires BRAVE_API_KEY."
                .into(),
            input_schema: input_schema(),
            output_schema: output_schema(),
            requires_api_key: Some("BRAVE_API_KEY".into()),
            requires_browser: false,
        }
    }
    async fn execute(&self, args: ToolArgs) -> Result<ToolOutput> {
        let parsed = parse_args(args)?;
        parsed.validate()?;
        let data = self.client.issue_request("/web/search", &parsed.to_params()).await?;
        Ok(ToolOutput::json(data))
    }
}

// ── News search ──

pub struct NewsSearchTool {
    pub client: BraveClient,
}

impl NewsSearchTool {
    pub fn from_env() -> Result<Self> {
        Ok(Self { client: BraveClient::from_env()? })
    }
}

#[async_trait]
impl Tool for NewsSearchTool {
    fn schema(&self) -> ToolSchema {
        ToolSchema {
            name: "news_search".into(),
            description: "News search via the Brave Search API. Requires BRAVE_API_KEY.".into(),
            input_schema: input_schema(),
            output_schema: output_schema(),
            requires_api_key: Some("BRAVE_API_KEY".into()),
            requires_browser: false,
        }
    }
    async fn execute(&self, args: ToolArgs) -> Result<ToolOutput> {
        let parsed = parse_args(args)?;
        parsed.validate()?;
        let data = self.client.issue_request("/news/search", &parsed.to_params()).await?;
        Ok(ToolOutput::json(data))
    }
}

// ── Image search ──

pub struct ImageSearchTool {
    pub client: BraveClient,
}

impl ImageSearchTool {
    pub fn from_env() -> Result<Self> {
        Ok(Self { client: BraveClient::from_env()? })
    }
}

#[async_trait]
impl Tool for ImageSearchTool {
    fn schema(&self) -> ToolSchema {
        ToolSchema {
            name: "image_search".into(),
            description: "Image search via the Brave Search API. Requires BRAVE_API_KEY.".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "required": ["query"],
                "properties": {
                    "query": {"type":"string","minLength":1,"maxLength":MAX_QUERY_LENGTH},
                    "count": {"type":"integer","minimum":1,"maximum":20,"default":10},
                    "country": {"type":"string","maxLength":10}
                }
            }),
            output_schema: output_schema(),
            requires_api_key: Some("BRAVE_API_KEY".into()),
            requires_browser: false,
        }
    }
    async fn execute(&self, args: ToolArgs) -> Result<ToolOutput> {
        let parsed = parse_args(args)?;
        parsed.validate()?;
        // image search ignores freshness
        let mut params = parsed.to_params();
        params.retain(|(k, _)| *k != "freshness");
        let data = self.client.issue_request("/images/search", &params).await?;
        Ok(ToolOutput::json(data))
    }
}

// ── Video search ──

pub struct VideoSearchTool {
    pub client: BraveClient,
}

impl VideoSearchTool {
    pub fn from_env() -> Result<Self> {
        Ok(Self { client: BraveClient::from_env()? })
    }
}

#[async_trait]
impl Tool for VideoSearchTool {
    fn schema(&self) -> ToolSchema {
        ToolSchema {
            name: "video_search".into(),
            description: "Video search via the Brave Search API. Requires BRAVE_API_KEY.".into(),
            input_schema: input_schema(),
            output_schema: output_schema(),
            requires_api_key: Some("BRAVE_API_KEY".into()),
            requires_browser: false,
        }
    }
    async fn execute(&self, args: ToolArgs) -> Result<ToolOutput> {
        let parsed = parse_args(args)?;
        parsed.validate()?;
        let data = self.client.issue_request("/videos/search", &parsed.to_params()).await?;
        Ok(ToolOutput::json(data))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_rejects_empty_query() {
        let a = SearchArgs { query: "".into(), count: 10, country: None, freshness: None };
        assert!(a.validate().is_err());
    }

    #[test]
    fn validate_rejects_count_out_of_range() {
        let a = SearchArgs { query: "rust".into(), count: 0, country: None, freshness: None };
        assert!(a.validate().is_err());
        let b = SearchArgs { query: "rust".into(), count: 21, country: None, freshness: None };
        assert!(b.validate().is_err());
    }

    #[test]
    fn validate_rejects_bad_freshness() {
        let a = SearchArgs {
            query: "rust".into(),
            count: 10,
            country: None,
            freshness: Some("nope".into()),
        };
        assert!(a.validate().is_err());
    }

    #[test]
    fn validate_accepts_valid() {
        let a = SearchArgs {
            query: "rust async".into(),
            count: 5,
            country: Some("US".into()),
            freshness: Some("pw".into()),
        };
        assert!(a.validate().is_ok());
    }

    #[test]
    fn schemas_have_correct_names() {
        let client = BraveClient::new("dummy").unwrap();
        let s = SearchTool { client: client.clone() }.schema();
        assert_eq!(s.name, "search");
        assert_eq!(s.requires_api_key.as_deref(), Some("BRAVE_API_KEY"));
        let n = NewsSearchTool { client: client.clone() }.schema();
        assert_eq!(n.name, "news_search");
        let i = ImageSearchTool { client: client.clone() }.schema();
        assert_eq!(i.name, "image_search");
        let v = VideoSearchTool { client }.schema();
        assert_eq!(v.name, "video_search");
    }

    #[tokio::test]
    async fn missing_api_key_returns_error() {
        let saved = std::env::var("BRAVE_API_KEY").ok();
        std::env::remove_var("BRAVE_API_KEY");
        let r = BraveClient::from_env();
        assert!(r.is_err());
        if let Some(v) = saved {
            std::env::set_var("BRAVE_API_KEY", v);
        }
    }
}
