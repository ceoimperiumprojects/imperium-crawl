/**
 * Action Executor — extracted from interact.ts.
 *
 * Shared between:
 *   - interact tool (automated action sequences)
 *   - explore REPL (interactive CLI browser session)
 *
 * All browser action handlers live here. interact.ts and cli-explore.ts
 * import executeAction from this module.
 *
 * Note: evaluate and paginate actions use new Function() intentionally —
 * the user explicitly provides JS scripts for browser-side execution.
 * This is the same pattern used in the original interact.ts.
 */

import {
  HUMAN_DELAY_MIN_MS,
  HUMAN_DELAY_MAX_MS,
} from "../core/constants.js";
import { getSnapshotStore } from "../snapshot/index.js";
import type { RefEntry } from "../snapshot/index.js";
import { getAuthProfile, updateLastLogin } from "../security/index.js";

// ── Types ──

export interface ActionResult {
  type: string;
  success: boolean;
  error?: string;
  result?: unknown;
}

export type ActionInput = {
  type: string;
  selector?: string;
  ref?: string;
  text?: string;
  value?: string;
  script?: string;
  key?: string;
  url?: string;
  duration?: number;
  x?: number;
  y?: number;
  target_selector?: string;
  target_ref?: string;
  file_paths?: string[];
  storage?: "local" | "session";
  auth_profile?: string;
  next_selector?: string;
  next_ref?: string;
  extract_script?: string;
  max_pages?: number;
  wait_after_click?: number;
  keywords?: string[];
  max_clicks?: number;
  cookies?: Array<{
    name: string;
    value: string;
    domain?: string;
    path?: string;
    expires?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "Strict" | "Lax" | "None";
  }>;
};

// ── Helpers ──

export function humanDelay(): number {
  return (
    HUMAN_DELAY_MIN_MS +
    Math.floor(Math.random() * (HUMAN_DELAY_MAX_MS - HUMAN_DELAY_MIN_MS))
  );
}

