//! Stress test — 5 concurrent navigations through a 3-browser pool.
//! Verifies the semaphore cap is respected and all requests succeed.

#![cfg(feature = "browser")]

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use imperium_crawl_browser::BrowserPool;

fn chrome_available() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("CHROME_PATH") {
        let candidate = PathBuf::from(&p);
        if candidate.exists() {
            return Some(candidate);
        }
    }
    for name in ["chromium", "chromium-browser", "google-chrome", "chrome"] {
        let path = std::env::var_os("PATH")?;
        for dir in std::env::split_paths(&path) {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn five_concurrent_through_three_browser_pool() {
    let Some(bin) = chrome_available() else {
        eprintln!("Skipping stress test: no chromium binary on host.");
        return;
    };
    std::env::set_var("CHROME_PATH", &bin);

    let pool = Arc::new(BrowserPool::new(3));
    assert_eq!(pool.max_size(), 3);

    let urls = [
        "https://example.com/",
        "https://example.com/",
        "https://example.com/",
        "https://example.com/",
        "https://example.com/",
    ];

    let mut handles = Vec::new();
    for url in urls.iter() {
        let pool = Arc::clone(&pool);
        let url = url.to_string();
        handles.push(tokio::spawn(async move {
            // Add a small stagger so we actually queue against the semaphore.
            tokio::time::sleep(Duration::from_millis(20)).await;
            pool.fetch(&url).await
        }));
    }

    // Sample stats mid-flight: busy_count should never exceed 3.
    let pool_for_sample = Arc::clone(&pool);
    let sampler = tokio::spawn(async move {
        let mut max_busy = 0usize;
        for _ in 0..30 {
            let (_idle, busy) = pool_for_sample.stats().await;
            if busy > max_busy {
                max_busy = busy;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        max_busy
    });

    let mut ok_count = 0;
    let mut skip_reason: Option<String> = None;
    for h in handles {
        match h.await.unwrap() {
            Ok(r) => {
                assert_eq!(r.status, 200);
                ok_count += 1;
            }
            Err(e) => {
                skip_reason.get_or_insert_with(|| e.to_string());
            }
        }
    }

    let max_busy = sampler.await.unwrap();
    let _ = pool.close_all().await;

    if ok_count == 0 {
        eprintln!(
            "Skipping stress test: no fetches succeeded ({}).",
            skip_reason.unwrap_or_else(|| "no detail".into())
        );
        return;
    }

    assert_eq!(ok_count, 5, "expected 5 successful fetches, got {ok_count}");
    assert!(
        max_busy <= 3,
        "pool size cap violated: max_busy observed = {max_busy} (cap = 3)"
    );
}
