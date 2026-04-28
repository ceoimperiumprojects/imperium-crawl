import type { FlowStep, SmartTarget } from "./types.js";

type Page = import("rebrowser-playwright").Page;

export interface ResolvedTarget {
  action: FlowStep;
  strategy?: string;
}

function cssFromAttributes(attrs?: Record<string, string>): string | undefined {
  if (!attrs) return undefined;
  for (const key of ["data-testid", "data-test", "id", "name", "placeholder", "aria-label"]) {
    const val = attrs[key];
    if (val) return `[${key}="${val.replace(/"/g, '\\"')}"]`;
  }
  return undefined;
}

async function canResolve(page: Page, target: SmartTarget): Promise<{ selector?: string; strategy?: string }> {
  if (target.role && target.name) {
    try {
      if (await page.getByRole(target.role as Parameters<Page["getByRole"]>[0], { name: target.name }).count()) {
        return { strategy: "aria" };
      }
    } catch {
      // try next
    }
  }
  if (target.label) {
    try {
      if (await page.getByLabel(target.label).count()) return { strategy: "label" };
    } catch {
      // try next
    }
  }
  if (target.text) {
    try {
      if (await page.getByText(target.text, { exact: true }).count()) return { strategy: "text" };
    } catch {
      // try next
    }
  }
  if (target.selector) {
    try {
      if (await page.locator(target.selector).count()) return { selector: target.selector, strategy: "css" };
    } catch {
      // try next
    }
  }
  const attrSelector = cssFromAttributes(target.attributes);
  if (attrSelector) {
    try {
      if (await page.locator(attrSelector).count()) return { selector: attrSelector, strategy: "attributes" };
    } catch {
      // try next
    }
  }
  return {};
}

export async function resolveSmartTarget(page: Page, step: FlowStep): Promise<ResolvedTarget> {
  if (!step.target) return { action: step };
  const resolved = await canResolve(page, step.target);
  const action: FlowStep = { ...step };
  delete action.target;

  if (resolved.selector) {
    action.selector = resolved.selector;
  } else if (resolved.strategy === "aria" && step.target.role && step.target.name) {
    action.selector = step.selector;
  } else if (resolved.strategy === "label" && step.target.label) {
    action.selector = step.selector;
  } else if (resolved.strategy === "text" && step.target.text) {
    action.selector = step.selector;
  } else if (!action.selector && step.target.selector) {
    action.selector = step.target.selector;
  }

  return { action, strategy: resolved.strategy ?? (action.selector ? "fallback" : undefined) };
}
