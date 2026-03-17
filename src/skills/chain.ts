/**
 * Chain Executor — multi-step skill composition.
 *
 * A chain skill connects multiple skills sequentially, passing outputs
 * from one step as inputs to the next via variable references.
 *
 * Variable syntax in step.input values: "$step_name.field.nested[0]"
 * Output merge: "merge($a, $b)" or just "$step_name"
 *
 * Example chain config:
 * {
 *   "name": "search-and-extract",
 *   "type": "chain",
 *   "steps": [
 *     { "skill": "web-search", "input": { "query": "{{input:topic}}" }, "output": "search" },
 *     { "skill": "extract-page", "input": { "url": "$search.results[0].url" }, "output": "article",
 *       "condition": "$search.results.length > 0" }
 *   ],
 *   "output": "$article"
 * }
 */

import { getByPath } from "./conditions.js";
import { evaluateCondition } from "./conditions.js";

// ── Types ──

export interface ChainStep {
  /** Skill name to run */
  skill: string;
  /** Input values — may reference previous step outputs with $step.field */
  input?: Record<string, string>;
  /** Name to store this step's output under (for downstream references) */
  output?: string;
  /** Optional condition — step is skipped if this evaluates to false */
  condition?: string;
}

export interface ChainConfig {
  name: string;
  description: string;
  type: "chain";
  steps: ChainStep[];
  /** Final output expression: "$step_name" or "merge($a, $b)" */
  output?: string;
  created_at: string;
}

// ── Variable resolver ──

/**
 * Resolve a $-prefixed variable reference from the variables map.
 * "$step.field.nested[0]" → variables.step.field.nested[0]
 */
function resolveVar(ref: string, variables: Record<string, unknown>): unknown {
  const clean = ref.startsWith("$") ? ref.slice(1) : ref;
  const dotIdx = clean.indexOf(".");
  if (dotIdx === -1) return variables[clean];
  const stepName = clean.slice(0, dotIdx);
  return getByPath(variables[stepName], clean.slice(dotIdx + 1));
}

/** Interpolate a string value, replacing $ref patterns with resolved values */
function interpolateString(value: string, variables: Record<string, unknown>): string {
  // Replace $ref patterns (not followed by another word char to avoid partial matches)
  return value.replace(/\$[\w.[\]]+/g, (match) => {
    const resolved = resolveVar(match, variables);
    return resolved === undefined || resolved === null ? "" : String(resolved);
  });
}

/** Resolve all input values for a step */
function resolveStepInput(
  input: Record<string, string> | undefined,
  variables: Record<string, unknown>,
): Record<string, string> {
  if (!input) return {};
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    resolved[key] = interpolateString(value, variables);
  }
  return resolved;
}

// ── Output merger ──

/** Deep merge multiple objects (last write wins for same keys) */
function deepMerge(...objects: unknown[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const obj of objects) {
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      Object.assign(result, obj);
    }
  }
  return result;
}

/**
 * Evaluate the final output expression.
 * Supports: "$step_name" or "merge($a, $b, $c)"
 */
function evaluateOutput(expr: string, variables: Record<string, unknown>): unknown {
  const trimmed = expr.trim();

  // merge() function
  const mergeMatch = trimmed.match(/^merge\((.+)\)$/);
  if (mergeMatch) {
    const refs = mergeMatch[1].split(",").map((s) => s.trim());
    const values = refs.map((r) => resolveVar(r, variables));
    return deepMerge(...values);
  }

  // Simple variable reference
  if (trimmed.startsWith("$")) {
    return resolveVar(trimmed, variables);
  }

  return trimmed;
}

// ── Chain Executor ──

export interface ChainExecutionResult {
  success: boolean;
  steps_executed: number;
  steps_skipped: number;
  step_results: Array<{ name: string; output_key: string; skipped?: boolean; error?: string }>;
  output: unknown;
  error?: string;
}

export class ChainExecutor {
  /**
   * Execute a chain, running each step in order.
   * Step outputs are accumulated in `variables` and available to downstream steps.
   */
  async execute(
    config: ChainConfig,
    initialParams: Record<string, string> = {},
  ): Promise<ChainExecutionResult> {
    // Variables accumulate step outputs: { step_output_key: step_result_data }
    const variables: Record<string, unknown> = {
      // Make initial params available as $params.key
      params: initialParams,
    };

    const stepResults: ChainExecutionResult["step_results"] = [];
    let stepsExecuted = 0;
    let stepsSkipped = 0;

    for (const step of config.steps) {
      // Check condition if provided
      if (step.condition) {
        const conditionMet = evaluateCondition(step.condition, variables);
        if (!conditionMet) {
          stepResults.push({ name: step.skill, output_key: step.output ?? "", skipped: true });
          stepsSkipped++;
          continue;
        }
      }

      // Resolve step inputs
      const resolvedInput = resolveStepInput(step.input, variables);

      // Load and run the skill
      let stepOutput: unknown;
      try {
        const { loadWithRecipes } = await import("./manager.js");
        const { execute: runSkill } = await import("../tools/run-skill.js");

        const skillConfig = await loadWithRecipes(step.skill);
        if (!skillConfig) {
          const error = `Skill '${step.skill}' not found`;
          stepResults.push({ name: step.skill, output_key: step.output ?? "", error });
          // Propagate error — chains are strict by default
          return {
            success: false,
            steps_executed: stepsExecuted,
            steps_skipped: stepsSkipped,
            step_results: stepResults,
            output: null,
            error,
          };
        }

        const result = await runSkill({
          name: step.skill,
          params: resolvedInput,
          max_items: 50,
          ...(resolvedInput.url && { url: resolvedInput.url }),
        });

        // Extract text content from tool result
        const textContent = result.content?.find((c: { type: string }) => c.type === "text");
        if (textContent && "text" in textContent) {
          try {
            stepOutput = JSON.parse(textContent.text as string);
          } catch {
            stepOutput = textContent.text;
          }
        } else {
          stepOutput = result;
        }

        stepsExecuted++;
        stepResults.push({ name: step.skill, output_key: step.output ?? "" });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        stepResults.push({ name: step.skill, output_key: step.output ?? "", error });
        return {
          success: false,
          steps_executed: stepsExecuted,
          steps_skipped: stepsSkipped,
          step_results: stepResults,
          output: null,
          error,
        };
      }

      // Store output under the configured key
      if (step.output) {
        variables[step.output] = stepOutput;
      }
    }

    // Compute final output
    const finalOutput = config.output
      ? evaluateOutput(config.output, variables)
      : variables;

    return {
      success: true,
      steps_executed: stepsExecuted,
      steps_skipped: stepsSkipped,
      step_results: stepResults,
      output: finalOutput,
    };
  }
}
