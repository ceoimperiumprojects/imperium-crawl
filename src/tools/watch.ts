/**
 * watch — one-shot change detector for URLs.
 *
 * v2.5.0: one-shot mode only. Snapshots content, hashes it, diffs against
 * the previous snapshot for the same URL. Fires a webhook on change.
 *
 * Daemon mode (SIGINT loop) is deferred to v2.6.0 — use cron externally:
 *   * /30 * * * *  imperium-crawl watch --url X --output-dir /var/watch
 */

import { z } from "zod";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { fetchPage } from "../utils/fetcher.js";
import { htmlToMarkdown } from "../utils/markdown.js";
import { toolResult, errorResult } from "../utils/tool-response.js";
import { debugLog } from "../utils/debug.js";
import { MAX_URL_LENGTH } from "../core/constants.js";

export const name = "watch";

export const description =
  "One-shot change detector: scrape a URL, hash its content, and compare against the last snapshot. Fires a webhook on change. Run via cron for periodic monitoring.";

export const schema = z.object({
  url: z
    .string()
    .max(MAX_URL_LENGTH)
    .describe("URL to watch"),
  output_dir: z
    .string()
    .default("./data/watch")
    .describe("Directory to persist snapshots and state"),
  hash_on: z
    .enum(["content", "readability", "markdown"])
    .default("readability")
    .describe("What to hash: full HTML, readability main content, or markdown"),
  webhook: z
    .string()
    .max(MAX_URL_LENGTH)
    .optional()
    .describe("If set, POST a JSON payload to this URL on detected change"),
  diff_format: z
    .enum(["unified", "json"])
    .default("unified")
    .describe("Diff representation in the result"),
  one_shot: z
    .boolean()
    .default(true)
    .describe("v2.5.0: always true. Daemon mode lands in v2.6.0."),
});

export type WatchInput = z.infer<typeof schema>;

interface WatchState {
  url: string;
  last_hash: string;
  last_checked: string;
  last_changed: string | null;
  hash_on: string;
  check_count: number;
  change_count: number;
}

interface WatchResult {
  url: string;
  changed: boolean;
  first_run: boolean;
  previous_hash: string | null;
  current_hash: string;
  hash_on: string;
  snapshot_file: string;
  diff: string | null;
  webhook_fired: boolean;
  webhook_status?: number;
  state: WatchState;
  checked_at: string;
}

function slugify(url: string): string {
  return createHash("sha1").update(url).digest("hex").slice(0, 16);
}

function hashString(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function simpleUnifiedDiff(prev: string, next: string, maxLines = 200): string {
  const prevLines = prev.split("\n");
  const nextLines = next.split("\n");
  const prevSet = new Set(prevLines);
  const nextSet = new Set(nextLines);

  const out: string[] = [];
  let removed = 0;
  let added = 0;
  for (const line of prevLines) {
    if (!nextSet.has(line)) {
      out.push(`- ${line}`);
      removed++;
    }
  }
  for (const line of nextLines) {
    if (!prevSet.has(line)) {
      out.push(`+ ${line}`);
      added++;
    }
  }
  const header = `@@ -${prevLines.length} +${nextLines.length} @@ (${removed} removed, ${added} added)`;
  const body = out.slice(0, maxLines).join("\n");
  const truncated = out.length > maxLines ? `\n... (${out.length - maxLines} more lines)` : "";
  return `${header}\n${body}${truncated}`;
}

function jsonDiff(prev: string, next: string): string {
  const prevLines = prev.split("\n");
  const nextLines = next.split("\n");
  const prevSet = new Set(prevLines);
  const nextSet = new Set(nextLines);
  const removed = prevLines.filter((l) => !nextSet.has(l));
  const added = nextLines.filter((l) => !prevSet.has(l));
  return JSON.stringify({ removed, added, prev_lines: prevLines.length, next_lines: nextLines.length });
}

export async function computeSignature(
  html: string,
  url: string,
  hashOn: WatchInput["hash_on"],
): Promise<string> {
  if (hashOn === "content") return html;
  if (hashOn === "markdown") return htmlToMarkdown(html);

  // readability
  try {
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    if (article?.textContent) return article.textContent.trim();
    return htmlToMarkdown(html);
  } catch {
    return htmlToMarkdown(html);
  }
}

async function loadState(stateFile: string): Promise<Record<string, WatchState>> {
  if (!existsSync(stateFile)) return {};
  try {
    const raw = await readFile(stateFile, "utf-8");
    return JSON.parse(raw) as Record<string, WatchState>;
  } catch {
    return {};
  }
}

async function saveState(stateFile: string, state: Record<string, WatchState>): Promise<void> {
  await writeFile(stateFile, JSON.stringify(state, null, 2), "utf-8");
}

async function fireWebhook(
  webhook: string,
  payload: unknown,
): Promise<{ fired: boolean; status?: number }> {
  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { fired: true, status: res.status };
  } catch (err) {
    debugLog("watch", "webhook failed", err);
    return { fired: false };
  }
}

