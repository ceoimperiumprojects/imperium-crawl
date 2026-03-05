/**
 * Snapshot Extractor — Core engine for ARIA-based page snapshots.
 *
 * Uses Playwright's locator.ariaSnapshot() for the ARIA tree,
 * then post-processes to add [ref=eN] tags for interactive elements.
 * Optionally detects cursor-interactive elements without ARIA roles.
 *
 * Inspired by agent-browser's approach but with:
 * - Per-snapshot ref counter (thread-safe, no global state)
 * - Hybrid cursor detection
 * - Semantic locators (getByRole) for robust element targeting
 */

import type { RefMap, EnhancedSnapshot, SnapshotOptions } from "./types.js";

type Page = import("rebrowser-playwright").Page;
type Locator = import("rebrowser-playwright").Locator;

// ── Role classification ──

const INTERACTIVE_ROLES = new Set([
  "button", "link", "textbox", "checkbox", "radio",
  "combobox", "listbox", "menuitem", "option", "searchbox",
  "slider", "spinbutton", "switch", "tab", "treeitem",
]);

const CONTENT_ROLES = new Set([
  "heading", "cell", "article", "region", "navigation",
  "img", "figure", "blockquote", "code",
]);

const STRUCTURAL_ROLES = new Set([
  "generic", "group", "list", "table", "row", "rowgroup",
  "columnheader", "rowheader", "presentation", "none",
  "separator", "toolbar", "banner", "contentinfo", "main",
  "complementary", "form",
]);

// ── ARIA tree line parser ──

interface ParsedLine {
  indent: number;
  role: string;
  name: string;
  rawLine: string;
  attributes: string;
}

/**
 * Parse a single line from Playwright's ariaSnapshot output.
 * Format: "  - role \"name\" [attributes]" or "  - role \"name\":"
 * Also handles: "  - text: content here"
 */
function parseLine(line: string): ParsedLine | null {
  // Count leading spaces for indentation
  const stripped = line.replace(/^\s*/, "");
  const indent = line.length - stripped.length;

  // Must start with "- "
  if (!stripped.startsWith("- ")) return null;
  const content = stripped.slice(2);

  // Match: role "name" or role "name": or just role:
  const roleNameMatch = content.match(/^(\w+)\s+"([^"]*)"(.*)$/);
  if (roleNameMatch) {
    return {
      indent,
      role: roleNameMatch[1],
      name: roleNameMatch[2],
      rawLine: line,
      attributes: roleNameMatch[3].trim(),
    };
  }

  // Match: role (no name) — e.g. "- list:" or "- generic"
  const roleOnlyMatch = content.match(/^(\w+):?\s*$/);
  if (roleOnlyMatch) {
    return {
      indent,
      role: roleOnlyMatch[1],
      name: "",
      rawLine: line,
      attributes: "",
    };
  }

  // Text node: "- text: some content"
  if (content.startsWith("text:")) {
    return {
      indent,
      role: "text",
      name: content.slice(5).trim(),
      rawLine: line,
      attributes: "",
    };
  }

  // Plain text line (e.g. "- Some text content")
  return {
    indent,
    role: "text",
    name: content.replace(/:$/, "").trim(),
    rawLine: line,
    attributes: "",
  };
}

// ── Role+Name dedup tracker ──

class RoleNameTracker {
  private counts = new Map<string, number>();
  private assigned = new Map<string, number>();

  /** First pass: count occurrences */
  count(role: string, name: string): void {
    const key = `${role}:::${name}`;
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }

  /** Second pass: get nth index (only if duplicates exist) */
  getNth(role: string, name: string): number | undefined {
    const key = `${role}:::${name}`;
    const total = this.counts.get(key) ?? 1;
    if (total <= 1) return undefined;

    const idx = this.assigned.get(key) ?? 0;
    this.assigned.set(key, idx + 1);
    return idx;
  }
}

// ── Selector builder ──

function buildSelector(role: string, name: string, nth?: number): string {
  const nameOpt = name ? `, { name: '${name.replace(/'/g, "\\'")}', exact: true }` : "";
  const base = `getByRole('${role}'${nameOpt})`;
  return nth !== undefined ? `${base}.nth(${nth})` : base;
}

// ── Cursor-interactive element detection ──

interface CursorElement {
  role: string;
  name: string;
  tagName: string;
  ariaLabel: string;
}

async function findCursorInteractiveElements(
  page: Page,
  scopeSelector?: string,
): Promise<CursorElement[]> {
  return page.evaluate((scope) => {
    const root = scope
      ? document.querySelector(scope) ?? document.body
      : document.body;

    const results: CursorElement[] = [];
    const seen = new Set<Element>();

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode() as Element | null;

    while (node) {
      if (!seen.has(node)) {
        const style = getComputedStyle(node);
        const hasClick = node.hasAttribute("onclick") ||
          node.hasAttribute("tabindex") ||
          style.cursor === "pointer";
        const role = node.getAttribute("role");
        const tag = node.tagName.toLowerCase();

        // Only capture elements that LOOK interactive but have no ARIA role
        if (hasClick && !role && !["a", "button", "input", "select", "textarea"].includes(tag)) {
          results.push({
            role: "generic",
            name: node.getAttribute("aria-label") ||
              (node.textContent ?? "").trim().slice(0, 80) || "",
            tagName: tag,
            ariaLabel: node.getAttribute("aria-label") ?? "",
          });
          seen.add(node);
        }
      }
      node = walker.nextNode() as Element | null;
    }

    return results;
  }, scopeSelector);
}

