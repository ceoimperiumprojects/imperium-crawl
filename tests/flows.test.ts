import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  flowSchema,
  parseFlowRef,
  saveFlow,
  loadFlow,
  listFlows,
  resolveFlowInputs,
  createFlowServer,
  type FlowDefinition,
} from "../src/flows/index.js";

const baseFlow: FlowDefinition = {
  schema_version: 1,
  family: "generic-search",
  variant: "site-a",
  name: "generic-search/site-a",
  url: "https://example.com",
  created_at: "2026-04-28T00:00:00.000Z",
  inputs: {
    query: { description: "Search query", required: true },
  },
  steps: [
    { type: "type", selector: "#q", text: "{{input:query}}" },
    { type: "click", target: { role: "button", name: "Search", selector: "button[type=submit]" } },
    { type: "evaluate", output: "result", script: "return { ok: true }" },
  ],
  recording: {
    started_at: "2026-04-28T00:00:00.000Z",
    start_url: "https://example.com",
    user_agent: "test-agent",
    viewport: { width: 1280, height: 720 },
    events: [
      {
        type: "click",
        timestamp: "2026-04-28T00:00:01.000Z",
        page_url: "https://example.com",
        title: "Example",
        target: {
          tag: "button",
          role: "button",
          name: "Search",
          selector: "button[type=submit]",
          xpath: "/html/body/button[1]",
          attributes: { type: "submit" },
          x: 10,
          y: 20,
          viewport: { width: 1280, height: 720 },
        },
      },
    ],
    network: [
      {
        type: "request",
        timestamp: "2026-04-28T00:00:01.000Z",
        url: "https://example.com/search",
        method: "GET",
        resource_type: "document",
      },
    ],
    navigations: [
      {
        timestamp: "2026-04-28T00:00:01.000Z",
        url: "https://example.com/search",
        frame_url: "https://example.com/search",
      },
    ],
  },
  captcha: "auto",
  browser: "auto",
  evidence: { action_log: true },
};

describe("Imperium Flows schema/storage", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "flows-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("validates a generic family/variant flow", () => {
    const parsed = flowSchema.parse(baseFlow);
    expect(parsed.family).toBe("generic-search");
    expect(parsed.variant).toBe("site-a");
    expect(parsed.steps).toHaveLength(3);
    expect(parsed.recording?.events[0].target?.xpath).toBe("/html/body/button[1]");
    expect(parsed.recording?.network[0].resource_type).toBe("document");
  });

  it("rejects invalid family names", () => {
    expect(() => flowSchema.parse({ ...baseFlow, family: "../bad" })).toThrow();
  });

  it("parses family/variant refs", () => {
    expect(parseFlowRef("family-a/variant-b")).toEqual({ family: "family-a", variant: "variant-b" });
  });

  it("saves, loads, and lists flows from an override dir", async () => {
    const path = await saveFlow(baseFlow, { flowsDir: dir });
    expect(path).toContain("generic-search");

    const loaded = await loadFlow({ family: "generic-search", variant: "site-a" }, { flowsDir: dir });
    expect(loaded.flow.name).toBe("generic-search/site-a");

    const flows = await listFlows({ flowsDir: dir });
    expect(flows).toHaveLength(1);
    expect(flows[0]).toMatchObject({ family: "generic-search", variant: "site-a" });
  });

  it("resolves required inputs and defaults", () => {
    const input = resolveFlowInputs(
      {
        ...baseFlow,
        inputs: {
          query: { required: true },
          page: { default: "1" },
        },
      },
      { query: "abc" },
    );
    expect(input).toEqual({ query: "abc", page: "1" });
  });

  it("throws for missing required inputs", () => {
    expect(() => resolveFlowInputs(baseFlow, {})).toThrow(/query/);
  });
});

describe("Flow server auth policy", () => {
  it("allows localhost without a token", async () => {
    const server = createFlowServer({ host: "127.0.0.1", port: 0 });
    const req = { method: "GET", url: "/health", headers: {} } as never;
    const end = vi.fn();
    const res = {
      writeHead: vi.fn(),
      end,
    } as never;
    await new Promise<void>((resolve) => {
      server.emit("request", req, res);
      setImmediate(resolve);
    });
    expect(end.mock.calls[0][0]).toContain('"ok": true');
  });

  it("requires bearer auth for public host", async () => {
    const server = createFlowServer({ host: "0.0.0.0", port: 0, apiToken: "secret" });
    const req = { method: "GET", url: "/health", headers: {} } as never;
    const end = vi.fn();
    const res = {
      writeHead: vi.fn(),
      end,
    } as never;
    await new Promise<void>((resolve) => {
      server.emit("request", req, res);
      setImmediate(resolve);
    });
    expect(end.mock.calls[0][0]).toContain("Unauthorized");
  });
});
