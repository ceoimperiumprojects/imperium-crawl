import fs from "fs";
import path from "path";
import XLSX from "xlsx";
import type {
  CareersDiscoveryResult,
  JobExtractionResult,
} from "./types.js";
import { OUTPUT_DIR } from "./config.js";

const CAREERS_JSONL = path.join(OUTPUT_DIR, "careers.jsonl");
const JOBS_JSONL = path.join(OUTPUT_DIR, "jobs.jsonl");

// ── Helpers ──────────────────────────────────────────────────

function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf-8")
    .trim()
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as T);
}

interface FlatCareer {
  company_name: string;
  company_url: string;
  careers_url: string;
  strategy: string;
  timestamp: string;
}

interface FlatJob {
  company_name: string;
  careers_url: string;
  job_title: string;
  location: string;
  department: string;
  job_url: string;
  strategy: string;
  platform: string;
}

function flattenCareers(careers: CareersDiscoveryResult[]): FlatCareer[] {
  return careers.map((c) => ({
    company_name: c.companyName,
    company_url: c.companyUrl,
    careers_url: c.careersUrl ?? "",
    strategy: c.strategy ?? "",
    timestamp: c.timestamp,
  }));
}

function flattenJobs(jobResults: JobExtractionResult[]): FlatJob[] {
  const rows: FlatJob[] = [];
  const seen = new Set<string>();
  for (const r of jobResults) {
    for (const job of r.jobs) {
      // Cross-company dedup safety net (guards against JSONL append-only duplicates)
      const key = [
        r.companyName.toLowerCase().trim(),
        job.title.toLowerCase().replace(/\s+/g, " ").trim(),
        (job.location ?? "").toLowerCase().replace(/\s+/g, " ").trim(),
      ].join("|||");
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        company_name: r.companyName,
        careers_url: r.careersUrl,
        job_title: job.title,
        location: job.location ?? "",
        department: job.department ?? "",
        job_url: job.url ?? "",
        strategy: r.strategy ?? "",
        platform: r.platform ?? "",
      });
    }
  }
  return rows;
}

function loadData() {
  const careers = readJsonl<CareersDiscoveryResult>(CAREERS_JSONL);
  const jobResults = readJsonl<JobExtractionResult>(JOBS_JSONL);
  return { careers, jobResults };
}

// ── RFC 4180 CSV ─────────────────────────────────────────────

function escapeCsv(value: string | undefined | null): string {
  if (value == null) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsvString(rows: Record<string, string>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.map(escapeCsv).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsv(row[h])).join(","));
  }
  return lines.join("\n") + "\n";
}

// ── Markdown ─────────────────────────────────────────────────

function escapeMd(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function toMarkdownTable(rows: Record<string, string>[]): string {
  if (rows.length === 0) return "_No data_\n";
  const headers = Object.keys(rows[0]);
  const lines: string[] = [];
  lines.push("| " + headers.map(escapeMd).join(" | ") + " |");
  lines.push("| " + headers.map(() => "---").join(" | ") + " |");
  for (const row of rows) {
    lines.push("| " + headers.map((h) => escapeMd(row[h] ?? "")).join(" | ") + " |");
  }
  return lines.join("\n") + "\n";
}

// ── Export Functions ──────────────────────────────────────────

export function exportCsv(): void {
  const { careers, jobResults } = loadData();

  if (careers.length === 0) {
    console.log("⚠️  No careers data found. Run Phase 1 first.");
    return;
  }

  const careersPath = path.join(OUTPUT_DIR, "careers.csv");
  fs.writeFileSync(careersPath, toCsvString(flattenCareers(careers) as any));
  console.log(`✅ ${careersPath} — ${careers.length} rows`);

  if (jobResults.length === 0) {
    console.log("⚠️  No jobs data found. Run Phase 2 first.");
    return;
  }

  const flatJobs = flattenJobs(jobResults);
  const jobsPath = path.join(OUTPUT_DIR, "jobs.csv");
  fs.writeFileSync(jobsPath, toCsvString(flatJobs as any));
  console.log(`✅ ${jobsPath} — ${flatJobs.length} rows`);
}

export function exportJson(): void {
  const { careers, jobResults } = loadData();

  if (careers.length === 0) {
    console.log("⚠️  No careers data found. Run Phase 1 first.");
    return;
  }

  const careersPath = path.join(OUTPUT_DIR, "careers.json");
  fs.writeFileSync(careersPath, JSON.stringify(flattenCareers(careers), null, 2) + "\n");
  console.log(`✅ ${careersPath} — ${careers.length} entries`);

  if (jobResults.length === 0) {
    console.log("⚠️  No jobs data found. Run Phase 2 first.");
    return;
  }

  const flatJobs = flattenJobs(jobResults);
  const jobsPath = path.join(OUTPUT_DIR, "jobs.json");
  fs.writeFileSync(jobsPath, JSON.stringify(flatJobs, null, 2) + "\n");
  console.log(`✅ ${jobsPath} — ${flatJobs.length} entries`);
}

export function exportXlsx(): void {
  const { careers, jobResults } = loadData();

  if (careers.length === 0) {
    console.log("⚠️  No careers data found. Run Phase 1 first.");
    return;
  }

  const wb = XLSX.utils.book_new();

  const careersSheet = XLSX.utils.json_to_sheet(flattenCareers(careers));
  XLSX.utils.book_append_sheet(wb, careersSheet, "Careers");

  if (jobResults.length > 0) {
    const jobsSheet = XLSX.utils.json_to_sheet(flattenJobs(jobResults));
    XLSX.utils.book_append_sheet(wb, jobsSheet, "Jobs");
  }

  const xlsxPath = path.join(OUTPUT_DIR, "scraper-results.xlsx");
  XLSX.writeFile(wb, xlsxPath);
  const jobCount = jobResults.reduce((sum, r) => sum + r.jobs.length, 0);
  console.log(`✅ ${xlsxPath} — ${careers.length} careers, ${jobCount} jobs`);
}

export function exportMarkdown(): void {
  const { careers, jobResults } = loadData();

  if (careers.length === 0) {
    console.log("⚠️  No careers data found. Run Phase 1 first.");
    return;
  }

  const parts: string[] = [];
  parts.push("# Job Scraper Results\n");
  parts.push("## Careers Discovery\n");
  parts.push(toMarkdownTable(flattenCareers(careers) as any));

  if (jobResults.length > 0) {
    parts.push("\n## Job Listings\n");
    parts.push(toMarkdownTable(flattenJobs(jobResults) as any));
  }

  const mdPath = path.join(OUTPUT_DIR, "results.md");
  fs.writeFileSync(mdPath, parts.join("\n") + "\n");
  const jobCount = jobResults.reduce((sum, r) => sum + r.jobs.length, 0);
  console.log(`✅ ${mdPath} — ${careers.length} careers, ${jobCount} jobs`);
}

export type ExportFormat = "csv" | "json" | "xlsx" | "md";

export function exportAll(formats: ExportFormat[]): void {
  for (const fmt of formats) {
    switch (fmt) {
      case "csv": exportCsv(); break;
      case "json": exportJson(); break;
      case "xlsx": exportXlsx(); break;
      case "md": exportMarkdown(); break;
    }
  }
}
