//! Realistic browser header generation. Port of `src/stealth/headers.ts`.
//!
//! Provides a small catalog of curated realistic browser fingerprints used at
//! L1 (plain `reqwest`). At L2 (`wreq` BoringSSL), `wreq-util` emulation
//! profiles supply the headers automatically — `header_map_for_url` is still
//! used to enrich URL-aware bits (Referer/Origin for .gov/API endpoints).

use std::collections::HashMap;

use rand::seq::SliceRandom;
use rand::Rng;

/// A realistic browser header profile. Built from a curated UA + Client Hint
/// catalog so the values stay internally consistent (Chrome UA + Chrome
/// sec-ch-ua, etc.).
#[derive(Debug, Clone)]
pub struct HeaderProfile {
    pub user_agent: String,
    pub accept_language: String,
    pub accept_encoding: String,
    pub sec_ch_ua: Option<String>,
    pub sec_ch_ua_platform: Option<String>,
}

/// Curated realistic Chrome / Firefox / Edge / Safari descriptors. Matches the
/// TypeScript header-generator config in `src/stealth/headers.ts`:
/// chrome >= 120, firefox >= 121, edge >= 120, safari >= 17.
struct UaEntry {
    user_agent: &'static str,
    sec_ch_ua: Option<&'static str>,
    sec_ch_ua_platform: Option<&'static str>,
}

const UA_CATALOG: &[UaEntry] = &[
    // ── Chrome (Windows / macOS / Linux) ──
    UaEntry {
        user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        sec_ch_ua: Some("\"Chromium\";v=\"131\", \"Google Chrome\";v=\"131\", \"Not-A.Brand\";v=\"99\""),
        sec_ch_ua_platform: Some("\"Windows\""),
    },
    UaEntry {
        user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        sec_ch_ua: Some("\"Chromium\";v=\"130\", \"Google Chrome\";v=\"130\", \"Not-A.Brand\";v=\"99\""),
        sec_ch_ua_platform: Some("\"macOS\""),
    },
    UaEntry {
        user_agent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        sec_ch_ua: Some("\"Chromium\";v=\"130\", \"Google Chrome\";v=\"130\", \"Not-A.Brand\";v=\"99\""),
        sec_ch_ua_platform: Some("\"Linux\""),
    },
    UaEntry {
        user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        sec_ch_ua: Some("\"Chromium\";v=\"128\", \"Google Chrome\";v=\"128\", \"Not-A.Brand\";v=\"99\""),
        sec_ch_ua_platform: Some("\"Windows\""),
    },
    // ── Edge (Windows / macOS) ──
    UaEntry {
        user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
        sec_ch_ua: Some("\"Microsoft Edge\";v=\"131\", \"Chromium\";v=\"131\", \"Not-A.Brand\";v=\"99\""),
        sec_ch_ua_platform: Some("\"Windows\""),
    },
    UaEntry {
        user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
        sec_ch_ua: Some("\"Microsoft Edge\";v=\"130\", \"Chromium\";v=\"130\", \"Not-A.Brand\";v=\"99\""),
        sec_ch_ua_platform: Some("\"macOS\""),
    },
    // ── Firefox (Windows / macOS / Linux) — no sec-ch-ua ──
    UaEntry {
        user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
        sec_ch_ua: None,
        sec_ch_ua_platform: None,
    },
    UaEntry {
        user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.7; rv:132.0) Gecko/20100101 Firefox/132.0",
        sec_ch_ua: None,
        sec_ch_ua_platform: None,
    },
    UaEntry {
        user_agent: "Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0",
        sec_ch_ua: None,
        sec_ch_ua_platform: None,
    },
    // ── Safari (macOS) — no sec-ch-ua ──
    UaEntry {
        user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
        sec_ch_ua: None,
        sec_ch_ua_platform: None,
    },
    UaEntry {
        user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
        sec_ch_ua: None,
        sec_ch_ua_platform: None,
    },
];

/// Accept-Language pool. Default-weighted toward en-US (matches real-world
/// distribution from major browsers in NA/EU).
const ACCEPT_LANGUAGES: &[&str] = &[
    "en-US,en;q=0.9",
    "en-US,en;q=0.9,sr;q=0.8",
    "en-GB,en;q=0.9",
    "en-US,en;q=0.8,de;q=0.6",
    "en-US,en;q=0.9,fr;q=0.7",
];

/// Pick a random realistic browser profile.
pub fn random_profile() -> HeaderProfile {
    let mut rng = rand::thread_rng();
    // `choose` only returns `None` for empty slices; UA_CATALOG is a non-empty const,
    // so this is safe. Use `unwrap_or` to avoid `unwrap()` in library code.
    let entry = UA_CATALOG.choose(&mut rng).unwrap_or(&UA_CATALOG[0]);
    let lang = ACCEPT_LANGUAGES
        .choose(&mut rng)
        .copied()
        .unwrap_or("en-US,en;q=0.9");

    HeaderProfile {
        user_agent: entry.user_agent.to_string(),
        accept_language: lang.to_string(),
        accept_encoding: "gzip, deflate, br".to_string(),
        sec_ch_ua: entry.sec_ch_ua.map(String::from),
        sec_ch_ua_platform: entry.sec_ch_ua_platform.map(String::from),
    }
}

