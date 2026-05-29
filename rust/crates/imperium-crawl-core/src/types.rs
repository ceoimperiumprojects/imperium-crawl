use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::error::{CrawlError, Result};

/// Stealth escalation level used by the fetch engine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StealthLevel {
    /// L1: Native fetch with realistic headers (header-generator equivalent).
    L1Headers,
    /// L2: TLS fingerprint spoofing via wreq/BoringSSL.
    L2Tls,
    /// L3: Full headless browser via chromiumoxide.
    L3Browser,
    /// L4: CamoFox-driven full stealth fork (subprocess).
    L4Camofox,
}

impl StealthLevel {
    pub fn next(self) -> Option<StealthLevel> {
        match self {
            StealthLevel::L1Headers => Some(StealthLevel::L2Tls),
            StealthLevel::L2Tls => Some(StealthLevel::L3Browser),
            StealthLevel::L3Browser => Some(StealthLevel::L4Camofox),
            StealthLevel::L4Camofox => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            StealthLevel::L1Headers => "L1",
            StealthLevel::L2Tls => "L2",
            StealthLevel::L3Browser => "L3",
            StealthLevel::L4Camofox => "L4",
        }
    }
}

impl std::str::FromStr for StealthLevel {
    type Err = CrawlError;
    fn from_str(s: &str) -> Result<Self> {
        match s.to_ascii_lowercase().as_str() {
            "l1" | "1" | "headers" | "l1headers" => Ok(StealthLevel::L1Headers),
            "l2" | "2" | "tls" | "l2tls" => Ok(StealthLevel::L2Tls),
            "l3" | "3" | "browser" | "l3browser" => Ok(StealthLevel::L3Browser),
            "l4" | "4" | "camofox" | "l4camofox" => Ok(StealthLevel::L4Camofox),
            other => Err(CrawlError::Config(format!("unknown stealth level: {other}"))),
        }
    }
}

/// Kind of content returned by a fetch operation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ContentKind {
    Html,
    Json,
    Pdf,
    Image,
    Video,
    Audio,
    PlainText,
    Other(String),
}

impl ContentKind {
    pub fn from_mime(mime: &str) -> Self {
        let m = mime.split(';').next().unwrap_or(mime).trim().to_ascii_lowercase();
        if m.starts_with("text/html") || m.starts_with("application/xhtml") {
            ContentKind::Html
        } else if m == "application/json" || m.ends_with("+json") {
            ContentKind::Json
        } else if m == "application/pdf" {
            ContentKind::Pdf
        } else if m.starts_with("image/") {
            ContentKind::Image
        } else if m.starts_with("video/") {
            ContentKind::Video
        } else if m.starts_with("audio/") {
            ContentKind::Audio
        } else if m.starts_with("text/") {
            ContentKind::PlainText
        } else {
            ContentKind::Other(m)
        }
    }
}

/// Result of a fetch operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FetchResult {
    pub url: String,
    pub final_url: String,
    pub status: u16,
    pub kind: ContentKind,
    pub body: Vec<u8>,
    pub headers: HashMap<String, String>,
    pub stealth_level: StealthLevel,
    pub duration_ms: u64,
}

impl FetchResult {
    pub fn body_as_str(&self) -> Option<&str> {
        std::str::from_utf8(&self.body).ok()
    }
    pub fn body_string_lossy(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }
    pub fn is_success(&self) -> bool {
        (200..300).contains(&self.status)
    }
}

/// Cookie persisted in the session vault. Mirrors `StoredCookie` in
/// `src/sessions/types.ts`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Cookie {
    pub name: String,
    pub value: String,
    pub domain: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "httpOnly")]
    pub http_only: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secure: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "sameSite")]
    pub same_site: Option<SameSite>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum SameSite {
    Strict,
    Lax,
    None,
}

/// Session stored on disk. Mirrors `StoredSession` in `src/sessions/types.ts`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredSession {
    pub id: String,
    pub cookies: Vec<Cookie>,
    pub url: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    #[serde(rename = "actionCount", default, skip_serializing_if = "Option::is_none")]
    pub action_count: Option<u64>,
}

/// LLM provider tag. Mirrors `getLLMProvider` from `src/core/config.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LlmProvider {
    Anthropic,
    Openai,
    Minimax,
}

