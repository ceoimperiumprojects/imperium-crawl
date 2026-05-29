//! Retry helper for LLM API calls — retries on 429 (rate limit), 5xx (server
//! error), and transient network failures.
//!
//! Uses full-jitter exponential backoff (AWS pattern) to prevent thundering
//! herd. Port of `../src/llm/retry.ts`.

use std::time::Duration;

use imperium_crawl_core::{CrawlError, Result};
use rand::Rng;
use tracing::warn;

/// Default max attempts (initial + retries). Mirrors TS `MAX_RETRIES = 3`
/// (which means up to 4 calls in the TS loop: `attempt = 0..=3`).
pub const DEFAULT_MAX_ATTEMPTS: u32 = 4;

/// Base delay in milliseconds before backoff (used as `BACKOFF_BASE_MS * 2^n`).
pub const DEFAULT_BASE_DELAY_MS: u64 = 1_000;

/// Cap on a single retry delay.
pub const DEFAULT_CAP_DELAY_MS: u64 = 30_000;

/// Classify an error as retryable (true) or terminal (false).
///
/// Retryable: `RateLimited`, `Network`, `Timeout`, and `Http {status in {429,
/// 500, 502, 503, 504}}`. The `Llm` variant carries provider error strings in
/// the form `"... error 429: ..."` — we sniff the status out of the string
/// for parity with the TS implementation.
pub fn is_retryable(err: &CrawlError) -> bool {
    match err {
        CrawlError::RateLimited(_) => true,
        CrawlError::Network(_) => true,
        CrawlError::Timeout { .. } => true,
        CrawlError::Http { status, .. } => is_retryable_status(*status),
        CrawlError::Llm(msg) => extract_status_from_msg(msg).map(is_retryable_status).unwrap_or(false),
        _ => false,
    }
}

pub fn is_retryable_status(status: u16) -> bool {
    status == 429 || (500..600).contains(&status)
}

/// Sniff `error 429:` / `error 500:` etc. from an error message — mirrors the
/// TS regex `/error (\d{3}):/i`.
pub fn extract_status_from_msg(msg: &str) -> Option<u16> {
    let lower = msg.to_ascii_lowercase();
    let idx = lower.find("error ")?;
    let tail = &msg[idx + 6..];
    if tail.len() < 3 {
        return None;
    }
    let digits: String = tail.chars().take(3).collect();
    let n: u16 = digits.parse().ok()?;
    // Require trailing ':' or non-digit to avoid matching "error 1234:"
    let next = tail.chars().nth(3);
    if next == Some(':') || next.map(|c| !c.is_ascii_digit()).unwrap_or(false) {
        Some(n)
    } else {
        None
    }
}

/// Full-jitter backoff (AWS pattern): random value in
/// `[0, min(cap, base * 2^attempt))`.
pub fn full_jitter_backoff_ms(attempt: u32, base_ms: u64, cap_ms: u64) -> u64 {
    let shift = attempt.min(20); // prevent overflow
    let exp = base_ms.saturating_mul(1u64 << shift);
    let bound = exp.min(cap_ms).max(1);
    rand::thread_rng().gen_range(0..bound)
}

