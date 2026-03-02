/**
 * Chrome Profile integration — acquirePage() abstraction.
 *
 * Two paths:
 * 1. Profile mode: launchPersistentContext with user's Chrome profile (cookies, sessions)
 * 2. Pool mode: browser pool + fingerprint-injector (existing behavior)
 *
 * Profile path is locked per userDataDir via in-memory mutex to prevent
 * concurrent access (Chrome/Playwright locks the profile directory).
 */

import { getChromeProfilePath } from "../config.js";
import { STEALTH_ARGS, DEFAULT_VIEWPORT } from "../constants.js";
import { getPool } from "./browser-pool.js";

type Page = import("rebrowser-playwright").Page;
type BrowserContext = import("rebrowser-playwright").BrowserContext;
type Browser = import("rebrowser-playwright").Browser;

export interface PageHandle {
  page: Page;
  context: BrowserContext;
  cleanup: () => Promise<void>;
  isProfile: boolean;
  profilePath?: string;
}

export interface AcquirePageOptions {
  chromeProfile?: string;
  proxyUrl?: string;
}

/**
 * Resolve which Chrome profile to use.
 * Priority: per-request override > CHROME_PROFILE_PATH env > undefined.
 */
export function resolveChromeProfile(override?: string): string | undefined {
  if (override) return override;
  return getChromeProfilePath();
}

// ── Profile Mutex ──
// launchPersistentContext locks userDataDir — serialize access per path.

const profileLocks = new Map<string, Promise<void>>();

async function withProfileLock<T>(profilePath: string, fn: () => Promise<T>): Promise<T> {
  // Wait for any existing operation on this profile to finish
  const existing = profileLocks.get(profilePath);
  const operation = (existing ?? Promise.resolve()).then(fn);

  // Store a void version that never rejects (so next waiter doesn't fail)
  profileLocks.set(profilePath, operation.then(() => {}, () => {}));

  try {
    return await operation;
  } finally {
    // Clean up if we're the last one
    const current = profileLocks.get(profilePath);
    if (current) {
      current.then(() => {
        // Only delete if no new operation was queued
        if (profileLocks.get(profilePath) === current) {
          profileLocks.delete(profilePath);
        }
      }, () => {});
    }
  }
}

// ── Profile Page Acquisition ──

async function acquireProfilePage(profilePath: string, proxyUrl?: string): Promise<PageHandle> {
  const { chromium } = await import("rebrowser-playwright");

  const { timeZone, locale } = Intl.DateTimeFormat().resolvedOptions();

  const launchOptions: Record<string, unknown> = {
    headless: true,
    args: STEALTH_ARGS,
    timezoneId: timeZone,
    locale,
  };

  if (proxyUrl) {
    launchOptions.proxy = { server: proxyUrl };
  }

  let context: BrowserContext;
  try {
    // Prefer installed Chrome — profile format matches user's browser
    context = await chromium.launchPersistentContext(profilePath, {
      ...launchOptions,
      channel: "chrome",
    } as Parameters<typeof chromium.launchPersistentContext>[1]);
  } catch {
    // Fallback to Playwright's bundled Chromium
    context = await chromium.launchPersistentContext(
      profilePath,
      launchOptions as Parameters<typeof chromium.launchPersistentContext>[1],
    );
  }

  const page = context.pages()[0] || await context.newPage();

  return {
    page,
    context,
    isProfile: true,
    profilePath,
    cleanup: async () => {
      await context.close();
    },
  };
}

// ── Pool Page Acquisition (existing behavior) ──

async function acquirePoolPage(proxyUrl?: string): Promise<PageHandle> {
  const pool = getPool();
  const browser = await pool.acquire(proxyUrl);
  let page: Page;
  let fpContext: BrowserContext | undefined;

  const { timeZone, locale } = Intl.DateTimeFormat().resolvedOptions();

  try {
    const { newInjectedContext } = await import("fingerprint-injector");
    fpContext = await newInjectedContext(browser, {
      newContextOptions: {
        timezoneId: timeZone,
        locale,
      },
    });
    page = await fpContext.newPage();
  } catch {
    // Fallback without fingerprint injection — reduced stealth
    console.warn("[imperium-crawl] fingerprint-injector not available — running with reduced stealth");
    fpContext = await browser.newContext({
      viewport: DEFAULT_VIEWPORT,
      timezoneId: timeZone,
      locale,
    });
    page = await fpContext.newPage();
  }

  const context = page.context();

  return {
    page,
    context,
    isProfile: false,
    cleanup: async () => {
      await context.close();
      pool.release(browser);
    },
  };
}

// ── Main Entry Point ──

/**
 * Acquire a page ready for navigation.
 *
 * With chromeProfile: launches persistent context with user's cookies/sessions.
 * Without: uses browser pool + fingerprint injection (existing behavior).
 */
export async function acquirePage(options?: AcquirePageOptions): Promise<PageHandle> {
  const profilePath = resolveChromeProfile(options?.chromeProfile);

  if (profilePath) {
    return withProfileLock(profilePath, () =>
      acquireProfilePage(profilePath, options?.proxyUrl),
    );
  }

  return acquirePoolPage(options?.proxyUrl);
}
