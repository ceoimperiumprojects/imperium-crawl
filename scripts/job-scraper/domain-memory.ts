import fs from "fs";
import path from "path";
import { OUTPUT_DIR } from "./config.js";

// ── Types ──────────────────────────────────────────────────────

export interface DomainEntry {
  strategy: "json-ld" | "platform-css" | "generic-markdown";
  platform?: string;
  embedUrl?: string;
  jobCount: number;
  lastSuccess: string; // ISO timestamp
}

export interface DomainMemory {
  version: 1;
  domains: Record<string, DomainEntry>;
}

// ── File Path ──────────────────────────────────────────────────

const MEMORY_PATH = path.join(OUTPUT_DIR, "domain-memory.json");

// ── API ────────────────────────────────────────────────────────

export function loadDomainMemory(): DomainMemory {
  if (!fs.existsSync(MEMORY_PATH)) {
    return { version: 1, domains: {} };
  }
  try {
    const raw = fs.readFileSync(MEMORY_PATH, "utf-8");
    return JSON.parse(raw) as DomainMemory;
  } catch {
    return { version: 1, domains: {} };
  }
}

export function saveDomainMemory(memory: DomainMemory): void {
  fs.mkdirSync(path.dirname(MEMORY_PATH), { recursive: true });
  fs.writeFileSync(MEMORY_PATH, JSON.stringify(memory, null, 2) + "\n");
}

function getHostname(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function getDomainHint(memory: DomainMemory, url: string): DomainEntry | null {
  const hostname = getHostname(url);
  if (!hostname) return null;
  return memory.domains[hostname] ?? null;
}

export function recordSuccess(
  memory: DomainMemory,
  url: string,
  entry: Omit<DomainEntry, "lastSuccess">,
): void {
  const hostname = getHostname(url);
  if (!hostname) return;
  memory.domains[hostname] = {
    ...entry,
    lastSuccess: new Date().toISOString(),
  };
}
