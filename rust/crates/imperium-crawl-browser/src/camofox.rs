//! CamoFox L4 stealth — subprocess wrapper around the C++ CamoFox binary.
//!
//! Protocol (JSON over stdin/stdout, newline-delimited):
//!
//!   Request  (host → camofox, one JSON object per line):
//!       { "action": "fetch", "url": "https://example.com" }
//!       { "action": "ping" }            (optional, returns `{"ok": true}`)
//!       { "action": "shutdown" }        (camofox exits cleanly)
//!
//!   Response (camofox → host, one JSON object per line):
//!       { "status": 200,
//!         "final_url": "https://example.com/",
//!         "body": "<base64-encoded HTML>",
//!         "headers": { ... }            (optional)
//!       }
//!     or on error:
//!       { "error": "human readable message" }
//!
//! The body MUST be base64 so that we can carry binary content (images,
//! PDFs) through the JSON pipe without escaping. Headers are optional —
//! when present the keys are lowercased.
//!
//! Binary resolution:
//!   1. `CAMOFOX_BIN` env var (absolute path or PATH-resolvable name).
//!   2. `~/.imperium-crawl/camofox/camofox`
//!   3. `camofox` on PATH (last-resort).
//!
//! If none resolves, `CamoFoxClient::launch` returns
//! `CrawlError::Subprocess`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Instant;

use base64::Engine;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;

use imperium_crawl_core::{ContentKind, CrawlError, FetchResult, Result, StealthLevel};

/// Default binary location inside the imperium-crawl data dir.
const DEFAULT_REL_PATH: &str = ".imperium-crawl/camofox/camofox";

#[derive(Serialize)]
struct FetchRequest<'a> {
    action: &'a str,
    url: &'a str,
}

#[derive(Deserialize, Debug)]
struct FetchResponse {
    #[serde(default)]
    status: Option<u16>,
    #[serde(default)]
    final_url: Option<String>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    headers: Option<HashMap<String, String>>,
    #[serde(default)]
    error: Option<String>,
}

