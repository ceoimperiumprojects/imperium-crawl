import { describe, it, expect } from "vitest";
import type { OverlayConfig, RecordedEvent } from "../src/visual-builder/overlay.js";
import { getOverlayScript } from "../src/visual-builder/overlay.js";
import type { WorkflowRecording, PageSummary } from "../src/visual-builder/builder.js";
import * as visualBuilderTool from "../src/tools/visual-builder.js";

describe("getOverlayScript()", () => {
  it("returns a string containing the IIFE", () => {
    const script = getOverlayScript({ url: "https://example.com" });
    expect(typeof script).toBe("string");
    expect(script).toContain("__imperiumInit");
    expect(script).toContain("__imperiumComplete__");
    expect(script).toContain("DOMContentLoaded");
  });

  it("works without config argument", () => {
    const script = getOverlayScript();
    expect(typeof script).toBe("string");
    expect(script).toContain("__imperiumInit");
  });

  it("contains recording bar elements", () => {
    const script = getOverlayScript({ url: "https://example.com" });
    expect(script).toContain("Recording");
    expect(script).toContain("End Workflow");
    expect(script).toContain("eventCount");
  });

  it("captures event data structure", () => {
    const script = getOverlayScript({ url: "https://example.com" });
    expect(script).toContain("selector");
    expect(script).toContain("tagName");
    expect(script).toContain("attributes");
    expect(script).toContain("parentSelector");
    expect(script).toContain("siblingIndex");
    expect(script).toContain("timestamp");
  });

  it("contains input event listener", () => {
    const script = getOverlayScript({ url: "https://example.com" });
    expect(script).toContain('"input"');
    expect(script).toContain("onInput");
    expect(script).toContain("inputValue");
  });

  it("contains navigation tracking", () => {
    const script = getOverlayScript({ url: "https://example.com" });
    expect(script).toContain("navInterval");
    expect(script).toContain("lastUrl");
    expect(script).toContain("toUrl");
    expect(script).toContain("location.href");
  });

  it("cleans up navInterval on end workflow", () => {
    const script = getOverlayScript({ url: "https://example.com" });
    expect(script).toContain("clearInterval(navInterval)");
  });

  it("removes input listener on end workflow", () => {
    const script = getOverlayScript({ url: "https://example.com" });
    expect(script).toContain('removeEventListener("input"');
  });

  // ── Real-time push model ──
  it("uses __imperiumPushEvent__ for real-time event push", () => {
    const script = getOverlayScript();
    expect(script).toContain("__imperiumPushEvent__");
    expect(script).toContain("pushEvent");
  });

  it("calls __imperiumComplete__ with no arguments", () => {
    const script = getOverlayScript();
    // Should call with no args — Node already has all events
    expect(script).toContain("__imperiumComplete__()");
    // Should NOT pass JSON.stringify(...)
    expect(script).not.toContain("__imperiumComplete__(JSON.stringify");
  });

  it("checks Ctrl/Meta key for new-tab gesture passthrough", () => {
    const script = getOverlayScript();
    expect(script).toContain("e.ctrlKey");
    expect(script).toContain("e.metaKey");
    expect(script).toContain("isNewTabGesture");
    expect(script).toContain("e.button === 1");
  });

  it("includes pageUrl in click events", () => {
    const script = getOverlayScript();
    expect(script).toContain("pageUrl: location.href");
  });

  it("uses eventCount counter instead of events array", () => {
    const script = getOverlayScript();
    expect(script).toContain("var eventCount = 0");
    // Should not have the old events array
    expect(script).not.toContain("var events = []");
  });

  it("has re-injection guard before eventCount", () => {
    const script = getOverlayScript();
    expect(script).toContain("__imp_initialized");
    // Guard must appear BEFORE eventCount to prevent any duplicate setup
    const guardIdx = script.indexOf("__imp_initialized");
    const counterIdx = script.indexOf("var eventCount = 0");
    expect(guardIdx).toBeLessThan(counterIdx);
  });

  it("guard sets window.__imp_initialized flag", () => {
    const script = getOverlayScript();
    expect(script).toContain("window.__imp_initialized = true");
  });
});

