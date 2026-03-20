import { HeaderGenerator } from "header-generator";

const generator = new HeaderGenerator({
  browsers: [
    { name: "chrome", minVersion: 126 },
    { name: "firefox", minVersion: 125 },
    { name: "edge", minVersion: 126 },
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

export function generateHeaders(overrides?: Record<string, string>): Record<string, string> {
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
  headers["sec-fetch-site"] = "none";
  headers["sec-fetch-user"] = "?1";
  headers["upgrade-insecure-requests"] = "1";

  return { ...headers, ...overrides };
}

export function getRandomUserAgent(): string {
  const headers = generator.getHeaders();
  return headers["user-agent"] || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
}
