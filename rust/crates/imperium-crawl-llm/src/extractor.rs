//! Schema-driven LLM extraction. Port of `../src/llm/extractor.ts`.
//!
//! Pipeline:
//! 1. Truncate content to ~120k chars to stay under token budget.
//! 2. Build system + user prompt based on schema (typed or `"auto"`).
//! 3. Call the LLM client.
//! 4. Parse JSON from response with three fallbacks
//!    (direct → code fence → largest valid prefix).
//! 5. On parse failure, retry up to 2x with a "your previous response was
//!    not valid JSON" follow-up.

use imperium_crawl_core::{CrawlError, Result};
use serde_json::Value;

use crate::{LlmClient, LlmMessage, LlmResponse, DEFAULT_MAX_CONTENT_CHARS, DEFAULT_MAX_OUTPUT_TOKENS};

const SYSTEM_PROMPT_EXTRACT: &str = "You are a precise data extraction engine. Your job is to extract structured data from web page content.

Rules:
- Return ONLY valid JSON. No explanation, no markdown code blocks, no prose.
- If a field is not found, use null.
- For lists/arrays, return all matching items.
- Be thorough — extract every instance that matches the schema.
- Do not invent or hallucinate data that isn't present in the content.";

const SYSTEM_PROMPT_AUTO: &str = "You are an intelligent data extraction engine. Your job is to analyze web page content and automatically identify and extract all meaningful structured information.

Rules:
- Return ONLY valid JSON. No explanation, no markdown code blocks, no prose.
- Identify what type of page this is (product listing, article, profile, search results, etc.)
- Extract all structured data that would be useful (prices, titles, links, dates, ratings, authors, etc.)
- Group related data logically.
- Do not include raw HTML, scripts, or navigation noise.
- Be thorough but focused on meaningful content.";

const PARSE_RETRY_FOLLOWUP: &str =
    "Your previous response was not valid JSON. Return ONLY a valid JSON object — no markdown fences, no commentary.";

const MAX_PARSE_RETRIES: u32 = 2;

/// Either a JSON-schema object, a string description (e.g. `"products: [...]"`),
/// or the `"auto"` sentinel for free-form extraction.
#[derive(Debug, Clone)]
pub enum ExtractionSchema {
    Auto,
    Description(String),
    Json(Value),
}

impl ExtractionSchema {
    fn is_auto(&self) -> bool {
        matches!(self, ExtractionSchema::Auto)
    }

