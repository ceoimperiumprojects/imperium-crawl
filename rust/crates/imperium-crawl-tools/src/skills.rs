//! Sprint 15 — Skills.
//!
//! A *skill* is a YAML (or JSON) recipe that composes existing tools into a
//! reusable pipeline with declared inputs. Ported from
//! `../../../src/skills/` and `../../../src/tools/{create-skill,run-skill,
//! list-skills}.ts`.
//!
//! Compared to a *flow* (see `imperium-crawl-flows`), a skill:
//! - declares typed `inputs` that callers must supply at run time,
//! - is identified by name and lives in `<data_dir>/skills/<name>.yaml|json`,
//! - uses the same `${var}` interpolation rules.
//!
//! Variable scope:
//! - `${input_name}` references a declared input value.
//! - `${step_output}` references the output captured under `step.output`.
//! - dotted paths are supported (`${page.url}`).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use async_trait::async_trait;
use imperium_crawl_core::{
    Config, CrawlError, Result, Tool, ToolArgs, ToolOutput, ToolRegistry, ToolSchema,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tracing::warn;

// ── Schema ──────────────────────────────────────────────────────────────

/// Declared skill input.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SkillInput {
    pub name: String,
    #[serde(default = "default_type")]
    pub r#type: String,
    #[serde(default)]
    pub required: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

fn default_type() -> String {
    "string".into()
}

/// One tool invocation inside a skill.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SkillStep {
    pub tool: String,
    #[serde(default = "default_args_obj")]
    pub args: Value,
    /// Variable name to bind the tool's `data` output to.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
}

fn default_args_obj() -> Value {
    Value::Object(Map::new())
}

/// Top-level skill definition.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SkillDef {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub inputs: Vec<SkillInput>,
    #[serde(default)]
    pub steps: Vec<SkillStep>,
}

impl SkillDef {
    pub fn from_yaml(text: &str) -> Result<Self> {
        serde_yaml::from_str::<Self>(text)
            .map_err(|e| CrawlError::Parse(format!("invalid skill yaml: {e}")))
            .and_then(|s| s.validated())
    }

    pub fn from_json(text: &str) -> Result<Self> {
        serde_json::from_str::<Self>(text)
            .map_err(|e| CrawlError::Parse(format!("invalid skill json: {e}")))
            .and_then(|s| s.validated())
    }

    pub fn validated(self) -> Result<Self> {
        if self.name.trim().is_empty() {
            return Err(CrawlError::InvalidArg("skill.name is required".into()));
        }
        if !is_valid_name(&self.name) {
            return Err(CrawlError::InvalidArg(format!(
                "skill.name '{}' must match ^[a-zA-Z0-9_-]+$",
                self.name
            )));
        }
        if self.steps.is_empty() {
            return Err(CrawlError::InvalidArg(
                "skill must contain at least one step".into(),
            ));
        }
        for (i, input) in self.inputs.iter().enumerate() {
            if input.name.trim().is_empty() {
                return Err(CrawlError::InvalidArg(format!(
                    "inputs[{i}].name is required"
                )));
            }
        }
        for (i, step) in self.steps.iter().enumerate() {
            if step.tool.trim().is_empty() {
                return Err(CrawlError::InvalidArg(format!(
                    "steps[{i}].tool is required"
                )));
            }
        }
        Ok(self)
    }

    pub fn to_yaml(&self) -> Result<String> {
        serde_yaml::to_string(self)
            .map_err(|e| CrawlError::Other(format!("yaml serialize: {e}")))
    }
}

fn is_valid_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

