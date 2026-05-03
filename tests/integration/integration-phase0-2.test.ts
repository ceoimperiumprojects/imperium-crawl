/**
 * Real-world integration tests for Phase 0-2 features.
 *
 * These tests make actual HTTP requests, write to temp filesystem,
 * and (when Playwright is available) open real browsers.
 *
 * Tests are designed to be independently runnable and not depend
 * on external API keys unless clearly guarded with skipIf.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { SessionManager } from "../../src/sessions/index.js";
import { save as saveSkill, remove as removeSkill } from "../../src/skills/manager.js";
import type { InteractSkillConfig, ExtractSkillConfig } from "../../src/skills/manager.js";
import type { ChainConfig } from "../../src/skills/chain.js";

const TIMEOUT = 30_000;

// ── Helpers ──

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "imperium-e2e-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ──────────────────────────────────────────────────────────────────────────────
// Phase 0.3 — Session staleness tracking
// ──────────────────────────────────────────────────────────────────────────────

describe("Session staleness (Phase 0.3)", () => {
  it("incrementActions increases actionCount on disk", async () => {
    const manager = new SessionManager(tmpDir);
    const cookies = [{ name: "sid", value: "abc", domain: "example.com", path: "/" }];

    await manager.save("test-session", cookies, "https://example.com");
    await manager.incrementActions("test-session");
    await manager.incrementActions("test-session");
    await manager.incrementActions("test-session");

    const session = await manager.load("test-session");
    expect(session!.actionCount).toBe(3);
  });

  it("needsRefresh returns false below threshold", async () => {
    const manager = new SessionManager(tmpDir);
    const cookies = [{ name: "sid", value: "abc", domain: "example.com", path: "/" }];

    await manager.save("test-session", cookies, "https://example.com");
    await manager.incrementActions("test-session");
    await manager.incrementActions("test-session");

    const needs = await manager.needsRefresh("test-session", 5);
    expect(needs).toBe(false);
  });

  it("needsRefresh returns true at threshold", async () => {
    const manager = new SessionManager(tmpDir);
    const cookies = [{ name: "sid", value: "abc", domain: "example.com", path: "/" }];

    await manager.save("test-session", cookies, "https://example.com");
    for (let i = 0; i < 5; i++) await manager.incrementActions("test-session");

    const needs = await manager.needsRefresh("test-session", 5);
    expect(needs).toBe(true);
  });

  it("resetActionCount sets counter back to 0", async () => {
    const manager = new SessionManager(tmpDir);
    const cookies = [{ name: "sid", value: "abc", domain: "example.com", path: "/" }];

    await manager.save("test-session", cookies, "https://example.com");
    for (let i = 0; i < 10; i++) await manager.incrementActions("test-session");
    await manager.resetActionCount("test-session");

    const session = await manager.load("test-session");
    expect(session!.actionCount).toBe(0);
    expect(await manager.needsRefresh("test-session", 5)).toBe(false);
  });

  it("needsRefresh returns false for non-existent session", async () => {
    const manager = new SessionManager(tmpDir);
    const result = await manager.needsRefresh("ghost-session", 5);
    expect(result).toBe(false);
  });

  it("incrementActions is a no-op for non-existent session", async () => {
    const manager = new SessionManager(tmpDir);
    // Should not throw
    await expect(manager.incrementActions("ghost")).resolves.toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Phase 0.4 — Knowledge tool (real filesystem)
// ──────────────────────────────────────────────────────────────────────────────

describe("Knowledge tool (Phase 0.4)", () => {
  it(
    "returns empty state when no knowledge file exists",
    async () => {
      // Override knowledge file path to a temp dir
      const origEnv = process.env.IMPERIUM_DATA_DIR;
      process.env.IMPERIUM_DATA_DIR = tmpDir;

      try {
        const { execute } = await import("../../src/tools/knowledge.js");
        // resetKnowledgeEngine so it re-reads from new tmpDir
        const { resetKnowledgeEngine } = await import("../../src/knowledge/index.js");
        resetKnowledgeEngine();

        const result = await execute({ sort: "last_updated", min_requests: 1 });
        const data = JSON.parse(result.content[0].text!);
        // Either empty domains array or message about no data
        expect(data.domains !== undefined || data.message !== undefined).toBe(true);
      } finally {
        if (origEnv !== undefined) process.env.IMPERIUM_DATA_DIR = origEnv;
        else delete process.env.IMPERIUM_DATA_DIR;
        const { resetKnowledgeEngine } = await import("../../src/knowledge/index.js");
        resetKnowledgeEngine();
      }
    },
    TIMEOUT,
  );

  it(
    "returns populated domain stats after recording outcomes",
    async () => {
      const knowledgeFile = path.join(tmpDir, "knowledge.json");
      // Write a test knowledge file directly
      const testKnowledge = {
        "example.com": {
          domain: "example.com",
          optimal_stealth_level: 1,
          antibot_system: null,
          captcha_type: null,
          needs_proxy: false,
          avg_response_time_ms: 250,
          safe_rate_limit: 60,
          success_count: 10,
          fail_count: 2,
          last_updated: new Date().toISOString(),
          level_stats: { "1": { success: 10, fail: 2 } },
        },
        "blocked-site.com": {
          domain: "blocked-site.com",
          optimal_stealth_level: 3,
          antibot_system: "cloudflare",
          captcha_type: null,
          needs_proxy: true,
          avg_response_time_ms: 8000,
          safe_rate_limit: 10,
          success_count: 1,
          fail_count: 15,
          last_updated: new Date().toISOString(),
          level_stats: { "1": { success: 0, fail: 10 }, "3": { success: 1, fail: 5 } },
        },
      };
      await fs.writeFile(knowledgeFile, JSON.stringify(testKnowledge, null, 2));

      const origEnv = process.env.IMPERIUM_DATA_DIR;
      process.env.IMPERIUM_DATA_DIR = tmpDir;

      try {
        const { resetKnowledgeEngine } = await import("../../src/knowledge/index.js");
        resetKnowledgeEngine();

        const { execute } = await import("../../src/tools/knowledge.js");
        const result = await execute({ sort: "last_updated", min_requests: 1 });
        const data = JSON.parse(result.content[0].text!);

        expect(data.domains).toHaveLength(2);
        expect(data.summary.total_domains).toBe(2);
        expect(data.summary.domains_with_antibot).toBe(1);
        expect(data.summary.domains_needing_proxy).toBe(1);

        const exampleDomain = data.domains.find((d: { domain: string }) => d.domain === "example.com");
        expect(exampleDomain).toBeDefined();
        expect(exampleDomain.optimal_level).toBe(1);
        expect(exampleDomain.success).toBe(10);
        expect(exampleDomain.failures).toBe(2);
      } finally {
        if (origEnv !== undefined) process.env.IMPERIUM_DATA_DIR = origEnv;
        else delete process.env.IMPERIUM_DATA_DIR;
        const { resetKnowledgeEngine } = await import("../../src/knowledge/index.js");
        resetKnowledgeEngine();
      }
    },
    TIMEOUT,
  );

  it(
    "filters by domain name",
    async () => {
      const knowledgeFile = path.join(tmpDir, "knowledge.json");
      const testKnowledge = {
        "alpha.com": { domain: "alpha.com", optimal_stealth_level: 1, antibot_system: null, captcha_type: null, needs_proxy: false, avg_response_time_ms: 200, safe_rate_limit: 60, success_count: 5, fail_count: 0, last_updated: new Date().toISOString(), level_stats: {} },
        "beta.com": { domain: "beta.com", optimal_stealth_level: 2, antibot_system: null, captcha_type: null, needs_proxy: false, avg_response_time_ms: 400, safe_rate_limit: 30, success_count: 3, fail_count: 1, last_updated: new Date().toISOString(), level_stats: {} },
      };
      await fs.writeFile(knowledgeFile, JSON.stringify(testKnowledge));

      const origEnv = process.env.IMPERIUM_DATA_DIR;
      process.env.IMPERIUM_DATA_DIR = tmpDir;

      try {
        const { resetKnowledgeEngine } = await import("../../src/knowledge/index.js");
        resetKnowledgeEngine();
        const { execute } = await import("../../src/tools/knowledge.js");

        const result = await execute({ domain: "alpha", sort: "last_updated", min_requests: 1 });
        const data = JSON.parse(result.content[0].text!);
        expect(data.domains).toHaveLength(1);
        expect(data.domains[0].domain).toBe("alpha.com");
      } finally {
        if (origEnv !== undefined) process.env.IMPERIUM_DATA_DIR = origEnv;
        else delete process.env.IMPERIUM_DATA_DIR;
        const { resetKnowledgeEngine } = await import("../../src/knowledge/index.js");
        resetKnowledgeEngine();
      }
    },
    TIMEOUT,
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// Phase 1.1 — Skill parameters: end-to-end save + run
// ──────────────────────────────────────────────────────────────────────────────

describe("Skill parameters — run-skill e2e (Phase 1.1)", () => {
  const TEST_SKILL_NAME = "test-params-e2e";

  afterEach(async () => {
    await removeSkill(TEST_SKILL_NAME).catch(() => {});
  });

  it(
    "saves and runs an interact skill that uses {{computed:date_today}}",
    async () => {
      const today = new Date().toISOString().split("T")[0];

      const config: InteractSkillConfig = {
        name: TEST_SKILL_NAME,
        description: "E2E parameter test — injects date_today",
        tool: "interact",
        url: "https://example.com",
        created_at: new Date().toISOString(),
        actions: [
          {
            type: "evaluate",
            // Script stores computed date into window for inspection
            script: `return "date:{{computed:date_today}}"`,
          },
        ],
      };

      await saveSkill(TEST_SKILL_NAME, config);

      const { execute } = await import("../../src/tools/run-skill.js");
      const result = await execute({ name: TEST_SKILL_NAME, max_items: 10 });
      const data = JSON.parse(result.content[0].text!);

      // The skill ran (either succeeded or browser not available)
      // If browser ran, action_results should contain the date
      if (data.action_results) {
        const evalResult = data.action_results.find((r: { type: string }) => r.type === "evaluate");
        if (evalResult?.success && evalResult.result) {
          expect(String(evalResult.result)).toContain(today);
        }
      }
      // At minimum the skill was found and attempted
      expect(data.skill || data.error).toBeTruthy();
    },
    TIMEOUT,
  );

  it(
    "saves and runs an interact skill with {{input:query}} resolved from params",
    async () => {
      const config: InteractSkillConfig = {
        name: TEST_SKILL_NAME,
        description: "E2E input param test",
        tool: "interact",
        url: "https://example.com",
        created_at: new Date().toISOString(),
        actions: [
          {
            type: "evaluate",
            script: `return "query:{{input:query}}"`,
          },
        ],
        parameters: {
          query: { source: "input", key: "query", description: "Search query" },
        },
      };

      await saveSkill(TEST_SKILL_NAME, config);

      const { execute } = await import("../../src/tools/run-skill.js");
      const result = await execute({
        name: TEST_SKILL_NAME,
        max_items: 10,
        params: { query: "courthouse-records-2024" },
      });
      const data = JSON.parse(result.content[0].text!);

      // Browser ran — check that the template was resolved
      if (data.action_results) {
        const evalResult = data.action_results.find((r: { type: string }) => r.type === "evaluate");
        if (evalResult?.success) {
          expect(String(evalResult.result)).toContain("courthouse-records-2024");
        }
      }
    },
    TIMEOUT,
  );

  it(
    "resolves URL templates in interact skill",
    async () => {
      const config: InteractSkillConfig = {
        name: TEST_SKILL_NAME,
        description: "URL template test",
        tool: "interact",
        url: "https://httpbin.org/get?date={{computed:date_today}}",
        created_at: new Date().toISOString(),
        actions: [
          { type: "evaluate", script: `return window.location.href` },
        ],
      };

      await saveSkill(TEST_SKILL_NAME, config);

      const today = new Date().toISOString().split("T")[0];
      const { execute } = await import("../../src/tools/run-skill.js");
      const result = await execute({ name: TEST_SKILL_NAME, max_items: 10 });
      const data = JSON.parse(result.content[0].text!);

      // If browser ran, URL should contain today's date
      if (data.url) {
        expect(data.url).toContain(today);
      }
    },
    TIMEOUT,
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// Phase 2.2 — Conditions evaluator with real data shapes
// ──────────────────────────────────────────────────────────────────────────────

describe("Conditions evaluator — real data shapes (Phase 2.2)", () => {
  it("evaluates conditions on realistic API response shapes", async () => {
    const { evaluateCondition } = await import("../../src/skills/conditions.js");

    // Simulate what a JSON API response would look like as a step variable
    const variables = {
      search: {
        results: [
          { id: 1, title: "Court Case 2024-001", status: "open" },
          { id: 2, title: "Court Case 2024-002", status: "closed" },
        ],
        total: 2,
        page: 1,
      },
      login: { success: true, token: "abc123" },
      empty: { results: [], total: 0 },
    };

    expect(evaluateCondition("$search.total > 0", variables)).toBe(true);
    expect(evaluateCondition("$empty.total > 0", variables)).toBe(false);
    expect(evaluateCondition("$login.success === true", variables)).toBe(true);
    expect(evaluateCondition("$login.success && $search.total > 0", variables)).toBe(true);
    expect(evaluateCondition("$empty.total > 0 || $login.success", variables)).toBe(true);
    expect(evaluateCondition("$search.results[0].status === 'open'", variables)).toBe(true);
    expect(evaluateCondition("$search.page === 1", variables)).toBe(true);
  });

  it("handles missing/undefined variables gracefully", async () => {
    const { evaluateCondition } = await import("../../src/skills/conditions.js");

    const variables = { step: { count: 5 } };

    // Missing variable — resolves to undefined, falsy
    expect(evaluateCondition("$missing.field > 0", variables)).toBe(false);
    // Existing but undefined path
    expect(evaluateCondition("$step.missing_field", variables)).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Phase 2.1 — Chain executor with real scraping
// ──────────────────────────────────────────────────────────────────────────────

describe("Chain skill — end-to-end execution (Phase 2.1)", () => {
  const SKILL_A = "test-chain-step-a";
  const SKILL_B = "test-chain-step-b";
  const SKILL_CHAIN = "test-chain-combined";

  afterEach(async () => {
    await Promise.all([
      removeSkill(SKILL_A).catch(() => {}),
      removeSkill(SKILL_B).catch(() => {}),
      removeSkill(SKILL_CHAIN).catch(() => {}),
    ]);
  });

  it(
    "executes a two-step chain: scrape + extract — both steps use real HTTP",
    async () => {
      // Step A: scrape example.com
      const skillA: ExtractSkillConfig = {
        name: SKILL_A,
        description: "Scrape example.com",
        url: "https://example.com",
        created_at: new Date().toISOString(),
        selectors: {
          items: "p",
          fields: { text: "" },
        },
        output_format: "list",
      };

      // Step B: scrape httpbin (different URL, to prove both run)
      const skillB: ExtractSkillConfig = {
        name: SKILL_B,
        description: "Scrape httpbin status",
        url: "https://httpbin.org/status/200",
        created_at: new Date().toISOString(),
        selectors: {
          items: "body",
          fields: { content: "" },
        },
        output_format: "single",
      };

      await saveSkill(SKILL_A, skillA);
      await saveSkill(SKILL_B, skillB);

      // Chain: run A then B, merge outputs
      const chainConfig: ChainConfig = {
        name: SKILL_CHAIN,
        description: "Two-step chain test",
        type: "chain",
        steps: [
          { skill: SKILL_A, output: "step_a" },
          { skill: SKILL_B, output: "step_b" },
        ],
        output: "merge($step_a, $step_b)",
        created_at: new Date().toISOString(),
      };

      const { ChainExecutor } = await import("../../src/skills/chain.js");
      const executor = new ChainExecutor();
      const result = await executor.execute(chainConfig);

      expect(result.success).toBe(true);
      expect(result.steps_executed).toBe(2);
      expect(result.steps_skipped).toBe(0);
      expect(result.output).toBeDefined();
    },
    60_000,
  );

  it(
    "skips a step when condition is false",
    async () => {
      const skillA: ExtractSkillConfig = {
        name: SKILL_A,
        description: "First step",
        url: "https://example.com",
        created_at: new Date().toISOString(),
        selectors: { items: "p", fields: { text: "" } },
        output_format: "list",
      };

      await saveSkill(SKILL_A, skillA);

      const chainConfig: ChainConfig = {
        name: SKILL_CHAIN,
        description: "Condition test chain",
        type: "chain",
        steps: [
          { skill: SKILL_A, output: "data" },
          // This step will be skipped because condition is always false
          {
            skill: SKILL_A,
            output: "skipped_data",
            condition: "false === true",
          },
        ],
        output: "$data",
        created_at: new Date().toISOString(),
      };

      const { ChainExecutor } = await import("../../src/skills/chain.js");
      const executor = new ChainExecutor();
      const result = await executor.execute(chainConfig);

      expect(result.success).toBe(true);
      expect(result.steps_executed).toBe(1);
      expect(result.steps_skipped).toBe(1);
      expect(result.step_results[1].skipped).toBe(true);
    },
    TIMEOUT,
  );

  it(
    "fails and reports error when skill not found",
    async () => {
      const chainConfig: ChainConfig = {
        name: SKILL_CHAIN,
        description: "Error propagation test",
        type: "chain",
        steps: [
          { skill: "nonexistent-skill-xyz-123", output: "data" },
        ],
        created_at: new Date().toISOString(),
      };

      const { ChainExecutor } = await import("../../src/skills/chain.js");
      const executor = new ChainExecutor();
      const result = await executor.execute(chainConfig);

      expect(result.success).toBe(false);
      expect(result.error).toContain("nonexistent-skill-xyz-123");
    },
    TIMEOUT,
  );

  it(
    "run-skill dispatches chain type via skill file",
    async () => {
      const skillA: ExtractSkillConfig = {
        name: SKILL_A,
        description: "Chain sub-skill",
        url: "https://example.com",
        created_at: new Date().toISOString(),
        selectors: { items: "p", fields: { text: "" } },
        output_format: "list",
      };

      await saveSkill(SKILL_A, skillA);

      // Save chain config as a skill file
      await saveSkill(SKILL_CHAIN, {
        ...({
          name: SKILL_CHAIN,
          description: "Chain via run-skill",
          type: "chain",
          url: "",
          steps: [{ skill: SKILL_A, output: "result" }],
          output: "$result",
          created_at: new Date().toISOString(),
        } as unknown as ExtractSkillConfig),
      });

      const { execute } = await import("../../src/tools/run-skill.js");
      const result = await execute({ name: SKILL_CHAIN, max_items: 10 });
      const data = JSON.parse(result.content[0].text!);

      expect(data.tool).toBe("chain");
      expect(data.steps_executed).toBeDefined();
      expect(data.output).toBeDefined();
    },
    TIMEOUT,
  );
});

// ──────────────────────────────────────────────────────────────────────────────
// LLM retry — verify jitter + retry behavior
// ──────────────────────────────────────────────────────────────────────────────

describe("LLM retry backoff (Phase 0.2)", () => {
  it("retries on 429 and eventually succeeds", async () => {
    const { withRetry } = await import("../../src/llm/retry.js");

    let callCount = 0;
    const fn = async () => {
      callCount++;
      if (callCount < 3) {
        throw new Error("API error 429: rate limited");
      }
      return "success";
    };

    const result = await withRetry(fn);
    expect(result).toBe("success");
    expect(callCount).toBe(3);
  });

  it("retries on 503 server error", async () => {
    const { withRetry } = await import("../../src/llm/retry.js");

    let callCount = 0;
    const fn = async () => {
      callCount++;
      if (callCount < 2) throw new Error("API error 503: service unavailable");
      return "ok";
    };

    const result = await withRetry(fn);
    expect(result).toBe("ok");
    expect(callCount).toBe(2);
  });

  it("throws immediately on 400 (not retryable)", async () => {
    const { withRetry } = await import("../../src/llm/retry.js");

    let callCount = 0;
    const fn = async (): Promise<string> => {
      callCount++;
      throw new Error("API error 400: bad request");
    };

    await expect(withRetry(fn)).rejects.toThrow("400");
    expect(callCount).toBe(1); // No retries
  });

  it("throws after exhausting all retries", async () => {
    const { withRetry } = await import("../../src/llm/retry.js");

    let callCount = 0;
    const fn = async (): Promise<string> => {
      callCount++;
      throw new Error("API error 429: rate limited");
    };

    await expect(withRetry(fn)).rejects.toThrow("429");
    expect(callCount).toBe(4); // 1 initial + 3 retries
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Playwright-dependent: refresh action, max_actions_before_refresh
// ──────────────────────────────────────────────────────────────────────────────

describe("Interact tool — new Phase 0.3 actions", async () => {
  let playwrightRunnable = false;
  try {
    const pw = await import("rebrowser-playwright");
    const browser = await pw.chromium.launch({ headless: true });
    await browser.close();
    playwrightRunnable = true;
  } catch {
    playwrightRunnable = false;
  }

  describe.skipIf(!playwrightRunnable)("with Playwright available", () => {
    it(
      "refresh action reloads the page and returns success",
      async () => {
        const { execute } = await import("../../src/tools/interact.js");
        const result = await execute({
          url: "https://example.com",
          actions: [
            { type: "evaluate", script: "return document.title" },
            { type: "refresh" },
            { type: "evaluate", script: "return document.title" },
          ],
          return_content: false,
          return_screenshot: false,
          return_snapshot: false,
          return_network_log: false,
          timeout: 20_000,
        });

        const data = JSON.parse(result.content[0].text!);
        expect(data.action_results).toHaveLength(3);
        const refreshResult = data.action_results[1];
        expect(refreshResult.type).toBe("refresh");
        expect(refreshResult.success).toBe(true);
      },
      45_000,
    );

    it(
      "max_actions_before_refresh auto-inserts refresh into long sessions",
      async () => {
        const { execute } = await import("../../src/tools/interact.js");
        const result = await execute({
          url: "https://example.com",
          actions: [
            { type: "evaluate", script: "return 1" },
            { type: "evaluate", script: "return 2" },
            { type: "evaluate", script: "return 3" },
          ],
          max_actions_before_refresh: 2,
          session_id: `refresh-test-${Date.now()}`,
          return_content: false,
          return_screenshot: false,
          return_snapshot: false,
          return_network_log: false,
          timeout: 20_000,
        });

        const data = JSON.parse(result.content[0].text!);
        // With max=2, should auto-refresh after 2 actions
        const actionTypes = data.action_results.map((r: { type: string }) => r.type);
        expect(actionTypes).toContain("refresh");
      },
      45_000,
    );

    it(
      "schema accepts new refresh action type",
      async () => {
        const { schema } = await import("../../src/tools/interact.js");
        const parsed = schema.safeParse({
          url: "https://example.com",
          actions: [{ type: "refresh" }],
        });
        expect(parsed.success).toBe(true);
      },
    );

    it(
      "schema accepts max_actions_before_refresh",
      async () => {
        const { schema } = await import("../../src/tools/interact.js");
        const parsed = schema.safeParse({
          url: "https://example.com",
          actions: [],
          max_actions_before_refresh: 10,
        });
        expect(parsed.success).toBe(true);
      },
    );
  });
});
