//! OpenAI provider via reqwest.
//!
//! Port of `../src/llm/providers/openai.ts`. Plain HTTP to
//! `POST {base_url}/v1/chat/completions`. MiniMax extends by overriding
//! `base_url` only.

use async_trait::async_trait;
use imperium_crawl_core::{CrawlError, Result};
use serde_json::json;

use crate::retry::{with_retry, DEFAULT_BASE_DELAY_MS, DEFAULT_MAX_ATTEMPTS};
use crate::{LlmClient, LlmMessage, LlmResponse};

const OPENAI_API_URL: &str = "https://api.openai.com/v1/chat/completions";

/// Default OpenAI model. Matches TS `getLLMConfig` default `gpt-4o-mini`.
pub const OPENAI_DEFAULT_MODEL: &str = "gpt-4o-mini";

pub struct OpenAiClient {
    api_key: String,
    model: String,
    api_url: String,
    provider_label: &'static str,
    client: reqwest::Client,
}

impl OpenAiClient {
    pub fn new(api_key: impl Into<String>, model: impl Into<String>) -> Self {
        Self {
            api_key: api_key.into(),
            model: model.into(),
            api_url: OPENAI_API_URL.to_string(),
            provider_label: "openai",
            client: reqwest::Client::new(),
        }
    }

    pub fn with_default_model(api_key: impl Into<String>) -> Self {
        Self::new(api_key, OPENAI_DEFAULT_MODEL)
    }

    /// Build a custom-base-URL variant (used by MiniMax + wiremock).
    pub fn with_custom_base(
        api_key: impl Into<String>,
        model: impl Into<String>,
        api_url: impl Into<String>,
        provider_label: &'static str,
    ) -> Self {
        Self {
            api_key: api_key.into(),
            model: model.into(),
            api_url: api_url.into(),
            provider_label,
            client: reqwest::Client::new(),
        }
    }

    /// For tests — override base URL.
    pub fn with_base_url(mut self, api_url: impl Into<String>) -> Self {
        self.api_url = api_url.into();
        self
    }

    async fn call_once(
        &self,
        messages: &[LlmMessage],
        max_tokens: u32,
    ) -> Result<LlmResponse> {
        let body = json!({
            "model": self.model,
            "max_tokens": max_tokens,
            "messages": messages
                .iter()
                .map(|m| json!({ "role": m.role.as_str(), "content": m.content }))
                .collect::<Vec<_>>(),
        });

        let res = self
            .client
            .post(&self.api_url)
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {}", self.api_key))
            .json(&body)
            .send()
            .await
            .map_err(|e| CrawlError::Network(format!("{} request: {e}", self.provider_label)))?;

        let status = res.status();
        if !status.is_success() {
            let text = res.text().await.unwrap_or_default();
            return Err(CrawlError::Llm(format!(
                "{} API error {}: {}",
                self.label_pretty(),
                status.as_u16(),
                text
            )));
        }

        let data: serde_json::Value = res
            .json()
            .await
            .map_err(|e| CrawlError::Llm(format!("{} JSON decode: {e}", self.provider_label)))?;

        let text = data
            .get("choices")
            .and_then(|c| c.as_array())
            .and_then(|arr| arr.first())
            .and_then(|c| c.get("message"))
            .and_then(|m| m.get("content"))
            .and_then(|t| t.as_str())
            .unwrap_or_default()
            .to_string();

        let model = data
            .get("model")
            .and_then(|m| m.as_str())
            .unwrap_or(&self.model)
            .to_string();

        let usage = data.get("usage");
        let input_tokens = usage
            .and_then(|u| u.get("prompt_tokens"))
            .and_then(|v| v.as_u64())
            .map(|n| n as u32);
        let output_tokens = usage
            .and_then(|u| u.get("completion_tokens"))
            .and_then(|v| v.as_u64())
            .map(|n| n as u32);

        Ok(LlmResponse { text, model, input_tokens, output_tokens })
    }

    fn label_pretty(&self) -> &'static str {
        match self.provider_label {
            "minimax" => "MiniMax",
            _ => "OpenAI",
        }
    }
}

#[async_trait]
impl LlmClient for OpenAiClient {
    fn provider_name(&self) -> &'static str {
        self.provider_label
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
        let c = OpenAiClient::with_default_model("k");
        assert_eq!(c.default_model(), OPENAI_DEFAULT_MODEL);
    }

    #[test]
    fn provider_name_returns_correct_label() {
        let c = OpenAiClient::with_default_model("k");
        assert_eq!(c.provider_name(), "openai");
    }

    #[test]
    fn override_model_sticks() {
        let c = OpenAiClient::new("k", "gpt-4o");
        assert_eq!(c.default_model(), "gpt-4o");
    }
}
