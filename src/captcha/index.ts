/**
 * CAPTCHA orchestrator: detect → solve via 2Captcha → inject into Playwright page.
 *
 * This is the high-level module that ties detection, solving, and injection together.
 * Used by the stealth engine's browser-level fetch to auto-solve CAPTCHAs.
 */

import { detectCaptcha, hasCaptcha, type CaptchaInfo } from "./detector.js";
import { TwoCaptchaSolver, type SolveResult, CaptchaSolverError } from "./solver.js";

export { detectCaptcha, hasCaptcha, type CaptchaInfo } from "./detector.js";
export { TwoCaptchaSolver, CaptchaSolverError, type SolveResult } from "./solver.js";

// Playwright Page type — using `any` to avoid hard dependency on playwright types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlaywrightPage = any;

export interface CaptchaSolveAttempt {
  detected: boolean;
  solved: boolean;
  captchaType?: string;
  solveTimeMs?: number;
  error?: string;
}

/**
 * Attempt to detect and solve a CAPTCHA on a Playwright page.
 *
 * Flow:
 * 1. Get page HTML
 * 2. Detect CAPTCHA type + sitekey
 * 3. Submit to 2Captcha
 * 4. Poll for solution
 * 5. Inject token into page
 * 6. Wait for page to process the token
 *
 * Returns details about the attempt. Non-throwing — errors are captured in result.
 */
