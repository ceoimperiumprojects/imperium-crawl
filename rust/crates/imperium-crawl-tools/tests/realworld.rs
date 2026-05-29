//! Real-world end-to-end + stress tests for `imperium-crawl-tools`.
//!
//! These tests hit the live network. They are NOT `#[ignore]`'d — Pavle
//! explicitly demanded real-world tests, not smoke tests. If your network is
//! down, expect them to fail.

use imperium_crawl_tools::build_registry;
use serde_json::json;
use std::sync::Arc;
use std::time::Instant;

#[tokio::test]
async fn scrape_example_com_returns_markdown() {
    let registry = build_registry();
    let out = registry
        .execute("scrape", json!({"url":"https://example.com","format":"markdown"}))
        .await
        .expect("scrape works against example.com");
    let md = out.data["markdown"].as_str().unwrap_or_default();
    assert!(md.contains("Example Domain"), "missing 'Example Domain' in: {md}");
}

#[tokio::test]
async fn extract_example_com_h1() {
    let registry = build_registry();
    let out = registry
        .execute(
            "extract",
            json!({
                "url":"https://example.com",
                "selectors": {"title": "h1"}
            }),
        )
        .await
        .expect("extract on example.com");
    assert_eq!(out.data["data"]["title"], "Example Domain");
}

#[tokio::test]
async fn readability_example_com() {
    let registry = build_registry();
    let out = registry
        .execute(
            "readability",
            json!({"url":"https://example.com","format":"text"}),
        )
        .await
        .expect("readability on example.com");
    let title = out.data["title"].as_str().unwrap_or("");
    assert!(!title.is_empty());
}

#[tokio::test]
async fn rss_hackernews_returns_items() {
    let registry = build_registry();
    let out = registry
        .execute("rss", json!({"url":"https://hnrss.org/frontpage","limit":5}))
        .await
        .expect("rss against hnrss");
    let count = out.data["items_count"].as_u64().unwrap_or(0);
    assert!(count > 0, "HN feed should have at least one item; got {count}");
}

#[tokio::test]
async fn map_example_com_finds_links() {
    let registry = build_registry();
    let out = registry
        .execute("map", json!({"url":"https://example.com","max_urls":10,"include_sitemap":false}))
        .await
        .expect("map against example.com");
    // example.com has 1 outbound link (iana.org) — we only return same-origin,
    // so the page may have 0 entries plus whatever sitemap returns. Just sanity
    // check the schema.
    assert!(out.data["urls"].is_array());
}

/// Stress test: 25 concurrent scrapes against example.com.
#[tokio::test]
async fn stress_25_concurrent_scrapes() {
    let registry = Arc::new(build_registry());
    let mut handles = Vec::with_capacity(25);
    let start = Instant::now();
    for _ in 0..25 {
        let r = registry.clone();
        handles.push(tokio::spawn(async move {
            r.execute("scrape", json!({"url":"https://example.com","format":"markdown"}))
                .await
        }));
    }
    let mut ok = 0;
    for h in handles {
        if let Ok(Ok(out)) = h.await {
            let md = out.data["markdown"].as_str().unwrap_or_default();
            if md.contains("Example Domain") {
                ok += 1;
            }
        }
    }
    let elapsed = start.elapsed();
    eprintln!("stress: {ok}/25 succeeded in {elapsed:?}");
    assert!(ok >= 23, "expected at least 23/25 successes (got {ok})");
}

/// Stress test: batch_scrape with 10 concurrent URLs through one tool call.
#[tokio::test]
async fn stress_batch_scrape_10_urls() {
    let registry = build_registry();
    let urls: Vec<String> = (0..10).map(|_| "https://example.com".to_string()).collect();
    let start = Instant::now();
    let out = registry
        .execute("batch_scrape", json!({"urls": urls, "concurrency": 5}))
        .await
        .expect("batch_scrape");
    let total = out.data["total"].as_u64().unwrap_or(0);
    eprintln!("batch_scrape: total={total} in {:?}", start.elapsed());
    assert_eq!(total, 10);
}

/// End-to-end pipeline: scrape → extract → readability on a content-rich site.
#[tokio::test]
async fn pipeline_scrape_extract_readability() {
    let registry = build_registry();

    // 1) scrape with metadata
    let scrape_out = registry
        .execute(
            "scrape",
            json!({"url":"https://example.com","include":["metadata","structured_data"]}),
        )
        .await
        .expect("scrape step");
    assert!(scrape_out.data["url"].as_str().unwrap_or("").contains("example.com"));

    // 2) extract title via selector
    let extract_out = registry
        .execute(
            "extract",
            json!({"url":"https://example.com","selectors":{"title":"h1","link":"a @href"}}),
        )
        .await
        .expect("extract step");
    assert_eq!(extract_out.data["data"]["title"], "Example Domain");
    assert!(extract_out.data["data"]["link"]
        .as_str()
        .unwrap_or("")
        .contains("iana.org"));

    // 3) readability summarisation
    let read_out = registry
        .execute(
            "readability",
            json!({"url":"https://example.com","format":"text"}),
        )
        .await
        .expect("readability step");
    assert!(read_out.data["text"].is_string());
}
