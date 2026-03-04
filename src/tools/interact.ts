import { z } from "zod";
import { isPlaywrightAvailable } from "../stealth/browser.js";
import { acquirePage } from "../stealth/chrome-profile.js";
import { resolveProxy } from "../stealth/proxy.js";
import { normalizeUrl } from "../utils/url.js";
import { htmlToMarkdown } from "../utils/markdown.js";
import { getSessionManager } from "../sessions/index.js";
import type { StoredCookie } from "../sessions/index.js";
import {
  MAX_URL_LENGTH,
  MAX_TIMEOUT_MS,
  HUMAN_DELAY_MIN_MS,
  HUMAN_DELAY_MAX_MS,
} from "../constants.js";

export const name = "interact";

export const description =
  "Open a browser, execute a sequence of actions (click, type, scroll, screenshot, evaluate JS, etc.) and optionally persist browser sessions (cookies) between calls. Enables multi-step web automation: login flows, form fills, paginated scraping.";

const actionSchema = z.object({
  type: z.enum([
    "click",
    "type",
    "scroll",
    "wait",
    "screenshot",
    "evaluate",
    "select",
    "hover",
    "press",
    "navigate",
  ]),
  selector: z.string().max(500).optional().describe("CSS selector (for click, type, hover, select, press, wait)"),
  text: z.string().max(10000).optional().describe("Text to type (for type action)"),
  value: z.string().max(1000).optional().describe("Option value to select (for select action)"),
  script: z.string().max(50000).optional().describe("JS to evaluate in page context (for evaluate action)"),
  key: z.string().max(100).optional().describe("Key to press, e.g. Enter, Tab, Escape (for press action)"),
  url: z.string().max(MAX_URL_LENGTH).optional().describe("URL to navigate to (for navigate action)"),
  duration: z.number().min(0).max(30000).optional().describe("Wait duration in ms (for wait action without selector)"),
  x: z.number().optional().describe("Horizontal scroll delta in px (for scroll, default 0)"),
  y: z.number().optional().describe("Vertical scroll delta in px (for scroll, default 500)"),
});

export const schema = z.object({
  url: z.string().max(MAX_URL_LENGTH).describe("Starting URL to navigate to"),
  actions: z
    .array(actionSchema)
    .max(50)
    .describe("Sequence of actions to execute in order"),
  return_content: z
    .boolean()
    .default(true)
    .describe("Return final page content as markdown (default: true)"),
  return_screenshot: z
    .boolean()
    .default(false)
    .describe("Return a screenshot of the final page state as base64"),
  session_id: z
    .string()
    .max(200)
    .optional()
    .describe("Session ID to restore cookies from (and save to after actions)"),
  timeout: z
    .number()
    .min(1000)
    .max(MAX_TIMEOUT_MS)
    .default(30000)
    .describe("Navigation timeout in ms (default: 30000)"),
  proxy: z
    .string()
    .max(MAX_URL_LENGTH)
    .optional()
    .describe("Proxy URL. Overrides PROXY_URL env var."),
  chrome_profile: z
    .string()
    .max(1000)
    .optional()
    .describe("Path to Chrome user data directory for authenticated sessions. Overrides CHROME_PROFILE_PATH env var."),
});

export type InteractInput = z.infer<typeof schema>;

type ActionInput = z.infer<typeof actionSchema>;

interface ActionResult {
  type: string;
  success: boolean;
  error?: string;
  result?: unknown;
}

function humanDelay(): number {
  return (
    HUMAN_DELAY_MIN_MS +
    Math.floor(Math.random() * (HUMAN_DELAY_MAX_MS - HUMAN_DELAY_MIN_MS))
  );
}

