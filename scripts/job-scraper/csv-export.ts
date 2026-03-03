import fs from "fs";
import path from "path";
import type {
  CareersDiscoveryResult,
  JobExtractionResult,
} from "./types.js";
import { OUTPUT_DIR } from "./config.js";

const CAREERS_JSONL = path.join(OUTPUT_DIR, "careers.jsonl");
const JOBS_JSONL = path.join(OUTPUT_DIR, "jobs.jsonl");
const CAREERS_CSV = path.join(OUTPUT_DIR, "careers.csv");
const JOBS_CSV = path.join(OUTPUT_DIR, "jobs.csv");

// RFC 4180 CSV escaping
function escapeCsv(value: string | undefined | null): string {
  if (value == null) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function row(...fields: (string | undefined | null)[]): string {
  return fields.map(escapeCsv).join(",");
}

function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf-8")
    .trim()
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as T);
}

export function exportCsv(): void {
  // ── Careers CSV ──
  const careers = readJsonl<CareersDiscoveryResult>(CAREERS_JSONL);
  if (careers.length === 0) {
    console.log("⚠️  No careers data found. Run Phase 1 first.");
    return;
  }

  const careersLines = [
    row("company_name", "company_url", "careers_url", "strategy", "timestamp"),
  ];
  for (const c of careers) {
    careersLines.push(
      row(c.companyName, c.companyUrl, c.careersUrl, c.strategy, c.timestamp),
    );
  }
  fs.writeFileSync(CAREERS_CSV, careersLines.join("\n") + "\n");
  console.log(`✅ ${CAREERS_CSV} — ${careers.length} rows`);

  // ── Jobs CSV ──
  const jobResults = readJsonl<JobExtractionResult>(JOBS_JSONL);
  if (jobResults.length === 0) {
    console.log("⚠️  No jobs data found. Run Phase 2 first.");
    return;
  }

  const jobLines = [
    row(
      "company_name",
      "careers_url",
      "job_title",
      "location",
      "department",
      "job_url",
      "strategy",
      "platform",
    ),
  ];
  for (const r of jobResults) {
    for (const job of r.jobs) {
      jobLines.push(
        row(
          r.companyName,
          r.careersUrl,
          job.title,
          job.location,
          job.department,
          job.url,
          r.strategy,
          r.platform,
        ),
      );
    }
  }
  fs.writeFileSync(JOBS_CSV, jobLines.join("\n") + "\n");
  const totalJobs = jobResults.reduce((sum, r) => sum + r.jobs.length, 0);
  console.log(`✅ ${JOBS_CSV} — ${totalJobs} rows`);
}
