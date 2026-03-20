#!/usr/bin/env tsx
/**
 * SACRED — Do not modify during autoresearch runs.
 * Main evaluation harness for imperium-crawl autoresearch.
 *
 * Usage: npx tsx autoresearch/eval.ts [--baseline] [--fixture-only] [--verbose]
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import { loadFixtures } from "./fixtures/index.js";
import { loadBenchmarks, selectSubset, loadWorkflows } from "./benchmarks/index.js";
import {
  computeComposite,
  scoreFixtures,
  scoreLive,
  scoreWorkflows,
  scorePerformance,
  scoreTests,
  scoreDocs,
  formatScore,
  formatResultsTsvLine,
  RESULTS_TSV_HEADER,
} from "./scoring.js";
import type {
  Fixture,
  FixtureResult,
  LiveResult,
  WorkflowResult,
  ComponentScores,
  EvalResult,
  EvalState,
  Workflow,
} from "./types.js";
import { LIVE_SUBSET_SIZE, FULL_SUITE_EVERY_N } from "./types.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");
const STATE_PATH = resolve(__dirname, "state.json");
const RESULTS_PATH = resolve(__dirname, "results.tsv");

// ── CLI flags ──

const args = process.argv.slice(2);
const isBaseline = args.includes("--baseline");
const fixtureOnly = args.includes("--fixture-only");
const verbose = args.includes("--verbose");

function log(msg: string) {
  console.log(msg);
}

function vlog(msg: string) {
  if (verbose) console.log(`  ${msg}`);
}

// ── State management ──

function loadState(): EvalState {
  if (existsSync(STATE_PATH)) {
    return JSON.parse(readFileSync(STATE_PATH, "utf-8"));
  }
  return {
    live_ema: {},
    baseline_tests: 0,
    baseline_perf_ms: 0,
    run_count: 0,
    updated_at: new Date().toISOString(),
  };
}

function saveState(state: EvalState) {
  state.updated_at = new Date().toISOString();
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// ── Phase 1: Build Gate ──
// NOTE: execSync calls below use only hardcoded command strings — no user input.

function runBuild(): boolean {
  log("PHASE: Build");
  try {
    execSync("npm run build", { cwd: ROOT, stdio: "pipe", timeout: 120_000 });
    log("  PASS — build succeeded");
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`  FAIL — build failed: ${msg.slice(0, 200)}`);
    return false;
  }
}

// ── Phase 2: Unit Test Gate ──

function runTests(state: EvalState): { passed: boolean; count: { passed: number; total: number } } {
  log("PHASE: Unit Tests");
  try {
    const output = execSync("npm run test -- --reporter=json", {
      cwd: ROOT,
      stdio: "pipe",
      timeout: 300_000,
    }).toString();

    // Parse vitest JSON output
    const jsonMatch = output.match(/\{[\s\S]*"testResults"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const total = parsed.numTotalTests ?? 0;
      const passed = parsed.numPassedTests ?? 0;
      log(`  ${passed}/${total} tests passed`);

      // Gate check: no regression below baseline
      if (state.baseline_tests > 0 && passed < state.baseline_tests) {
        log(`  FAIL — regression: ${passed} < baseline ${state.baseline_tests}`);
        return { passed: false, count: { passed, total } };
      }
      log("  PASS");
      return { passed: true, count: { passed, total } };
    }

    // Fallback: parse plain text output
    const summaryMatch = output.match(/Tests\s+(\d+)\s+passed.*?(\d+)\s+total/s);
    if (summaryMatch) {
      const passed = parseInt(summaryMatch[1], 10);
      const total = parseInt(summaryMatch[2], 10);
      log(`  ${passed}/${total} tests passed`);
      if (state.baseline_tests > 0 && passed < state.baseline_tests) {
        log(`  FAIL — regression: ${passed} < baseline ${state.baseline_tests}`);
        return { passed: false, count: { passed, total } };
      }
      log("  PASS");
      return { passed: true, count: { passed, total } };
    }

    // If we can't parse, assume tests passed (don't gate on parse failure)
    log("  WARN — could not parse test output, assuming pass");
    return { passed: true, count: { passed: 0, total: 0 } };
  } catch (err: unknown) {
    // Test command failed — try to extract counts from stderr
    const errObj = err as { stderr?: Buffer; stdout?: Buffer };
    const combined = String(errObj.stdout || "") + String(errObj.stderr || "");

    // Try to find pass/fail counts in vitest output
    const passMatch = combined.match(/(\d+)\s+passed/);
    const failMatch = combined.match(/(\d+)\s+failed/);
    const totalMatch = combined.match(/(\d+)\s+total/);

    if (passMatch && totalMatch) {
      const passed = parseInt(passMatch[1], 10);
      const total = parseInt(totalMatch[1], 10);
      const failed = failMatch ? parseInt(failMatch[1], 10) : total - passed;

      log(`  ${passed}/${total} tests passed (${failed} failed)`);
      if (state.baseline_tests > 0 && passed < state.baseline_tests) {
        log(`  FAIL — regression: ${passed} < baseline ${state.baseline_tests}`);
        return { passed: false, count: { passed, total } };
      }
      // Some tests failed, but not a regression — pass gate
      log("  PASS (failures present but no regression)");
      return { passed: true, count: { passed, total } };
    }

    log("  FAIL — test command failed");
    return { passed: false, count: { passed: 0, total: 0 } };
  }
}

// ── Phase 3: Fixture Tests ──

async function runFixtureTests(): Promise<{ results: FixtureResult[]; durationMs: number }> {
  log("PHASE: Fixture Tests");
  const fixtures = loadFixtures();
  log(`  Loaded ${fixtures.length} fixtures`);

  const results: FixtureResult[] = [];
  const suiteStart = performance.now();

  // Dynamic imports for tool utilities
  const { htmlToMarkdown } = await import("../src/utils/markdown.js");
  const { extractStructuredData } = await import("../src/utils/structured-data.js");
  const { isBlocked, needsJSRendering } = await import("../src/stealth/detector.js");
  const { detectAntiBot } = await import("../src/stealth/antibot-detector.js");
  const { parseHTML } = await import("linkedom");
  const { Readability, isProbablyReaderable } = await import("@mozilla/readability");

  for (const fixture of fixtures) {
    const start = performance.now();
    const errors: string[] = [];

    try {
      switch (fixture.tool) {
        case "scrape": {
          // Test htmlToMarkdown pipeline
          const markdown = htmlToMarkdown(fixture.html);
          validateOutput(markdown, fixture.expected, errors);
          break;
        }

        case "extract": {
          // Test CSS selector extraction using cheerio directly
          const cheerio = await import("cheerio");
          const $ = cheerio.load(fixture.html);
          const input = fixture.tool_input || {};
          const selectors = input.selectors as Record<string, string> | undefined;
          const itemsSelector = input.items_selector as string | undefined;

          if (itemsSelector && selectors) {
            const items: Record<string, string>[] = [];
            $(itemsSelector).each((_: number, el: cheerio.AnyNode) => {
              const item: Record<string, string> = {};
              for (const [field, selectorRaw] of Object.entries(selectors)) {
                const parts = selectorRaw.split(" @");
                const selector = parts[0].trim();
                const attr = parts[1]?.trim();
                const target = selector ? $(el).find(selector) : $(el);
                item[field] = attr ? target.attr(attr) || "" : target.text().trim();
              }
              items.push(item);
            });

            // Validate items
            const output = JSON.stringify(items);
            if (fixture.expected.contains) {
              for (const needle of fixture.expected.contains) {
                if (!output.includes(needle)) {
                  errors.push(`Missing expected content: "${needle}"`);
                }
              }
            }
            if (fixture.expected.min_item_count && items.length < fixture.expected.min_item_count) {
              errors.push(`Expected >= ${fixture.expected.min_item_count} items, got ${items.length}`);
            }
            if (fixture.expected.has_fields) {
              for (const field of fixture.expected.has_fields) {
                if (items.length > 0 && !(field in items[0])) {
                  errors.push(`Missing field: "${field}"`);
                }
              }
            }
          }
          break;
        }

        case "readability": {
          // Test readability extraction
          const { document } = parseHTML(fixture.html);
          const isReaderable = isProbablyReaderable(document as unknown as Document);

          if (fixture.expected.min_content_length === 0 && fixture.expected.contains?.length === 0) {
            // Non-article page — we expect it to NOT be readerable or return empty
            // Pass if readability correctly identifies it as non-article
            if (!isReaderable) {
              // Correct — page is not readerable
              break;
            }
          }

          if (isReaderable) {
            const reader = new Readability(document as unknown as Document, { charThreshold: 50 });
            const article = reader.parse();
            if (article) {
              // Combine title + content for validation (readability extracts title separately)
              const content = (article.title ? article.title + "\n" : "") + htmlToMarkdown(article.content);
              validateOutput(content, fixture.expected, errors);
            } else {
              if (fixture.expected.min_content_length && fixture.expected.min_content_length > 0) {
                errors.push("Readability returned null");
              }
            }
          } else {
            if (fixture.expected.min_content_length && fixture.expected.min_content_length > 0) {
              errors.push("Page not detected as readerable");
            }
          }
          break;
        }

        case "isBlocked": {
          const input = fixture.tool_input || {};
          const status = (input.status as number) || 200;
          const headers = (input.headers as Record<string, string>) || {};
          const blocked = isBlocked(fixture.html, status, headers);

          if (fixture.expected.expect_blocked !== undefined && blocked !== fixture.expected.expect_blocked) {
            errors.push(`isBlocked returned ${blocked}, expected ${fixture.expected.expect_blocked}`);
          }
          break;
        }

        case "needsJSRendering": {
          const needs = needsJSRendering(fixture.html);
          if (fixture.expected.expect_needs_js !== undefined && needs !== fixture.expected.expect_needs_js) {
            errors.push(`needsJSRendering returned ${needs}, expected ${fixture.expected.expect_needs_js}`);
          }
          break;
        }

        case "detectAntiBot": {
          const input = fixture.tool_input || {};
          const headers = (input.headers as Record<string, string>) || {};
          const cookies = (input.cookies as string[]) || [];
          const detection = detectAntiBot(headers, cookies, fixture.html);

          if (fixture.expected.expect_antibot && detection.system !== fixture.expected.expect_antibot) {
            errors.push(`detectAntiBot returned "${detection.system}", expected "${fixture.expected.expect_antibot}"`);
          }

          // Also check isBlocked for stealth fixtures
          if (fixture.expected.expect_blocked !== undefined) {
            const status = (input.status as number) || 403;
            const blocked = isBlocked(fixture.html, status, headers);
            if (blocked !== fixture.expected.expect_blocked) {
              errors.push(`isBlocked returned ${blocked}, expected ${fixture.expected.expect_blocked}`);
            }
          }
          break;
        }

        case "structuredData": {
          const data = extractStructuredData(fixture.html);
          const output = JSON.stringify(data);

          if (fixture.expected.has_structured_data) {
            if (data.jsonLd.length === 0 && Object.keys(data.openGraph).length === 0 && data.microdata.length === 0) {
              errors.push("No structured data found");
            }
          }

          if (fixture.expected.contains) {
            for (const needle of fixture.expected.contains) {
              if (!output.includes(needle)) {
                errors.push(`Missing in structured data: "${needle}"`);
              }
            }
          }
          break;
        }

        default:
          errors.push(`Unknown fixture tool: ${fixture.tool}`);
      }
    } catch (err: unknown) {
      errors.push(`Exception: ${err instanceof Error ? err.message : String(err)}`);
    }

    const duration = performance.now() - start;
    const passed = errors.length === 0;
    results.push({ id: fixture.id, passed, errors, duration_ms: Math.round(duration) });

    const icon = passed ? "PASS" : "FAIL";
    vlog(`${icon} ${fixture.id} (${Math.round(duration)}ms)${errors.length > 0 ? " — " + errors[0] : ""}`);
  }

  const totalDuration = performance.now() - suiteStart;
  const passedCount = results.filter((r) => r.passed).length;
  log(`  ${passedCount}/${results.length} fixtures passed (${Math.round(totalDuration)}ms)`);

  return { results, durationMs: Math.round(totalDuration) };
}

/**
 * Validate output string against expected fixture criteria.
 */
