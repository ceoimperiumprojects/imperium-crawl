//! Cookie-jar helpers: merge by `(name, domain, path)` and filter by URL.
//!
//! These helpers operate on the [`Cookie`] type owned by `imperium-crawl-core`
//! so every layer (sessions, browser, stealth) shares the same data model.

use imperium_crawl_core::{Cookie, Result};
use url::Url;

/// Stable identity key for cookies: `(name, domain, path)`.
///
/// Two cookies with the same key but different values are considered the same
/// logical cookie — the incoming value wins.
fn key(c: &Cookie) -> (&str, &str, &str) {
    (c.name.as_str(), c.domain.as_str(), c.path.as_str())
}

/// Merge `incoming` cookies into `existing`, deduplicating by `(name, domain,
/// path)`. When a key collides the incoming cookie replaces the existing one
/// (incoming is treated as the newer state).
pub fn merge_cookies(existing: &mut Vec<Cookie>, incoming: Vec<Cookie>) {
    for inc in incoming {
        if let Some(slot) = existing
            .iter_mut()
            .find(|c| key(c) == (inc.name.as_str(), inc.domain.as_str(), inc.path.as_str()))
        {
            *slot = inc;
        } else {
            existing.push(inc);
        }
    }
}

/// Does `cookie_domain` match `host`?
///
/// Match rules (RFC 6265 §5.1.3-ish, simplified):
///
/// - Strip a leading `.` from the cookie domain.
/// - Exact match: `host == cookie_domain`.
/// - Suffix match: `host` ends with `.<cookie_domain>`.
fn domain_matches(host: &str, cookie_domain: &str) -> bool {
    let host = host.trim_start_matches('.').to_ascii_lowercase();
    let cookie = cookie_domain.trim_start_matches('.').to_ascii_lowercase();
    if cookie.is_empty() {
        return false;
    }
    if host == cookie {
        return true;
    }
    host.ends_with(&format!(".{cookie}"))
}

/// Path-match rule (RFC 6265 §5.1.4):
///
/// - Identical paths match.
/// - `request_path` starts with `cookie_path` AND either `cookie_path` ends with
///   `/`, or the next character in `request_path` is `/`.
fn path_matches(request_path: &str, cookie_path: &str) -> bool {
    if cookie_path.is_empty() || cookie_path == "/" {
        return true;
    }
    if request_path == cookie_path {
        return true;
    }
    if !request_path.starts_with(cookie_path) {
        return false;
    }
    cookie_path.ends_with('/')
        || request_path.as_bytes().get(cookie_path.len()) == Some(&b'/')
}

/// Return references to every cookie in `cookies` whose `domain` and `path`
/// match the parsed URL.
///
/// Returns `Err(InvalidUrl)` if `url` fails to parse.
pub fn cookies_for_url<'a>(cookies: &'a [Cookie], url: &str) -> Result<Vec<&'a Cookie>> {
    let parsed = Url::parse(url).map_err(|e| {
        imperium_crawl_core::CrawlError::InvalidUrl(format!("{e}: {url}"))
    })?;
    let host = parsed.host_str().unwrap_or("");
    let path = if parsed.path().is_empty() { "/" } else { parsed.path() };

    Ok(cookies
        .iter()
        .filter(|c| domain_matches(host, &c.domain) && path_matches(path, &c.path))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use imperium_crawl_core::{Cookie, SameSite};

    fn ck(name: &str, value: &str, domain: &str, path: &str) -> Cookie {
        Cookie {
            name: name.into(),
            value: value.into(),
            domain: domain.into(),
            path: path.into(),
            expires: None,
            http_only: Some(false),
            secure: Some(false),
            same_site: Some(SameSite::Lax),
        }
    }

    #[test]
    fn merge_dedupes_by_key() {
        let mut existing = vec![
            ck("sid", "old", ".example.com", "/"),
            ck("theme", "dark", ".example.com", "/"),
        ];
        let incoming = vec![
            ck("sid", "new", ".example.com", "/"),
            ck("lang", "en", ".example.com", "/"),
        ];
        merge_cookies(&mut existing, incoming);

        assert_eq!(existing.len(), 3, "sid replaced, theme kept, lang added");
        let sid = existing.iter().find(|c| c.name == "sid").unwrap();
        assert_eq!(sid.value, "new", "incoming value wins");
        assert!(existing.iter().any(|c| c.name == "theme"));
        assert!(existing.iter().any(|c| c.name == "lang"));
    }

    #[test]
    fn merge_treats_different_paths_as_distinct() {
        let mut existing = vec![ck("sid", "root", ".example.com", "/")];
        let incoming = vec![ck("sid", "admin", ".example.com", "/admin")];
        merge_cookies(&mut existing, incoming);
        assert_eq!(existing.len(), 2, "same name + domain + different path = different cookie");
    }

    #[test]
    fn cookies_for_url_matches_host_and_path() {
        let cookies = vec![
            ck("a", "1", ".example.com", "/"),         // matches
            ck("b", "2", "example.com", "/"),          // matches (no dot)
            ck("c", "3", "api.example.com", "/"),      // does NOT match www.example.com
            ck("d", "4", ".other.com", "/"),           // does NOT match
            ck("e", "5", ".example.com", "/admin"),    // does NOT match /dashboard
            ck("f", "6", ".example.com", "/dashboard"), // matches
        ];
        let got = cookies_for_url(&cookies, "https://www.example.com/dashboard").unwrap();
        let names: Vec<_> = got.iter().map(|c| c.name.as_str()).collect();
        assert!(names.contains(&"a"));
        assert!(names.contains(&"b"));
        assert!(names.contains(&"f"));
        assert!(!names.contains(&"c"));
        assert!(!names.contains(&"d"));
        assert!(!names.contains(&"e"));
    }

    #[test]
    fn cookies_for_url_path_prefix_must_end_at_boundary() {
        // /admin should NOT match /administrator.
        let cookies = vec![ck("x", "y", ".example.com", "/admin")];
        let got = cookies_for_url(&cookies, "https://example.com/administrator").unwrap();
        assert!(got.is_empty());
        // But /admin DOES match /admin/users.
        let got = cookies_for_url(&cookies, "https://example.com/admin/users").unwrap();
        assert_eq!(got.len(), 1);
    }

    #[test]
    fn cookies_for_url_rejects_bad_url() {
        let cookies = vec![ck("a", "1", ".example.com", "/")];
        let err = cookies_for_url(&cookies, "not a url").unwrap_err();
        assert!(matches!(err, imperium_crawl_core::CrawlError::InvalidUrl(_)));
    }
}
