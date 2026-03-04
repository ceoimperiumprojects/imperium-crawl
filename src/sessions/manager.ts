import fs from "node:fs/promises";
import path from "node:path";
import { getSessionsDir } from "../config.js";
import type { StoredSession, StoredCookie } from "./types.js";

export class SessionManager {
  private cache = new Map<string, StoredSession>();
  private dir: string;

  constructor(dir?: string) {
    this.dir = dir ?? getSessionsDir();
  }

  private sessionPath(id: string): string {
    // Sanitize id to prevent path traversal
    const safe = id.replace(/[^a-zA-Z0-9_\-]/g, "_");
    return path.join(this.dir, `${safe}.json`);
  }

  async save(id: string, cookies: StoredCookie[], url: string): Promise<void> {
    const now = new Date().toISOString();
    const existing = this.cache.get(id);

    const session: StoredSession = {
      id,
      cookies,
      url,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.cache.set(id, session);

    await fs.mkdir(this.dir, { recursive: true });
    const filePath = this.sessionPath(id);
    const tmpPath = filePath + ".tmp";
    await fs.writeFile(tmpPath, JSON.stringify(session, null, 2), "utf-8");
    await fs.rename(tmpPath, filePath);
  }

  async load(id: string): Promise<StoredSession | null> {
    if (this.cache.has(id)) return this.cache.get(id)!;

    try {
      const data = await fs.readFile(this.sessionPath(id), "utf-8");
      const session = JSON.parse(data) as StoredSession;
      this.cache.set(id, session);
      return session;
    } catch (err: unknown) {
      const isEnoent =
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err as NodeJS.ErrnoException).code === "ENOENT";
      if (!isEnoent) {
        console.error(
          "[sessions] Failed to load session:",
          err instanceof Error ? err.message : String(err),
        );
      }
      return null;
    }
  }

  async delete(id: string): Promise<void> {
    this.cache.delete(id);
    try {
      await fs.unlink(this.sessionPath(id));
    } catch {
      // Session didn't exist on disk — fine
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

let manager: SessionManager | null = null;

export function getSessionManager(): SessionManager {
  if (!manager) {
    manager = new SessionManager();
  }
  return manager;
}

/** Reset singleton (for testing) */
export function resetSessionManager(): void {
  manager = null;
}
