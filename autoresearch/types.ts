/**
 * SACRED — Do not modify during autoresearch runs.
 * Type definitions for the autoresearch evaluation harness.
 */

// ── Fixture Types ──

export interface FixtureExpected {
  /** Strings that MUST appear in tool output */
  contains?: string[];
  /** Strings that must NOT appear in tool output */
  not_contains?: string[];
  /** Minimum content length (chars) */
  min_content_length?: number;
  /** Whether structured data (JSON-LD/OG) should be present */
  has_structured_data?: boolean;
  /** Expected item count for extract tool */
  item_count?: number;
  /** Minimum item count (for variable results) */
  min_item_count?: number;
  /** Expected fields in extracted items */
  has_fields?: string[];
  /** Whether isBlocked() should return true */
  expect_blocked?: boolean;
  /** Whether needsJSRendering() should return true */
  expect_needs_js?: boolean;
  /** Expected anti-bot system */
  expect_antibot?: string;
}

export interface Fixture {
  id: string;
  category: "scraping" | "extraction" | "readability" | "edge-cases" | "stealth";
  description: string;
  /** Original URL for context (not fetched) */
  url: string;
  /** Raw HTML content to feed to tool functions */
  html: string;
  /** Which tool/utility to test */
  tool: "scrape" | "extract" | "readability" | "isBlocked" | "needsJSRendering" | "detectAntiBot" | "structuredData";
  /** Tool-specific input params (selectors, format, etc.) */
  tool_input?: Record<string, unknown>;
  /** Expected outputs for scoring */
  expected: FixtureExpected;
}

// ── Benchmark Types ──

export type BenchmarkDifficulty = "easy" | "medium" | "hard" | "nightmare";

export interface LiveBenchmark {
  id: string;
  difficulty: BenchmarkDifficulty;
  /** Real URL to fetch */
  url: string;
  /** Tool name from allTools */
  tool: string;
  /** Tool input params */
  tool_input: Record<string, unknown>;
  /** Validation checks */
  expected: {
    /** Strings that should appear in output */
    contains?: string[];
    /** Minimum content length */
    min_content_length?: number;
    /** Should not be blocked */
    expect_success?: boolean;
    /** Expected item count range */
    min_items?: number;
  };
  /** Skip if env var not set */
  requires_env?: string[];
  /** Skip if Playwright not available */
  requires_browser?: boolean;
}

// ── Workflow Types ──

export interface WorkflowStep {
  name: string;
  tool: string;
  input: Record<string, unknown>;
  /** Validate step output */
  validate?: {
    has_content?: boolean;
    min_length?: number;
    contains?: string[];
  };
  /** Extract value from result for next step */
  extract?: string;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  /** Required env vars */
  requires_env?: string[];
  requires_browser?: boolean;
}

// ── Scoring Types ──

export interface ComponentScores {
  fixture: number;
  live: number;
  workflow: number;
  perf: number;
  tests: number;
  docs: number;
}

export interface EvalResult {
  score: number;
  components: ComponentScores;
  test_count: { passed: number; total: number };
  fixture_details: FixtureResult[];
  live_details: LiveResult[];
  workflow_details: WorkflowResult[];
  duration_ms: number;
  timestamp: string;
  gated: boolean;
  gate_reason?: string;
}

export interface FixtureResult {
  id: string;
  passed: boolean;
  errors: string[];
  duration_ms: number;
}

export interface LiveResult {
  id: string;
  difficulty: BenchmarkDifficulty;
  passed: boolean;
  partial: boolean;
  errors: string[];
  skipped: boolean;
  skip_reason?: string;
  duration_ms: number;
}

export interface WorkflowResult {
  id: string;
  completed: boolean;
  steps_passed: number;
  steps_total: number;
  errors: string[];
  duration_ms: number;
}

// ── State Types ──

export interface EvalState {
  /** EMA-smoothed live scores per benchmark */
  live_ema: Record<string, number>;
  /** Baseline test count */
  baseline_tests: number;
  /** Baseline fixture suite duration (ms) */
  baseline_perf_ms: number;
  /** Run counter for full-suite rotation */
  run_count: number;
  /** Last updated */
  updated_at: string;
}

// ── Scoring Constants ──

export const WEIGHTS = {
  fixture: 0.30,
  live: 0.25,
  workflow: 0.15,
  perf: 0.10,
  tests: 0.10,
  docs: 0.10,
} as const;

export const DIFFICULTY_MULTIPLIERS: Record<BenchmarkDifficulty, number> = {
  easy: 0.5,
  medium: 1.0,
  hard: 2.0,
  nightmare: 3.0,
};

export const EMA_ALPHA = 0.3;
export const LIVE_RETRY_COUNT = 2;
export const LIVE_RETRY_BACKOFF_MS = 3000;
export const LIVE_SUBSET_SIZE = 10;
export const FULL_SUITE_EVERY_N = 10;
