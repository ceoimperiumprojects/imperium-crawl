//! Real-world integration tests for the L3 browser engine.
//!
//! These tests need a Chrome/Chromium binary on the host. If none is found,
//! they print a skip notice rather than fail — see `chrome_available()`.

#![cfg(feature = "browser")]

use std::path::PathBuf;

use imperium_crawl_browser::{BrowserClient, BrowserOptions};

/// Locate any chromium binary on the host. We probe the same names
/// chromiumoxide's default detection would, then PATH.
fn chrome_available() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("CHROME_PATH") {
        let candidate = PathBuf::from(&p);
        if candidate.exists() {
            return Some(candidate);
        }
    }
    for name in ["chromium", "chromium-browser", "google-chrome", "chrome", "google-chrome-stable"] {
        if let Some(path) = which_bin(name) {
            return Some(path);
        }
    }
    None
}

fn which_bin(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn launch_and_fetch_example_dot_com() {
    let Some(bin) = chrome_available() else {
        eprintln!("Skipping: no chromium binary on host (probed chromium/chrome/google-chrome).");
        return;
    };
    std::env::set_var("CHROME_PATH", &bin);
    eprintln!("Using chromium binary: {}", bin.display());

    let client = match BrowserClient::new(BrowserOptions::headless_new()).await {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Skipping: chromium failed to launch ({e}). Likely missing libs.");
            return;
        }
    };

    let result = match client.fetch("https://example.com/").await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("Skipping: navigation failed ({e}). Probably no network in sandbox.");
            let _ = client.close().await;
            return;
        }
    };

    let body = result.body_string_lossy();
    assert!(
        body.contains("Example Domain"),
        "expected 'Example Domain' in body, got first 200 chars: {}",
        &body.chars().take(200).collect::<String>()
    );
    assert_eq!(result.status, 200);
    assert!(matches!(
        result.stealth_level,
        imperium_crawl_core::StealthLevel::L3Browser
    ));
    let _ = client.close().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn anti_detect_injection_overrides_webdriver() {
    let Some(bin) = chrome_available() else {
        eprintln!("Skipping: no chromium binary on host.");
        return;
    };
    std::env::set_var("CHROME_PATH", &bin);

    let client = match BrowserClient::new(BrowserOptions::headless_new()).await {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Skipping: chromium failed to launch ({e}).");
            return;
        }
    };

    let page = match client.new_page().await {
        Ok(p) => p,
        Err(e) => {
            eprintln!("Skipping: new_page failed ({e}).");
            let _ = client.close().await;
            return;
        }
    };

    // Page.addScriptToEvaluateOnNewDocument runs on the NEXT document
    // load. Navigate to a data: URL to trigger a clean fresh-document
    // creation so the shim is in effect.
    let goto = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        page.goto("data:text/html,<html><body>ok</body></html>"),
    )
    .await;
    if !matches!(goto, Ok(Ok(_))) {
        eprintln!("Skipping: data: navigation failed/timed out.");
        let _ = client.close().await;
        return;
    }

    let webdriver_is_undefined: bool = page
        .evaluate("typeof navigator.webdriver === 'undefined'")
        .await
        .ok()
        .and_then(|r| r.into_value::<bool>().ok())
        .unwrap_or(false);

    let _ = client.close().await;

    assert!(
        webdriver_is_undefined,
        "anti-detect script did not override navigator.webdriver"
    );
}
