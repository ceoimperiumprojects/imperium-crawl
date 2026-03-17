/**
 * Explore REPL — interactive browser session with live Playwright.
 *
 * Usage: imperium-crawl explore <url>
 *
 * Opens a headed (visible) browser window and gives the user a readline REPL
 * to execute actions interactively. Every successful action is recorded.
 * At any point, run `save-skill <name>` to export the session as a reusable skill.
 *
 * Commands:
 *   navigate <url>              Navigate to URL
 *   click <selector>            Click element
 *   type <selector> <text>      Fill input field
 *   select <selector> <value>   Select option
 *   wait [ms]                   Wait N ms (default 1000)
 *   screenshot [file]           Save screenshot
 *   snapshot                    Show ARIA tree + refs
 *   evaluate <script>           Run JS in page
 *   scroll [up|down] [px]       Scroll page
 *   hover <selector>            Hover element
 *   press <key>                 Press keyboard key
 *   save-skill <name>           Export recording as skill JSON
 *   status                      Show URL, action count
 *   history                     List recorded actions
 *   undo                        Remove last action
 *   help                        Show command list
 *   exit / quit                 Close browser and exit
 */

import readline from "node:readline";
import path from "node:path";
import fs from "node:fs/promises";
import { ActionRecorder } from "./cli-recorder.js";
import { executeAction } from "./tools/action-executor.js";
import type { ActionInput } from "./tools/action-executor.js";
import { getSessionManager } from "./sessions/index.js";
import type { StoredCookie } from "./sessions/index.js";
import { save as saveSkill } from "./skills/manager.js";
import type { InteractSkillConfig } from "./skills/manager.js";
import { getEnhancedSnapshot } from "./snapshot/index.js";
import { getSnapshotStore } from "./snapshot/index.js";
import { normalizeUrl } from "./utils/url.js";

const EXPLORE_TIMEOUT = 30_000;

// ── ANSI helpers ──

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
};

function ok(msg: string): void { process.stdout.write(`${C.green}✓${C.reset} ${msg}\n`); }
function err(msg: string): void { process.stdout.write(`${C.red}✗${C.reset} ${msg}\n`); }
function info(msg: string): void { process.stdout.write(`${C.cyan}›${C.reset} ${msg}\n`); }
function dim(msg: string): void { process.stdout.write(`${C.dim}${msg}${C.reset}\n`); }

// ── Help text ──

const HELP_TEXT = `
${C.bold}Explore REPL Commands${C.reset}
${C.dim}────────────────────────────────────────────────────${C.reset}
  ${C.cyan}navigate${C.reset} <url>              Navigate to a URL
  ${C.cyan}click${C.reset} <selector>            Click element (CSS selector or @ref)
  ${C.cyan}type${C.reset} <selector> <text>      Fill input field
  ${C.cyan}select${C.reset} <selector> <value>   Select dropdown option
  ${C.cyan}hover${C.reset} <selector>            Hover over element
  ${C.cyan}press${C.reset} <key>                 Press keyboard key (Enter, Tab, Escape…)
  ${C.cyan}scroll${C.reset} [up|down] [px]       Scroll page (default: down 500px)
  ${C.cyan}wait${C.reset} [ms]                   Wait N milliseconds (default: 1000)
  ${C.cyan}evaluate${C.reset} <js>               Run JavaScript in page context
  ${C.cyan}screenshot${C.reset} [filename.png]   Take screenshot
  ${C.cyan}snapshot${C.reset}                    Show ARIA tree with element refs
${C.dim}────────────────────────────────────────────────────${C.reset}
  ${C.yellow}save-skill${C.reset} <name>           Export session as reusable skill
  ${C.yellow}history${C.reset}                     List recorded actions
  ${C.yellow}undo${C.reset}                        Remove last action from recording
  ${C.yellow}status${C.reset}                      Show current URL and action count
  ${C.yellow}help${C.reset}                        Show this help
  ${C.yellow}exit${C.reset} / ${C.yellow}quit${C.reset}                Close browser and exit
${C.dim}────────────────────────────────────────────────────${C.reset}
`;

// ── Tokenizer ──

