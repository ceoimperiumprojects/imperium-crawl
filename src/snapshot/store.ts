/**
 * SnapshotStore — In-memory ref storage with LRU eviction.
 *
 * Stores RefMaps keyed by session_id (or auto-generated snapshot IDs).
 * Refs are ephemeral — they exist only in memory and are invalidated
 * when a new snapshot is taken for the same session.
 */

import type { RefMap, RefEntry } from "./types.js";
import { MAX_STORED_SNAPSHOTS } from "../constants.js";

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
