import { describe, it, expect, vi, beforeEach } from "vitest";
import { TwoCaptchaSolver, CaptchaSolverError } from "../src/captcha/solver.js";
import type { CaptchaInfo } from "../src/captcha/detector.js";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("TwoCaptchaSolver", () => {
  let solver: TwoCaptchaSolver;

  beforeEach(() => {
    vi.clearAllMocks();
    solver = new TwoCaptchaSolver("test-api-key");
  });

  describe("getBalance", () => {
    it("returns balance on success", async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ status: 1, request: "12.345" }),
      });

      const balance = await solver.getBalance();
      expect(balance).toBe(12.345);
    });

    it("throws on failure", async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ status: 0, request: "ERROR_WRONG_USER_KEY" }),
      });

      await expect(solver.getBalance()).rejects.toThrow(CaptchaSolverError);
    });
  });

  describe("solve", () => {
    const recaptchaV2: CaptchaInfo = {
      type: "recaptcha_v2",
      sitekey: "6Le-wvkSAAAAAPBMRTvw0Q4Muexq9bi0DJwx_mJ-",
    };

    it("submits and polls for solution", async () => {
      // Submit response
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ status: 1, request: "TASK123" }),
      });
      // Poll response — solved
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ status: 1, request: "solved-token-abc" }),
      });

      const result = await solver.solve(recaptchaV2, "https://example.com", {
        pollInterval: 10,
        maxPollTime: 100_000,
      });

      expect(result.token).toBe("solved-token-abc");
      expect(result.taskId).toBe("TASK123");
      expect(result.solveTimeMs).toBeGreaterThanOrEqual(0);
    });

    it("handles CAPCHA_NOT_READY then success", async () => {
      // Submit
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ status: 1, request: "TASK456" }),
      });
      // First poll — not ready
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ status: 0, request: "CAPCHA_NOT_READY" }),
      });
      // Second poll — ready
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ status: 1, request: "token-xyz" }),
      });

      const result = await solver.solve(recaptchaV2, "https://example.com", {
        pollInterval: 10,
        maxPollTime: 100_000,
      });

      expect(result.token).toBe("token-xyz");
    });

    it("throws CaptchaSolverError on submit failure", async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ status: 0, request: "ERROR_ZERO_BALANCE" }),
      });

      await expect(
        solver.solve(recaptchaV2, "https://example.com"),
      ).rejects.toThrow(CaptchaSolverError);
    });

    it("throws on poll error (not CAPCHA_NOT_READY)", async () => {
      // Submit success
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ status: 1, request: "TASK789" }),
      });
      // Poll error
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ status: 0, request: "ERROR_CAPTCHA_UNSOLVABLE" }),
      });

      await expect(
        solver.solve(recaptchaV2, "https://example.com", {
          pollInterval: 10,
          maxPollTime: 100_000,
        }),
      ).rejects.toThrow(/ERROR_CAPTCHA_UNSOLVABLE/);
    });
  });

  describe("reportBad", () => {
    it("sends report request", async () => {
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ status: 1, request: "OK_REPORT_RECORDED" }),
      });

      await expect(solver.reportBad("TASK123")).resolves.not.toThrow();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("CaptchaSolverError", () => {
    it("has name and code properties", () => {
      const err = new CaptchaSolverError("test error", "ERROR_CODE");
      expect(err.name).toBe("CaptchaSolverError");
      expect(err.code).toBe("ERROR_CODE");
      expect(err.message).toBe("test error");
    });

    it("works without code", () => {
      const err = new CaptchaSolverError("just a message");
      expect(err.code).toBeUndefined();
    });
  });
});
