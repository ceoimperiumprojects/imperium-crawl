/**
 * monitor — portfolio-level change tracker over many URLs, grouped by topic.
 *
 * v2.5.0: minimal scope — JSON config parser + markdown digest generator.
 * Internally reuses the watch tool's runWatchOnce() for per-URL change detection.
 * Filters out sub-threshold churn (min_change_pct) and emits a single digest
 * file per run, listing the top changes per topic.
 *
 * YAML config + LLM summarisation are deferred to v2.6.0.
 */

import { z } from "zod";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { toolResult, errorResult } from "../utils/tool-response.js";
import { debugLog } from "../utils/debug.js";
import { runWatchOnce, type WatchInput } from "./watch.js";

export const name = "monitor";

export const description =
  "Portfolio-level change tracker: read a JSON config of topics and URLs, run watch on each, emit a markdown digest of changes.";

export const schema = z.object({
  config: z
    .string()
    .optional()
    .describe("Path to JSON config (topics with URL lists). Mutually exclusive with --urls/--topic."),
  urls: z
    .array(z.string())
    .optional()
    .describe("Single-topic shortcut: list of URLs. Repeat --urls."),
  topic: z
    .string()
    .optional()
    .describe("Topic name when using --urls"),
  output_dir: z
    .string()
    .default("./data/monitor")
    .describe("Output dir for state, snapshots, and digests"),
  min_change_pct: z
    .number()
    .min(0)
    .max(100)
    .default(5)
    .describe("Minimum % of lines changed to count as a 'meaningful' change"),
  export_format: z
    .enum(["markdown"])
    .default("markdown")
    .describe("Digest format (markdown only in v2.5.0)"),
  hash_on: z
    .enum(["content", "readability", "markdown"])
    .default("readability")
    .describe("Passed through to watch — what to hash per URL"),
});

export type MonitorInput = z.infer<typeof schema>;

interface TopicConfig {
  name: string;
  urls: string[];
  min_change_pct?: number;
}

interface MonitorConfig {
  topics: TopicConfig[];
}

interface TopicChange {
  url: string;
  changed: boolean;
  first_run: boolean;
  change_pct: number;
  previous_hash: string | null;
  current_hash: string;
}

interface TopicReport {
  name: string;
  urls_checked: number;
  changes: TopicChange[];
  meaningful_changes: number;
}

async function loadConfig(input: MonitorInput): Promise<MonitorConfig> {
  if (input.config) {
    const path = resolvePath(input.config);
    if (!existsSync(path)) throw new Error(`Config not found: ${path}`);
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<MonitorConfig>;
    if (!parsed.topics || !Array.isArray(parsed.topics)) {
      throw new Error("Config missing 'topics' array");
    }
    return { topics: parsed.topics as TopicConfig[] };
  }

  if (input.urls && input.urls.length > 0) {
    return {
      topics: [{ name: input.topic || "default", urls: input.urls }],
    };
  }

  throw new Error("Must provide --config OR --urls");
}

function computeChangePct(prev: string | null, next: string): number {
  if (!prev) return 100;
  const prevLines = prev.split("\n");
  const nextLines = next.split("\n");
  const prevSet = new Set(prevLines);
  const nextSet = new Set(nextLines);
  let removed = 0;
  let added = 0;
  for (const l of prevLines) if (!nextSet.has(l)) removed++;
  for (const l of nextLines) if (!prevSet.has(l)) added++;
  const total = Math.max(prevLines.length, nextLines.length, 1);
  return ((removed + added) / (2 * total)) * 100;
}

function renderMarkdownDigest(
  reports: TopicReport[],
  generatedAt: string,
  minPct: number,
): string {
  const lines: string[] = [];
  lines.push(`# Monitor digest — ${generatedAt.split("T")[0]}`);
  lines.push("");
  lines.push(`Generated: ${generatedAt}`);
  lines.push(`Threshold: ${minPct}% line change`);
  lines.push("");

  const totalMeaningful = reports.reduce((s, r) => s + r.meaningful_changes, 0);
  lines.push(`**${totalMeaningful}** meaningful change(s) across **${reports.length}** topic(s).`);
  lines.push("");

  for (const report of reports) {
    lines.push(`## ${report.name}`);
    lines.push(`- URLs checked: ${report.urls_checked}`);
    lines.push(`- Meaningful changes: ${report.meaningful_changes}`);
    lines.push("");

    const meaningful = report.changes.filter((c) => c.changed && c.change_pct >= minPct);
    if (meaningful.length === 0) {
      lines.push("_No meaningful changes._");
      lines.push("");
      continue;
    }

    for (const c of meaningful) {
      lines.push(`### ${c.url}`);
      lines.push(`- Change: ${c.change_pct.toFixed(1)}% of lines`);
      lines.push(`- Previous: \`${c.previous_hash?.slice(0, 12) ?? "(none)"}\``);
      lines.push(`- Current: \`${c.current_hash.slice(0, 12)}\``);
      lines.push("");
    }
  }

  return lines.join("\n");
}

export async function execute(input: MonitorInput) {
  try {
    const config = await loadConfig(input);
    const outDir = resolvePath(input.output_dir);
    await mkdir(outDir, { recursive: true });

    const reports: TopicReport[] = [];

    for (const topic of config.topics) {
      const topicDir = join(outDir, slug(topic.name));
      await mkdir(topicDir, { recursive: true });
      const threshold = topic.min_change_pct ?? input.min_change_pct;

      const changes: TopicChange[] = [];
      for (const url of topic.urls) {
        try {
          const watchInput: WatchInput = {
            url,
            output_dir: topicDir,
            hash_on: input.hash_on,
            diff_format: "unified",
            one_shot: true,
          };
          const wr = await runWatchOnce(watchInput);

          // For change %, load previous snapshot next to current one if it exists
          let pct = 0;
          if (wr.first_run) {
            pct = 0;
          } else if (wr.changed) {
            // Re-derive from snapshot files written by runWatchOnce
            const prevPath = wr.snapshot_file.replace(/\.snapshot\.txt$/, ".previous.txt");
            let prevSig: string | null = null;
            if (existsSync(prevPath)) {
              try { prevSig = await readFile(prevPath, "utf-8"); } catch { prevSig = null; }
            }
            let currSig = "";
            try { currSig = await readFile(wr.snapshot_file, "utf-8"); } catch { /* noop */ }
            pct = computeChangePct(prevSig, currSig);
          }

          changes.push({
            url,
            changed: wr.changed,
            first_run: wr.first_run,
            change_pct: pct,
            previous_hash: wr.previous_hash,
            current_hash: wr.current_hash,
          });
        } catch (urlErr) {
          debugLog("monitor", `failed for ${url}`, urlErr);
          changes.push({
            url,
            changed: false,
            first_run: false,
            change_pct: 0,
            previous_hash: null,
            current_hash: "",
          });
        }
      }

      const meaningful = changes.filter((c) => c.changed && c.change_pct >= threshold).length;
      reports.push({
        name: topic.name,
        urls_checked: topic.urls.length,
        changes,
        meaningful_changes: meaningful,
      });
    }

    const generatedAt = new Date().toISOString();
    const digestBody = renderMarkdownDigest(reports, generatedAt, input.min_change_pct);
    const digestFile = join(outDir, `digest-${generatedAt.replace(/[:.]/g, "-")}.md`);
    await writeFile(digestFile, digestBody, "utf-8");

    return toolResult({
      generated_at: generatedAt,
      topics: reports,
      digest_file: digestFile,
      format: input.export_format,
    });
  } catch (err) {
    debugLog("monitor", "failed", err);
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "topic";
}
