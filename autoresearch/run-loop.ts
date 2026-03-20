#!/usr/bin/env tsx
/**
 * Autoresearch Loop — MiniMax M2.7 powered autonomous scraper improvement engine.
 *
 * Reads program.md, analyzes current eval score, makes one targeted improvement,
 * runs eval, commits + pushes on improvement, discards on regression.
 *
 * Usage:
 *   npx tsx autoresearch/run-loop.ts              # default: 999999 iterations
 *   npx tsx autoresearch/run-loop.ts 50            # 50 iterations then stop
 *   npx tsx autoresearch/run-loop.ts unlimited     # run forever
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

// ── Config ──────────────────────────────────────────────────────────────────

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const EVAL_PATH = resolve(ROOT, "autoresearch/eval.ts");
const RESULTS_TSV = resolve(ROOT, "autoresearch/results.tsv");
const PROGRAM_MD = resolve(ROOT, "autoresearch/program.md");
const LOG_DIR = resolve(ROOT, "autoresearch/reports");

const MAX_ITERATIONS = process.argv[2] === "unlimited"
  ? Infinity
  : parseInt(process.argv[2] ?? "999999", 10);

const MINIMAX_API_KEY = (() => {
  if (process.env.MINIMAX_API_KEY) return process.env.MINIMAX_API_KEY;
  // Extract from LiteLLM config as fallback
  try {
    const config = readFileSync("/home/pavle/.litellm/config.yaml", "utf-8");
    const match = config.match(/api_key:\s+(\S+)/);
    if (match) return match[1];
  } catch { /* ignore */ }
  throw new Error("MINIMAX_API_KEY env not set");
})();

const API_BASE = "https://api.minimax.io/anthropic/v1";

// ── Logging ────────────────────────────────────────────────────────────────

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  const line = `[${ts}] ${msg}`;
  console.log(line);
  mkdirSync(LOG_DIR, { recursive: true });
  const logFile = join(LOG_DIR, `loop-${new Date().toISOString().slice(0, 10)}.log`);
  writeFileSync(logFile, line + "\n", { flag: "a" });
}

// ── MiniMax API ────────────────────────────────────────────────────────────

