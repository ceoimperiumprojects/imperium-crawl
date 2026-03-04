#!/usr/bin/env node

/**
 * Bulk Job Scraper — 2,190 SaaS Companies
 *
 * Usage:
 *   npm run scrape:discover -- <excel-path> [options]
 *   npm run scrape:extract
 *   npm run scrape:stats
 *   npm run scrape:export
 *
 * Options:
 *   --limit=N         Process only first N companies
 *   --resume          Resume from saved state
 *   --phase=1|2       Phase 1 = careers discovery, Phase 2 = job extraction
 *   --concurrency=N   Parallel workers (default: 2)
 *   --stats           Show stats from JSONL output files
 *   --export-csv      Export to CSV
 *   --export-json     Export to JSON (pretty-printed)
 *   --export-xlsx     Export to Excel (.xlsx with sheets)
 *   --export-md       Export to Markdown tables
 *   --export-all      Export to all formats
 */

import "dotenv/config";
import { readCompanies } from "./excel-reader.js";
import { findCareersUrl } from "./careers-finder.js";
import { extractJobs } from "./job-extractor.js";
import {
  createState,
  loadState,
  saveState,
  markProcessed,
  markError,
  isProcessed,
} from "./state.js";
import {
  appendCareersResult,
  appendJobResult,
  appendError,
  loadCareersResults,
} from "./output.js";
import { exportAll, type ExportFormat } from "./csv-export.js";
import { loadDomainMemory, saveDomainMemory } from "./domain-memory.js";
import { CONCURRENCY, DELAY_MS, STATE_SAVE_INTERVAL, OUTPUT_DIR } from "./config.js";
import { getPool } from "../../src/stealth/browser-pool.js";
import { initProxyRotator } from "../../src/stealth/proxy.js";
import type {
  ScraperState,
  CareersDiscoveryResult,
  JobExtractionResult,
  ErrorEntry,
} from "./types.js";
import PQueue from "p-queue";
import fs from "fs";
import path from "path";

// ── CLI Args ──────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let excelPath: string | undefined;
  let limit: number | undefined;
  let resume = false;
  let phase: 1 | 2 = 1;
  let concurrency = CONCURRENCY;
  let stats = false;
  const exportFormats: ExportFormat[] = [];

  for (const arg of args) {
    if (arg.startsWith("--limit=")) {
      limit = parseInt(arg.split("=")[1], 10);
    } else if (arg === "--resume") {
      resume = true;
    } else if (arg.startsWith("--phase=")) {
      phase = parseInt(arg.split("=")[1], 10) as 1 | 2;
    } else if (arg.startsWith("--concurrency=")) {
      concurrency = parseInt(arg.split("=")[1], 10);
      if (concurrency < 1) concurrency = 1;
    } else if (arg === "--stats") {
      stats = true;
    } else if (arg === "--export-csv") {
      exportFormats.push("csv");
    } else if (arg === "--export-json") {
      exportFormats.push("json");
    } else if (arg === "--export-xlsx") {
      exportFormats.push("xlsx");
    } else if (arg === "--export-md") {
      exportFormats.push("md");
    } else if (arg === "--export-all") {
      exportFormats.push("csv", "json", "xlsx", "md");
    } else if (!arg.startsWith("--")) {
      excelPath = arg;
    }
  }

  // Only require excelPath for phase 1 scraping (not stats/export)
  if (!stats && exportFormats.length === 0 && phase === 1 && !excelPath) {
    console.error(
      "Usage: npm run scrape:discover -- <excel-path> [--limit=N] [--resume] [--concurrency=N]",
    );
    process.exit(1);
  }

  return { excelPath, limit, resume, phase, concurrency, stats, exportFormats };
}

// ── Progress Display ──────────────────────────────────────────

function progress(state: ScraperState): string {
  const { processed, total, found, errors } = state.stats;
  const pct = total > 0 ? ((processed / total) * 100).toFixed(1) : "0.0";
  return `[${processed}/${total}] ${pct}% | Found: ${found} | Errors: ${errors}`;
}

// ── JSONL Reader ─────────────────────────────────────────────

function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf-8")
    .trim()
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as T);
}

// ── Stats Command ────────────────────────────────────────────