/// Build a complete header map for a given URL (port of `generateHeaders`).
///
/// Includes:
/// - UA + Client Hints (sec-ch-ua, sec-ch-ua-mobile, sec-ch-ua-platform) when applicable
/// - Standard Accept / Accept-Language / Accept-Encoding
/// - sec-fetch-* navigation headers
/// - URL-aware Referer/Origin for .gov / API endpoints
/// - sec-gpc, pragma, cache-control, upgrade-insecure-requests, priority
pub fn header_map_for_url(profile: &HeaderProfile, url: &str) -> HashMap<String, String> {
    let mut h: HashMap<String, String> = HashMap::new();

    // ── Core identity ──
    h.insert("user-agent".into(), profile.user_agent.clone());
    h.insert("accept-language".into(), profile.accept_language.clone());
    h.insert("accept-encoding".into(), profile.accept_encoding.clone());
    h.insert(
        "accept".into(),
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
            .into(),
    );

    // ── Client Hints (Chromium-only) ──
    if let Some(ua) = &profile.sec_ch_ua {
        h.insert("sec-ch-ua".into(), ua.clone());
        h.insert("sec-ch-ua-mobile".into(), "?0".into());
    }
    if let Some(plat) = &profile.sec_ch_ua_platform {
        h.insert("sec-ch-ua-platform".into(), plat.clone());
    }

    // ── URL-aware enrichment ──
    let mut has_referer = false;
    if let Ok(parsed) = url::Url::parse(url) {
        let hostname = parsed.host_str().unwrap_or("").to_ascii_lowercase();
        let path = parsed.path().to_ascii_lowercase();

        let is_gov = hostname.ends_with(".gov") || hostname.ends_with(".gov.com");
        let is_api_like = path.contains(".ashx")
            || path.contains("/api/")
            || path.contains("/proxy")
            || path.contains("proxy");

        if is_gov || is_api_like {
            let origin = format!(
                "{}://{}",
                parsed.scheme(),
                parsed.host_str().unwrap_or_default(),
            );
            h.insert("referer".into(), format!("{origin}/"));
            h.insert("origin".into(), origin);
            has_referer = true;
        }
        if is_gov {
            h.insert("dnt".into(), "1".into());
            h.insert("cache-control".into(), "no-cache".into());
        }
    }

    // ── Navigation headers ──
    h.insert("sec-fetch-dest".into(), "document".into());
    h.insert("sec-fetch-mode".into(), "navigate".into());
    h.insert(
        "sec-fetch-site".into(),
        if has_referer { "same-origin".into() } else { "none".into() },
    );
    h.insert("sec-fetch-user".into(), "?1".into());
    h.insert("upgrade-insecure-requests".into(), "1".into());
    h.insert("priority".into(), "u=0, i".into());

    // ── Misc realistic headers ──
    h.insert("sec-gpc".into(), "1".into());
    h.entry("pragma".into()).or_insert_with(|| "no-cache".into());
    h.entry("cache-control".into()).or_insert_with(|| "max-age=0".into());

    h
}

/// Pick a random User-Agent string only (helper for legacy callers).
pub fn random_user_agent() -> String {
    let mut rng = rand::thread_rng();
    UA_CATALOG
        .choose(&mut rng)
        .map(|e| e.user_agent.to_string())
        .unwrap_or_else(|| {
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36".to_string()
        })
}

/// Pick a random `wreq-util` emulation profile drawn from recent Chrome
/// versions, biased toward newer releases. Used by `tls.rs` to construct a
/// `wreq::Client` with realistic JA3/JA4 fingerprint.
pub fn random_chrome_emulation() -> wreq_util::Emulation {
    // Recent Chrome versions only — older ones have rarer JA3 signatures.
    const POOL: &[wreq_util::Emulation] = &[
        wreq_util::Emulation::Chrome131,
        wreq_util::Emulation::Chrome132,
        wreq_util::Emulation::Chrome133,
        wreq_util::Emulation::Chrome134,
        wreq_util::Emulation::Chrome135,
        wreq_util::Emulation::Chrome136,
        wreq_util::Emulation::Chrome137,
        wreq_util::Emulation::Chrome138,
        wreq_util::Emulation::Chrome139,
        wreq_util::Emulation::Chrome140,
    ];
    let mut rng = rand::thread_rng();
    let idx = rng.gen_range(0..POOL.len());
    POOL[idx]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_has_user_agent() {
        let p = random_profile();
        assert!(!p.user_agent.is_empty());
        assert!(p.user_agent.starts_with("Mozilla/5.0"));
    }

    #[test]
    fn chromium_profile_has_client_hints() {
        // Sample many times — at least one should be Chromium with hints
        let mut found_chromium = false;
        for _ in 0..50 {
            let p = random_profile();
            if p.sec_ch_ua.is_some() {
                found_chromium = true;
                assert!(p.sec_ch_ua_platform.is_some());
            }
        }
        assert!(found_chromium, "expected at least one Chromium profile in 50 samples");
    }

    #[test]
    fn header_map_includes_basics() {
        let p = random_profile();
        let h = header_map_for_url(&p, "https://example.com/");
        assert!(h.contains_key("user-agent"));
        assert!(h.contains_key("accept"));
        assert!(h.contains_key("accept-language"));
        assert!(h.contains_key("sec-fetch-dest"));
        assert_eq!(h.get("upgrade-insecure-requests").map(String::as_str), Some("1"));
    }

    #[test]
    fn gov_url_adds_dnt() {
        let p = random_profile();
        let h = header_map_for_url(&p, "https://example.gov/data");
        assert_eq!(h.get("dnt").map(String::as_str), Some("1"));
        assert!(h.contains_key("referer"));
        assert!(h.contains_key("origin"));
    }

    #[test]
    fn api_url_adds_origin() {
        let p = random_profile();
        let h = header_map_for_url(&p, "https://example.com/api/v1/data");
        assert!(h.contains_key("referer"));
        assert!(h.contains_key("origin"));
        assert_eq!(h.get("sec-fetch-site").map(String::as_str), Some("same-origin"));
    }

    #[test]
    fn random_user_agent_nonempty() {
        let ua = random_user_agent();
        assert!(!ua.is_empty());
    }
}
