/**
 * Full TUI (Terminal User Interface) for imperium-crawl — v3
 *
 * Slash-command-driven UX (Claude Code aesthetic).
 * readline for main prompt, @clack/prompts for param collection only.
 *
 * Activated when: no CLI args AND process.stdout.isTTY.
 * Non-TTY mode (pipe/CI/agents) is unaffected — MCP server runs as before.
 * CLI subcommands (scrape, crawl, etc.) are unaffected — they bypass this.
 */

import chalk from "chalk";
import Table from "cli-table3";
import readline from "node:readline";
import { readdirSync, writeFileSync } from "node:fs";
import { z } from "zod";
import {
  text,
  select,
  multiselect,
  confirm,
  spinner as clackSpinner,
  isCancel,
} from "@clack/prompts";
import { loadCliConfig } from "./cli-config.js";
import { PACKAGE_VERSION } from "./constants.js";
import { parseToolOutput } from "./formatters.js";
import { getSkillsDir, getJobsDir } from "./config.js";
import type { ToolDefinition } from "./tools/index.js";

// ── Cancel Signal ────────────────────────────────────────────────────

class TuiCancelError extends Error {
  constructor() {
    super("cancelled");
    this.name = "TuiCancelError";
  }
}

/** Throw TuiCancelError if the prompt result is a cancel symbol. */
function cc<T>(val: T | symbol): T {
  if (isCancel(val)) throw new TuiCancelError();
  return val as T;
}

// ── Slash Command Registry ──────────────────────────────────────────

interface SlashCommand {
  cmd: string;       // "/scrape"
  tool: string;      // "scrape" (file name in src/tools/)
  argField?: string; // first inline arg maps to this param
  desc: string;      // "Scrape a web page"
  category: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  // Scraping
  { cmd: "/scrape",       tool: "scrape",       argField: "url",   desc: "Scrape a web page",              category: "Scraping" },
  { cmd: "/crawl",        tool: "crawl",        argField: "url",   desc: "Crawl a website",                category: "Scraping" },
  { cmd: "/map",          tool: "map",          argField: "url",   desc: "Discover all URLs",              category: "Scraping" },
  { cmd: "/extract",      tool: "extract",      argField: "url",   desc: "CSS selector extraction",        category: "Scraping" },
  { cmd: "/read",         tool: "readability",  argField: "url",   desc: "Article content (readability)",   category: "Scraping" },
  { cmd: "/screenshot",   tool: "screenshot",   argField: "url",   desc: "Page screenshot",                category: "Scraping" },
  // Search
  { cmd: "/search",       tool: "search",       argField: "query", desc: "Web search",                     category: "Search" },
  { cmd: "/news",         tool: "news-search",  argField: "query", desc: "News search",                    category: "Search" },
  { cmd: "/images",       tool: "image-search", argField: "query", desc: "Image search",                   category: "Search" },
  { cmd: "/videos",       tool: "video-search", argField: "query", desc: "Video search",                   category: "Search" },
  // AI & Automation
  { cmd: "/ai",           tool: "ai-extract",   argField: "url",   desc: "AI data extraction",             category: "AI & Automation" },
  { cmd: "/interact",     tool: "interact",                        desc: "Browser automation",             category: "AI & Automation" },
  // Batch & Jobs
  { cmd: "/batch",        tool: "batch-scrape",                    desc: "Parallel batch scraping",        category: "Batch & Jobs" },
  { cmd: "/jobs",         tool: "list-jobs",                       desc: "List batch jobs",                category: "Batch & Jobs" },
  { cmd: "/job",          tool: "job-status",   argField: "job_id",desc: "Check job status",               category: "Batch & Jobs" },
  { cmd: "/delete-job",   tool: "delete-job",   argField: "job_id",desc: "Delete a batch job",             category: "Batch & Jobs" },
  // Skills
  { cmd: "/skills",       tool: "list-skills",                     desc: "List saved skills",              category: "Skills" },
  { cmd: "/create-skill", tool: "create-skill", argField: "url",   desc: "Create a reusable scraper",      category: "Skills" },
  { cmd: "/run-skill",    tool: "run-skill",    argField: "name",  desc: "Run a saved skill",              category: "Skills" },
  // API Discovery
  { cmd: "/discover",     tool: "discover-apis",argField: "url",   desc: "Find APIs on a page",            category: "API Discovery" },
  { cmd: "/query-api",    tool: "query-api",    argField: "url",   desc: "Query an API endpoint",          category: "API Discovery" },
  { cmd: "/ws",           tool: "monitor-websocket", argField: "url", desc: "Monitor WebSocket",           category: "API Discovery" },
];

