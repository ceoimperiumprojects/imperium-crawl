/**
 * CLI engine for imperium-crawl.
 *
 * Dynamically maps each tool's Zod schema to Commander options,
 * runs execute(), then formats output via formatters.ts.
 *
 * TTY-aware: spinners + colored output + tables in interactive mode;
 * clean JSON to stdout when piped (non-TTY / CI / NO_COLOR).
 *
 * Lazy loading: only the requested tool's module is imported at startup.
 * This keeps cold-start time fast even though some tools pull in heavy
 * deps (cheerio, linkedom, playwright, stealth engine).
 */

import { Command, Option } from "commander";
import { z } from "zod";
import { writeFileSync } from "fs";
import { type ToolDefinition } from "./tools/index.js";
import { TOOL_MANIFEST } from "./tools/manifest.js";
import {
  type OutputFormat,
  type FormatOptions,
  formatOutput,
  parseToolOutput,
  parseImageOutput,
} from "./formatters.js";
import { PACKAGE_VERSION } from "./constants.js";
import {
  isTTY,
  createSpinner,
  errorMsg,
  renderTable,
  colorUrl,
} from "./cli-ui.js";

// ── Zod Unwrapping ───────────────────────────────────────────────────

interface UnwrappedType {
  base: z.ZodTypeAny;
  isOptional: boolean;
  hasDefault: boolean;
  defaultValue: unknown;
  description: string | undefined;
}

/**
 * Recursively unwrap ZodDefault, ZodOptional, ZodNullable
 * to get the base type and metadata.
 */
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
    } else if (typeName === "ZodOptional") {
      isOptional = true;
      current = current._def.innerType;
    } else if (typeName === "ZodNullable") {
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

// ── Name Converters ──────────────────────────────────────────────────

/** snake_case → --kebab-case */
function snakeToKebab(key: string): string {
  return key.replace(/_/g, "-");
}

/** camelCase → snake_case (Commander's camelCase back to Zod's keys) */
function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase());
}

// ── Zod-to-Commander Option Mapper ───────────────────────────────────

function addOptionsFromSchema(cmd: Command, schema: z.ZodTypeAny): void {
  if (getZodTypeName(schema) !== "ZodObject") return;

  const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;

  for (const [key, fieldSchema] of Object.entries(shape)) {
    const {
      base,
      isOptional,
      hasDefault,
      defaultValue,
      description,
    } = unwrapZod(fieldSchema as z.ZodTypeAny);

    const flag = snakeToKebab(key);
    const desc = description ?? key;
    const typeName = getZodTypeName(base);
    const required = !isOptional && !hasDefault;

    if (typeName === "ZodString") {
      if (required) {
        cmd.requiredOption(`--${flag} <value>`, desc);
      } else {
        const opt = new Option(`--${flag} <value>`, desc);
        if (hasDefault) opt.default(defaultValue);
        cmd.addOption(opt);
      }
    } else if (typeName === "ZodNumber") {
      const parseNum = (v: string) => {
        const n = parseFloat(v);
        if (isNaN(n)) throw new Error(`Invalid number: ${v}`);
        return n;
      };
      if (required) {
        cmd.requiredOption(`--${flag} <n>`, desc, parseNum);
      } else {
        const opt = new Option(`--${flag} <n>`, desc);
        opt.argParser(parseNum);
        if (hasDefault) opt.default(defaultValue);
        cmd.addOption(opt);
      }
    } else if (typeName === "ZodBoolean") {
      if (hasDefault && defaultValue === true) {
        cmd.option(`--no-${flag}`, desc);
      } else {
        cmd.option(`--${flag}`, desc, hasDefault ? (defaultValue as boolean) : false);
      }
    } else if (typeName === "ZodEnum") {
      const values = (base as z.ZodEnum<[string, ...string[]]>)._def.values as string[];
      const opt = new Option(`--${flag} <value>`, desc).choices(values);
      if (hasDefault) opt.default(defaultValue);
      if (required) opt.makeOptionMandatory(true);
      cmd.addOption(opt);
    } else if (typeName === "ZodArray") {
      const collect = (val: string, prev: string[]) => prev.concat(val);
      const innerTypeName = getZodTypeName(unwrapZod(base._def.type).base);
      if (innerTypeName === "ZodEnum") {
        const values = (unwrapZod(base._def.type).base as z.ZodEnum<[string, ...string[]]>)._def
          .values as string[];
        const opt = new Option(`--${flag} <value>`, desc)
          .choices(values)
          .argParser(collect)
          .default(hasDefault ? defaultValue : []);
        cmd.addOption(opt);
      } else if (innerTypeName === "ZodObject") {
        // Parse as single JSON array string (e.g. --actions '[{...},{...}]')
        const parseJsonArray = (val: string) => {
          try {
            const parsed = JSON.parse(val);
            if (!Array.isArray(parsed)) throw new Error("Expected JSON array");
            return parsed;
          } catch {
            throw new Error(`Invalid JSON array for --${flag}: ${val}`);
          }
        };
        if (required) {
          cmd.requiredOption(`--${flag} <json>`, desc, parseJsonArray);
        } else {
          const opt = new Option(`--${flag} <json>`, desc);
          opt.argParser(parseJsonArray);
          if (hasDefault) opt.default(defaultValue);
          cmd.addOption(opt);
        }
      } else {
        cmd.option(
          `--${flag} <value>`,
          desc,
          collect,
          (hasDefault ? defaultValue : []) as string[],
        );
      }
    } else if (typeName === "ZodRecord") {
      const parseJson = (val: string) => {
        try {
          return JSON.parse(val);
        } catch {
          throw new Error(`Invalid JSON for --${flag}: ${val}`);
        }
      };
      if (required) {
        cmd.requiredOption(`--${flag} <json>`, desc, parseJson);
      } else {
        const opt = new Option(`--${flag} <json>`, desc);
        opt.argParser(parseJson);
        if (hasDefault) opt.default(defaultValue);
        cmd.addOption(opt);
      }
    } else {
      cmd.option(`--${flag} <value>`, desc);
    }
  }
}

