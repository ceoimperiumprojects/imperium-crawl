import { getTwoCaptchaApiKey } from "../config.js";
import { HUMAN_DELAY_MIN_MS, HUMAN_DELAY_MAX_MS } from "../constants.js";
import { trySolveCaptcha, hasCaptcha } from "../captcha/index.js";
import { acquirePage } from "./chrome-profile.js";

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
    const { page } = handle;

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
