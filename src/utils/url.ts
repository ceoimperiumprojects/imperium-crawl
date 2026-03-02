import normalizeUrlLib from "normalize-url";

// Tracking parameters to strip (marketing, analytics, session)
const TRACKING_PARAMS = new Set([
  // Google / UTM
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
  // Facebook
  "fbclid", "fb_action_ids", "fb_action_types", "fb_source", "fb_ref",
  // Google Ads
  "gclid", "gclsrc", "dclid", "gbraid", "wbraid",
  // Microsoft
  "msclkid",
  // HubSpot
  "hsa_cam", "hsa_grp", "hsa_mt", "hsa_src", "hsa_ad", "hsa_acc", "hsa_net", "hsa_ver", "hsa_la", "hsa_ol", "hsa_kw",
  // Mailchimp
  "mc_cid", "mc_eid",
  // Adobe
  "s_kwcid", "ef_id",
  // General tracking
  "ref", "_ref", "ref_", "source", "click_id", "campaign_id",
  // Session / misc
  "_ga", "_gl", "_hsenc", "_hsmi", "_openstat", "yclid", "wickedid",
]);

/**
 * Full URL normalization with 11 steps:
 * 1. Scheme lowering (HTTPS → https)
 * 2. Host lowering (Example.COM → example.com)
 * 3. Default port removal (:443 for https, :80 for http)
 * 4. Path normalization (resolve ../ and ./)
 * 5. Percent-encoding normalization
 * 6. Fragment removal (#section → removed)
 * 7. Query param sorting (a=1&b=2, not b=2&a=1)
 * 8. Tracking param removal (utm_*, fbclid, gclid, etc.)
 * 9. Trailing slash normalization
 * 10. www removal (optional, default: remove)
 * 11. Protocol defaulting (add https:// if missing)
 */
export function normalizeUrl(raw: string): string {
  try {
    // normalize-url handles steps 1-7, 9-11
    let normalized = normalizeUrlLib(raw, {
      defaultProtocol: "https",
      normalizeProtocol: true,
      forceHttps: false,
      stripAuthentication: true,
      stripHash: true,
      stripTextFragment: true,
      stripWWW: true,
      removeQueryParameters: [...TRACKING_PARAMS],
      removeTrailingSlash: true,
      removeSingleSlash: false,
      removeDirectoryIndex: false,
      removeExplicitPort: true,
      sortQueryParameters: true,
    });

    return normalized;
  } catch {
    // Fallback to basic normalization
    try {
      if (!raw.startsWith("http://") && !raw.startsWith("https://")) {
        raw = `https://${raw}`;
      }
      const u = new URL(raw);
      u.hash = "";
      if (u.pathname !== "/" && u.pathname.endsWith("/")) {
        u.pathname = u.pathname.slice(0, -1);
      }
      return u.toString();
    } catch {
      throw new Error(`Invalid URL: ${raw}`);
    }
  }
}

export function isValidUrl(raw: string): boolean {
  try {
    new URL(raw);
    return true;
  } catch {
    return false;
  }
}

export function isSameOrigin(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.origin === ub.origin;
  } catch {
    return false;
  }
}

export function getBaseUrl(url: string): string {
  const u = new URL(url);
  return `${u.protocol}//${u.host}`;
}

/**
 * Check if a URL has tracking parameters that should be stripped.
 */
export function hasTrackingParams(url: string): boolean {
  try {
    const u = new URL(url);
    for (const key of u.searchParams.keys()) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) return true;
    }
    return false;
  } catch {
    return false;
  }
}