// ── Result types ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillStepResult {
    pub tool: String,
    pub ok: bool,
    pub data: Value,
    pub duration_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillRunResult {
    pub skill: String,
    pub ok: bool,
    pub steps: Vec<SkillStepResult>,
    pub vars: Map<String, Value>,
    pub duration_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ── Variable interpolation ──────────────────────────────────────────────
//
// This mirrors the helper in `imperium-crawl-flows::runner` but is
// duplicated here to avoid a dependency cycle (flows already depends on
// tools). Behaviour must stay in sync.

fn interpolate(value: &Value, vars: &Map<String, Value>) -> Result<Value> {
    match value {
        Value::String(s) => interpolate_string(s, vars),
        Value::Array(items) => {
            let mut out = Vec::with_capacity(items.len());
            for v in items {
                out.push(interpolate(v, vars)?);
            }
            Ok(Value::Array(out))
        }
        Value::Object(map) => {
            let mut out = Map::with_capacity(map.len());
            for (k, v) in map {
                out.insert(k.clone(), interpolate(v, vars)?);
            }
            Ok(Value::Object(out))
        }
        _ => Ok(value.clone()),
    }
}

fn interpolate_string(s: &str, vars: &Map<String, Value>) -> Result<Value> {
    if !s.contains("${") {
        return Ok(Value::String(s.to_string()));
    }
    if let Some(name) = parse_whole_ref(s) {
        return resolve_ref(&name, vars);
    }
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(start) = rest.find("${") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let end = after.find('}').ok_or_else(|| {
            CrawlError::InvalidArg(format!("unterminated ${{ in '{s}'"))
        })?;
        let name = &after[..end];
        let resolved = resolve_ref(name.trim(), vars)?;
        let as_string = value_to_inline_string(&resolved);
        out.push_str(&as_string);
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    Ok(Value::String(out))
}

fn parse_whole_ref(s: &str) -> Option<String> {
    let trimmed = s.trim();
    if let Some(stripped) = trimmed.strip_prefix("${") {
        if let Some(name) = stripped.strip_suffix('}') {
            if !name.contains("${") && !name.contains('}') {
                return Some(name.trim().to_string());
            }
        }
    }
    None
}

fn resolve_ref(name: &str, vars: &Map<String, Value>) -> Result<Value> {
    if name.is_empty() {
        return Err(CrawlError::InvalidArg("empty variable reference".into()));
    }
    let (head, tail) = match name.split_once('.') {
        Some((h, t)) => (h, Some(t)),
        None => (name, None),
    };
    let base = vars
        .get(head)
        .ok_or_else(|| CrawlError::InvalidArg(format!("unknown variable: {name}")))?;
    match tail {
        None => Ok(base.clone()),
        Some(rest) => {
            let pointer: String = rest
                .split('.')
                .map(|seg| format!("/{}", seg))
                .collect();
            base.pointer(&pointer).cloned().ok_or_else(|| {
                CrawlError::InvalidArg(format!("unknown variable path: {name}"))
            })
        }
    }
}

fn value_to_inline_string(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => "null".to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        _ => serde_json::to_string(v).unwrap_or_default(),
    }
}

// ── Storage helpers ─────────────────────────────────────────────────────

/// Load a skill from `<dir>/<name>.{yaml,yml,json}`.
pub fn load_skill(dir: &Path, name: &str) -> Result<SkillDef> {
    if !is_valid_name(name) {
        return Err(CrawlError::InvalidArg(format!(
            "invalid skill name '{name}'"
        )));
    }
    for ext in ["yaml", "yml", "json"] {
        let path = dir.join(format!("{name}.{ext}"));
        if path.is_file() {
            let text = std::fs::read_to_string(&path)?;
            return match ext {
                "json" => SkillDef::from_json(&text),
                _ => SkillDef::from_yaml(&text),
            };
        }
    }
    Err(CrawlError::InvalidArg(format!(
        "skill '{name}' not found in {}",
        dir.display()
    )))
}

/// Save a skill to `<dir>/<name>.yaml`.
pub fn save_skill(dir: &Path, skill: &SkillDef) -> Result<PathBuf> {
    std::fs::create_dir_all(dir)?;
    let path = dir.join(format!("{}.yaml", skill.name));
    std::fs::write(&path, skill.to_yaml()?)?;
    Ok(path)
}

/// List skill names found in `dir`.
pub fn list_skill_names(dir: &Path) -> Result<Vec<String>> {
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path.extension().and_then(|e| e.to_str());
        if !matches!(ext, Some("yaml") | Some("yml") | Some("json")) {
            continue;
        }
        if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
            out.push(stem.to_string());
        }
    }
    out.sort();
    out.dedup();
    Ok(out)
}

