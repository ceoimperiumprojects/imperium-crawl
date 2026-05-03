import { getTwoCaptchaApiKey } from "../core/config.js";
import { HUMAN_DELAY_MIN_MS, HUMAN_DELAY_MAX_MS } from "../core/constants.js";
import { trySolveCaptcha, hasCaptcha } from "../captcha/index.js";
import { acquirePage } from "./chrome-profile.js";
import type { StoredCookie } from "../sessions/types.js";

// ── Known tracking/ad domains to block for faster page loads ──
const BLOCKED_DOMAINS = [
  "google-analytics.com", "googletagmanager.com", "googlesyndication.com",
  "doubleclick.net", "google-analytics.com", "googleadservices.com",
  "facebook.com", "facebook.net", "fbcdn.net",
  "twitter.com", "t.co",
  "linkedin.com",
  "analytics.tiktok.com",
  "snap.licdn.com",
  "bat.bing.com", "clarity.ms",
  "hotjar.com", "mouseflow.com", "fullstory.com",
  "segment.io", "segment.com",
  "mixpanel.com", "amplitude.com", "heap.io",
  "sentry.io", "bugsnag.com",
  "newrelic.com", "nr-data.net",
  "optimizely.com",
  "criteo.com", "criteo.net",
  "outbrain.com", "taboola.com",
  "adnxs.com", "rubiconproject.com",
  "moatads.com", "quantserve.com",
];

// Resource types to block for scraping (not screenshots)
const BLOCKED_RESOURCE_TYPES = new Set(["image", "font", "stylesheet", "media"]);

export interface BrowserFetchResult {
  html: string;
  status: number;
  url: string;
  chromeProfile?: string;
}

export interface BrowserFetchOptions {
  timeout?: number;
  screenshot?: boolean;
  solveCaptcha?: boolean; // Explicitly enable/disable (default: auto based on API key)
  proxyUrl?: string;
  chromeProfile?: string;
  /** Cookies to inject into browser context before navigation */
  cookies?: StoredCookie[];
  /** Block images/fonts/css/tracking for faster loads (default: true for scrape, false for screenshot) */
  blockResources?: boolean;
}

let playwrightAvailable: boolean | null = null;

async function checkPlaywright(): Promise<boolean> {
  if (playwrightAvailable !== null) return playwrightAvailable;
  try {
    await import("rebrowser-playwright");
    playwrightAvailable = true;
  } catch {
    playwrightAvailable = false;
  }
  return playwrightAvailable;
}

export async function isPlaywrightAvailable(): Promise<boolean> {
  return checkPlaywright();
}

/**
 * Convert StoredCookie[] to Playwright's cookie format for injection.
 */
function toPlaywrightCookies(cookies: StoredCookie[], url: string): Array<{
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}> {
  const parsed = new URL(url);
  return cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain || parsed.hostname,
    path: c.path || "/",
    expires: c.expires,
    httpOnly: c.httpOnly,
    secure: c.secure ?? parsed.protocol === "https:",
    sameSite: c.sameSite,
  }));
}

export async function browserFetch(
  url: string,
  options?: BrowserFetchOptions,
): Promise<BrowserFetchResult & { screenshot?: string; captchaSolved?: boolean }> {
  const available = await checkPlaywright();
  if (!available) {
    throw new Error("rebrowser-playwright is not installed. Install it with: npm i rebrowser-playwright");
  }

  const handle = await acquirePage({
    chromeProfile: options?.chromeProfile,
    proxyUrl: options?.proxyUrl,
  });

  try {
    const { page, context } = handle;

    // ── Inject accumulated cookies before navigation ──
    if (options?.cookies && options.cookies.length > 0) {
      const pwCookies = toPlaywrightCookies(options.cookies, url);
      await context.addCookies(pwCookies);
    }

    // ── Resource blocking for faster scraping ──
    const shouldBlockResources = options?.blockResources ?? !options?.screenshot;
    if (shouldBlockResources) {
      await page.route("**/*", (route: { request: () => { resourceType: () => string; url: () => string }; abort: () => Promise<void>; continue: () => Promise<void> }) => {
        const resourceType = route.request().resourceType();
        const requestUrl = route.request().url();

        // Block heavy resource types
        if (BLOCKED_RESOURCE_TYPES.has(resourceType)) {
          return route.abort();
        }

        // Block known tracking domains
        try {
          const reqHost = new URL(requestUrl).hostname;
          if (BLOCKED_DOMAINS.some((d) => reqHost.endsWith(d))) {
            return route.abort();
          }
        } catch {
          // Invalid URL, let it through
        }

        return route.continue();
      });
    }

    // Use "load" instead of "networkidle" — streaming sites (BBC, Binance, etc.)
    // never reach networkidle. After load, we briefly wait for networkidle as a bonus
    // but don't fail if it doesn't happen.
    const response = await page.goto(url, {
      waitUntil: "load",
      timeout: options?.timeout || 30_000,
    });

    // Best-effort: wait up to 5s for network to quiet down (helps SPAs finish API calls)
    await Promise.race([
      page.waitForLoadState("networkidle").catch(() => {}),
      new Promise((r) => setTimeout(r, 5000)),
    ]);

    // ── SPA content-readiness check ──
    // Poll for meaningful content (>200 chars text in body) up to 10s for SPAs
    try {
      await page.waitForFunction(
        () => {
          const body = document.body;
          if (!body) return false;
          const text = body.innerText || "";
          return text.length > 200;
        },
        { timeout: 10_000 },
      ).catch(() => {});
    } catch {
      // Content readiness check timed out — proceed with what we have
    }

    // ── Human-like delay — anti-bot systems flag instant page reads ──
    const humanDelay = HUMAN_DELAY_MIN_MS + Math.random() * (HUMAN_DELAY_MAX_MS - HUMAN_DELAY_MIN_MS);
    await new Promise((r) => setTimeout(r, humanDelay));

    let captchaSolved = false;

    // ── Auto CAPTCHA Solving ──
    // Only attempt if: API key exists AND solving not explicitly disabled
    const captchaApiKey = getTwoCaptchaApiKey();
    const shouldSolveCaptcha = options?.solveCaptcha !== false && !!captchaApiKey;

    if (shouldSolveCaptcha && captchaApiKey) {
      const html = await page.content();
      if (hasCaptcha(html)) {
        const attempt = await trySolveCaptcha(page, captchaApiKey);
        captchaSolved = attempt.solved;
      }
    }

    const html = await page.content();
    let screenshotBase64: string | undefined;
    if (options?.screenshot) {
      const buf = await page.screenshot({ fullPage: true });
      screenshotBase64 = buf.toString("base64");
    }

    return {
      html,
      status: response?.status() || 200,
      url: page.url(),
      screenshot: screenshotBase64,
      captchaSolved,
      chromeProfile: handle.profilePath,
    };
  } finally {
    await handle.cleanup();
  }
}
