import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveChromeProfile } from "../src/stealth/chrome-profile.js";
import { getChromeProfilePath, hasChromeProfileConfigured } from "../src/config.js";
import { allTools } from "../src/tools/index.js";
import { STEALTH_ARGS, DEFAULT_VIEWPORT, HUMAN_DELAY_MIN_MS, HUMAN_DELAY_MAX_MS } from "../src/constants.js";

describe("Chrome Profile — config helpers", () => {
  const originalEnv = process.env.CHROME_PROFILE_PATH;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.CHROME_PROFILE_PATH = originalEnv;
    } else {
      delete process.env.CHROME_PROFILE_PATH;
    }
  });

  it("getChromeProfilePath returns undefined when env not set", () => {
    delete process.env.CHROME_PROFILE_PATH;
    expect(getChromeProfilePath()).toBeUndefined();
  });

  it("getChromeProfilePath returns trimmed value when env is set", () => {
    process.env.CHROME_PROFILE_PATH = "  /home/user/.config/google-chrome  ";
    expect(getChromeProfilePath()).toBe("/home/user/.config/google-chrome");
  });

  it("getChromeProfilePath returns undefined for empty/whitespace env", () => {
    process.env.CHROME_PROFILE_PATH = "   ";
    expect(getChromeProfilePath()).toBeUndefined();
  });

  it("hasChromeProfileConfigured returns false when not set", () => {
    delete process.env.CHROME_PROFILE_PATH;
    expect(hasChromeProfileConfigured()).toBe(false);
  });

  it("hasChromeProfileConfigured returns true when set", () => {
    process.env.CHROME_PROFILE_PATH = "/some/path";
    expect(hasChromeProfileConfigured()).toBe(true);
  });
});

describe("Chrome Profile — resolveChromeProfile", () => {
  const originalEnv = process.env.CHROME_PROFILE_PATH;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.CHROME_PROFILE_PATH = originalEnv;
    } else {
      delete process.env.CHROME_PROFILE_PATH;
    }
  });

  it("override takes priority over env", () => {
    process.env.CHROME_PROFILE_PATH = "/env/path";
    expect(resolveChromeProfile("/override/path")).toBe("/override/path");
  });

  it("falls back to env when no override", () => {
    process.env.CHROME_PROFILE_PATH = "/env/path";
    expect(resolveChromeProfile()).toBe("/env/path");
  });

  it("returns undefined when neither override nor env", () => {
    delete process.env.CHROME_PROFILE_PATH;
    expect(resolveChromeProfile()).toBeUndefined();
  });
});

describe("Chrome Profile — tool schemas", () => {
  const toolsWithChromeProfile = [
    "scrape", "crawl", "map", "extract", "readability", "screenshot",
    "run_skill", "discover_apis", "monitor_websocket", "visual_builder",
  ];

  for (const toolName of toolsWithChromeProfile) {
    it(`${toolName} schema accepts chrome_profile string`, () => {
      const tool = allTools.find((t) => t.name === toolName);
      expect(tool).toBeDefined();

      // Verify the schema parses with chrome_profile
      const result = tool!.schema.safeParse({
        url: "https://example.com",
        chrome_profile: "/home/user/.config/google-chrome",
        // Required fields for specific tools
        ...(toolName === "extract" ? { selectors: { title: "h1" } } : {}),
        ...(toolName === "visual_builder" ? { name: "test-skill" } : {}),
        ...(toolName === "run_skill" ? { name: "test-skill" } : {}),
      });
      expect(result.success).toBe(true);
    });
  }

  const toolsWithoutChromeProfile = [
    "search", "news_search", "image_search", "video_search",
    "create_skill", "list_skills", "query_api",
  ];

  for (const toolName of toolsWithoutChromeProfile) {
    it(`${toolName} schema does NOT have chrome_profile`, () => {
      const tool = allTools.find((t) => t.name === toolName);
      expect(tool).toBeDefined();
      // These tools shouldn't accept chrome_profile in their schema
      // (Zod strips unknown keys by default, so we check the shape)
      const shape = (tool!.schema as any).shape;
      expect(shape.chrome_profile).toBeUndefined();
    });
  }
});

describe("Stealth constants", () => {
  it("STEALTH_ARGS contains critical anti-detection flags", () => {
    expect(STEALTH_ARGS).toContain("--disable-blink-features=AutomationControlled");
    expect(STEALTH_ARGS).toContain("--disable-infobars");
    expect(STEALTH_ARGS).toContain("--no-first-run");
    expect(STEALTH_ARGS.length).toBeGreaterThanOrEqual(10);
  });

  it("DEFAULT_VIEWPORT has realistic desktop dimensions", () => {
    expect(DEFAULT_VIEWPORT.width).toBeGreaterThanOrEqual(1280);
    expect(DEFAULT_VIEWPORT.height).toBeGreaterThanOrEqual(720);
    expect(DEFAULT_VIEWPORT.width).toBeLessThanOrEqual(3840);
    expect(DEFAULT_VIEWPORT.height).toBeLessThanOrEqual(2160);
  });

  it("human delay range is sensible", () => {
    expect(HUMAN_DELAY_MIN_MS).toBeGreaterThan(0);
    expect(HUMAN_DELAY_MIN_MS).toBeLessThan(HUMAN_DELAY_MAX_MS);
    expect(HUMAN_DELAY_MAX_MS).toBeLessThanOrEqual(5000);
  });
});
