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
import { getSnapshotStore, getEnhancedSnapshot } from "../snapshot/index.js";
import type { RefEntry } from "../snapshot/index.js";
import { checkPolicy } from "../security/action-policy.js";
import { installDomainFilter } from "../security/domain-filter.js";
import { setupInterception, getRequestLog } from "../network/interceptor.js";
import type { InterceptRule } from "../network/types.js";
import { getAuthProfile, updateLastLogin } from "../security/auth-vault.js";

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

/**
 * Resolve a ref to a Playwright locator using semantic selectors.
 * Returns the locator from getByRole() — much more robust than CSS paths.
 */
function resolveRefToLocator(
  page: import("rebrowser-playwright").Page,
  refEntry: RefEntry,
): import("rebrowser-playwright").Locator {
  const locator = refEntry.name
    ? page.getByRole(refEntry.role as Parameters<typeof page.getByRole>[0], {
        name: refEntry.name,
        exact: true,
      })
    : page.getByRole(refEntry.role as Parameters<typeof page.getByRole>[0]);

  return refEntry.nth !== undefined ? locator.nth(refEntry.nth) : locator;
}

/**
 * Get the effective selector or locator for an action.
 * If ref is provided, resolve it. If selector, use CSS. Otherwise null.
 */
function getTargetSelector(
  action: ActionInput,
  sessionId: string | undefined,
): { selector?: string; refEntry?: RefEntry; error?: string } {
  if (action.ref && action.selector) {
    return { error: "ref and selector are mutually exclusive — provide one, not both" };
  }
  if (action.ref && sessionId) {
    const entry = getSnapshotStore().resolveRef(sessionId, action.ref);
    if (!entry) {
      return { error: `ref '${action.ref}' not found. Take a snapshot first to get valid refs.` };
    }
    return { refEntry: entry };
  }
  if (action.ref && !sessionId) {
    return { error: "ref requires session_id to resolve. Provide session_id or use selector instead." };
  }
  return { selector: action.selector };
}

/**
 * Build a CSS-like selector string from a ref entry for APIs
 * that require string selectors (e.g. dragAndDrop).
 */
function buildCssSelectorFromRef(refEntry: RefEntry): string {
  const roleMap: Record<string, string> = {
    button: "button",
    link: "a",
    textbox: "input",
    searchbox: "input[type=search]",
    checkbox: "input[type=checkbox]",
    radio: "input[type=radio]",
  };
  const tag = roleMap[refEntry.role] ?? `[role="${refEntry.role}"]`;
  return refEntry.name ? `${tag}:has-text("${refEntry.name.replace(/"/g, '\\"')}")` : tag;
}