async function executeAction(
  page: import("rebrowser-playwright").Page,
  action: ActionInput,
  screenshots: string[],
  timeout: number,
): Promise<ActionResult> {
  try {
    switch (action.type) {
      case "click": {
        if (!action.selector) return { type: "click", success: false, error: "selector required" };
        await page.click(action.selector, { timeout });
        // Wait for potential navigation/re-render — ignore if none happens
        await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
        return { type: "click", success: true };
      }

      case "type": {
        if (!action.selector) return { type: "type", success: false, error: "selector required" };
        if (action.text === undefined) return { type: "type", success: false, error: "text required" };
        await page.fill(action.selector, action.text, { timeout });
        return { type: "type", success: true };
      }

      case "scroll": {
        const x = action.x ?? 0;
        const y = action.y ?? 500;
        await page.evaluate(({ dx, dy }) => window.scrollBy(dx, dy), { dx: x, dy: y });
        return { type: "scroll", success: true };
      }

      case "wait": {
        if (action.selector) {
          await page.waitForSelector(action.selector, { timeout });
        } else {
          await page.waitForTimeout(action.duration ?? 1000);
        }
        return { type: "wait", success: true };
      }

      case "screenshot": {
        const buf = await page.screenshot({ fullPage: false });
        screenshots.push(buf.toString("base64"));
        return { type: "screenshot", success: true };
      }

      case "evaluate": {
        if (!action.script) return { type: "evaluate", success: false, error: "script required" };
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        const result = await page.evaluate(new Function(action.script) as () => unknown);
        return { type: "evaluate", success: true, result };
      }

      case "select": {
        if (!action.selector) return { type: "select", success: false, error: "selector required" };
        if (action.value === undefined) return { type: "select", success: false, error: "value required" };
        await page.selectOption(action.selector, action.value, { timeout });
        return { type: "select", success: true };
      }

      case "hover": {
        if (!action.selector) return { type: "hover", success: false, error: "selector required" };
        await page.hover(action.selector, { timeout });
        return { type: "hover", success: true };
      }

      case "press": {
        if (!action.key) return { type: "press", success: false, error: "key required" };
        if (action.selector) {
          await page.press(action.selector, action.key, { timeout });
        } else {
          await page.keyboard.press(action.key);
        }
        return { type: "press", success: true };
      }

      case "navigate": {
        if (!action.url) return { type: "navigate", success: false, error: "url required" };
        await page.goto(action.url, { waitUntil: "load", timeout });
        return { type: "navigate", success: true };
      }

      default:
        return { type: (action as ActionInput).type, success: false, error: "unknown action type" };
    }
  } catch (err: unknown) {
    return {
      type: action.type,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function execute(input: InteractInput) {
  if (!(await isPlaywrightAvailable())) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              error:
                "rebrowser-playwright is required for the interact tool. Install with: npm i rebrowser-playwright",
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  const url = normalizeUrl(input.url);
  const proxyUrl = resolveProxy(input.proxy);
  const handle = await acquirePage({
    chromeProfile: input.chrome_profile,
    proxyUrl,
  });

  try {
    const { page } = handle;

    // ── Restore session cookies ──
    if (input.session_id) {
      const session = await getSessionManager().load(input.session_id);
      if (session?.cookies.length) {
        await page.context().addCookies(session.cookies);
      }
    }

    // ── Initial navigation ──
    await page.goto(url, { waitUntil: "load", timeout: input.timeout });

    // ── Execute actions ──
    const actionResults: ActionResult[] = [];
    const midScreenshots: string[] = [];

    for (const action of input.actions) {
      // Human-like delay between actions
      await page.waitForTimeout(humanDelay());
      const result = await executeAction(page, action, midScreenshots, input.timeout);
      actionResults.push(result);
    }

    // ── Save session ──
    let sessionSaved = false;
    if (input.session_id) {
      try {
        const cookies = await page.context().cookies();
        const stored: StoredCookie[] = cookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          expires: c.expires,
          httpOnly: c.httpOnly,
          secure: c.secure,
          sameSite: c.sameSite as StoredCookie["sameSite"],
        }));
        await getSessionManager().save(input.session_id, stored, page.url());
        sessionSaved = true;
      } catch (err: unknown) {
        console.error(
          "[interact] Failed to save session:",
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    // ── Collect results ──
    const finalUrl = page.url();
    let sessionWarning: string | undefined;
    if (input.session_id && !sessionSaved) {
      sessionWarning = "Warning: Session cookies could not be saved. Session state may be lost on next call.";
    }

    const output: Record<string, unknown> = {
      url: finalUrl,
      actions_executed: actionResults.length,
      session_saved: sessionSaved,
      ...(sessionWarning && { session_warning: sessionWarning }),
      action_results: actionResults,
      screenshots: midScreenshots,
    };

    if (input.return_content) {
      const html = await page.content();
      output.content = htmlToMarkdown(html);
    }

    const content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> = [
      { type: "text", text: JSON.stringify(output, null, 2) },
    ];

    if (input.return_screenshot) {
      const buf = await page.screenshot({ fullPage: false });
      content.push({
        type: "image",
        data: buf.toString("base64"),
        mimeType: "image/png",
      });
    }

    return { content };
  } finally {
    await handle.cleanup();
  }
}