impl LlmProvider {
    pub fn from_str_lossy(raw: &str) -> Self {
        match raw.to_ascii_lowercase().as_str() {
            "openai" => LlmProvider::Openai,
            "minimax" => LlmProvider::Minimax,
            _ => LlmProvider::Anthropic,
        }
    }
}

/// Validate a URL using the `url` crate plus length bound from constants.
pub fn validate_url(input: &str) -> Result<url::Url> {
    if input.len() > crate::constants::MAX_URL_LENGTH {
        return Err(CrawlError::InvalidUrl(format!(
            "URL exceeds MAX_URL_LENGTH ({} chars)",
            crate::constants::MAX_URL_LENGTH
        )));
    }
    url::Url::parse(input).map_err(|e| CrawlError::InvalidUrl(format!("{e}: {input}")))
}

/// Normalize a URL: lowercase host, strip default ports, remove fragment, sort query keys.
/// Matches `normalize-url` defaults used in the TypeScript codebase.
pub fn normalize_url(input: &str) -> Result<String> {
    let mut u = validate_url(input)?;
    u.set_fragment(None);
    // Lowercase host
    if let Some(host) = u.host_str() {
        let lowered = host.to_ascii_lowercase();
        let _ = u.set_host(Some(&lowered));
    }
    // Sort query pairs deterministically.
    let mut pairs: Vec<(String, String)> = u
        .query_pairs()
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    pairs.sort_by(|a, b| a.0.cmp(&b.0));
    if pairs.is_empty() {
        u.set_query(None);
    } else {
        let mut qb = u.query_pairs_mut();
        qb.clear();
        for (k, v) in pairs {
            qb.append_pair(&k, &v);
        }
        drop(qb);
    }
    Ok(u.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stealth_level_round_trip() {
        for lv in [
            StealthLevel::L1Headers,
            StealthLevel::L2Tls,
            StealthLevel::L3Browser,
            StealthLevel::L4Camofox,
        ] {
            let s = lv.as_str().to_lowercase();
            let parsed: StealthLevel = s.parse().unwrap();
            assert_eq!(parsed, lv);
        }
    }

    #[test]
    fn stealth_escalation_chain() {
        assert_eq!(StealthLevel::L1Headers.next(), Some(StealthLevel::L2Tls));
        assert_eq!(StealthLevel::L2Tls.next(), Some(StealthLevel::L3Browser));
        assert_eq!(StealthLevel::L3Browser.next(), Some(StealthLevel::L4Camofox));
        assert_eq!(StealthLevel::L4Camofox.next(), None);
    }

    #[test]
    fn content_kind_from_mime_basic() {
        assert_eq!(ContentKind::from_mime("text/html; charset=utf-8"), ContentKind::Html);
        assert_eq!(ContentKind::from_mime("application/json"), ContentKind::Json);
        assert_eq!(ContentKind::from_mime("application/ld+json"), ContentKind::Json);
        assert_eq!(ContentKind::from_mime("application/pdf"), ContentKind::Pdf);
        assert_eq!(ContentKind::from_mime("image/png"), ContentKind::Image);
        assert_eq!(ContentKind::from_mime("video/mp4"), ContentKind::Video);
        assert_eq!(ContentKind::from_mime("audio/mpeg"), ContentKind::Audio);
        assert_eq!(ContentKind::from_mime("text/plain"), ContentKind::PlainText);
        match ContentKind::from_mime("application/x-zip") {
            ContentKind::Other(s) => assert_eq!(s, "application/x-zip"),
            _ => panic!("expected Other"),
        }
    }

    #[test]
    fn validate_url_rejects_empty() {
        assert!(validate_url("").is_err());
    }

    #[test]
    fn validate_url_accepts_https() {
        assert!(validate_url("https://example.com/path?q=1").is_ok());
    }

    #[test]
    fn normalize_url_strips_fragment_and_sorts() {
        let n = normalize_url("https://EXAMPLE.com/?b=2&a=1#frag").unwrap();
        assert!(n.starts_with("https://example.com/"));
        assert!(n.contains("a=1"));
        assert!(n.contains("b=2"));
        assert!(!n.contains("#frag"));
        // a should come before b
        assert!(n.find("a=1").unwrap() < n.find("b=2").unwrap());
    }
}
