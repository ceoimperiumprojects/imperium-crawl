#!/usr/bin/env tsx
/**
 * Autoresearch Loop — MiniMax M2.7 powered autonomous scraper improvement engine.
 * Uses tool-use for file editing + code execution.
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
  try {
    const config = readFileSync("/home/pavle/.litellm/config.yaml", "utf-8");
    const match = config.match(/api_key:\s+(\S+)/);
    if (match) return match[1];
  } catch { /* ignore */ }
  throw new Error("MINIMAX_API_KEY env not set");
})();

const API_BASE = "https://api.minimax.io/anthropic/v1";

// ── Logging ────────────────────────────────────────────────────────────────

let logFilePath = "";

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  const line = `[${ts}] ${msg}`;
  console.log(line);
  if (logFilePath) {
    writeFileSync(logFilePath, line + "\n", { flag: "a" });
  }
}

// ── Tool Implementations ───────────────────────────────────────────────────

type ToolInput = Record<string, unknown>;

async function toolRead(input: ToolInput): Promise<string> {
  const file_path = (input.file_path as string) || (input.path as string);
  const absPath = file_path.startsWith("/") ? file_path : resolve(ROOT, file_path);
  if (!existsSync(absPath)) return "File not found: " + absPath;
  const content = readFileSync(absPath, "utf-8");
  const limit = (input.limit as number) || 200;
  const offset = (input.offset as number) || 1;
  const lines = content.split("\n");
  if (offset > lines.length) return "Offset beyond file length";
  return lines.slice(offset - 1, offset - 1 + limit).join("\n");
}

async function toolGrep(input: ToolInput): Promise<string> {
  const pattern = input.pattern as string;
  const path = (input.path as string) || ROOT;
  const glob = input.glob as string;
  const output_mode = (input.output_mode as string) || "content";
  if (!pattern) return "No pattern provided";
  try {
    const args = [pattern];
    if (glob) args.push("--glob", glob);
    args.push(path || ROOT);
    const result = execSync("rg -n --no-ignore " + args.join(" "), { cwd: ROOT, stdio: "pipe", timeout: 10000 }).toString();
    if (!result.trim()) return "No matches found";
    const lines = result.trim().split("\n");
    return lines.slice(0, 80).join("\n");
  } catch (err: unknown) {
    return "No matches found: " + (err instanceof Error ? err.message.slice(0, 50) : "");
  }
}

async function toolGlob(input: ToolInput): Promise<string> {
  const pattern = input.pattern as string;
  if (!pattern) return "";
  try {
    // Convert glob to find-compatible pattern
    // e.g. "src/**/*.ts" -> "src"
    const baseDir = pattern.replace(/\*\*.*$/, "").replace(/\/$/, "") || ".";
    const ext = pattern.match(/\.(\w+)$/)?.[1] || "*";
    const result = execSync("find " + baseDir + " -name '*." + ext + "' 2>/dev/null | head -50", {
      cwd: ROOT, stdio: "pipe", timeout: 10000,
    }).toString();
    return result.trim();
  } catch { return ""; }
}

async function toolEdit(input: ToolInput): Promise<string> {
  const file_path = (input.path as string) || (input.file_path as string);
  const old_string = input.old_string as string;
  const new_string = input.new_string as string;
  if (!file_path || !old_string || new_string === undefined) {
    return "Missing required: file_path, old_string, new_string";
  }
  const absPath = resolve(ROOT, file_path);
  if (!existsSync(absPath)) return "File not found: " + absPath;
  const content = readFileSync(absPath, "utf-8");
  if (!content.includes(old_string)) {
    return "ERROR: old_string not found in file. Check the file content first with Read tool.";
  }
  const newContent = content.replace(old_string, new_string as string);
  writeFileSync(absPath, newContent, "utf-8");
  return "Edit applied successfully to " + absPath;
}

async function toolWrite(input: ToolInput): Promise<string> {
  const file_path = (input.path as string) || (input.file_path as string);
  const content = input.content as string;
  if (!file_path || content === undefined) return "Missing required: file_path, content";
  const absPath = resolve(ROOT, file_path);
  writeFileSync(absPath, content, "utf-8");
  return "Written successfully to " + absPath;
}

