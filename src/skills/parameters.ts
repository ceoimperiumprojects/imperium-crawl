/**
 * Skill Parameters — template resolution engine for InteractSkillConfig.
 *
 * Template syntax:
 *   {{env:VAR_NAME}}       — resolved from process.env
 *   {{input:field_name}}   — resolved from user-provided params at runtime
 *   {{computed:name}}      — built-in computed values (date_today, timestamp, etc.)
 *
 * The colon prefix prevents accidental matches on literal {{...}} in JS code.
 */

// ── Types ──

export type ParameterSource = "env" | "input" | "computed";

export interface SkillParameter {
  /** Where to resolve this parameter from */
  source: ParameterSource;
  /** For env: env var name. For input: display label. For computed: computed key. */
  key: string;
  /** Human-readable description shown to user when prompting */
  description?: string;
  /** Default value if not provided */
  default?: string;
  /** Whether the parameter is required (no default, no env fallback) */
  required?: boolean;
}

export type SkillParameters = Record<string, SkillParameter>;

// ── Computed Values ──

const COMPUTED_VALUES: Record<string, () => string> = {
  date_today: () => new Date().toISOString().split("T")[0],
  date_yesterday: () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split("T")[0];
  },
  date_7_days_ago: () => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split("T")[0];
  },
  date_30_days_ago: () => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split("T")[0];
  },
  timestamp: () => Date.now().toString(),
  timestamp_iso: () => new Date().toISOString(),
  random_string: () => Math.random().toString(36).substring(2, 10),
  year: () => new Date().getFullYear().toString(),
  month: () => String(new Date().getMonth() + 1).padStart(2, "0"),
  day: () => String(new Date().getDate()).padStart(2, "0"),
};

// ── Template Regex ──

// Matches {{env:X}}, {{input:X}}, {{computed:X}}
const TEMPLATE_RE = /\{\{(env|input|computed):([^}]+)\}\}/g;

// ── Resolution ──

/**
 * Resolve all template variables in a string.
 * Unknown variables are left as-is (not replaced) so errors are visible.
 */
export function resolveString(
  text: string,
  params: SkillParameters = {},
  inputArgs: Record<string, string> = {},
): string {
  return text.replace(TEMPLATE_RE, (match, source: string, key: string) => {
    key = key.trim();

    if (source === "env") {
      const val = process.env[key];
      if (val !== undefined) return val;
      // Check if parameter has a default
      const param = Object.values(params).find((p) => p.source === "env" && p.key === key);
      if (param?.default !== undefined) return param.default;
      return match; // Leave unresolved — caller can detect and warn
    }

    if (source === "input") {
      // inputArgs key matches the template variable name (e.g. {{input:case_number}} → inputArgs.case_number)
      if (inputArgs[key] !== undefined) return inputArgs[key];
      const param = params[key];
      if (param?.default !== undefined) return param.default;
      return match;
    }

    if (source === "computed") {
      const fn = COMPUTED_VALUES[key];
      if (fn) return fn();
      return match;
    }

    return match;
  });
}

/**
 * Resolve all template variables in an action's string fields.
 * Operates on a shallow copy — does not mutate the original action.
 */
export function resolveAction<T extends Record<string, unknown>>(
  action: T,
  params: SkillParameters,
  inputArgs: Record<string, string>,
): T {
  const resolved = { ...action };
  const STRING_FIELDS = ["text", "value", "script", "url", "selector", "key", "extract_script"] as const;

  for (const field of STRING_FIELDS) {
    if (typeof resolved[field] === "string") {
      (resolved as Record<string, unknown>)[field] = resolveString(resolved[field] as string, params, inputArgs);
    }
  }

  return resolved;
}

/**
 * Resolve parameters in an array of actions.
 */
export function resolveActions<T extends Record<string, unknown>>(
  actions: T[],
  params: SkillParameters,
  inputArgs: Record<string, string>,
): T[] {
  return actions.map((action) => resolveAction(action, params, inputArgs));
}

// ── Auto-Detection Heuristics ──

/**
 * Detect which action fields look like they should be parameterized.
 * Returns a suggested SkillParameters map — caller can review and adjust.
 */
export function detectParameterCandidates(
  actions: Array<Record<string, unknown>>,
): SkillParameters {
  const candidates: SkillParameters = {};

  const PASSWORD_PATTERNS = /password|passwd|pwd|secret/i;
  const USERNAME_PATTERNS = /username|user|email|login|userid/i;
  const SEARCH_PATTERNS = /search|query|keyword|term|filter|q=|case|number|id/i;

  for (const action of actions) {
    if (action.type !== "type") continue;

    const selector = String(action.selector ?? action.ref ?? "");
    const text = String(action.text ?? "");

    // Skip already templated values
    if (text.includes("{{")) continue;

    // Detect password fields
    if (PASSWORD_PATTERNS.test(selector) || PASSWORD_PATTERNS.test(text)) {
      const paramName = "password";
      if (!candidates[paramName]) {
        const envKey = "SKILL_PASSWORD";
        candidates[paramName] = { source: "env", key: envKey, description: "Login password", required: true };
        (action as Record<string, string>).text = `{{env:${envKey}}}`;
      }
      continue;
    }

    // Detect username/email fields
    if (USERNAME_PATTERNS.test(selector)) {
      const paramName = "username";
      if (!candidates[paramName]) {
        const envKey = "SKILL_USERNAME";
        candidates[paramName] = { source: "env", key: envKey, description: "Login username or email", required: true };
        (action as Record<string, string>).text = `{{env:${envKey}}}`;
      }
      continue;
    }

    // Detect search/filter/query fields
    if (SEARCH_PATTERNS.test(selector) && text.length > 0) {
      const paramName = "query";
      if (!candidates[paramName]) {
        candidates[paramName] = { source: "input", key: "query", description: "Search query or filter value", required: false };
        (action as Record<string, string>).text = `{{input:query}}`;
      }
    }
  }

  return candidates;
}

// ── Validation ──

/**
 * Check all templates in a string are resolvable.
 * Returns unresolved template names (empty array = all good).
 */
export function findUnresolved(
  text: string,
  params: SkillParameters,
  inputArgs: Record<string, string>,
): string[] {
  const unresolved: string[] = [];
  const resolved = resolveString(text, params, inputArgs);

  // Find remaining {{...}} patterns
  const remaining = resolved.match(/\{\{[^}]+\}\}/g) ?? [];
  unresolved.push(...remaining);

  return unresolved;
}
