/**
 * CamoFox browser engine — REST API wrapper around CamoFox (Camoufox-based stealth browser).
 *
 * CamoFox is a Firefox fork with C++ anti-fingerprinting — it patches
 * navigator.hardwareConcurrency, WebGL, AudioContext, and WebRTC at the C++
 * level before JavaScript ever sees them. No shims, no tells.
 *
 * This engine auto-starts the CamoFox server on first use and communicates
 * via its REST API (default port 9377). It implements BrowserEngine so tool
 * code can switch between Playwright and CamoFox with a single flag.
 *
 * Usage:
 *   import { camofoxEngine } from "../engines/camofox.js";
 *   if (await camofoxEngine.isAvailable()) {
 *     await camofoxEngine.launch();
 *     const { page, cleanup } = await camofoxEngine.acquirePage({ headless: true });
 *     await page.goto("https://example.com");
 *     const html = await page.content();
 *     await cleanup();
 *   }
 */

import type { BrowserEngine, AcquirePageResult, EnginePage } from "./types.js";
import { getDomain } from "../utils/url.js";
import { debugLog } from "../utils/debug.js";
import { createRequire } from "node:module";

const DEFAULT_PORT = 9377;
const DEFAULT_BASE_URL = `http://127.0.0.1:${DEFAULT_PORT}`;
const STARTUP_TIMEOUT_MS = 30_000;
const HEALTH_POLL_MS = 250;

let serverProcess: import("node:child_process").ChildProcess | null = null;
let baseUrl = process.env.CAMOFOX_URL ?? DEFAULT_BASE_URL;
let launchPromise: Promise<void> | null = null;

// ── Internal helpers ──────────────────────────────────────────────────

async function camoFetch(
  path: string,
  options: RequestInit & { timeout?: number } = {},
): Promise<Response> {
  const { timeout = 15_000, ...fetchOptions } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`${baseUrl}${path}`, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(fetchOptions.headers ?? {}),
      },
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function healthCheck(): Promise<boolean> {
  try {
    const res = await camoFetch("/health", { timeout: 3000 });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Server lifecycle ──────────────────────────────────────────────────

async function startServer(): Promise<void> {
  if (await healthCheck()) {
    debugLog("camoFox", "Server already running");
    return;
  }

  debugLog("camoFox", "Starting server...");

  const { spawn } = await import("node:child_process");

  // Try npx first, then direct node invocation
  const isNpxAvailable = await (async () => {
    try {
      const { spawnSync } = await import("node:child_process");
      const result = spawnSync("npx", ["--version"], { timeout: 5000 });
      return result.status === 0;
    } catch {
      return false;
    }
  })();

  if (isNpxAvailable) {
    serverProcess = spawn("npx", ["@askjo/camofox-browser"], {
      env: { ...process.env, CAMOFOX_PORT: String(DEFAULT_PORT) },
      stdio: "pipe",
      detached: false,
    });
  } else {
    // Try requiring the module directly
    serverProcess = spawn(process.execPath, [
      "-e",
      `require('@askjo/camofox-browser/server.js')`,
    ], {
      env: { ...process.env, CAMOFOX_PORT: String(DEFAULT_PORT) },
      stdio: "pipe",
      detached: false,
    });
  }

  serverProcess.stdout?.on("data", (d: Buffer) => debugLog("camoFox:stdout", d.toString().trim()));
  serverProcess.stderr?.on("data", (d: Buffer) => debugLog("camoFox:stderr", d.toString().trim()));

  // Wait for server to become healthy
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await healthCheck()) {
      debugLog("camoFox", "Server ready");
      return;
    }
    await new Promise((r) => setTimeout(r, HEALTH_POLL_MS));
  }

  throw new Error(`CamoFox server failed to start within ${STARTUP_TIMEOUT_MS / 1000}s`);
}

async function stopServer(): Promise<void> {
  if (serverProcess) {
    try {
      await camoFetch("/stop", { method: "POST", timeout: 5000 });
    } catch {
      // Server may already be down
    }
    serverProcess.kill("SIGTERM");
    serverProcess = null;
  }
}

// ── Cleanup on exit ───────────────────────────────────────────────────

