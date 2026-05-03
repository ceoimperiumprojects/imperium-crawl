import { describe, it, expect } from "vitest";
import { ActionRecorder } from "../../src/cli/recorder.js";

describe("ActionRecorder", () => {
  const startUrl = "https://example.com";

  it("records actions", () => {
    const r = new ActionRecorder(startUrl);
    r.record({ type: "click", selector: "#btn" }, "click #btn", startUrl);
    r.record({ type: "type", selector: "#input", text: "hello" }, "type #input hello", startUrl);
    expect(r.count).toBe(2);
  });

  it("undo removes last action", () => {
    const r = new ActionRecorder(startUrl);
    r.record({ type: "click", selector: "#a" }, "click #a", startUrl);
    r.record({ type: "click", selector: "#b" }, "click #b", startUrl);
    const undone = r.undo();
    expect(undone?.action.selector).toBe("#b");
    expect(r.count).toBe(1);
  });

  it("undo on empty returns null", () => {
    const r = new ActionRecorder(startUrl);
    expect(r.undo()).toBeNull();
  });

  it("getHistory returns copy (not reference)", () => {
    const r = new ActionRecorder(startUrl);
    r.record({ type: "click" }, "click", startUrl);
    const h1 = r.getHistory();
    const h2 = r.getHistory();
    expect(h1).not.toBe(h2);
    expect(h1).toEqual(h2);
  });

  it("toSkillConfig generates valid InteractSkillConfig", () => {
    const r = new ActionRecorder(startUrl);
    r.record({ type: "navigate", url: "https://example.com/page" }, "navigate", startUrl);
    r.record({ type: "click", selector: "#submit" }, "click #submit", startUrl);

    const config = r.toSkillConfig("my-skill", "Test skill");
    expect(config.name).toBe("my-skill");
    expect(config.description).toBe("Test skill");
    expect(config.tool).toBe("interact");
    expect(config.url).toBe(startUrl);
    expect(config.actions).toHaveLength(2);
    expect(config.actions[0].type).toBe("navigate");
    expect(config.actions[1].type).toBe("click");
    expect(config.created_at).toBeTruthy();
  });

  it("toSkillConfig includes session_id when provided", () => {
    const r = new ActionRecorder(startUrl);
    r.record({ type: "click" }, "click", startUrl);
    const config = r.toSkillConfig("test", "desc", "my-session");
    expect(config.session_id).toBe("my-session");
  });

  it("toSkillConfig includes parameters when provided", () => {
    const r = new ActionRecorder(startUrl);
    r.record({ type: "type", selector: "#q", text: "{{input:query}}" }, "type", startUrl);
    const params = { query: { source: "input" as const, key: "query", description: "Search query" } };
    const config = r.toSkillConfig("test", "desc", undefined, params);
    expect(config.parameters).toEqual(params);
  });

  it("detectParameters identifies password fields", () => {
    const r = new ActionRecorder(startUrl);
    r.record({ type: "type", selector: "#password", text: "mypass" }, "type #password mypass", startUrl);
    const params = r.detectParameters();
    expect(params.password).toBeDefined();
    expect(params.password.source).toBe("env");
  });

  it("detectParameters identifies search fields", () => {
    const r = new ActionRecorder(startUrl);
    r.record({ type: "type", selector: "#search-field", text: "Smith" }, "type", startUrl);
    const params = r.detectParameters();
    expect(params.query).toBeDefined();
    expect(params.query.source).toBe("input");
  });

  it("clear resets history", () => {
    const r = new ActionRecorder(startUrl);
    r.record({ type: "click" }, "click", startUrl);
    r.clear();
    expect(r.count).toBe(0);
  });
});
