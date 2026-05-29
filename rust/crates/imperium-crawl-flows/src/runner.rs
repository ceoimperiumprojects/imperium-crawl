//! FlowRunner — executes a `Flow` against a `ToolRegistry`, interpolating
//! `${variable}` references at each step.
//!
//! Interpolation rules:
//! - A string whose **entire content** is `${var}` is replaced with the
//!   variable's JSON value (preserving the original type: number, object, …).
//! - A string with one or more **embedded** `${var}` substrings has each
//!   reference replaced via string substitution; non-string values are
//!   stringified via `serde_json::to_string` and trimmed of surrounding
//!   quotes if the original value was a JSON string.
//! - Arrays and objects are walked recursively.
//! - Unknown variables produce `CrawlError::InvalidArg`.
//!
//! Dotted-path lookup (e.g. `${page.url}`) is supported: the part before the
//! first `.` selects a variable, remaining segments index into the stored
//! JSON value via `serde_json::Value::pointer`.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use imperium_crawl_core::{CrawlError, Result, ToolRegistry};
use serde_json::{Map, Value};
use tracing::{debug, warn};

use crate::schema::{Flow, FlowRunResult, FlowStep, FlowStepResult};

/// Runs flows by dispatching steps into a `ToolRegistry`.
pub struct FlowRunner {
    registry: Arc<ToolRegistry>,
    vars: Map<String, Value>,
}

impl FlowRunner {
    /// Construct a runner with an empty variable map.
    pub fn new(registry: Arc<ToolRegistry>) -> Self {
        Self { registry, vars: Map::new() }
    }

    /// Seed initial variables that override `Flow.vars`.
    pub fn with_vars(mut self, vars: HashMap<String, Value>) -> Self {
        for (k, v) in vars {
            self.vars.insert(k, v);
        }
        self
    }

    /// Access the current variable bag (after running).
    pub fn vars(&self) -> &Map<String, Value> {
        &self.vars
    }

    /// Execute the flow sequentially. Each step's result is recorded; if a
    /// step fails after exhausting its retries, the overall run is marked
    /// failed and remaining steps are skipped.
    pub async fn run(&mut self, flow: &Flow) -> Result<FlowRunResult> {
        // Merge flow-defined defaults under runtime overrides.
        for (k, v) in &flow.vars {
            self.vars.entry(k.clone()).or_insert_with(|| v.clone());
        }

        let started = Instant::now();
        let mut step_results: Vec<FlowStepResult> = Vec::with_capacity(flow.steps.len());
        let mut ok = true;
        let mut run_error: Option<String> = None;

        for (index, step) in flow.steps.iter().enumerate() {
            let label = step
                .id
                .clone()
                .unwrap_or_else(|| format!("step[{index}]:{}", step.tool));
            debug!(target: "flows::runner", "running {label}");

            let result = self.run_step(step).await;
            let attempts = result.attempts;
            match result.outcome {
                Ok(data) => {
                    if let Some(var) = &step.output_var {
                        self.vars.insert(var.clone(), data.clone());
                    }
                    // Optional expect assertion.
                    if let Some(expected) = &step.expect {
                        let resolved = interpolate(expected, &self.vars)?;
                        if resolved != data {
                            ok = false;
                            let msg = format!(
                                "expectation failed in {label}: got {data}, want {resolved}"
                            );
                            run_error = Some(msg.clone());
                            step_results.push(FlowStepResult {
                                tool: step.tool.clone(),
                                id: step.id.clone(),
                                ok: false,
                                data,
                                duration_ms: result.duration_ms,
                                attempts,
                                error: Some(msg),
                            });
                            break;
                        }
                    }
                    step_results.push(FlowStepResult {
                        tool: step.tool.clone(),
                        id: step.id.clone(),
                        ok: true,
                        data,
                        duration_ms: result.duration_ms,
                        attempts,
                        error: None,
                    });
                }
                Err(e) => {
                    ok = false;
                    let msg = e.to_string();
                    warn!(target: "flows::runner", "step {label} failed: {msg}");
                    run_error = Some(format!("{label}: {msg}"));
                    step_results.push(FlowStepResult {
                        tool: step.tool.clone(),
                        id: step.id.clone(),
                        ok: false,
                        data: Value::Null,
                        duration_ms: result.duration_ms,
                        attempts,
                        error: Some(msg),
                    });
                    break;
                }
            }
        }

        Ok(FlowRunResult {
            flow: flow.name.clone(),
            ok,
            steps: step_results,
            vars: self.vars.clone(),
            duration_ms: started.elapsed().as_millis() as u64,
            error: run_error,
        })
    }

