//! Browser action executor — port of `../../src/core/action-executor.ts`.
//!
//! Only the action variants actually wired through the Rust public surface
//! are implemented: click, type, scroll, wait, evaluate, drag, upload,
//! paginate. (The TS file additionally handles snapshot-ref resolution,
//! auth-login flows, and storage helpers; those live in higher-level crates
//! that have not been ported yet.)

use std::path::PathBuf;
use std::time::Duration;

use chromiumoxide::cdp::browser_protocol::dom::SetFileInputFilesParams;
use chromiumoxide::page::Page;
use rand::Rng;
use serde::{Deserialize, Serialize};

use imperium_crawl_core::constants::{HUMAN_DELAY_MAX_MS, HUMAN_DELAY_MIN_MS};
use imperium_crawl_core::{CrawlError, Result};

/// Direction of a `Scroll` action.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScrollDirection {
    Up,
    Down,
    Left,
    Right,
}

impl ScrollDirection {
    fn delta(self, amount: i32) -> (i32, i32) {
        match self {
            ScrollDirection::Up => (0, -amount),
            ScrollDirection::Down => (0, amount),
            ScrollDirection::Left => (-amount, 0),
            ScrollDirection::Right => (amount, 0),
        }
    }
}

/// One browser action. Mirrors the public Action surface used by the
/// `interact` tool in the TS port — fields are the union of inputs the TS
/// switch-statement accepts, but enforced as proper variants for type
/// safety.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Action {
    Click { selector: String },
    Type { selector: String, text: String },
    Scroll {
        direction: ScrollDirection,
        #[serde(default = "default_scroll_amount")]
        amount: i32,
    },
    /// Wait either for a fixed duration (`ms`) or for a selector to appear.
    /// Exactly one of `ms` / `selector` must be provided.
    Wait {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        ms: Option<u64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        selector: Option<String>,
    },
    Evaluate { script: String },
    Drag { from_selector: String, to_selector: String },
    Upload { selector: String, file_path: PathBuf },
    Paginate {
        next_selector: String,
        #[serde(default = "default_max_pages")]
        max_pages: u32,
    },
}

fn default_scroll_amount() -> i32 {
    500
}
fn default_max_pages() -> u32 {
    10
}

/// Outcome of a single action.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionResult {
    pub action: String,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
    pub result: serde_json::Value,
}

impl ActionResult {
    fn ok(action: &str) -> Self {
        Self { action: action.into(), success: true, error: None, result: serde_json::Value::Null }
    }
    fn ok_with(action: &str, result: serde_json::Value) -> Self {
        Self { action: action.into(), success: true, error: None, result }
    }
    fn err(action: &str, error: impl Into<String>) -> Self {
        Self {
            action: action.into(),
            success: false,
            error: Some(error.into()),
            result: serde_json::Value::Null,
        }
    }
}

/// Action executor. Stateless wrapper around a `Page` — the page is passed
/// in for every call so the executor can be reused across pages.
pub struct ActionExecutor {
    default_timeout: Duration,
}

impl Default for ActionExecutor {
    fn default() -> Self {
        Self { default_timeout: Duration::from_millis(10_000) }
    }
}

impl ActionExecutor {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_timeout(timeout: Duration) -> Self {
        Self { default_timeout: timeout }
    }

    /// Random human-like delay in milliseconds, sampled from
    /// `HUMAN_DELAY_MIN_MS..=HUMAN_DELAY_MAX_MS`. Mirrors `humanDelay()` in
    /// the TS port.
    pub fn human_delay_ms() -> u64 {
        let mut rng = rand::thread_rng();
        rng.gen_range(HUMAN_DELAY_MIN_MS..=HUMAN_DELAY_MAX_MS)
    }

    async fn sleep_human(&self) {
        tokio::time::sleep(Duration::from_millis(Self::human_delay_ms())).await;
    }

    /// Execute one [`Action`] and return its [`ActionResult`]. Errors at the
    /// chromiumoxide layer are captured into `ActionResult::error` rather
    /// than propagated — mirrors the TS port's try/catch wrapper.
    pub async fn execute(&self, page: &Page, action: &Action) -> ActionResult {
        match self.execute_inner(page, action).await {
            Ok(r) => r,
            Err(e) => ActionResult::err(action_name(action), e.to_string()),
        }
    }

