//! Tool wrappers that expose the flow engine through the standard
//! `Tool` interface. These are registered into the global `ToolRegistry`
//! so that flows can themselves be invoked as tools by other flows.
//!
//! Tools exposed:
//! - `record_flow` — starts a placeholder recording session (returns a token).
//! - `run_flow`    — loads a flow file by path or name and executes it.
//! - `list_flows`  — lists flows in `Config::flows_dir()`.
//! - `inspect_flow` — load a flow file and return its parsed JSON form.
//! - `validate_flow` — parse a flow file and return validation errors, if any.
//!
//! Note: `record_flow` is intentionally a stub here. Live CDP recording is
//! tied to the browser engine and will be ported in a later sprint. The
//! current implementation establishes the tool surface so that downstream
//! CLI / HTTP layers can call it without needing a separate code path.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use async_trait::async_trait;
use imperium_crawl_core::{
    Config, CrawlError, Result, Tool, ToolArgs, ToolOutput, ToolRegistry, ToolSchema,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::runner::FlowRunner;
use crate::storage::FlowStore;

// ── Helpers ──────────────────────────────────────────────────────────────

fn flows_dir(config: &Config) -> Result<PathBuf> {
    config.flows_dir()
}

/// Resolve `name_or_path` against the flows dir. If `name_or_path` is an
/// existing file path it is returned as-is; otherwise we look for
/// `<flows_dir>/<name>.yaml`, then `.yml`, then `.json`.
fn resolve_flow_path(name_or_path: &str, dir: &Path) -> Result<PathBuf> {
    let direct = PathBuf::from(name_or_path);
    if direct.is_file() {
        return Ok(direct);
    }
    for ext in ["yaml", "yml", "json"] {
        let candidate = dir.join(format!("{name_or_path}.{ext}"));
        if candidate.is_file() {
            return Ok(candidate);
        }
    }
    Err(CrawlError::InvalidArg(format!(
        "flow '{name_or_path}' not found in {} (tried .yaml, .yml, .json)",
        dir.display()
    )))
}

// ── record_flow (placeholder) ───────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
struct RecordArgs {
    name: String,
    #[serde(default)]
    description: Option<String>,
}

/// Placeholder for browser flow recording. Returns a session id that the
/// CDP-based recorder (future sprint) will use to attach. Currently no
/// background work is started.
pub struct RecordFlowTool;

#[async_trait]
impl Tool for RecordFlowTool {
    fn schema(&self) -> ToolSchema {
        ToolSchema {
            name: "record_flow".into(),
            description: "Start a flow recording session (CDP recorder — stub).".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "required": ["name"],
                "properties": {
                    "name": {"type": "string"},
                    "description": {"type": "string"}
                }
            }),
            output_schema: serde_json::json!({"type": "object"}),
            requires_api_key: None,
            requires_browser: true,
        }
    }

    async fn execute(&self, args: ToolArgs) -> Result<ToolOutput> {
        let parsed: RecordArgs = serde_json::from_value(args)
            .map_err(|e| CrawlError::InvalidArg(format!("invalid record_flow args: {e}")))?;
        // Validate the name matches the flow naming rules.
        if !parsed.name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
            || parsed.name.is_empty()
        {
            return Err(CrawlError::InvalidArg(format!(
                "invalid flow name '{}': must match [a-zA-Z0-9_-]+",
                parsed.name
            )));
        }
        Ok(ToolOutput::json(serde_json::json!({
            "ok": true,
            "status": "pending",
            "message": "flow recorder is not implemented in this sprint — use FlowRecorder API directly to compose flows programmatically",
            "name": parsed.name,
            "description": parsed.description,
        })))
    }
}

// ── run_flow ─────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
struct RunArgs {
    /// Either a flow name (looked up in flows_dir) or a filesystem path.
    flow: String,
    /// Optional variable overrides.
    #[serde(default)]
    vars: serde_json::Map<String, Value>,
}

/// Loads a flow and executes it through the supplied registry.
pub struct RunFlowTool {
    config: Arc<Config>,
    registry: Arc<ToolRegistry>,
}

impl RunFlowTool {
    pub fn new(config: Arc<Config>, registry: Arc<ToolRegistry>) -> Self {
        Self { config, registry }
    }
}

