//! Heavy stress tests — verify the toolchain scales under load.
//!
//! Run with: `cargo test -p imperium-crawl-tools --test heavy_stress -- --nocapture`

use imperium_crawl_tools::build_registry;
use serde_json::json;
use std::sync::Arc;
use std::time::Instant;

/// 100 concurrent scrapes of example.com — what the TS port did at v2.6.1.
#[tokio::test]
async fn stress_100_concurrent_scrapes() {
    let registry = Arc::new(build_registry());
    let n = 100usize;
    let mut handles = Vec::with_capacity(n);
    let start = Instant::now();
    for _ in 0..n {
        let r = registry.clone();
        handles.push(tokio::spawn(async move {
            r.execute("scrape", json!({"url":"https://example.com","format":"markdown"}))
                .await
        }));
    }
    let mut ok = 0;
    let mut errors: Vec<String> = Vec::new();
    for h in handles {
        match h.await {
            Ok(Ok(out)) => {
                if out.data["markdown"].as_str().unwrap_or("").contains("Example Domain") {
                    ok += 1;
                } else {
                    errors.push("missing marker".into());
                }
            }
            Ok(Err(e)) => errors.push(e.to_string()),
            Err(je) => errors.push(format!("join: {je}")),
        }
    }
    let elapsed = start.elapsed();
    eprintln!("100 concurrent scrapes: {ok}/{n} OK in {elapsed:?}");
    if !errors.is_empty() {
        eprintln!("first 5 errors: {:?}", &errors[..errors.len().min(5)]);
    }
    // We allow up to 5% of requests to be rate-limited under heavy load.
    assert!(ok >= 95, "expected at least 95/100 successes, got {ok}");
}

/// 50 concurrent extracts — exercises HTML parser concurrency.
#[tokio::test]
async fn stress_50_concurrent_extracts() {
    let registry = Arc::new(build_registry());
    let n = 50usize;
    let mut handles = Vec::with_capacity(n);
    let start = Instant::now();
    for _ in 0..n {
        let r = registry.clone();
        handles.push(tokio::spawn(async move {
            r.execute(
                "extract",
                json!({
                    "url":"https://example.com",
                    "selectors":{"title":"h1","link":"a @href"}
                }),
            )
            .await
        }));
    }
    let mut ok = 0;
    for h in handles {
        if let Ok(Ok(out)) = h.await {
            if out.data["data"]["title"] == "Example Domain" {
                ok += 1;
            }
        }
    }
    let elapsed = start.elapsed();
    eprintln!("50 concurrent extracts: {ok}/{n} OK in {elapsed:?}");
    assert!(ok >= 48, "expected ≥48/50 successes, got {ok}");
}

/// Batch scrape of 50 URLs through one tool call with concurrency 10.
#[tokio::test]
async fn stress_batch_scrape_50_urls() {
    let registry = build_registry();
    let urls: Vec<String> = (0..50).map(|_| "https://example.com".to_string()).collect();
    let start = Instant::now();
    let out = registry
        .execute("batch_scrape", json!({"urls": urls, "concurrency": 10}))
        .await
        .expect("batch_scrape 50");
    let total = out.data["total"].as_u64().unwrap_or(0);
    eprintln!("batch_scrape 50 urls: total={total} in {:?}", start.elapsed());
    assert_eq!(total, 50);
}
