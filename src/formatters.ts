/**
 * Output formatters for CLI mode.
 *
 * Tool execute() returns { content: [{ type: "text", text: JSON.stringify(data) }] }.
 * These formatters transform that data into json, jsonl, csv, or markdown.
 */

export type OutputFormat = "json" | "jsonl" | "csv" | "markdown";

export interface FormatOptions {
  format: OutputFormat;
  pretty?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Parse the first text content block from an MCP tool result.
 */
export function parseToolOutput(
  result: { content: Array<{ type: string; text?: string }> },
): unknown {
  const textBlock = result.content.find((c) => c.type === "text" && c.text);
  if (!textBlock?.text) return null;
  try {
    return JSON.parse(textBlock.text);
  } catch {
    // Not JSON — return raw text
    return textBlock.text;
  }
}

/**
 * Parse the first image content block from an MCP tool result.
 * Returns base64 data + mimeType, or null if no image block found.
 */
export function parseImageOutput(
  result: { content: Array<{ type: string; data?: string; mimeType?: string }> },
): { data: string; mimeType: string } | null {
  const imgBlock = result.content.find((c) => c.type === "image" && c.data);
  if (!imgBlock?.data) return null;
  return { data: imgBlock.data, mimeType: imgBlock.mimeType ?? "image/png" };
}

/**
 * Find the primary array field in an object (for jsonl/csv).
 * Looks for common keys like results, items, pages, urls, skills, etc.
 */
function findArrayField(data: Record<string, unknown>): unknown[] | null {
  const priorityKeys = [
    "results",
    "items",
    "pages",
    "urls",
    "links",
    "skills",
    "images",
    "videos",
    "apis",
    "endpoints",
    "messages",
  ];

  for (const key of priorityKeys) {
    if (Array.isArray(data[key])) return data[key] as unknown[];
  }

  // Fallback: find first array value
  for (const val of Object.values(data)) {
    if (Array.isArray(val)) return val as unknown[];
  }

  return null;
}

// ── CSV Helpers ──────────────────────────────────────────────────────

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str =
    typeof value === "object" ? JSON.stringify(value) : String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";

  // Collect all unique keys across all rows
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const header = keys.map(csvEscape).join(",");
  const lines = rows.map((row) =>
    keys.map((k) => csvEscape(row[k])).join(","),
  );

  return [header, ...lines].join("\n");
}

// ── Format Functions ─────────────────────────────────────────────────

function formatJson(data: unknown, pretty?: boolean): string {
  return pretty
    ? JSON.stringify(data, null, 2)
    : JSON.stringify(data);
}

function formatJsonl(data: unknown): string {
  if (Array.isArray(data)) {
    return data.map((item) => JSON.stringify(item)).join("\n");
  }

  if (data && typeof data === "object") {
    const arr = findArrayField(data as Record<string, unknown>);
    if (arr) {
      return arr.map((item) => JSON.stringify(item)).join("\n");
    }
  }

  // Single object — emit as one line
  return JSON.stringify(data);
}

function formatCsv(data: unknown): string {
  let rows: Record<string, unknown>[];

  if (Array.isArray(data)) {
    rows = data.filter((item) => item && typeof item === "object") as Record<
      string,
      unknown
    >[];
  } else if (data && typeof data === "object") {
    const arr = findArrayField(data as Record<string, unknown>);
    if (arr) {
      rows = arr.filter(
        (item) => item && typeof item === "object",
      ) as Record<string, unknown>[];
    } else {
      // Single object — one row
      rows = [data as Record<string, unknown>];
    }
  } else {
    return String(data);
  }

  return toCsv(rows);
}

function formatMarkdown(data: unknown): string {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    // Scrape/readability: extract markdown or content field directly
    if (typeof obj.markdown === "string") return obj.markdown;
    if (typeof obj.content === "string") return obj.content;
  }

  // Fallback: pretty JSON
  return JSON.stringify(data, null, 2);
}

// ── Main Entry Point ─────────────────────────────────────────────────

export function formatOutput(data: unknown, options: FormatOptions): string {
  switch (options.format) {
    case "json":
      return formatJson(data, options.pretty);
    case "jsonl":
      return formatJsonl(data);
    case "csv":
      return formatCsv(data);
    case "markdown":
      return formatMarkdown(data);
    default:
      return formatJson(data, options.pretty);
  }
}
