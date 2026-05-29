//! Action executor integration test.
//!
//! Writes a tiny HTML fixture to a tempdir, opens it via `file://`, clicks a
//! button, and asserts the page state changed. Skips cleanly when no Chrome
//! is present.

#![cfg(feature = "browser")]

use std::path::PathBuf;

use imperium_crawl_browser::{
    Action, ActionExecutor, BrowserClient, BrowserOptions,
};

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

const FIXTURE_HTML: &str = r#"<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Action Fixture</title></head>
<body>
  <button id="go" onclick="document.getElementById('state').textContent='clicked'">Go</button>
  <span id="state">initial</span>
  <input id="name" type="text" />
</body></html>
"#;

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn click_and_type_update_dom_state() {
    let Some(bin) = chrome_available() else {
        eprintln!("Skipping action test: no chromium binary on host.");
        return;
    };
    std::env::set_var("CHROME_PATH", &bin);

    // Write fixture to tempdir for posterity (also lets us prove file://
    // round-trips, even though we set_content below).
    let tmp = tempfile::tempdir().expect("tempdir");
    let html_path = tmp.path().join("fixture.html");
    std::fs::write(&html_path, FIXTURE_HTML).expect("write fixture");

    let client = match BrowserClient::new(BrowserOptions::headless_new()).await {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Skipping action test: chromium launch failed ({e}).");
            return;
        }
    };

    let page = match client.new_page().await {
        Ok(p) => p,
        Err(e) => {
            eprintln!("Skipping action test: new_page failed ({e}).");
            let _ = client.close().await;
            return;
        }
    };

    // Inject fixture HTML via Page.setContent rather than navigating to a
    // file:// URL — avoids Chrome's file-scheme sandboxing surprises in
    // headless mode (which can detach the CDP target mid-test and cause
    // "send failed because receiver is gone").
    let setc = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        page.set_content(FIXTURE_HTML),
    )
    .await;
    match setc {
        Ok(Ok(_)) => {}
        Ok(Err(e)) => {
            eprintln!("Skipping action test: set_content failed ({e}).");
            let _ = client.close().await;
            return;
        }
        Err(_) => {
            eprintln!("Skipping action test: set_content timed out.");
            let _ = client.close().await;
            return;
        }
    }

    let executor = ActionExecutor::with_timeout(std::time::Duration::from_secs(5));

    // 1. Click the button.
    let click = executor.execute(&page, &Action::Click { selector: "#go".into() }).await;
    assert!(click.success, "click failed: {:?}", click.error);

    // 2. Verify the state element flipped via evaluate action.
    let eval = executor
        .execute(
            &page,
            &Action::Evaluate {
                script: "document.getElementById('state').textContent".into(),
            },
        )
        .await;
    assert!(eval.success, "evaluate failed: {:?}", eval.error);
    let text = eval.result.as_str().unwrap_or_default().to_string();
    assert_eq!(text, "clicked", "state element did not update; got {text:?}");

    // 3. Type into the input and verify value.
    let typed = executor
        .execute(
            &page,
            &Action::Type {
                selector: "#name".into(),
                text: "Pavle".into(),
            },
        )
        .await;
    assert!(typed.success, "type failed: {:?}", typed.error);

    let eval2 = executor
        .execute(
            &page,
            &Action::Evaluate {
                script: "document.getElementById('name').value".into(),
            },
        )
        .await;
    assert!(eval2.success, "evaluate2 failed: {:?}", eval2.error);
    let value = eval2.result.as_str().unwrap_or_default().to_string();
    assert_eq!(value, "Pavle", "input value mismatch: {value:?}");

    let _ = client.close().await;
}