    fn render(&self) -> String {
        match self {
            ExtractionSchema::Auto => "auto".into(),
            ExtractionSchema::Description(s) => s.clone(),
            ExtractionSchema::Json(v) => serde_json::to_string_pretty(v).unwrap_or_else(|_| "{}".into()),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ExtractionResult {
    pub data: Value,
    pub model: String,
    pub schema_used: ExtractionSchema,
    pub truncated: bool,
    pub token_usage: Option<TokenUsage>,
}

#[derive(Debug, Clone, Copy)]
pub struct TokenUsage {
    pub input: u32,
    pub output: u32,
}

fn build_user_prompt(schema: &ExtractionSchema, content: &str) -> String {
    if schema.is_auto() {
        return format!(
            "Analyze this web page content and extract all meaningful structured data:\n\n{content}"
        );
    }
    let schema_str = schema.render();
    format!(
        "Extract the following information from this web page content.\n\nSchema (what to extract):\n{schema_str}\n\nWeb page content:\n{content}"
    )
}

fn truncate_content(content: &str, max_chars: usize) -> (String, bool) {
    if content.len() <= max_chars {
        (content.to_string(), false)
    } else {
        let mut s = content[..max_chars].to_string();
        s.push_str("\n\n[Content truncated due to length]");
        (s, true)
    }
}

/// Best-effort JSON extraction from a free-form LLM response.
///
/// Tries in order: direct parse → markdown code-block → progressively
/// shorter prefixes starting at the first `{` or `[`. Returns
/// `CrawlError::Llm` if nothing parses.
pub fn parse_json_from_llm_response(text: &str) -> Result<Value> {
    let trimmed = text.trim();

    // 1. Direct parse.
    if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
        return Ok(v);
    }

    // 2. Markdown code block — ```json ... ``` or ``` ... ```.
    if let Some(inner) = extract_code_block(trimmed) {
        if let Ok(v) = serde_json::from_str::<Value>(inner.trim()) {
            return Ok(v);
        }
    }

    // 3. First { or [, then shrink.
    let first_brace = trimmed.find('{');
    let first_bracket = trimmed.find('[');
    let start_idx = match (first_brace, first_bracket) {
        (Some(b), Some(k)) => Some(b.min(k)),
        (Some(b), None) => Some(b),
        (None, Some(k)) => Some(k),
        (None, None) => None,
    };

    if let Some(start) = start_idx {
        // We must shrink on **char** boundaries, not byte boundaries.
        // Build a list of valid end-positions (byte indices that fall on char boundaries).
        let bytes = trimmed.as_bytes();
        let mut end = bytes.len();
        while end > start {
            if trimmed.is_char_boundary(end) {
                if let Ok(v) = serde_json::from_str::<Value>(&trimmed[start..end]) {
                    return Ok(v);
                }
            }
            end -= 1;
        }
    }

    Err(CrawlError::Llm(format!(
        "Could not parse JSON from LLM response. Raw (first 500 chars):\n{}",
        &trimmed.chars().take(500).collect::<String>()
    )))
}

/// Pull the inner content out of the first ```json ... ``` (or ``` ... ```) block.
fn extract_code_block(s: &str) -> Option<&str> {
    let open = s.find("```")?;
    let after_open = &s[open + 3..];
    // Skip optional `json` tag right after opening fence.
    let after_tag = after_open.strip_prefix("json").unwrap_or(after_open);
    // Skip whitespace/newline after tag.
    let body_start_off = after_tag
        .char_indices()
        .find_map(|(i, c)| if !c.is_whitespace() { Some(i) } else { None })
        .unwrap_or(0);
    let body = &after_tag[body_start_off..];
    let close = body.find("```")?;
    Some(&body[..close])
}

/// Extract structured data using the supplied LLM client and schema.
///
/// On parse failure, the conversation history is augmented with the LLM's bad
/// response + a corrective user message, and the call is repeated up to
/// [`MAX_PARSE_RETRIES`] times.
pub async fn extract_with_schema(
    client: &dyn LlmClient,
    content: &str,
    schema: ExtractionSchema,
    max_tokens: Option<u32>,
) -> Result<ExtractionResult> {
    let max_tokens = max_tokens.unwrap_or(DEFAULT_MAX_OUTPUT_TOKENS);
    let (truncated_content, was_truncated) = truncate_content(content, DEFAULT_MAX_CONTENT_CHARS);
    let system_prompt = if schema.is_auto() { SYSTEM_PROMPT_AUTO } else { SYSTEM_PROMPT_EXTRACT };
    let user_prompt = build_user_prompt(&schema, &truncated_content);

    let mut messages: Vec<LlmMessage> = vec![
        LlmMessage::system(system_prompt),
        LlmMessage::user(user_prompt),
    ];

    let mut last_err: Option<CrawlError> = None;
    let mut last_resp: Option<LlmResponse> = None;
    for _attempt in 0..=MAX_PARSE_RETRIES {
        let resp = client.complete_messages(&messages, max_tokens).await?;
        match parse_json_from_llm_response(&resp.text) {
            Ok(data) => {
                let token_usage = match (resp.input_tokens, resp.output_tokens) {
                    (Some(i), Some(o)) => Some(TokenUsage { input: i, output: o }),
                    _ => None,
                };
                return Ok(ExtractionResult {
                    data,
                    model: resp.model,
                    schema_used: schema,
                    truncated: was_truncated,
                    token_usage,
                });
            }
            Err(e) => {
                last_err = Some(e);
                // Add the bad response + corrective follow-up, then loop.
                messages.push(LlmMessage::assistant(resp.text.clone()));
                messages.push(LlmMessage::user(PARSE_RETRY_FOLLOWUP));
                last_resp = Some(resp);
            }
        }
    }

    let _ = last_resp; // suppress unused if loop exits normally
    Err(last_err.unwrap_or_else(|| CrawlError::Llm("extractor: exhausted retries".into())))
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use std::sync::Mutex;

    #[test]
    fn parse_direct_json() {
        let v = parse_json_from_llm_response("{\"a\":1}").unwrap();
        assert_eq!(v["a"], 1);
    }

    #[test]
    fn parse_markdown_fence_json_tag() {
        let s = "Here you go:\n```json\n{\"a\":2}\n```\nThanks.";
        let v = parse_json_from_llm_response(s).unwrap();
        assert_eq!(v["a"], 2);
    }

    #[test]
    fn parse_markdown_fence_plain() {
        let s = "```\n{\"a\":3}\n```";
        let v = parse_json_from_llm_response(s).unwrap();
        assert_eq!(v["a"], 3);
    }

    #[test]
    fn parse_prefix_fallback() {
        let s = "Sure, here is data: {\"a\":4} — hope that helps!";
        let v = parse_json_from_llm_response(s).unwrap();
        assert_eq!(v["a"], 4);
    }

    #[test]
    fn parse_array_fallback() {
        let s = "result: [1,2,3] done";
        let v = parse_json_from_llm_response(s).unwrap();
        assert_eq!(v[2], 3);
    }

    #[test]
    fn parse_failure_yields_error() {
        let err = parse_json_from_llm_response("totally not json").unwrap_err();
        assert!(err.to_string().contains("Could not parse JSON"));
    }

    #[test]
    fn truncate_long_content() {
        let big = "a".repeat(150_000);
        let (s, was) = truncate_content(&big, 120_000);
        assert!(was);
        assert!(s.ends_with("[Content truncated due to length]"));
        assert!(s.len() > 120_000); // includes the marker
    }

    #[test]
    fn truncate_short_content_untouched() {
        let s = "hello";
        let (out, was) = truncate_content(s, 120_000);
        assert!(!was);
        assert_eq!(out, "hello");
    }

    // ---- Mock client to exercise extract_with_schema ----

    struct ScriptedClient {
        responses: Mutex<Vec<&'static str>>,
        call_count: Mutex<u32>,
    }

    impl ScriptedClient {
        fn new(responses: Vec<&'static str>) -> Self {
            Self { responses: Mutex::new(responses), call_count: Mutex::new(0) }
        }

        fn calls(&self) -> u32 {
            *self.call_count.lock().unwrap()
        }
    }

    #[async_trait]
    impl LlmClient for ScriptedClient {
        fn provider_name(&self) -> &'static str { "scripted" }
        fn default_model(&self) -> &str { "scripted-1" }
        async fn complete_messages(
            &self,
            _messages: &[LlmMessage],
            _max_tokens: u32,
        ) -> Result<LlmResponse> {
            *self.call_count.lock().unwrap() += 1;
            let mut q = self.responses.lock().unwrap();
            let text = if q.is_empty() {
                "fallback".to_string()
            } else {
                q.remove(0).to_string()
            };
            Ok(LlmResponse {
                text,
                model: "scripted-1".into(),
                input_tokens: Some(10),
                output_tokens: Some(5),
            })
        }
    }

    #[tokio::test]
    async fn extractor_returns_parsed_json_first_try() {
        let client = ScriptedClient::new(vec!["{\"name\":\"Pavle\",\"age\":18}"]);
        let res = extract_with_schema(
            &client,
            "<html>...</html>",
            ExtractionSchema::Description("name, age".into()),
            None,
        )
        .await
        .unwrap();
        assert_eq!(res.data["name"], "Pavle");
        assert_eq!(res.data["age"], 18);
        assert_eq!(client.calls(), 1);
        assert!(!res.truncated);
        assert_eq!(res.token_usage.as_ref().unwrap().input, 10);
    }

    #[tokio::test]
    async fn extractor_strips_markdown_fences() {
        let client = ScriptedClient::new(vec!["```json\n{\"k\":1}\n```"]);
        let res = extract_with_schema(
            &client,
            "content",
            ExtractionSchema::Auto,
            None,
        )
        .await
        .unwrap();
        assert_eq!(res.data["k"], 1);
        assert_eq!(client.calls(), 1);
    }

    #[tokio::test]
    async fn extractor_retries_on_invalid_json_then_succeeds() {
        let client = ScriptedClient::new(vec![
            "this is not json at all",
            "{\"recovered\":true}",
        ]);
        let res = extract_with_schema(
            &client,
            "content",
            ExtractionSchema::Description("x".into()),
            None,
        )
        .await
        .unwrap();
        assert_eq!(res.data["recovered"], true);
        assert_eq!(client.calls(), 2);
    }

    #[tokio::test]
    async fn extractor_gives_up_after_parse_retries() {
        let client = ScriptedClient::new(vec![
            "garbage 1",
            "garbage 2",
            "garbage 3",
        ]);
        let err = extract_with_schema(
            &client,
            "content",
            ExtractionSchema::Description("x".into()),
            None,
        )
        .await
        .unwrap_err();
        assert!(err.to_string().contains("Could not parse JSON"));
        // initial + MAX_PARSE_RETRIES retries
        assert_eq!(client.calls(), 1 + MAX_PARSE_RETRIES);
    }

    // ---- wiremock integration: stub Anthropic and run real extractor ----

    #[cfg(feature = "anthropic")]
    #[tokio::test]
    async fn extractor_against_wiremocked_anthropic() {
        use wiremock::matchers::{header, method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        let body = serde_json::json!({
            "content": [{ "type": "text", "text": "{\"title\":\"Hello\",\"price\":42}" }],
            "model": "claude-haiku-4-5-20251001",
            "usage": { "input_tokens": 12, "output_tokens": 8 }
        });
        Mock::given(method("POST"))
            .and(path("/"))
            .and(header("anthropic-version", "2023-06-01"))
            .and(header("x-api-key", "test-key"))
            .respond_with(ResponseTemplate::new(200).set_body_json(body))
            .mount(&server)
            .await;

        let client = crate::AnthropicClient::with_default_model("test-key")
            .with_base_url(server.uri());

        let res = extract_with_schema(
            &client,
            "<html>some product</html>",
            ExtractionSchema::Description("title, price".into()),
            None,
        )
        .await
        .unwrap();
        assert_eq!(res.data["title"], "Hello");
        assert_eq!(res.data["price"], 42);
        assert_eq!(res.token_usage.unwrap().output, 8);
    }
}