async function toolBash(input: ToolInput): Promise<string> {
  const command = input.command as string;
  const timeout = (input.timeout as number) || 60000;
  // Only allow specific safe commands
  const allowed = [
    "npx tsx", "npm run", "npm test", "npm build",
    "git add", "git commit", "git push", "git checkout", "git status", "git diff", "git log",
    "rg ", "find ", "ls ", "cat ", "head ", "tail ", "wc ",
  ];
  if (!allowed.some(prefix => command.trim().startsWith(prefix))) {
    return "Command not allowed: " + command.trim().slice(0, 50);
  }
  try {
    const result = execSync(command, { cwd: ROOT, stdio: "pipe", timeout });
    return result.toString().slice(0, 5000);
  } catch (err: unknown) {
    return "Error: " + (err instanceof Error ? err.message.slice(0, 200) : String(err));
  }
}

async function toolRunEval(input: ToolInput): Promise<string> {
  const verbose = input.verbose !== false;
  try {
    const cmd = "npx tsx " + EVAL_PATH + " " + (verbose ? "--verbose" : "");
    const output = execSync(cmd, { cwd: ROOT, stdio: "pipe", timeout: 300000 }).toString();
    const scoreMatch = output.match(/__SCORE__:(\d+\.\d+)/);
    const score = scoreMatch ? parseFloat(scoreMatch[1]) : 0;
    return "SCORE: " + score.toFixed(6) + "\n" + output.slice(-2000);
  } catch (err: unknown) {
    return "EVAL FAILED: " + (err instanceof Error ? err.message.slice(0, 300) : String(err));
  }
}

async function executeTool(name: string, input: ToolInput): Promise<string> {
  switch (name) {
    case "Read": return toolRead(input);
    case "Grep": return toolGrep(input);
    case "Glob": return toolGlob(input);
    case "Edit": return toolEdit(input);
    case "Write": return toolWrite(input);
    case "Bash": return toolBash(input);
    case "run_eval": return toolRunEval(input);
    default: return "Unknown tool: " + name;
  }
}

// ── MiniMax API with Tool Use ──────────────────────────────────────────────

const TOOL_DEFINITIONS = [
  {
    name: "Read",
    description: "Read file contents. Use offset/limit for partial reads.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path (absolute or relative to project root)" },
        offset: { type: "number", description: "Line number to start from (1-indexed)" },
        limit: { type: "number", description: "Max lines to read (default 200)" },
      },
      required: ["path"],
    },
  },
  {
    name: "Grep",
    description: "Search file contents with ripgrep.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string" },
        glob: { type: "string" },
        output_mode: { type: "string", enum: ["content", "files_with_matches"] },
      },
      required: ["pattern"],
    },
  },
  {
    name: "Glob",
    description: "Find files matching a glob pattern.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "Edit",
    description: "Replace old_string with new_string in a file. old_string must match exactly (including whitespace).",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path" },
        file_path: { type: "string", description: "File path" },
        old_string: { type: "string" },
        new_string: { type: "string" },
      },
      required: ["old_string", "new_string"],
    },
  },
  {
    name: "Write",
    description: "Write complete file content (overwrites existing).",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path" },
        file_path: { type: "string", description: "File path" },
        content: { type: "string" },
      },
      required: ["content"],
    },
  },
  {
    name: "Bash",
    description: "Run a shell command. Only safe commands allowed.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string" },
        timeout: { type: "number" },
      },
      required: ["command"],
    },
  },
  {
    name: "run_eval",
    description: "Run the autoresearch eval harness and return score.",
    input_schema: {
      type: "object",
      properties: {
        verbose: { type: "boolean" },
      },
    },
  },
];

interface ToolCall {
  name: string;
  input: ToolInput;
  id?: string;
}

interface Message {
  role: "user" | "assistant";
  content: string | { type: string; [key: string]: unknown }[];
}

