//! Integration tests for the stealth crate.
//!
//! These tests hit the real network (https://example.com). They're not behind
//! `#[ignore]` — Pavle demanded real-world tests. If the network is unavailable
//! the suite will fail, which is the correct signal: the stealth engine is
//! broken when it can't reach example.com.

use std::time::Duration;

use imperium_crawl_core::StealthLevel;
use imperium_crawl_stealth::{
    AntiBotDetector, AntiBotSignal, StealthClient, StealthOptions, TlsClient,
};

const REAL_URL: &str = "https://example.com/";
const EXAMPLE_BODY_MARKER: &str = "Example Domain";

#[tokio::test]
async fn l1_fetches_example_com() {
    let client = StealthClient::new().expect("StealthClient builds");
    let opts = StealthOptions {
        start_level: StealthLevel::L1Headers,
        max_level: StealthLevel::L1Headers,
        max_retries_per_level: 1,
        user_agent_override: None,
        timeout: Duration::from_secs(15),
    };

    let result = client
        .fetch(REAL_URL, &opts)
        .await
        .expect("L1 fetch of example.com should succeed");

    assert_eq!(result.status, 200, "expected 200 OK from example.com via L1");
    assert_eq!(result.stealth_level, StealthLevel::L1Headers);

    let body = String::from_utf8_lossy(&result.body);
    assert!(
        body.contains(EXAMPLE_BODY_MARKER),
        "L1 body should contain '{EXAMPLE_BODY_MARKER}'; got first 200 chars: {}",
        &body.chars().take(200).collect::<String>()
    );
}

#[tokio::test]
async fn l2_fetches_example_com() {
    let client = TlsClient::new().expect("TlsClient builds");
    let result = client
        .fetch_with_timeout(REAL_URL, Duration::from_secs(15))
        .await
        .expect("L2 fetch of example.com should succeed");

    assert_eq!(result.status, 200, "expected 200 OK from example.com via L2");
    assert_eq!(result.stealth_level, StealthLevel::L2Tls);

    let body = String::from_utf8_lossy(&result.body);
    assert!(
        body.contains(EXAMPLE_BODY_MARKER),
        "L2 body should contain '{EXAMPLE_BODY_MARKER}'; got first 200 chars: {}",
        &body.chars().take(200).collect::<String>()
    );
}

#[tokio::test]
async fn escalation_starts_at_l1_and_returns_clean() {
    // example.com has no anti-bot — L1 should succeed without escalating.
    let client = StealthClient::new().expect("StealthClient builds");
    let opts = StealthOptions {
        start_level: StealthLevel::L1Headers,
        max_level: StealthLevel::L2Tls,
        max_retries_per_level: 1,
        user_agent_override: None,
        timeout: Duration::from_secs(15),
    };

    let result = client
        .fetch(REAL_URL, &opts)
        .await
        .expect("escalation fetch should succeed");

    // Should NOT escalate since L1 returned a clean signal.
    assert_eq!(result.stealth_level, StealthLevel::L1Headers);
    assert_eq!(result.status, 200);
}

#[tokio::test]
async fn detector_classifies_clean_response_as_none() {
    let client = StealthClient::new().expect("StealthClient builds");
    let opts = StealthOptions {
        start_level: StealthLevel::L1Headers,
        max_level: StealthLevel::L1Headers,
        max_retries_per_level: 1,
        user_agent_override: None,
        timeout: Duration::from_secs(15),
    };

    let result = client.fetch(REAL_URL, &opts).await.expect("fetch ok");
    let signal = AntiBotDetector::classify(result.status, &result.headers, &result.body);
    assert_eq!(
        signal,
        AntiBotSignal::None,
        "example.com should classify as clean (None)"
    );
}