/// Wrap an async closure with retry-on-transient-error logic.
///
/// `max_attempts` is the **total** number of calls (initial + retries).
/// Setting `max_attempts = 1` means no retries.
pub async fn with_retry<F, Fut, T>(
    mut f: F,
    max_attempts: u32,
    base_delay_ms: u64,
) -> Result<T>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T>>,
{
    let max_attempts = max_attempts.max(1);
    let cap = DEFAULT_CAP_DELAY_MS;
    let mut last_err: Option<CrawlError> = None;

    for attempt in 0..max_attempts {
        match f().await {
            Ok(v) => return Ok(v),
            Err(e) => {
                let retryable = is_retryable(&e);
                let last = attempt + 1 == max_attempts;
                if !retryable || last {
                    return Err(e);
                }
                let delay_ms = full_jitter_backoff_ms(attempt, base_delay_ms, cap);
                warn!(
                    attempt = attempt + 1,
                    max_attempts,
                    delay_ms,
                    error = %e,
                    "LLM call failed with transient error, retrying"
                );
                tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                last_err = Some(e);
            }
        }
    }
    Err(last_err.unwrap_or_else(|| CrawlError::Llm("retry loop exited unexpectedly".into())))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Arc;

    #[test]
    fn status_sniffer_matches_anthropic_style() {
        assert_eq!(extract_status_from_msg("Anthropic API error 429: too many"), Some(429));
        assert_eq!(extract_status_from_msg("OpenAI API error 503: down"), Some(503));
        assert_eq!(extract_status_from_msg("nothing"), None);
        assert_eq!(extract_status_from_msg("Error 404: not found"), Some(404));
    }

    #[test]
    fn classify_retryable() {
        assert!(is_retryable_status(429));
        assert!(is_retryable_status(500));
        assert!(is_retryable_status(502));
        assert!(is_retryable_status(503));
        assert!(is_retryable_status(504));
        assert!(!is_retryable_status(400));
        assert!(!is_retryable_status(401));
        assert!(!is_retryable_status(403));
        assert!(!is_retryable_status(404));
    }

    #[test]
    fn classify_does_not_retry_4xx_except_429() {
        let e = CrawlError::Llm("API error 400: bad request".into());
        assert!(!is_retryable(&e));
        let e = CrawlError::Llm("API error 401: unauthorized".into());
        assert!(!is_retryable(&e));
        let e = CrawlError::Llm("API error 404: not found".into());
        assert!(!is_retryable(&e));
        let e = CrawlError::Llm("API error 429: rate limited".into());
        assert!(is_retryable(&e));
    }

    #[tokio::test]
    async fn succeeds_on_first_attempt() {
        let calls = Arc::new(AtomicU32::new(0));
        let calls_c = calls.clone();
        let r = with_retry(
            move || {
                let c = calls_c.clone();
                async move {
                    c.fetch_add(1, Ordering::SeqCst);
                    Ok::<_, CrawlError>(42)
                }
            },
            4,
            1,
        )
        .await
        .unwrap();
        assert_eq!(r, 42);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn retries_on_transient_error() {
        let calls = Arc::new(AtomicU32::new(0));
        let calls_c = calls.clone();
        let r = with_retry(
            move || {
                let c = calls_c.clone();
                async move {
                    let n = c.fetch_add(1, Ordering::SeqCst);
                    if n < 2 {
                        Err(CrawlError::Llm("API error 503: down".into()))
                    } else {
                        Ok(99)
                    }
                }
            },
            5,
            1,
        )
        .await
        .unwrap();
        assert_eq!(r, 99);
        assert_eq!(calls.load(Ordering::SeqCst), 3);
    }

    #[tokio::test]
    async fn gives_up_after_max_attempts() {
        let calls = Arc::new(AtomicU32::new(0));
        let calls_c = calls.clone();
        let err = with_retry::<_, _, ()>(
            move || {
                let c = calls_c.clone();
                async move {
                    c.fetch_add(1, Ordering::SeqCst);
                    Err(CrawlError::Llm("API error 500: boom".into()))
                }
            },
            3,
            1,
        )
        .await
        .unwrap_err();
        assert!(err.to_string().contains("500"));
        assert_eq!(calls.load(Ordering::SeqCst), 3);
    }

    #[tokio::test]
    async fn does_not_retry_4xx() {
        let calls = Arc::new(AtomicU32::new(0));
        let calls_c = calls.clone();
        let err = with_retry::<_, _, ()>(
            move || {
                let c = calls_c.clone();
                async move {
                    c.fetch_add(1, Ordering::SeqCst);
                    Err(CrawlError::Llm("API error 400: bad".into()))
                }
            },
            5,
            1,
        )
        .await
        .unwrap_err();
        assert!(err.to_string().contains("400"));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn retries_429_but_not_other_4xx() {
        let calls = Arc::new(AtomicU32::new(0));
        let calls_c = calls.clone();
        let r = with_retry(
            move || {
                let c = calls_c.clone();
                async move {
                    let n = c.fetch_add(1, Ordering::SeqCst);
                    if n == 0 {
                        Err(CrawlError::Llm("API error 429: throttled".into()))
                    } else {
                        Ok(7)
                    }
                }
            },
            5,
            1,
        )
        .await
        .unwrap();
        assert_eq!(r, 7);
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }
}
