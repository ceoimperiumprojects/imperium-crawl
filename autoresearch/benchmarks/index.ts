/**
 * SACRED — Do not modify during autoresearch runs.
 * Loads all live benchmark JSON files.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { LiveBenchmark, Workflow } from "../types.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const BENCHMARK_FILES = ["easy.json", "medium.json", "hard.json", "nightmare.json"];
const WORKFLOW_FILE = "workflows.json";

/**
 * Load all live benchmarks from JSON files.
 */
export function loadBenchmarks(): LiveBenchmark[] {
  const benchmarks: LiveBenchmark[] = [];

  for (const file of BENCHMARK_FILES) {
    const filePath = resolve(__dirname, file);
    if (!existsSync(filePath)) continue;

    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as LiveBenchmark[];
    benchmarks.push(...parsed);
  }

  return benchmarks;
}

/**
 * Load workflow benchmarks.
 */
export function loadWorkflows(): Workflow[] {
  const filePath = resolve(__dirname, WORKFLOW_FILE);
  if (!existsSync(filePath)) return [];

  const raw = readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as Workflow[];
}

/**
 * Select a rotating subset of benchmarks.
 * Full suite every Nth run, otherwise random subset.
 */
export function selectSubset(
  benchmarks: LiveBenchmark[],
  subsetSize: number,
  runCount: number,
  fullSuiteEveryN: number,
): LiveBenchmark[] {
  if (runCount % fullSuiteEveryN === 0) return benchmarks;
  if (benchmarks.length <= subsetSize) return benchmarks;

  // Deterministic but varying selection based on run count
  const shuffled = [...benchmarks].sort((a, b) => {
    const hashA = simpleHash(a.id + runCount);
    const hashB = simpleHash(b.id + runCount);
    return hashA - hashB;
  });

  return shuffled.slice(0, subsetSize);
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}