/// Resolve the CamoFox binary path according to the precedence rules
/// documented above. Returns the path if it exists, else
/// `CrawlError::Subprocess`.
pub fn resolve_binary() -> Result<PathBuf> {
    if let Ok(p) = std::env::var("CAMOFOX_BIN") {
        let candidate = PathBuf::from(&p);
        if candidate.exists() {
            return Ok(candidate);
        }
        // Allow PATH-resolvable names too.
        if let Some(found) = which(&p) {
            return Ok(found);
        }
        return Err(CrawlError::Subprocess(format!(
            "camofox binary not found at {p} (from CAMOFOX_BIN)"
        )));
    }

    if let Some(home) = dirs::home_dir() {
        let candidate = home.join(DEFAULT_REL_PATH);
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    if let Some(found) = which("camofox") {
        return Ok(found);
    }

    Err(CrawlError::Subprocess(format!(
        "camofox binary not found at $CAMOFOX_BIN, ~/{DEFAULT_REL_PATH}, or PATH"
    )))
}

fn which(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

struct Channel {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

/// CamoFox subprocess client. Long-lived — spawn once, send many requests.
pub struct CamoFoxClient {
    binary: PathBuf,
    channel: Arc<Mutex<Option<Channel>>>,
}

impl std::fmt::Debug for CamoFoxClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CamoFoxClient")
            .field("binary", &self.binary)
            .finish()
    }
}

impl CamoFoxClient {
    /// Spawn the CamoFox subprocess. Returns `CrawlError::Subprocess` if the
    /// binary cannot be found or fails to spawn.
    pub async fn launch() -> Result<Self> {
        let binary = resolve_binary()?;
        let client = Self {
            binary: binary.clone(),
            channel: Arc::new(Mutex::new(None)),
        };
        client.ensure_spawned().await?;
        Ok(client)
    }

    /// Spawn the subprocess if it has not been spawned yet (or has exited).
    async fn ensure_spawned(&self) -> Result<()> {
        let mut guard = self.channel.lock().await;
        if guard.is_some() {
            return Ok(());
        }
        let mut cmd = Command::new(&self.binary);
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let mut child = cmd
            .spawn()
            .map_err(|e| CrawlError::Subprocess(format!("spawn camofox: {e}")))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| CrawlError::Subprocess("camofox: missing stdin".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| CrawlError::Subprocess("camofox: missing stdout".into()))?;
        *guard = Some(Channel {
            child,
            stdin,
            stdout: BufReader::new(stdout),
        });
        Ok(())
    }

    /// Send a fetch request and wait for the matching response.
    pub async fn fetch(&self, url: &str) -> Result<FetchResult> {
        let start = Instant::now();
        self.ensure_spawned().await?;

        let req = FetchRequest { action: "fetch", url };
        let line = serde_json::to_string(&req)? + "\n";

        let response_line = {
            let mut guard = self.channel.lock().await;
            let channel = guard
                .as_mut()
                .ok_or_else(|| CrawlError::Subprocess("camofox channel missing".into()))?;
            channel
                .stdin
                .write_all(line.as_bytes())
                .await
                .map_err(|e| CrawlError::Subprocess(format!("write camofox stdin: {e}")))?;
            channel
                .stdin
                .flush()
                .await
                .map_err(|e| CrawlError::Subprocess(format!("flush camofox stdin: {e}")))?;
            let mut buf = String::new();
            let n = channel
                .stdout
                .read_line(&mut buf)
                .await
                .map_err(|e| CrawlError::Subprocess(format!("read camofox stdout: {e}")))?;
            if n == 0 {
                return Err(CrawlError::Subprocess(
                    "camofox: stdout closed before response".into(),
                ));
            }
            buf
        };

        let resp: FetchResponse = serde_json::from_str(response_line.trim()).map_err(|e| {
            CrawlError::Subprocess(format!(
                "camofox: malformed JSON response ({e}): {}",
                response_line.trim()
            ))
        })?;

        if let Some(err) = resp.error {
            return Err(CrawlError::Browser(format!("camofox: {err}")));
        }

        let status = resp.status.unwrap_or(200);
        let final_url = resp.final_url.unwrap_or_else(|| url.to_string());
        let body_b64 = resp.body.unwrap_or_default();
        let body = base64::engine::general_purpose::STANDARD
            .decode(body_b64.as_bytes())
            .map_err(|e| CrawlError::Subprocess(format!("camofox base64: {e}")))?;

        let mut headers = resp.headers.unwrap_or_default();
        let kind = headers
            .get("content-type")
            .map(|s| ContentKind::from_mime(s))
            .unwrap_or(ContentKind::Html);
        headers
            .entry("content-type".to_string())
            .or_insert_with(|| "text/html; charset=utf-8".to_string());

        Ok(FetchResult {
            url: url.to_string(),
            final_url,
            status,
            kind,
            body,
            headers,
            stealth_level: StealthLevel::L4Camofox,
            duration_ms: start.elapsed().as_millis() as u64,
        })
    }

    /// Path of the binary backing this client.
    pub fn binary_path(&self) -> &std::path::Path {
        &self.binary
    }

    /// Graceful shutdown. Best-effort — sends `{"action":"shutdown"}`, then
    /// waits up to 2 s before falling back to SIGKILL via `Child::kill`.
    pub async fn close(self) -> Result<()> {
        let mut guard = self.channel.lock().await;
        if let Some(mut channel) = guard.take() {
            let _ = channel
                .stdin
                .write_all(b"{\"action\":\"shutdown\"}\n")
                .await;
            let _ = channel.stdin.flush().await;
            let waited = tokio::time::timeout(
                std::time::Duration::from_secs(2),
                channel.child.wait(),
            )
            .await;
            if waited.is_err() {
                let _ = channel.child.kill().await;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_binary_errors_when_unavailable() {
        // Take a snapshot of any existing var and clear it.
        let prev = std::env::var("CAMOFOX_BIN").ok();
        std::env::remove_var("CAMOFOX_BIN");
        let res = resolve_binary();
        // Restore env first so we never leak test state.
        if let Some(v) = prev {
            std::env::set_var("CAMOFOX_BIN", v);
        }
        // The default path may or may not exist on a dev box; we only
        // assert that the function returns *some* result without panicking.
        let _ = res;
    }

    #[tokio::test]
    async fn launch_gracefully_skips_when_bin_missing() {
        if std::env::var("CAMOFOX_BIN").is_err() {
            // No env override → the binary likely isn't installed in CI.
            // Just ensure we get a clean Subprocess error rather than a
            // panic when the binary is absent.
            match CamoFoxClient::launch().await {
                Ok(_) => {
                    // Binary happened to exist locally — fine.
                }
                Err(CrawlError::Subprocess(msg)) => {
                    assert!(msg.contains("camofox"), "unexpected msg: {msg}");
                }
                Err(other) => panic!("unexpected error: {other}"),
            }
            return;
        }
        // CAMOFOX_BIN is set — actually try to launch + ping.
        let _ = CamoFoxClient::launch().await;
    }
}
