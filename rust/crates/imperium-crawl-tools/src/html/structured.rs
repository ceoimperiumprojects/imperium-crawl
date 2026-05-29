//! Structured data extraction (JSON-LD, OpenGraph, Twitter, meta tags).
//! Equivalent to TS `utils/structured-data.ts`.

use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PageMeta {
    pub title: Option<String>,
    pub description: Option<String>,
    pub canonical: Option<String>,
    pub language: Option<String>,
    pub author: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct StructuredData {
    pub meta: PageMeta,
    /// JSON-LD blobs.
    pub json_ld: Vec<serde_json::Value>,
    /// `og:*` meta tags.
    pub open_graph: HashMap<String, String>,
    /// `twitter:*` meta tags.
    pub twitter: HashMap<String, String>,
    /// MicroData items (limited support).
    pub microdata: Vec<serde_json::Value>,
}

pub fn extract_structured_data(html: &str) -> StructuredData {
    let doc = Html::parse_document(html);
    let mut out = StructuredData::default();

    // Title
    if let Ok(sel) = Selector::parse("title") {
        if let Some(el) = doc.select(&sel).next() {
            let t = el.text().collect::<String>();
            let t = t.trim();
            if !t.is_empty() {
                out.meta.title = Some(t.to_string());
            }
        }
    }

    // Meta tags (description, language, author)
    if let Ok(sel) = Selector::parse("meta") {
        for el in doc.select(&sel) {
            let name = el
                .value()
                .attr("name")
                .or_else(|| el.value().attr("property"))
                .unwrap_or("");
            let content = el.value().attr("content").unwrap_or("");
            if content.is_empty() {
                continue;
            }
            match name.to_ascii_lowercase().as_str() {
                "description" => out.meta.description = Some(content.to_string()),
                "author" => out.meta.author = Some(content.to_string()),
                n if n.starts_with("og:") => {
                    out.open_graph.insert(n[3..].to_string(), content.to_string());
                }
                n if n.starts_with("twitter:") => {
                    out.twitter.insert(n[8..].to_string(), content.to_string());
                }
                _ => {}
            }
        }
    }

    // html lang
    if let Ok(sel) = Selector::parse("html") {
        if let Some(el) = doc.select(&sel).next() {
            if let Some(lang) = el.value().attr("lang") {
                out.meta.language = Some(lang.to_string());
            }
        }
    }

    // Canonical
    if let Ok(sel) = Selector::parse("link[rel=canonical]") {
        if let Some(el) = doc.select(&sel).next() {
            if let Some(href) = el.value().attr("href") {
                out.meta.canonical = Some(href.to_string());
            }
        }
    }

    // JSON-LD
    if let Ok(sel) = Selector::parse(r#"script[type="application/ld+json"]"#) {
        for el in doc.select(&sel) {
            let text = el.text().collect::<String>();
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(text.trim()) {
                out.json_ld.push(v);
            }
        }
    }

    out
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkEntry {
    pub href: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rel: Option<String>,
}

/// Extract anchors with text + href, resolved against `base`.
pub fn extract_links(html: &str, base: &str) -> Vec<LinkEntry> {
    let doc = Html::parse_document(html);
    let mut out = Vec::new();
    let base_url = url::Url::parse(base).ok();
    let sel = match Selector::parse("a[href]") {
        Ok(s) => s,
        Err(_) => return out,
    };
    for el in doc.select(&sel) {
        let href = match el.value().attr("href") {
            Some(h) => h,
            None => continue,
        };
        let resolved = match &base_url {
            Some(b) => b.join(href).map(|u| u.to_string()).unwrap_or_else(|_| href.to_string()),
            None => href.to_string(),
        };
        let text: String = el.text().collect::<String>().trim().to_string();
        let rel = el.value().attr("rel").map(String::from);
        out.push(LinkEntry { href: resolved, text, rel });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_title_and_meta() {
        let html = r#"
            <html lang="en"><head>
            <title>Hello</title>
            <meta name="description" content="A page">
            <meta property="og:title" content="Hello OG">
            <meta name="twitter:card" content="summary">
            <link rel="canonical" href="https://example.com/foo">
            </head><body></body></html>
        "#;
        let sd = extract_structured_data(html);
        assert_eq!(sd.meta.title.as_deref(), Some("Hello"));
        assert_eq!(sd.meta.description.as_deref(), Some("A page"));
        assert_eq!(sd.meta.language.as_deref(), Some("en"));
        assert_eq!(sd.meta.canonical.as_deref(), Some("https://example.com/foo"));
        assert_eq!(sd.open_graph.get("title").map(|s| s.as_str()), Some("Hello OG"));
        assert_eq!(sd.twitter.get("card").map(|s| s.as_str()), Some("summary"));
    }

    #[test]
    fn extracts_jsonld() {
        let html = r#"<html><head><script type="application/ld+json">{"@type":"Article","name":"Foo"}</script></head><body></body></html>"#;
        let sd = extract_structured_data(html);
        assert_eq!(sd.json_ld.len(), 1);
        assert_eq!(sd.json_ld[0]["@type"], "Article");
    }

    #[test]
    fn extracts_links_resolved_against_base() {
        let html = r#"<a href="/foo">Foo</a><a href="https://example.com/bar">Bar</a>"#;
        let links = extract_links(html, "https://example.com/page");
        assert_eq!(links.len(), 2);
        assert_eq!(links[0].href, "https://example.com/foo");
        assert_eq!(links[1].href, "https://example.com/bar");
    }
}
