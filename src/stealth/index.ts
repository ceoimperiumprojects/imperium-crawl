import { generateHeaders } from "./headers.js";
import { isBlocked, needsJSRendering } from "./detector.js";
import { detectAntiBot, parseCookieNames } from "./antibot-detector.js";
import { stealthFetch } from "./tls.js";
import { browserFetch, isPlaywrightAvailable } from "./browser.js";
import { resolveProxy } from "./proxy.js";
import { DEFAULT_TIMEOUT_MS } from "../constants.js";
import { getKnowledgeEngine } from "../knowledge/index.js";

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
}

export interface StealthOptions {
  timeout?: number;
  maxLevel?: StealthLevel;
  forceLevel?: StealthLevel;
  screenshot?: boolean;
  proxy?: string; // per-request proxy URL override
  chromeProfile?: string; // Chrome user data dir for authenticated sessions
}

// ── Rendering Decision Cache ──
// Caches which stealth level succeeded for each domain (TTL: 1 hour)
const CACHE_TTL_MS = 3_600_000;

interface CacheEntry {
  level: StealthLevel;
  timestamp: number;
}

const renderingCache = new Map<string, CacheEntry>();

// Periodic cleanup: sweep expired entries every 60s
setInterval(() => {
  const now = Date.now();
  for (const [domain, entry] of renderingCache) {
    if (now - entry.timestamp > CACHE_TTL_MS) {
      renderingCache.delete(domain);
    }
  }
}, 60_000).unref();

function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

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

async function level1Fetch(url: string, timeout: number, proxyUrl?: string): Promise<FetchResult> {
  const headers = generateHeaders();
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

async function level2Fetch(url: string, timeout: number, proxyUrl?: string): Promise<FetchResult> {
  const result = await stealthFetch({ url, timeout, proxyUrl });
  return { ...result, level: 2, proxyUsed: proxyUrl };
}

async function level3Fetch(
  url: string,
  timeout: number,
  screenshot?: boolean,
  proxyUrl?: string,
  chromeProfile?: string,
): Promise<FetchResult> {
  const result = await browserFetch(url, { timeout, screenshot, proxyUrl, chromeProfile });
  return { ...result, level: 3, proxyUsed: proxyUrl, chromeProfile: result.chromeProfile };
}

// ── Smart Fetch with Cache + Anti-bot Detection ──

function checkResult(result: FetchResult): boolean {
  const responseHeaders = result.headers || {};
  return !isBlocked(result.html, result.status, responseHeaders) && !needsJSRendering(result.html);
}

export async function smartFetch(url: string, options?: StealthOptions): Promise<FetchResult> {
  const timeout = options?.timeout || DEFAULT_TIMEOUT_MS;
  const maxLevel = options?.maxLevel || 3;
  const proxyUrl = resolveProxy(options?.proxy);
  const chromeProfile = options?.chromeProfile;

  // Chrome profile → force Level 3 (no point using profile without browser)
  if (chromeProfile) {
    const result = await level3Fetch(url, timeout, options?.screenshot, proxyUrl, chromeProfile);
    cacheLevel(url, 3);
    return result;
  }

  // Forced level — skip all heuristics
  if (options?.forceLevel) {
    const result = await fetchByLevel(url, timeout, options.forceLevel, options.screenshot, proxyUrl);
    cacheLevel(url, options.forceLevel);
    return result;
  }

  // Check rendering cache — skip escalation if we know what works
  const cachedLevel = getCachedLevel(url);
  if (cachedLevel && cachedLevel <= maxLevel) {
    try {
      const result = await fetchByLevel(url, timeout, cachedLevel, options?.screenshot, proxyUrl);
      if (checkResult(result)) return result;
      // Cache was wrong — invalidate and fall through to full escalation
      renderingCache.delete(getDomain(url));
    } catch {
      renderingCache.delete(getDomain(url));
    }
  }

  // Consult adaptive learning for starting level hint (soft suggestion)
  const engine = getKnowledgeEngine();
  const prediction = await engine.predict(url);
  if (prediction && prediction.confidence >= 0.7 && prediction.startLevel > 1) {
    const startLevel = Math.min(prediction.startLevel, maxLevel) as StealthLevel;
    try {
      const result = await fetchByLevel(url, timeout, startLevel, options?.screenshot, proxyUrl);
      if (checkResult(result)) {
        cacheLevel(url, startLevel);
        return result;
      }
      // Predicted level failed — fall through to normal escalation
    } catch {
      // Fall through to normal escalation
    }
  }

  // Level 1: native fetch + realistic headers
  if (maxLevel >= 1) {
    try {
      const result = await level1Fetch(url, timeout, proxyUrl);
      if (checkResult(result)) {
        cacheLevel(url, 1);
        return result;
      }
      // Check anti-bot system for smarter escalation
      const responseHeaders = result.headers || {};
      const cookies = parseCookieNames(
        responseHeaders["set-cookie"]?.split(",").map((c) => c.trim()) || [],
      );
      const detection = detectAntiBot(responseHeaders, cookies, result.html);

      // If anti-bot detected and recommends Level 3, skip Level 2
      if (detection.system !== "none" && detection.recommendedLevel === 3 && maxLevel >= 3) {
        if (await isPlaywrightAvailable()) {
          const l3Result = await level3Fetch(url, timeout, options?.screenshot, proxyUrl);
          cacheLevel(url, 3);
          return l3Result;
        }
      }
    } catch {
      // Escalate
    }
  }

  // Level 2: impit TLS stealth
  if (maxLevel >= 2) {
    try {
      const result = await level2Fetch(url, timeout, proxyUrl);
      if (checkResult(result)) {
        cacheLevel(url, 2);
        return result;
      }
    } catch {
      // Escalate
    }
  }

  // Level 3: headless browser
  if (maxLevel >= 3 && (await isPlaywrightAvailable())) {
    const result = await level3Fetch(url, timeout, options?.screenshot, proxyUrl);
    cacheLevel(url, 3);
    return result;
  }

  // Fallback: return best effort from level 2, then level 1
  try {
    return await level2Fetch(url, timeout, proxyUrl);
  } catch {
    try {
      return await level1Fetch(url, timeout, proxyUrl);
    } catch (finalErr) {
      throw new Error(`All stealth levels failed for ${url}: ${finalErr instanceof Error ? finalErr.message : String(finalErr)}`);
    }
  }
}

async function fetchByLevel(
  url: string,
  timeout: number,
  level: StealthLevel,
  screenshot?: boolean,
  proxyUrl?: string,
): Promise<FetchResult> {
  switch (level) {
    case 1:
      return level1Fetch(url, timeout, proxyUrl);
    case 2:
      return level2Fetch(url, timeout, proxyUrl);
    case 3:
      return level3Fetch(url, timeout, screenshot, proxyUrl);
  }
}

export { isPlaywrightAvailable } from "./browser.js";
