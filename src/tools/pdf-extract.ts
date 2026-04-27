/**
 * pdf-extract — extract text, pages, tables, and metadata from a PDF.
 *
 * v2.5.0: native strategy only (pdfjs-dist text layer).
 * OCR + Claude Vision fallbacks are deferred to v2.6.0.
 *
 * Accepts a local path or a remote URL (auto-download to tmp).
 */

import { z } from "zod";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { toolResult, errorResult } from "../utils/tool-response.js";
import { debugLog } from "../utils/debug.js";

export const name = "pdf_extract";

export const description =
  "Extract text, pages, tables, and metadata from a local or remote PDF. Native text-layer strategy (pdfjs-dist). OCR/Vision fallbacks deferred to v2.6.0.";

export const schema = z.object({
  input: z
    .string()
    .min(1)
    .describe("Local PDF path or remote URL (http/https). URL inputs are downloaded to a temp file."),
  output: z
    .string()
    .default("./extracted.json")
    .describe("Output JSON path"),
  preserve_layout: z
    .boolean()
    .default(true)
    .describe("Preserve line breaks and approximate layout when assembling text"),
  extract_tables: z
    .boolean()
    .default(true)
    .describe("Run basic regex-based table extraction"),
  max_pages: z
    .number()
    .min(0)
    .default(0)
    .describe("Limit pages to extract (0 = all)"),
});

export type PdfExtractInput = z.infer<typeof schema>;

interface PageOutput {
  num: number;
  text: string;
  confidence: number;
}

interface TableOutput {
  page: number;
  rows: string[][];
}

interface PdfExtractOutput {
  text: string;
  pages: PageOutput[];
  tables: TableOutput[];
  metadata: {
    title?: string;
    author?: string;
    pages: number;
    extracted_at: string;
    source: string;
  };
  strategy_used: "native";
  overall_confidence: number;
  warnings: string[];
}

// Minimal shape we use from pdfjs-dist — avoids DOM type conflicts with jsdom.
interface TextItemLike {
  str: string;
  transform?: number[];
  hasEOL?: boolean;
}
interface TextContentLike {
  items: TextItemLike[];
}
interface PdfPageLike {
  getTextContent: () => Promise<TextContentLike>;
}
interface PdfDocumentLike {
  numPages: number;
  getPage: (n: number) => Promise<PdfPageLike>;
  getMetadata: () => Promise<{ info?: Record<string, unknown> }>;
}

async function downloadToTmp(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download PDF (${res.status} ${res.statusText}): ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const dir = await mkdtemp(join(tmpdir(), "imperium-pdf-"));
  const file = join(dir, "input.pdf");
  await writeFile(file, buf);
  return file;
}

/**
 * Assemble text from pdfjs text items. When preserveLayout is true, we insert
 * newlines on hasEOL markers and approximate line breaks using y-coordinate deltas.
 */
function assemblePageText(items: TextItemLike[], preserveLayout: boolean): string {
  if (!preserveLayout) {
    return items.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim();
  }

  const lines: string[] = [];
  let current = "";
  let lastY: number | null = null;

  for (const it of items) {
    const y = Array.isArray(it.transform) && it.transform.length >= 6 ? it.transform[5] : null;
    const yChanged = y !== null && lastY !== null && Math.abs(y - lastY) > 2;

    if (yChanged) {
      if (current.trim()) lines.push(current.trimEnd());
      current = "";
    }

    current += it.str;

    if (it.hasEOL) {
      if (current.trim()) lines.push(current.trimEnd());
      current = "";
    }

    if (y !== null) lastY = y;
  }

  if (current.trim()) lines.push(current.trimEnd());
  return lines.join("\n");
}

/**
 * Basic table extraction: looks for lines with 2+ runs of whitespace (≥2 spaces
 * or tabs) as column separators. A table is ≥2 consecutive rows with the same
 * column count.
 */
function extractTablesFromText(text: string, pageNum: number): TableOutput[] {
  const lines = text.split("\n");
  const tables: TableOutput[] = [];
  let buffer: string[][] = [];
  let colCount = 0;

  const flush = () => {
    if (buffer.length >= 2) {
      tables.push({ page: pageNum, rows: buffer });
    }
    buffer = [];
    colCount = 0;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flush();
      continue;
    }
    // Split on 2+ whitespace or tab
    const cells = trimmed.split(/\s{2,}|\t+/).map((c) => c.trim()).filter(Boolean);
    if (cells.length >= 2) {
      if (colCount === 0) {
        colCount = cells.length;
        buffer.push(cells);
      } else if (cells.length === colCount) {
        buffer.push(cells);
      } else {
        flush();
        colCount = cells.length;
        buffer.push(cells);
      }
    } else {
      flush();
    }
  }
  flush();

  return tables;
}