// ── Main export ──

/**
 * Generate an enhanced ARIA snapshot with ref annotations.
 *
 * Flow:
 * 1. Get ARIA tree from Playwright's ariaSnapshot()
 * 2. Parse each line, identify roles
 * 3. Two-pass ref assignment (count first for dedup, then assign)
 * 4. Optionally detect cursor-interactive elements
 * 5. Build RefMap and annotated tree string
 */
export async function getEnhancedSnapshot(
  page: Page,
  options: SnapshotOptions = {},
): Promise<EnhancedSnapshot> {
  const {
    interactive = true,
    cursor = false,
    compact = true,
    selector,
  } = options;

  // Get the ARIA tree from Playwright
  const locator: Locator = selector
    ? page.locator(selector)
    : page.locator("body");

  // ariaSnapshot() exists in playwright-core 1.49+ but types may not be in rebrowser-playwright
  const ariaTree: string = await (locator as unknown as { ariaSnapshot: (opts?: Record<string, unknown>) => Promise<string> }).ariaSnapshot();

  const lines = ariaTree.split("\n");
  const parsed: (ParsedLine | null)[] = lines.map(parseLine);

  // ── First pass: count role+name for dedup ──
  const tracker = new RoleNameTracker();
  for (const p of parsed) {
    if (!p) continue;
    if (p.role === "text") continue;
    if (INTERACTIVE_ROLES.has(p.role) || CONTENT_ROLES.has(p.role)) {
      tracker.count(p.role, p.name);
    }
  }

  // ── Second pass: assign refs ──
  let refCounter = 0;
  const refs: RefMap = {};
  const annotatedLines: string[] = [];
  let totalElements = 0;
  let interactiveCount = 0;
  let contentCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const p = parsed[i];
    if (!p) {
      // Keep raw lines that didn't parse (empty lines, etc.)
      if (lines[i].trim()) annotatedLines.push(lines[i]);
      continue;
    }

    totalElements++;
    const isInteractive = INTERACTIVE_ROLES.has(p.role);
    const isContent = CONTENT_ROLES.has(p.role);
    const isStructural = STRUCTURAL_ROLES.has(p.role);
    const isText = p.role === "text";

    // Decide whether to assign a ref
    let ref: string | undefined;
    if (isInteractive) {
      interactiveCount++;
      ref = `e${++refCounter}`;
      const nth = tracker.getNth(p.role, p.name);
      refs[ref] = {
        selector: buildSelector(p.role, p.name, nth),
        role: p.role,
        name: p.name,
        ...(nth !== undefined && { nth }),
      };
    } else if (isContent && !interactive) {
      contentCount++;
      ref = `e${++refCounter}`;
      const nth = tracker.getNth(p.role, p.name);
      refs[ref] = {
        selector: buildSelector(p.role, p.name, nth),
        role: p.role,
        name: p.name,
        ...(nth !== undefined && { nth }),
      };
    }

    // Build annotated line
    if (compact && isStructural && !ref) {
      // In compact mode, skip structural elements without refs
      // BUT keep them if they have children (indicated by trailing ":")
      if (!p.rawLine.trimEnd().endsWith(":")) continue;
    }

    if (ref) {
      // Insert [ref=eN] after the role
      const indent = " ".repeat(p.indent);
      const nameStr = p.name ? ` "${p.name}"` : "";
      const attrStr = p.attributes ? ` ${p.attributes}` : "";
      annotatedLines.push(`${indent}- ${p.role}${nameStr} [ref=${ref}]${attrStr}`);
    } else if (isText || !compact || !isStructural) {
      annotatedLines.push(p.rawLine);
    }
  }

  // ── Cursor-interactive elements (optional) ──
  if (cursor) {
    const cursorElements = await findCursorInteractiveElements(page, selector);
    for (const el of cursorElements) {
      const ref = `e${++refCounter}`;
      interactiveCount++;
      // For cursor elements, build a CSS-based selector as fallback
      const nameStr = el.ariaLabel || el.name;
      refs[ref] = {
        selector: nameStr
          ? `getByRole('${el.role}', { name: '${nameStr.replace(/'/g, "\\'")}', exact: true })`
          : `locator('${el.tagName}')`,
        role: el.role || "generic",
        name: nameStr,
      };
      annotatedLines.push(`- ${el.role || "generic"} "${nameStr}" [ref=${ref}] (cursor-interactive)`);
    }
  }

  return {
    tree: annotatedLines.join("\n"),
    refs,
    stats: {
      totalElements,
      interactiveElements: interactiveCount,
      contentElements: contentCount,
    },
  };
}