let shutdownRegistered = false;
function registerShutdown(): void {
  if (shutdownRegistered) return;
  shutdownRegistered = true;

  const cleanup = async () => {
    await stopServer();
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

// ── CamoFoxPage ───────────────────────────────────────────────────────

class CamoFoxPage implements EnginePage {
  private tabId: string;
  private userId: string;
  private currentUrl: string;
  private closed = false;

  constructor(tabId: string, userId: string, startUrl: string) {
    this.tabId = tabId;
    this.userId = userId;
    this.currentUrl = startUrl;
  }

  url(): string {
    return this.currentUrl;
  }

  async content(): Promise<string> {
    this.ensureOpen();
    try {
      const res = await camoFetch(`/tabs/${this.tabId}/snapshot?userId=${this.userId}`, {
        timeout: 10_000,
      });
      if (!res.ok) throw new Error(`Snapshot failed: ${res.status}`);
      const data = await res.json() as { snapshot: string; links?: Array<{ url: string; text: string }> };
      // Accessibility snapshot — for scraping we want full HTML.
      // Fall back to navigating + re-fetching via the page URL.
      // For now return snapshot text as markdown approximation.
      const links = (data.links ?? []).map((l) => `- [${l.text}](${l.url})`).join("\n");
      return `# ${this.currentUrl}\n\n${data.snapshot}\n\n## Links\n\n${links}`;
    } catch (err) {
      throw new Error(`Failed to get page content: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<void> {
    this.ensureOpen();
    const res = await camoFetch(`/tabs/${this.tabId}/navigate`, {
      method: "POST",
      body: JSON.stringify({ userId: this.userId, url }),
      timeout: options?.timeout ?? 15_000,
    });
    if (!res.ok) throw new Error(`Navigation failed: ${res.status}`);
    this.currentUrl = url;
  }

  async click(selector: string, options?: { timeout?: number }): Promise<void> {
    this.ensureOpen();
    // CamoFox supports both refs (e1, e2) and CSS selectors
    const body = selector.startsWith("e") && /^e\d+$/.test(selector)
      ? { userId: this.userId, ref: selector }
      : { userId: this.userId, selector };
    const res = await camoFetch(`/tabs/${this.tabId}/click`, {
      method: "POST",
      body: JSON.stringify(body),
      timeout: options?.timeout ?? 10_000,
    });
    if (!res.ok) throw new Error(`Click failed: ${res.status}`);
  }

  async fill(selector: string, text: string, options?: { timeout?: number }): Promise<void> {
    this.ensureOpen();
    const body = selector.startsWith("e") && /^e\d+$/.test(selector)
      ? { userId: this.userId, ref: selector, text }
      : { userId: this.userId, selector, text };
    const res = await camoFetch(`/tabs/${this.tabId}/type`, {
      method: "POST",
      body: JSON.stringify(body),
      timeout: options?.timeout ?? 10_000,
    });
    if (!res.ok) throw new Error(`Type failed: ${res.status}`);
  }

  async type(selector: string, text: string, options?: { delay?: number; timeout?: number }): Promise<void> {
    // CamoFox type doesn't support delay directly — simulate with fill
    return this.fill(selector, text, options);
  }

  async selectOption(selector: string, value: string, _options?: { timeout?: number }): Promise<void> {
    this.ensureOpen();
    // CamoFox doesn't have a dedicated selectOption — use evaluate
    try {
      await this.evaluate(`(function(){
        const el = document.querySelector(${JSON.stringify(selector)});
        if (el) { el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('change', { bubbles: true })); }
      })()`);
    } catch {
      throw new Error(`Select option not supported for selector: ${selector}`);
    }
  }

  async hover(selector: string, _options?: { timeout?: number }): Promise<void> {
    this.ensureOpen();
    // CamoFox doesn't have a dedicated hover endpoint — use evaluate
    try {
      await this.evaluate(`(function(){
        const el = document.querySelector(${JSON.stringify(selector)});
        if (el) el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      })()`);
    } catch {
      throw new Error(`Hover not supported for selector: ${selector}`);
    }
  }

  async press(key: string, options?: { timeout?: number }): Promise<void> {
    this.ensureOpen();
    const res = await camoFetch(`/tabs/${this.tabId}/press`, {
      method: "POST",
      body: JSON.stringify({ userId: this.userId, key }),
      timeout: options?.timeout ?? 10_000,
    });
    if (!res.ok) throw new Error(`Press failed: ${res.status}`);
  }

  async evaluate<T>(script: string): Promise<T> {
    this.ensureOpen();
    // CamoFox doesn't have an evaluate endpoint in the REST API.
    // For simple reads we use the snapshot, for writes we attempt page interaction.
    // Most evaluate use cases in our tools are for:
    // 1. Reading page state → use snapshot API
    // 2. Executing JS → use type/click with JS-injection via selectOption/hover workarounds
    //
    // Return null for unsupported evaluate calls
    debugLog("camoFox", `evaluate() called but not natively supported: ${script.slice(0, 80)}`);
    return null as T;
  }

  async waitForTimeout(ms: number): Promise<void> {
    this.ensureOpen();
    // Use CamoFox wait endpoint if available, else client-side wait
    try {
      await camoFetch(`/tabs/${this.tabId}/wait`, {
        method: "POST",
        body: JSON.stringify({ userId: this.userId, timeout: ms }),
        timeout: ms + 5000,
      });
    } catch {
      // Fallback: just wait on client side
      await new Promise((r) => setTimeout(r, ms));
    }
  }

  async waitForSelector(selector: string, options?: { timeout?: number }): Promise<void> {
    this.ensureOpen();
    try {
      await camoFetch(`/tabs/${this.tabId}/wait`, {
        method: "POST",
        body: JSON.stringify({
          userId: this.userId,
          selector,
          timeout: options?.timeout ?? 10_000,
        }),
        timeout: (options?.timeout ?? 10_000) + 5000,
      });
    } catch {
      // Fallback: poll with snapshot
      const deadline = Date.now() + (options?.timeout ?? 10_000);
      while (Date.now() < deadline) {
        const res = await camoFetch(`/tabs/${this.tabId}/snapshot?userId=${this.userId}`);
        if (res.ok) {
          const data = await res.json() as { snapshot: string };
          if (data.snapshot.includes(selector)) return;
        }
        await new Promise((r) => setTimeout(r, 300));
      }
      throw new Error(`waitForSelector timed out: ${selector}`);
    }
  }

  async screenshot(options?: { fullPage?: boolean }): Promise<Buffer> {
    this.ensureOpen();
    const fullPage = options?.fullPage ?? false;
    const res = await camoFetch(
      `/tabs/${this.tabId}/screenshot?userId=${this.userId}&fullPage=${fullPage}`,
      { timeout: 15_000 },
    );
    if (!res.ok) throw new Error(`Screenshot failed: ${res.status}`);
    // Screenshot returns PNG binary or base64 via snapshot?includeScreenshot=true
    // The REST API returns the image directly
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await camoFetch(`/tabs/${this.tabId}?userId=${this.userId}`, {
        method: "DELETE",
        timeout: 5000,
      });
    } catch {
      // Tab may already be closed
    }
    debugLog("camoFox", `Tab closed: ${this.tabId}`);
  }

  private ensureOpen(): void {
    if (this.closed) throw new Error("Page is closed");
  }
}

// ── Engine implementation ─────────────────────────────────────────────

let launched = false;

export const camofoxEngine: BrowserEngine = {
  name: "camofox",
  description: "CamoFox — Firefox-based stealth browser with C++ anti-fingerprinting (bypasses Cloudflare, Google, most bot detection)",

  async isAvailable(): Promise<boolean> {
    try {
      const require = createRequire(import.meta.url);
      require.resolve("@askjo/camofox-browser/package.json");
      return true;
    } catch {
      if (await healthCheck()) return true;
      return false;
    }
  },

  async launch(): Promise<void> {
    if (launched) return;
    if (launchPromise) return launchPromise;

    launchPromise = (async () => {
      await startServer();
      registerShutdown();
      launched = true;
      debugLog("camoFox", "Engine launched");
    })();

    await launchPromise;
  },

  async shutdown(): Promise<void> {
    await stopServer();
    launched = false;
    launchPromise = null;
  },

  async acquirePage(options: {
    chromeProfile?: boolean;
    proxyUrl?: string;
    headless?: boolean;
    sessionId?: string;
    timeout?: number;
  }): Promise<AcquirePageResult> {
    if (!launched) await this.launch();

    const userId = options.sessionId ?? `ic_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const sessionKey = `sk_${Date.now()}`;
    const startUrl = "about:blank";

    // Create tab
    const res = await camoFetch("/tabs", {
      method: "POST",
      body: JSON.stringify({
        userId,
        sessionKey,
        url: startUrl,
      }),
      timeout: options.timeout ?? 15_000,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`Failed to create CamoFox tab: ${res.status} ${errBody}`);
    }

    const data = await res.json() as { id: string; url?: string };
    const tabId = data.id;

    // Navigate to actual URL if provided
    // (the url param above is the initial URL during tab creation)

    const page = new CamoFoxPage(tabId, userId, startUrl);

    const cleanup = async () => {
      await page.close();
      try {
        await camoFetch(`/sessions/${userId}`, { method: "DELETE", timeout: 5000 });
      } catch {
        // Session may already be cleaned up
      }
    };

    return { page, isProfile: false, cleanup };
  },
};

// ── Public helpers ────────────────────────────────────────────────────

export async function isCamofoxAvailable(): Promise<boolean> {
  return camofoxEngine.isAvailable();
}

export async function getCamofoxVersion(): Promise<string | null> {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("@askjo/camofox-browser/package.json");
    return pkg.version as string;
  } catch {
    return null;
  }
}

export async function getCamofoxLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch("https://registry.npmjs.org/@askjo/camofox-browser/latest", {
      timeout: 5000,
    } as RequestInit);
    if (!res.ok) return null;
    const data = await res.json() as { version: string };
    return data.version;
  } catch {
    return null;
  }
}
