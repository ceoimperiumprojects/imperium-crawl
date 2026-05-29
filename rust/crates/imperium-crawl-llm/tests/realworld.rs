//! Real-world integration tests against live LLM APIs.
//!
//! These tests are GATED on the presence of the relevant env var.
//! Without `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` set, they skip silently.
//!
//! Run with:
//!   ANTHROPIC_API_KEY=... cargo test -p imperium-crawl-llm --test realworld -- --nocapture

use imperium_crawl_llm::{
    extractor::{extract_with_schema, ExtractionSchema},
    LlmClient,
};

#[tokio::test]
#[cfg(feature = "anthropic")]
async fn anthropic_returns_answer_42() {
    let Ok(key) = std::env::var("ANTHROPIC_API_KEY") else {
        eprintln!("skipping: ANTHROPIC_API_KEY not set");
        return;
    };
    if key.trim().is_empty() {
        eprintln!("skipping: ANTHROPIC_API_KEY empty");
        return;
    }

    let client = imperium_crawl_llm::AnthropicClient::with_default_model(key);
    let result = match extract_with_schema(
        &client,
        "Please return the number 42",
        ExtractionSchema::Description("answer (number)".into()),
        Some(200),
    )
    .await
    {
        Ok(r) => r,
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("429")
                || msg.contains("401")
                || msg.contains("credit balance is too low")
                || msg.contains("invalid_api_key")
            {
                eprintln!("skipping anthropic test: {msg}");
                return;
            }
            panic!("anthropic call failed: {msg}");
        }
    };

    let v = &result.data;
    let answer = v.get("answer").and_then(|x| x.as_i64()).unwrap_or(-1);
    assert_eq!(
        answer, 42,
        "expected answer=42, got {v:?}"
    );
}

#[tokio::test]
#[cfg(feature = "openai")]
async fn openai_returns_answer_42() {
    let Ok(key) = std::env::var("OPENAI_API_KEY") else {
        eprintln!("skipping: OPENAI_API_KEY not set");
        return;
    };
    if key.trim().is_empty() {
        eprintln!("skipping: OPENAI_API_KEY empty");
        return;
    }

    let client = imperium_crawl_llm::OpenAiClient::with_default_model(key);
    let result = match extract_with_schema(
        &client,
        "Please return the number 42",
        ExtractionSchema::Description("answer (number)".into()),
        Some(200),
    )
    .await
    {
        Ok(r) => r,
        Err(e) => {
            let msg = e.to_string();
            // Skip on quota / billing issues — the code path is exercised,
            // we just can't complete the call.
            if msg.contains("insufficient_quota")
                || msg.contains("429")
                || msg.contains("401")
                || msg.contains("invalid_api_key")
            {
                eprintln!("skipping openai test: {msg}");
                return;
            }
            panic!("openai call failed: {msg}");
        }
    };

    let v = &result.data;
    let answer = v.get("answer").and_then(|x| x.as_i64()).unwrap_or(-1);
    assert_eq!(
        answer, 42,
        "expected answer=42, got {v:?}"
    );
}

#[tokio::test]
async fn smoke_provider_name_works() {
    // Always runs — confirms the crate links and trait dispatch resolves.
    #[cfg(feature = "anthropic")]
    {
        let c = imperium_crawl_llm::AnthropicClient::with_default_model("dummy");
        assert_eq!(c.provider_name(), "anthropic");
    }
}
