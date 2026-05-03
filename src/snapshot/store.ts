/**
 * SnapshotStore — In-memory ref storage with LRU eviction.
 *
 * Stores RefMaps keyed by session_id (or auto-generated snapshot IDs).
 * Refs are ephemeral — they exist only in memory and are invalidated
 * when a new snapshot is taken for the same session.
 */

import type { RefMap, RefEntry } from "./types.js";
import { MAX_STORED_SNAPSHOTS } from "../core/constants.js";
import { writeFileSync, readFileSync, unlinkSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

interface StoredSnapshot {
  refs: RefMap;
  timestamp: number;
  url: string;
}

class SnapshotStore {
  private store = new Map<string, StoredSnapshot>();

  /** Save a snapshot's refs, evicting oldest if at capacity */
  save(id: string, refs: RefMap, url: string): void {
    // Evict oldest if at capacity (LRU)
    if (this.store.size >= MAX_STORED_SNAPSHOTS && !this.store.has(id)) {
      let oldestKey: string | undefined;
      let oldestTime = Infinity;
      for (const [key, val] of this.store) {
        if (val.timestamp < oldestTime) {
          oldestTime = val.timestamp;
          oldestKey = key;
        }
      }
      if (oldestKey) this.store.delete(oldestKey);
    }

    this.store.set(id, { refs, timestamp: Date.now(), url });
  }

  /** Resolve a ref string (e.g. "e5" or "@e5") to its locator info */
  resolveRef(id: string, refString: string): RefEntry | null {
    const snapshot = this.store.get(id);
    if (!snapshot) return null;

    // Strip leading @ if present
    const ref = refString.startsWith("@") ? refString.slice(1) : refString;
    return snapshot.refs[ref] ?? null;
  }

  /** Get all refs for a snapshot */
  getRefs(id: string): RefMap | null {
    return this.store.get(id)?.refs ?? null;
  }

  /** Invalidate a specific snapshot */
  invalidate(id: string): void {
    this.store.delete(id);
  }

  /** Clear all stored snapshots */
  clear(): void {
    this.store.clear();
  }

  /** Number of stored snapshots */
  get size(): number {
    return this.store.size;
  }

  /** Restore timestamp when loading from disk */
  setTimestamp(id: string, timestamp: number): void {
    const entry = this.store.get(id);
    if (entry) entry.timestamp = timestamp;
  }
}

// ── Singleton ──

let instance: SnapshotStore | null = null;

export function getSnapshotStore(): SnapshotStore {
  if (!instance) instance = new SnapshotStore();
  return instance;
}

/** Reset singleton (for testing) */
export function resetSnapshotStore(): void {
  instance = null;
}

// ── Disk Persistence ──

const SNAPSHOT_DIR = join(dirname(fileURLToPath(import.meta.url)), ".snapshots");

function ensureSnapshotDir(): void {
  if (!existsSync(SNAPSHOT_DIR)) {
    mkdirSync(SNAPSHOT_DIR, { recursive: true });
  }
}

function snapshotPath(id: string): string {
  return join(SNAPSHOT_DIR, `${id}.json`);
}

/** Persist a snapshot's refs to disk */
export async function saveSnapshotToDisk(id: string, refs: RefMap, url: string): Promise<void> {
  ensureSnapshotDir();
  const data = JSON.stringify({ refs, url, timestamp: Date.now() });
  writeFileSync(snapshotPath(id), data, "utf-8");
}

/** Load a snapshot's refs from disk into the in-memory store */
export async function loadSnapshotFromDisk(id: string): Promise<void> {
  const path = snapshotPath(id);
  if (!existsSync(path)) return;
  try {
    const raw = readFileSync(path, "utf-8");
    const { refs, url, timestamp } = JSON.parse(raw) as { refs: RefMap; url: string; timestamp: number };
    const store = getSnapshotStore();
    store.save(id, refs, url);
    store.setTimestamp(id, timestamp);
  } catch {
    // Corrupt file — ignore
  }
}

/** Delete a snapshot from disk */
export async function clearSnapshotFromDisk(id: string): Promise<void> {
  const path = snapshotPath(id);
  if (existsSync(path)) {
    unlinkSync(path);
  }
}
