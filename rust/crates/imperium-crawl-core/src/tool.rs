use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::Arc;

use crate::error::{CrawlError, Result};

/// Generic input arguments for a tool. Each tool defines its own typed input
/// via serde_json::Value parsing; this preserves the dynamic registry behavior
/// from the TypeScript source where Zod schemas drive the CLI.
pub type ToolArgs = serde_json::Value;

/// Generic output. Tools return either a structured JSON object or a streamed
/// result depending on their nature.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolOutput {
    pub data: serde_json::Value,
    #[serde(default)]
    pub meta: ToolMeta,
}

impl ToolOutput {
    pub fn json(value: serde_json::Value) -> Self {
        Self { data: value, meta: ToolMeta::default() }
    }
    pub fn with_duration(mut self, ms: u64) -> Self {
        self.meta.duration_ms = ms;
        self
    }
    pub fn with_stealth(mut self, s: impl Into<String>) -> Self {
        self.meta.stealth_level = Some(s.into());
        self
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ToolMeta {
    #[serde(default)]
    pub duration_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stealth_level: Option<String>,
    #[serde(default)]
    pub cached: bool,
}

/// JSON Schema export for a tool. Used by the CLI to auto-generate clap
/// commands and by an external HTTP API to expose the tool surface.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolSchema {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
    pub output_schema: serde_json::Value,
    /// Whether this tool requires an API key (e.g. Brave) — used by CLI gating.
    #[serde(default)]
    pub requires_api_key: Option<String>,
    /// Whether this tool requires a browser (Playwright/CamoFox).
    #[serde(default)]
    pub requires_browser: bool,
}

#[async_trait]
pub trait Tool: Send + Sync {
    fn schema(&self) -> ToolSchema;
    async fn execute(&self, args: ToolArgs) -> Result<ToolOutput>;
}

/// Thread-safe registry mapping tool names to implementations.
#[derive(Default, Clone)]
pub struct ToolRegistry {
    tools: BTreeMap<String, Arc<dyn Tool>>,
}

impl std::fmt::Debug for ToolRegistry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ToolRegistry")
            .field("tool_count", &self.tools.len())
            .field("tools", &self.tools.keys().collect::<Vec<_>>())
            .finish()
    }
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self { tools: BTreeMap::new() }
    }

    pub fn register(&mut self, tool: Arc<dyn Tool>) {
        let name = tool.schema().name;
        self.tools.insert(name, tool);
    }

    pub fn get(&self, name: &str) -> Option<Arc<dyn Tool>> {
        self.tools.get(name).cloned()
    }

    pub fn names(&self) -> Vec<String> {
        self.tools.keys().cloned().collect()
    }

    pub fn schemas(&self) -> Vec<ToolSchema> {
        self.tools.values().map(|t| t.schema()).collect()
    }

    pub fn len(&self) -> usize {
        self.tools.len()
    }

    pub fn is_empty(&self) -> bool {
        self.tools.is_empty()
    }

    pub async fn execute(&self, name: &str, args: ToolArgs) -> Result<ToolOutput> {
        let tool = self
            .get(name)
            .ok_or_else(|| CrawlError::ToolNotFound(name.to_string()))?;
        let start = std::time::Instant::now();
        let mut out = tool.execute(args).await?;
        if out.meta.duration_ms == 0 {
            out.meta.duration_ms = start.elapsed().as_millis() as u64;
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct EchoTool;
    #[async_trait]
    impl Tool for EchoTool {
        fn schema(&self) -> ToolSchema {
            ToolSchema {
                name: "echo".into(),
                description: "echoes input".into(),
                input_schema: serde_json::json!({"type":"object"}),
                output_schema: serde_json::json!({"type":"object"}),
                requires_api_key: None,
                requires_browser: false,
            }
        }
        async fn execute(&self, args: ToolArgs) -> Result<ToolOutput> {
            Ok(ToolOutput::json(args))
        }
    }

    #[tokio::test]
    async fn registry_register_and_execute() {
        let mut reg = ToolRegistry::new();
        reg.register(Arc::new(EchoTool));
        assert_eq!(reg.len(), 1);
        let out = reg
            .execute("echo", serde_json::json!({"hello":"world"}))
            .await
            .unwrap();
        assert_eq!(out.data["hello"], "world");
    }

    #[tokio::test]
    async fn registry_missing_tool() {
        let reg = ToolRegistry::new();
        let err = reg.execute("nope", serde_json::Value::Null).await.unwrap_err();
        assert!(matches!(err, CrawlError::ToolNotFound(_)));
    }
}