// System commands (not tool-backed)
const SYSTEM_COMMANDS = ["/help", "/save", "/again", "/clear", "/setup", "/exit"];

// ── Text Utilities ───────────────────────────────────────────────────

/** Word-wrap text to `width` cols. Preserves existing newlines. */
function wrapText(text: string, width: number): string {
  if (width <= 0) return text;
  return text
    .split("\n")
    .map((line) => {
      if (line.length <= width) return line;
      const words = line.split(" ");
      const lines: string[] = [];
      let current = "";
      for (const word of words) {
        if (current.length + word.length + 1 > width) {
          if (current) lines.push(current);
          current = word;
        } else {
          current = current ? `${current} ${word}` : word;
        }
      }
      if (current) lines.push(current);
      return lines.join("\n");
    })
    .join("\n");
}

/** Minimal markdown → chalk rendering for terminal display. */
function renderMarkdown(text: string): string {
  const cols = process.stdout.columns ?? 80;
  const lines = text.split("\n");
  const out: string[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];

  for (const line of lines) {
    // Fenced code block
    if (line.trimStart().startsWith("```")) {
      if (inCodeBlock) {
        // Close block
        const blockContent = codeLines.join("\n");
        out.push(chalk.bgBlack.cyan("  " + blockContent.replace(/\n/g, "\n  ") + "  "));
        codeLines = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // Headings
    const h3 = line.match(/^###\s+(.+)/);
    if (h3) { out.push(chalk.bold(h3[1])); continue; }
    const h2 = line.match(/^##\s+(.+)/);
    if (h2) { out.push(chalk.bold.underline(h2[1])); continue; }
    const h1 = line.match(/^#\s+(.+)/);
    if (h1) { out.push(chalk.bold.underline(h1[1])); continue; }

    // List items
    const listItem = line.match(/^(\s*)[*-]\s+(.+)/);
    if (listItem) {
      const indent = listItem[1];
      let content = listItem[2];
      content = applyInlineMarkdown(content);
      out.push(`${indent}  • ${content}`);
      continue;
    }

    // Numbered list
    const numItem = line.match(/^(\s*)\d+\.\s+(.+)/);
    if (numItem) {
      const indent = numItem[1];
      const content = applyInlineMarkdown(numItem[2]);
      out.push(`${indent}  ${content}`);
      continue;
    }

    // Normal line — apply inline transforms + word wrap
    const processed = applyInlineMarkdown(line);
    out.push(wrapText(processed, cols - 4));
  }

  // Unclosed code block
  if (inCodeBlock && codeLines.length) {
    out.push(chalk.bgBlack.cyan("  " + codeLines.join("\n  ") + "  "));
  }

  return out.join("\n");
}

function applyInlineMarkdown(text: string): string {
  // Bold: **text** or __text__
  text = text.replace(/\*\*(.+?)\*\*/g, (_, t) => chalk.bold(t));
  text = text.replace(/__(.+?)__/g, (_, t) => chalk.bold(t));
  // Italic: *text* or _text_
  text = text.replace(/\*([^*]+?)\*/g, (_, t) => chalk.italic(t));
  text = text.replace(/_([^_]+?)_/g, (_, t) => chalk.italic(t));
  // Inline code: `code`
  text = text.replace(/`([^`]+?)`/g, (_, t) => chalk.cyan(t));
  return text;
}

// ── Header ───────────────────────────────────────────────────────────

function showHeader(): void {
  const hasBrave = !!process.env.BRAVE_API_KEY;
  const hasCaptcha = !!(process.env.TWOCAPTCHA_API_KEY || process.env.TWO_CAPTCHA_API_KEY);

  // Count jobs and skills
  let jobCount = 0;
  let skillCount = 0;
  try { jobCount = readdirSync(getJobsDir()).filter(f => f.endsWith(".json")).length; } catch { /* none */ }
  try { skillCount = readdirSync(getSkillsDir()).filter(f => f.endsWith(".json")).length; } catch { /* none */ }

  // Status checks
  const checks: string[] = [];
  if (hasBrave) checks.push(chalk.green("✓") + " " + chalk.white("Brave Search"));
  if (hasCaptcha) checks.push(chalk.green("✓") + " " + chalk.white("2Captcha"));

  const statsStr = chalk.dim(`${jobCount} job${jobCount !== 1 ? "s" : ""} · ${skillCount} skill${skillCount !== 1 ? "s" : ""}`);

  console.log();
  console.log(`  ${chalk.bold.magenta("✻")} ${chalk.bold("imperiumcrawl")} ${chalk.dim(`v${PACKAGE_VERSION}`)}`);
  if (checks.length > 0) {
    console.log(`  ${checks.join("   ")}          ${statsStr}`);
  } else {
    console.log(`  ${chalk.dim("No API keys configured")}          ${statsStr}`);
  }
  console.log();
  console.log(chalk.dim("  /help for commands"));
  console.log();
}

// ── Help Screen ──────────────────────────────────────────────────────

function showHelp(): void {
  // Group commands by category
  const categories = new Map<string, SlashCommand[]>();
  for (const cmd of SLASH_COMMANDS) {
    const existing = categories.get(cmd.category) ?? [];
    existing.push(cmd);
    categories.set(cmd.category, existing);
  }

  console.log();
  for (const [category, commands] of categories) {
    const sep = chalk.dim("─".repeat(Math.max(0, 42 - category.length - 1)));
    console.log(`  ${chalk.bold(category)} ${sep}`);
    for (const cmd of commands) {
      const padded = (cmd.cmd + " ").padEnd(20);
      console.log(`  ${chalk.cyan(padded)}${chalk.dim(cmd.desc)}`);
    }
    console.log();
  }

  console.log(chalk.dim(`  /save · /again · /setup · /clear · /exit`));
  console.log();
  console.log();
}

// ── Zod Unwrapping ────────────────────────────────────────────────────

interface UnwrappedType {
  base: z.ZodTypeAny;
  isOptional: boolean;
  hasDefault: boolean;
  defaultValue: unknown;
  description: string | undefined;
}

function unwrapZod(schema: z.ZodTypeAny): UnwrappedType {
  let isOptional = false;
  let hasDefault = false;
  let defaultValue: unknown = undefined;
  const description = schema.description;
  let current = schema;

  for (let i = 0; i < 10; i++) {
    const typeName = current._def.typeName as string;
    if (typeName === "ZodDefault") {
      hasDefault = true;
      defaultValue = current._def.defaultValue();
      current = current._def.innerType;
    } else if (typeName === "ZodOptional" || typeName === "ZodNullable") {
      isOptional = true;
      current = current._def.innerType;
    } else {
      break;
    }
  }

  return { base: current, isOptional, hasDefault, defaultValue, description };
}

function getZodTypeName(schema: z.ZodTypeAny): string {
  return (schema._def.typeName as string) ?? "";
}

// ── Interact Action Wizard ───────────────────────────────────────────

async function collectInteractActions(): Promise<Record<string, unknown>[]> {
  const actions: Record<string, unknown>[] = [];

  for (let idx = 1; ; idx++) {
    const actionType = cc(
      await select({
        message: `Add action #${idx}:`,
        options: [
          { value: "navigate", label: "navigate", hint: "Go to a URL" },
          { value: "click", label: "click", hint: "Click an element" },
          { value: "type", label: "type", hint: "Type text into a field" },
          { value: "scroll", label: "scroll", hint: "Scroll the page" },
          { value: "wait", label: "wait", hint: "Wait N milliseconds" },
          { value: "screenshot", label: "screenshot", hint: "Take a screenshot" },
          { value: "evaluate", label: "evaluate", hint: "Run JavaScript on the page" },
          { value: "press", label: "press", hint: "Press a keyboard key" },
          { value: "select", label: "select", hint: "Select a dropdown option" },
          { value: "hover", label: "hover", hint: "Hover over an element" },
        ],
      }),
    ) as string;

    const action: Record<string, unknown> = { type: actionType };

    if (actionType === "navigate") {
      action.url = cc(
        await text({
          message: "URL to navigate to:",
          placeholder: "https://example.com",
          validate: (v) => ((v ?? "").trim() ? undefined : "URL is required"),
        }),
      );
    } else if (actionType === "click" || actionType === "hover") {
      action.selector = cc(
        await text({
          message: "CSS selector:",
          placeholder: "button.submit, #login-btn",
          validate: (v) => ((v ?? "").trim() ? undefined : "Selector is required"),
        }),
      );
    } else if (actionType === "type") {
      action.selector = cc(
        await text({
          message: "CSS selector (input field):",
          placeholder: "input[name='q']",
          validate: (v) => ((v ?? "").trim() ? undefined : "Selector is required"),
        }),
      );
      action.text = cc(
        await text({
          message: "Text to type:",
          validate: (v) => ((v ?? "").trim() ? undefined : "Text is required"),
        }),
      );
    } else if (actionType === "scroll") {
      const dir = cc(
        await select({
          message: "Scroll direction:",
          options: [
            { value: "down", label: "down" },
            { value: "up", label: "up" },
          ],
        }),
      ) as string;
      const amount = cc(
        await text({
          message: "Amount (pixels):",
          placeholder: "500",
          validate: (v) => (isNaN(Number(v ?? "")) ? "Enter a number" : undefined),
        }),
      ) as string;
      action.direction = dir;
      action.amount = Number(amount);
    } else if (actionType === "wait") {
      const ms = cc(
        await text({
          message: "Wait milliseconds:",
          placeholder: "1000",
          validate: (v) => (isNaN(Number(v ?? "")) ? "Enter a number" : undefined),
        }),
      ) as string;
      action.milliseconds = Number(ms);
    } else if (actionType === "evaluate") {
      action.code = cc(
        await text({
          message: "JavaScript to run:",
          placeholder: "document.title",
          validate: (v) => ((v ?? "").trim() ? undefined : "Code is required"),
        }),
      );
    } else if (actionType === "press") {
      action.key = cc(
        await text({
          message: "Key to press:",
          placeholder: "Enter, Escape, Tab, ArrowDown",
          validate: (v) => ((v ?? "").trim() ? undefined : "Key is required"),
        }),
      );
    } else if (actionType === "select") {
      action.selector = cc(
        await text({
          message: "CSS selector (select element):",
          validate: (v) => ((v ?? "").trim() ? undefined : "Selector is required"),
        }),
      );
      action.value = cc(
        await text({
          message: "Option value to select:",
          validate: (v) => ((v ?? "").trim() ? undefined : "Value is required"),
        }),
      );
    }
    // screenshot: no extra params

    actions.push(action);

    const addMore = cc(
      await confirm({ message: "Add another action?", initialValue: true }),
    ) as boolean;
    if (!addMore) break;
  }

  return actions;
}

