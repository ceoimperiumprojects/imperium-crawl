/**
 * Annotated Screenshots — Inject visual overlay badges on interactive elements.
 *
 * Zero external deps — uses DOM injection via page.evaluate(),
 * takes screenshot, then cleans up injected elements.
 *
 * Color coding:
 * - Red (#e53e3e)    = button, switch
 * - Blue (#3182ce)   = link, tab
 * - Green (#38a169)  = textbox, searchbox, combobox, listbox
 * - Orange (#dd6b20) = other interactive (checkbox, radio, slider, etc.)
 */

import type { RefMap } from "./types.js";

type Page = import("rebrowser-playwright").Page;

const ROLE_COLORS: Record<string, string> = {
  button: "#e53e3e",
  switch: "#e53e3e",
  link: "#3182ce",
  tab: "#3182ce",
  textbox: "#38a169",
  searchbox: "#38a169",
  combobox: "#38a169",
  listbox: "#38a169",
};

const DEFAULT_COLOR = "#dd6b20";

const ANNOTATION_ATTR = "data-imperium-annotation";

/**
 * Inject annotation overlays on interactive elements, take screenshot, cleanup.
 * Returns PNG buffer.
 */
export async function annotateScreenshot(page: Page, refs: RefMap): Promise<Buffer> {
  // Build annotation data for injection
  const annotations = Object.entries(refs).map(([ref, entry]) => ({
    ref,
    role: entry.role,
    name: entry.name,
    nth: entry.nth,
    color: ROLE_COLORS[entry.role] ?? DEFAULT_COLOR,
  }));

  // Inject overlays via page.evaluate
  await page.evaluate((data: typeof annotations) => {
    const ATTR = "data-imperium-annotation";

    for (const { ref, role, name, nth, color } of data) {
      // Find the element using ARIA queries
      let elements: Element[];
      try {
        // Try aria role query
        const selector = name
          ? `[role="${role}"]`
          : `[role="${role}"]`;
        elements = Array.from(document.querySelectorAll(selector));

        // Filter by accessible name if provided
        if (name) {
          elements = elements.filter((el) => {
            const accName =
              el.getAttribute("aria-label") ||
              el.getAttribute("title") ||
              (el.textContent ?? "").trim();
            return accName.includes(name) || name.includes(accName.slice(0, 80));
          });
        }

        // Handle nth
        if (nth !== undefined && elements[nth]) {
          elements = [elements[nth]];
        } else if (elements.length > 0) {
          elements = [elements[0]];
        }

        // Fallback: try matching by tag for common roles
        if (elements.length === 0) {
          const tagMap: Record<string, string> = {
            button: "button",
            link: "a",
            textbox: "input,textarea",
            searchbox: "input[type=search]",
            checkbox: "input[type=checkbox]",
            radio: "input[type=radio]",
          };
          if (tagMap[role]) {
            const tagEls = document.querySelectorAll(tagMap[role]);
            for (const el of tagEls) {
              const accName =
                el.getAttribute("aria-label") ||
                el.getAttribute("title") ||
                (el.textContent ?? "").trim();
              if (!name || accName.includes(name) || name.includes(accName.slice(0, 80))) {
                elements = [el];
                break;
              }
            }
          }
        }
      } catch {
        elements = [];
      }

      if (elements.length === 0) continue;

      const el = elements[0];
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      // Create border overlay
      const border = document.createElement("div");
      border.setAttribute(ATTR, ref);
      Object.assign(border.style, {
        position: "absolute",
        top: `${rect.top + window.scrollY}px`,
        left: `${rect.left + window.scrollX}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        border: `2px solid ${color}`,
        borderRadius: "3px",
        pointerEvents: "none",
        zIndex: "2147483647",
        boxSizing: "border-box",
      });

      // Create badge
      const badge = document.createElement("div");
      badge.setAttribute(ATTR, `${ref}-badge`);
      const refNum = ref.replace("e", "");
      badge.textContent = refNum;
      Object.assign(badge.style, {
        position: "absolute",
        top: `${rect.top + window.scrollY - 10}px`,
        left: `${rect.left + window.scrollX - 10}px`,
        width: "20px",
        height: "20px",
        borderRadius: "50%",
        backgroundColor: color,
        color: "white",
        fontSize: "11px",
        fontWeight: "bold",
        fontFamily: "Arial, sans-serif",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
        zIndex: "2147483647",
        lineHeight: "1",
      });

      document.body.appendChild(border);
      document.body.appendChild(badge);
    }
  }, annotations);

  // Take screenshot with annotations
  const screenshot = await page.screenshot({ fullPage: false });

  // Cleanup injected elements
  await page.evaluate((attr: string) => {
    const els = document.querySelectorAll(`[${attr}]`);
    for (const el of els) el.remove();
  }, ANNOTATION_ATTR);

  return screenshot;
}
