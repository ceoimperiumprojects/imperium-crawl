import fs from "fs";
import path from "path";
import type {
  CareersDiscoveryResult,
  JobExtractionResult,
  ErrorEntry,
} from "./types.js";
import { OUTPUT_DIR } from "./config.js";

const CAREERS_FILE = path.join(OUTPUT_DIR, "careers.jsonl");
const JOBS_FILE = path.join(OUTPUT_DIR, "jobs.jsonl");
const ERRORS_FILE = path.join(OUTPUT_DIR, "errors.jsonl");

function ensureDir() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function appendLine(file: string, data: unknown): void {
  ensureDir();
  fs.appendFileSync(file, JSON.stringify(data) + "\n");
}

export function appendCareersResult(result: CareersDiscoveryResult): void {
  appendLine(CAREERS_FILE, result);
}

export function appendJobResult(result: JobExtractionResult): void {
  appendLine(JOBS_FILE, result);
}

export function appendError(entry: ErrorEntry): void {
  appendLine(ERRORS_FILE, entry);
}

// Load all careers results for Phase 2 input
export function loadCareersResults(): CareersDiscoveryResult[] {
  if (!fs.existsSync(CAREERS_FILE)) return [];
  const lines = fs.readFileSync(CAREERS_FILE, "utf-8").trim().split("\n");
  return lines
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as CareersDiscoveryResult);
}
