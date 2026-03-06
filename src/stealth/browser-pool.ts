/**
 * Browser pool with acquire/release pattern.
 *
 * Keyed by proxy URL — browsers launched with the same proxy are reused.
 * Each request gets a fresh browser context for isolation.
 *
 * Overflow: if pool is full and all busy, launch a temporary browser
 * that closes on release (never blocks the caller).
 */

import { DEFAULT_BROWSER_POOL_SIZE, DEFAULT_BROWSER_IDLE_TIMEOUT_MS, STEALTH_ARGS } from "../constants.js";

// Playwright types (lazy imported)
type Browser = import("rebrowser-playwright").Browser;
type Playwright = typeof import("rebrowser-playwright");

interface PoolEntry {
  browser: Browser;
  proxyUrl: string | undefined; // undefined = no proxy
  busy: boolean;
  lastUsed: number;
  temporary: boolean; // overflow browsers — close on release
}

let pw: Playwright | null = null;

async function getPlaywright(): Promise<Playwright> {
  if (!pw) {
    pw = await import("rebrowser-playwright");
  }
  return pw;
}

export class BrowserPool {
  private entries: PoolEntry[] = [];
  private maxSize: number;
  private idleTimeoutMs: number;
  private evictInterval: ReturnType<typeof setInterval> | null = null;

  constructor(maxSize?: number, idleTimeoutMs?: number) {
    this.maxSize = maxSize ?? DEFAULT_BROWSER_POOL_SIZE;
    this.idleTimeoutMs = idleTimeoutMs ?? DEFAULT_BROWSER_IDLE_TIMEOUT_MS;
    this.startEviction();
  }

  private startEviction(): void {
    this.evictInterval = setInterval(() => this.evictIdle(), 60_000);
    // Don't keep Node alive just for eviction
    this.evictInterval.unref();
  }

  private async launchBrowser(proxyUrl?: string): Promise<Browser> {
    const playwright = await getPlaywright();
    const launchOptions: Record<string, unknown> = { headless: true, args: STEALTH_ARGS };
    if (proxyUrl) {
      launchOptions.proxy = { server: proxyUrl };
    }
    return playwright.chromium.launch(launchOptions);
  }

  /**
   * Acquire a browser from the pool.
   * 1. Idle browser with matching proxy → reuse
   * 2. Pool has room → launch new
   * 3. Pool full, idle with different proxy → evict + launch
   * 4. Pool full, all busy → launch temporary (close on release)
   */
  async acquire(proxyUrl?: string): Promise<Browser> {
    // 1. Look for idle browser with matching proxy
    const idle = this.entries.find(
      (e) => !e.busy && !e.temporary && e.proxyUrl === proxyUrl,
    );
    if (idle) {
      idle.busy = true;
      idle.lastUsed = Date.now();
      return idle.browser;
    }

    // 2. Pool has room → launch new
    const pooledCount = this.entries.filter((e) => !e.temporary).length;
    if (pooledCount < this.maxSize) {
      const browser = await this.launchBrowser(proxyUrl);
      this.entries.push({
        browser,
        proxyUrl,
        busy: true,
        lastUsed: Date.now(),
        temporary: false,
      });
      return browser;
    }

    // 3. Pool full — evict an idle browser with different proxy
    const evictable = this.entries.find((e) => !e.busy && !e.temporary);
    if (evictable) {
      await evictable.browser.close().catch(() => {});
      const idx = this.entries.indexOf(evictable);
      if (idx !== -1) this.entries.splice(idx, 1);
      const browser = await this.launchBrowser(proxyUrl);
      this.entries.push({
        browser,
        proxyUrl,
        busy: true,
        lastUsed: Date.now(),
        temporary: false,
      });
      return browser;
    }

    // 4. All busy → launch temporary overflow browser
    const browser = await this.launchBrowser(proxyUrl);
    this.entries.push({
      browser,
      proxyUrl,
      busy: true,
      lastUsed: Date.now(),
      temporary: true,
    });
    return browser;
  }

  /**
   * Release a browser back to the pool.
   * Temporary browsers are closed immediately.
   */
  release(browser: Browser): void {
    const entry = this.entries.find((e) => e.browser === browser);
    if (!entry) return;

    if (entry.temporary) {
      // Overflow — close and remove
      const idx = this.entries.indexOf(entry);
      if (idx !== -1) this.entries.splice(idx, 1);
      browser.close().catch(() => {});
    } else {
      entry.busy = false;
      entry.lastUsed = Date.now();
    }
  }

  /** Close browsers idle for longer than idleTimeoutMs. */
  private evictIdle(): void {
    const now = Date.now();
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      if (!e.busy && !e.temporary && now - e.lastUsed > this.idleTimeoutMs) {
        this.entries.splice(i, 1);
        e.browser.close().catch(() => {});
      }
    }
  }

  /** Graceful shutdown — close ALL browsers. */
  async closeAll(): Promise<void> {
    if (this.evictInterval) {
      clearInterval(this.evictInterval);
      this.evictInterval = null;
    }
    const closing = this.entries.map((e) => e.browser.close().catch(() => {}));
    this.entries = [];
    await Promise.all(closing);
  }

  get stats(): { total: number; busy: number; idle: number; temporary: number } {
    const busy = this.entries.filter((e) => e.busy).length;
    const temporary = this.entries.filter((e) => e.temporary).length;
    return {
      total: this.entries.length,
      busy,
      idle: this.entries.length - busy,
      temporary,
    };
  }
}

// ── Singleton ──

let pool: BrowserPool | null = null;

export function getPool(): BrowserPool {
  if (!pool) {
    const size = parseInt(process.env.BROWSER_POOL_SIZE || "", 10);
    pool = new BrowserPool(isNaN(size) ? undefined : size);
  }
  return pool;
}