    async fn run_step(&self, step: &FlowStep) -> StepOutcome {
        let started = Instant::now();
        let max_attempts = step.retry.saturating_add(1);
        let mut attempts: u32 = 0;
        let mut last_err: Option<CrawlError> = None;

        // Interpolate the args once per attempt — variable state doesn't
        // change between attempts so doing it once is sufficient.
        let interpolated = match interpolate(&step.args, &self.vars) {
            Ok(v) => v,
            Err(e) => {
                return StepOutcome {
                    outcome: Err(e),
                    duration_ms: started.elapsed().as_millis() as u64,
                    attempts: 0,
                };
            }
        };

        while attempts < max_attempts {
            attempts += 1;
            match self.registry.execute(&step.tool, interpolated.clone()).await {
                Ok(out) => {
                    return StepOutcome {
                        outcome: Ok(out.data),
                        duration_ms: started.elapsed().as_millis() as u64,
                        attempts,
                    };
                }
                Err(e) => {
                    last_err = Some(e);
                }
            }
        }

        let err = last_err.unwrap_or_else(|| CrawlError::Other("step failed".into()));
        StepOutcome {
            outcome: Err(err),
            duration_ms: started.elapsed().as_millis() as u64,
            attempts,
        }
    }
}

struct StepOutcome {
    outcome: std::result::Result<Value, CrawlError>,
    duration_ms: u64,
    attempts: u32,
}

// ── Variable interpolation ──

/// Recursively replace `${var}` references in `value` using the supplied
/// variable map. See module docs for substitution rules.
pub fn interpolate(value: &Value, vars: &Map<String, Value>) -> Result<Value> {
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
        // Numbers, bools, nulls — passthrough.
        _ => Ok(value.clone()),
    }
}

