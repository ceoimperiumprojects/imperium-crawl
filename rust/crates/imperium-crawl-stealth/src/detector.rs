//! Anti-bot platform detector. Port of `src/stealth/antibot-detector.ts`.
//!
//! Classifies a response (status + headers + body) into an `AntiBotSignal`.
//! Used by `StealthClient` to decide whether to escalate L1 → L2 → L3.

use std::collections::HashMap;

use imperium_crawl_core::StealthLevel;

/// Anti-bot platform signal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AntiBotSignal {
    /// Cloudflare WAF / challenge.
    Cloudflare,
    /// Akamai Bot Manager.
    Akamai,
    /// PerimeterX / HUMAN.
    PerimeterX,
    /// DataDome.
    DataDome,
    /// Kasada.
    Kasada,
    /// AWS WAF.
    AwsWaf,
    /// F5 / Shape Security.
    F5,
    /// Generic 403 with no specific platform signature.
    Generic403,
    /// JavaScript challenge page (e.g. small body + multiple scripts).
    JsChallenge,
    /// CAPTCHA / interactive challenge (incl. GeeTest).
    Captcha,
    /// Clean response — no detection signals.
    None,
}

impl AntiBotSignal {
    /// Stealth level recommended for this signal. Mirrors the
    /// `RECOMMENDED_LEVELS` table in the TS file.
    pub fn recommended_level(&self) -> StealthLevel {
        match self {
            AntiBotSignal::Cloudflare
            | AntiBotSignal::Akamai
            | AntiBotSignal::PerimeterX
            | AntiBotSignal::DataDome
            | AntiBotSignal::Kasada
            | AntiBotSignal::F5
            | AntiBotSignal::Captcha
            | AntiBotSignal::JsChallenge => StealthLevel::L3Browser,
            AntiBotSignal::AwsWaf | AntiBotSignal::Generic403 => StealthLevel::L2Tls,
            AntiBotSignal::None => StealthLevel::L1Headers,
        }
    }

    pub fn is_block(&self) -> bool {
        !matches!(self, AntiBotSignal::None)
    }
}

pub struct AntiBotDetector;