function computeConfidence(text: string): number {
  if (!text) return 0;
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;

  // Heuristic: ratio of printable ASCII + basic unicode letters vs total chars.
  let printable = 0;
  for (const ch of trimmed) {
    const code = ch.charCodeAt(0);
    if (code >= 32 && code < 127) printable++;
    else if (/\p{L}|\p{N}|\p{P}|\s/u.test(ch)) printable++;
  }
  const ratio = printable / trimmed.length;
  // Length factor: at least 50 chars = full confidence contribution
  const lengthFactor = Math.min(1, trimmed.length / 50);
  return Math.min(1, ratio * lengthFactor);
}

export async function execute(input: PdfExtractInput) {
  const warnings: string[] = [];

  try {
    // Resolve input (URL or local path)
    let pdfPath: string;
    const isUrl = /^https?:\/\//i.test(input.input);
    if (isUrl) {
      debugLog("pdf-extract", "downloading url", input.input);
      pdfPath = await downloadToTmp(input.input);
    } else {
      pdfPath = resolvePath(input.input);
      if (!existsSync(pdfPath)) {
        return errorResult(`PDF not found at path: ${pdfPath}`);
      }
    }

    // Load pdfjs-dist (legacy build works in Node w/o DOMMatrix)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");

    const data = new Uint8Array(await readFile(pdfPath));
    const loadingTask = pdfjs.getDocument({
      data,
      useSystemFonts: true,
      // Disable font loading / canvas / workers for Node
      isEvalSupported: false,
      disableFontFace: true,
    });
    const doc: PdfDocumentLike = await loadingTask.promise;

    const totalPages = doc.numPages;
    const pageLimit = input.max_pages > 0 ? Math.min(input.max_pages, totalPages) : totalPages;

    const pages: PageOutput[] = [];
    const tables: TableOutput[] = [];
    const textChunks: string[] = [];

    for (let p = 1; p <= pageLimit; p++) {
      try {
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        const pageText = assemblePageText(content.items, input.preserve_layout);
        const conf = computeConfidence(pageText);
        pages.push({ num: p, text: pageText, confidence: conf });
        textChunks.push(pageText);
        if (input.extract_tables) {
          const pageTables = extractTablesFromText(pageText, p);
          tables.push(...pageTables);
        }
      } catch (pageErr) {
        warnings.push(`Page ${p}: ${pageErr instanceof Error ? pageErr.message : String(pageErr)}`);
        pages.push({ num: p, text: "", confidence: 0 });
      }
    }

    let metadataInfo: Record<string, unknown> = {};
    try {
      const md = await doc.getMetadata();
      metadataInfo = (md.info || {}) as Record<string, unknown>;
    } catch (mdErr) {
      warnings.push(`Metadata: ${mdErr instanceof Error ? mdErr.message : String(mdErr)}`);
    }

    const overall =
      pages.length > 0
        ? pages.reduce((s, p) => s + p.confidence, 0) / pages.length
        : 0;

    const fullText = textChunks.join("\n\n");

    if (!fullText.trim()) {
      warnings.push(
        "No text extracted via native text layer. PDF may be a scanned image — OCR fallback will land in v2.6.0.",
      );
    }

    const result: PdfExtractOutput = {
      text: fullText,
      pages,
      tables,
      metadata: {
        title: typeof metadataInfo.Title === "string" ? (metadataInfo.Title as string) : undefined,
        author: typeof metadataInfo.Author === "string" ? (metadataInfo.Author as string) : undefined,
        pages: totalPages,
        extracted_at: new Date().toISOString(),
        source: input.input,
      },
      strategy_used: "native",
      overall_confidence: overall,
      warnings,
    };

    // Always write output JSON to disk
    try {
      await writeFile(resolvePath(input.output), JSON.stringify(result, null, 2), "utf-8");
    } catch (wErr) {
      warnings.push(`Failed to write output file: ${wErr instanceof Error ? wErr.message : String(wErr)}`);
    }

    return toolResult({ ...result, output_file: resolvePath(input.output) });
  } catch (err) {
    debugLog("pdf-extract", "failed", err);
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}
