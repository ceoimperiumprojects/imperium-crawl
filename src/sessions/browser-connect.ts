/**
 * CDP Reconnect helper — connects to a persistent Chrome session via CDP.
 *
 * The key insight: connectOverCDP returns a Browser object, but calling
 * browser.close() on a CDP-connected browser only DISCONNECTS — it does
 * NOT close the actual Chrome process. Chrome lives on independently.
 *
 * Flow:
 *   1. Load browser state from disk (endpoint + PID)
 *   2. Verify PID is alive
 *   3. Connect via CDP
 *   4. Get existing page (or create new one)
 *   5. Return { browser, page, disconnect }
 *   6. disconnect() syncs cookies to SessionManager, then disconnects
 */

import {
  loadBrowserState,
  isBrowserAlive,
  clearBrowserState,
} from "./browser-state.js";
import { getSessionManager } from "./manager.js";

type Browser = import("rebrowser-playwright").Browser;
type Page = import("rebrowser-playwright").Page;

export interface BrowserConnection {
  browser: Browser;
  page: Page;
  /** Disconnect from Chrome WITHOUT closing it. Syncs cookies first. */
  disconnect: () => Promise<void>;
}

/**
 * Connect to an existing persistent browser session via CDP.
 * Throws if no browser is running for this session.
 */
export async function connectToSession(session: string): Promise<BrowserConnection> {
  const state = await loadBrowserState(session);
  if (!state) {
    throw new Error(`No browser running for session "${session}". Run: browser start --session ${session}`);
  }

  const alive = await isBrowserAlive(session);
  if (!alive) {
    await clearBrowserState(session);
    throw new Error(
      `Browser for session "${session}" is not running (PID ${state.pid} dead). Run: browser start --session ${session}`,
    );
  }

  const { chromium } = await import("rebrowser-playwright");
  const browser = await chromium.connectOverCDP(state.endpoint);

  const contexts = browser.contexts();
  const context = contexts[0];
  if (!context) {
    throw new Error(`No browser context found for session "${session}"`);
  }

  const pages = context.pages();
  const page = pages[0] ?? await context.newPage();

  return {
    browser,
    page,
    disconnect: async () => {
      try {
        // Sync cookies to SessionManager before disconnecting
        const cookies = await page.context().cookies();
        const storedCookies = cookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          expires: c.expires,
          httpOnly: c.httpOnly,
          secure: c.secure,
          sameSite: c.sameSite as "Strict" | "Lax" | "None" | undefined,
        }));
        await getSessionManager().save(session, storedCookies, page.url());
      } catch {
        // Best effort — don't fail disconnect on cookie sync error
      }

      // close() on CDP-connected browser = disconnect only (Chrome stays alive)
      await browser.close();
    },
  };
}
