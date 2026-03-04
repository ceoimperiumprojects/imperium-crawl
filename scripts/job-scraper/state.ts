import fs from "fs";
import path from "path";
import type { ScraperState } from "./types.js";
import { OUTPUT_DIR } from "./config.js";

const STATE_FILE = path.join(OUTPUT_DIR, "state.json");

// Runtime Set for O(1) lookups — serialized as array in JSON
let processedSet = new Set<string>();

export function createState(phase: 1 | 2, total: number): ScraperState {
  processedSet = new Set();
  return {
    phase,
    processedIds: [],
    stats: { total, processed: 0, found: 0, errors: 0 },
    startedAt: new Date().toISOString(),
    lastSavedAt: new Date().toISOString(),
  };
}

export function loadState(phase: 1 | 2): ScraperState | null {
  if (!fs.existsSync(STATE_FILE)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")) as ScraperState;
    if (raw.phase !== phase) return null;
    processedSet = new Set(raw.processedIds);
    return raw;
  } catch {
    return null;
  }
}

export function saveState(state: ScraperState): void {
  state.lastSavedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function markProcessed(
  state: ScraperState,
  id: string,
  found: boolean,
): void {
  processedSet.add(id);
  state.processedIds.push(id);
  state.stats.processed++;
  if (found) state.stats.found++;
}

export function markError(state: ScraperState): void {
  state.stats.errors++;
}

export function isProcessed(_state: ScraperState, id: string): boolean {
  return processedSet.has(id);
}