// ── Runner ──────────────────────────────────────────────────────────────

/// Executes a `SkillDef` against a tool registry.
pub struct SkillRunner {
    registry: Arc<ToolRegistry>,
}

impl SkillRunner {
    pub fn new(registry: Arc<ToolRegistry>) -> Self {
        Self { registry }
    }

    /// Resolve declared inputs against the supplied values, applying defaults
    /// and enforcing `required`. Returns the initial variable map.
    fn resolve_inputs(
        skill: &SkillDef,
        provided: &HashMap<String, Value>,
    ) -> Result<Map<String, Value>> {
        let mut vars = Map::new();
        for input in &skill.inputs {
            if let Some(v) = provided.get(&input.name) {
                vars.insert(input.name.clone(), v.clone());
            } else if let Some(d) = &input.default {
                vars.insert(input.name.clone(), d.clone());
            } else if input.required {
                return Err(CrawlError::MissingArg(format!(
                    "skill input '{}'",
                    input.name
                )));
            }
        }
        // Allow callers to supply additional variables that aren't formally
        // declared (useful for nesting skills).
        for (k, v) in provided {
            vars.entry(k.clone()).or_insert_with(|| v.clone());
        }
        Ok(vars)
    }

    pub async fn run(
        &self,
        skill: &SkillDef,
        inputs: HashMap<String, Value>,
    ) -> Result<SkillRunResult> {
        let started = Instant::now();
        let mut vars = Self::resolve_inputs(skill, &inputs)?;
        let mut steps: Vec<SkillStepResult> = Vec::with_capacity(skill.steps.len());
        let mut ok = true;
        let mut error: Option<String> = None;

        for step in &skill.steps {
            let step_started = Instant::now();
            let args = match interpolate(&step.args, &vars) {
                Ok(v) => v,
                Err(e) => {
                    let msg = e.to_string();
                    ok = false;
                    error = Some(msg.clone());
                    steps.push(SkillStepResult {
                        tool: step.tool.clone(),
                        ok: false,
                        data: Value::Null,
                        duration_ms: step_started.elapsed().as_millis() as u64,
                        error: Some(msg),
                    });
                    break;
                }
            };
            match self.registry.execute(&step.tool, args).await {
                Ok(out) => {
                    if let Some(name) = &step.output {
                        vars.insert(name.clone(), out.data.clone());
                    }
                    steps.push(SkillStepResult {
                        tool: step.tool.clone(),
                        ok: true,
                        data: out.data,
                        duration_ms: step_started.elapsed().as_millis() as u64,
                        error: None,
                    });
                }
                Err(e) => {
                    let msg = e.to_string();
                    ok = false;
                    error = Some(format!("{}: {msg}", step.tool));
                    warn!(target: "skills::runner", "step {} failed: {msg}", step.tool);
                    steps.push(SkillStepResult {
                        tool: step.tool.clone(),
                        ok: false,
                        data: Value::Null,
                        duration_ms: step_started.elapsed().as_millis() as u64,
                        error: Some(msg),
                    });
                    break;
                }
            }
        }

        Ok(SkillRunResult {
            skill: skill.name.clone(),
            ok,
            steps,
            vars,
            duration_ms: started.elapsed().as_millis() as u64,
            error,
        })
    }
}

// ── Tools ───────────────────────────────────────────────────────────────

/// `create_skill` — write a skill definition to disk.
pub struct CreateSkillTool {
    config: Arc<Config>,
}

impl CreateSkillTool {
    pub fn new(config: Arc<Config>) -> Self {
        Self { config }
    }
}

#[derive(Debug, Deserialize)]
struct CreateSkillArgs {
    /// Either a parsed skill definition or a YAML/JSON document string.
    #[serde(default)]
    skill: Option<SkillDef>,
    #[serde(default)]
    yaml: Option<String>,
    #[serde(default)]
    json: Option<String>,
    /// Overwrite if exists.
    #[serde(default)]
    overwrite: bool,
}