async function chatWithTools(
  messages: Message[],
  maxTokens = 8192,
): Promise<{ text: string; toolCalls: ToolCall[] }> {
  const url = `${API_BASE}/messages`;
  const body = {
    model: "MiniMax-M2.7",
    max_tokens: maxTokens,
    tools: TOOL_DEFINITIONS,
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
    throw new Error(`API error ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json() as {
    content: { type: string; name?: string; input?: ToolInput; text?: string }[];
    stop_reason: string;
  };

  const toolCalls: ToolCall[] = [];
  let text = "";

  for (const block of data.content) {
    if (block.type === "text") {
      text += (block.text ?? "") + "\n";
    } else if (block.type === "tool_use" && block.name && block.input) {
      toolCalls.push({
        name: block.name,
        input: block.input,
        id: (block as { id?: string }).id,
      });
    }
  }

  return { text: text.trim(), toolCalls };
}

// ── Shell helpers ──────────────────────────────────────────────────────────

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
    execSync("git push", { cwd: ROOT, stdio: "pipe", timeout: 60000 });
    log("COMMIT + PUSH: " + msg);
  } catch (err: unknown) {
    log("Git failed: " + (err instanceof Error ? err.message.slice(0, 150) : String(err)));
  }
}

function discardChanges() {
  try {
    execSync("git checkout -- .", { cwd: ROOT, stdio: "pipe" });
    log("Changes discarded");
  } catch { /* ignore */ }
}

function hasChanges(): boolean {
  try {
    const out = execSync("git status --short", { cwd: ROOT, stdio: "pipe" }).toString().trim();
    return out.length > 0;
  } catch { return false; }
}

function runEvalScore(): number {
  try {
    const output = execSync("npx tsx " + EVAL_PATH + " --verbose", {
      cwd: ROOT,
      stdio: "pipe",
      timeout: 300000,
    }).toString();
    const m = output.match(/__SCORE__:(\d+\.\d+)/);
    return m ? parseFloat(m[1]) : 0;
  } catch { return 0; }
}

function runEvalFull(): { score: number; output: string; fixture: number; live: number; workflow: number; perf: number } {
  try {
    const output = execSync("npx tsx " + EVAL_PATH + " --verbose", {
      cwd: ROOT,
      stdio: "pipe",
      timeout: 300000,
    }).toString();
    const score = parseFloat((output.match(/__SCORE__:(\d+\.\d+)/) ?? ["", "0"])[1]);
    const fixture = parseFloat((output.match(/fixture:\s+(\d+\.\d+)/) ?? ["", "0"])[1]);
    const live = parseFloat((output.match(/live:\s+(\d+\.\d+)/) ?? ["", "0"])[1]);
    const workflow = parseFloat((output.match(/workflow:\s+(\d+\.\d+)/) ?? ["", "0"])[1]);
    const perf = parseFloat((output.match(/perf:\s+(\d+\.\d+)/) ?? ["", "0"])[1]);
    return { score, output, fixture, live, workflow, perf };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { score: 0, output: "EVAL FAILED: " + msg.slice(0, 200), fixture: 0, live: 0, workflow: 0, perf: 0 };
  }
}

// ── Prompt builder ─────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `You are an elite autonomous research agent improving imperium-crawl — the world's most advanced open-source web scraping CLI toolkit.

EXACT WORKFLOW (follow step by step):
1. READ: Read ./autoresearch/program.md
2. RUN EVAL: Call run_eval tool with {verbose: true}
3. ANALYZE: Read the eval output from the tool result. Find the weakest component.
4. READ CODE: Use Read tool to read relevant source files (use RELATIVE paths like "src/utils/markdown.ts")
5. MAKE ONE CHANGE: Use Edit tool to modify one small thing
6. RUN EVAL AGAIN: Call run_eval tool
7. IF IMPROVED: Call Bash with command="git add -A && git commit -m \"autoresearch: <desc> (score: X)\" && git push"
8. IF NOT IMPROVED: Call Bash with command="git checkout -- ."

CRITICAL RULES:
- NEVER modify anything in ./autoresearch/ directory (SACRED)
- You CAN modify: src/**, SKILL/**, tests/** (relative paths from project root)
- ONE targeted change per iteration — pick ONE thing and fix it well
- NEVER break the build
- NEVER delete existing tests
- ALWAYS run eval before and after changes

The project root is: ${ROOT}
For Read/Edit/Write tools, use RELATIVE paths from the project root.
Example: Read {path: "src/utils/markdown.ts"}
Example: Edit {path: "src/utils/markdown.ts", old_string: "...", new_string: "..."}

Available tools: Read, Grep, Glob, Edit, Write, Bash, run_eval`;
}

function buildUserPrompt(
  currentScore: number,
  evalOutput: string,
  fixture: number,
  live: number,
  workflow: number,
  perf: number,
): string {
  // Pre-analyze: find the most impactful single improvement
  const failLines = evalOutput.match(/  FAIL .+/g) ?? [];
  const passLines = evalOutput.match(/  PASS .+/g) ?? [];

  // Pick ONE actionable fix
  let action = "";

  // Check for wikipedia timeout (most common failure)
  if (evalOutput.includes("wikipedia-readability") || evalOutput.includes("wikipedia-deep")) {
    if (evalOutput.includes("ETIMEDOUT")) {
      action = `TASK: The "wikipedia-deep" workflow and "wikipedia-readability" live benchmark are timing out at 30s.
Fix: Read "src/constants.ts" and increase DEFAULT_TIMEOUT_MS from 30_000 to 60_000.
Also check if "autoresearch/eval.ts" has hardcoded 30_000 timeout and increase it.`;
    }
  }

  // Check for lobsters extract failure
  if (evalOutput.includes("lobsters-extract") || evalOutput.includes("lobsters_stories")) {
    if (evalOutput.includes("Command failed") || evalOutput.includes("Failed")) {
      action = `TASK: The "lobsters-extract" live benchmark and "hn-recipe-follow" workflow are failing.
Fix: Read "src/tools/extract.ts" and check why the '.story' selector might not be matching.
Lobsters uses CSS class "story" for each story item. Make sure the extract tool handles this correctly.`;
    }
  }

  // Check for live score being low
  if (live < 0.9 && !action) {
    action = `TASK: Live score is ${live.toFixed(3)} — improve stealth/scraping.
Read "src/stealth/headers.ts" and add more realistic browser headers.
Or read "src/stealth/detector.ts" and improve anti-bot detection bypass.`;
  }

  // Check for workflow score
  if (workflow < 0.8 && !action) {
    action = `TASK: Workflow score is ${workflow.toFixed(3)} — improve multi-step chains.
Read "src/tools/run-skill.ts" and check for error handling issues.
Improve error messages and fallback behavior.`;
  }

  // Default: improve fixture
  if (!action) {
    action = `TASK: Fixture/other score needs improvement.
Read "src/utils/markdown.ts" and improve HTML-to-markdown conversion.
Look for NOISE_SELECTORS that could be expanded to remove more boilerplate.`;
  }

  return `You are improving imperium-crawl. Make ONE targeted code change.

CURRENT SCORES:
  Overall: ${currentScore.toFixed(6)}
  Fixture: ${fixture.toFixed(6)} | Live: ${live.toFixed(6)} | Workflow: ${workflow.toFixed(6)} | Perf: ${perf.toFixed(6)}

${failLines.length > 0 ? "FAILING:\n" + failLines.slice(0, 5).join("\n") + "\n" : ""}

${action}

WORKFLOW:
1. Read the relevant source file(s) I identified above
2. Make ONE targeted Edit (replace old_string with new_string)
3. Call run_eval {verbose:true} to measure
4. If score improved: Bash with command="git add -A && git commit -m \"autoresearch: <short desc> (score: X)\" && git push"
5. If not improved: Bash with command="git checkout -- ."

RULES:
- NEVER modify ./autoresearch/** (SACRED)
- ONE edit only — pick the most impactful single change
- Never break the build (npm run build must pass)
- Use RELATIVE paths from project root

Project root: ${ROOT}`;
}

// ── Main loop ──────────────────────────────────────────────────────────────

async function main() {
  // Setup logging
  mkdirSync(LOG_DIR, { recursive: true });
  logFilePath = join(LOG_DIR, `loop-${new Date().toISOString().slice(0, 10)}.log`);

  log("═══════════════════════════════════════════");
  log("AUTORESEARCH LOOP — MiniMax M2.7 + TOOL-USE");
  log("Max iterations: " + (MAX_ITERATIONS === Infinity ? "unlimited" : MAX_ITERATIONS));
  log("═══════════════════════════════════════════");

  let currentScore = getCurrentScore();
  log("Starting score: " + currentScore.toFixed(6));

  let iteration = 0;

  while (iteration < MAX_ITERATIONS) {
    iteration++;
    log("");
    log("─── Iteration " + iteration + " ───────────────────────");

    // ── Step 1: Run eval BEFORE MiniMax sees anything ──
    log("Running eval to get current state...");
    const { score: baselineScore, output: evalOutput, fixture, live, workflow, perf } = runEvalFull();
    currentScore = baselineScore;
    log("Current score: " + currentScore.toFixed(6) + " | live=" + live.toFixed(3) + " workflow=" + workflow.toFixed(3));

    // ── Step 2: Clear messages, build prompt with eval results ──
    const messages: Message[] = [];
    const userContent = buildUserPrompt(baselineScore, evalOutput, fixture, live, workflow, perf);
    messages.push({ role: "user", content: userContent });

    // Multi-turn tool loop
    let turnCount = 0;
    const MAX_TURNS = 30; // max tool calls per iteration

    while (turnCount < MAX_TURNS) {
      turnCount++;
      log("MiniMax turn " + turnCount + "...");

      const { text, toolCalls } = await chatWithTools(messages, 8192);

      if (text) {
        log("Model text: " + text.slice(0, 200));
      }

      if (toolCalls.length === 0) {
        // No more tool calls — model is done
        log("Model finished (no more tool calls)");
        break;
      }

      // Push assistant message with tool_use blocks BEFORE sending tool results
      messages.push({
        role: "assistant",
        content: toolCalls.map((tc) => ({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: tc.input,
        })),
      });

      // Execute tool calls
      for (const tc of toolCalls) {
        log("Tool: " + tc.name + " " + JSON.stringify(tc.input).slice(0, 100));
        try {
          const result = await executeTool(tc.name, tc.input);
          const truncated = result.slice(0, 3000);
          log("Result: " + truncated.replace(/\n/g, " | ").slice(0, 200));
          // Push tool result as user message with proper Anthropic content blocks
          // tool_use_id MUST match the id from the tool_use block
          messages.push({
            role: "user",
            content: [{
              type: "tool_result",
              tool_use_id: tc.id ?? "call_" + tc.name + "_" + Date.now(),
              content: truncated,
            }],
          });
        } catch (err: unknown) {
          const msg = "ERROR: " + (err instanceof Error ? err.message.slice(0, 200) : String(err));
          log(msg);
          // Push tool error as user message (proper format for tool results)
          messages.push({
            role: "user",
            content: [{
              type: "tool_result",
              tool_use_id: tc.id ?? "call_" + tc.name + "_" + Date.now(),
              content: msg,
            }],
          });
        }
      }
    }

    // After all tool calls, check git status
    if (hasChanges()) {
      log("Files modified — running final eval to confirm...");
      const newScore = runEvalScore();
      log("New score: " + newScore.toFixed(6) + " (was " + currentScore.toFixed(6) + ")");
      if (newScore > currentScore) {
        gitAddCommitPush("iteration " + iteration + " improvement", newScore);
        currentScore = newScore;
      } else {
        log("No improvement — discarding.");
        discardChanges();
      }
    } else {
      log("No files modified this iteration.");
    }

    // Cooldown
    await new Promise((r) => setTimeout(r, 3000));
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
