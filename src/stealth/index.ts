import { generateHeaders } from "./headers.js";
import { isBlocked, needsJSRendering } from "./detector.js";
import { detectAntiBot, parseCookieNames } from "./antibot-detector.js";
import { stealthFetch } from "./tls.js";
import { browserFetch, isPlaywrightAvailable } from "./browser.js";
import { DEFAULT_TIMEOUT_MS } from "../constants.js";

export type StealthLevel = 1 | 2 | 3;

export interface FetchResult {
  html: string;
  status: number;
  url: string;
  level: StealthLevel;
  screenshot?: string;
  headers?: Record<string, string>;
  captchaSolved?: boolean;
}

export interface StealthOptions {
  timeout?: number;
  maxLevel?: StealthLevel;
  forceLevel?: StealthLevel;
  screenshot?: boolean;
}

// ── Rendering Decision Cache ──
// Caches which stealth level succeeded for each domain (TTL: 1 hour)
const CACHE_TTL_MS = 3_600_000;

interface CacheEntry {
  level: StealthLevel;
  timestamp: number;
}

const renderingCache = new Map<string, CacheEntry>();

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

async function level1Fetch(url: string, timeout: number): Promise<FetchResult> {
  const headers = generateHeaders();
  const res = await fetch(url, {
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(timeout),
  });
  const html = await res.text();
  const responseHeaders = Object.fromEntries(res.headers.entries());
  return { html, status: res.status, url: res.url, level: 1, headers: responseHeaders };
}

async function level2Fetch(url: string, timeout: number): Promise<FetchResult> {
  const result = await stealthFetch({ url, timeout });
  return { ...result, level: 2 };
}

async function level3Fetch(
  url: string,
  timeout: number,
  screenshot?: boolean,
): Promise<FetchResult> {
  const result = await browserFetch(url, { timeout, screenshot });
  return { ...result, level: 3 };
}

// ── Smart Fetch with Cache + Anti-bot Detection ──

function checkResult(result: FetchResult): boolean {
  const responseHeaders = result.headers || {};
  return !isBlocked(result.html, result.status, responseHeaders) && !needsJSRendering(result.html);
}

export async function smartFetch(url: string, options?: StealthOptions): Promise<FetchResult> {
  const timeout = options?.timeout || DEFAULT_TIMEOUT_MS;
  const maxLevel = options?.maxLevel || 3;

  // Forced level — skip all heuristics
  if (options?.forceLevel) {
    const result = await fetchByLevel(url, timeout, options.forceLevel, options.screenshot);
    cacheLevel(url, options.forceLevel);
    return result;
  }

  // Check rendering cache — skip escalation if we know what works
  const cachedLevel = getCachedLevel(url);
  if (cachedLevel && cachedLevel <= maxLevel) {
    try {
      const result = await fetchByLevel(url, timeout, cachedLevel, options?.screenshot);
      if (checkResult(result)) return result;
      // Cache was wrong — invalidate and fall through to full escalation
      renderingCache.delete(getDomain(url));
    } catch {
      renderingCache.delete(getDomain(url));
    }
  }

  // Level 1: native fetch + realistic headers
  if (maxLevel >= 1) {
    try {
      const result = await level1Fetch(url, timeout);
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
          const l3Result = await level3Fetch(url, timeout, options?.screenshot);
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
      const result = await level2Fetch(url, timeout);
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
    const result = await level3Fetch(url, timeout, options?.screenshot);
    cacheLevel(url, 3);
    return result;
  }

  // Fallback: return best effort from level 2
  try {
    return await level2Fetch(url, timeout);
  } catch {
    return level1Fetch(url, timeout);
  }
}

async function fetchByLevel(
  url: string,
  timeout: number,
  level: StealthLevel,
  screenshot?: boolean,
): Promise<FetchResult> {
  switch (level) {
    case 1:
      return level1Fetch(url, timeout);
    case 2:
      return level2Fetch(url, timeout);
    case 3:
      return level3Fetch(url, timeout, screenshot);
  }
}

export { isPlaywrightAvailable } from "./browser.js";
