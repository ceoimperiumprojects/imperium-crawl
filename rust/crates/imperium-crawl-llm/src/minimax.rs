//! MiniMax LLM provider — thin wrapper around [`OpenAiClient`].
//!
//! MiniMax uses an OpenAI-compatible API; only base URL and default model
//! differ. Port of `../src/llm/providers/minimax.ts`.

use async_trait::async_trait;
use imperium_crawl_core::Result;

use crate::openai::OpenAiClient;
use crate::{LlmClient, LlmMessage, LlmResponse};

pub const MINIMAX_API_URL: &str = "https://api.minimax.io/v1/chat/completions";
pub const MINIMAX_DEFAULT_MODEL: &str = "MiniMax-M2.5";

pub struct MiniMaxClient {
    inner: OpenAiClient,
}

impl MiniMaxClient {
    pub fn new(api_key: impl Into<String>, model: impl Into<String>) -> Self {
        Self {
            inner: OpenAiClient::with_custom_base(api_key, model, MINIMAX_API_URL, "minimax"),
        }
    }

    pub fn with_default_model(api_key: impl Into<String>) -> Self {
        Self::new(api_key, MINIMAX_DEFAULT_MODEL)
    }

    /// For tests — override base URL.
    pub fn with_base_url(mut self, api_url: impl Into<String>) -> Self {
        self.inner = self.inner.with_base_url(api_url);
        self
    }
}

#[async_trait]
impl LlmClient for MiniMaxClient {
    fn provider_name(&self) -> &'static str {
        "minimax"
    }

    fn default_model(&self) -> &str {
        self.inner.default_model()
    }

    async fn complete_messages(
        &self,
        messages: &[LlmMessage],
        max_tokens: u32,
    ) -> Result<LlmResponse> {
        self.inner.complete_messages(messages, max_tokens).await
    }

    async fn complete(&self, prompt: &str) -> Result<String> {
        self.inner.complete(prompt).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_model_matches_spec() {
        let c = MiniMaxClient::with_default_model("k");
        assert_eq!(c.default_model(), MINIMAX_DEFAULT_MODEL);
    }

    #[test]
    fn provider_name_returns_correct_label() {
        let c = MiniMaxClient::with_default_model("k");
        assert_eq!(c.provider_name(), "minimax");
    }

    #[test]
    fn override_model_sticks() {
        let c = MiniMaxClient::new("k", "MiniMax-Foo");
        assert_eq!(c.default_model(), "MiniMax-Foo");
    }
}