#[async_trait]
impl Tool for CreateSkillTool {
    fn schema(&self) -> ToolSchema {
        ToolSchema {
            name: "create_skill".into(),
            description: "Save a skill recipe to disk.".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "skill": {"type": "object"},
                    "yaml": {"type": "string"},
                    "json": {"type": "string"},
                    "overwrite": {"type": "boolean", "default": false}
                }
            }),
            output_schema: serde_json::json!({"type": "object"}),
            requires_api_key: None,
            requires_browser: false,
        }
    }

    async fn execute(&self, args: ToolArgs) -> Result<ToolOutput> {
        let parsed: CreateSkillArgs = serde_json::from_value(args)
            .map_err(|e| CrawlError::InvalidArg(format!("invalid create_skill args: {e}")))?;
        let skill = match (parsed.skill, parsed.yaml, parsed.json) {
            (Some(s), _, _) => s.validated()?,
            (None, Some(y), _) => SkillDef::from_yaml(&y)?,
            (None, None, Some(j)) => SkillDef::from_json(&j)?,
            (None, None, None) => {
                return Err(CrawlError::MissingArg(
                    "one of `skill`, `yaml`, or `json` is required".into(),
                ));
            }
        };
        let dir = self.config.skills_dir()?;
        let target = dir.join(format!("{}.yaml", skill.name));
        if target.exists() && !parsed.overwrite {
            return Err(CrawlError::InvalidArg(format!(
                "skill '{}' already exists at {} (pass overwrite=true to replace)",
                skill.name,
                target.display()
            )));
        }
        let path = save_skill(&dir, &skill)?;
        Ok(ToolOutput::json(serde_json::json!({
            "ok": true,
            "name": skill.name,
            "path": path.display().to_string(),
        })))
    }
}

/// `run_skill` — load and execute a skill against a registry.
pub struct RunSkillTool {
    config: Arc<Config>,
    registry: Arc<ToolRegistry>,
}

impl RunSkillTool {
    pub fn new(config: Arc<Config>, registry: Arc<ToolRegistry>) -> Self {
        Self { config, registry }
    }
}

#[derive(Debug, Deserialize)]
struct RunSkillArgs {
    name: String,
    #[serde(default)]
    inputs: Map<String, Value>,
}

#[async_trait]
impl Tool for RunSkillTool {
    fn schema(&self) -> ToolSchema {
        ToolSchema {
            name: "run_skill".into(),
            description: "Run a saved skill by name. Inputs satisfy declared parameters.".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "required": ["name"],
                "properties": {
                    "name": {"type": "string"},
                    "inputs": {"type": "object"}
                }
            }),
            output_schema: serde_json::json!({"type": "object"}),
            requires_api_key: None,
            requires_browser: false,
        }
    }

    async fn execute(&self, args: ToolArgs) -> Result<ToolOutput> {
        let parsed: RunSkillArgs = serde_json::from_value(args)
            .map_err(|e| CrawlError::InvalidArg(format!("invalid run_skill args: {e}")))?;
        let dir = self.config.skills_dir()?;
        let skill = load_skill(&dir, &parsed.name)?;
        let runner = SkillRunner::new(self.registry.clone());
        let inputs: HashMap<String, Value> = parsed.inputs.into_iter().collect();
        let res = runner.run(&skill, inputs).await?;
        Ok(ToolOutput::json(serde_json::to_value(res)?))
    }
}

/// `list_skills` — return skills available in `skills_dir`.
pub struct ListSkillsTool {
    config: Arc<Config>,
}

impl ListSkillsTool {
    pub fn new(config: Arc<Config>) -> Self {
        Self { config }
    }
}

#[async_trait]
impl Tool for ListSkillsTool {
    fn schema(&self) -> ToolSchema {
        ToolSchema {
            name: "list_skills".into(),
            description: "List skills available in the configured skills directory.".into(),
            input_schema: serde_json::json!({"type": "object"}),
            output_schema: serde_json::json!({"type": "object"}),
            requires_api_key: None,
            requires_browser: false,
        }
    }