async function executeAction(
  page: import("rebrowser-playwright").Page,
  action: ActionInput,
  screenshots: string[],
  timeout: number,
  sessionId?: string,
): Promise<ActionResult> {
  try {
    // Resolve ref or selector for actions that need a target
    const needsTarget = ["click", "type", "hover", "select", "press", "wait", "drag", "upload"].includes(action.type);
    let refEntry: RefEntry | undefined;
    let cssSelector: string | undefined;

    if (needsTarget && (action.ref || action.selector)) {
      const target = getTargetSelector(action, sessionId);
      if (target.error) return { type: action.type, success: false, error: target.error };
      refEntry = target.refEntry;
      cssSelector = target.selector;
    }

    switch (action.type) {
      case "click": {
        if (!refEntry && !cssSelector) return { type: "click", success: false, error: "selector or ref required" };
        if (refEntry) {
          await resolveRefToLocator(page, refEntry).click({ timeout });
        } else {
          await page.click(cssSelector!, { timeout });
        }
        await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
        return { type: "click", success: true };
      }

      case "type": {
        if (!refEntry && !cssSelector) return { type: "type", success: false, error: "selector or ref required" };
        if (action.text === undefined) return { type: "type", success: false, error: "text required" };
        if (refEntry) {
          await resolveRefToLocator(page, refEntry).fill(action.text, { timeout });
        } else {
          await page.fill(cssSelector!, action.text, { timeout });
        }
        return { type: "type", success: true };
      }

      case "scroll": {
        const x = action.x ?? 0;
        const y = action.y ?? 500;
        await page.evaluate(({ dx, dy }) => window.scrollBy(dx, dy), { dx: x, dy: y });
        return { type: "scroll", success: true };
      }

      case "wait": {
        if (refEntry) {
          await resolveRefToLocator(page, refEntry).waitFor({ timeout });
        } else if (cssSelector) {
          await page.waitForSelector(cssSelector, { timeout });
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
        if (!refEntry && !cssSelector) return { type: "select", success: false, error: "selector or ref required" };
        if (action.value === undefined) return { type: "select", success: false, error: "value required" };
        if (refEntry) {
          await resolveRefToLocator(page, refEntry).selectOption(action.value, { timeout });
        } else {
          await page.selectOption(cssSelector!, action.value, { timeout });
        }
        return { type: "select", success: true };
      }

      case "hover": {
        if (!refEntry && !cssSelector) return { type: "hover", success: false, error: "selector or ref required" };
        if (refEntry) {
          await resolveRefToLocator(page, refEntry).hover({ timeout });
        } else {
          await page.hover(cssSelector!, { timeout });
        }
        return { type: "hover", success: true };
      }

      case "press": {
        if (!action.key) return { type: "press", success: false, error: "key required" };
        if (refEntry) {
          await resolveRefToLocator(page, refEntry).press(action.key, { timeout });
        } else if (cssSelector) {
          await page.press(cssSelector, action.key, { timeout });
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

      case "drag": {
        if (!refEntry && !cssSelector) return { type: "drag", success: false, error: "selector or ref required for source" };
        if (!action.target_selector && !action.target_ref) return { type: "drag", success: false, error: "target_selector or target_ref required" };
        // Resolve source
        const sourceSelector = refEntry
          ? buildCssSelectorFromRef(refEntry)
          : cssSelector!;
        // Resolve target
        let targetSelector: string;
        if (action.target_ref && sessionId) {
          const targetEntry = getSnapshotStore().resolveRef(sessionId, action.target_ref);
          if (!targetEntry) return { type: "drag", success: false, error: `target ref '${action.target_ref}' not found` };
          targetSelector = buildCssSelectorFromRef(targetEntry);
        } else if (action.target_selector) {
          targetSelector = action.target_selector;
        } else {
          return { type: "drag", success: false, error: "target_selector or target_ref required" };
        }
        await page.dragAndDrop(sourceSelector, targetSelector, { timeout });
        return { type: "drag", success: true };
      }

      case "upload": {
        if (!refEntry && !cssSelector) return { type: "upload", success: false, error: "selector or ref required" };
        if (!action.file_paths?.length) return { type: "upload", success: false, error: "file_paths required" };
        if (refEntry) {
          await resolveRefToLocator(page, refEntry).setInputFiles(action.file_paths, { timeout });
        } else {
          await page.setInputFiles(cssSelector!, action.file_paths, { timeout });
        }
        return { type: "upload", success: true };
      }

      case "storage_get": {
        if (!action.storage) return { type: "storage_get", success: false, error: "storage type required (local or session)" };
        const storageObj = action.storage === "local" ? "localStorage" : "sessionStorage";
        const storageKey = action.key;
        const storageResult = await page.evaluate(({ obj, k }) => {
          const storage = obj === "localStorage" ? localStorage : sessionStorage;
          if (k) return storage.getItem(k);
          const all: Record<string, string | null> = {};
          for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (key) all[key] = storage.getItem(key);
          }
          return all;
        }, { obj: storageObj, k: storageKey });
        return { type: "storage_get", success: true, result: storageResult };
      }

      case "storage_set": {
        if (!action.storage) return { type: "storage_set", success: false, error: "storage type required" };
        if (!action.key) return { type: "storage_set", success: false, error: "key required" };
        if (action.value === undefined) return { type: "storage_set", success: false, error: "value required" };
        const storageTarget = action.storage === "local" ? "localStorage" : "sessionStorage";
        await page.evaluate(({ obj, k, v }) => {
          const storage = obj === "localStorage" ? localStorage : sessionStorage;
          storage.setItem(k, v);
        }, { obj: storageTarget, k: action.key, v: action.value });
        return { type: "storage_set", success: true };
      }

      case "cookie_get": {
        const allCookies = await page.context().cookies();
        let filtered = allCookies;
        if (action.key) {
          filtered = allCookies.filter((c) => c.name === action.key);
        }
        return { type: "cookie_get", success: true, result: filtered };
      }

      case "cookie_set": {
        if (!action.cookies?.length) return { type: "cookie_set", success: false, error: "cookies array required" };
        const url = page.url();
        const cookiesToSet = action.cookies.map((c) => ({
          ...c,
          url: c.domain ? undefined : url,
        }));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await page.context().addCookies(cookiesToSet as any);
        return { type: "cookie_set", success: true };
      }

      case "pdf": {
        const pdfBuf = await page.pdf();
        screenshots.push(pdfBuf.toString("base64"));
        return { type: "pdf", success: true, result: "PDF saved to screenshots array as base64" };
      }

      case "auth_login": {
        if (!action.auth_profile) return { type: "auth_login", success: false, error: "auth_profile name required" };
        const profile = await getAuthProfile(action.auth_profile);
        if (!profile) return { type: "auth_login", success: false, error: `Auth profile '${action.auth_profile}' not found` };

        // Navigate to login page if needed
        if (profile.url) {
          await page.goto(profile.url, { waitUntil: "load", timeout });
        }

        // Fill credentials
        await page.fill(profile.selectors.username, profile.username, { timeout });
        await page.waitForTimeout(humanDelay());
        await page.fill(profile.selectors.password, profile.password, { timeout });
        await page.waitForTimeout(humanDelay());

        // Submit
        await page.click(profile.selectors.submit, { timeout });
        await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});

        // Update last login
        await updateLastLogin(action.auth_profile);

        return { type: "auth_login", success: true, result: `Logged in as ${profile.username}` };
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

    // ── Execute actions ──
    const actionResults: ActionResult[] = [];
    const midScreenshots: string[] = [];

    for (const action of input.actions) {
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
      const result = await executeAction(page, action, midScreenshots, input.timeout, input.session_id);
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