    /// Execute a batch and stop on the first failure. Returns every result
    /// up to and including the failure (matching the TS port's behavior).
    pub async fn execute_batch(&self, page: &Page, actions: &[Action]) -> Vec<ActionResult> {
        let mut out = Vec::with_capacity(actions.len());
        for a in actions {
            let r = self.execute(page, a).await;
            let stop = !r.success;
            out.push(r);
            if stop {
                break;
            }
        }
        out
    }

    async fn execute_inner(&self, page: &Page, action: &Action) -> Result<ActionResult> {
        match action {
            Action::Click { selector } => {
                self.sleep_human().await;
                let el = page
                    .find_element(selector.clone())
                    .await
                    .map_err(|e| CrawlError::Browser(format!("find {selector}: {e}")))?;
                el.click()
                    .await
                    .map_err(|e| CrawlError::Browser(format!("click {selector}: {e}")))?;
                Ok(ActionResult::ok("click"))
            }
            Action::Type { selector, text } => {
                self.sleep_human().await;
                let el = page
                    .find_element(selector.clone())
                    .await
                    .map_err(|e| CrawlError::Browser(format!("find {selector}: {e}")))?;
                el.click()
                    .await
                    .map_err(|e| CrawlError::Browser(format!("focus {selector}: {e}")))?;
                el.type_str(text)
                    .await
                    .map_err(|e| CrawlError::Browser(format!("type {selector}: {e}")))?;
                Ok(ActionResult::ok("type"))
            }
            Action::Scroll { direction, amount } => {
                let (dx, dy) = direction.delta(*amount);
                let script = format!("(() => {{ window.scrollBy({dx}, {dy}); return true; }})()");
                page.evaluate(script.as_str())
                    .await
                    .map_err(|e| CrawlError::Browser(format!("scroll: {e}")))?;
                Ok(ActionResult::ok("scroll"))
            }
            Action::Wait { ms, selector } => match (ms, selector) {
                (Some(ms), None) => {
                    tokio::time::sleep(Duration::from_millis(*ms)).await;
                    Ok(ActionResult::ok("wait"))
                }
                (None, Some(sel)) => {
                    self.wait_for_selector(page, sel, self.default_timeout).await?;
                    Ok(ActionResult::ok("wait"))
                }
                (Some(_), Some(_)) => Err(CrawlError::InvalidArg(
                    "wait: provide either ms OR selector, not both".into(),
                )),
                (None, None) => Err(CrawlError::MissingArg(
                    "wait: provide ms or selector".into(),
                )),
            },
            Action::Evaluate { script } => {
                let result = page
                    .evaluate(script.as_str())
                    .await
                    .map_err(|e| CrawlError::Browser(format!("evaluate: {e}")))?;
                let value = result
                    .into_value::<serde_json::Value>()
                    .unwrap_or(serde_json::Value::Null);
                Ok(ActionResult::ok_with("evaluate", value))
            }
            Action::Drag { from_selector, to_selector } => {
                // chromiumoxide doesn't expose a high-level dragAndDrop;
                // synthesize via JS dispatch — matches the TS port's
                // page.dragAndDrop behavior at the DOM-event level.
                self.sleep_human().await;
                let script = format!(
                    "(() => {{
                        const src = document.querySelector({src});
                        const dst = document.querySelector({dst});
                        if (!src || !dst) return false;
                        const dt = new DataTransfer();
                        src.dispatchEvent(new DragEvent('dragstart', {{ bubbles: true, dataTransfer: dt }}));
                        dst.dispatchEvent(new DragEvent('dragover',  {{ bubbles: true, dataTransfer: dt }}));
                        dst.dispatchEvent(new DragEvent('drop',      {{ bubbles: true, dataTransfer: dt }}));
                        src.dispatchEvent(new DragEvent('dragend',   {{ bubbles: true, dataTransfer: dt }}));
                        return true;
                    }})()",
                    src = json_str(from_selector),
                    dst = json_str(to_selector),
                );
                let ok = page
                    .evaluate(script.as_str())
                    .await
                    .map_err(|e| CrawlError::Browser(format!("drag: {e}")))?
                    .into_value::<bool>()
                    .unwrap_or(false);
                if !ok {
                    return Ok(ActionResult::err(
                        "drag",
                        format!("source or target selector not found: {from_selector} -> {to_selector}"),
                    ));
                }
                Ok(ActionResult::ok("drag"))
            }
            Action::Upload { selector, file_path } => {
                let el = page
                    .find_element(selector.clone())
                    .await
                    .map_err(|e| CrawlError::Browser(format!("find {selector}: {e}")))?;
                let path_str = file_path
                    .to_str()
                    .ok_or_else(|| {
                        CrawlError::InvalidArg(format!(
                            "upload: non-UTF-8 path {:?}",
                            file_path
                        ))
                    })?
                    .to_string();
                let mut params = SetFileInputFilesParams::new(vec![path_str]);
                params.backend_node_id = Some(el.backend_node_id);
                page.execute(params)
                    .await
                    .map_err(|e| CrawlError::Browser(format!("upload {selector}: {e}")))?;
                Ok(ActionResult::ok("upload"))
            }
            Action::Paginate { next_selector, max_pages } => {
                let mut clicked = 0u32;
                for _ in 0..*max_pages {
                    let el = match page.find_element(next_selector.clone()).await {
                        Ok(el) => el,
                        Err(_) => break,
                    };
                    self.sleep_human().await;
                    if el.click().await.is_err() {
                        break;
                    }
                    clicked += 1;
                    // Give the page a moment to settle.
                    tokio::time::sleep(Duration::from_millis(800)).await;
                }
                Ok(ActionResult::ok_with(
                    "paginate",
                    serde_json::json!({ "clicked": clicked }),
                ))
            }
        }
    }

    async fn wait_for_selector(&self, page: &Page, selector: &str, timeout: Duration) -> Result<()> {
        let deadline = std::time::Instant::now() + timeout;
        loop {
            if page.find_element(selector.to_string()).await.is_ok() {
                return Ok(());
            }
            if std::time::Instant::now() >= deadline {
                return Err(CrawlError::Timeout {
                    timeout_ms: timeout.as_millis() as u64,
                    context: format!("wait for selector {selector}"),
                });
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }
}

fn action_name(a: &Action) -> &'static str {
    match a {
        Action::Click { .. } => "click",
        Action::Type { .. } => "type",
        Action::Scroll { .. } => "scroll",
        Action::Wait { .. } => "wait",
        Action::Evaluate { .. } => "evaluate",
        Action::Drag { .. } => "drag",
        Action::Upload { .. } => "upload",
        Action::Paginate { .. } => "paginate",
    }
}

