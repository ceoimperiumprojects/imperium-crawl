//! `extract` tool — extract structured data via CSS selectors.
//! Ported from `../../../src/tools/extract.ts`.

use async_trait::async_trait;
use imperium_crawl_core::{
    constants::{MAX_SELECTOR_KEYS, MAX_SELECTOR_LENGTH, MAX_URL_LENGTH},
    normalize_url, CrawlError, Result, Tool, ToolArgs, ToolOutput, ToolSchema,
};
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

use super::fetcher::{DefaultFetcher, Fetcher};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractArgs {
    pub url: String,
    /// Map field-name → CSS selector. Use `selector @attr` syntax to extract attribute instead of text.
    pub selectors: HashMap<String, String>,
    /// CSS selector for repeating items.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub items_selector: Option<String>,
}

impl ExtractArgs {
    pub fn validate(&self) -> Result<()> {
        if self.url.is_empty() || self.url.len() > MAX_URL_LENGTH {
            return Err(CrawlError::InvalidArg("url length out of range".into()));
        }
        if self.selectors.len() > MAX_SELECTOR_KEYS {
            return Err(CrawlError::InvalidArg(format!(
                "too many selectors (max {})",
                MAX_SELECTOR_KEYS
            )));
        }
        for s in self.selectors.values() {
            if s.len() > MAX_SELECTOR_LENGTH {
                return Err(CrawlError::InvalidArg("selector too long".into()));
            }
        }
        Ok(())
    }
}

/// Parse "selector @attr" syntax. Returns (selector, optional attr).
pub(crate) fn split_selector(raw: &str) -> (String, Option<String>) {
    if let Some(idx) = raw.find(" @") {
        let sel = raw[..idx].trim().to_string();
        let attr = raw[idx + 2..].trim().to_string();
        (sel, if attr.is_empty() { None } else { Some(attr) })
    } else {
        (raw.trim().to_string(), None)
    }
}

fn extract_field_doc(doc: &Html, raw: &str) -> String {
    let (selector, attr) = split_selector(raw);
    let parsed = match Selector::parse(&selector) {
        Ok(s) => s,
        Err(_) => return String::new(),
    };
    let el = match doc.select(&parsed).next() {
        Some(e) => e,
        None => return String::new(),
    };
    if let Some(a) = attr {
        el.value().attr(&a).unwrap_or("").to_string()
    } else {
        el.text().collect::<String>().trim().to_string()
    }
}

fn extract_field_in_element(parent: &scraper::ElementRef, raw: &str) -> String {
    let (selector, attr) = split_selector(raw);
    if selector.is_empty() {
        // self-reference
        if let Some(a) = attr {
            return parent.value().attr(&a).unwrap_or("").to_string();
        }
        return parent.text().collect::<String>().trim().to_string();
    }
    let parsed = match Selector::parse(&selector) {
        Ok(s) => s,
        Err(_) => return String::new(),
    };
    let el = match parent.select(&parsed).next() {
        Some(e) => e,
        None => return String::new(),
    };
    if let Some(a) = attr {
        el.value().attr(&a).unwrap_or("").to_string()
    } else {
        el.text().collect::<String>().trim().to_string()
    }
}

pub struct ExtractTool {
    pub fetcher: Arc<dyn Fetcher>,
}

impl ExtractTool {
    pub fn with_default() -> Result<Self> {
        Ok(Self { fetcher: Arc::new(DefaultFetcher::new()?) })
    }
    pub fn new(fetcher: Arc<dyn Fetcher>) -> Self {
        Self { fetcher }
    }
}