#[async_trait]
impl Tool for RunFlowTool {
    fn schema(&self) -> ToolSchema {
        ToolSchema {
            name: "run_flow".into(),
            description: "Run a saved flow by name or path. Variables override flow defaults."
                .into(),
            input_schema: serde_json::json!({
                "type": "object",
                "required": ["flow"],
                "properties": {
                    "flow": {"type": "string"},
                    "vars": {"type": "object"}
                }
            }),
            output_schema: serde_json::json!({"type": "object"}),
            requires_api_key: None,
            requires_browser: false,
        }
    }

    async fn execute(&self, args: ToolArgs) -> Result<ToolOutput> {
        let parsed: RunArgs = serde_json::from_value(args)
            .map_err(|e| CrawlError::InvalidArg(format!("invalid run_flow args: {e}")))?;
        let dir = flows_dir(&self.config)?;
        let path = resolve_flow_path(&parsed.flow, &dir)?;
        let flow = FlowStore::load(&path)?;
        let overrides: std::collections::HashMap<String, Value> =
            parsed.vars.into_iter().collect();
        let mut runner = FlowRunner::new(self.registry.clone()).with_vars(overrides);
        let result = runner.run(&flow).await?;
        Ok(ToolOutput::json(serde_json::to_value(result)?))
    }
}

// ── list_flows ──────────────────────────────────────────────────────────

pub struct ListFlowsTool {
    config: Arc<Config>,
}

impl ListFlowsTool {
    pub fn new(config: Arc<Config>) -> Self {
        Self { config }
    }
}

#[async_trait]
impl Tool for ListFlowsTool {
    fn schema(&self) -> ToolSchema {
        ToolSchema {
            name: "list_flows".into(),
            description: "List flows stored in the configured flows directory.".into(),
            input_schema: serde_json::json!({"type": "object"}),
            output_schema: serde_json::json!({"type": "object"}),
            requires_api_key: None,
            requires_browser: false,
        }
    }

    async fn execute(&self, _args: ToolArgs) -> Result<ToolOutput> {
        let dir = flows_dir(&self.config)?;
        let files = FlowStore::list(&dir)?;
        let mut entries: Vec<Value> = Vec::with_capacity(files.len());
        for path in files {
            let name = path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            // Best-effort: load each to surface description and step count.
            let (description, steps) = match FlowStore::load(&path) {
                Ok(flow) => (flow.description, Some(flow.steps.len())),
                Err(_) => (None, None),
            };
            entries.push(serde_json::json!({
                "name": name,
                "path": path.display().to_string(),
                "description": description,
                "steps": steps,
            }));
        }
        Ok(ToolOutput::json(serde_json::json!({
            "dir": dir.display().to_string(),
            "count": entries.len(),
            "flows": entries,
        })))
    }
}

// ── inspect_flow ────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
struct InspectArgs {
    flow: String,
}

pub struct InspectFlowTool {
    config: Arc<Config>,
}

impl InspectFlowTool {
    pub fn new(config: Arc<Config>) -> Self {
        Self { config }
    }
}

#[async_trait]
impl Tool for InspectFlowTool {
    fn schema(&self) -> ToolSchema {
        ToolSchema {
            name: "inspect_flow".into(),
            description: "Load and pretty-print a flow file.".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "required": ["flow"],
                "properties": {"flow": {"type": "string"}}
            }),
            output_schema: serde_json::json!({"type": "object"}),
            requires_api_key: None,
            requires_browser: false,
        }
    }

    async fn execute(&self, args: ToolArgs) -> Result<ToolOutput> {
        let parsed: InspectArgs = serde_json::from_value(args)
            .map_err(|e| CrawlError::InvalidArg(format!("invalid inspect_flow args: {e}")))?;
        let dir = flows_dir(&self.config)?;
        let path = resolve_flow_path(&parsed.flow, &dir)?;
        let flow = FlowStore::load(&path)?;
        Ok(ToolOutput::json(serde_json::json!({
            "path": path.display().to_string(),
            "flow": serde_json::to_value(&flow)?,
        })))
    }
}

// ── validate_flow ───────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
struct ValidateArgs {
    flow: String,
}

pub struct ValidateFlowTool {
    config: Arc<Config>,
}

impl ValidateFlowTool {
    pub fn new(config: Arc<Config>) -> Self {
        Self { config }
    }
}

#[async_trait]
impl Tool for ValidateFlowTool {
    fn schema(&self) -> ToolSchema {
        ToolSchema {
            name: "validate_flow".into(),
            description: "Parse and validate a flow file. Reports the first structural error."
                .into(),
            input_schema: serde_json::json!({
                "type": "object",
                "required": ["flow"],
                "properties": {"flow": {"type": "string"}}
            }),
            output_schema: serde_json::json!({"type": "object"}),
            requires_api_key: None,
            requires_browser: false,
        }
    }