/** Split command line respecting quoted strings */
function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === quoteChar) { inQuote = false; }
      else { current += ch; }
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === " " || ch === "\t") {
      if (current) { tokens.push(current); current = ""; }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

// ── Session ID for snapshot refs ──

const EXPLORE_SESSION_ID = `explore-${Date.now()}`;

// ── Main REPL ──

export async function runExplore(startUrl: string, sessionId?: string): Promise<void> {
  const { isPlaywrightAvailable } = await import("./stealth/browser.js");
  if (!(await isPlaywrightAvailable())) {
    err("rebrowser-playwright is required for explore mode.");
    err("Install with: npm i rebrowser-playwright");
    process.exit(1);
  }

  const url = normalizeUrl(startUrl);
  info(`Opening browser → ${C.cyan}${url}${C.reset}`);
  info("Type ${C.bold}help${C.reset} for available commands\n");

  // Launch headed browser
  const { chromium } = await import("rebrowser-playwright");
  const { STEALTH_ARGS } = await import("./constants.js");
  const { timeZone, locale } = Intl.DateTimeFormat().resolvedOptions();

  const browser = await chromium.launch({
    headless: false,
    args: STEALTH_ARGS,
  });

  const context = await browser.newContext({ timezoneId: timeZone, locale });

  // Restore session cookies if session_id given
  if (sessionId) {
    const session = await getSessionManager().load(sessionId);
    if (session?.cookies.length) {
      await context.addCookies(session.cookies);
      info(`Restored session: ${C.yellow}${sessionId}${C.reset}`);
    }
  }

  const page = await context.newPage();

  // Navigate to starting URL
  try {
    await page.goto(url, { waitUntil: "load", timeout: EXPLORE_TIMEOUT });
    ok(`Navigated to ${page.url()}`);
  } catch (e) {
    err(`Navigation failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  const recorder = new ActionRecorder(url);
  const screenshots: string[] = [];

  // ── Readline REPL ──

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${C.magenta}explore${C.reset}${C.dim}›${C.reset} `,
    terminal: true,
  });

  rl.prompt();

  const cleanup = async () => {
    // Save session cookies if session_id given
    if (sessionId) {
      try {
        const cookies = await context.cookies();
        const stored: StoredCookie[] = cookies.map((c) => ({
          name: c.name, value: c.value, domain: c.domain, path: c.path,
          expires: c.expires, httpOnly: c.httpOnly, secure: c.secure,
          sameSite: c.sameSite as StoredCookie["sameSite"],
        }));
        await getSessionManager().save(sessionId, stored, page.url());
        ok(`Session saved: ${sessionId}`);
      } catch { /* non-critical */ }
    }
    await browser.close().catch(() => {});
    rl.close();
  };

  process.on("SIGINT", async () => { await cleanup(); process.exit(0); });

  rl.on("line", async (rawLine) => {
    rl.pause();
    const line = rawLine.trim();
    if (!line) { rl.resume(); rl.prompt(); return; }

    const tokens = tokenize(line);
    const cmd = tokens[0]?.toLowerCase() ?? "";
    const args = tokens.slice(1);

    try {
      switch (cmd) {
        case "navigate": {
          if (!args[0]) { err("Usage: navigate <url>"); break; }
          const navUrl = args[0].startsWith("http") ? args[0] : `https://${args[0]}`;
          await page.goto(navUrl, { waitUntil: "load", timeout: EXPLORE_TIMEOUT });
          ok(`Navigated to ${page.url()}`);
          recorder.record({ type: "navigate", url: navUrl }, line, page.url());
          break;
        }

        case "click": {
          if (!args[0]) { err("Usage: click <selector>"); break; }
          const action: ActionInput = { type: "click", selector: args[0] };
          const result = await executeAction(page, action, screenshots, EXPLORE_TIMEOUT, EXPLORE_SESSION_ID);
          if (result.success) { ok(`Clicked: ${args[0]}`); recorder.record(action, line, page.url()); }
          else err(result.error ?? "Click failed");
          break;
        }

        case "type": {
          if (!args[0] || !args[1]) { err("Usage: type <selector> <text>"); break; }
          const text = args.slice(1).join(" ");
          const action: ActionInput = { type: "type", selector: args[0], text };
          const result = await executeAction(page, action, screenshots, EXPLORE_TIMEOUT, EXPLORE_SESSION_ID);
          if (result.success) { ok(`Typed into: ${args[0]}`); recorder.record(action, line, page.url()); }
          else err(result.error ?? "Type failed");
          break;
        }

        case "select": {
          if (!args[0] || !args[1]) { err("Usage: select <selector> <value>"); break; }
          const action: ActionInput = { type: "select", selector: args[0], value: args[1] };
          const result = await executeAction(page, action, screenshots, EXPLORE_TIMEOUT, EXPLORE_SESSION_ID);
          if (result.success) { ok(`Selected: ${args[1]} in ${args[0]}`); recorder.record(action, line, page.url()); }
          else err(result.error ?? "Select failed");
          break;
        }

        case "hover": {
          if (!args[0]) { err("Usage: hover <selector>"); break; }
          const action: ActionInput = { type: "hover", selector: args[0] };
          const result = await executeAction(page, action, screenshots, EXPLORE_TIMEOUT, EXPLORE_SESSION_ID);
          if (result.success) { ok(`Hovered: ${args[0]}`); recorder.record(action, line, page.url()); }
          else err(result.error ?? "Hover failed");
          break;
        }

        case "press": {
          if (!args[0]) { err("Usage: press <key> (e.g. Enter, Tab, Escape)"); break; }
          const action: ActionInput = { type: "press", key: args[0] };
          const result = await executeAction(page, action, screenshots, EXPLORE_TIMEOUT, EXPLORE_SESSION_ID);
          if (result.success) { ok(`Pressed: ${args[0]}`); recorder.record(action, line, page.url()); }
          else err(result.error ?? "Press failed");
          break;
        }

        case "scroll": {
          const direction = args[0]?.toLowerCase() ?? "down";
          const px = parseInt(args[1] ?? "500", 10);
          const y = direction === "up" ? -px : px;
          const action: ActionInput = { type: "scroll", y };
          const result = await executeAction(page, action, screenshots, EXPLORE_TIMEOUT, EXPLORE_SESSION_ID);
          if (result.success) { ok(`Scrolled ${direction} ${Math.abs(y)}px`); recorder.record(action, line, page.url()); }
          else err(result.error ?? "Scroll failed");
          break;
        }

        case "wait": {
          const ms = parseInt(args[0] ?? "1000", 10);
          const action: ActionInput = { type: "wait", duration: ms };
          await executeAction(page, action, screenshots, EXPLORE_TIMEOUT + ms, EXPLORE_SESSION_ID);
          ok(`Waited ${ms}ms`);
          recorder.record(action, line, page.url());
          break;
        }

        case "screenshot": {
          const filename = args[0] ?? `screenshot-${Date.now()}.png`;
          const buf = await page.screenshot({ fullPage: false });
          await fs.writeFile(filename, buf);
          ok(`Screenshot saved: ${filename}`);
          recorder.record({ type: "screenshot" }, line, page.url());
          break;
        }

        case "snapshot": {
          info("Taking ARIA snapshot...");
          try {
            const snapshot = await getEnhancedSnapshot(page, { interactive: true, compact: true });
            getSnapshotStore().save(EXPLORE_SESSION_ID, snapshot.refs, page.url());
            process.stdout.write("\n" + snapshot.tree + "\n\n");
            info(`${C.dim}${Object.keys(snapshot.refs).length} refs available. Use @ref in commands.${C.reset}`);
          } catch (e) {
            err(`Snapshot failed: ${e instanceof Error ? e.message : String(e)}`);
          }
          break;
        }

        case "evaluate": {
          if (!args[0]) { err("Usage: evaluate <script>"); break; }
          const script = args.join(" ");
          const action: ActionInput = { type: "evaluate", script };
          const result = await executeAction(page, action, screenshots, EXPLORE_TIMEOUT, EXPLORE_SESSION_ID);
          if (result.success) {
            ok("Evaluated:");
            process.stdout.write(JSON.stringify(result.result, null, 2) + "\n");
            recorder.record(action, line, page.url());
          } else {
            err(result.error ?? "Evaluate failed");
          }
          break;
        }

        case "save-skill": {
          if (!args[0]) { err("Usage: save-skill <name>"); break; }
          const skillName = args[0];
          if (!/^[a-zA-Z0-9_-]+$/.test(skillName)) {
            err("Skill name may only contain letters, numbers, hyphens, and underscores");
            break;
          }
          if (recorder.count === 0) {
            err("No actions recorded yet. Perform some actions first.");
            break;
          }

          // Auto-detect parameters
          const detectedParams = recorder.detectParameters();
          const paramCount = Object.keys(detectedParams).length;

          const description = `Recorded skill from ${new URL(url).hostname} — ${recorder.count} actions`;
          const config: InteractSkillConfig = recorder.toSkillConfig(skillName, description, sessionId, detectedParams);

          await saveSkill(skillName, config);
          ok(`Saved skill: ${C.yellow}${skillName}${C.reset} (${recorder.count} actions${paramCount > 0 ? `, ${paramCount} params detected` : ""})`);
          info(`Run with: ${C.cyan}imperium-crawl run-skill ${skillName}${C.reset}`);
          break;
        }

        case "history": {
          const h = recorder.getHistory();
          if (h.length === 0) { info("No actions recorded yet."); break; }
          process.stdout.write(`\n${C.bold}Recorded actions (${h.length}):${C.reset}\n`);
          h.forEach((r, i) => {
            dim(`  ${String(i + 1).padStart(2)}. ${r.rawCommand}`);
          });
          process.stdout.write("\n");
          break;
        }

        case "undo": {
          const undone = recorder.undo();
          if (undone) {
            ok(`Removed: ${undone.rawCommand}`);
            info(`${recorder.count} actions remaining`);
          } else {
            info("Nothing to undo");
          }
          break;
        }

        case "status": {
          process.stdout.write(`\n`);
          info(`URL:     ${C.cyan}${page.url()}${C.reset}`);
          info(`Actions: ${C.yellow}${recorder.count}${C.reset} recorded`);
          if (sessionId) info(`Session: ${C.yellow}${sessionId}${C.reset}`);
          process.stdout.write(`\n`);
          break;
        }

        case "help": {
          process.stdout.write(HELP_TEXT);
          break;
        }

        case "exit":
        case "quit": {
          info("Closing browser...");
          await cleanup();
          process.exit(0);
          break;
        }

        default: {
          err(`Unknown command: ${cmd}. Type ${C.bold}help${C.reset} for available commands.`);
          break;
        }
      }
    } catch (e) {
      err(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }

    rl.resume();
    rl.prompt();
  });

  rl.on("close", async () => {
    await cleanup();
  });
}
