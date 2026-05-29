//! Stress test: 50 concurrent L2 fetches of example.com — all must succeed.
//!
//! This is a real-world stress check (hits the network). It validates that
//! `TlsClient` is safe to share across many in-flight tokio tasks (wreq's
//! Client is internally Arc'd, so cloning is cheap).

use std::sync::Arc;
use std::time::{Duration, Instant};

use futures::future::join_all;
use imperium_crawl_core::StealthLevel;
use imperium_crawl_stealth::TlsClient;

const CONCURRENCY: usize = 50;
const URL: &str = "https://example.com/";

#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
async fn fifty_concurrent_l2_fetches_all_succeed() {
    let client = Arc::new(TlsClient::new().expect("TlsClient builds"));
    let start = Instant::now();

    let tasks: Vec<_> = (0..CONCURRENCY)
        .map(|i| {
            let client = Arc::clone(&client);
            tokio::spawn(async move {
                let res = client
                    .fetch_with_timeout(URL, Duration::from_secs(30))
                    .await;
                (i, res)
            })
        })
        .collect();

    let outcomes = join_all(tasks).await;

    let mut successes = 0usize;
    let mut failures: Vec<String> = Vec::new();

    for outcome in outcomes {
        let (i, res) = outcome.expect("tokio task panicked");
        match res {
            Ok(fetch) => {
                if fetch.status == 200
                    && fetch.stealth_level == StealthLevel::L2Tls
                    && String::from_utf8_lossy(&fetch.body).contains("Example Domain")
                {
                    successes += 1;
                } else {
                    failures.push(format!(
                        "task {i}: status={} body_len={}",
                        fetch.status,
                        fetch.body.len()
                    ));
                }
            }
            Err(e) => failures.push(format!("task {i}: {e}")),
        }
    }

    let elapsed = start.elapsed();
    eprintln!(
        "stress: {successes}/{CONCURRENCY} OK in {:.2}s",
        elapsed.as_secs_f64()
    );

    assert_eq!(
        successes, CONCURRENCY,
        "all {CONCURRENCY} concurrent L2 fetches must succeed; failures: {:#?}",
        failures
    );
}
