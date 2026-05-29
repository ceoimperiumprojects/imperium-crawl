//! `readability` tool — extract main article content via Mozilla Readability.
//! Ported from `../../../src/tools/readability.ts`.

use async_trait::async_trait;
use imperium_crawl_core::{
    constants::MAX_URL_LENGTH, normalize_url, CrawlError, Result, Tool, ToolArgs, ToolOutput,
    ToolSchema,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use super::fetcher::{DefaultFetcher, Fetcher};
use super::markdown::html_to_markdown;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadabilityArgs {
    pub url: String,
    #[serde(default = "default_format")]
    pub format: String, // "markdown" | "html" | "text"
}

fn default_format() -> String {
    "markdown".into()
}

impl ReadabilityArgs {
    pub fn validate(&self) -> Result<()> {
        if self.url.is_empty() || self.url.len() > MAX_URL_LENGTH {
            return Err(CrawlError::InvalidArg("url length out of range".into()));
        }
        if !matches!(self.format.as_str(), "markdown" | "html" | "text") {
            return Err(CrawlError::InvalidArg(
                "format must be markdown|html|text".into(),
            ));
        }
        Ok(())
    }
}

pub struct ReadabilityTool {
    pub fetcher: Arc<dyn Fetcher>,
}

impl ReadabilityTool {
    pub fn with_default() -> Result<Self> {
        Ok(Self { fetcher: Arc::new(DefaultFetcher::new()?) })
    }
    pub fn new(fetcher: Arc<dyn Fetcher>) -> Self {
        Self { fetcher }
    }
}

#[async_trait]
impl Tool for ReadabilityTool {
    fn schema(&self) -> ToolSchema {
        ToolSchema {
            name: "readability".into(),
            description:
                "Extract the main article content from a web page using Mozilla's Readability algorithm."
                    .into(),
            input_schema: serde_json::json!({
                "type": "object",
                "required": ["url"],
                "properties": {
                    "url": {"type":"string","maxLength":MAX_URL_LENGTH},
                    "format": {"type":"string","enum":["markdown","html","text"],"default":"markdown"}
                }
            }),
            output_schema: serde_json::json!({"type":"object"}),
            requires_api_key: None,
            requires_browser: false,
        }
    }

    async fn execute(&self, args: ToolArgs) -> Result<ToolOutput> {
        let parsed: ReadabilityArgs = serde_json::from_value(args)
            .map_err(|e| CrawlError::InvalidArg(format!("args: {e}")))?;
        parsed.validate()?;
        let url_str = normalize_url(&parsed.url)?;
        let res = self.fetcher.fetch(&url_str).await?;
        let html = res.body_string_lossy();

        let parsed_url = url::Url::parse(&res.final_url)
            .map_err(|e| CrawlError::Parse(format!("url: {e}")))?;
        let mut cursor = std::io::Cursor::new(html.as_bytes());
        let product = readability::extractor::extract(&mut cursor, &parsed_url)
            .map_err(|e| CrawlError::Parse(format!("readability: {e}")))?;

        let article_content = match parsed.format.as_str() {
            "html" => product.content.clone(),
            "text" => product.text.clone(),
            _ => html_to_markdown(&product.content),
        };

        Ok(ToolOutput::json(serde_json::json!({
            "url": res.final_url,
            "title": product.title,
            "content": article_content,
            "text": product.text,
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

    #[tokio::test]
    async fn readability_extracts_article() {
        let html = r#"
            <html><head><title>An Article</title></head>
            <body>
              <header>nav</header>
              <article>
                <h1>The Title</h1>
                <p>This is a substantive article body with enough text content to clearly be the main content of the page, not navigation or boilerplate. We add many words to ensure the readability algorithm picks this block as primary. The quick brown fox jumps over the lazy dog. Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>
                <p>Another paragraph with more content to give readability enough signal. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.</p>
              </article>
              <footer>fff</footer>
            </body></html>
        "#;
        let stub = Arc::new(StubFetcher { body: html.into() });
        let tool = ReadabilityTool::new(stub);
        let out = tool
            .execute(serde_json::json!({"url":"https://example.com"}))
            .await
            .unwrap();
        let text = out.data["text"].as_str().unwrap();
        assert!(text.contains("substantive article"));
    }
}
