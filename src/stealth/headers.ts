import { HeaderGenerator } from "header-generator";

const generator = new HeaderGenerator({
  browsers: [
    { name: "chrome", minVersion: 120 },
    { name: "firefox", minVersion: 121 },
    { name: "edge", minVersion: 120 },
    { name: "safari", minVersion: 17 },
  ],
  devices: ["desktop"],
  operatingSystems: ["windows", "macos", "linux"],
});

/**
 * Parse Chrome major version from User-Agent string.
 */
function parseChromeVersion(ua: string): string | null {
  const match = ua.match(/Chrome\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Detect platform from User-Agent for sec-ch-ua-platform.
 */
function detectPlatform(ua: string): string {
  if (ua.includes("Windows")) return '"Windows"';
  if (ua.includes("Macintosh") || ua.includes("Mac OS")) return '"macOS"';
  if (ua.includes("Linux")) return '"Linux"';
  return '"Windows"';
}

/**
 * Build sec-ch-ua hint from Chrome version.
 * Matches real Chrome's format with Chromium brand + version.
 */
function buildSecChUa(majorVersion: string): string {
  return `"Chromium";v="${majorVersion}", "Google Chrome";v="${majorVersion}", "Not-A.Brand";v="99"`;
}

export function generateHeaders(overrides?: Record<string, string>, url?: string): Record<string, string> {
  const headers = generator.getHeaders();

  // ── Add Client Hints if Chrome/Edge UA detected ──
  const ua = headers["user-agent"] || "";
  const chromeVersion = parseChromeVersion(ua);

  if (chromeVersion) {
    // sec-ch-ua hints — must be consistent with User-Agent
    headers["sec-ch-ua"] = buildSecChUa(chromeVersion);
    headers["sec-ch-ua-mobile"] = "?0";
    headers["sec-ch-ua-platform"] = detectPlatform(ua);
  }

  // ── URL-aware header enrichment ──
  if (url) {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname;

      // Add origin-based Referer for API endpoints and .gov sites
      if (hostname.endsWith(".gov") || hostname.endsWith(".gov.com") ||
          parsed.pathname.includes(".ashx") || parsed.pathname.includes("/api/") ||
          parsed.pathname.includes("/proxy") || parsed.pathname.includes("Proxy")) {
        headers["referer"] = `${parsed.origin}/`;
        headers["origin"] = parsed.origin;
      }

      // .gov sites: add DNT and cache-control for less aggressive fingerprint
      if (hostname.endsWith(".gov")) {
        headers["dnt"] = "1";
        headers["cache-control"] = "no-cache";
      }
    } catch {
      // Invalid URL, skip enrichment
    }
  }

  // ── Standard Accept headers ──
  if (!headers["accept"]) {
    headers["accept"] = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8";
  }
  if (!headers["accept-language"]) {
    headers["accept-language"] = "en-US,en;q=0.9";
  }
  if (!headers["accept-encoding"]) {
    headers["accept-encoding"] = "gzip, deflate, br";
  }

  // ── Navigation headers ──
  headers["sec-fetch-dest"] = "document";
  headers["sec-fetch-mode"] = "navigate";
  headers["sec-fetch-site"] = headers["referer"] ? "same-origin" : "none";
  headers["sec-fetch-user"] = "?1";
  headers["upgrade-insecure-requests"] = "1";
  headers["priority"] = "u=0, i";

  // ── Additional realistic browser headers ──
  // sec-gpc: Global Privacy Control — sent by Chrome/Firefox for GDPR compliance
  headers["sec-gpc"] = "1";
  // te: trailers — real Chrome sends this on HTTP/2+ requests
  headers["te"] = "trailers";
  // pragma for HTTP/1.1 backwards compatibility with older proxies/caches
  if (!headers["pragma"]) {
    headers["pragma"] = "no-cache";
  }
  // cache-control — real browsers send this on navigations
  if (!headers["cache-control"]) {
    headers["cache-control"] = "max-age=0";
  }
  // x-requested-with is sent by some sites to identify non-AJAX vs AJAX
  delete headers["x-requested-with"];
  // Remove any non-standard headers that could fingerprint the scraper
  delete headers["x-devtools-emulate-network-conditions-client-id"];

  return { ...headers, ...overrides };
}

export function getRandomUserAgent(): string {
  const headers = generator.getHeaders();
  return headers["user-agent"] || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
}
