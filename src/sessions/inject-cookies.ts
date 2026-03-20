/**
 * Cookie injection helper — bridges persistent browser sessions to HTTP tools.
 *
 * After a browser login, cookies are stored in SessionManager.
 * This module extracts those cookies and formats them as HTTP Cookie headers,
 * so tools like scrape, extract, readability, download can reuse the same auth.
 *
 * Domain/path/expiry filtering ensures only relevant cookies are sent.
 */

import { getSessionManager } from "./manager.js";
import type { StoredCookie } from "./types.js";

/**
 * Build a Cookie header string from stored cookies, filtering by URL.
 */
function buildCookieHeader(cookies: StoredCookie[], url: string): string {
  const parsed = new URL(url);
  const hostname = parsed.hostname;
  const pathname = parsed.pathname;
  const now = Date.now() / 1000;

  return cookies
    .filter((c) => {
      // Domain match: ".example.com" matches "sub.example.com"
      const cookieDomain = c.domain.startsWith(".") ? c.domain : `.${c.domain}`;
      if (!`.${hostname}`.endsWith(cookieDomain)) return false;
      // Path match
      if (c.path && !pathname.startsWith(c.path)) return false;
      // Expiry check
      if (c.expires && c.expires > 0 && c.expires < now) return false;
      return true;
    })
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

/**
 * Get Cookie header string for a session + URL.
 * Returns empty string if no matching cookies found.
 */
export async function getSessionCookieHeader(sessionId: string, url: string): Promise<string> {
  const session = await getSessionManager().load(sessionId);
  if (!session?.cookies.length) return "";
  return buildCookieHeader(session.cookies, url);
}

/**
 * Inject session cookies into HTTP request headers.
 * Merges with any existing headers, adding Cookie header if session has matching cookies.
 */
export async function injectSessionHeaders(
  sessionId: string,
  url: string,
  headers: Record<string, string> = {},
): Promise<Record<string, string>> {
  const cookieHeader = await getSessionCookieHeader(sessionId, url);
  if (cookieHeader) {
    headers["Cookie"] = cookieHeader;
  }
  return headers;
}