impl AntiBotDetector {
    /// Classify a response. Header keys are matched case-insensitively.
    ///
    /// Note: `body` is byte slice — we sniff up to the first 256 KiB as text
    /// (lossy UTF-8). Anything past that on a real anti-bot page is noise
    /// (the challenge fits in the first few KB).
    pub fn classify(
        status: u16,
        headers: &HashMap<String, String>,
        body: &[u8],
    ) -> AntiBotSignal {
        // Normalize headers to lowercase keys.
        let headers_lc: HashMap<String, String> = headers
            .iter()
            .map(|(k, v)| (k.to_ascii_lowercase(), v.clone()))
            .collect();

        // Sniff body as text (lossy, capped).
        const SNIFF_CAP: usize = 256 * 1024;
        let cap = body.len().min(SNIFF_CAP);
        let body_text = String::from_utf8_lossy(&body[..cap]);
        let body_lc = body_text.to_ascii_lowercase();

        // Parse Set-Cookie names (lowercase) from header.
        let cookies_lc: Vec<String> = headers_lc
            .get("set-cookie")
            .map(|raw| parse_cookie_names(raw))
            .unwrap_or_default()
            .into_iter()
            .map(|n| n.to_ascii_lowercase())
            .collect();

        // ── Cloudflare ──
        // Strongest single signals win. Order matters: we check most specific first.
        if cookies_lc.iter().any(|c| c.starts_with("cf_clearance")) {
            return AntiBotSignal::Cloudflare;
        }
        if body_lc.contains("<title>just a moment...</title>")
            || body_lc.contains("/cdn-cgi/challenge-platform/")
        {
            return AntiBotSignal::Cloudflare;
        }
        if headers_lc.contains_key("cf-mitigated") || headers_lc.contains_key("cf-ray") {
            // cf-ray alone is not a block, but combined with 403/503 it usually is.
            if status == 403 || status == 503 || body_lc.contains("cloudflare") {
                return AntiBotSignal::Cloudflare;
            }
        }
        if headers_lc
            .get("server")
            .map(|v| v.eq_ignore_ascii_case("cloudflare"))
            .unwrap_or(false)
            && (status == 403 || status == 503)
        {
            return AntiBotSignal::Cloudflare;
        }

        // ── Akamai ──
        if cookies_lc.iter().any(|c| c.starts_with("_abck"))
            || cookies_lc.iter().any(|c| c.starts_with("bm_sz"))
            || cookies_lc.iter().any(|c| c.starts_with("ak_bmsc"))
        {
            return AntiBotSignal::Akamai;
        }

        // ── PerimeterX / HUMAN ──
        if cookies_lc.iter().any(|c| c.starts_with("_px"))
            || body_lc.contains("px-captcha")
            || body_lc.contains("client.perimeterx.net")
        {
            return AntiBotSignal::PerimeterX;
        }

        // ── DataDome ──
        if cookies_lc.iter().any(|c| c.starts_with("datadome"))
            || headers_lc.keys().any(|k| k.starts_with("x-datadome"))
            || body_lc.contains("js.datadome.co")
        {
            return AntiBotSignal::DataDome;
        }

        // ── Kasada ──
        if headers_lc.keys().any(|k| k.starts_with("x-kpsdk"))
            || (body_lc.contains("ips.js") && body_lc.contains("_kpsdk"))
        {
            return AntiBotSignal::Kasada;
        }

        // ── AWS WAF ──
        if cookies_lc.iter().any(|c| c.starts_with("aws-waf-token"))
            || body_lc.contains("awswaf")
        {
            return AntiBotSignal::AwsWaf;
        }

        // ── F5 / Shape Security ──
        if body_lc.contains("shape.js") || body_lc.contains("shapesecurity.com") {
            return AntiBotSignal::F5;
        }
        // ts<6+ hex-digits> cookie name
        if cookies_lc
            .iter()
            .any(|c| c.starts_with("ts") && c.len() >= 8 && c[2..].chars().all(|ch| ch.is_ascii_hexdigit()))
        {
            return AntiBotSignal::F5;
        }

        // ── CAPTCHA (GeeTest / generic reCAPTCHA / hCaptcha) ──
        if body_lc.contains("g-recaptcha")
            || body_lc.contains("h-captcha")
            || body_lc.contains("hcaptcha.com")
            || body_lc.contains("recaptcha/api.js")
            || body_lc.contains("geetest")
            || body_lc.contains("gt.js")
        {
            return AntiBotSignal::Captcha;
        }

        // ── Generic JS Challenge (unknown anti-bot fallback) ──
        if let Some(body_start) = body_lc.find("<body") {
            let body_section = &body_lc[body_start..];
            let body_end = body_section.find("</body>").unwrap_or(body_section.len());
            let body_inner = &body_section[..body_end];

            let script_count = body_inner.matches("<script").count();
            let has_noscript = body_inner.contains("<noscript>");
            // Cheap "text content size": body length minus tag-heavy size as a proxy.
            // We don't strip tags fully — just check the *body* is small overall.
            let body_size = body_inner.len();

            if body_size < 4_000 && script_count >= 2 {
                return AntiBotSignal::JsChallenge;
            }
            if has_noscript && body_size < 8_000 && script_count >= 3 {
                return AntiBotSignal::JsChallenge;
            }
            if body_lc.contains("window.location") && body_lc.contains("document.cookie") {
                return AntiBotSignal::JsChallenge;
            }
        }

        // ── Status-based fallback ──
        if status == 403 {
            return AntiBotSignal::Generic403;
        }
        if status == 429 {
            return AntiBotSignal::Generic403; // rate-limit / soft block — escalate to L2
        }

        AntiBotSignal::None
    }
}

