/**
 * SACRED — Do not modify during autoresearch runs.
 * Scoring math for the autoresearch evaluation harness.
 */

import {
  WEIGHTS,
  DIFFICULTY_MULTIPLIERS,
  EMA_ALPHA,
  type ComponentScores,
  type FixtureResult,
  type LiveResult,
  type WorkflowResult,
  type BenchmarkDifficulty,
  type EvalState,
} from "./types.js";

/**
 * Compute composite score from components.
 * Returns 0 if gated (build/test failure).
 */
export function computeComposite(components: ComponentScores, gated: boolean): number {
  if (gated) return 0;

  return (
    WEIGHTS.fixture * components.fixture +
    WEIGHTS.live * components.live +
    WEIGHTS.workflow * components.workflow +
    WEIGHTS.perf * components.perf +
    WEIGHTS.tests * components.tests +
    WEIGHTS.docs * components.docs
  );
}

/**
 * Score fixtures: simple pass/total ratio.
 */
export function scoreFixtures(results: FixtureResult[]): number {
  if (results.length === 0) return 0;
  const passed = results.filter((r) => r.passed).length;
  return passed / results.length;
}

/**
 * Score live benchmarks with difficulty weighting + EMA smoothing.
 * Skipped tests are excluded from the denominator.
 */
export function scoreLive(
  results: LiveResult[],
  state: EvalState,
): { score: number; updatedEma: Record<string, number> } {
  const active = results.filter((r) => !r.skipped);
  if (active.length === 0) return { score: 0, updatedEma: { ...state.live_ema } };

  const updatedEma = { ...state.live_ema };

  let weightedSum = 0;
  let weightTotal = 0;

  for (const result of active) {
    const multiplier = DIFFICULTY_MULTIPLIERS[result.difficulty];
    const rawScore = result.passed ? 1 : result.partial ? 0.5 : 0;

    // EMA smooth
    const historical = updatedEma[result.id] ?? rawScore;
    const smoothed = EMA_ALPHA * rawScore + (1 - EMA_ALPHA) * historical;
    updatedEma[result.id] = smoothed;

    weightedSum += smoothed * multiplier;
    weightTotal += multiplier;
  }

  const score = weightTotal > 0 ? weightedSum / weightTotal : 0;
  return { score: Math.min(score, 1), updatedEma };
}

/**
 * Score workflows: completed / total.
 */
export function scoreWorkflows(results: WorkflowResult[]): number {
  if (results.length === 0) return 0;
  const completed = results.filter((r) => r.completed).length;
  return completed / results.length;
}

/**
 * Score performance: baseline_ms / actual_ms, capped at 1.0.
 * Faster than baseline = 1.0 (no bonus for going faster).
 */
export function scorePerformance(actualMs: number, baselineMs: number): number {
  if (actualMs <= 0 || baselineMs <= 0) return 1;
  return Math.min(baselineMs / actualMs, 1.0);
}

/**
 * Score tests: current_passing / baseline_passing, capped at 1.0.
 * Adding tests can't increase beyond 1.0 (but not regressing is rewarded).
 */
export function scoreTests(currentPassing: number, baselinePassing: number): number {
  if (baselinePassing <= 0) return currentPassing > 0 ? 1 : 0;
  return Math.min(currentPassing / baselinePassing, 1.0);
}

/**
 * Score SKILL documentation completeness.
 * Checks: all registered tools mentioned, recipes documented, no broken refs.
 */
export function scoreDocs(
  toolNames: string[],
  skillContent: string,
  recipeNames: string[],
): number {
  if (!skillContent) return 0;

  const lower = skillContent.toLowerCase();
  let checks = 0;
  let passed = 0;

  // Check each registered tool is mentioned in SKILL docs
  for (const tool of toolNames) {
    checks++;
    // Match tool name as word (tool-name or tool_name or `tool`)
    const variants = [tool, tool.replace(/-/g, "_"), tool.replace(/-/g, " ")];
    if (variants.some((v) => lower.includes(v.toLowerCase()))) {
      passed++;
    }
  }

  // Check each recipe is mentioned
  for (const recipe of recipeNames) {
    checks++;
    const variants = [recipe, recipe.replace(/-/g, "_"), recipe.replace(/-/g, " ")];
    if (variants.some((v) => lower.includes(v.toLowerCase()))) {
      passed++;
    }
  }

  return checks > 0 ? passed / checks : 1;
}

/**
 * Format score for display — 6 decimal places.
 */
export function formatScore(score: number): string {
  return score.toFixed(6);
}

/**
 * Format results.tsv line.
 */
export function formatResultsTsvLine(
  commit: string,
  score: number,
  components: ComponentScores,
  testCount: { passed: number; total: number },
  durationMs: number,
  status: "keep" | "discard" | "baseline",
  description: string,
): string {
  const ts = new Date().toISOString();
  return [
    commit,
    ts,
    formatScore(score),
    formatScore(components.fixture),
    formatScore(components.live),
    formatScore(components.workflow),
    formatScore(components.perf),
    `${testCount.passed}/${testCount.total}`,
    formatScore(components.docs),
    durationMs.toString(),
    status,
    description,
  ].join("\t");
}

export const RESULTS_TSV_HEADER = [
  "commit",
  "timestamp",
  "score",
  "fixture",
  "live",
  "workflow",
  "perf",
  "tests",
  "docs",
  "duration_ms",
  "status",
  "description",
].join("\t");
