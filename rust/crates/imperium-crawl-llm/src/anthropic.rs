//! Anthropic Claude provider via reqwest (no official Rust SDK).
//!
//! Port of `../src/llm/providers/anthropic.ts`. Endpoint:
//! `POST https://api.anthropic.com/v1/messages`. Headers carry
//! `x-api-key` + `anthropic-version: 2023-06-01`.

use async_trait::async_trait;
use imperium_crawl_core::{CrawlError, Result};
use serde_json::json;

use crate::retry::{with_retry, DEFAULT_BASE_DELAY_MS, DEFAULT_MAX_ATTEMPTS};
use crate::{LlmClient, LlmMessage, LlmResponse, Role};

const ANTHROPIC_API_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";

/// Default Anthropic model. Matches TS index.ts (`claude-haiku-4-5-20251001`).
/// Pavle's env may override via `LLM_MODEL`.
pub const ANTHROPIC_DEFAULT_MODEL: &str = "claude-haiku-4-5-20251001";

pub struct AnthropicClient {
    api_key: String,
    model: String,
    base_url: String,
    client: reqwest::Client,
}

impl AnthropicClient {
    pub fn new(api_key: impl Into<String>, model: impl Into<String>) -> Self {
        Self {
            api_key: api_key.into(),
            model: model.into(),
            base_url: ANTHROPIC_API_URL.to_string(),
            client: reqwest::Client::new(),
        }
    }

    pub fn with_default_model(api_key: impl Into<String>) -> Self {
        Self::new(api_key, ANTHROPIC_DEFAULT_MODEL)
    }

    /// Override the base URL — primarily for wiremock tests.
    pub fn with_base_url(mut self, base_url: impl Into<String>) -> Self {
        self.base_url = base_url.into();
        self
    }

    async fn call_once(
        &self,
        messages: &[LlmMessage],
        max_tokens: u32,
    ) -> Result<LlmResponse> {
        // Anthropic separates system messages from the messages array.
        let system: String = messages
            .iter()
            .filter(|m| m.role == Role::System)
            .map(|m| m.content.as_str())
            .collect::<Vec<_>>()
            .join("\n");

        let chat: Vec<_> = messages
            .iter()
            .filter(|m| m.role != Role::System)
            .map(|m| json!({ "role": m.role.as_str(), "content": m.content }))
            .collect();

        let mut body = json!({
            "model": self.model,
            "max_tokens": max_tokens,
            "messages": chat,
        });
        if !system.is_empty() {
            body["system"] = json!(system);
        }

        let res = self
            .client
            .post(&self.base_url)
            .header("content-type", "application/json")
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", ANTHROPIC_VERSION)
            .json(&body)
            .send()
            .await
            .map_err(|e| CrawlError::Network(format!("Anthropic request: {e}")))?;

        let status = res.status();
        if !status.is_success() {
            let text = res.text().await.unwrap_or_default();
            return Err(CrawlError::Llm(format!(
                "Anthropic API error {}: {}",
                status.as_u16(),
                text
            )));
        }

        let data: serde_json::Value = res
            .json()
            .await
            .map_err(|e| CrawlError::Llm(format!("Anthropic JSON decode: {e}")))?;

        let text = data
            .get("content")
            .and_then(|c| c.as_array())
            .and_then(|arr| {
                arr.iter().find_map(|c| {
                    if c.get("type").and_then(|t| t.as_str()) == Some("text") {
                        c.get("text").and_then(|t| t.as_str()).map(|s| s.to_string())
                    } else {
                        None
                    }
                })
            })
            .unwrap_or_default();

        let model = data
            .get("model")
            .and_then(|m| m.as_str())
            .unwrap_or(&self.model)
            .to_string();

        let usage = data.get("usage");
        let input_tokens = usage
            .and_then(|u| u.get("input_tokens"))
            .and_then(|v| v.as_u64())
            .map(|n| n as u32);
        let output_tokens = usage
            .and_then(|u| u.get("output_tokens"))
            .and_then(|v| v.as_u64())
            .map(|n| n as u32);

        Ok(LlmResponse { text, model, input_tokens, output_tokens })
    }
}

#[async_trait]
impl LlmClient for AnthropicClient {
    fn provider_name(&self) -> &'static str {
        "anthropic"
    }

    fn default_model(&self) -> &str {
        &self.model
    }

    async fn complete_messages(
        &self,
        messages: &[LlmMessage],
        max_tokens: u32,
    ) -> Result<LlmResponse> {
        with_retry(
            || self.call_once(messages, max_tokens),
            DEFAULT_MAX_ATTEMPTS,
            DEFAULT_BASE_DELAY_MS,
        )
        .await
    }

    async fn complete(&self, prompt: &str) -> Result<String> {
        let resp = self
            .complete_messages(&[LlmMessage::user(prompt.to_string())], crate::DEFAULT_MAX_OUTPUT_TOKENS)
            .await?;
        Ok(resp.text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_model_matches_spec() {
        let c = AnthropicClient::with_default_model("test-key");
        assert_eq!(c.default_model(), ANTHROPIC_DEFAULT_MODEL);
    }

    #[test]
    fn provider_name_returns_correct_label() {
        let c = AnthropicClient::with_default_model("test-key");
        assert_eq!(c.provider_name(), "anthropic");
    }

    #[test]
    fn override_model_sticks() {
        let c = AnthropicClient::new("k", "claude-opus-4-7");
        assert_eq!(c.default_model(), "claude-opus-4-7");
    }
}