// ── Reverse Key Mapper ───────────────────────────────────────────────

function optsToInput(
  opts: Record<string, unknown>,
  schema: z.ZodTypeAny,
): Record<string, unknown> {
  if (getZodTypeName(schema) !== "ZodObject") return {};

  const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
  const schemaKeys = new Set(Object.keys(shape));
  const input: Record<string, unknown> = {};

  for (const [camelKey, value] of Object.entries(opts)) {
    if (value === undefined) continue;

    const snakeKey = camelToSnake(camelKey);

    if (schemaKeys.has(snakeKey)) {
      input[snakeKey] = value;
    } else if (schemaKeys.has(camelKey)) {
      input[camelKey] = value;
    }
  }

  return input;
}

// ── Lazy Tool Loader ─────────────────────────────────────────────────

/**
 * Which tool command the user requested (from argv), or null for
 * global commands (--help, setup, --version).
 *
 * Detected before Commander runs so we can load only that tool's module.
 */
function getRequestedCmd(): string | null {
  const arg = process.argv[2];
  if (!arg || arg.startsWith("-")) return null;
  return arg; // e.g., "scrape", "list-jobs", "setup"
}

// ── Table Renderers ──────────────────────────────────────────────────

function tryRenderTable(toolName: string, data: unknown): string | null {
  if (!isTTY) return null;
  if (!data || typeof data !== "object") return null;

  const obj = data as Record<string, unknown>;

  if (toolName === "list_jobs") {
    const jobs = Array.isArray(obj.jobs) ? obj.jobs : [];
    if (jobs.length === 0) return null;
    const headers = ["Job ID", "Status", "URLs", "Progress"];
    const rows = jobs.map((j: unknown) => {
      const job = j as Record<string, unknown>;
      const total = Number(job.urls_total ?? 0);
      const done = Number(job.urls_completed ?? 0);
      const failed = Number(job.urls_failed ?? 0);
      const pct = total > 0 ? Math.round(((done + failed) / total) * 100) : 0;
      return [String(job.id ?? ""), String(job.status ?? ""), `${done + failed}/${total}`, `${pct}%`];
    });
    return renderTable(headers, rows);
  }

  if (toolName === "list_skills") {
    const skills = Array.isArray(obj.skills) ? obj.skills : [];
    if (skills.length === 0) return null;
    const headers = ["Name", "Type", "URL", "Fields", "Created"];
    const rows = skills.map((s: unknown) => {
      const skill = s as Record<string, unknown>;
      const fields = Array.isArray(skill.fields) ? skill.fields.join(", ") : "";
      const created = typeof skill.created_at === "string" ? skill.created_at.split("T")[0] : "";
      const toolType = String(skill.tool ?? "extract");
      const typeLabel = skill.builtin ? `${toolType} (built-in)` : toolType;
      return [String(skill.name ?? ""), typeLabel, colorUrl(String(skill.url ?? "")), fields, created];
    });
    return renderTable(headers, rows);
  }

  if (["search", "news_search", "image_search", "video_search"].includes(toolName)) {
    const results = Array.isArray(obj.results) ? obj.results : [];
    if (results.length === 0) return null;
    const headers = ["#", "Title", "URL"];
    const rows = results.slice(0, 20).map((r: unknown, i: number) => {
      const result = r as Record<string, unknown>;
      const title = String(result.title ?? result.name ?? "").slice(0, 50);
      const url = colorUrl(String(result.url ?? result.source ?? "").slice(0, 60));
      return [String(i + 1), title, url];
    });
    return renderTable(headers, rows);
  }

  return null;
}

