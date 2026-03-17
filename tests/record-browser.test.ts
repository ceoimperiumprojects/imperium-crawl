import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the knowledge engine before importing
const mockRecord = vi.fn();
vi.mock("../src/knowledge/store.js", () => ({
  getKnowledgeEngine: () => ({ record: mockRecord }),
}));

import { recordBrowserOutcome } from "../src/knowledge/record-browser.js";

describe("recordBrowserOutcome()", () => {
  beforeEach(() => {
    mockRecord.mockReset();
  });

  it("records success with levelUsed=3 and blocked=false", () => {
    recordBrowserOutcome({
      url: "https://example.com/page",
      success: true,
      responseTimeMs: 1500,
      httpStatus: 200,
    });

    expect(mockRecord).toHaveBeenCalledOnce();
    const arg = mockRecord.mock.calls[0][0];
    expect(arg.levelUsed).toBe(3);
    expect(arg.success).toBe(true);
    expect(arg.blocked).toBe(false);
    expect(arg.domain).toBe("example.com");
    expect(arg.responseTimeMs).toBe(1500);
    expect(arg.httpStatus).toBe(200);
  });

  it("records failure with blocked=true", () => {
    recordBrowserOutcome({
      url: "https://blocked-site.org/denied",
      success: false,
      responseTimeMs: 3000,
      httpStatus: 403,
    });

    const arg = mockRecord.mock.calls[0][0];
    expect(arg.success).toBe(false);
    expect(arg.blocked).toBe(true);
    expect(arg.httpStatus).toBe(403);
    expect(arg.domain).toBe("blocked-site.org");
  });

  it("never throws even if engine.record() throws", () => {
    mockRecord.mockImplementation(() => {
      throw new Error("engine exploded");
    });

    expect(() => {
      recordBrowserOutcome({
        url: "https://example.com",
        success: true,
        responseTimeMs: 100,
      });
    }).not.toThrow();
  });

  it("defaults httpStatus to 200 when omitted", () => {
    recordBrowserOutcome({
      url: "https://example.com",
      success: true,
      responseTimeMs: 500,
    });

    expect(mockRecord.mock.calls[0][0].httpStatus).toBe(200);
  });

  it("maps captchaSolved=true to captchaType='detected'", () => {
    recordBrowserOutcome({
      url: "https://captcha-site.com",
      success: true,
      responseTimeMs: 5000,
      captchaSolved: true,
    });

    expect(mockRecord.mock.calls[0][0].captchaType).toBe("detected");
  });

  it("maps captchaSolved=false to captchaType=null", () => {
    recordBrowserOutcome({
      url: "https://no-captcha.com",
      success: true,
      responseTimeMs: 800,
      captchaSolved: false,
    });

    expect(mockRecord.mock.calls[0][0].captchaType).toBeNull();
  });

  it("passes proxyUsed flag correctly", () => {
    recordBrowserOutcome({
      url: "https://proxy-site.com",
      success: true,
      responseTimeMs: 2000,
      proxyUsed: true,
    });

    expect(mockRecord.mock.calls[0][0].proxyUsed).toBe(true);
  });

  it("defaults proxyUsed to false when omitted", () => {
    recordBrowserOutcome({
      url: "https://example.com",
      success: true,
      responseTimeMs: 300,
    });

    expect(mockRecord.mock.calls[0][0].proxyUsed).toBe(false);
  });

  it("passes antiBotSystem through", () => {
    recordBrowserOutcome({
      url: "https://cf-site.com",
      success: true,
      responseTimeMs: 2500,
      antiBotSystem: "cloudflare",
    });

    expect(mockRecord.mock.calls[0][0].antiBotSystem).toBe("cloudflare");
  });

  it("defaults antiBotSystem to null when omitted", () => {
    recordBrowserOutcome({
      url: "https://example.com",
      success: true,
      responseTimeMs: 100,
    });

    expect(mockRecord.mock.calls[0][0].antiBotSystem).toBeNull();
  });
});