async function chat(messages: { role: string; content: string }[]): Promise<string> {
  const url = `${API_BASE}/messages`;
  const body = {
    model: "MiniMax-M2.7",
    max_tokens: 4096,
    messages,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${MINIMAX_API_KEY}`,
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MiniMax API error ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json() as { content: { type: string; text?: string }[] };
  // Skip thinking blocks, extract only text content
  const text = data.content
    ?.filter(c => c.type === "text")
    .map(c => c.text ?? "")
    .join("\n")
    .trim() ?? "";
  return text;
}

// ── Shell helpers (all inputs are hardcoded, safe) ─────────────────────────

function runEval(): { score: number; fixture: number; live: number; workflow: number; output: string } {
  try {
    const output = execSync("npx tsx " + EVAL_PATH + " --verbose", {
      cwd: ROOT,
      stdio: "pipe",
      timeout: 300_000,
    }).toString();

    const scoreMatch = output.match(/__SCORE__:(\d+\.\d+)/);
    const fixtureMatch = output.match(/fixture:\s+(\d+\.\d+)/);
    const liveMatch = output.match(/live:\s+(\d+\.\d+)/);
    const workflowMatch = output.match(/workflow:\s+(\d+\.\d+)/);

    return {
      score: scoreMatch ? parseFloat(scoreMatch[1]) : 0,
      fixture: fixtureMatch ? parseFloat(fixtureMatch[1]) : 0,
      live: liveMatch ? parseFloat(liveMatch[1]) : 0,
      workflow: workflowMatch ? parseFloat(workflowMatch[1]) : 0,
      output,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log("EVAL FAILED: " + msg.slice(0, 200));
    return { score: 0, fixture: 0, live: 0, workflow: 0, output: msg };
  }
}

function getCurrentScore(): number {
  if (!existsSync(RESULTS_TSV)) return 0;
  const lines = readFileSync(RESULTS_TSV, "utf-8").trim().split("\n");
  if (lines.length < 2) return 0;
  const last = lines[lines.length - 1];
  const parts = last.split("\t");
  return parseFloat(parts[2] ?? "0") || 0;
}

function gitAddCommitPush(description: string, score: number) {
  try {
    const msg = "autoresearch: " + description + " (score: " + score.toFixed(6) + ")";
    execSync("git add -A", { cwd: ROOT, stdio: "pipe" });
    execSync("git commit -m \"" + msg + "\"", { cwd: ROOT, stdio: "pipe" });
    execSync("git push", { cwd: ROOT, stdio: "pipe", timeout: 30_000 });
    log("COMMIT + PUSH: " + msg);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log("Git failed: " + msg.slice(0, 150));
  }
}

function discardChanges() {
  try {
    execSync("git checkout -- .", { cwd: ROOT, stdio: "pipe" });
    log("Changes discarded");
  } catch { /* ignore */ }
}

function getGitDiffCount(): number {
  try {
    const out = execSync("git diff --stat", { cwd: ROOT, stdio: "pipe" }).toString();
    // Count non-empty lines in diff output
    const lines = out.trim().split("\n").filter(l => l.length > 0);
    return lines.length;
  } catch { return 0; }
}

// ── Prompt builder ─────────────────────────────────────────────────────────

function buildPrompt(programMd: string, currentScore: number, evalOutput: string): string {
  return `You are an elite autonomous research agent improving imperium-crawl — the world's most advanced open-source web scraping CLI toolkit.

Read this program carefully:
${programMd}

CURRENT EVALUATION OUTPUT (last 4000 chars):
${evalOutput.slice(-4000)}

CURRENT SCORE: ${currentScore.toFixed(6)}

Your task: Make ONE small, high-impact code change that will improve the score.

Rules:
- NEVER modify anything in autoresearch/ directory (SACRED — it's the eval harness)
- You CAN modify: src/**, SKILL/**, tests/**
- ONE change per iteration — focused, surgical, not sprawling
- Read source files before modifying them
- After making the change, run \`npx tsx ${EVAL_PATH} --verbose\` to measure
- If score improved: use git to commit and push:
  git add -A && git commit -m "autoresearch: <description> (score: X.XXXXXX)" && git push
- If score decreased or same: run \`git checkout -- .\` to discard

CRITICAL: You MUST actually edit source files and run the eval harness. Do not just describe what you would do — actually do it.

Priority based on current score:
${currentScore < 0.7 ? "- LIVE SCORE is the bottleneck: improve stealth, anti-bot, user-agent rotation, header spoofing, fingerprint randomization" : ""}
${currentScore < 0.8 ? "- WORKFLOW score can improve: fix failing workflows, make tool chains more robust" : ""}
${currentScore < 0.85 ? "- Focus on workflow + live — those have the most weight remaining" : ""}
${currentScore >= 0.9 ? "- Near-perfect! Push to 1.0: add new tools (pdf extraction, graphql query, watch/monitor), expand stealth, improve fixture parsing" : ""}

Go. Analyze the eval output, find the weakest component, make ONE targeted fix, run eval, commit or discard.`;
}

// ── Main loop ──────────────────────────────────────────────────────────────

async function main() {
  log("═══════════════════════════════════════════");
  log("AUTORESEARCH LOOP — MiniMax M2.7");
  log("Max iterations: " + (MAX_ITERATIONS === Infinity ? "unlimited" : MAX_ITERATIONS));
  log("═══════════════════════════════════════════");

  const programMd = readFileSync(PROGRAM_MD, "utf-8");
  let currentScore = getCurrentScore();
  log("Starting score: " + currentScore.toFixed(6));

  let iteration = 0;

  while (iteration < MAX_ITERATIONS) {
    iteration++;
    log("");
    log("─── Iteration " + iteration + " ───────────────────────");

    // Run current eval to analyze state
    log("Running eval...");
    const { score, output } = runEval();
    currentScore = score;
    log("Current score: " + score.toFixed(6));

    // Build improvement prompt
    const prompt = buildPrompt(programMd, score, output);

    // Call MiniMax
    log("Calling MiniMax M2.7...");
    try {
      const response = await chat([
        { role: "user", content: prompt },
      ]);
      log("MiniMax response: " + response.length + " chars");

      // Check if git has changes
      const diffCount = getGitDiffCount();
      if (diffCount > 0) {
        log("Files were modified. Running eval to verify...");
        const { score: newScore } = runEval();
        if (newScore > score) {
          gitAddCommitPush("iteration " + iteration + " improvement", newScore);
        } else {
          log("Score unchanged/decreased (" + newScore.toFixed(6) + " vs " + score.toFixed(6) + "). Discarding.");
          discardChanges();
        }
      } else {
        log("No files modified by model.");
      }

      // Extract reported score
      const scoreMatch = response.match(/__SCORE__:(\d+\.\d+)/);
      if (scoreMatch) {
        log("Model reported score: " + parseFloat(scoreMatch[1]).toFixed(6));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log("ERROR: " + msg.slice(0, 300));
    }

    // Cooldown between iterations
    await new Promise((r) => setTimeout(r, 5000));
  }

  log("");
  log("═══════════════════════════════════════════");
  log("Loop complete — " + iteration + " iterations");
  log("Final score: " + getCurrentScore().toFixed(6));
  log("═══════════════════════════════════════════");
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