export async function trySolveCaptcha(
  page: PlaywrightPage,
  apiKey: string,
): Promise<CaptchaSolveAttempt> {
  try {
    const html: string = await page.content();

    // Quick pre-check
    if (!hasCaptcha(html)) {
      return { detected: false, solved: false };
    }

    // Full detection
    const captcha = detectCaptcha(html);
    if (!captcha) {
      return { detected: false, solved: false };
    }

    const pageUrl: string = page.url();
    const solver = new TwoCaptchaSolver(apiKey);

    // Solve
    let result: SolveResult;
    try {
      result = await solver.solve(captcha, pageUrl);
    } catch (err) {
      return {
        detected: true,
        solved: false,
        captchaType: captcha.type,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // Inject token into page
    const injected = await injectToken(page, captcha, result.token);

    if (!injected) {
      // Report bad solve if injection failed
      try {
        await solver.reportBad(result.taskId);
      } catch {
        // Best-effort report
      }
      return {
        detected: true,
        solved: false,
        captchaType: captcha.type,
        solveTimeMs: result.solveTimeMs,
        error: "Token injection failed",
      };
    }

    // Wait for page to process the token (form submit, redirect, etc.)
    try {
      await page.waitForNavigation({ timeout: 15_000, waitUntil: "networkidle" }).catch(() => {
        // Some pages don't navigate — they just update the DOM
      });
      // Extra wait for any AJAX processing
      await page.waitForTimeout(2000);
    } catch {
      // Navigation timeout is OK — page might not redirect
    }

    return {
      detected: true,
      solved: true,
      captchaType: captcha.type,
      solveTimeMs: result.solveTimeMs,
    };
  } catch (err) {
    return {
      detected: true,
      solved: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Inject a solved CAPTCHA token into the page.
 * Strategy varies by CAPTCHA type.
 */
async function injectToken(
  page: PlaywrightPage,
  captcha: CaptchaInfo,
  token: string,
): Promise<boolean> {
  switch (captcha.type) {
    case "recaptcha_v2":
    case "recaptcha_v3":
      return injectRecaptchaToken(page, token);
    case "hcaptcha":
      return injectHcaptchaToken(page, token);
    case "turnstile":
      return injectTurnstileToken(page, token);
    default:
      return false;
  }
}

/**
 * Inject reCAPTCHA token:
 * 1. Set g-recaptcha-response textarea value
 * 2. Find and call the callback function
 */
async function injectRecaptchaToken(page: PlaywrightPage, token: string): Promise<boolean> {
  return page.evaluate((tok: string) => {
    // Set token in textarea
    const textarea = document.querySelector("#g-recaptcha-response") as HTMLTextAreaElement
      || document.querySelector('[name="g-recaptcha-response"]') as HTMLTextAreaElement;

    if (textarea) {
      textarea.value = tok;
      textarea.style.display = "block"; // Make visible briefly for events
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
    }

    // Also set in all recaptcha response textareas (multiple instances)
    document.querySelectorAll("textarea.g-recaptcha-response").forEach((el) => {
      (el as HTMLTextAreaElement).value = tok;
    });

    // Try to find and call the callback
    // Method 1: ___grecaptcha_cfg callback
    try {
      const cfg = (window as any).___grecaptcha_cfg;
      if (cfg?.clients) {
        for (const clientKey of Object.keys(cfg.clients)) {
          const client = cfg.clients[clientKey];
          // Walk the client object to find callback functions
          const findCallback = (obj: any, depth: number): boolean => {
            if (depth > 5 || !obj) return false;
            for (const key of Object.keys(obj)) {
              if (typeof obj[key] === "function" && key.length < 3) {
                try { obj[key](tok); return true; } catch { /* next */ }
              }
              if (typeof obj[key] === "object" && findCallback(obj[key], depth + 1)) return true;
            }
            return false;
          };
          findCallback(client, 0);
        }
      }
    } catch { /* no cfg */ }

    // Method 2: Direct callback attribute
    try {
      const recaptchaEl = document.querySelector(".g-recaptcha");
      const callbackName = recaptchaEl?.getAttribute("data-callback");
      if (callbackName && typeof (window as any)[callbackName] === "function") {
        (window as any)[callbackName](tok);
      }
    } catch { /* no callback */ }

    // Method 3: grecaptcha.getResponse override
    try {
      if ((window as any).grecaptcha) {
        const original = (window as any).grecaptcha;
        original.getResponse = () => tok;
      }
    } catch { /* no grecaptcha */ }

    // Try submitting the form
    const form = textarea?.closest("form") || document.querySelector("form");
    if (form) {
      try {
        if (form.requestSubmit) { form.requestSubmit(); } else { form.submit(); }
      } catch { /* form submit failed */ }
    }

    return !!textarea;
  }, token);
}

/**
 * Inject hCaptcha token:
 * Similar to reCAPTCHA but uses h-captcha-response.
 */
async function injectHcaptchaToken(page: PlaywrightPage, token: string): Promise<boolean> {
  return page.evaluate((tok: string) => {
    // Set token
    const textarea = document.querySelector('[name="h-captcha-response"]') as HTMLTextAreaElement
      || document.querySelector("textarea.h-captcha-response") as HTMLTextAreaElement;

    if (textarea) {
      textarea.value = tok;
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
    }

    // Also try the iframe-based response
    document.querySelectorAll("iframe[data-hcaptcha-response]").forEach((el) => {
      el.setAttribute("data-hcaptcha-response", tok);
    });

    // Call hcaptcha callback
    try {
      const hcaptchaEl = document.querySelector(".h-captcha");
      const callbackName = hcaptchaEl?.getAttribute("data-callback");
      if (callbackName && typeof (window as any)[callbackName] === "function") {
        (window as any)[callbackName](tok);
      }
    } catch { /* no callback */ }

    // Try form submit
    const form = textarea?.closest("form") || document.querySelector("form");
    if (form) {
      try {
        if (form.requestSubmit) { form.requestSubmit(); } else { form.submit(); }
      } catch { /* form submit failed */ }
    }

    return !!textarea;
  }, token);
}

/**
 * Inject Cloudflare Turnstile token:
 * Uses cf-turnstile-response input and triggers Turnstile callback.
 */
async function injectTurnstileToken(page: PlaywrightPage, token: string): Promise<boolean> {
  return page.evaluate((tok: string) => {
    // Set token in hidden input
    const input = document.querySelector('[name="cf-turnstile-response"]') as HTMLInputElement
      || document.querySelector("input.cf-turnstile-response") as HTMLInputElement;

    if (input) {
      input.value = tok;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }

    // Try Turnstile callback
    try {
      const turnstileEl = document.querySelector(".cf-turnstile");
      const callbackName = turnstileEl?.getAttribute("data-callback");
      if (callbackName && typeof (window as any)[callbackName] === "function") {
        (window as any)[callbackName](tok);
      }
    } catch { /* no callback */ }

    // Try turnstile global
    try {
      if ((window as any).turnstile) {
        (window as any).turnstile.getResponse = () => tok;
      }
    } catch { /* no turnstile global */ }

    // Try form submit
    const form = input?.closest("form") || document.querySelector("form");
    if (form) {
      try {
        if (form.requestSubmit) { form.requestSubmit(); } else { form.submit(); }
      } catch { /* form submit failed */ }
    }

    return !!input;
  }, token);
}