// ── Param Collector ──────────────────────────────────────────────────

async function collectParamField(
  cmd: string,
  key: string,
  fieldSchema: z.ZodTypeAny,
  isRequired: boolean,
): Promise<{ value: unknown; skip: boolean }> {
  // Special case: interact tool's actions array
  if (cmd === "interact" && key === "actions") {
    const value = await collectInteractActions();
    return { value, skip: false };
  }

  const { base, hasDefault, defaultValue, description } = unwrapZod(fieldSchema);
  const typeName = getZodTypeName(base);
  const label = description ?? key.replace(/_/g, " ");
  const msgRequired = chalk.white(label);
  const msgOptional = chalk.dim(label) + chalk.dim(" (optional)");
  const msg = isRequired ? msgRequired : msgOptional;

  if (typeName === "ZodString") {
    if (isRequired) {
      const val = cc(
        await text({
          message: `${msg}:`,
          validate: (v) => ((v ?? "").trim() ? undefined : `${key} is required`),
        }),
      ) as string;
      return { value: val, skip: false };
    } else {
      const val = cc(
        await text({
          message: `${msg}:`,
          placeholder: hasDefault ? String(defaultValue) : "press Enter to skip",
        }),
      ) as string;
      if (val.trim()) return { value: val, skip: false };
      if (hasDefault) return { value: defaultValue, skip: false };
      return { value: undefined, skip: true };
    }
  } else if (typeName === "ZodNumber") {
    if (isRequired) {
      const val = cc(
        await text({
          message: `${msg}:`,
          validate: (v) => (isNaN(Number(v)) ? "Enter a valid number" : undefined),
        }),
      ) as string;
      return { value: parseFloat(val), skip: false };
    } else {
      const val = cc(
        await text({
          message: `${msg}:`,
          placeholder: hasDefault ? String(defaultValue) : "optional number",
        }),
      ) as string;
      if (val.trim() && !isNaN(Number(val))) return { value: parseFloat(val), skip: false };
      if (hasDefault) return { value: defaultValue, skip: false };
      return { value: undefined, skip: true };
    }
  } else if (typeName === "ZodBoolean") {
    const val = cc(
      await confirm({
        message: `${msg}?`,
        initialValue: hasDefault ? (defaultValue as boolean) : false,
      }),
    ) as boolean;
    return { value: val, skip: false };
  } else if (typeName === "ZodEnum") {
    const values = (base as z.ZodEnum<[string, ...string[]]>)._def.values as string[];
    const val = cc(
      await select({
        message: `${msg}:`,
        options: values.map((v) => ({ value: v, label: v })),
        ...(hasDefault ? { initialValue: String(defaultValue) } : {}),
      }),
    ) as string;
    return { value: val, skip: false };
  } else if (typeName === "ZodArray") {
    const innerUnwrapped = unwrapZod((base as z.ZodArray<z.ZodTypeAny>)._def.type);
    const innerTypeName = getZodTypeName(innerUnwrapped.base);

    if (innerTypeName === "ZodEnum") {
      const values = (innerUnwrapped.base as z.ZodEnum<[string, ...string[]]>)._def.values as string[];
      const val = cc(
        await multiselect({
          message: `${msg}:`,
          options: values.map((v) => ({ value: v, label: v })),
          required: isRequired,
        }),
      ) as string[];
      return { value: val, skip: false };
    } else {
      const val = cc(
        await text({
          message: `${msg} (comma-separated):`,
          placeholder: hasDefault ? String(defaultValue) : "press Enter to skip",
        }),
      ) as string;
      if (val.trim()) {
        return {
          value: val.split(",").map((s) => s.trim()).filter(Boolean),
          skip: false,
        };
      }
      if (hasDefault) return { value: defaultValue, skip: false };
      return { value: [], skip: false };
    }
  } else if (typeName === "ZodRecord") {
    const val = cc(
      await text({
        message: `${msg} (JSON object):`,
        placeholder: hasDefault ? JSON.stringify(defaultValue) : '{"key": "value"}',
        validate: (v) => {
          if (!(v ?? "").trim()) return undefined;
          try { JSON.parse(v ?? ""); return undefined; }
          catch { return "Invalid JSON"; }
        },
      }),
    ) as string;
    if (val.trim()) return { value: JSON.parse(val), skip: false };
    if (hasDefault) return { value: defaultValue, skip: false };
    return { value: undefined, skip: true };
  } else {
    // Fallback: treat as optional text
    const val = cc(
      await text({
        message: `${msg}:`,
        placeholder: "optional — press Enter to skip",
      }),
    ) as string;
    if (val.trim()) return { value: val, skip: false };
    return { value: undefined, skip: true };
  }
}

