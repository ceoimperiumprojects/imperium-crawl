//! FlowRecorder — captures executed tool steps into a `Flow` definition.
//!
//! This is the lightweight pipeline-style recorder. The CDP-driven browser
//! recorder (`smart-target` extraction, network/navigation events) will be
//! ported in a later sprint together with the chromiumoxide engine.

use serde_json::Value;

use crate::schema::{Flow, FlowStep};

/// Builder that accumulates tool invocations and finalizes into a `Flow`.
pub struct FlowRecorder {
    name: String,
    description: Option<String>,
    steps: Vec<FlowStep>,
    auto_id: usize,
}

impl FlowRecorder {
    /// Create a new recorder with the given flow name.
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            description: None,
            steps: Vec::new(),
            auto_id: 0,
        }
    }

    /// Set an optional human description for the flow.
    pub fn with_description(mut self, desc: impl Into<String>) -> Self {
        self.description = Some(desc.into());
        self
    }

    /// Record a single tool invocation. The `output` parameter, if present,
    /// becomes the step's `output_var`. The step id is auto-generated based
    /// on the tool name and execution order (e.g. `scrape_0`).
    pub fn record_step(
        &mut self,
        tool: impl Into<String>,
        args: Value,
        output: Option<String>,
    ) -> &mut Self {
        let tool = tool.into();
        let id = format!("{tool}_{}", self.auto_id);
        self.auto_id += 1;
        self.steps.push(FlowStep {
            id: Some(id),
            tool,
            args,
            output_var: output,
            expect: None,
            retry: 0,
        });
        self
    }

    /// Number of steps recorded so far.
    pub fn len(&self) -> usize {
        self.steps.len()
    }

    /// Whether nothing has been recorded yet.
    pub fn is_empty(&self) -> bool {
        self.steps.is_empty()
    }

    /// Finalize into a `Flow`. Note: the result is not auto-validated; call
    /// `Flow::validated()` if you need to assert structural invariants
    /// (e.g. that at least one step exists).
    pub fn finalize(self) -> Flow {
        Flow {
            name: self.name,
            description: self.description,
            version: 1,
            vars: Default::default(),
            steps: self.steps,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_steps_and_finalizes() {
        let mut rec = FlowRecorder::new("demo").with_description("test recording");
        rec.record_step(
            "scrape",
            serde_json::json!({"url": "https://example.com"}),
            Some("page".into()),
        );
        rec.record_step(
            "extract",
            serde_json::json!({"url": "${page.url}"}),
            Some("data".into()),
        );
        assert_eq!(rec.len(), 2);
        let flow = rec.finalize();
        assert_eq!(flow.name, "demo");
        assert_eq!(flow.steps.len(), 2);
        assert_eq!(flow.steps[0].tool, "scrape");
        assert_eq!(flow.steps[0].id.as_deref(), Some("scrape_0"));
        assert_eq!(flow.steps[1].output_var.as_deref(), Some("data"));
    }

    #[test]
    fn finalize_yields_valid_flow_when_steps_present() {
        let mut rec = FlowRecorder::new("v");
        rec.record_step("scrape", serde_json::json!({}), None);
        let f = rec.finalize();
        f.validated().expect("valid");
    }
}
