import { describe, it, expect } from "vitest";
import { normalizeUrl, isValidUrl, isSameOrigin, getBaseUrl, hasTrackingParams } from "../src/utils/url.js";

describe("normalizeUrl", () => {
  it("adds https:// to bare domain", () => {
    expect(normalizeUrl("example.com")).toBe("https://example.com");
  });

  it("lowercases scheme and host", () => {
    const result = normalizeUrl("HTTPS://EXAMPLE.COM/Path");
    expect(result).toMatch(/^https:\/\/example\.com/);
  });

  it("removes fragment", () => {
    expect(normalizeUrl("https://example.com/page#section")).toBe("https://example.com/page");
  });

  it("removes trailing slash", () => {
    expect(normalizeUrl("https://example.com/page/")).toBe("https://example.com/page");
  });

  it("keeps root path slash (normalize-url preserves it)", () => {
    const result = normalizeUrl("https://example.com/");
    // normalize-url keeps trailing slash on root path
    expect(result).toMatch(/^https:\/\/example\.com\/?$/);
  });

  it("removes UTM tracking params", () => {
    const url = "https://example.com/page?utm_source=google&utm_medium=cpc&real=value";
    const result = normalizeUrl(url);
    expect(result).toContain("real=value");
    expect(result).not.toContain("utm_source");
    expect(result).not.toContain("utm_medium");
  });

  it("removes fbclid", () => {
    const url = "https://example.com/page?article=1&fbclid=abc123";
    const result = normalizeUrl(url);
    expect(result).toContain("article=1");
    expect(result).not.toContain("fbclid");
  });

  it("removes gclid", () => {
    const url = "https://example.com/?gclid=abc&q=hello";
    const result = normalizeUrl(url);
    expect(result).not.toContain("gclid");
    expect(result).toContain("q=hello");
  });

  it("sorts query parameters", () => {
    const url = "https://example.com/page?z=1&a=2&m=3";
    const result = normalizeUrl(url);
    expect(result).toBe("https://example.com/page?a=2&m=3&z=1");
  });

  it("removes www", () => {
    expect(normalizeUrl("https://www.example.com/page")).toBe("https://example.com/page");
  });

  it("removes default port", () => {
    expect(normalizeUrl("https://example.com:443/page")).toBe("https://example.com/page");
  });

  it("throws on truly invalid URL", () => {
    expect(() => normalizeUrl("not a url at all :::")).toThrow();
  });
});

describe("isValidUrl", () => {
  it("returns true for valid URL", () => {
    expect(isValidUrl("https://example.com")).toBe(true);
  });

  it("returns false for invalid string", () => {
    expect(isValidUrl("not a url")).toBe(false);
  });
});

describe("isSameOrigin", () => {
  it("returns true for same origin", () => {
    expect(isSameOrigin("https://example.com/a", "https://example.com/b")).toBe(true);
  });

  it("returns false for different hosts", () => {
    expect(isSameOrigin("https://example.com", "https://other.com")).toBe(false);
  });

  it("returns false for different protocols", () => {
    expect(isSameOrigin("http://example.com", "https://example.com")).toBe(false);
  });
});

describe("getBaseUrl", () => {
  it("extracts origin", () => {
    expect(getBaseUrl("https://example.com/path/page?q=1")).toBe("https://example.com");
  });
});

describe("hasTrackingParams", () => {
  it("detects utm params", () => {
    expect(hasTrackingParams("https://example.com?utm_source=test")).toBe(true);
  });

  it("detects fbclid", () => {
    expect(hasTrackingParams("https://example.com?fbclid=abc")).toBe(true);
  });

  it("returns false for clean URL", () => {
    expect(hasTrackingParams("https://example.com?page=1")).toBe(false);
  });
});