async function collectParams(
  cmd: string,
  toolModule: ToolDefinition,
  prefilled: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  if (getZodTypeName(toolModule.schema) !== "ZodObject") return { ...prefilled };

  const shape = (toolModule.schema as z.ZodObject<z.ZodRawShape>).shape;
  const entries = Object.entries(shape);

  const required: Array<[string, z.ZodTypeAny]> = [];
  const optional: Array<[string, z.ZodTypeAny]> = [];

  for (const [key, fieldSchema] of entries) {
    const { isOptional, hasDefault } = unwrapZod(fieldSchema as z.ZodTypeAny);
    if (isOptional || hasDefault) {
      optional.push([key, fieldSchema as z.ZodTypeAny]);
    } else {
      required.push([key, fieldSchema as z.ZodTypeAny]);
    }
  }

  const params: Record<string, unknown> = { ...prefilled };

  // Collect required fields (skip if already prefilled)
  for (const [key, fieldSchema] of required) {
    if (params[key] !== undefined) continue;
    const { value, skip } = await collectParamField(cmd, key, fieldSchema, true);
    if (!skip) params[key] = value;
  }

  // Ask if user wants optional fields
  if (optional.length > 0) {
    const showOptional = cc(
      await confirm({
        message: `Show ${optional.length} advanced option${optional.length !== 1 ? "s" : ""}?`,
        initialValue: false,
      }),
    ) as boolean;

    if (showOptional) {
      for (const [key, fieldSchema] of optional) {
        if (params[key] !== undefined) continue;
        const { value, skip } = await collectParamField(cmd, key, fieldSchema, false);
        if (!skip && value !== undefined) params[key] = value;
      }
    }
  }

  return params;
}

