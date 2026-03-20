const BLOCKED_INDICATORS = [
  "access denied",
  "403 forbidden",
  "captcha",
  "cf-challenge",
  "just a moment",
  "checking your browser",
  "blocked",
  "rate limit",
  "too many requests",
  // Extended soft-block patterns
  "verify you are human",
  "please complete the security check",
  "please turn javascript on",
  "enable javascript",
  "please enable cookies",
  "automated access",
  "bot detection",
  "unusual traffic",
  "sorry, you have been blocked",
  "one more step",
  "attention required",
];

const CHALLENGE_TITLE_PATTERNS = [
  /just a moment/i,
  /attention required/i,
  /access denied/i,
  /security check/i,
  /are you a robot/i,
  /one more step/i,
  /please wait/i,
  /ddos-guard/i,
];

const SPA_INDICATORS = [
  '<div id="root"></div>',
  '<div id="app"></div>',
  '<div id="__next"></div>',
  "__NEXT_DATA__",
  "window.__NUXT__",
  "ng-app",
  'id="__nuxt"',
];

// ── Anti-bot signal headers that confirm a status code is actually a block ──
const ANTI_BOT_HEADERS = [
  "cf-ray",
  "cf-mitigated",
  "x-datadome",
  "x-datadome-cid",
  "x-kpsdk-ct",
  "x-sucuri-id",
  "x-distil-cs",
];

/**
 * Extract text content from HTML, stripping script/style tags.
 * Returns the text length and the cleaned text.
 */
function extractTextContent(html: string): { text: string; length: number } {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const content = bodyMatch ? bodyMatch[1] : html;
  const text = content
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]*>/g, "")
    .trim();
  return { text, length: text.length };
}

/**
 * Count links in HTML.
 */
function countLinks(html: string): number {
  const matches = html.match(/<a\s/gi);
  return matches ? matches.length : 0;
}

/**
 * Check if response headers contain known anti-bot signals.
 */
function hasAntiBotHeaders(headers: Record<string, string>): boolean {
  const lowerHeaders = Object.keys(headers).map((k) => k.toLowerCase());
  return ANTI_BOT_HEADERS.some((h) => lowerHeaders.includes(h));
}

/**
 * Check if the page has challenge scripts (Cloudflare, DataDome, etc.)
 */
function hasChallengeScript(html: string): boolean {
  return (
    html.includes("/cdn-cgi/challenge-platform/") ||
    html.includes("js.datadome.co") ||
    html.includes("client.perimeterx.net") ||
    html.includes("awswaf") ||
    html.includes("_kpsdk")
  );
}

// ── Legitimate page threshold: pages above this are almost never block pages ──
const LEGITIMATE_TEXT_THRESHOLD = 5000; // 5KB of text content
const SMALL_PAGE_THRESHOLD = 5000; // Only check content indicators on small pages
const MIN_LINKS_FOR_LEGITIMATE = 10;

/**
 * Detect if a response is blocked by anti-bot protection.
 *
 * Uses a layered approach to minimize false positives:
 * 1. Status codes (403/429/503) only trigger block if paired with anti-bot signals
 * 2. Content-based checks only run on small pages (<5KB text)
 * 3. Large pages with navigation are treated as legitimate regardless
 */
export function isBlocked(html: string, status: number, headers?: Record<string, string>): boolean {
  const responseHeaders = headers || {};
  const hasAntiBot = hasAntiBotHeaders(responseHeaders);
  const hasChallengeJs = hasChallengeScript(html);
  const { text: bodyText, length: textLength } = extractTextContent(html);

  // ── cf-mitigated header is an explicit block signal ──
  if (responseHeaders["cf-mitigated"]) return true;

  // ── Status-based detection (only with anti-bot confirmation) ──
  if (status === 403 || status === 429 || status === 503) {
    // If anti-bot headers or challenge scripts present → definitely blocked
    if (hasAntiBot || hasChallengeJs) return true;

    // If response body is very small, likely a block page
    if (textLength < SMALL_PAGE_THRESHOLD) {
      // Check title for challenge patterns
      const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
      if (titleMatch) {
        const title = titleMatch[1].trim();
        if (CHALLENGE_TITLE_PATTERNS.some((p) => p.test(title))) return true;
      }

      // Small body + error status + blocked indicators in body → block
      const lower = bodyText.toLowerCase();
      if (BLOCKED_INDICATORS.some((indicator) => lower.includes(indicator))) return true;
    }

    // Large 403/503 without anti-bot signals → NOT a block (e.g. custom error page, maintenance)
    return false;
  }

  // ── Legitimate page signals — bail early for large, link-rich pages ──
  if (textLength > LEGITIMATE_TEXT_THRESHOLD && countLinks(html) > MIN_LINKS_FOR_LEGITIMATE) {
    return false;
  }

  // ── Challenge page title patterns (any status) ──
  const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
  if (titleMatch) {
    const title = titleMatch[1].trim();
    if (CHALLENGE_TITLE_PATTERNS.some((p) => p.test(title))) return true;
  }

  // ── Content-based indicators (only for small pages to avoid article false positives) ──
  if (textLength < SMALL_PAGE_THRESHOLD) {
    const lower = bodyText.toLowerCase();
    if (BLOCKED_INDICATORS.some((indicator) => lower.includes(indicator))) {
      // Extra check: if page also has challenge scripts or anti-bot headers → block
      if (hasChallengeJs || hasAntiBot) return true;

      // If body is VERY small (<1KB), indicator match is strong enough alone
      if (textLength < 1000) return true;
    }
  }

  // ── Structural check: title but almost no body text on error status ──
  if (titleMatch && textLength < 50 && status >= 400) return true;

  return false;
}

/**
 * Detect if a page contains a CAPTCHA challenge.
 * Separate from isBlocked — a CAPTCHA page CAN be solved, it's not a hard block.
 */
export function isCaptchaPage(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    lower.includes("captcha") ||
    lower.includes("cf-turnstile") ||
    lower.includes("g-recaptcha") ||
    lower.includes("h-captcha") ||
    lower.includes("verify you are human") ||
    lower.includes("please complete the security check")
  );
}

/**
 * Detect if a page requires JavaScript rendering to get content.
 */
export function needsJSRendering(html: string): boolean {
  // Empty or near-empty body
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    const bodyContent = bodyMatch[1].replace(/<script[\s\S]*?<\/script>/gi, "").trim();
    if (bodyContent.length < 100) return true;
  }

  // Known SPA shells
  return SPA_INDICATORS.some((indicator) => html.includes(indicator));
}
