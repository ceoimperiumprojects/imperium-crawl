import { describe, it, expect } from "vitest";
import { parseCompactNumber, parseRelativeTime, sanitizeText, extractScriptJson } from "../src/social/parsers.js";

describe("parseCompactNumber", () => {
  it("parses K suffix", () => {
    expect(parseCompactNumber("1.2K")).toBe(1200);
    expect(parseCompactNumber("842K")).toBe(842_000);
  });

  it("parses M suffix", () => {
    expect(parseCompactNumber("1.2M")).toBe(1_200_000);
    expect(parseCompactNumber("3M")).toBe(3_000_000);
  });

  it("parses B suffix", () => {
    expect(parseCompactNumber("2.5B")).toBe(2_500_000_000);
  });

  it("parses plain numbers", () => {
    expect(parseCompactNumber("1234")).toBe(1234);
    expect(parseCompactNumber("1,234,567")).toBe(1_234_567);
  });

  it("handles case insensitivity", () => {
    expect(parseCompactNumber("1.5k")).toBe(1500);
    expect(parseCompactNumber("2m")).toBe(2_000_000);
  });

  it("returns NaN for invalid input", () => {
    expect(parseCompactNumber("")).toBeNaN();
    expect(parseCompactNumber("abc")).toBeNaN();
  });

  it("handles strings with spaces and plus", () => {
    expect(parseCompactNumber("+ 1.2K")).toBe(1200);
    expect(parseCompactNumber(" 500 ")).toBe(500);
  });
});

describe("parseRelativeTime", () => {
  it("parses hours ago", () => {
    const result = parseRelativeTime("3 hours ago");
    expect(result).toBeTruthy();
    const diff = Date.now() - new Date(result!).getTime();
    // Should be approximately 3 hours (with some tolerance)
    expect(diff).toBeGreaterThan(3 * 3_600_000 - 5000);
    expect(diff).toBeLessThan(3 * 3_600_000 + 5000);
  });

  it("parses singular units", () => {
    const result = parseRelativeTime("1 day ago");
    expect(result).toBeTruthy();
  });

  it("parses various units", () => {
    expect(parseRelativeTime("5 minutes ago")).toBeTruthy();
    expect(parseRelativeTime("2 weeks ago")).toBeTruthy();
    expect(parseRelativeTime("1 month ago")).toBeTruthy();
    expect(parseRelativeTime("1 year ago")).toBeTruthy();
  });

  it("returns null for invalid input", () => {
    expect(parseRelativeTime("")).toBeNull();
    expect(parseRelativeTime("just now")).toBeNull();
    expect(parseRelativeTime("yesterday")).toBeNull();
  });
});

describe("sanitizeText", () => {
  it("strips HTML tags", () => {
    expect(sanitizeText("<p>Hello <b>world</b></p>")).toBe("Hello world");
  });

  it("decodes HTML entities", () => {
    expect(sanitizeText("Tom &amp; Jerry")).toBe("Tom & Jerry");
    expect(sanitizeText("&lt;script&gt;")).toBe("<script>");
    expect(sanitizeText("&quot;quoted&quot;")).toBe('"quoted"');
  });

  it("collapses whitespace", () => {
    expect(sanitizeText("  hello   world  ")).toBe("hello world");
  });

  it("handles empty input", () => {
    expect(sanitizeText("")).toBe("");
  });
});

describe("extractScriptJson", () => {
  it("extracts var assignment", () => {
    const html = `<html><script>var ytInitialData = {"key": "value"};</script></html>`;
    const result = extractScriptJson(html, "ytInitialData");
    expect(result).toEqual({ key: "value" });
  });

  it("extracts window bracket assignment", () => {
    const html = `<script>window['__UNIVERSAL_DATA_FOR_REHYDRATION__'] = {"data": 123};</script>`;
    const result = extractScriptJson(html, "__UNIVERSAL_DATA_FOR_REHYDRATION__");
    expect(result).toEqual({ data: 123 });
  });

  it("handles nested objects", () => {
    const html = `var ytInitialData = {"a": {"b": {"c": [1, 2, 3]}}};`;
    const result = extractScriptJson(html, "ytInitialData");
    expect(result).toEqual({ a: { b: { c: [1, 2, 3] } } });
  });

  it("handles strings with braces", () => {
    const html = `var ytInitialData = {"text": "hello {world}"};`;
    const result = extractScriptJson(html, "ytInitialData");
    expect(result).toEqual({ text: "hello {world}" });
  });

  it("returns null for missing var", () => {
    const html = `<script>var other = {};</script>`;
    expect(extractScriptJson(html, "ytInitialData")).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    const html = `var ytInitialData = {invalid json};`;
    expect(extractScriptJson(html, "ytInitialData")).toBeNull();
  });
});