// ── Execute with Progress ────────────────────────────────────────────

async function executeWithProgress(
  tool: ToolDefinition,
  params: Record<string, unknown>,
): Promise<unknown> {
  const s = clackSpinner();
  s.start(`Running ${tool.name}…`);
  const start = Date.now();

  try {
    const result = await tool.execute(params);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    s.stop(`Done in ${elapsed}s`);
    return parseToolOutput(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    s.stop(chalk.red("✗ Failed"));

    const isApiKeyError =
      msg.includes("API_KEY") ||
      msg.toLowerCase().includes("api key") ||
      msg.includes("401") ||
      msg.includes("403") ||
      msg.includes("unauthorized");

    console.log();
    console.log(chalk.red(`  ✗ ${msg}`));
    if (isApiKeyError) {
      console.log(chalk.yellow(`  Hint: Run /setup to configure API keys.`));
    }
    console.log();

    return null;
  }
}

// ── Pretty Printer ───────────────────────────────────────────────────

function prettyPrint(data: unknown, indent = 0): void {
  const pad = "  ".repeat(indent);
  const maxDepth = 3;

  if (data === null || data === undefined) {
    process.stdout.write(chalk.dim("null"));
    return;
  }

  if (typeof data === "string") {
    process.stdout.write(chalk.white(JSON.stringify(data)));
    return;
  }

  if (typeof data === "number") {
    process.stdout.write(chalk.yellow(String(data)));
    return;
  }

  if (typeof data === "boolean") {
    process.stdout.write(chalk.cyan(String(data)));
    return;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      process.stdout.write(chalk.dim("[]"));
      return;
    }

    // Compact short arrays of primitives
    const allPrimitive = data.every((v) => typeof v !== "object" || v === null);
    if (allPrimitive && data.length <= 6) {
      const items = data.map((v) =>
        typeof v === "string"
          ? chalk.white(JSON.stringify(v))
          : typeof v === "number"
            ? chalk.yellow(String(v))
            : chalk.cyan(String(v)),
      );
      process.stdout.write(`[${items.join(chalk.dim(", "))}]`);
      return;
    }

    if (indent >= maxDepth) {
      process.stdout.write(chalk.dim(`[… ${data.length} items]`));
      return;
    }

    process.stdout.write("[\n");
    data.slice(0, 20).forEach((item, i) => {
      process.stdout.write(`${pad}  `);
      prettyPrint(item, indent + 1);
      if (i < data.length - 1) process.stdout.write(chalk.dim(","));
      process.stdout.write("\n");
    });
    if (data.length > 20) {
      process.stdout.write(`${pad}  ${chalk.dim(`… ${data.length - 20} more items`)}\n`);
    }
    process.stdout.write(`${pad}]`);
    return;
  }

  if (typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0) {
      process.stdout.write(chalk.dim("{}"));
      return;
    }

    if (indent >= maxDepth) {
      process.stdout.write(chalk.dim(`{… ${keys.length} keys}`));
      return;
    }

    process.stdout.write("{\n");
    keys.forEach((key, i) => {
      process.stdout.write(`${pad}  ${chalk.dim(key)}: `);
      prettyPrint(obj[key], indent + 1);
      if (i < keys.length - 1) process.stdout.write(chalk.dim(","));
      process.stdout.write("\n");
    });
    process.stdout.write(`${pad}}`);
    return;
  }

  process.stdout.write(String(data));
}