export function resolveRefToLocator(
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

export function getTargetSelector(
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

export function buildCssSelectorFromRef(refEntry: RefEntry): string {
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

// ── Core Action Executor ──

export async function executeAction(
  page: import("rebrowser-playwright").Page,
  action: ActionInput,
  screenshots: string[],
  timeout: number,
  sessionId?: string,
): Promise<ActionResult> {
  try {
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
        const evalFn = new Function(action.script) as () => unknown;
        const result = await page.evaluate(evalFn);
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
        const sourceSelector = refEntry ? buildCssSelectorFromRef(refEntry) : cssSelector!;
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
        const filtered = action.key ? allCookies.filter((c) => c.name === action.key) : allCookies;
        return { type: "cookie_get", success: true, result: filtered };
      }

      case "cookie_set": {
        if (!action.cookies?.length) return { type: "cookie_set", success: false, error: "cookies array required" };
        const pageUrl = page.url();
        const cookiesToSet = action.cookies.map((c) => ({ ...c, url: c.domain ? undefined : pageUrl }));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await page.context().addCookies(cookiesToSet as any);
        return { type: "cookie_set", success: true };
      }

      case "pdf": {
        const pdfBuf = await page.pdf();
        screenshots.push(pdfBuf.toString("base64"));
        return { type: "pdf", success: true, result: "PDF saved to screenshots array as base64" };
      }

      case "refresh": {
        await page.reload({ waitUntil: "load", timeout });
        return { type: "refresh", success: true };
      }

      case "paginate": {
        if (!action.extract_script) return { type: "paginate", success: false, error: "extract_script required" };
        if (!action.next_selector && !action.next_ref) return { type: "paginate", success: false, error: "next_selector or next_ref required" };

        const maxPages = action.max_pages ?? 10;
        const waitMs = action.wait_after_click ?? 2000;
        const allData: unknown[] = [];

        let nextRefEntry: RefEntry | undefined;
        let nextCss: string | undefined;
        if (action.next_ref && sessionId) {
          const entry = getSnapshotStore().resolveRef(sessionId, action.next_ref);
          if (!entry) return { type: "paginate", success: false, error: `next_ref '${action.next_ref}' not found` };
          nextRefEntry = entry;
        } else {
          nextCss = action.next_selector;
        }

        const extractFn = action.extract_script;

        for (let pg = 0; pg < maxPages; pg++) {
          const extracted = await page.evaluate((script) => (new Function(script))(), extractFn);
          if (extracted !== null && extracted !== undefined) {
            if (Array.isArray(extracted)) {
              allData.push(...extracted);
            } else if (typeof extracted === "string") {
              try { const parsed = JSON.parse(extracted); Array.isArray(parsed) ? allData.push(...parsed) : allData.push(parsed); }
              catch { allData.push(extracted); }
            } else {
              allData.push(extracted);
            }
          }

          if (pg >= maxPages - 1) break;

          try {
            if (nextRefEntry) {
              const loc = resolveRefToLocator(page, nextRefEntry);
              if (!await loc.isVisible().catch(() => false)) break;
              await loc.click({ timeout });
            } else if (nextCss) {
              const el = page.locator(nextCss);
              if (!await el.isVisible().catch(() => false)) break;
              const isDisabled = await el.evaluate((node) => {
                const htmlEl = node as HTMLElement;
                return htmlEl.classList.contains("disabled") ||
                  htmlEl.getAttribute("aria-disabled") === "true" ||
                  (htmlEl as HTMLButtonElement).disabled === true;
              }).catch(() => false);
              if (isDisabled) break;
              await el.click({ timeout });
            }
          } catch { break; }

          await page.waitForTimeout(waitMs);
          await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
        }

        return { type: "paginate", success: true, result: allData };
      }

      case "auto_click": {
        const defaultKeywords = [
          "show more", "load more", "gallery", "view images", "view photos",
          "prikaži više", "učitaj još", "galerija", "slike", "fotografije",
          "photos", "images", "see more", "more images", "more photos",
          "expand", "prikazi jos", "jos slika", "vise slika",
          "ucitaj vise", "prikazi vise", "prikaži još", "učitaj više",
        ];
        const keywords = action.keywords ?? defaultKeywords;
        const maxClicks = action.max_clicks ?? 5;
        const clicked: string[] = [];

        for (let round = 0; round < maxClicks; round++) {
          const found: string[] = await page.evaluate((kw: string[]) => {
            const clickedTexts: string[] = [];
            const buttons = Array.from(document.querySelectorAll("button, a, [role=button], .btn, .button, [class*=gallery], [class*=image], [class*=photo], [class*=more], [class*=load], [class*=expand], [id*=gallery], [id*=image], [id*=photo], [id*=more]"));
            for (const btn of buttons) {
              const el = btn as HTMLElement;
              const text = (el.textContent || el.title || el.getAttribute("aria-label") || "").toLowerCase();
              const matched = kw.some((k) => text.includes(k.toLowerCase()));
              if (matched && el.offsetParent !== null) {
                try {
                  el.click();
                  el.scrollIntoView({ behavior: "instant", block: "center" });
                  clickedTexts.push(text.slice(0, 100));
                } catch {}
              }
            }
            return clickedTexts;
          }, keywords);

          if (found.length === 0) break;
          clicked.push(...found);
          await page.waitForTimeout(action.wait_after_click ?? 2500);
          await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
        }

        return { type: "auto_click", success: true, result: { clicked: clicked.length, buttons: clicked } };
      }

      case "auth_login": {
        if (!action.auth_profile) return { type: "auth_login", success: false, error: "auth_profile name required" };
        const profile = await getAuthProfile(action.auth_profile);
        if (!profile) return { type: "auth_login", success: false, error: `Auth profile '${action.auth_profile}' not found` };

        if (profile.url) {
          await page.goto(profile.url, { waitUntil: "load", timeout });
        }

        await page.fill(profile.selectors.username, profile.username, { timeout });
        await page.waitForTimeout(humanDelay());
        await page.fill(profile.selectors.password, profile.password, { timeout });
        await page.waitForTimeout(humanDelay());
        await page.click(profile.selectors.submit, { timeout });
        await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
        await updateLastLogin(action.auth_profile);

        return { type: "auth_login", success: true, result: `Logged in as ${profile.username}` };
      }

      default:
        return { type: action.type, success: false, error: "unknown action type" };
    }
  } catch (err: unknown) {
    return {
      type: action.type,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
