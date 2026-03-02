import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { predict, aggregateOutcome, type FetchOutcome, type DomainKnowledge } from "../src/knowledge/predictor.js";
import { AdaptiveLearningEngine } from "../src/knowledge/store.js";

// ── Predictor Tests ──

describe("predict()", () => {
  it("returns low confidence for domains with no data", () => {
    const knowledge: DomainKnowledge = {
      domain: "example.com",
      optimal_stealth_level: 1,
      antibot_system: null,
      captcha_type: null,
      needs_proxy: false,
      avg_response_time_ms: 0,
      safe_rate_limit: 60,
      success_count: 0,
      fail_count: 0,
      last_updated: new Date().toISOString(),
      level_stats: {},
    };
    const result = predict(knowledge);
    expect(result.confidence).toBeLessThan(0.5);
  });

  it("returns high confidence for well-known domains", () => {
    const knowledge: DomainKnowledge = {
      domain: "cloudflare-site.com",
      optimal_stealth_level: 3,
      antibot_system: "cloudflare",
      captcha_type: null,
      needs_proxy: false,
      avg_response_time_ms: 2000,
      safe_rate_limit: 60,
      success_count: 10,
      fail_count: 1,
      last_updated: new Date().toISOString(),
      level_stats: {
        "1": { success: 0, fail: 5 },
        "3": { success: 10, fail: 1 },
      },
    };
    const result = predict(knowledge);
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    expect(result.startLevel).toBe(3);
    expect(result.reason).toContain("cloudflare");
  });

  it("suggests proxy when failures dominate without proxy", () => {
    const knowledge: DomainKnowledge = {
      domain: "strict-site.com",
      optimal_stealth_level: 3,
      antibot_system: null,
      captcha_type: null,
      needs_proxy: false,
      avg_response_time_ms: 5000,
      safe_rate_limit: 60,
      success_count: 1,
      fail_count: 10,
      last_updated: new Date().toISOString(),
      level_stats: {
        "3": { success: 1, fail: 10 },
      },
    };
    const result = predict(knowledge);
    expect(result.needsProxy).toBe(true);
  });

  it("applies decay to old entries", () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const knowledge: DomainKnowledge = {
      domain: "old-site.com",
      optimal_stealth_level: 2,
      antibot_system: null,
      captcha_type: null,
      needs_proxy: false,
      avg_response_time_ms: 500,
      safe_rate_limit: 60,
      success_count: 5,
      fail_count: 0,
      last_updated: eightDaysAgo,
      level_stats: { "2": { success: 5, fail: 0 } },
    };
    const result = predict(knowledge);
    // Decayed: effective success = 5 * 0.5 = 2.5, below high confidence threshold
    expect(result.confidence).toBeLessThan(0.9);
  });

  it("picks lowest level with best success rate", () => {
    const knowledge: DomainKnowledge = {
      domain: "easy-site.com",
      optimal_stealth_level: 3,
      antibot_system: null,
      captcha_type: null,
      needs_proxy: false,
      avg_response_time_ms: 200,
      safe_rate_limit: 60,
      success_count: 20,
      fail_count: 2,
      last_updated: new Date().toISOString(),
      level_stats: {
        "1": { success: 15, fail: 0 },
        "2": { success: 3, fail: 1 },
        "3": { success: 2, fail: 1 },
      },
    };
    const result = predict(knowledge);
    expect(result.startLevel).toBe(1); // Level 1 has 100% success rate
  });
});

// ── AggregateOutcome Tests ──

