/**
 * CLI engine for imperium-crawl.
 *
 * Dynamically maps each tool's Zod schema to Commander options,
 * runs execute(), then formats output via formatters.ts.
 */

import { Command, Option } from "commander";
import { z } from "zod";
import { writeFileSync } from "fs";
import { allTools, type ToolDefinition } from "./tools/index.js";
import {
  type OutputFormat,
  type FormatOptions,
  formatOutput,
  parseToolOutput,
} from "./formatters.js";
import { PACKAGE_VERSION } from "./constants.js";

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

  // Peel layers
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
  // Handle empty schemas (like list-skills)
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
        // default true → --no-flag to disable
        cmd.option(`--no-${flag}`, desc);
      } else {
        // default false or no default → --flag to enable
        cmd.option(`--${flag}`, desc, hasDefault ? (defaultValue as boolean) : false);
      }
    } else if (typeName === "ZodEnum") {
      const values = (base as z.ZodEnum<[string, ...string[]]>)._def.values as string[];
      const opt = new Option(`--${flag} <value>`, desc).choices(values);
      if (hasDefault) opt.default(defaultValue);
      if (required) opt.makeOptionMandatory(true);
      cmd.addOption(opt);
    } else if (typeName === "ZodArray") {
      // Array of values — collect pattern
      const collect = (val: string, prev: string[]) => prev.concat(val);
      const innerTypeName = getZodTypeName(
        unwrapZod(base._def.type).base,
      );
      if (innerTypeName === "ZodEnum") {
        const values = (unwrapZod(base._def.type).base as z.ZodEnum<[string, ...string[]]>)._def
          .values as string[];
        const opt = new Option(`--${flag} <value>`, desc)
          .choices(values)
          .argParser(collect)
          .default(hasDefault ? defaultValue : []);
        cmd.addOption(opt);
      } else {
        cmd.option(
          `--${flag} <value>`,
          desc,
          collect,
          (hasDefault ? defaultValue : []) as string[],
        );
      }
    } else if (typeName === "ZodRecord") {
      // Record → JSON string input
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
      // Fallback: treat as string
      cmd.option(`--${flag} <value>`, desc);
    }
  }
}

// ── Reverse Key Mapper ───────────────────────────────────────────────

/**
 * Convert Commander's camelCase opts back to Zod's snake_case keys.
 * Only includes keys that exist in the tool schema.
 */
function optsToInput(
  opts: Record<string, unknown>,
  schema: z.ZodTypeAny,
): Record<string, unknown> {
  if (getZodTypeName(schema) !== "ZodObject") return {};

  const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
  const schemaKeys = new Set(Object.keys(shape));
  const input: Record<string, unknown> = {};

  for (const [camelKey, value] of Object.entries(opts)) {
    // Skip Commander internals and global CLI options
    if (value === undefined) continue;

    const snakeKey = camelToSnake(camelKey);

    if (schemaKeys.has(snakeKey)) {
      input[snakeKey] = value;
    } else if (schemaKeys.has(camelKey)) {
      // Some keys are already snake_case (single words like 'url', 'query')
      input[camelKey] = value;
    }
  }

  return input;
}

// ── Program Builder ──────────────────────────────────────────────────

export function buildCli(): Command {
  const program = new Command();

  program
    .name("imperium-crawl")
    .description(
      "16-tool web scraping, crawling, search, and API discovery CLI.\nRun without arguments to start as MCP server.",
    )
    .version(PACKAGE_VERSION)
    .addOption(
      new Option("--output-format <fmt>", "Output format")
        .choices(["json", "jsonl", "csv", "markdown"])
        .default("json"),
    )
    .option("--output <file>", "Write output to file instead of stdout")
    .option("--pretty", "Pretty-print JSON output", false);

  // Register a subcommand for each tool
  for (const tool of allTools) {
    const cmdName = tool.name.replace(/_/g, "-");
    const sub = program
      .command(cmdName)
      .description(tool.description);

    addOptionsFromSchema(sub, tool.schema);

    sub.action(async (localOpts: Record<string, unknown>) => {
      await runTool(tool, localOpts, program);
    });
  }

  return program;
}

async function runTool(
  tool: ToolDefinition,
  localOpts: Record<string, unknown>,
  program: Command,
): Promise<void> {
  const globalOpts = program.opts();

  // Map Commander camelCase → Zod snake_case
  const input = optsToInput(localOpts, tool.schema);

  // Validate via Zod
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

  // Execute the tool
  let result: { content: Array<{ type: string; text?: string }> };
  try {
    result = await tool.execute(validated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
  }

  // Parse and format
  const data = parseToolOutput(result);
  const formatOptions: FormatOptions = {
    format: globalOpts.outputFormat as OutputFormat,
    pretty: globalOpts.pretty as boolean,
  };
  const output = formatOutput(data, formatOptions);

  // Write to file or stdout
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
  const program = buildCli();
  await program.parseAsync(process.argv);
}