export async function runWatchOnce(input: WatchInput): Promise<WatchResult> {
  const outDir = resolvePath(input.output_dir);
  await mkdir(outDir, { recursive: true });
  const stateFile = join(outDir, ".state.json");
  const state = await loadState(stateFile);

  const fetched = await fetchPage(input.url);
  const signature = await computeSignature(fetched.html, input.url, input.hash_on);
  const currentHash = hashString(signature);

  const slug = slugify(input.url);
  const snapshotFile = join(outDir, `${slug}.snapshot.txt`);
  const prevSnapshotFile = join(outDir, `${slug}.previous.txt`);

  const existing = state[input.url];
  const firstRun = !existing;
  const changed = !firstRun && existing.last_hash !== currentHash;

  let previousSig: string | null = null;
  if (existsSync(snapshotFile)) {
    try {
      previousSig = await readFile(snapshotFile, "utf-8");
    } catch {
      previousSig = null;
    }
  }

  // Rotate previous snapshot only when content changed
  if (changed && previousSig !== null) {
    await writeFile(prevSnapshotFile, previousSig, "utf-8");
  }
  await writeFile(snapshotFile, signature, "utf-8");

  const nowIso = new Date().toISOString();
  const newState: WatchState = {
    url: input.url,
    last_hash: currentHash,
    last_checked: nowIso,
    last_changed: changed ? nowIso : existing?.last_changed ?? null,
    hash_on: input.hash_on,
    check_count: (existing?.check_count ?? 0) + 1,
    change_count: (existing?.change_count ?? 0) + (changed ? 1 : 0),
  };
  state[input.url] = newState;
  await saveState(stateFile, state);

  let diff: string | null = null;
  if (changed && previousSig !== null) {
    diff =
      input.diff_format === "unified"
        ? simpleUnifiedDiff(previousSig, signature)
        : jsonDiff(previousSig, signature);
  }

  let webhookFired = false;
  let webhookStatus: number | undefined;
  if (changed && input.webhook) {
    const payload = {
      event: "watch.change",
      url: input.url,
      previous_hash: existing?.last_hash ?? null,
      current_hash: currentHash,
      detected_at: nowIso,
      diff,
    };
    const res = await fireWebhook(input.webhook, payload);
    webhookFired = res.fired;
    webhookStatus = res.status;
  }

  return {
    url: input.url,
    changed,
    first_run: firstRun,
    previous_hash: existing?.last_hash ?? null,
    current_hash: currentHash,
    hash_on: input.hash_on,
    snapshot_file: snapshotFile,
    diff,
    webhook_fired: webhookFired,
    webhook_status: webhookStatus,
    state: newState,
    checked_at: nowIso,
  };
}

export async function execute(input: WatchInput) {
  try {
    const result = await runWatchOnce(input);
    return toolResult(result);
  } catch (err) {
    debugLog("watch", "failed", err);
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}