function validateOutput(output: string, expected: Fixture["expected"], errors: string[]) {
  if (expected.contains) {
    for (const needle of expected.contains) {
      if (!output.includes(needle)) {
        errors.push(`Missing expected content: "${needle}"`);
      }
    }
  }

  if (expected.not_contains) {
    for (const needle of expected.not_contains) {
      if (output.includes(needle)) {
        errors.push(`Unexpected content found: "${needle}"`);
      }
    }
  }

  if (expected.min_content_length && output.length < expected.min_content_length) {
    errors.push(`Content too short: ${output.length} < ${expected.min_content_length}`);
  }
}

// ── Phase 3: Workflow Benchmarks ──

function runWorkflowBenchmarks(): { results: WorkflowResult[]; score: number } {
  const workflows = loadWorkflows();
  if (workflows.length === 0) {
    log("  No workflows found");
    return { results: [], score: 0 };
  }

  const results: WorkflowResult[] = [];

  for (const workflow of workflows) {
    const start = performance.now();
    const errors: string[] = [];
    let stepsPassed = 0;
    const stepsTotal = workflow.steps.length;

    // Check env requirements — skip if missing
    if (workflow.requires_env) {
      const missing = workflow.requires_env.filter((env) => !process.env[env]);
      if (missing.length > 0) {
        log(`  SKIP ${workflow.id} (missing: ${missing.join(", ")})`);
        results.push({
          id: workflow.id,
          completed: false,
          steps_passed: 0,
          steps_total: stepsTotal,
          errors: [`Missing env: ${missing.join(", ")}`],
          duration_ms: 0,
        });
        continue;
      }
    }

    // Run each step
    for (const step of workflow.steps) {
      try {
        const args = [step.tool];

        // Build CLI args from step input
        const input = step.input as Record<string, unknown>;
        for (const [key, value] of Object.entries(input)) {
          if (typeof value === "boolean" && value) {
            args.push(`--${key}`);
          } else if (typeof value === "string") {
            args.push(`--${key}`, value);
          } else if (typeof value === "number") {
            args.push(`--${key}`, String(value));
          } else if (Array.isArray(value)) {
            for (const v of value) args.push(`--${key}`, String(v));
          }
        }

        const output = execSync(`npx imperium-crawl ${args.join(" ")}`, {
          cwd: ROOT,
          stdio: "pipe",
          timeout: 30_000,
        }).toString();

        // Validate step output
        const validate = step.validate;
        if (validate) {
          if (validate.has_content && output.trim().length === 0) {
            errors.push(`Step "${step.name}": no content`);
          } else if (validate.min_length && output.length < validate.min_length) {
            errors.push(`Step "${step.name}": too short (${output.length} < ${validate.min_length})`);
          } else if (validate.contains) {
            for (const needle of validate.contains) {
              if (!output.includes(needle)) {
                errors.push(`Step "${step.name}": missing "${needle}"`);
              }
            }
          }
        }

        stepsPassed++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Step "${step.name}": ${msg.slice(0, 80)}`);
      }
    }

    const duration = performance.now() - start;
    const completed = errors.length === 0 && stepsPassed === stepsTotal;

    results.push({
      id: workflow.id,
      completed,
      steps_passed: stepsPassed,
      steps_total: stepsTotal,
      errors,
      duration_ms: Math.round(duration),
    });

    const icon = completed ? "PASS" : "FAIL";
    log(`  ${icon} ${workflow.id} (${stepsPassed}/${stepsTotal} steps, ${Math.round(duration)}ms)${errors.length > 0 ? " — " + errors[0] : ""}`);
  }

  const score = scoreWorkflows(results);
  return { results, score };
}

// ── Phase 4: Live Benchmarks ──
// NOTE: execSync uses hardcoded commands with benchmark URLs (not user input)

async function runLiveBenchmarks(state: EvalState): Promise<{ results: LiveResult[]; score: number }> {
  const benchmarks = loadBenchmarks();
  if (benchmarks.length === 0) {
    log("  No benchmarks found");
    return { results: [], score: 0 };
  }

  const subset = selectSubset(benchmarks, LIVE_SUBSET_SIZE, state.run_count, FULL_SUITE_EVERY_N);
  log(`  Running ${subset.length}/${benchmarks.length} benchmarks`);

  const results: LiveResult[] = [];

  for (const benchmark of subset) {
    const start = performance.now();
    const errors: string[] = [];
    let passed = false;
    let partial = false;

    // Check browser requirements — skip (browser tool not yet integrated in eval harness)
    if ((benchmark as { requires_browser?: boolean }).requires_browser) {
      results.push({
        id: benchmark.id,
        difficulty: benchmark.difficulty,
        passed: false,
        partial: false,
        errors: [],
        skipped: true,
        skip_reason: "requires browser",
        duration_ms: 0,
      });
      continue;
    }

    // Check env requirements
    if (benchmark.requires_env) {
      let skipped = false;
      for (const env of benchmark.requires_env) {
        if (!process.env[env]) {
          results.push({
            id: benchmark.id,
            difficulty: benchmark.difficulty,
            passed: false,
            partial: false,
            errors: [`Missing env: ${env}`],
            skipped: true,
            skip_reason: `requires ${env}`,
            duration_ms: 0,
          });
          skipped = true;
          break;
        }
      }
      if (skipped) continue;
    }

    try {
      const tool = benchmark.tool;
      const url = benchmark.url;
      const input = benchmark.tool_input || {};

      // Build CLI args - tool name is hardcoded in benchmark, URL must be passed as --url
      const args = [tool, "--url", url];
      for (const [key, value] of Object.entries(input)) {
        if (key === "url") continue;
        if (typeof value === "boolean" && value) {
          args.push(`--${key}`);
        } else if (typeof value === "string") {
          args.push(`--${key}`, value);
        } else if (Array.isArray(value)) {
          for (const v of value) args.push(`--${key}`, String(v));
        }
      }

      // Run imperium-crawl with hardcoded tool name and benchmark URL
      const output = execSync(`npx imperium-crawl ${args.join(" ")}`, {
        cwd: ROOT,
        stdio: "pipe",
        timeout: 30_000,
      }).toString();

      // Validate output
      const expected = benchmark.expected;

      if (expected.contains) {
        for (const needle of expected.contains) {
          if (!output.includes(needle)) {
            errors.push(`Missing: "${needle}"`);
          }
        }
      }

      if (expected.min_content_length && output.length < expected.min_content_length) {
        errors.push(`Too short: ${output.length} < ${expected.min_content_length}`);
      }

      passed = errors.length === 0;
      partial = !passed && errors.length < (expected.contains?.length || 0);

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Failed: ${msg.slice(0, 80)}`);
      passed = false;
    }

    const duration = performance.now() - start;
    results.push({
      id: benchmark.id,
      difficulty: benchmark.difficulty,
      passed,
      partial,
      errors,
      skipped: false,
      duration_ms: Math.round(duration),
    });

    const icon = passed ? "PASS" : (partial ? "PARTIAL" : "FAIL");
    vlog(`${icon} ${benchmark.id} (${Math.round(duration)}ms)${errors.length > 0 ? " — " + errors[0] : ""}`);
  }

  const scoreResult = scoreLive(results, state);
  return { results, score: scoreResult.score };
}