// ── Table Renderer ───────────────────────────────────────────────────

function renderBox(headers: string[], rows: string[][]): string {
  const table = new Table({
    head: headers.map((h) => chalk.cyan(h)),
    style: { head: [], border: [] },
  });
  for (const row of rows) table.push(row);
  return table.toString();
}

// ── Result Display ───────────────────────────────────────────────────

function displayResults(data: unknown, cmd: string): void {
  if (data === null || data === undefined) return;

  const toolName = cmd.replace(/-/g, "_");
  const obj =
    typeof data === "object" && data !== null
      ? (data as Record<string, unknown>)
      : null;

  const sep = chalk.dim("─".repeat(Math.min(process.stdout.columns ?? 80, 60)));
  console.log();

  // list_jobs → table
  if (toolName === "list_jobs" && obj) {
    const jobs = Array.isArray(obj.jobs) ? obj.jobs : [];
    if (jobs.length === 0) {
      console.log(chalk.dim("  No jobs found."));
      console.log();
      return;
    }
    const rows = jobs.map((j: unknown) => {
      const job = j as Record<string, unknown>;
      const total = Number(job.urls_total ?? 0);
      const done = Number(job.urls_completed ?? 0);
      const failed = Number(job.urls_failed ?? 0);
      const pct = total > 0 ? Math.round(((done + failed) / total) * 100) : 0;
      return [
        String(job.id ?? ""),
        String(job.status ?? ""),
        `${done + failed}/${total}`,
        `${pct}%`,
      ];
    });
    console.log(renderBox(["Job ID", "Status", "URLs", "Progress"], rows));
    console.log();
    return;
  }

  // list_skills → table
  if (toolName === "list_skills" && obj) {
    const skills = Array.isArray(obj.skills) ? obj.skills : [];
    if (skills.length === 0) {
      console.log(chalk.dim("  No skills found. Use /create-skill to create one."));
      console.log();
      return;
    }
    const rows = skills.map((s: unknown) => {
      const skill = s as Record<string, unknown>;
      const fields = Array.isArray(skill.fields)
        ? (skill.fields as string[]).join(", ")
        : "";
      const created =
        typeof skill.created_at === "string" ? skill.created_at.split("T")[0] : "";
      return [
        String(skill.name ?? ""),
        chalk.cyan(String(skill.url ?? "")),
        fields,
        created,
      ];
    });
    console.log(renderBox(["Name", "URL", "Fields", "Created"], rows));
    console.log();
    return;
  }

  // search / news / image / video → numbered table
  if (["search", "news_search", "image_search", "video_search"].includes(toolName) && obj) {
    const results = Array.isArray(obj.results) ? obj.results : [];
    if (results.length === 0) {
      console.log(chalk.dim("  No results found."));
      console.log();
      return;
    }
    const rows = results.slice(0, 20).map((r: unknown, i: number) => {
      const result = r as Record<string, unknown>;
      const title = chalk.white(String(result.title ?? result.name ?? "").slice(0, 50));
      const url = chalk.dim(String(result.url ?? result.source ?? "").slice(0, 60));
      return [chalk.dim(String(i + 1)), title, url];
    });
    console.log(renderBox(["#", "Title", "URL"], rows));
    console.log();
    return;
  }

  // scrape / readability / crawl → content preview
  if (["scrape", "readability", "crawl"].includes(toolName) && obj) {
    const content =
      typeof obj.markdown === "string"
        ? obj.markdown
        : typeof obj.content === "string"
          ? obj.content
          : typeof obj.text === "string"
            ? obj.text
            : null;

    console.log(sep);
    if (typeof obj.title === "string" && obj.title)
      console.log(`  ${chalk.bold.white(obj.title)}`);
    if (typeof obj.url === "string" && obj.url)
      console.log(`  ${chalk.dim.cyan(obj.url)}`);
    console.log(sep);

    if (content) {
      const cols = process.stdout.columns ?? 80;
      const preview = content.slice(0, 600);
      const remaining = content.length - 600;
      console.log(wrapText(preview, cols - 4).split("\n").map((l: string) => `  ${l}`).join("\n"));
      if (remaining > 0) {
        console.log(chalk.dim(`\n  … ${remaining.toLocaleString()} more chars · /save to export`));
      }
    }
    console.log();
    return;
  }

  // batch_scrape → summary table + failed URLs
  if (toolName === "batch_scrape" && obj) {
    const total = Number(obj.urls_total ?? 0);
    const completed = Number(obj.urls_completed ?? 0);
    const failed = Number(obj.urls_failed ?? 0);
    const duration =
      typeof obj.duration_ms === "number"
        ? `${(obj.duration_ms / 1000).toFixed(1)}s`
        : "—";

    console.log(
      renderBox(
        ["Total", "Completed", "Failed", "Duration"],
        [[String(total), String(completed), String(failed), duration]],
      ),
    );

    const failedUrls = Array.isArray(obj.failed_urls) ? (obj.failed_urls as string[]) : [];
    if (failedUrls.length > 0) {
      console.log(chalk.red(`\n  Failed URLs (top 5):`));
      failedUrls.slice(0, 5).forEach((u, i) => {
        console.log(chalk.dim(`  ${i + 1}. ${u}`));
      });
    }
    console.log();
    return;
  }

  // Default: pretty-printed structured output
  console.log(sep);
  console.log();
  process.stdout.write("  ");
  prettyPrint(data, 0);
  console.log();
  console.log();
}

