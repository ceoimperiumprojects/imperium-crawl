import { generateHeaders } from "./headers.js";
import { isBlocked, needsJSRendering, isCaptchaPage } from "./detector.js";
import { detectAntiBot, parseCookieNames } from "./antibot-detector.js";
import { stealthFetch } from "./tls.js";
import { browserFetch, isPlaywrightAvailable } from "./browser.js";
import { resolveProxy } from "./proxy.js";
import { DEFAULT_TIMEOUT_MS } from "../constants.js";
import { getDomain } from "../utils/url.js";
import { getKnowledgeEngine } from "../knowledge/index.js";
import { getTwoCaptchaApiKey } from "../config.js";
import type { StoredCookie } from "../sessions/types.js";

/**
 * Build a Cookie header string from stored session cookies,
 * filtering by domain and path match for the given URL.
 */
function buildCookieHeader(cookies: StoredCookie[], url: string): string {
  const parsed = new URL(url);
  const hostname = parsed.hostname;
  const pathname = parsed.pathname;
  const now = Date.now() / 1000;

  return cookies
    .filter((c) => {
      // Domain match: cookie domain ".example.com" matches "sub.example.com"
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
 * Load session cookies and build Cookie header if sessionId is provided.
 */
async function getSessionCookieHeader(sessionId: string | undefined, url: string): Promise<string | undefined> {
  if (!sessionId) return undefined;
  const { getSessionManager } = await import("../sessions/manager.js");
  const session = await getSessionManager().load(sessionId);
  if (!session?.cookies.length) return undefined;
  const header = buildCookieHeader(session.cookies, url);
  return header || undefined;
}

/**
 * Parse Set-Cookie headers into StoredCookie objects for accumulation.
 */
function parseSetCookieHeaders(setCookieHeader: string | undefined, url: string): StoredCookie[] {
  if (!setCookieHeader) return [];

  const parsed = new URL(url);
  const cookies: StoredCookie[] = [];

  // Set-Cookie headers are joined by comma, but cookie values can contain commas in expires
  // Split carefully: split on commas NOT followed by a space and day-of-week pattern
  const rawCookies = setCookieHeader.split(/,(?=\s*[a-zA-Z_][a-zA-Z0-9_]*=)/);

  for (const raw of rawCookies) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const parts = trimmed.split(";").map((p) => p.trim());
    const nameValue = parts[0];
    const eqIdx = nameValue.indexOf("=");
    if (eqIdx <= 0) continue;

    const name = nameValue.substring(0, eqIdx).trim();
    const value = nameValue.substring(eqIdx + 1).trim();

    const cookie: StoredCookie = {
      name,
      value,
      domain: parsed.hostname,
      path: "/",
    };

    // Parse cookie attributes
    for (let i = 1; i < parts.length; i++) {
      const attr = parts[i].toLowerCase();
      if (attr.startsWith("domain=")) {
        cookie.domain = parts[i].substring(7).trim();
      } else if (attr.startsWith("path=")) {
        cookie.path = parts[i].substring(5).trim();
      } else if (attr.startsWith("expires=")) {
        const expiresStr = parts[i].substring(8).trim();
        const ts = Date.parse(expiresStr);
        if (!isNaN(ts)) cookie.expires = ts / 1000;
      } else if (attr.startsWith("max-age=")) {
        const maxAge = parseInt(parts[i].substring(8).trim(), 10);
        if (!isNaN(maxAge)) cookie.expires = Date.now() / 1000 + maxAge;
      } else if (attr === "httponly") {
        cookie.httpOnly = true;
      } else if (attr === "secure") {
        cookie.secure = true;
      } else if (attr.startsWith("samesite=")) {
        const ss = parts[i].substring(9).trim();
        if (ss === "Strict" || ss === "Lax" || ss === "None") cookie.sameSite = ss;
      }
    }

    cookies.push(cookie);
  }

  return cookies;
}

/**
 * Merge new cookies into accumulated map (last write wins per name+domain).
 */
function mergeAccumulatedCookies(
  accumulated: Map<string, StoredCookie>,
  newCookies: StoredCookie[],
): void {
  for (const cookie of newCookies) {
    const key = `${cookie.domain}:${cookie.name}`;
    accumulated.set(key, cookie);
  }
}

/**
 * Build a Cookie header string from accumulated cookies for a given URL.
 */
function buildAccumulatedCookieHeader(accumulated: Map<string, StoredCookie>, url: string): string | undefined {
  if (accumulated.size === 0) return undefined;
  const cookies = Array.from(accumulated.values());
  const header = buildCookieHeader(cookies, url);
  return header || undefined;
}

export type StealthLevel = 1 | 2 | 3;

export interface FetchResult {
  html: string;
  status: number;
  url: string;
  level: StealthLevel;
  screenshot?: string;
  headers?: Record<string, string>;
  captchaSolved?: boolean;
  proxyUsed?: string;
  chromeProfile?: string;
  antiBotSystem?: string;
  /** Indicates the result may be incomplete due to partial failure */
  degraded?: boolean;
}

export class StealthError extends Error {
  /** Best partial result collected during escalation, if any */
  public partialResult?: FetchResult;

  constructor(
    message: string,
    public readonly lastLevel: StealthLevel,
    public readonly httpStatus: number,
    public readonly antiBotSystem: string | null,
  ) {
    super(message);
    this.name = "StealthError";
  }
}

export interface StealthOptions {
  timeout?: number;
  maxLevel?: StealthLevel;
  forceLevel?: StealthLevel;
  screenshot?: boolean;
  proxy?: string; // per-request proxy URL override
  chromeProfile?: string; // Chrome user data dir for authenticated sessions
  sessionId?: string; // session ID to inject cookies from (L1/L2 HTTP requests)
}

// ── Rendering Decision Cache ──
// Caches which stealth level succeeded for each domain (TTL: 1 hour)
const CACHE_TTL_MS = 3_600_000;

interface CacheEntry {
  level: StealthLevel;
  timestamp: number;
}

const renderingCache = new Map<string, CacheEntry>();
const MAX_RENDERING_CACHE_SIZE = 5000;

// Periodic cleanup: sweep expired entries every 60s, hard-cap on size
setInterval(() => {
  const now = Date.now();
  for (const [domain, entry] of renderingCache) {
    if (now - entry.timestamp > CACHE_TTL_MS) {
      renderingCache.delete(domain);
    }
  }
  if (renderingCache.size > MAX_RENDERING_CACHE_SIZE) {
    renderingCache.clear();
  }
}, 60_000).unref();

function getCachedLevel(url: string): StealthLevel | null {
  const domain = getDomain(url);
  const entry = renderingCache.get(domain);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    renderingCache.delete(domain);
    return null;
  }
  return entry.level;
}

function cacheLevel(url: string, level: StealthLevel): void {
  renderingCache.set(getDomain(url), { level, timestamp: Date.now() });
}

// ── Level Fetchers ──

async function level1Fetch(
  url: string,
  timeout: number,
  proxyUrl?: string,
  sessionId?: string,
  accumulatedCookieHeader?: string,
): Promise<FetchResult> {
  const headers = generateHeaders(undefined, url);

  // Inject session cookies if available
  const sessionCookieHeader = await getSessionCookieHeader(sessionId, url);
  // Merge: session cookies + accumulated cookies (accumulated take precedence)
  const cookieParts = [sessionCookieHeader, accumulatedCookieHeader].filter(Boolean);
  if (cookieParts.length > 0) {
    (headers as Record<string, string>)["Cookie"] = cookieParts.join("; ");
  }

  const fetchOptions: RequestInit & { dispatcher?: unknown } = {
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(timeout),
  };

  // Use undici ProxyAgent for Level 1 proxy support
  if (proxyUrl) {
    const { ProxyAgent } = await import("undici");
    (fetchOptions as Record<string, unknown>).dispatcher = new ProxyAgent(proxyUrl);
  }

  const res = await fetch(url, fetchOptions as RequestInit);
  const html = await res.text();
  const responseHeaders = Object.fromEntries(res.headers.entries());
  return { html, status: res.status, url: res.url, level: 1, headers: responseHeaders, proxyUsed: proxyUrl };
}

async function level2Fetch(
  url: string,
  timeout: number,
  proxyUrl?: string,
  sessionId?: string,
  accumulatedCookieHeader?: string,
): Promise<FetchResult> {
  // Inject session cookies as custom headers for Impit
  const sessionCookieHeader = await getSessionCookieHeader(sessionId, url);
  const cookieParts = [sessionCookieHeader, accumulatedCookieHeader].filter(Boolean);
  const extraHeaders = cookieParts.length > 0 ? { Cookie: cookieParts.join("; ") } : undefined;

  const result = await stealthFetch({ url, timeout, proxyUrl, headers: extraHeaders });
  return { ...result, level: 2, proxyUsed: proxyUrl };
}

async function level3Fetch(
  url: string,
  timeout: number,
  screenshot?: boolean,
  proxyUrl?: string,
  chromeProfile?: string,
  accumulatedCookies?: StoredCookie[],
): Promise<FetchResult> {
  const result = await browserFetch(url, {
    timeout,
    screenshot,
    proxyUrl,
    chromeProfile,
    cookies: accumulatedCookies,
  });
  return { ...result, level: 3, proxyUsed: proxyUrl, chromeProfile: result.chromeProfile };
}

// ── Smart Fetch with Cache + Anti-bot Detection + Cookie Preservation ──

function checkResult(result: FetchResult, hasCaptchaKey: boolean): boolean {
  const responseHeaders = result.headers || {};
  const blocked = isBlocked(result.html, result.status, responseHeaders);

  // If page has CAPTCHA and we have a key to solve it, don't treat as blocked
  // (L3 browserFetch will handle CAPTCHA solving)
  if (blocked && hasCaptchaKey && isCaptchaPage(result.html)) {
    return false; // Not "ok" yet, but not a hard block — let escalation handle it
  }

  return !blocked && !needsJSRendering(result.html);
}

/**
 * Check if a result is blocked specifically by CAPTCHA only (solvable).
 */
function isBlockedByCaptchaOnly(result: FetchResult): boolean {
  const responseHeaders = result.headers || {};
  if (!isCaptchaPage(result.html)) return false;
  // If it's a CAPTCHA page, check if removing CAPTCHA indicators would make it "not blocked"
  return isBlocked(result.html, result.status, responseHeaders);
}

export async function smartFetch(url: string, options?: StealthOptions): Promise<FetchResult> {
  const timeout = options?.timeout || DEFAULT_TIMEOUT_MS;
  const maxLevel = options?.maxLevel || 3;
  const proxyUrl = resolveProxy(options?.proxy);
  const chromeProfile = options?.chromeProfile;
  const sessionId = options?.sessionId;
  const domain = getDomain(url);
  const engine = getKnowledgeEngine();
  const fetchStart = Date.now();
  const hasCaptchaKey = !!getTwoCaptchaApiKey();

  // ── Cookie accumulation across escalation levels ──
  const accumulatedCookies = new Map<string, StoredCookie>();

  /** Extract and accumulate cookies from a fetch result */
  function accumulateCookies(result: FetchResult): void {
    const setCookie = result.headers?.["set-cookie"];
    if (setCookie) {
      const parsed = parseSetCookieHeaders(setCookie, result.url);
      mergeAccumulatedCookies(accumulatedCookies, parsed);
    }
  }

  /** Get accumulated cookies as header string */
  function getAccumulatedCookieHeader(): string | undefined {
    return buildAccumulatedCookieHeader(accumulatedCookies, url);
  }

  /** Get accumulated cookies as StoredCookie array (for browser injection) */
  function getAccumulatedCookiesArray(): StoredCookie[] | undefined {
    if (accumulatedCookies.size === 0) return undefined;
    return Array.from(accumulatedCookies.values());
  }

  // ── Tracking state across escalation ──
  let detectedAntiBot: string | null = null;
  let lastHttpStatus = 0;
  let lastLevel: StealthLevel = 1;
  let bestPartialResult: FetchResult | null = null;

  /** Track the best partial result (most content) for error recovery */
  function trackBestResult(result: FetchResult): void {
    if (!bestPartialResult || result.html.length > bestPartialResult.html.length) {
      bestPartialResult = result;
    }
  }

  /** Get the best partial result (avoids TS narrowing issues with closured variable) */
  function getBestPartial(): FetchResult | null {
    return bestPartialResult;
  }

  /** Record success outcome and return enriched result */
  function recordSuccess(result: FetchResult): FetchResult {
    result.antiBotSystem = detectedAntiBot ?? undefined;
    engine.record({
      url, domain,
      levelUsed: result.level,
      success: true,
      responseTimeMs: Date.now() - fetchStart,
      antiBotSystem: detectedAntiBot,
      captchaType: result.captchaSolved ? "detected" : null,
      proxyUsed: !!result.proxyUsed,
      blocked: false,
      httpStatus: result.status,
    });
    return result;
  }

  // Chrome profile → force Level 3 (no point using profile without browser)
  if (chromeProfile) {
    const result = await level3Fetch(url, timeout, options?.screenshot, proxyUrl, chromeProfile);
    cacheLevel(url, 3);
    return recordSuccess(result);
  }

  // Forced level — skip all heuristics
  if (options?.forceLevel) {
    const result = await fetchByLevel(url, timeout, options.forceLevel, options.screenshot, proxyUrl, sessionId);
    cacheLevel(url, options.forceLevel);
    return recordSuccess(result);
  }

  // Check rendering cache — skip escalation if we know what works
  const cachedLevel = getCachedLevel(url);
  if (cachedLevel && cachedLevel <= maxLevel) {
    try {
      const result = await fetchByLevel(url, timeout, cachedLevel, options?.screenshot, proxyUrl, sessionId);
      if (checkResult(result, hasCaptchaKey)) {
        return recordSuccess(result);
      }
      // Cache was wrong — invalidate and fall through to full escalation
      accumulateCookies(result);
      trackBestResult(result);
      lastHttpStatus = result.status;
      lastLevel = cachedLevel;
      renderingCache.delete(getDomain(url));
    } catch {
      renderingCache.delete(getDomain(url));
    }
  }

  // Consult adaptive learning for starting level hint (soft suggestion)
  const prediction = await engine.predict(url);
  if (prediction && prediction.confidence >= 0.7 && prediction.startLevel > 1) {
    const startLevel = Math.min(prediction.startLevel, maxLevel) as StealthLevel;
    try {
      const result = await fetchByLevel(url, timeout, startLevel, options?.screenshot, proxyUrl, sessionId);
      if (checkResult(result, hasCaptchaKey)) {
        cacheLevel(url, startLevel);
        return recordSuccess(result);
      }
      accumulateCookies(result);
      trackBestResult(result);
      lastHttpStatus = result.status;
      lastLevel = startLevel;
      // Predicted level failed — fall through to normal escalation
    } catch {
      // Fall through to normal escalation
    }
  }

  // Level 1: native fetch + realistic headers
  if (maxLevel >= 1) {
    try {
      const result = await level1Fetch(url, timeout, proxyUrl, sessionId, getAccumulatedCookieHeader());
      accumulateCookies(result);
      trackBestResult(result);

      if (checkResult(result, hasCaptchaKey)) {
        cacheLevel(url, 1);
        return recordSuccess(result);
      }
      lastHttpStatus = result.status;
      lastLevel = 1;

      // Check anti-bot system for smarter escalation
      const responseHeaders = result.headers || {};
      const cookies = parseCookieNames(
        responseHeaders["set-cookie"]?.split(",").map((c) => c.trim()) || [],
      );
      const detection = detectAntiBot(responseHeaders, cookies, result.html);

      if (detection.system !== "none") {
        detectedAntiBot = detection.system;
      }

      // If blocked by CAPTCHA only and we have a key, skip to L3 directly
      if (hasCaptchaKey && isBlockedByCaptchaOnly(result) && maxLevel >= 3) {
        if (await isPlaywrightAvailable()) {
          const l3Result = await level3Fetch(
            url, timeout, options?.screenshot, proxyUrl, undefined, getAccumulatedCookiesArray(),
          );
          accumulateCookies(l3Result);

          // If L3 solved CAPTCHA, re-check the result
          if (l3Result.captchaSolved || checkResult(l3Result, false)) {
            cacheLevel(url, 3);
            return recordSuccess(l3Result);
          }
          trackBestResult(l3Result);
        }
      }

      // If anti-bot detected and recommends Level 3, skip Level 2
      if (detection.system !== "none" && detection.recommendedLevel === 3 && maxLevel >= 3) {
        if (await isPlaywrightAvailable()) {
          const l3Result = await level3Fetch(
            url, timeout, options?.screenshot, proxyUrl, undefined, getAccumulatedCookiesArray(),
          );
          accumulateCookies(l3Result);
          cacheLevel(url, 3);
          return recordSuccess(l3Result);
        }
      }
    } catch {
      // Escalate
    }
  }

  // Level 2: impit TLS stealth
  if (maxLevel >= 2) {
    try {
      const result = await level2Fetch(url, timeout, proxyUrl, sessionId, getAccumulatedCookieHeader());
      accumulateCookies(result);
      trackBestResult(result);

      if (checkResult(result, hasCaptchaKey)) {
        cacheLevel(url, 2);
        return recordSuccess(result);
      }
      lastHttpStatus = result.status;
      lastLevel = 2;
    } catch {
      // Escalate
    }
  }

  // Level 3: headless browser
  if (maxLevel >= 3 && (await isPlaywrightAvailable())) {
    const result = await level3Fetch(
      url, timeout, options?.screenshot, proxyUrl, undefined, getAccumulatedCookiesArray(),
    );
    accumulateCookies(result);
    trackBestResult(result);

    // If CAPTCHA was solved or result is OK, return success
    if (result.captchaSolved || checkResult(result, false)) {
      cacheLevel(url, 3);
      return recordSuccess(result);
    }

    // L3 got content but failed checks — still return if it's the best we have
    cacheLevel(url, 3);
    return recordSuccess(result);
  }

  // Fallback: return best effort from level 2, then level 1
  try {
    const result = await level2Fetch(url, timeout, proxyUrl, sessionId, getAccumulatedCookieHeader());
    lastLevel = 2;
    return recordSuccess(result);
  } catch {
    try {
      const result = await level1Fetch(url, timeout, proxyUrl, sessionId, getAccumulatedCookieHeader());
      lastLevel = 1;
      return recordSuccess(result);
    } catch (finalErr) {
      // Record failure before throwing
      engine.record({
        url, domain,
        levelUsed: lastLevel,
        success: false,
        responseTimeMs: Date.now() - fetchStart,
        antiBotSystem: detectedAntiBot,
        captchaType: null,
        proxyUsed: !!proxyUrl,
        blocked: true,
        httpStatus: lastHttpStatus,
      });

      // If we have a partial result, return it as degraded instead of throwing
      const partial = getBestPartial();
      if (partial && partial.html.length > 100) {
        partial.degraded = true;
        partial.antiBotSystem = detectedAntiBot ?? undefined;
        return partial;
      }

      const error = new StealthError(
        `All stealth levels failed for ${url}: ${finalErr instanceof Error ? finalErr.message : String(finalErr)}`,
        lastLevel,
        lastHttpStatus,
        detectedAntiBot,
      );
      error.partialResult = partial ?? undefined;
      throw error;
    }
  }
}

async function fetchByLevel(
  url: string,
  timeout: number,
  level: StealthLevel,
  screenshot?: boolean,
  proxyUrl?: string,
  sessionId?: string,
): Promise<FetchResult> {
  switch (level) {
    case 1:
      return level1Fetch(url, timeout, proxyUrl, sessionId);
    case 2:
      return level2Fetch(url, timeout, proxyUrl, sessionId);
    case 3:
      return level3Fetch(url, timeout, screenshot, proxyUrl);
  }
}

export { isPlaywrightAvailable } from "./browser.js";