    async fn execute(&self, _args: ToolArgs) -> Result<ToolOutput> {
        let dir = self.config.skills_dir()?;
        let names = list_skill_names(&dir)?;
        let mut entries: Vec<Value> = Vec::with_capacity(names.len());
        for n in &names {
            match load_skill(&dir, n) {
                Ok(s) => entries.push(serde_json::json!({
                    "name": s.name,
                    "description": s.description,
                    "steps": s.steps.len(),
                    "inputs": s.inputs.len(),
                })),
                Err(_) => entries.push(serde_json::json!({
                    "name": n,
                    "error": "failed to load",
                })),
            }
        }
        Ok(ToolOutput::json(serde_json::json!({
            "dir": dir.display().to_string(),
            "count": entries.len(),
            "skills": entries,
        })))
    }
}

// ── Tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    struct EchoTool {
        name: &'static str,
    }

    #[async_trait]
    impl Tool for EchoTool {
        fn schema(&self) -> ToolSchema {
            ToolSchema {
                name: self.name.into(),
                description: "echo".into(),
                input_schema: serde_json::json!({"type": "object"}),
                output_schema: serde_json::json!({"type": "object"}),
                requires_api_key: None,
                requires_browser: false,
            }
        }
        async fn execute(&self, args: ToolArgs) -> Result<ToolOutput> {
            Ok(ToolOutput::json(serde_json::json!({
                "tool": self.name,
                "received": args,
            })))
        }
    }

    fn registry_with(tools: Vec<Arc<dyn Tool>>) -> Arc<ToolRegistry> {
        let mut reg = ToolRegistry::new();
        for t in tools {
            reg.register(t);
        }
        Arc::new(reg)
    }

    #[test]
    fn skill_schema_validates() {
        let yaml = r#"
name: example-skill
description: simple recipe
inputs:
  - name: url
    type: string
    required: true
steps:
  - tool: scrape
    args:
      url: ${url}
    output: page
  - tool: extract
    args:
      url: ${url}
      selectors:
        title: h1
    output: data
"#;
        let s = SkillDef::from_yaml(yaml).expect("parses");
        assert_eq!(s.name, "example-skill");
        assert_eq!(s.steps.len(), 2);
        assert_eq!(s.inputs.len(), 1);
        assert!(s.inputs[0].required);
    }

    #[test]
    fn skill_rejects_invalid_name() {
        let yaml = "name: 'bad name'\nsteps:\n  - tool: scrape\n";
        assert!(SkillDef::from_yaml(yaml).is_err());
    }

    #[test]
    fn skill_requires_steps() {
        let yaml = "name: empty\nsteps: []\n";
        assert!(SkillDef::from_yaml(yaml).is_err());
    }

    #[test]
    fn skill_required_input_missing_errors() {
        let s = SkillDef {
            name: "x".into(),
            description: None,
            inputs: vec![SkillInput {
                name: "url".into(),
                r#type: "string".into(),
                required: true,
                default: None,
                description: None,
            }],
            steps: vec![SkillStep {
                tool: "scrape".into(),
                args: serde_json::json!({"url": "${url}"}),
                output: None,
            }],
        };
        let r = SkillRunner::resolve_inputs(&s, &HashMap::new());
        assert!(r.is_err());
    }

    #[tokio::test]
    async fn skill_runs_two_step_pipeline() {
        let reg = registry_with(vec![
            Arc::new(EchoTool { name: "scrape" }),
            Arc::new(EchoTool { name: "extract" }),
        ]);
        let skill = SkillDef {
            name: "demo".into(),
            description: None,
            inputs: vec![SkillInput {
                name: "url".into(),
                r#type: "string".into(),
                required: true,
                default: None,
                description: None,
            }],
            steps: vec![
                SkillStep {
                    tool: "scrape".into(),
                    args: serde_json::json!({"url": "${url}"}),
                    output: Some("page".into()),
                },
                SkillStep {
                    tool: "extract".into(),
                    args: serde_json::json!({"prev": "${page}", "src": "${url}"}),
                    output: Some("data".into()),
                },
            ],
        };
        let runner = SkillRunner::new(reg);
        let mut inputs = HashMap::new();
        inputs.insert(
            "url".to_string(),
            Value::String("https://example.com".into()),
        );
        let res = runner.run(&skill, inputs).await.expect("runs");
        assert!(res.ok, "skill should succeed: {:?}", res.error);
        assert_eq!(res.steps.len(), 2);
        assert_eq!(res.steps[0].data["received"]["url"], "https://example.com");
        assert_eq!(res.steps[1].data["received"]["src"], "https://example.com");
        assert_eq!(res.steps[1].data["received"]["prev"]["tool"], "scrape");
    }

    #[tokio::test]
    async fn skill_save_load_roundtrip() {
        let dir = TempDir::new().unwrap();
        let skill = SkillDef {
            name: "rt".into(),
            description: Some("d".into()),
            inputs: vec![],
            steps: vec![SkillStep {
                tool: "scrape".into(),
                args: serde_json::json!({}),
                output: None,
            }],
        };
        save_skill(dir.path(), &skill).unwrap();
        let loaded = load_skill(dir.path(), "rt").unwrap();
        assert_eq!(loaded, skill);
        let names = list_skill_names(dir.path()).unwrap();
        assert_eq!(names, vec!["rt"]);
    }

    #[tokio::test]
    async fn create_skill_tool_writes_yaml_file() {
        let dir = TempDir::new().unwrap();
        let cfg = Arc::new(Config {
            data_dir: Some(dir.path().to_path_buf()),
            ..Config::default()
        });
        let tool = CreateSkillTool::new(cfg.clone());
        let out = tool
            .execute(serde_json::json!({
                "yaml": "name: hello\nsteps:\n  - tool: scrape\n    args: {}\n",
            }))
            .await
            .unwrap();
        assert_eq!(out.data["ok"], true);
        assert_eq!(out.data["name"], "hello");
        let names = list_skill_names(&cfg.skills_dir().unwrap()).unwrap();
        assert_eq!(names, vec!["hello"]);
    }

    #[tokio::test]
    async fn run_skill_tool_executes_end_to_end() {
        let dir = TempDir::new().unwrap();
        let cfg = Arc::new(Config {
            data_dir: Some(dir.path().to_path_buf()),
            ..Config::default()
        });
        // Set up a skill on disk.
        let skill = SkillDef {
            name: "demo".into(),
            description: None,
            inputs: vec![],
            steps: vec![SkillStep {
                tool: "echo".into(),
                args: serde_json::json!({"k": "v"}),
                output: None,
            }],
        };
        save_skill(&cfg.skills_dir().unwrap(), &skill).unwrap();
        // Build a registry with an echo tool only.
        let reg = registry_with(vec![Arc::new(EchoTool { name: "echo" })]);
        let tool = RunSkillTool::new(cfg.clone(), reg);
        let out = tool
            .execute(serde_json::json!({"name": "demo"}))
            .await
            .unwrap();
        assert_eq!(out.data["ok"], true);
        assert_eq!(out.data["steps"][0]["data"]["received"]["k"], "v");
    }

    #[tokio::test]
    async fn list_skills_tool_returns_entries() {
        let dir = TempDir::new().unwrap();
        let cfg = Arc::new(Config {
            data_dir: Some(dir.path().to_path_buf()),
            ..Config::default()
        });
        let skill = SkillDef {
            name: "a".into(),
            description: Some("desc".into()),
            inputs: vec![],
            steps: vec![SkillStep {
                tool: "noop".into(),
                args: Value::Object(Default::default()),
                output: None,
            }],
        };
        save_skill(&cfg.skills_dir().unwrap(), &skill).unwrap();
        let tool = ListSkillsTool::new(cfg);
        let out = tool.execute(serde_json::json!({})).await.unwrap();
        assert_eq!(out.data["count"], 1);
        assert_eq!(out.data["skills"][0]["name"], "a");
    }
}
