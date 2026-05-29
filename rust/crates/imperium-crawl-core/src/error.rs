use thiserror::Error;

pub type Result<T> = std::result::Result<T, CrawlError>;

#[derive(Debug, Error)]
pub enum CrawlError {
    #[error("network error: {0}")]
    Network(String),

    #[error("HTTP {status}: {message}")]
    Http { status: u16, message: String },

    #[error("blocked by anti-bot system: {0}")]
    Blocked(String),

    #[error("rate limited: {0}")]
    RateLimited(String),

    #[error("timeout after {timeout_ms}ms: {context}")]
    Timeout { timeout_ms: u64, context: String },

    #[error("invalid URL: {0}")]
    InvalidUrl(String),

    #[error("HTML parsing failed: {0}")]
    Parse(String),

    #[error("tool not found: {0}")]
    ToolNotFound(String),

    #[error("missing required argument: {0}")]
    MissingArg(String),

    #[error("invalid argument: {0}")]
    InvalidArg(String),

    #[error("config error: {0}")]
    Config(String),

    #[error("session error: {0}")]
    Session(String),

    #[error("browser error: {0}")]
    Browser(String),

    #[error("LLM provider error: {0}")]
    Llm(String),

    #[error("missing API key: {0}")]
    MissingApiKey(String),

    #[error("subprocess error: {0}")]
    Subprocess(String),

    #[error("encryption error: {0}")]
    Encryption(String),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("serde json error: {0}")]
    SerdeJson(#[from] serde_json::Error),

    #[error("url parse error: {0}")]
    UrlParse(#[from] url::ParseError),

    #[error("unexpected: {0}")]
    Other(String),
}

// Note: From<reqwest::Error> and From<anyhow::Error> are implemented in the
// crates that depend on those libraries (we keep core lean — no http/anyhow
// dependency).

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_format() {
        let e = CrawlError::Blocked("cloudflare".into());
        assert_eq!(e.to_string(), "blocked by anti-bot system: cloudflare");
    }

    #[test]
    fn http_status_formats() {
        let e = CrawlError::Http { status: 403, message: "forbidden".into() };
        assert_eq!(e.to_string(), "HTTP 403: forbidden");
    }
}