fn interpolate_string(s: &str, vars: &Map<String, Value>) -> Result<Value> {
    // Fast path: no `${` at all.
    if !s.contains("${") {
        return Ok(Value::String(s.to_string()));
    }

    // Whole-string interpolation: `${var}` exactly. Preserve type.
    if let Some(name) = parse_whole_ref(s) {
        return resolve_ref(&name, vars);
    }

    // Embedded substitution: replace each `${...}` occurrence with the
    // stringified variable value.
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
            // Make sure no other `${` inside — i.e. exactly one reference.
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
            // Build JSON pointer: split remaining by `.` and prepend `/`.
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
        // Compact JSON for arrays / objects so embedded substitution stays
        // representable as one line.
        _ => serde_json::to_string(v).unwrap_or_else(|_| String::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use imperium_crawl_core::{Tool, ToolArgs, ToolOutput, ToolSchema};

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

    struct FailingTool;

    #[async_trait]
    impl Tool for FailingTool {
        fn schema(&self) -> ToolSchema {
            ToolSchema {
                name: "fail".into(),
                description: "always fails".into(),
                input_schema: serde_json::json!({}),
                output_schema: serde_json::json!({}),
                requires_api_key: None,
                requires_browser: false,
            }
        }
        async fn execute(&self, _: ToolArgs) -> Result<ToolOutput> {
            Err(CrawlError::Other("boom".into()))
        }
    }

    fn registry_with_tools(tools: Vec<Arc<dyn Tool>>) -> Arc<ToolRegistry> {
        let mut reg = ToolRegistry::new();
        for t in tools {
            reg.register(t);
        }
        Arc::new(reg)
    }

    #[tokio::test]
    async fn run_simple_two_step_flow() {
        let reg = registry_with_tools(vec![
            Arc::new(EchoTool { name: "step1" }),
            Arc::new(EchoTool { name: "step2" }),
        ]);
        let flow = Flow {
            name: "demo".into(),
            description: None,
            version: 1,
            vars: Map::new(),
            steps: vec![
                FlowStep {
                    id: None,
                    tool: "step1".into(),
                    args: serde_json::json!({"hello": "world"}),
                    output_var: Some("step1_output".into()),
                    expect: None,
                    retry: 0,
                },
                FlowStep {
                    id: None,
                    tool: "step2".into(),
                    args: serde_json::json!({"prev": "${step1_output}"}),
                    output_var: Some("step2_output".into()),
                    expect: None,
                    retry: 0,
                },
            ],
        };
        let mut runner = FlowRunner::new(reg);
        let res = runner.run(&flow).await.expect("runs");
        assert!(res.ok, "run ok, got: {:?}", res.error);
        assert_eq!(res.steps.len(), 2);
        let step2_received = &res.steps[1].data["received"]["prev"];
        // step1's tool output should appear here as a structured object.
        assert_eq!(step2_received["tool"], "step1");
        assert_eq!(step2_received["received"]["hello"], "world");
    }

    #[tokio::test]
    async fn unknown_variable_errors() {
        let reg = registry_with_tools(vec![Arc::new(EchoTool { name: "echo" })]);
        let flow = Flow {
            name: "demo".into(),
            description: None,
            version: 1,
            vars: Map::new(),
            steps: vec![FlowStep {
                id: None,
                tool: "echo".into(),
                args: serde_json::json!({"x": "${missing}"}),
                output_var: None,
                expect: None,
                retry: 0,
            }],
        };
        let mut runner = FlowRunner::new(reg);
        let res = runner.run(&flow).await.unwrap();
        assert!(!res.ok);
        let err = res.error.unwrap_or_default();
        assert!(err.contains("unknown variable"), "got: {err}");
    }

    #[tokio::test]
    async fn step_failure_propagates() {
        let reg = registry_with_tools(vec![
            Arc::new(EchoTool { name: "ok" }),
            Arc::new(FailingTool),
        ]);
        let flow = Flow {
            name: "fail".into(),
            description: None,
            version: 1,
            vars: Map::new(),
            steps: vec![
                FlowStep {
                    id: Some("first".into()),
                    tool: "ok".into(),
                    args: serde_json::json!({}),
                    output_var: None,
                    expect: None,
                    retry: 0,
                },
                FlowStep {
                    id: Some("second".into()),
                    tool: "fail".into(),
                    args: serde_json::json!({}),
                    output_var: None,
                    expect: None,
                    retry: 1,
                },
            ],
        };
        let mut runner = FlowRunner::new(reg);
        let res = runner.run(&flow).await.unwrap();
        assert!(!res.ok);
        assert_eq!(res.steps.len(), 2);
        assert!(res.steps[0].ok);
        assert!(!res.steps[1].ok);
        // retried once → attempts = 2
        assert_eq!(res.steps[1].attempts, 2);
    }

    #[test]
    fn interpolate_preserves_types_for_whole_ref() {
        let mut vars = Map::new();
        vars.insert("count".into(), Value::Number(42.into()));
        let input = serde_json::json!({"n": "${count}"});
        let out = interpolate(&input, &vars).unwrap();
        assert_eq!(out["n"], Value::Number(42.into()));
    }

    #[test]
    fn interpolate_embedded_string_substitution() {
        let mut vars = Map::new();
        vars.insert("name".into(), Value::String("pavle".into()));
        let input = serde_json::json!({"greeting": "hello ${name}!"});
        let out = interpolate(&input, &vars).unwrap();
        assert_eq!(out["greeting"], "hello pavle!");
    }

    #[test]
    fn interpolate_dotted_path() {
        let mut vars = Map::new();
        vars.insert(
            "page".into(),
            serde_json::json!({"url": "https://example.com"}),
        );
        let input = serde_json::json!({"target": "${page.url}"});
        let out = interpolate(&input, &vars).unwrap();
        assert_eq!(out["target"], "https://example.com");
    }
}