// ── Phase 6: Doc Quality ──

function scoreDocQuality(): number {
  log("PHASE: Doc Quality");

  try {
    // Load all SKILL docs
    const skillDir = resolve(ROOT, "SKILL");
    const skillFiles = readdirSync(skillDir).filter((f) => f.endsWith(".md"));
    const allContent = skillFiles
      .map((f) => readFileSync(join(skillDir, f), "utf-8"))
      .join("\n");

    // Load tool names dynamically from the tools index
    const toolsIndex = readFileSync(resolve(ROOT, "src/tools/index.ts"), "utf-8");
    const toolNames = [...toolsIndex.matchAll(/import \* as (\w+) from/g)].map((m) => {
      // Convert camelCase to kebab-case for matching
      return m[1].replace(/([A-Z])/g, "-$1").toLowerCase().replace(/^-/, "");
    });

    // Load recipe names
    const recipesPath = resolve(ROOT, "src/recipes/index.ts");
    let recipeNames: string[] = [];
    if (existsSync(recipesPath)) {
      const recipesContent = readFileSync(recipesPath, "utf-8");
      recipeNames = [...recipesContent.matchAll(/import \{ (\w+) \}/g)].map((m) =>
        m[1].replace(/([A-Z])/g, "-$1").toLowerCase().replace(/^-/, ""),
      );
    }

    const score = scoreDocs(toolNames, allContent, recipeNames);
    log(`  doc_score: ${formatScore(score)} (${toolNames.length} tools, ${recipeNames.length} recipes)`);
    return score;
  } catch (err) {
    log(`  WARN — doc scoring error: ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }
}

// ── Main ──

async function main() {
  const evalStart = performance.now();
  log("═══════════════════════════════════════════");
  log(" imperium-crawl autoresearch eval");
  log("═══════════════════════════════════════════");

  const state = loadState();
  state.run_count++;

  // Phase 1: Build gate
  if (!runBuild()) {
    outputGated("build_failed", state, evalStart);
    return;
  }

  // Phase 2: Test gate
  const testResult = runTests(state);
  if (!testResult.passed) {
    outputGated("test_regression", state, evalStart, testResult.count);
    return;
  }

  // Phase 3: Fixture tests
  const { results: fixtureResults, durationMs: fixtureDuration } = await runFixtureTests();
  const fixtureScore = scoreFixtures(fixtureResults);

  // Phase 4: Live Benchmarks
  let liveScore = 0;
  let workflowScore = 0;
  const liveResults: LiveResult[] = [];
  const workflowResults: WorkflowResult[] = [];

  if (!fixtureOnly) {
    log("PHASE: Live Benchmarks");
    const { results, score } = await runLiveBenchmarks(state);
    liveResults.push(...results);
    liveScore = score;
    log(`  live_score: ${formatScore(liveScore)} (${results.filter(r => r.passed).length}/${results.length})`);

    log("PHASE: Workflows");
    const { results: wfResults, score: wfScore } = runWorkflowBenchmarks();
    workflowResults.push(...wfResults);
    workflowScore = wfScore;
    log(`  workflow_score: ${formatScore(workflowScore)} (${wfResults.filter((r) => r.completed).length}/${wfResults.length})`);
  }

  // Phase 6: Performance
  log("PHASE: Performance");
  const perfScore = scorePerformance(fixtureDuration, state.baseline_perf_ms || fixtureDuration);
  log(`  perf_score: ${formatScore(perfScore)} (${fixtureDuration}ms)`);

  // Phase 7: Tests score
  const testsScore = scoreTests(testResult.count.passed, state.baseline_tests || testResult.count.passed);

  // Phase 8: Doc quality
  const docScore = scoreDocQuality();

  // Composite
  const components: ComponentScores = {
    fixture: fixtureScore,
    live: liveScore,
    workflow: workflowScore,
    perf: perfScore,
    tests: testsScore,
    docs: docScore,
  };

  const compositeScore = computeComposite(components, false);
  const totalDuration = Math.round(performance.now() - evalStart);

  // Output
  log("");
  log("═══════════════════════════════════════════");
  log(` score:     ${formatScore(compositeScore)}`);
  log(` fixture:   ${formatScore(fixtureScore)} (${fixtureResults.filter((r) => r.passed).length}/${fixtureResults.length})`);
  log(` live:      ${formatScore(liveScore)}`);
  log(` workflow:  ${formatScore(workflowScore)}`);
  log(` perf:      ${formatScore(perfScore)}`);
  log(` tests:     ${testResult.count.passed}/${testResult.count.total}`);
  log(` docs:      ${formatScore(docScore)}`);
  log(` duration:  ${totalDuration}ms`);
  log("═══════════════════════════════════════════");

  // Set baseline if requested
  if (isBaseline) {
    state.baseline_tests = testResult.count.passed;
    state.baseline_perf_ms = fixtureDuration;
    log("");
    log(`Baseline set: tests=${state.baseline_tests}, perf=${state.baseline_perf_ms}ms`);
  }

  saveState(state);

  // Append to results.tsv
  appendResult(compositeScore, components, testResult.count, totalDuration, isBaseline ? "baseline" : "keep", "eval run");

  // Machine-readable last line for agents
  console.log(`\n__SCORE__:${formatScore(compositeScore)}`);
}

function outputGated(
  reason: string,
  state: EvalState,
  startTime: number,
  testCount?: { passed: number; total: number },
) {
  const totalDuration = Math.round(performance.now() - startTime);
  const components: ComponentScores = {
    fixture: 0, live: 0, workflow: 0, perf: 0, tests: 0, docs: 0,
  };

  log("");
  log("═══════════════════════════════════════════");
  log(` score:     0.000000 (GATED: ${reason})`);
  log(` duration:  ${totalDuration}ms`);
  log("═══════════════════════════════════════════");

  saveState(state);
  appendResult(0, components, testCount || { passed: 0, total: 0 }, totalDuration, "discard", `gated: ${reason}`);
  console.log("\n__SCORE__:0.000000");
}

function appendResult(
  score: number,
  components: ComponentScores,
  testCount: { passed: number; total: number },
  durationMs: number,
  status: "keep" | "discard" | "baseline",
  description: string,
) {
  // NOTE: hardcoded git command, no user input
  let commit = "unknown";
  try {
    commit = execSync("git rev-parse --short HEAD", { cwd: ROOT, stdio: "pipe" }).toString().trim();
  } catch { /* not a git repo or no commits */ }

  const line = formatResultsTsvLine(commit, score, components, testCount, durationMs, status, description);

  if (!existsSync(RESULTS_PATH)) {
    writeFileSync(RESULTS_PATH, RESULTS_TSV_HEADER + "\n");
  }
  writeFileSync(RESULTS_PATH, readFileSync(RESULTS_PATH, "utf-8") + line + "\n");
}

main().catch((err) => {
  console.error("FATAL:", err);
  console.log("\n__SCORE__:0.000000");
  process.exit(1);
});
