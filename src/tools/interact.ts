import { z } from "zod";
import { isPlaywrightAvailable } from "../stealth/browser.js";
import { acquirePage } from "../stealth/chrome-profile.js";
import { resolveProxy } from "../stealth/proxy.js";
import { normalizeUrl } from "../utils/url.js";
import { htmlToMarkdown } from "../utils/markdown.js";
import { recordBrowserOutcome } from "../knowledge/index.js";
import { getSessionManager } from "../sessions/index.js";
import type { StoredCookie } from "../sessions/index.js";
import {
  MAX_URL_LENGTH,
  MAX_TIMEOUT_MS,
} from "../core/constants.js";
import { getSnapshotStore, getEnhancedSnapshot } from "../snapshot/index.js";
import { checkPolicy } from "../security/index.js";
import { installDomainFilter } from "../security/index.js";
import { setupInterception, getRequestLog } from "../network/index.js";
import type { InterceptRule } from "../network/index.js";
import { executeAction, humanDelay } from "../core/action-executor.js";
import type { ActionResult } from "../core/action-executor.js";

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
    "drag",
    "upload",
    "storage_get",
    "storage_set",
    "cookie_get",
    "cookie_set",
    "pdf",
    "auth_login",
    "paginate",
    "refresh",
    "auto_click",
  ]),
  selector: z.string().max(500).optional().describe("CSS selector (for click, type, hover, select, press, wait). Mutually exclusive with ref."),
  ref: z.string().regex(/^@?e\d+$/).optional().describe("Ref from snapshot (e.g. 'e5' or '@e5'). Resolves to semantic locator. Mutually exclusive with selector."),
  text: z.string().max(10000).optional().describe("Text to type (for type action)"),
  value: z.string().max(1000).optional().describe("Option value to select (for select action)"),
  script: z.string().max(50000).optional().describe("JS to evaluate in page context (for evaluate action)"),
  key: z.string().max(100).optional().describe("Key to press, e.g. Enter, Tab, Escape (for press action)"),
  url: z.string().max(MAX_URL_LENGTH).optional().describe("URL to navigate to (for navigate action)"),
  duration: z.number().min(0).max(30000).optional().describe("Wait duration in ms (for wait action without selector)"),
  x: z.number().optional().describe("Horizontal scroll delta in px (for scroll, default 0)"),
  y: z.number().optional().describe("Vertical scroll delta in px (for scroll, default 500)"),
  target_selector: z.string().max(500).optional().describe("Target CSS selector for drag action"),
  target_ref: z.string().regex(/^@?e\d+$/).optional().describe("Target ref for drag action"),
  file_paths: z.array(z.string().max(1000)).max(10).optional().describe("File paths to upload (for upload action)"),
  storage: z.enum(["local", "session"]).optional().describe("Storage type (for storage_get/storage_set)"),
  auth_profile: z.string().max(200).optional().describe("Auth vault profile name (for auth_login action)"),
  next_selector: z.string().max(500).optional().describe("CSS selector or ref for the Next Page button (for paginate action)"),
  next_ref: z.string().regex(/^@?e\d+$/).optional().describe("Ref for the Next Page button (for paginate action)"),
  extract_script: z.string().max(50000).optional().describe("JS to evaluate on each page during pagination. Should return JSON string of extracted data."),
  max_pages: z.number().min(1).max(100).default(10).optional().describe("Maximum pages to paginate through (default 10)"),
  wait_after_click: z.number().min(0).max(30000).default(2000).optional().describe("Ms to wait after clicking Next before extracting (default 2000)"),
  keywords: z.array(z.string().max(100)).max(50).optional().describe("Custom keywords for auto_click action (default: common gallery/more button phrases)"),
  max_clicks: z.number().min(1).max(50).default(5).optional().describe("Maximum auto-click rounds (default 5)"),
  cookies: z.array(z.object({
    name: z.string(),
    value: z.string(),
    domain: z.string().optional(),
    path: z.string().optional(),
    expires: z.number().optional(),
    httpOnly: z.boolean().optional(),
    secure: z.boolean().optional(),
    sameSite: z.enum(["Strict", "Lax", "None"]).optional(),
  })).max(50).optional().describe("Cookies to set (for cookie_set action)"),
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
  return_snapshot: z
    .boolean()
    .default(false)
    .describe("Take a fresh ARIA snapshot after all actions and include in output. Useful for verifying results."),
  action_policy_path: z
    .string()
    .max(1000)
    .optional()
    .describe("Path to action policy JSON file. Controls which action categories are allowed/denied/need confirmation."),
  allowed_domains: z
    .array(z.string().max(500))
    .max(100)
    .optional()
    .describe("Domain whitelist. Blocks requests to non-allowed domains. Supports wildcards (e.g. '*.example.com')."),
  intercept_rules: z
    .array(z.object({
      url_pattern: z.string().max(500),
      action: z.enum(["block", "mock", "modify", "log"]),
      response: z.object({
        status: z.number().optional(),
        body: z.string().max(100_000).optional(),
        headers: z.record(z.string()).optional(),
        contentType: z.string().optional(),
      }).optional(),
    }))
    .max(50)
    .optional()
    .describe("Network interception rules. Block, mock, modify, or log requests matching URL patterns."),
  return_network_log: z
    .boolean()
    .default(false)
    .describe("Include captured network request log in output"),
  retry_on_stale: z
    .boolean()
    .default(false)
    .describe("When an action fails with a recoverable error (timeout, element not found, detached), auto-navigate back to the starting URL and retry the action (max 2 retries). Useful for long-running batch sessions where pages go stale."),
  device: z
    .string()
    .max(100)
    .optional()
    .describe("Device name for emulation (e.g. 'iPhone 14', 'Pixel 5'). Uses Playwright's device descriptors."),
  geolocation: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
    })
    .optional()
    .describe("Geolocation override"),
  max_actions_before_refresh: z
    .number()
    .min(1)
    .max(500)
    .optional()
    .describe("Auto-refresh the page (reload without killing session) after this many actions. Resets the action counter. Useful for long-running sessions that accumulate DOM mutations."),
});

