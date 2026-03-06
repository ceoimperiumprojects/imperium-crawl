import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BrowserPool } from "../src/stealth/browser-pool.js";

// Mock rebrowser-playwright — each launch() returns a unique object
vi.mock("rebrowser-playwright", () => ({
  chromium: {
    launch: vi.fn().mockImplementation(() =>
      Promise.resolve({
        close: vi.fn().mockResolvedValue(undefined),
        newContext: vi.fn(),
      }),
    ),
  },
}));

describe("BrowserPool", () => {
  let pool: BrowserPool;

  beforeEach(() => {
    vi.clearAllMocks();
    // Small pool for testing
    pool = new BrowserPool(2, 1000);
  });

  afterEach(async () => {
    await pool.closeAll();
  });

  describe("acquire/release cycle", () => {
    it("starts with empty stats", () => {
      const stats = pool.stats;
      expect(stats.total).toBe(0);
      expect(stats.busy).toBe(0);
      expect(stats.idle).toBe(0);
      expect(stats.temporary).toBe(0);
    });

    it("acquires a browser and marks it busy", async () => {
      const browser = await pool.acquire();
      expect(browser).toBeDefined();
      expect(pool.stats.total).toBe(1);
      expect(pool.stats.busy).toBe(1);
    });

    it("releases a browser and marks it idle", async () => {
      const browser = await pool.acquire();
      pool.release(browser);
      expect(pool.stats.busy).toBe(0);
      expect(pool.stats.idle).toBe(1);
    });

    it("reuses idle browser with same proxy", async () => {
      const browser1 = await pool.acquire("http://proxy1:8080");
      pool.release(browser1);
      const browser2 = await pool.acquire("http://proxy1:8080");
      expect(browser2).toBe(browser1);
      expect(pool.stats.total).toBe(1);
    });

    it("launches new browser for different proxy", async () => {
      // Use a pool of size 1 to force eviction
      const smallPool = new BrowserPool(1, 1000);
      const browser1 = await smallPool.acquire("http://proxy1:8080");
      smallPool.release(browser1);
      const browser2 = await smallPool.acquire("http://proxy2:8080");
      expect(browser2).not.toBe(browser1);
      expect(smallPool.stats.total).toBe(1); // evicted old one to make room
      await smallPool.closeAll();
    });
  });

  describe("pool overflow", () => {
    it("creates temporary browser when pool is full and all busy", async () => {
      // Fill pool
      const b1 = await pool.acquire();
      const b2 = await pool.acquire();
      expect(pool.stats.total).toBe(2);

      // Overflow
      const b3 = await pool.acquire();
      expect(pool.stats.total).toBe(3);
      expect(pool.stats.temporary).toBe(1);

      // Release temporary — should be removed
      pool.release(b3);
      expect(pool.stats.total).toBe(2);
      expect(pool.stats.temporary).toBe(0);

      pool.release(b1);
      pool.release(b2);
    });
  });

  describe("eviction", () => {
    it("evicts idle browsers after timeout", async () => {
      const browser = await pool.acquire();
      pool.release(browser);
      expect(pool.stats.idle).toBe(1);

      // Advance time past idle timeout
      vi.useFakeTimers();
      vi.advanceTimersByTime(1500); // > 1000ms idle timeout
      // Trigger eviction manually (normally runs every 60s)
      (pool as any).evictIdle();
      vi.useRealTimers();

      expect(pool.stats.total).toBe(0);
    });
  });

  describe("closeAll", () => {
    it("closes all browsers and clears entries", async () => {
      const b1 = await pool.acquire();
      const b2 = await pool.acquire();
      expect(pool.stats.total).toBe(2);

      await pool.closeAll();
      expect(pool.stats.total).toBe(0);
    });

    it("handles closeAll on empty pool", async () => {
      await expect(pool.closeAll()).resolves.not.toThrow();
    });
  });

  describe("release unknown browser", () => {
    it("ignores release of unknown browser", () => {
      const fakeBrowser = { close: vi.fn() } as any;
      expect(() => pool.release(fakeBrowser)).not.toThrow();
      expect(pool.stats.total).toBe(0);
    });
  });
});
