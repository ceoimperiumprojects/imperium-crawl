//! L3 stealth: headless browser via chromiumoxide.
//!
//! Port of `../../src/stealth/browser.ts`. Launches Chrome with the same
//! stealth args used by the TS port (`stealth_args_with_jitter`), injects
//! `assets/anti-detect.js` on every new document via CDP, and exposes a
//! minimal `fetch(url) -> FetchResult` API.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use chromiumoxide::browser::{Browser, BrowserConfig, HeadlessMode};
use chromiumoxide::cdp::browser_protocol::page::AddScriptToEvaluateOnNewDocumentParams;
use chromiumoxide::page::Page;
use futures::StreamExt;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

use imperium_crawl_core::constants::{
    stealth_args_with_jitter, DEFAULT_VIEWPORT_HEIGHT, DEFAULT_VIEWPORT_WIDTH,
};
use imperium_crawl_core::{ContentKind, CrawlError, FetchResult, Result, StealthLevel};

use crate::profile::ChromeProfile;

const ANTI_DETECT_JS: &str = include_str!("../assets/anti-detect.js");

/// Options for launching a [`BrowserClient`]. Mirrors the subset of
/// `BrowserFetchOptions` that the TS port actually wires through to the
/// launch step.
#[derive(Debug, Clone, Default)]
pub struct BrowserOptions {
    /// Override chrome user-data-dir. If `None`, falls back to
    /// `CHROME_PROFILE_PATH` env var, then an ephemeral tempdir.
    pub user_data_dir: Option<PathBuf>,
    /// If true, run with `--headless=new`. Defaults to true.
    pub headless: bool,
    /// If true (default), append the Chrome stealth arg
    /// `--disable-blink-features=AutomationControlled`. (Already in the
    /// base stealth args; kept here as a redundancy toggle.)
    pub disable_blink_features: bool,
    /// SOCKS5/HTTP proxy URL passed to `--proxy-server`.
    pub proxy_url: Option<String>,
    /// Browser launch timeout. Defaults to 30s.
    pub launch_timeout: Option<Duration>,
    /// Per-request navigation timeout. Defaults to 30s.
    pub nav_timeout: Option<Duration>,
}

impl BrowserOptions {
    pub fn headless_new() -> Self {
        Self {
            user_data_dir: None,
            headless: true,
            disable_blink_features: true,
            proxy_url: None,
            launch_timeout: None,
            nav_timeout: None,
        }
    }
}

/// Owning handle to a chromiumoxide-driven Chrome process.
///
/// The [`Browser`] event loop is driven by an internal `tokio::spawn` task.
/// Drop or [`close`](Self::close) the client to shut Chrome down.
pub struct BrowserClient {
    browser: Browser,
    /// Kept alive so the ephemeral profile tempdir is not removed mid-flight.
    _profile: Arc<ChromeProfile>,
    handler_task: Mutex<Option<JoinHandle<()>>>,
    nav_timeout: Duration,
}

impl std::fmt::Debug for BrowserClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("BrowserClient")
            .field("profile", &self._profile)
            .field("nav_timeout_ms", &self.nav_timeout.as_millis())
            .finish()
    }
}

impl BrowserClient {
    /// Launch a new Chrome instance with the configured stealth args.
    pub async fn new(opts: BrowserOptions) -> Result<Self> {
        let profile = Arc::new(ChromeProfile::resolve(opts.user_data_dir.as_deref())?);
        let launch_timeout = opts.launch_timeout.unwrap_or_else(|| Duration::from_secs(30));
        let nav_timeout = opts.nav_timeout.unwrap_or_else(|| Duration::from_secs(30));

        let mut args: Vec<String> = stealth_args_with_jitter();
        if let Some(proxy) = opts.proxy_url.as_ref() {
            args.push(format!("--proxy-server={proxy}"));
        }

        let headless_mode = if opts.headless {
            HeadlessMode::New
        } else {
            HeadlessMode::False
        };

        let mut builder = BrowserConfig::builder()
            .user_data_dir(profile.path())
            .window_size(DEFAULT_VIEWPORT_WIDTH, DEFAULT_VIEWPORT_HEIGHT)
            .headless_mode(headless_mode)
            .launch_timeout(launch_timeout)
            .request_timeout(nav_timeout)
            .args(args);

        // Allow override via CHROME_PATH env (handy for chromium binary on
        // distros where chromiumoxide's default detection misses it).
        if let Ok(p) = std::env::var("CHROME_PATH") {
            if !p.trim().is_empty() {
                builder = builder.chrome_executable(PathBuf::from(p));
            }
        }

        let config = builder
            .build()
            .map_err(|e| CrawlError::Browser(format!("browser config: {e}")))?;

        let (browser, mut handler) = Browser::launch(config)
            .await
            .map_err(|e| CrawlError::Browser(format!("launch: {e}")))?;

        // Drive the CDP handler in the background. Drop/close stops the
        // task. We must keep polling until the stream actually ends — many
        // chromiumoxide internals send `Result` events whose `Err` variants
        // are *non-fatal* (e.g. an unrecognized command frame). Breaking on
        // the first error tears down the channel that subsequent
        // `Page::find_element`/`evaluate` calls rely on.
        let handler_task = tokio::spawn(async move {
            while handler.next().await.is_some() {
                // Drop the event; chromiumoxide drives all state internally.
            }
        });

        Ok(Self {
            browser,
            _profile: profile,
            handler_task: Mutex::new(Some(handler_task)),
            nav_timeout,
        })
    }

