/**
 * Action Policy — Granular access control for interact actions.
 *
 * Maps action types to categories, then evaluates against a policy config.
 * Supports hot-reload: checks file mtime every 5s.
 */

import fs from "node:fs/promises";
import type { ActionPolicyConfig, PolicyDecision } from "./types.js";

// ── Action → Category mapping ──

const ACTION_CATEGORIES: Record<string, string> = {
  // Navigation
  navigate: "navigate",

  // Click/interact
  click: "click",
  hover: "click",
  drag: "click",

  // Form input
  type: "fill",
  select: "fill",
  upload: "fill",

  // Script execution
  evaluate: "eval",

  // Read state
  screenshot: "snapshot",
  pdf: "snapshot",
  cookie_get: "state",
  storage_get: "state",

  // Write state
  cookie_set: "state_write",
  storage_set: "state_write",

  // Passive
  scroll: "scroll",
  wait: "wait",
  press: "interact",
};

// Internal actions always allowed
const INTERNAL_CATEGORY = "_internal";

/**
 * Get the category for an action type.
 */
export function getActionCategory(actionType: string): string {
  return ACTION_CATEGORIES[actionType] ?? "unknown";
}

// ── Policy evaluator ──

interface CachedPolicy {
  config: ActionPolicyConfig;
  mtime: number;
  loadedAt: number;
}

const policyCache = new Map<string, CachedPolicy>();
const POLICY_CHECK_INTERVAL_MS = 5000;

/**
 * Load and cache a policy file with hot-reload support.
 */
async function loadPolicy(policyPath: string): Promise<ActionPolicyConfig> {
  const now = Date.now();
  const cached = policyCache.get(policyPath);

  // Check if cached and recent enough
  if (cached && now - cached.loadedAt < POLICY_CHECK_INTERVAL_MS) {
    return cached.config;
  }

  // Check mtime for hot-reload
  try {
    const stat = await fs.stat(policyPath);
    const mtime = stat.mtimeMs;

    if (cached && cached.mtime === mtime) {
      cached.loadedAt = now;
      return cached.config;
    }

    const raw = await fs.readFile(policyPath, "utf-8");
    const config = JSON.parse(raw) as ActionPolicyConfig;

    policyCache.set(policyPath, { config, mtime, loadedAt: now });
    return config;
  } catch {
    // If file doesn't exist or is invalid, use permissive default
    const defaultConfig: ActionPolicyConfig = { default: "allow" };
    policyCache.set(policyPath, { config: defaultConfig, mtime: 0, loadedAt: now });
    return defaultConfig;
  }
}

/**
 * Check policy for a given action type.
 *
 * @param actionType - The action type (e.g. "click", "evaluate")
 * @param policyPath - Path to JSON policy file
 * @returns Policy decision: allow, deny, or confirm
 */
export async function checkPolicy(
  actionType: string,
  policyPath: string,
): Promise<PolicyDecision> {
  const category = getActionCategory(actionType);

  // Internal actions always allowed
  if (category === INTERNAL_CATEGORY) return "allow";

  const config = await loadPolicy(policyPath);

  // Deny takes highest priority
  if (config.deny?.includes(category)) return "deny";

  // Confirm takes second priority
  if (config.confirm?.includes(category)) return "confirm";

  // Explicit allow
  if (config.allow?.includes(category)) return "allow";

  // Fall through to default
  return config.default;
}

/**
 * Human-readable description of an action for confirm prompts.
 */
export function describeAction(actionType: string, details?: Record<string, unknown>): string {
  const descriptions: Record<string, string> = {
    navigate: "Navigate to a URL",
    click: "Click an element",
    hover: "Hover over an element",
    drag: "Drag and drop an element",
    type: "Type text into a field",
    select: "Select an option",
    upload: "Upload files",
    evaluate: "Execute JavaScript code",
    screenshot: "Take a screenshot",
    pdf: "Generate a PDF",
    cookie_get: "Read cookies",
    cookie_set: "Set cookies",
    storage_get: "Read browser storage",
    storage_set: "Write to browser storage",
    scroll: "Scroll the page",
    wait: "Wait for element/timeout",
    press: "Press a key",
  };

  let desc = descriptions[actionType] ?? `Execute ${actionType}`;
  if (details?.url) desc += ` (${details.url})`;
  if (details?.selector) desc += ` on ${details.selector}`;
  if (details?.ref) desc += ` on ref ${details.ref}`;

  return desc;
}

/** Clear policy cache (for testing) */
export function resetPolicyCache(): void {
  policyCache.clear();
}
