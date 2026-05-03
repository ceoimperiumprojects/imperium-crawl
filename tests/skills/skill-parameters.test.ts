import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  resolveString,
  resolveAction,
  resolveActions,
  detectParameterCandidates,
  findUnresolved,
} from "../../src/skills/parameters.js";
import type { SkillParameters } from "../../src/skills/parameters.js";

describe("resolveString", () => {
  it("resolves env variables", () => {
    process.env.TEST_MY_VAR = "hello";
    const result = resolveString("prefix-{{env:TEST_MY_VAR}}-suffix");
    expect(result).toBe("prefix-hello-suffix");
    delete process.env.TEST_MY_VAR;
  });

  it("resolves input variables", () => {
    const result = resolveString("Search: {{input:query}}", {}, { query: "Smith, John" });
    expect(result).toBe("Search: Smith, John");
  });

  it("resolves computed date_today", () => {
    const result = resolveString("Date: {{computed:date_today}}");
    expect(result).toMatch(/Date: \d{4}-\d{2}-\d{2}/);
  });

  it("resolves computed timestamp as number string", () => {
    const result = resolveString("{{computed:timestamp}}");
    expect(Number(result)).toBeGreaterThan(0);
  });

  it("leaves unresolved templates as-is", () => {
    const result = resolveString("{{input:missing}}");
    expect(result).toBe("{{input:missing}}");
  });

  it("uses parameter default when env var missing", () => {
    const params: SkillParameters = {
      username: { source: "env", key: "MISSING_VAR_XYZ", default: "admin" },
    };
    const result = resolveString("{{env:MISSING_VAR_XYZ}}", params);
    expect(result).toBe("admin");
  });

  it("resolves multiple templates in one string", () => {
    process.env.SKILL_USER = "alice";
    const result = resolveString("{{env:SKILL_USER}} searched {{input:q}}", {}, { q: "test" });
    expect(result).toBe("alice searched test");
    delete process.env.SKILL_USER;
  });
});

describe("resolveAction", () => {
  it("resolves text field in type action", () => {
    const action = { type: "type", selector: "#search", text: "{{input:query}}" };
    const resolved = resolveAction(action, {}, { query: "courthouse" });
    expect(resolved.text).toBe("courthouse");
    expect(resolved.selector).toBe("#search"); // unchanged
  });

  it("does not mutate original action", () => {
    const action = { type: "type", text: "{{input:q}}" };
    resolveAction(action, {}, { q: "test" });
    expect(action.text).toBe("{{input:q}}");
  });

  it("resolves url field", () => {
    const action = { type: "navigate", url: "https://example.com/search?q={{input:query}}" };
    const resolved = resolveAction(action, {}, { query: "2024-001" });
    expect(resolved.url).toBe("https://example.com/search?q=2024-001");
  });
});

describe("resolveActions", () => {
  it("resolves all actions in array", () => {
    const actions = [
      { type: "type", selector: "#user", text: "{{input:username}}" },
      { type: "type", selector: "#pass", text: "{{env:MY_TEST_PASS}}" },
    ];
    process.env.MY_TEST_PASS = "secret123";
    const resolved = resolveActions(actions, {}, { username: "testuser" });
    expect(resolved[0].text).toBe("testuser");
    expect(resolved[1].text).toBe("secret123");
    delete process.env.MY_TEST_PASS;
  });
});

describe("detectParameterCandidates", () => {
  it("detects password fields and suggests env source", () => {
    const actions = [
      { type: "type", selector: "#password", text: "mypassword" },
    ];
    const candidates = detectParameterCandidates(actions);
    expect(candidates.password).toBeDefined();
    expect(candidates.password.source).toBe("env");
  });

  it("detects username fields", () => {
    const actions = [
      { type: "type", selector: "#username", text: "admin" },
    ];
    const candidates = detectParameterCandidates(actions);
    expect(candidates.username).toBeDefined();
    expect(candidates.username.source).toBe("env");
  });

  it("detects search query fields", () => {
    const actions = [
      { type: "type", selector: "#search-input", text: "Smith" },
    ];
    const candidates = detectParameterCandidates(actions);
    expect(candidates.query).toBeDefined();
    expect(candidates.query.source).toBe("input");
  });

  it("does not flag already-templated fields", () => {
    const actions = [
      { type: "type", selector: "#password", text: "{{env:MY_PASS}}" },
    ];
    const candidates = detectParameterCandidates(actions);
    // Should be empty since field is already templated
    expect(Object.keys(candidates).length).toBe(0);
  });
});

describe("findUnresolved", () => {
  it("returns empty array when all resolved", () => {
    const unresolved = findUnresolved("hello {{input:name}}", {}, { name: "world" });
    expect(unresolved).toHaveLength(0);
  });

  it("returns unresolved templates", () => {
    const unresolved = findUnresolved("{{input:missing}}", {});
    expect(unresolved).toContain("{{input:missing}}");
  });
});