describe("RecordedEvent type", () => {
  it("supports pageUrl field", () => {
    const event: RecordedEvent = {
      type: "click",
      selector: "#btn",
      tagName: "button",
      text: "Click me",
      attributes: {},
      parentSelector: "body",
      siblingIndex: 0,
      timestamp: 1234567890,
      pageUrl: "https://example.com/page1",
    };
    expect(event.pageUrl).toBe("https://example.com/page1");
  });

  it("supports tab-open event type with tabInfo", () => {
    const event: RecordedEvent = {
      type: "tab-open",
      selector: "",
      tagName: "",
      text: "",
      attributes: {},
      parentSelector: "",
      siblingIndex: 0,
      timestamp: 1234567890,
      pageUrl: "about:blank",
      tabInfo: { pageId: "page-1", opener: "page-0" },
    };
    expect(event.type).toBe("tab-open");
    expect(event.tabInfo?.pageId).toBe("page-1");
    expect(event.tabInfo?.opener).toBe("page-0");
  });

  it("supports tab-close event type with tabInfo", () => {
    const event: RecordedEvent = {
      type: "tab-close",
      selector: "",
      tagName: "",
      text: "Detail Page",
      attributes: {},
      parentSelector: "",
      siblingIndex: 0,
      timestamp: 1234567890,
      pageUrl: "https://example.com/detail",
      tabInfo: { pageId: "page-1", opener: "page-0" },
    };
    expect(event.type).toBe("tab-close");
    expect(event.tabInfo?.pageId).toBe("page-1");
  });

  it("supports input events", () => {
    const inputEvent: RecordedEvent = {
      type: "input",
      selector: "#search",
      tagName: "input",
      text: "hello world",
      attributes: { type: "text", name: "q" },
      parentSelector: "body > form",
      siblingIndex: 0,
      timestamp: 1234567890,
      pageUrl: "https://example.com",
      inputValue: "hello world",
    };
    expect(inputEvent.type).toBe("input");
    expect(inputEvent.inputValue).toBe("hello world");
  });

  it("supports navigate events", () => {
    const navEvent: RecordedEvent = {
      type: "navigate",
      selector: "",
      tagName: "",
      text: "Search Results",
      attributes: {},
      parentSelector: "",
      siblingIndex: 0,
      timestamp: 1234567890,
      pageUrl: "https://example.com/results?q=hello",
      toUrl: "https://example.com/results?q=hello",
    };
    expect(navEvent.type).toBe("navigate");
    expect(navEvent.toUrl).toContain("results");
  });
});

