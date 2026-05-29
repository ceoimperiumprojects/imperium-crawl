//! Factory for building an [`LlmClient`] from a [`Config`].
//!
//! Port of `../src/llm/index.ts` `createLLMClient`. Reads
//! `Config::llm_provider_resolved()` + `Config::llm_api_key_for(provider)` +
//! `Config::llm_model`. Returns `CrawlError::MissingApiKey` if no key is
//! configured for the resolved provider.

use imperium_crawl_core::{Config, CrawlError, LlmProvider, Result};

use crate::LlmClient;

/// Build a boxed [`LlmClient`] from a [`Config`].
pub fn build_client_from_config(config: &Config) -> Result<Box<dyn LlmClient>> {
    let provider = config.llm_provider_resolved();
    let api_key = config
        .llm_api_key_for(provider)
        .ok_or_else(|| match provider {
            LlmProvider::Anthropic => CrawlError::MissingApiKey(
                "ANTHROPIC_API_KEY (or LLM_API_KEY) is not set".into(),
            ),
            LlmProvider::Openai => {
                CrawlError::MissingApiKey("OPENAI_API_KEY (or LLM_API_KEY) is not set".into())
            }
            LlmProvider::Minimax => {
                CrawlError::MissingApiKey("MINIMAX_API_KEY (or LLM_API_KEY) is not set".into())
            }
        })?
        .to_string();

    let model_override = config.llm_model.clone();

    match provider {
        LlmProvider::Anthropic => {
            #[cfg(feature = "anthropic")]
            {
                let model = model_override
                    .unwrap_or_else(|| crate::anthropic::ANTHROPIC_DEFAULT_MODEL.to_string());
                Ok(Box::new(crate::anthropic::AnthropicClient::new(api_key, model)))
            }
            #[cfg(not(feature = "anthropic"))]
            {
                let _ = (api_key, model_override);
                Err(CrawlError::Llm(
                    "Anthropic provider requested but feature 'anthropic' is disabled".into(),
                ))
            }
        }
        LlmProvider::Openai => {
            #[cfg(feature = "openai")]
            {
                let model = model_override
                    .unwrap_or_else(|| crate::openai::OPENAI_DEFAULT_MODEL.to_string());
                Ok(Box::new(crate::openai::OpenAiClient::new(api_key, model)))
            }
            #[cfg(not(feature = "openai"))]
            {
                let _ = (api_key, model_override);
                Err(CrawlError::Llm(
                    "OpenAI provider requested but feature 'openai' is disabled".into(),
                ))
            }
        }
        LlmProvider::Minimax => {
            #[cfg(feature = "minimax")]
            {
                let model = model_override
                    .unwrap_or_else(|| crate::minimax::MINIMAX_DEFAULT_MODEL.to_string());
                Ok(Box::new(crate::minimax::MiniMaxClient::new(api_key, model)))
            }
            #[cfg(not(feature = "minimax"))]
            {
                let _ = (api_key, model_override);
                Err(CrawlError::Llm(
                    "MiniMax provider requested but feature 'minimax' is disabled".into(),
                ))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_key_yields_missing_api_key_error() {
        let cfg = Config {
            llm_provider: Some("anthropic".into()),
            anthropic_api_key: None,
            openai_api_key: None,
            minimax_api_key: None,
            llm_api_key: None,
            ..Config::default()
        };
        let res = build_client_from_config(&cfg);
        match res {
            Ok(_) => panic!("expected MissingApiKey error"),
            Err(CrawlError::MissingApiKey(_)) => {}
            Err(other) => panic!("expected MissingApiKey, got {other:?}"),
        }
    }

    #[cfg(feature = "anthropic")]
    #[test]
    fn builds_anthropic_when_key_present() {
        let cfg = Config {
            anthropic_api_key: Some("sk-ant-test".into()),
            llm_provider: Some("anthropic".into()),
            ..Config::default()
        };
        let client = build_client_from_config(&cfg).unwrap();
        assert_eq!(client.provider_name(), "anthropic");
    }

    #[cfg(feature = "openai")]
    #[test]
    fn builds_openai_when_provider_openai() {
        let cfg = Config {
            openai_api_key: Some("sk-test".into()),
            llm_provider: Some("openai".into()),
            ..Config::default()
        };
        let client = build_client_from_config(&cfg).unwrap();
        assert_eq!(client.provider_name(), "openai");
    }

    #[cfg(feature = "anthropic")]
    #[test]
    fn model_override_propagates() {
        let cfg = Config {
            anthropic_api_key: Some("sk".into()),
            llm_provider: Some("anthropic".into()),
            llm_model: Some("claude-opus-4-7".into()),
            ..Config::default()
        };
        let client = build_client_from_config(&cfg).unwrap();
        assert_eq!(client.default_model(), "claude-opus-4-7");
    }
}