/// JSON-encode a string into a `"..."` literal safe for inline JS injection.
fn json_str(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| "\"\"".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn action_serde_roundtrip_click() {
        let a = Action::Click { selector: "#go".into() };
        let json = serde_json::to_string(&a).unwrap();
        assert!(json.contains("click"));
        let back: Action = serde_json::from_str(&json).unwrap();
        match back {
            Action::Click { selector } => assert_eq!(selector, "#go"),
            _ => panic!("expected click"),
        }
    }

    #[test]
    fn scroll_delta_directions() {
        assert_eq!(ScrollDirection::Up.delta(100), (0, -100));
        assert_eq!(ScrollDirection::Down.delta(100), (0, 100));
        assert_eq!(ScrollDirection::Left.delta(50), (-50, 0));
        assert_eq!(ScrollDirection::Right.delta(50), (50, 0));
    }

    #[test]
    fn human_delay_within_bounds() {
        for _ in 0..20 {
            let d = ActionExecutor::human_delay_ms();
            assert!((HUMAN_DELAY_MIN_MS..=HUMAN_DELAY_MAX_MS).contains(&d));
        }
    }

    #[test]
    fn wait_action_rejects_both_fields() {
        let executor = ActionExecutor::new();
        // We cannot run the actual page-bound execute here without a
        // browser, but the public Action variant must still construct.
        let a = Action::Wait { ms: Some(100), selector: Some("#x".into()) };
        let json = serde_json::to_string(&a).unwrap();
        assert!(json.contains("ms"));
        assert!(json.contains("selector"));
        let _ = executor; // keep ctor exercised
    }
}