/// Extract cookie names from a (possibly comma-joined) Set-Cookie header.
/// `reqwest`/`wreq` typically expose Set-Cookie as repeated header entries, so
/// callers should already collapse them into one comma-separated string before
/// passing into the classifier — or pass the raw concatenation. We split on
/// commas-before-cookie-name to handle either layout.
fn parse_cookie_names(raw: &str) -> Vec<String> {
    let mut out = Vec::new();
    // Heuristic split: cookie boundaries are commas not preceded by an Expires day-of-week.
    // Cheap version: split on ", " followed by token=, which is good enough for name extraction.
    let mut last = 0usize;
    let bytes = raw.as_bytes();
    let mut i = 0;
    while i + 2 < bytes.len() {
        if bytes[i] == b',' {
            // Look ahead: skip whitespace, then check for `name=`
            let mut j = i + 1;
            while j < bytes.len() && bytes[j] == b' ' {
                j += 1;
            }
            // Read potential name [A-Za-z0-9_-]+
            let mut k = j;
            while k < bytes.len() && is_cookie_name_char(bytes[k]) {
                k += 1;
            }
            if k > j && k < bytes.len() && bytes[k] == b'=' {
                // boundary found
                out.push(name_only(&raw[last..i]));
                last = j;
                i = k;
                continue;
            }
        }
        i += 1;
    }
    if last < raw.len() {
        out.push(name_only(&raw[last..]));
    }
    out.into_iter().filter(|s| !s.is_empty()).collect()
}

fn is_cookie_name_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'-' || b == b'.'
}

fn name_only(piece: &str) -> String {
    let trimmed = piece.trim();
    if let Some(eq) = trimmed.find('=') {
        trimmed[..eq].trim().to_string()
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hm(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn clean_200_is_none() {
        let signal = AntiBotDetector::classify(200, &hm(&[]), b"<html><body><h1>Example</h1></body></html>");
        assert_eq!(signal, AntiBotSignal::None);
    }

    #[test]
    fn cloudflare_just_a_moment() {
        let body = b"<html><head><title>Just a moment...</title></head></html>";
        let signal = AntiBotDetector::classify(503, &hm(&[("cf-ray", "abc")]), body);
        assert_eq!(signal, AntiBotSignal::Cloudflare);
    }

    #[test]
    fn cloudflare_cf_clearance_cookie() {
        let h = hm(&[("set-cookie", "cf_clearance=abc; Path=/; Secure")]);
        let signal = AntiBotDetector::classify(200, &h, b"");
        assert_eq!(signal, AntiBotSignal::Cloudflare);
    }

    #[test]
    fn datadome_cookie() {
        let h = hm(&[("set-cookie", "datadome=xyz123; Path=/")]);
        let signal = AntiBotDetector::classify(200, &h, b"");
        assert_eq!(signal, AntiBotSignal::DataDome);
    }

    #[test]
    fn aws_waf() {
        let h = hm(&[("set-cookie", "aws-waf-token=foo")]);
        assert_eq!(AntiBotDetector::classify(200, &h, b""), AntiBotSignal::AwsWaf);
    }

    #[test]
    fn captcha_recaptcha() {
        let body = br#"<html><body><div class="g-recaptcha"></div></body></html>"#;
        assert_eq!(
            AntiBotDetector::classify(200, &hm(&[]), body),
            AntiBotSignal::Captcha
        );
    }

    #[test]
    fn generic_403() {
        let signal = AntiBotDetector::classify(403, &hm(&[]), b"<html><body>Forbidden</body></html>");
        assert_eq!(signal, AntiBotSignal::Generic403);
    }

    #[test]
    fn recommended_level_cloudflare_is_l3() {
        assert_eq!(
            AntiBotSignal::Cloudflare.recommended_level(),
            StealthLevel::L3Browser
        );
    }

    #[test]
    fn recommended_level_aws_waf_is_l2() {
        assert_eq!(
            AntiBotSignal::AwsWaf.recommended_level(),
            StealthLevel::L2Tls
        );
    }

    #[test]
    fn cookie_name_extraction() {
        let names = parse_cookie_names("cf_clearance=abc; Path=/, sessionid=xyz; HttpOnly");
        assert!(names.iter().any(|n| n == "cf_clearance"));
        assert!(names.iter().any(|n| n == "sessionid"));
    }
}