    async fn execute(&self, args: ToolArgs) -> Result<ToolOutput> {
        let parsed: ValidateArgs = serde_json::from_value(args)
            .map_err(|e| CrawlError::InvalidArg(format!("invalid validate_flow args: {e}")))?;
        let dir = flows_dir(&self.config)?;
        let path = match resolve_flow_path(&parsed.flow, &dir) {
            Ok(p) => p,
            Err(e) => {
                return Ok(ToolOutput::json(serde_json::json!({
                    "ok": false,
                    "error": e.to_string(),
                })));
            }
        };
        match FlowStore::load(&path) {
            Ok(flow) => Ok(ToolOutput::json(serde_json::json!({
                "ok": true,
                "path": path.display().to_string(),
                "name": flow.name,
                "steps": flow.steps.len(),
            }))),
            Err(e) => Ok(ToolOutput::json(serde_json::json!({
                "ok": false,
                "path": path.display().to_string(),
                "error": e.to_string(),
            }))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::{Flow, FlowStep};
    use tempfile::TempDir;

    fn registry_and_config(dir: &Path) -> (Arc<Config>, Arc<ToolRegistry>) {
        let cfg = Config {
            data_dir: Some(dir.to_path_buf()),
            ..Config::default()
        };
        (Arc::new(cfg), Arc::new(ToolRegistry::new()))
    }

    fn sample_flow_file(dir: &Path) -> PathBuf {
        let flow = Flow {
            name: "demo".into(),
            description: Some("desc".into()),
            version: 1,
            vars: Default::default(),
            steps: vec![FlowStep {
                id: None,
                tool: "scrape".into(),
                args: serde_json::json!({"url": "https://example.com"}),
                output_var: None,
                expect: None,
                retry: 0,
            }],
        };
        let flows_dir = dir.join("flows");
        std::fs::create_dir_all(&flows_dir).unwrap();
        let path = flows_dir.join("demo.yaml");
        FlowStore::save(&flow, &path).unwrap();
        path
    }

    #[tokio::test]
    async fn list_flows_returns_entries() {
        let dir = TempDir::new().unwrap();
        sample_flow_file(dir.path());
        let (cfg, _reg) = registry_and_config(dir.path());
        let tool = ListFlowsTool::new(cfg);
        let out = tool.execute(serde_json::json!({})).await.unwrap();
        assert_eq!(out.data["count"], 1);
        assert_eq!(out.data["flows"][0]["name"], "demo");
    }

    #[tokio::test]
    async fn validate_flow_ok() {
        let dir = TempDir::new().unwrap();
        sample_flow_file(dir.path());
        let (cfg, _) = registry_and_config(dir.path());
        let tool = ValidateFlowTool::new(cfg);
        let out = tool
            .execute(serde_json::json!({"flow": "demo"}))
            .await
            .unwrap();
        assert_eq!(out.data["ok"], true);
        assert_eq!(out.data["steps"], 1);
    }

    #[tokio::test]
    async fn validate_flow_missing_returns_error_object() {
        let dir = TempDir::new().unwrap();
        let (cfg, _) = registry_and_config(dir.path());
        let tool = ValidateFlowTool::new(cfg);
        let out = tool
            .execute(serde_json::json!({"flow": "missing"}))
            .await
            .unwrap();
        assert_eq!(out.data["ok"], false);
    }

    #[tokio::test]
    async fn inspect_flow_returns_parsed_definition() {
        let dir = TempDir::new().unwrap();
        sample_flow_file(dir.path());
        let (cfg, _) = registry_and_config(dir.path());
        let tool = InspectFlowTool::new(cfg);
        let out = tool
            .execute(serde_json::json!({"flow": "demo"}))
            .await
            .unwrap();
        assert_eq!(out.data["flow"]["name"], "demo");
    }

    #[tokio::test]
    async fn record_flow_validates_name() {
        let tool = RecordFlowTool;
        let bad = tool
            .execute(serde_json::json!({"name": "bad name"}))
            .await;
        assert!(bad.is_err());
        let ok = tool
            .execute(serde_json::json!({"name": "good_name-1"}))
            .await
            .unwrap();
        assert_eq!(ok.data["ok"], true);
    }
}
