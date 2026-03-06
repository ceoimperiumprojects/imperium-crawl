import { describe, it, expect } from "vitest";
import { allTools } from "../src/tools/index.js";
import { isPlaywrightAvailable } from "../src/stealth/browser.js";
import { hasBraveApiKey, hasTwoCaptchaApiKey } from "../src/config.js";
import { TwoCaptchaSolver } from "../src/captcha/solver.js";

describe("Tool Registry", () => {
  it("has exactly 26 tools registered", () => {
    expect(allTools).toHaveLength(26);
  });

  it("all tools have required fields", () => {
    for (const tool of allTools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.schema).toBeDefined();
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("no duplicate tool names", () => {
    const names = allTools.map((t) => t.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it("contains all expected tool names", () => {
    const names = allTools.map((t) => t.name);
    const expected = [
      "scrape", "crawl", "map", "extract", "readability", "screenshot",
      "search", "news_search", "image_search", "video_search",
      "create_skill", "run_skill", "list_skills",
      "discover_apis", "query_api", "monitor_websocket",
      "ai_extract", "interact", "snapshot", "batch_scrape",
      "list_jobs", "job_status", "delete_job",
      "youtube", "reddit", "instagram",
    ];
    for (const name of expected) {
      expect(names).toContain(name);
    }
  });

  it("scraping tools don't require API keys in schema", () => {
    const scrapingTools = ["scrape", "crawl", "map", "extract", "readability", "screenshot"];
    for (const name of scrapingTools) {
      const tool = allTools.find((t) => t.name === name);
      expect(tool).toBeDefined();
      // These should work without any API key
      expect(tool!.description).not.toContain("API_KEY required");
    }
  });
});

// ── Conditional: Playwright ──

describe("Playwright-dependent tools", async () => {
  // Check if Playwright is both importable AND has browsers installed
  let playwrightRunnable = false;
  try {
    const pw = await import("rebrowser-playwright");
    const browser = await pw.chromium.launch({ headless: true });
    await browser.close();
    playwrightRunnable = true;
  } catch {
    playwrightRunnable = false;
  }

  describe.skipIf(!playwrightRunnable)("with Playwright available + browsers installed", () => {
    it(
      "screenshot tool works",
      async () => {
        const tool = allTools.find((t) => t.name === "screenshot")!;
        const result = await tool.execute({ url: "https://example.com", full_page: false });
        expect(result.content).toHaveLength(1);
        expect(result.content[0].type).toBe("image");
      },
      30_000,
    );

    it(
      "discover_apis tool works",
      async () => {
        const tool = allTools.find((t) => t.name === "discover_apis")!;
        const result = await tool.execute({
          url: "https://jsonplaceholder.typicode.com",
          wait_seconds: 3,
          timeout: 20_000,
        });
        const data = JSON.parse(result.content[0].text!);
        expect(data.url).toBeDefined();
        expect(data.apis_found).toBeDefined();
        expect(Array.isArray(data.apis)).toBe(true);
      },
      45_000,
    );

    it(
      "monitor_websocket tool works (may find 0 connections on static site)",
      async () => {
        const tool = allTools.find((t) => t.name === "monitor_websocket")!;
        const result = await tool.execute({
          url: "https://example.com",
          duration_seconds: 3,
          timeout: 15_000,
        });
        const data = JSON.parse(result.content[0].text!);
        expect(data.websocket_connections).toBeDefined();
        expect(data.total_messages).toBeDefined();
      },
      30_000,
    );
  });

  describe.skipIf(playwrightRunnable)("without Playwright browsers", () => {
    it("screenshot tool throws when browsers not installed", async () => {
      const tool = allTools.find((t) => t.name === "screenshot")!;
      await expect(tool.execute({ url: "https://example.com" })).rejects.toThrow();
    });
  });
});

// ── Conditional: Brave API ──

describe("Brave Search tools", () => {
  const hasBrave = hasBraveApiKey();

  describe.skipIf(!hasBrave)("with Brave API key", () => {
    it(
      "search tool returns results",
      async () => {
        const tool = allTools.find((t) => t.name === "search")!;
        const result = await tool.execute({ query: "test", count: 3 });
        const data = JSON.parse(result.content[0].text!);
        expect(data).toBeDefined();
      },
      15_000,
    );
  });

  describe.skipIf(hasBrave)("without Brave API key", () => {
    it("search tool returns error when key missing", async () => {
      const tool = allTools.find((t) => t.name === "search")!;
      // Some tools throw, others return error in content
      try {
        const result = await tool.execute({ query: "test", count: 1 });
        const data = JSON.parse(result.content[0].text!);
        expect(data.error || data.message).toBeTruthy();
      } catch (err) {
        // Throwing is also acceptable behavior
        expect(err).toBeDefined();
      }
    });
  });
});

// ── Conditional: 2Captcha ──

describe("2Captcha integration", () => {
  const has2Captcha = hasTwoCaptchaApiKey();

  describe.skipIf(!has2Captcha)("with 2Captcha API key", () => {
    it(
      "can check balance",
      async () => {
        const solver = new TwoCaptchaSolver(process.env.TWOCAPTCHA_API_KEY || process.env.TWO_CAPTCHA_API_KEY!);
        const balance = await solver.getBalance();
        expect(typeof balance).toBe("number");
        expect(balance).toBeGreaterThanOrEqual(0);
      },
      15_000,
    );
  });

  describe.skipIf(has2Captcha)("without 2Captcha API key", () => {
    it("hasTwoCaptchaApiKey returns false", () => {
      expect(hasTwoCaptchaApiKey()).toBe(false);
    });
  });
});

// ── Skills tools (no external deps, just filesystem) ──

describe("Skills tools", () => {
  it(
    "list_skills returns valid structure",
    async () => {
      const tool = allTools.find((t) => t.name === "list_skills")!;
      const result = await tool.execute({});
      const data = JSON.parse(result.content[0].text!);
      // May have total (with skills) or message (empty) — both valid
      expect(Array.isArray(data.skills)).toBe(true);
      if (data.skills.length > 0) {
        expect(data.total).toBeDefined();
      } else {
        expect(data.message).toBeDefined();
      }
    },
  );
});