// ── Contextual Error Messages ────────────────────────────────────────

function handleToolError(toolName: string, msg: string): void {
  errorMsg(msg);

  const needsKey =
    msg.includes("API_KEY") ||
    msg.toLowerCase().includes("api key") ||
    ["search", "news_search", "image_search", "video_search", "ai_extract"].includes(toolName);

  if (needsKey) {
    process.stderr.write(
      "\n  Run \x1b[1mimperiumcrawl setup\x1b[0m to configure API keys.\n\n",
    );
  }
}

// ── Program Builder ──────────────────────────────────────────────────

export async function buildCli(): Promise<Command> {
  const program = new Command();

  program
    .name("imperiumcrawl")
    .description(
      "25-tool web scraping, crawling, search, and API discovery CLI.\nRun without arguments in TTY for interactive TUI.",
    )
    .version(PACKAGE_VERSION)
    .addOption(
      new Option("--output-format <fmt>", "Output format")
        .choices(["json", "jsonl", "csv", "markdown"])
        .default("json"),
    )
    .option("--output <file>", "Write output to file instead of stdout")
    .option("--pretty", "Pretty-print JSON output", false);

  // ── Setup wizard ────────────────────────────────────────────────
  program
    .command("setup")
    .description("Configure API keys and save them to ~/.imperium-crawl/config.json")
    .action(async () => {
      const { runSetup } = await import("./cli-onboarding.js");
      await runSetup();
    });

  // ── Tool commands — lazy loaded ──────────────────────────────────
  const requestedCmd = getRequestedCmd();

  for (const { cmd, description } of TOOL_MANIFEST) {
    const sub = program.command(cmd).description(description);

    if (cmd === requestedCmd) {
      // Load the full tool module for this command only.
      // This is the only heavy import at startup — all others are skipped.
      const toolModule = await import(`./tools/${cmd}.js`) as ToolDefinition;
      addOptionsFromSchema(sub, toolModule.schema);
      sub.action(async (localOpts: Record<string, unknown>) => {
        await runTool(toolModule, localOpts, program);
      });
    } else {
      // For all other commands: register with just name + description.
      // Options are loaded lazily if the command is somehow invoked.
      sub.action(async (_localOpts: Record<string, unknown>) => {
        const toolModule = await import(`./tools/${cmd}.js`) as ToolDefinition;
        // Re-parse options now that we have the schema
        const rawOpts = sub.opts();
        await runTool(toolModule, rawOpts, program);
      });
    }
  }

  return program;
}

async function runTool(
  tool: ToolDefinition,
  localOpts: Record<string, unknown>,
  program: Command,
): Promise<void> {
  const globalOpts = program.opts();

  const input = optsToInput(localOpts, tool.schema);

  let validated: unknown;
  try {
    validated = (tool.schema as z.ZodObject<z.ZodRawShape>).parse(input);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const issues = err.issues
        .map((i) => `  ${i.path.join(".")}: ${i.message}`)
        .join("\n");
      process.stderr.write(`Validation error:\n${issues}\n`);
      process.exit(1);
    }
    throw err;
  }

  const spinner = createSpinner(`Running ${tool.name}...`);
  const start = Date.now();

  let result: { content: Array<{ type: string; text?: string }> };
  try {
    result = await tool.execute(validated);
    spinner.succeed(`Done in ${((Date.now() - start) / 1000).toFixed(1)}s`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    spinner.fail(`Failed: ${msg}`);
    handleToolError(tool.name, msg);
    process.exit(1);
  }

  // Handle image responses (screenshot tool, interact with return_screenshot)
  const imageResult = parseImageOutput(result);
  if (imageResult) {
    const imgPath = `screenshot-${Date.now()}.png`;
    writeFileSync(imgPath, Buffer.from(imageResult.data, "base64"));
    process.stderr.write(`Screenshot saved to ${imgPath}\n`);
  }

  const data = parseToolOutput(result);

  // Image-only response (no text data) — we're done
  if (imageResult && data === null) return;

  const table = tryRenderTable(tool.name, data);
  if (table) {
    process.stdout.write(table + "\n");
    return;
  }

  const formatOptions: FormatOptions = {
    format: globalOpts.outputFormat as OutputFormat,
    pretty: globalOpts.pretty as boolean,
  };
  const output = formatOutput(data, formatOptions);

  const outputFile = globalOpts.output as string | undefined;
  if (outputFile) {
    writeFileSync(outputFile, output + "\n", "utf-8");
    process.stderr.write(`Written to ${outputFile}\n`);
  } else {
    process.stdout.write(output + "\n");
  }
}

// ── Entry Point ──────────────────────────────────────────────────────

export async function runCli(): Promise<void> {
  const program = await buildCli();
  await program.parseAsync(process.argv);
}
