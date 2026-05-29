//! LLM provider abstraction. Sprint 14 — port `../src/llm/`.
//!
//! Public API:
//! - [`LlmClient`] — provider-agnostic trait with `complete` + `complete_json`.
//! - [`AnthropicClient`], [`OpenAiClient`], [`MiniMaxClient`] — implementations.
//! - [`build_client_from_config`] — factory that reads `Config`.
//! - [`extractor`] — schema-driven JSON extraction over arbitrary content.
//! - [`retry`] — full-jitter exponential backoff helper.

use async_trait::async_trait;
use imperium_crawl_core::{CrawlError, Result};

#[cfg(feature = "anthropic")]
pub mod anthropic;
pub mod client;
pub mod extractor;
#[cfg(feature = "minimax")]
pub mod minimax;
#[cfg(feature = "openai")]
pub mod openai;
pub mod retry;

#[cfg(feature = "anthropic")]
pub use anthropic::AnthropicClient;
#[cfg(feature = "minimax")]
pub use minimax::MiniMaxClient;
#[cfg(feature = "openai")]
pub use openai::OpenAiClient;

pub use client::build_client_from_config;
pub use extractor::{extract_with_schema, parse_json_from_llm_response, ExtractionResult};

/// Default content truncation budget (~30k tokens, safe for most models).
pub const DEFAULT_MAX_CONTENT_CHARS: usize = 120_000;

/// Default max output tokens per LLM call.
pub const DEFAULT_MAX_OUTPUT_TOKENS: u32 = 2000;

/// Message role for chat-style LLM calls.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    System,
    User,
    Assistant,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Role::System => "system",
            Role::User => "user",
            Role::Assistant => "assistant",
        }
    }
}

/// Single chat message.
#[derive(Debug, Clone)]
pub struct LlmMessage {
    pub role: Role,
    pub content: String,
}

impl LlmMessage {
    pub fn system(content: impl Into<String>) -> Self {
        Self { role: Role::System, content: content.into() }
    }
    pub fn user(content: impl Into<String>) -> Self {
        Self { role: Role::User, content: content.into() }
    }
    pub fn assistant(content: impl Into<String>) -> Self {
        Self { role: Role::Assistant, content: content.into() }
    }
}

/// Provider response. Mirrors the TS `LLMResponse`.
#[derive(Debug, Clone, Default)]
pub struct LlmResponse {
    pub text: String,
    pub model: String,
    pub input_tokens: Option<u32>,
    pub output_tokens: Option<u32>,
}

/// Provider-agnostic chat client.
///
/// The default [`LlmClient::complete_json`] implementation augments the prompt
/// with the supplied JSON schema, calls [`complete`](LlmClient::complete),
/// strips code fences, and parses JSON.
#[async_trait]
pub trait LlmClient: Send + Sync {
    fn provider_name(&self) -> &'static str;

    fn default_model(&self) -> &str;

    /// Single-turn completion with a plain text prompt.
    async fn complete(&self, prompt: &str) -> Result<String> {
        let resp = self
            .complete_messages(&[LlmMessage::user(prompt.to_string())], DEFAULT_MAX_OUTPUT_TOKENS)
            .await?;
        Ok(resp.text)
    }

    /// Multi-turn completion. Providers MUST implement this.
    async fn complete_messages(
        &self,
        messages: &[LlmMessage],
        max_tokens: u32,
    ) -> Result<LlmResponse>;

    /// Schema-augmented JSON completion. Default impl wraps `complete`.
    async fn complete_json(
        &self,
        prompt: &str,
        schema: &serde_json::Value,
    ) -> Result<serde_json::Value> {
        let augmented = format!(
            "Return a JSON object matching this schema:\n{}\n\nTask:\n{}\n\nReturn ONLY the JSON object, no markdown fences, no commentary.",
            serde_json::to_string_pretty(schema).unwrap_or_else(|_| "{}".into()),
            prompt
        );
        let raw = self.complete(&augmented).await?;
        let trimmed = strip_code_fence(&raw);
        serde_json::from_str(&trimmed)
            .map_err(|e| CrawlError::Llm(format!("JSON parse: {e} — raw: {trimmed}")))
    }
}

/// Strip a single leading ```json or ``` fence (and the trailing ```) from `s`.
/// Returns the inner content trimmed, or the original string when no fence.
pub fn strip_code_fence(s: &str) -> String {
    let s = s.trim();
    if let Some(rest) = s.strip_prefix("```json") {
        if let Some(end) = rest.rfind("```") {
            return rest[..end].trim().to_string();
        }
    }
    if let Some(rest) = s.strip_prefix("```") {
        if let Some(end) = rest.rfind("```") {
            return rest[..end].trim().to_string();
        }
    }
    s.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_fence_with_json_tag() {
        let s = "```json\n{\"a\":1}\n```";
        assert_eq!(strip_code_fence(s), "{\"a\":1}");
    }

    #[test]
    fn strip_fence_without_tag() {
        let s = "```\n{\"a\":1}\n```";
        assert_eq!(strip_code_fence(s), "{\"a\":1}");
    }

    #[test]
    fn strip_fence_no_fence() {
        let s = "{\"a\":1}";
        assert_eq!(strip_code_fence(s), "{\"a\":1}");
    }

    #[test]
    fn role_as_str_matches_api() {
        assert_eq!(Role::System.as_str(), "system");
        assert_eq!(Role::User.as_str(), "user");
        assert_eq!(Role::Assistant.as_str(), "assistant");
    }

    #[test]
    fn llm_message_builders() {
        let m = LlmMessage::user("hi");
        assert_eq!(m.role, Role::User);
        assert_eq!(m.content, "hi");
    }
}
