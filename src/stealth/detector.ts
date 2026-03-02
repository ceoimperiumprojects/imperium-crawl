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

/**
 * Detect if a response is blocked by anti-bot protection.
 * Checks HTTP status, page content, and structural signals.
 */
export function isBlocked(html: string, status: number, headers?: Record<string, string>): boolean {
  // Hard blocks by status
  if (status === 403 || status === 429 || status === 503) return true;

  // cf-mitigated header
  if (headers && headers["cf-mitigated"]) return true;

  const lower = html.toLowerCase();

  // Content-based indicators
  if (BLOCKED_INDICATORS.some((indicator) => lower.includes(indicator))) return true;

  // Challenge page title patterns
  const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
  if (titleMatch) {
    const title = titleMatch[1].trim();
    if (CHALLENGE_TITLE_PATTERNS.some((p) => p.test(title))) return true;
  }

  // Unusually small response body for what should be a full page
  // (challenge pages are typically <1KB of real content)
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    const bodyContent = bodyMatch[1]
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]*>/g, "")
      .trim();
    // If page has a title but almost no body text, likely a block page
    if (titleMatch && bodyContent.length < 50 && status >= 400) return true;
  }

  return false;
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