    /// Open a new page, inject anti-detect JS, navigate, return the rendered
    /// HTML wrapped in a [`FetchResult`].
    pub async fn fetch(&self, url: &str) -> Result<FetchResult> {
        let start = Instant::now();

        let page = self
            .browser
            .new_page("about:blank")
            .await
            .map_err(|e| CrawlError::Browser(format!("new_page: {e}")))?;

        // Inject anti-detect overrides BEFORE navigation.
        page.execute(AddScriptToEvaluateOnNewDocumentParams::new(ANTI_DETECT_JS))
            .await
            .map_err(|e| CrawlError::Browser(format!("inject anti-detect: {e}")))?;

        // Navigate. chromiumoxide's `goto` resolves once the requested URL
        // has finished loading, so we only need a timeout wrapper. Calling
        // `wait_for_navigation` here can deadlock when the page has already
        // settled by the time we ask.
        let goto_fut = page.goto(url.to_string());
        tokio::time::timeout(self.nav_timeout, goto_fut)
            .await
            .map_err(|_| CrawlError::Timeout {
                timeout_ms: self.nav_timeout.as_millis() as u64,
                context: format!("navigation to {url}"),
            })?
            .map_err(|e| CrawlError::Browser(format!("goto {url}: {e}")))?;

        let html = page
            .content()
            .await
            .map_err(|e| CrawlError::Browser(format!("content: {e}")))?;

        let final_url = page
            .url()
            .await
            .map_err(|e| CrawlError::Browser(format!("page.url: {e}")))?
            .unwrap_or_else(|| url.to_string());

        // Best-effort close — failures here should not poison the fetch.
        let _ = page.close().await;

        let mut headers = HashMap::new();
        headers.insert("content-type".to_string(), "text/html; charset=utf-8".to_string());

        Ok(FetchResult {
            url: url.to_string(),
            final_url,
            status: 200,
            kind: ContentKind::Html,
            body: html.into_bytes(),
            headers,
            stealth_level: StealthLevel::L3Browser,
            duration_ms: start.elapsed().as_millis() as u64,
        })
    }

    /// Open a fresh page with anti-detect already installed. Useful for the
    /// action executor + pool, which need raw [`Page`] handles.
    pub async fn new_page(&self) -> Result<Page> {
        let page = self
            .browser
            .new_page("about:blank")
            .await
            .map_err(|e| CrawlError::Browser(format!("new_page: {e}")))?;
        let _ = page
            .execute(AddScriptToEvaluateOnNewDocumentParams::new(ANTI_DETECT_JS))
            .await
            .map_err(|e| CrawlError::Browser(format!("inject anti-detect: {e}")))?;
        Ok(page)
    }

    /// Graceful shutdown. Idempotent — calling on an already-closed client
    /// is a no-op.
    pub async fn close(mut self) -> Result<()> {
        // Try to close politely. Errors from a Chrome that has already
        // exited are not fatal.
        let _ = self.browser.close().await;
        let _ = self.browser.wait().await;
        if let Some(task) = self.handler_task.lock().await.take() {
            task.abort();
        }
        Ok(())
    }
}

impl Drop for BrowserClient {
    fn drop(&mut self) {
        // Best-effort: kill Chrome on drop. We cannot await here, so
        // schedule an abort of the handler task and let the chromiumoxide
        // `Browser` Drop handle process teardown.
        if let Ok(mut guard) = self.handler_task.try_lock() {
            if let Some(task) = guard.take() {
                task.abort();
            }
        }
    }
}