function runStats(): void {
  const careersFile = path.join(OUTPUT_DIR, "careers.jsonl");
  const jobsFile = path.join(OUTPUT_DIR, "jobs.jsonl");
  const errorsFile = path.join(OUTPUT_DIR, "errors.jsonl");

  const careers = readJsonl<CareersDiscoveryResult>(careersFile);
  const jobs = readJsonl<JobExtractionResult>(jobsFile);
  const errors = readJsonl<ErrorEntry>(errorsFile);

  if (careers.length === 0 && jobs.length === 0) {
    console.log("⚠️  No data found. Run a scrape first.");
    return;
  }

  console.log(`\n📊 Job Scraper Stats`);
  console.log(`═══════════════════════════════════════`);

  // ── Phase 1 Stats ──
  if (careers.length > 0) {
    const found = careers.filter((c) => c.careersUrl !== null);
    const notFound = careers.filter((c) => c.careersUrl === null);
    const p1Errors = errors.filter((e) => e.phase === 1);
    const pct = ((found.length / careers.length) * 100).toFixed(1);

    // Strategy breakdown
    const strategyMap = new Map<string, number>();
    for (const c of found) {
      const s = c.strategy ?? "unknown";
      strategyMap.set(s, (strategyMap.get(s) ?? 0) + 1);
    }

    console.log(`\nPhase 1 — Careers Discovery`);
    console.log(`  Total processed:  ${careers.length}`);
    console.log(`  Careers found:    ${found.length} (${pct}%)`);
    console.log(`  Not found:        ${notFound.length}`);
    console.log(`  Errors:           ${p1Errors.length}`);

    if (strategyMap.size > 0) {
      console.log(`  Strategy breakdown:`);
      for (const [strategy, count] of [...strategyMap.entries()].sort((a, b) => b[1] - a[1])) {
        const sPct = ((count / found.length) * 100).toFixed(1);
        console.log(`    ${strategy.padEnd(16)} ${count} (${sPct}%)`);
      }
    }
  }

  // ── Phase 2 Stats ──
  if (jobs.length > 0) {
    const withJobs = jobs.filter((j) => j.jobs.length > 0);
    const totalJobs = jobs.reduce((sum, j) => sum + j.jobs.length, 0);
    const p2Errors = errors.filter((e) => e.phase === 2);
    const pct = jobs.length > 0 ? ((withJobs.length / jobs.length) * 100).toFixed(1) : "0.0";

    // Strategy breakdown
    const strategyMap = new Map<string, number>();
    const platformMap = new Map<string, number>();
    for (const j of withJobs) {
      const s = j.strategy ?? "unknown";
      strategyMap.set(s, (strategyMap.get(s) ?? 0) + 1);
      if (j.platform) {
        platformMap.set(j.platform, (platformMap.get(j.platform) ?? 0) + 1);
      }
    }

    console.log(`\nPhase 2 — Job Extraction`);
    console.log(`  Total processed:  ${jobs.length}`);
    console.log(`  With jobs:        ${withJobs.length} (${pct}%)`);
    console.log(`  Total jobs:       ${totalJobs}`);
    console.log(`  Errors:           ${p2Errors.length}`);

    if (strategyMap.size > 0) {
      console.log(`  Strategy breakdown:`);
      for (const [strategy, count] of [...strategyMap.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`    ${strategy.padEnd(16)} ${count}`);
      }
    }

    if (platformMap.size > 0) {
      console.log(`  Platforms detected:`);
      for (const [platform, count] of [...platformMap.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`    ${platform.padEnd(16)} ${count}`);
      }
    }
  }

  console.log(`═══════════════════════════════════════\n`);
}

// ── Phase 1: Careers Discovery ────────────────────────────────

async function runPhase1(
  excelPath: string,
  limit: number | undefined,
  resume: boolean,
  concurrency: number,
) {
  const companies = readCompanies(excelPath, limit);
  console.log(`\n🔍 Phase 1: Careers URL Discovery`);
  console.log(`   Companies: ${companies.length}`);
  console.log(`   Concurrency: ${concurrency}`);
  console.log(`   Output: ${OUTPUT_DIR}/\n`);

  let state: ScraperState;
  if (resume) {
    const saved = loadState(1);
    if (saved) {
      state = saved;
      state.stats.total = companies.length;
      console.log(`📂 Resuming from ${state.stats.processed} processed\n`);
    } else {
      state = createState(1, companies.length);
    }
  } else {
    state = createState(1, companies.length);
  }

  const queue = new PQueue({
    concurrency,
    interval: DELAY_MS,
    intervalCap: concurrency,
  });

  for (const company of companies) {
    if (isProcessed(state, company.id)) continue;

    queue.add(async () => {
      try {
        const result = await findCareersUrl(company);
        appendCareersResult(result);
        markProcessed(state, company.id, result.careersUrl !== null);

        const status = result.careersUrl ? `✅ ${result.strategy}` : "❌ not found";
        console.log(`${progress(state)} | ${company.name} → ${status}`);
      } catch (err) {
        markError(state);
        markProcessed(state, company.id, false);
        const msg = err instanceof Error ? err.message : String(err);
        appendError({
          companyId: company.id,
          companyName: company.name,
          url: company.url,
          phase: 1,
          error: msg,
          timestamp: new Date().toISOString(),
        });
        console.log(`${progress(state)} | ${company.name} → ⚠️ ${msg.slice(0, 80)}`);
      }

      if (state.stats.processed % STATE_SAVE_INTERVAL === 0) {
        saveState(state);
      }
    });
  }

  await queue.onIdle();
  saveState(state);

  console.log(`\n✨ Phase 1 Complete!`);
  console.log(`   Processed: ${state.stats.processed}`);
  console.log(`   Found: ${state.stats.found}`);
  console.log(`   Errors: ${state.stats.errors}`);
  console.log(
    `   Hit rate: ${state.stats.processed > 0 ? ((state.stats.found / state.stats.processed) * 100).toFixed(1) : 0}%\n`,
  );
}