describe("aggregateOutcome()", () => {
  const baseOutcome: FetchOutcome = {
    url: "https://example.com/page",
    domain: "example.com",
    levelUsed: 1,
    success: true,
    responseTimeMs: 300,
    antiBotSystem: null,
    captchaType: null,
    proxyUsed: false,
    blocked: false,
    httpStatus: 200,
  };

  it("creates new knowledge from first outcome", () => {
    const result = aggregateOutcome(null, baseOutcome);
    expect(result.domain).toBe("example.com");
    expect(result.success_count).toBe(1);
    expect(result.fail_count).toBe(0);
    expect(result.optimal_stealth_level).toBe(1);
    expect(result.avg_response_time_ms).toBe(300);
  });

  it("increments success count on successful outcome", () => {
    const existing = aggregateOutcome(null, baseOutcome);
    const result = aggregateOutcome(existing, { ...baseOutcome, responseTimeMs: 500 });
    expect(result.success_count).toBe(2);
    expect(result.fail_count).toBe(0);
  });

  it("increments fail count on failed outcome", () => {
    const existing = aggregateOutcome(null, baseOutcome);
    const result = aggregateOutcome(existing, {
      ...baseOutcome,
      success: false,
      blocked: true,
      httpStatus: 403,
    });
    expect(result.success_count).toBe(1);
    expect(result.fail_count).toBe(1);
  });

  it("reduces rate limit on 429", () => {
    const existing = aggregateOutcome(null, baseOutcome);
    const result = aggregateOutcome(existing, {
      ...baseOutcome,
      success: false,
      httpStatus: 429,
    });
    expect(result.safe_rate_limit).toBeLessThan(60);
  });

  it("uses EMA for response time", () => {
    const first = aggregateOutcome(null, { ...baseOutcome, responseTimeMs: 100 });
    const second = aggregateOutcome(first, { ...baseOutcome, responseTimeMs: 400 });
    // EMA: 100 * 0.7 + 400 * 0.3 = 190
    expect(second.avg_response_time_ms).toBe(190);
  });

  it("updates optimal level based on stats", () => {
    let knowledge = aggregateOutcome(null, { ...baseOutcome, levelUsed: 1, success: false, blocked: true });
    knowledge = aggregateOutcome(knowledge, { ...baseOutcome, levelUsed: 1, success: false, blocked: true });
    knowledge = aggregateOutcome(knowledge, { ...baseOutcome, levelUsed: 3, success: true });
    knowledge = aggregateOutcome(knowledge, { ...baseOutcome, levelUsed: 3, success: true });
    // Level 3 has 100% success, Level 1 has 0%
    expect(knowledge.optimal_stealth_level).toBe(3);
  });

  it("records antibot system", () => {
    const result = aggregateOutcome(null, {
      ...baseOutcome,
      antiBotSystem: "cloudflare",
    });
    expect(result.antibot_system).toBe("cloudflare");
  });
});

// ── Store Tests ──

describe("AdaptiveLearningEngine", () => {
  let tmpDir: string;
  let engine: AdaptiveLearningEngine;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "knowledge-test-"));
    const filePath = path.join(tmpDir, "knowledge.json");
    engine = new AdaptiveLearningEngine(filePath);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("starts empty", async () => {
    const result = await engine.predict("https://example.com");
    expect(result).toBeNull();
  });

  it("records and retrieves knowledge", async () => {
    await engine.record({
      url: "https://example.com/page",
      domain: "example.com",
      levelUsed: 2,
      success: true,
      responseTimeMs: 500,
      antiBotSystem: null,
      captchaType: null,
      proxyUsed: false,
      blocked: false,
      httpStatus: 200,
    });

    const knowledge = await engine.get("example.com");
    expect(knowledge).not.toBeNull();
    expect(knowledge!.success_count).toBe(1);
    expect(knowledge!.optimal_stealth_level).toBe(2);
  });

  it("persists to disk and reloads", async () => {
    await engine.record({
      url: "https://example.com/page",
      domain: "example.com",
      levelUsed: 1,
      success: true,
      responseTimeMs: 200,
      antiBotSystem: null,
      captchaType: null,
      proxyUsed: false,
      blocked: false,
      httpStatus: 200,
    });

    await engine.flush();

    // Create new engine pointing to same file
    const filePath = path.join(tmpDir, "knowledge.json");
    const engine2 = new AdaptiveLearningEngine(filePath);
    const knowledge = await engine2.get("example.com");
    expect(knowledge).not.toBeNull();
    expect(knowledge!.success_count).toBe(1);
  });

  it("handles corrupt JSON gracefully", async () => {
    const filePath = path.join(tmpDir, "knowledge.json");
    await fs.writeFile(filePath, "not valid json{{{", "utf-8");

    const corruptEngine = new AdaptiveLearningEngine(filePath);
    const result = await corruptEngine.predict("https://example.com");
    expect(result).toBeNull();
    expect(corruptEngine.size).toBe(0);
  });

  it("provides predictions after enough data", async () => {
    for (let i = 0; i < 5; i++) {
      await engine.record({
        url: "https://hard-site.com/page",
        domain: "hard-site.com",
        levelUsed: 3,
        success: true,
        responseTimeMs: 2000,
        antiBotSystem: "cloudflare",
        captchaType: null,
        proxyUsed: false,
        blocked: false,
        httpStatus: 200,
      });
    }

    const prediction = await engine.predict("https://hard-site.com/other");
    expect(prediction).not.toBeNull();
    expect(prediction!.startLevel).toBe(3);
    expect(prediction!.confidence).toBeGreaterThanOrEqual(0.7);
  });
});
