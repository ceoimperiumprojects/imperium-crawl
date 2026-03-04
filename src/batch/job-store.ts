import fs from "node:fs/promises";
import path from "node:path";
import { getJobsDir } from "../config.js";
import type { BatchJob } from "./types.js";

export class JobStore {
  private cache = new Map<string, BatchJob>();
  private dir: string;

  constructor(dir?: string) {
    this.dir = dir ?? getJobsDir();
  }

  private jobPath(id: string): string {
    // Sanitize id to prevent path traversal
    const safe = id.replace(/[^a-zA-Z0-9_\-]/g, "_");
    return path.join(this.dir, `${safe}.json`);
  }

  async save(job: BatchJob): Promise<void> {
    const updated: BatchJob = { ...job, updated_at: new Date().toISOString() };
    this.cache.set(job.id, updated);

    await fs.mkdir(this.dir, { recursive: true });
    const filePath = this.jobPath(job.id);
    const tmpPath = filePath + ".tmp";
    await fs.writeFile(tmpPath, JSON.stringify(updated, null, 2), "utf-8");
    await fs.rename(tmpPath, filePath);
  }

  async load(id: string): Promise<BatchJob | null> {
    if (this.cache.has(id)) return this.cache.get(id)!;

    try {
      const data = await fs.readFile(this.jobPath(id), "utf-8");
      const job = JSON.parse(data) as BatchJob;
      this.cache.set(id, job);
      return job;
    } catch (err: unknown) {
      const isEnoent =
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err as NodeJS.ErrnoException).code === "ENOENT";
      if (!isEnoent) {
        console.error(
          "[batch] Failed to load job:",
          err instanceof Error ? err.message : String(err),
        );
      }
      return null;
    }
  }

  async delete(id: string): Promise<void> {
    this.cache.delete(id);
    try {
      await fs.unlink(this.jobPath(id));
    } catch {
      // Job didn't exist on disk — fine
    }
  }

  async list(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.dir);
      return files
        .filter((f) => f.endsWith(".json") && !f.endsWith(".tmp.json"))
        .map((f) => f.replace(/\.json$/, ""));
    } catch {
      return [];
    }
  }
}

// ── Singleton ──

let store: JobStore | null = null;

export function getJobStore(): JobStore {
  if (!store) {
    store = new JobStore();
  }
  return store;
}

/** Reset singleton (for testing) */
export function resetJobStore(): void {
  store = null;
}