// ── Phase 2: Job Extraction ───────────────────────────────────

async function runPhase2(resume: boolean, concurrency: number) {
  const allResults = loadCareersResults();
  const withCareers = allResults.filter((r) => r.careersUrl !== null);
  const memory = loadDomainMemory();
  const knownDomains = Object.keys(memory.domains).length;

  console.log(`\n📋 Phase 2: Job Extraction`);
  console.log(`   Companies with careers URLs: ${withCareers.length}`);
  console.log(`   Concurrency: ${concurrency}`);
  if (knownDomains > 0) console.log(`   🧠 Domain memory: ${knownDomains} learned domains`);
  console.log(`   Output: ${OUTPUT_DIR}/\n`);

  let state: ScraperState;
  if (resume) {
    const saved = loadState(2);
    if (saved) {
      state = saved;
      state.stats.total = withCareers.length;
      console.log(`📂 Resuming from ${state.stats.processed} processed\n`);
    } else {
      state = createState(2, withCareers.length);
    }
  } else {
    state = createState(2, withCareers.length);
  }

  const queue = new PQueue({
    concurrency,
    interval: DELAY_MS,
    intervalCap: concurrency,
  });

  for (const entry of withCareers) {
    if (isProcessed(state, entry.companyId)) continue;

    queue.add(async () => {
      try {
        const result = await extractJobs(
          entry.companyId,
          entry.companyName,
          entry.careersUrl!,
          memory,
        );
        appendJobResult(result);
        markProcessed(state, entry.companyId, result.jobs.length > 0);

        const status =
          result.jobs.length > 0
            ? `✅ ${result.jobs.length} jobs (${result.strategy}${result.platform ? "/" + result.platform : ""})`
            : "❌ no jobs";
        console.log(`${progress(state)} | ${entry.companyName} → ${status}`);
      } catch (err) {
        markError(state);
        markProcessed(state, entry.companyId, false);
        const msg = err instanceof Error ? err.message : String(err);
        appendError({
          companyId: entry.companyId,
          companyName: entry.companyName,
          url: entry.careersUrl!,
          phase: 2,
          error: msg,
          timestamp: new Date().toISOString(),
        });
        console.log(`${progress(state)} | ${entry.companyName} → ⚠️ ${msg.slice(0, 80)}`);
      }

      if (state.stats.processed % STATE_SAVE_INTERVAL === 0) {
        saveState(state);
        saveDomainMemory(memory);
      }
    });
  }

  await queue.onIdle();
  saveState(state);
  saveDomainMemory(memory);

  console.log(`\n✨ Phase 2 Complete!`);
  console.log(`   Processed: ${state.stats.processed}`);
  console.log(`   Jobs found: ${state.stats.found} companies with jobs`);
  console.log(`   Errors: ${state.stats.errors}\n`);
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  const { excelPath, limit, resume, phase, concurrency, stats, exportFormats } =
    parseArgs();

  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Stats — quick read-only, no browser/proxy needed
  if (stats) {
    runStats();
    return;
  }

  // Export — quick read-only
  if (exportFormats.length > 0) {
    exportAll(exportFormats);
    return;
  }

  // Initialize proxy rotator if configured
  initProxyRotator();

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\n\n🛑 Shutting down gracefully...");
    try {
      await getPool().closeAll();
    } catch {
      // Ignore — pool may not be initialized
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    if (phase === 1) {
      await runPhase1(excelPath!, limit, resume, concurrency);
    } else {
      await runPhase2(resume, concurrency);
    }
  } finally {
    try {
      await getPool().closeAll();
    } catch {
      // Ignore
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
