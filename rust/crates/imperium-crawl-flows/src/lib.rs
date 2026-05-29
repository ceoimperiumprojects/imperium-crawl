//! Imperium Flow recorder + executor (Sprint 15).
//!
//! A *flow* is a sequence of tool invocations stored as YAML or JSON. Each
//! step calls a tool by name from the `ToolRegistry`; outputs can be
//! captured under a variable name and referenced by later steps via
//! `${variable}` substitution.
//!
//! Modules:
//! - [`schema`] — `Flow`, `FlowStep`, `FlowRunResult` types + YAML/JSON parse.
//! - [`runner`] — `FlowRunner` that executes a flow against a `ToolRegistry`.
//! - [`recorder`] — builder that records tool invocations into a `Flow`.
//! - [`storage`] — `FlowStore::{load, save, list}` filesystem helpers.
//! - [`flow_tools`] — `Tool` wrappers exposing the engine to the registry.
//!
//! The CDP-driven browser recorder from the TypeScript implementation is
//! intentionally out of scope for this sprint — it will be ported alongside
//! the chromiumoxide engine in a later sprint.

use std::sync::Arc;

use imperium_crawl_core::{Config, Result, ToolRegistry};

pub mod flow_tools;
pub mod recorder;
pub mod runner;
pub mod schema;
pub mod storage;

pub use recorder::FlowRecorder;
pub use runner::{interpolate, FlowRunner};
pub use schema::{Flow, FlowRunResult, FlowStep, FlowStepResult};
pub use storage::FlowStore;

/// Parse + validate a YAML flow document. Returns the parsed `Flow`.
pub fn validate(flow_yaml: &str) -> Result<Flow> {
    Flow::from_yaml(flow_yaml)
}

/// Register every flow-engine tool (`record_flow`, `run_flow`, `list_flows`,
/// `inspect_flow`, `validate_flow`) into the given registry. The tools share
/// a reference to the supplied registry so `run_flow` can dispatch into
/// other tools.
///
/// Note: the registry passed in is what `run_flow` invokes against — callers
/// typically register the flow tools into the same registry that already
/// holds the rest of the tool surface.
pub fn register_flow_tools(
    registry: &mut ToolRegistry,
    config: Arc<Config>,
    dispatch: Arc<ToolRegistry>,
) {
    registry.register(Arc::new(flow_tools::RecordFlowTool));
    registry.register(Arc::new(flow_tools::RunFlowTool::new(
        config.clone(),
        dispatch,
    )));
    registry.register(Arc::new(flow_tools::ListFlowsTool::new(config.clone())));
    registry.register(Arc::new(flow_tools::InspectFlowTool::new(config.clone())));
    registry.register(Arc::new(flow_tools::ValidateFlowTool::new(config)));
}
