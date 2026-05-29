//! `map` tool — discover URLs on a website via sitemap.xml + link harvesting.
//! Ported from `../../../src/tools/map.ts`.

use async_trait::async_trait;
use imperium_crawl_core::{
    constants::{MAX_URL_LENGTH, MAX_URLS},
    normalize_url, CrawlError, Result, Tool, ToolArgs, ToolOutput, ToolSchema,
};
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Arc;

use super::fetcher::{DefaultFetcher, Fetcher};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapArgs {
    pub url: String,
    #[serde(default = "default_max_urls")]
    pub max_urls: usize,
    #[serde(default = "default_true")]
    pub include_sitemap: bool,
}

fn default_max_urls() -> usize {
    100
}
fn default_true() -> bool {
    true
}

impl MapArgs {
    pub fn validate(&self) -> Result<()> {
        if self.url.is_empty() || self.url.len() > MAX_URL_LENGTH {
            return Err(CrawlError::InvalidArg("url length out of range".into()));
        }
        if self.max_urls == 0 || self.max_urls > MAX_URLS {
            return Err(CrawlError::InvalidArg(format!(
                "max_urls must be 1..={}",
                MAX_URLS
            )));
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

async fn parse_sitemap(
    fetcher: &dyn Fetcher,
    sitemap_url: &str,
) -> Result<Vec<String>> {
    let res = fetcher.fetch(sitemap_url).await?;
    if !res.is_success() {
        return Ok(Vec::new());
    }
    let body = res.body_string_lossy();
    // Use scraper with xml-like selectors. scraper's html5ever-based parser
    // handles XML well enough for sitemap.xml.
    let doc = Html::parse_document(&body);
    let mut urls = Vec::new();
    if let Ok(sel) = Selector::parse("url > loc, sitemap > loc, loc") {
        for el in doc.select(&sel) {
            let t = el.text().collect::<String>().trim().to_string();
            if !t.is_empty() {
                urls.push(t);
            }
        }
    }
    Ok(urls)
}

pub struct MapTool {
    pub fetcher: Arc<dyn Fetcher>,
}

impl MapTool {
    pub fn with_default() -> Result<Self> {
        Ok(Self { fetcher: Arc::new(DefaultFetcher::new()?) })
    }
    pub fn new(fetcher: Arc<dyn Fetcher>) -> Self {
        Self { fetcher }
    }
}

#[async_trait]
impl Tool for MapTool {
    fn schema(&self) -> ToolSchema {
        ToolSchema {
            name: "map".into(),
            description: "Discover URLs on a website via sitemap.xml + link harvesting.".into(),
            input_schema: serde_json::json!({
                "type":"object",
                "required":["url"],
                "properties": {
                    "url": {"type":"string","maxLength":MAX_URL_LENGTH},
                    "max_urls": {"type":"integer","minimum":1,"maximum":MAX_URLS,"default":100},
                    "include_sitemap": {"type":"boolean","default":true}
                }
            }),
            output_schema: serde_json::json!({"type":"object"}),
            requires_api_key: None,
            requires_browser: false,
        }
    }

    async fn execute(&self, args: ToolArgs) -> Result<ToolOutput> {
        let parsed: MapArgs = serde_json::from_value(args)
            .map_err(|e| CrawlError::InvalidArg(format!("args: {e}")))?;
        parsed.validate()?;
        let base = normalize_url(&parsed.url)?;
        let base_url = url::Url::parse(&base).map_err(CrawlError::from)?;
        let mut discovered: HashSet<String> = HashSet::new();

        if parsed.include_sitemap {
            let default_sitemap = format!("{}://{}/sitemap.xml", base_url.scheme(), base_url.host_str().unwrap_or(""));
            let _ = self.process_sitemap(&default_sitemap, &mut discovered, parsed.max_urls).await;
        }

        // crawl page links
        if discovered.len() < parsed.max_urls {
            if let Ok(res) = self.fetcher.fetch(&base).await {
                let html = res.body_string_lossy();
                let doc = Html::parse_document(&html);
                if let Ok(sel) = Selector::parse("a[href]") {
                    for el in doc.select(&sel) {
                        if discovered.len() >= parsed.max_urls {
                            break;
                        }
                        let href = match el.value().attr("href") {
                            Some(h) => h,
                            None => continue,
                        };
                        let abs = match base_url.join(href) {
                            Ok(u) => u.to_string(),
                            Err(_) => continue,
                        };
                        let abs = match normalize_url(&abs) {
                            Ok(u) => u,
                            Err(_) => continue,
                        };
                        if is_same_origin(&base, &abs) {
                            discovered.insert(abs);
                        }
                    }
                }
            }
        }

        let urls: Vec<String> = discovered.into_iter().collect();
        Ok(ToolOutput::json(serde_json::json!({
            "total_urls": urls.len(),
            "urls": urls,
        })))
    }
}

impl MapTool {
    async fn process_sitemap(
        &self,
        sitemap_url: &str,
        discovered: &mut HashSet<String>,
        max_urls: usize,
    ) -> Result<()> {
        let urls = parse_sitemap(self.fetcher.as_ref(), sitemap_url).await?;
        for u in urls {
            if discovered.len() >= max_urls {
                break;
            }
            // recursive sitemap index?
            if u.ends_with(".xml") && discovered.len() + 1 < max_urls {
                let _ = Box::pin(self.process_sitemap(&u, discovered, max_urls)).await;
            } else {
                discovered.insert(u);
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use imperium_crawl_core::{ContentKind, FetchResult, StealthLevel};

    struct StubFetcher {
        responses: std::collections::HashMap<String, (String, ContentKind)>,
    }
    #[async_trait]
    impl Fetcher for StubFetcher {
        async fn fetch(&self, url: &str) -> Result<FetchResult> {
            let (body, kind) = self
                .responses
                .get(url)
                .cloned()
                .unwrap_or_else(|| ("".to_string(), ContentKind::Html));
            Ok(FetchResult {
                url: url.into(),
                final_url: url.into(),
                status: if body.is_empty() { 404 } else { 200 },
                kind,
                body: body.into_bytes(),
                headers: Default::default(),
                stealth_level: StealthLevel::L1Headers,
                duration_ms: 1,
            })
        }
    }

    #[test]
    fn same_origin_check() {
        assert!(is_same_origin(
            "https://example.com/a",
            "https://example.com/b"
        ));
        assert!(!is_same_origin(
            "https://example.com/a",
            "https://other.com/a"
        ));
    }

    #[tokio::test]
    async fn map_collects_sitemap_and_links() {
        let mut responses = std::collections::HashMap::new();
        responses.insert(
            "https://example.com/sitemap.xml".to_string(),
            (
                r#"<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
                    <url><loc>https://example.com/a</loc></url>
                    <url><loc>https://example.com/b</loc></url>
                </urlset>"#
                    .to_string(),
                ContentKind::Other("application/xml".to_string()),
            ),
        );
        responses.insert(
            "https://example.com/".to_string(),
            (
                r#"<html><body>
                    <a href="/c">c</a>
                    <a href="https://example.com/d">d</a>
                    <a href="https://other.com/e">other</a>
                </body></html>"#
                    .to_string(),
                ContentKind::Html,
            ),
        );
        let stub = Arc::new(StubFetcher { responses });
        let tool = MapTool::new(stub);
        let out = tool
            .execute(serde_json::json!({"url":"https://example.com/"}))
            .await
            .unwrap();
        let urls = out.data["urls"].as_array().unwrap();
        let strs: Vec<&str> = urls.iter().filter_map(|v| v.as_str()).collect();
        // sitemap entries present
        assert!(strs.iter().any(|u| u.contains("/a")));
        assert!(strs.iter().any(|u| u.contains("/b")));
        // off-origin not included
        assert!(!strs.iter().any(|u| u.contains("other.com")));
    }
}
