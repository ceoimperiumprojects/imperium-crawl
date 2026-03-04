/**
 * 2Captcha API client — pure HTTP, no npm dependency.
 *
 * API flow:
 * 1. Submit captcha → POST /in.php → get task ID
 * 2. Poll result   → GET /res.php?action=get&id=ID → get token
 *
 * Supports: reCAPTCHA v2/v3, hCaptcha, Cloudflare Turnstile
 */

import type { CaptchaInfo } from "./detector.js";

const API_BASE = "https://2captcha.com";
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_MAX_POLL_TIME_MS = 180_000; // 3 minutes max
const INITIAL_WAIT_MS = 15_000; // Wait before first poll (captchas take time)

export class CaptchaSolverError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "CaptchaSolverError";
  }
}

export interface SolveOptions {
  pollInterval?: number;    // ms between polls (default: 5000)
  maxPollTime?: number;     // max total wait time in ms (default: 180000)
  proxy?: string;           // proxy to use for solving (format: type:host:port:user:pass)
  userAgent?: string;       // user agent for the solving browser
}

export interface SolveResult {
  token: string;
  taskId: string;
  solveTimeMs: number;
}

/**
 * 2Captcha solver — submit + poll for solution.
 */
export class TwoCaptchaSolver {
  constructor(private apiKey: string) {}

  /**
   * Submit a CAPTCHA and wait for the solution.
   */
  async solve(
    captcha: CaptchaInfo,
    pageUrl: string,
    options?: SolveOptions,
  ): Promise<SolveResult> {
    const startTime = Date.now();
    const taskId = await this.submit(captcha, pageUrl, options);
    const token = await this.poll(taskId, options);
    return {
      token,
      taskId,
      solveTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Submit captcha to 2Captcha.
   */
  private async submit(
    captcha: CaptchaInfo,
    pageUrl: string,
    options?: SolveOptions,
  ): Promise<string> {
    const params = new URLSearchParams({
      key: this.apiKey,
      pageurl: pageUrl,
      json: "1",
    });

    switch (captcha.type) {
      case "recaptcha_v2":
        params.set("method", "userrecaptcha");
        params.set("googlekey", captcha.sitekey);
        if (captcha.enterprise) params.set("enterprise", "1");
        if (captcha.s) params.set("data-s", captcha.s);
        break;

      case "recaptcha_v3":
        params.set("method", "userrecaptcha");
        params.set("version", "v3");
        params.set("googlekey", captcha.sitekey);
        params.set("action", captcha.action || "verify");
        params.set("min_score", "0.5");
        if (captcha.enterprise) params.set("enterprise", "1");
        break;

      case "hcaptcha":
        params.set("method", "hcaptcha");
        params.set("sitekey", captcha.sitekey);
        break;

      case "turnstile":
        params.set("method", "turnstile");
        params.set("sitekey", captcha.sitekey);
        break;
    }

    // Optional proxy and user agent
    if (options?.proxy) params.set("proxy", options.proxy);
    if (options?.userAgent) params.set("userAgent", options.userAgent);

    const response = await fetch(`${API_BASE}/in.php`, {
      method: "POST",
      body: params,
      signal: AbortSignal.timeout(30_000),
    });

    const data = (await response.json()) as { status: number; request: string };

    if (data.status !== 1) {
      throw new CaptchaSolverError(
        `2Captcha submit failed: ${data.request}`,
        data.request,
      );
    }

    return data.request; // This is the task ID
  }

  /**
   * Poll for CAPTCHA solution.
   */
  private async poll(taskId: string, options?: SolveOptions): Promise<string> {
    const pollInterval = options?.pollInterval || DEFAULT_POLL_INTERVAL_MS;
    const maxPollTime = options?.maxPollTime || DEFAULT_MAX_POLL_TIME_MS;
    const startTime = Date.now();

    // Initial wait — CAPTCHAs need time to be solved by humans
    await sleep(INITIAL_WAIT_MS);

    while (Date.now() - startTime < maxPollTime) {
      const remainingBudget = maxPollTime - (Date.now() - startTime);
      if (remainingBudget <= 0) break;

      const params = new URLSearchParams({
        key: this.apiKey,
        action: "get",
        id: taskId,
        json: "1",
      });

      const response = await fetch(`${API_BASE}/res.php?${params.toString()}`, {
        signal: AbortSignal.timeout(Math.min(15_000, remainingBudget)),
      });

      const data = (await response.json()) as { status: number; request: string };

      if (data.status === 1) {
        return data.request; // Solved! This is the token
      }

      if (data.request === "CAPCHA_NOT_READY") {
        // Still solving, wait and retry
        await sleep(pollInterval);
        continue;
      }

      // Actual error
      throw new CaptchaSolverError(
        `2Captcha solve failed: ${data.request}`,
        data.request,
      );
    }

    throw new CaptchaSolverError(
      `2Captcha timeout: no solution after ${maxPollTime / 1000}s`,
      "TIMEOUT",
    );
  }

  /**
   * Check 2Captcha account balance.
   */
  async getBalance(): Promise<number> {
    const params = new URLSearchParams({
      key: this.apiKey,
      action: "getbalance",
      json: "1",
    });

    const response = await fetch(`${API_BASE}/res.php?${params.toString()}`, {
      signal: AbortSignal.timeout(10_000),
    });

    const data = (await response.json()) as { status: number; request: string };

    if (data.status !== 1) {
      throw new CaptchaSolverError(`Balance check failed: ${data.request}`, data.request);
    }

    return parseFloat(data.request);
  }

  /**
   * Report a bad solution (for refund).
   */
  async reportBad(taskId: string): Promise<void> {
    const params = new URLSearchParams({
      key: this.apiKey,
      action: "reportbad",
      id: taskId,
      json: "1",
    });

    await fetch(`${API_BASE}/res.php?${params.toString()}`, {
      signal: AbortSignal.timeout(10_000),
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
