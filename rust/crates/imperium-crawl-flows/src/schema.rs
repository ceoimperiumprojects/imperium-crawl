//! Flow schema — defines the structure of a "flow" file.
//!
//! A flow is a sequence of named tool invocations. Each step's output may be
//! captured in a variable that subsequent steps can reference via
//! `${variable}` interpolation. Flows are stored as YAML or JSON.
//!
//! The schema deliberately does not couple to the heavier `FlowDefinition`
//! used by the browser recorder (see `../../../../src/flows/types.ts`). The
//! lightweight model here mirrors the simple "tool pipeline" portion of the
//! TypeScript engine — the smart-target browser flows will be ported in a
//! later sprint together with the chromiumoxide recorder.

use serde::{Deserialize, Serialize};

use imperium_crawl_core::{CrawlError, Result};

/// A flow: an ordered list of tool steps with optional default variables.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Flow {
    /// Human-readable identifier. Must match `^[a-zA-Z0-9_-]+$`.
    pub name: String,

    /// Optional free-form description.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    /// Schema version. Defaults to 1.
    #[serde(default = "default_version")]
    pub version: u32,

    /// Default variable values available to all steps from the start. May be
    /// overridden at run time by `FlowRunner::with_vars`.
    #[serde(default)]
    pub vars: serde_json::Map<String, serde_json::Value>,

    /// Steps executed in order.
    #[serde(default)]
    pub steps: Vec<FlowStep>,
}

fn default_version() -> u32 {
    1
}

/// One step in a flow.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FlowStep {
    /// Optional human-readable id for the step (used in logs and errors).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,

    /// Name of the tool in the registry to invoke.
    pub tool: String,

    /// Arguments to the tool. Strings may contain `${variable}` references.
    #[serde(default = "default_args")]
    pub args: serde_json::Value,

    /// Variable name to bind the tool's output to. The full `ToolOutput.data`
    /// JSON value is stored under this key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_var: Option<String>,

    /// Optional expectation. If set, the runner asserts the tool output's
    /// `data` field equals this value (after variable substitution) before
    /// continuing. Useful for smoke tests.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expect: Option<serde_json::Value>,

    /// Number of retry attempts on failure. Default 0.
    #[serde(default)]
    pub retry: u32,
}

fn default_args() -> serde_json::Value {
    serde_json::Value::Object(Default::default())
}

impl Flow {
    /// Parse a flow from raw YAML text.
    pub fn from_yaml(text: &str) -> Result<Self> {
        serde_yaml::from_str::<Self>(text)
            .map_err(|e| CrawlError::Parse(format!("invalid flow yaml: {e}")))
            .and_then(|f| f.validated())
    }

    /// Parse a flow from raw JSON text.
    pub fn from_json(text: &str) -> Result<Self> {
        serde_json::from_str::<Self>(text)
            .map_err(|e| CrawlError::Parse(format!("invalid flow json: {e}")))
            .and_then(|f| f.validated())
    }

    /// Validate the flow's structural invariants.
    pub fn validated(self) -> Result<Self> {
        if self.name.trim().is_empty() {
            return Err(CrawlError::InvalidArg("flow.name is required".into()));
        }
        if !is_valid_name(&self.name) {
            return Err(CrawlError::InvalidArg(format!(
                "flow.name '{}' must match ^[a-zA-Z0-9_-]+$",
                self.name
            )));
        }
        if self.steps.is_empty() {
            return Err(CrawlError::InvalidArg(
                "flow must contain at least one step".into(),
            ));
        }
        for (i, step) in self.steps.iter().enumerate() {
            if step.tool.trim().is_empty() {
                return Err(CrawlError::InvalidArg(format!(
                    "step[{i}].tool is required"
                )));
            }
        }
        Ok(self)
    }

    /// Serialize to YAML.
    pub fn to_yaml(&self) -> Result<String> {
        serde_yaml::to_string(self)
            .map_err(|e| CrawlError::Other(format!("yaml serialize: {e}")))
    }

    /// Serialize to pretty JSON.
    pub fn to_json_pretty(&self) -> Result<String> {
        serde_json::to_string_pretty(self).map_err(CrawlError::from)
    }
}

fn is_valid_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Result of running a flow.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlowRunResult {
    pub flow: String,
    pub ok: bool,
    pub steps: Vec<FlowStepResult>,
    pub vars: serde_json::Map<String, serde_json::Value>,
    pub duration_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Per-step run result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlowStepResult {
    pub tool: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub ok: bool,
    pub data: serde_json::Value,
    pub duration_ms: u64,
    pub attempts: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_yaml_flow() {
        let yaml = r#"
name: example
description: simple two step flow
steps:
  - tool: scrape
    args:
      url: https://example.com
    output_var: page
  - tool: extract
    args:
      url: ${page.url}
      selectors:
        title: h1
    output_var: data
"#;
        let f = Flow::from_yaml(yaml).expect("yaml parses");
        assert_eq!(f.name, "example");
        assert_eq!(f.steps.len(), 2);
        assert_eq!(f.steps[0].tool, "scrape");
        assert_eq!(f.steps[1].output_var.as_deref(), Some("data"));
        assert_eq!(f.version, 1);
    }

    #[test]
    fn parse_json_flow() {
        let json = r#"{
            "name": "ex",
            "version": 1,
            "steps": [
                {"tool":"scrape","args":{"url":"https://example.com"},"output_var":"page"}
            ]
        }"#;
        let f = Flow::from_json(json).expect("json parses");
        assert_eq!(f.name, "ex");
        assert_eq!(f.steps.len(), 1);
    }

    #[test]
    fn rejects_invalid_name() {
        let yaml = "name: 'bad name with spaces'\nsteps:\n  - tool: scrape\n";
        assert!(Flow::from_yaml(yaml).is_err());
    }

    #[test]
    fn rejects_empty_steps() {
        let yaml = "name: ok\nsteps: []\n";
        assert!(Flow::from_yaml(yaml).is_err());
    }

    #[test]
    fn yaml_roundtrip_preserves_structure() {
        let original = Flow {
            name: "rt".into(),
            description: Some("round trip".into()),
            version: 1,
            vars: serde_json::Map::new(),
            steps: vec![FlowStep {
                id: Some("s1".into()),
                tool: "scrape".into(),
                args: serde_json::json!({"url":"https://example.com"}),
                output_var: Some("page".into()),
                expect: None,
                retry: 0,
            }],
        };
        let yaml = original.to_yaml().unwrap();
        let parsed = Flow::from_yaml(&yaml).unwrap();
        assert_eq!(original, parsed);
    }
}
