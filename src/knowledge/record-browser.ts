import { getKnowledgeEngine } from "./store.js";
import { getDomain } from "../utils/url.js";
import type { StealthLevel } from "../stealth/index.js";

/**
 * Record a browser navigation outcome to the adaptive learning engine.
 * Used by tools that call acquirePage() directly (screenshot, interact,
 * snapshot, discover-apis, download/TikTok) — bypassing smartFetch().
 *
 * Fire-and-forget: never throws, never blocks.
 */
export function recordBrowserOutcome(opts: {
  url: string;
  success: boolean;
  responseTimeMs: number;
  httpStatus?: number;
  antiBotSystem?: string | null;
  captchaSolved?: boolean;
  proxyUsed?: boolean;
}): void {
  try {
    getKnowledgeEngine().record({
      url: opts.url,
      domain: getDomain(opts.url),
      levelUsed: 3 as StealthLevel, // browser tools = always Level 3
      success: opts.success,
      responseTimeMs: opts.responseTimeMs,
      antiBotSystem: opts.antiBotSystem ?? null,
      captchaType: opts.captchaSolved ? "detected" : null,
      proxyUsed: opts.proxyUsed ?? false,
      blocked: !opts.success,
      httpStatus: opts.httpStatus ?? 200,
    });
  } catch {
    // Fire-and-forget: never throws, never blocks
  }
}