export type InteractInput = z.infer<typeof schema>;

/** Patterns that indicate an action failed due to a stale/broken page state, not a logic error */
const RECOVERABLE_ERROR_PATTERNS = [
  "timeout",
  "Timeout",
  "element not found",
  "element is detached",
  "Element is not attached",
  "waiting for selector",
  "Target closed",
  "Navigation failed",
  "frame was detached",
  "Execution context was destroyed",
];

const MAX_STALE_RETRIES = 2;

function isRecoverableError(error: string | undefined): boolean {
  if (!error) return false;
  return RECOVERABLE_ERROR_PATTERNS.some((p) => error.includes(p));
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
  const fetchStart = Date.now();
  const handle = await acquirePage({
    chromeProfile: input.chrome_profile,
    proxyUrl,
  });

  try {
    const { page } = handle;

    // ── Install domain filter ──
    if (input.allowed_domains?.length) {
      await installDomainFilter(page.context(), input.allowed_domains);
    }

    // ── Set up network interception ──
    if (input.intercept_rules?.length) {
      await setupInterception(page, input.intercept_rules as InterceptRule[]);
    }

    // ── Device emulation ──
    if (input.device || input.geolocation) {
      try {
        if (input.device) {
          const { devices } = await import("rebrowser-playwright");
          const descriptor = devices[input.device];
          if (descriptor) {
            await page.setViewportSize(descriptor.viewport);
            // User agent is set at context level — emit note
          }
        }
        if (input.geolocation) {
          await page.context().grantPermissions(["geolocation"]);
          await page.context().setGeolocation(input.geolocation);
        }
      } catch {
        // Non-critical — continue without emulation
      }
    }

    // ── Restore session cookies ──
    if (input.session_id) {
      const session = await getSessionManager().load(input.session_id);
      if (session?.cookies.length) {
        await page.context().addCookies(session.cookies);
      }
    }

    // ── Initial navigation ──
    await page.goto(url, { waitUntil: "load", timeout: input.timeout });
    recordBrowserOutcome({ url, success: true, responseTimeMs: Date.now() - fetchStart, proxyUsed: !!proxyUrl });

    // ── Execute actions ──
    const actionResults: ActionResult[] = [];
    const midScreenshots: string[] = [];
    let actionCount = 0;

    for (const action of input.actions) {
      // Auto-refresh if action count exceeds threshold
      if (input.max_actions_before_refresh && input.session_id && actionCount > 0 && actionCount % input.max_actions_before_refresh === 0) {
        await page.reload({ waitUntil: "load", timeout: input.timeout });
        await getSessionManager().resetActionCount(input.session_id);
        actionResults.push({ type: "refresh", success: true, result: `Auto-refreshed after ${actionCount} actions` });
      }

      // Check action policy if configured
      if (input.action_policy_path) {
        const decision = await checkPolicy(action.type, input.action_policy_path);
        if (decision === "deny") {
          actionResults.push({ type: action.type, success: false, error: `Action '${action.type}' denied by policy` });
          continue;
        }
        // "confirm" is treated as "allow" (no interactive prompt available)
      }

      // Human-like delay between actions
      await page.waitForTimeout(humanDelay());
      let result = await executeAction(page, action, midScreenshots, input.timeout, input.session_id);

      // Retry on stale page errors: navigate back to start URL and retry
      if (!result.success && input.retry_on_stale && isRecoverableError(result.error)) {
        for (let retry = 1; retry <= MAX_STALE_RETRIES; retry++) {
          try {
            await page.goto(url, { waitUntil: "load", timeout: input.timeout });
            if (input.session_id) {
              await getSessionManager().resetActionCount(input.session_id);
            }
            await page.waitForTimeout(humanDelay());
            result = await executeAction(page, action, midScreenshots, input.timeout, input.session_id);
            if (result.success) {
              result.result = `recovered after ${retry} retry${retry > 1 ? "s" : ""}: ${result.result ?? "ok"}`;
              break;
            }
          } catch {
            // Recovery navigation itself failed — stop retrying
            break;
          }
        }
      }

      actionResults.push(result);
      actionCount++;

      // Track action count in session
      if (input.session_id && action.type !== "refresh") {
        await getSessionManager().incrementActions(input.session_id);
      } else if (input.session_id && action.type === "refresh") {
        await getSessionManager().resetActionCount(input.session_id);
      }
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

    // Network log
    if (input.return_network_log) {
      output.network_log = getRequestLog(page);
    }

    // Post-action snapshot
    if (input.return_snapshot && input.session_id) {
      try {
        const snapshot = await getEnhancedSnapshot(page, { interactive: true, compact: true });
        getSnapshotStore().save(input.session_id, snapshot.refs, page.url());
        output.snapshot = {
          tree: snapshot.tree,
          stats: {
            ...snapshot.stats,
            refCount: Object.keys(snapshot.refs).length,
          },
        };
      } catch {
        output.snapshot_error = "Failed to generate post-action snapshot";
      }
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