// ── Save to File ─────────────────────────────────────────────────────

function saveToFile(data: unknown, filename?: string): void {
  const fname = filename?.trim() || `results-${Date.now()}.json`;
  writeFileSync(fname, JSON.stringify(data, null, 2) + "\n", "utf-8");
  console.log(chalk.green(`  ✓ Saved to ${fname}`));
  console.log();
}

// ── Slash Command Handler ────────────────────────────────────────────

interface TuiState {
  lastResult: unknown;
  lastCmd: string | null;
  lastParams: Record<string, unknown> | null;
  lastToolModule: ToolDefinition | null;
}

async function handleSlashCommand(input: string, state: TuiState): Promise<void> {
  const parts = input.trim().split(/\s+/);
  const cmdName = parts[0].toLowerCase();
  const argValue = parts.slice(1).join(" ").trim() || undefined;

  // ── System commands ──────────────────────────────────────────────

  if (cmdName === "/help" || cmdName === "/h" || cmdName === "/?") {
    showHelp();
    return;
  }

  if (cmdName === "/exit" || cmdName === "/quit" || cmdName === "/q") {
    console.log(chalk.dim("\n  Bye!\n"));
    process.exit(0);
  }

  if (cmdName === "/clear" || cmdName === "/cls") {
    process.stdout.write("\x1b[2J\x1b[H");
    showHeader();
    return;
  }

  if (cmdName === "/setup") {
    const { runSetup } = await import("./cli-onboarding.js");
    await runSetup();
    return;
  }

  if (cmdName === "/save") {
    if (state.lastResult === null) {
      console.log(chalk.dim("  No results to save.\n"));
      return;
    }
    saveToFile(state.lastResult, argValue);
    return;
  }

  if (cmdName === "/again") {
    if (!state.lastToolModule || !state.lastParams) {
      console.log(chalk.dim("  No previous command to repeat.\n"));
      return;
    }
    state.lastResult = await executeWithProgress(state.lastToolModule, state.lastParams);
    if (state.lastResult !== null) displayResults(state.lastResult, state.lastCmd!);
    return;
  }

  // ── Tool slash commands ──────────────────────────────────────────

  const slashCmd = SLASH_COMMANDS.find(
    (sc) => sc.cmd === cmdName,
  );

  if (!slashCmd) {
    console.log(chalk.dim(`  Unknown command: ${cmdName}. Type /help for commands.\n`));
    return;
  }

  // Load tool module
  let toolModule: ToolDefinition;
  try {
    toolModule = (await import(`./tools/${slashCmd.tool}.js`)) as ToolDefinition;
  } catch {
    console.log(chalk.red(`  ✗ Could not load tool: ${slashCmd.tool}\n`));
    return;
  }

  // Pre-fill inline arg
  const prefilled: Record<string, unknown> = {};
  if (argValue && slashCmd.argField) {
    prefilled[slashCmd.argField] = argValue;
  }

  // Collect params using @clack (readline will be paused)
  let params: Record<string, unknown>;
  try {
    params = await collectParams(slashCmd.tool, toolModule, prefilled);
  } catch (e) {
    if (e instanceof TuiCancelError) {
      console.log();
      return;
    }
    throw e;
  }

  // Execute
  state.lastResult = await executeWithProgress(toolModule, params);
  state.lastCmd = slashCmd.tool;
  state.lastParams = params;
  state.lastToolModule = toolModule;

  if (state.lastResult !== null) {
    displayResults(state.lastResult, slashCmd.tool);
  }
}