#[async_trait]
impl Tool for ExtractTool {
    fn schema(&self) -> ToolSchema {
        ToolSchema {
            name: "extract".into(),
            description: "Extract structured data from a web page using CSS selectors. Use 'selector @attr' to extract attributes.".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "required": ["url","selectors"],
                "properties": {
                    "url": {"type":"string","maxLength":MAX_URL_LENGTH},
                    "selectors": {"type":"object","additionalProperties":{"type":"string"}},
                    "items_selector": {"type":"string"}
                }
            }),
            output_schema: serde_json::json!({"type":"object"}),
            requires_api_key: None,
            requires_browser: false,
        }
    }

    async fn execute(&self, args: ToolArgs) -> Result<ToolOutput> {
        let parsed: ExtractArgs = serde_json::from_value(args)
            .map_err(|e| CrawlError::InvalidArg(format!("args: {e}")))?;
        parsed.validate()?;
        let url = normalize_url(&parsed.url)?;
        let res = self.fetcher.fetch(&url).await?;
        let html = res.body_string_lossy();
        let doc = Html::parse_document(&html);

        if let Some(items_sel_raw) = &parsed.items_selector {
            let items_sel = Selector::parse(items_sel_raw)
                .map_err(|e| CrawlError::InvalidArg(format!("items_selector: {e}")))?;
            let mut items: Vec<serde_json::Value> = Vec::new();
            for parent in doc.select(&items_sel) {
                let mut obj = serde_json::Map::new();
                for (field, sel) in &parsed.selectors {
                    let v = extract_field_in_element(&parent, sel);
                    obj.insert(field.clone(), serde_json::Value::String(v));
                }
                items.push(serde_json::Value::Object(obj));
            }
            return Ok(ToolOutput::json(serde_json::json!({
                "url": res.final_url,
                "items_count": items.len(),
                "items": items,
            }))
            .with_duration(res.duration_ms));
        }

        let mut data = serde_json::Map::new();
        for (field, sel) in &parsed.selectors {
            data.insert(field.clone(), serde_json::Value::String(extract_field_doc(&doc, sel)));
        }
        Ok(ToolOutput::json(serde_json::json!({
            "url": res.final_url,
            "data": data,
        }))
        .with_duration(res.duration_ms))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use imperium_crawl_core::{ContentKind, FetchResult, StealthLevel};

    struct StubFetcher {
        body: String,
    }
    #[async_trait]
    impl Fetcher for StubFetcher {
        async fn fetch(&self, url: &str) -> Result<FetchResult> {
            Ok(FetchResult {
                url: url.into(),
                final_url: url.into(),
                status: 200,
                kind: ContentKind::Html,
                body: self.body.as_bytes().to_vec(),
                headers: Default::default(),
                stealth_level: StealthLevel::L1Headers,
                duration_ms: 1,
            })
        }
    }

    #[test]
    fn split_selector_handles_attr() {
        assert_eq!(split_selector("a @href"), ("a".to_string(), Some("href".to_string())));
        assert_eq!(split_selector("h1"), ("h1".to_string(), None));
    }

    #[tokio::test]
    async fn extracts_single_text() {
        let stub = Arc::new(StubFetcher { body: "<h1>Hello</h1><p>World</p>".into() });
        let tool = ExtractTool::new(stub);
        let mut sels = HashMap::new();
        sels.insert("title".to_string(), "h1".to_string());
        sels.insert("body".to_string(), "p".to_string());
        let args = serde_json::json!({
            "url":"https://example.com",
            "selectors": sels,
        });
        let out = tool.execute(args).await.unwrap();
        assert_eq!(out.data["data"]["title"], "Hello");
        assert_eq!(out.data["data"]["body"], "World");
    }

    #[tokio::test]
    async fn extracts_attribute() {
        let stub = Arc::new(StubFetcher {
            body: r#"<a href="https://example.com/x">click</a>"#.into(),
        });
        let tool = ExtractTool::new(stub);
        let mut sels = HashMap::new();
        sels.insert("link".to_string(), "a @href".to_string());
        let out = tool
            .execute(serde_json::json!({
                "url":"https://example.com",
                "selectors": sels
            }))
            .await
            .unwrap();
        assert_eq!(out.data["data"]["link"], "https://example.com/x");
    }

    #[tokio::test]
    async fn extracts_items() {
        let stub = Arc::new(StubFetcher {
            body: r#"
                <ul>
                    <li><span class="n">A</span><span class="v">1</span></li>
                    <li><span class="n">B</span><span class="v">2</span></li>
                </ul>
            "#
            .into(),
        });
        let tool = ExtractTool::new(stub);
        let mut sels = HashMap::new();
        sels.insert("name".to_string(), ".n".to_string());
        sels.insert("val".to_string(), ".v".to_string());
        let out = tool
            .execute(serde_json::json!({
                "url":"https://example.com",
                "selectors": sels,
                "items_selector":"li"
            }))
            .await
            .unwrap();
        assert_eq!(out.data["items_count"], 2);
        assert_eq!(out.data["items"][0]["name"], "A");
        assert_eq!(out.data["items"][1]["val"], "2");
    }
}