describe("WorkflowRecording type", () => {
  it("has expected shape with events array and pages", () => {
    const recording: WorkflowRecording = {
      url: "https://example.com",
      recordedAt: "2026-01-01T00:00:00.000Z",
      events: [
        {
          type: "click",
          selector: "#title",
          tagName: "h1",
          text: "Hello World",
          attributes: { id: "title", class: "main-title" },
          parentSelector: "body > div",
          siblingIndex: 0,
          timestamp: 1234567890,
          pageUrl: "https://example.com",
        },
      ],
      pages: [
        {
          pageId: "page-0",
          url: "https://example.com",
          title: "Example",
          openedAt: 1234567890,
        },
      ],
    };
    expect(recording.events).toHaveLength(1);
    expect(recording.events[0].selector).toBe("#title");
    expect(recording.events[0].tagName).toBe("h1");
    expect(recording.events[0].type).toBe("click");
    expect(recording.pages).toHaveLength(1);
    expect(recording.pages[0].pageId).toBe("page-0");
  });

  it("PageSummary title is a required string", () => {
    const page: PageSummary = {
      pageId: "page-0",
      url: "https://example.com",
      title: "Test",
      openedAt: 1000,
    };
    expect(typeof page.title).toBe("string");
    // Title is required — empty string is valid, undefined is not
    const emptyTitle: PageSummary = { ...page, title: "" };
    expect(emptyTitle.title).toBe("");
  });

  it("supports pages with opener and closedAt", () => {
    const pageSummary: PageSummary = {
      pageId: "page-1",
      url: "https://example.com/detail",
      title: "Detail Page",
      openedAt: 1000,
      closedAt: 5000,
      opener: "page-0",
    };
    expect(pageSummary.opener).toBe("page-0");
    expect(pageSummary.closedAt).toBe(5000);
  });

  it("supports mixed multi-page workflow", () => {
    const recording: WorkflowRecording = {
      url: "https://example.com",
      recordedAt: "2026-01-01T00:00:00.000Z",
      events: [
        {
          type: "click",
          selector: "#search-input",
          tagName: "input",
          text: "",
          attributes: { type: "text" },
          parentSelector: "body > form",
          siblingIndex: 0,
          timestamp: 1000,
          pageUrl: "https://example.com",
        },
        {
          type: "input",
          selector: "#search-input",
          tagName: "input",
          text: "laptops",
          attributes: { type: "text" },
          parentSelector: "body > form",
          siblingIndex: 0,
          timestamp: 2000,
          inputValue: "laptops",
          pageUrl: "https://example.com",
        },
        {
          type: "tab-open",
          selector: "",
          tagName: "",
          text: "",
          attributes: {},
          parentSelector: "",
          siblingIndex: 0,
          timestamp: 3000,
          pageUrl: "about:blank",
          tabInfo: { pageId: "page-1", opener: "page-0" },
        },
        {
          type: "navigate",
          selector: "",
          tagName: "",
          text: "Laptop Detail",
          attributes: {},
          parentSelector: "",
          siblingIndex: 0,
          timestamp: 4000,
          toUrl: "https://example.com/laptop/123",
          pageUrl: "https://example.com/laptop/123",
        },
        {
          type: "tab-close",
          selector: "",
          tagName: "",
          text: "Laptop Detail",
          attributes: {},
          parentSelector: "",
          siblingIndex: 0,
          timestamp: 5000,
          pageUrl: "https://example.com/laptop/123",
          tabInfo: { pageId: "page-1", opener: "page-0" },
        },
      ],
      pages: [
        {
          pageId: "page-0",
          url: "https://example.com",
          title: "Example Store",
          openedAt: 500,
        },
        {
          pageId: "page-1",
          url: "https://example.com/laptop/123",
          title: "Laptop Detail",
          openedAt: 3000,
          closedAt: 5000,
          opener: "page-0",
        },
      ],
    };

    expect(recording.events).toHaveLength(5);
    const types = recording.events.map((e) => e.type);
    expect(types).toEqual(["click", "input", "tab-open", "navigate", "tab-close"]);

    expect(recording.pages).toHaveLength(2);
    expect(recording.pages[1].opener).toBe("page-0");
    expect(recording.pages[1].closedAt).toBeDefined();
  });
});

describe("visual_builder MCP tool", () => {
  it("exports required tool shape", () => {
    expect(visualBuilderTool.name).toBe("visual_builder");
    expect(typeof visualBuilderTool.description).toBe("string");
    expect(visualBuilderTool.description.length).toBeGreaterThan(0);
    expect(visualBuilderTool.schema).toBeDefined();
    expect(typeof visualBuilderTool.execute).toBe("function");
  });

  it("schema requires url", () => {
    const result = visualBuilderTool.schema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("schema accepts url", () => {
    const result = visualBuilderTool.schema.safeParse({
      url: "https://example.com",
    });
    expect(result.success).toBe(true);
  });

  it("description mentions recording and events", () => {
    expect(visualBuilderTool.description.toLowerCase()).toContain("record");
    expect(visualBuilderTool.description.toLowerCase()).toContain("event");
  });

  it("description mentions tabs and popups", () => {
    const desc = visualBuilderTool.description.toLowerCase();
    expect(desc).toContain("tab");
    expect(desc).toContain("popup");
  });
});