// ── Readline Prompt Helper ───────────────────────────────────────────

function createPrompt(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
}

function askLine(rl: readline.Interface): Promise<string | null> {
  return new Promise((resolve) => {
    rl.question(chalk.bold.cyan("❯ "), (answer) => {
      resolve(answer);
    });
    rl.once("close", () => resolve(null));
  });
}

// ── Main Loop ────────────────────────────────────────────────────────

async function mainLoop(): Promise<void> {
  showHeader();

  const state: TuiState = {
    lastResult: null,
    lastCmd: null,
    lastParams: null,
    lastToolModule: null,
  };

  while (true) {
    const rl = createPrompt();
    const input = await askLine(rl);
    rl.close();

    // Ctrl+D or stream end
    if (input === null) {
      console.log(chalk.dim("\n  Bye!\n"));
      process.exit(0);
    }

    const trimmed = input.trim();
    if (!trimmed) continue;

    // ── Slash command ────────────────────────────────────────────
    if (trimmed.startsWith("/")) {
      try {
        await handleSlashCommand(trimmed, state);
      } catch (e) {
        if (e instanceof TuiCancelError) {
          console.log();
          continue;
        }
        throw e;
      }
      continue;
    }

    // ── Unknown input (text without /) ─────────────────────────
    console.log(chalk.dim("  Unknown input. Type /help for commands.\n"));
  }
}

// ── Entry Point ──────────────────────────────────────────────────────

export async function runTui(): Promise<void> {
  // First-run check: no config AND no env API keys
  const config = loadCliConfig();
  const hasAnyKey =
    config.BRAVE_API_KEY ||
    process.env.BRAVE_API_KEY;

  if (!hasAnyKey && Object.keys(config).length === 0) {
    console.log();
    console.log(chalk.dim("  No API keys configured."));
    console.log(chalk.dim("  Run /setup after startup to configure, or continue without.\n"));
  }

  try {
    await mainLoop();
  } catch (e) {
    if (e instanceof TuiCancelError) {
      console.log(chalk.dim("\n  Bye!\n"));
      process.exit(0);
    }
    throw e;
  }
}
