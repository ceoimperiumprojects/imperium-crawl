import fs from "node:fs/promises";
import path from "node:path";
import { getSessionsDir } from "../config.js";
import type { StoredSession, StoredCookie } from "./types.js";
import { encryptData, decryptData, isEncryptedPayload, ensureEncryptionKey } from "./encryption.js";

export class SessionManager {
  private cache = new Map<string, StoredSession>();
  private dir: string;
  private encryptionKey: string | undefined;
  private keyLoaded = false;

  constructor(dir?: string) {
    this.dir = dir ?? getSessionsDir();
  }

  private async getEncryptionKey(): Promise<string | undefined> {
    if (!this.keyLoaded) {
      this.encryptionKey = await ensureEncryptionKey();
      this.keyLoaded = true;
    }
    return this.encryptionKey;
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
      actionCount: existing?.actionCount,
      updatedAt: now,
    };

    this.cache.set(id, session);

    await fs.mkdir(this.dir, { recursive: true });
    const filePath = this.sessionPath(id);
    const tmpPath = filePath + ".tmp";

    const key = await this.getEncryptionKey();
    const content = key
      ? JSON.stringify(encryptData(JSON.stringify(session), key), null, 2)
      : JSON.stringify(session, null, 2);

    await fs.writeFile(tmpPath, content, "utf-8");
    await fs.rename(tmpPath, filePath);
  }

  async load(id: string): Promise<StoredSession | null> {
    if (this.cache.has(id)) return this.cache.get(id)!;

    try {
      const data = await fs.readFile(this.sessionPath(id), "utf-8");
      const parsed = JSON.parse(data);

      let session: StoredSession;
      if (isEncryptedPayload(parsed)) {
        const key = await this.getEncryptionKey();
        if (!key) {
          console.error("[sessions] Encrypted session found but no encryption key configured");
          return null;
        }
        session = JSON.parse(decryptData(parsed, key)) as StoredSession;
      } else {
        session = parsed as StoredSession;
      }

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

  /**
   * Check if a session exists and has at least one non-expired cookie.
   */
  async isLoggedIn(id: string): Promise<boolean> {
    const session = await this.load(id);
    if (!session || !session.cookies.length) return false;

    const now = Date.now() / 1000; // cookies use epoch seconds
    return session.cookies.some(
      (c) => c.expires === undefined || c.expires === -1 || c.expires === 0 || c.expires > now,
    );
  }

  /**
   * Increment the action counter for a session.
   * Call after each browser action to track session staleness.
   */
  async incrementActions(id: string): Promise<void> {
    const session = await this.load(id);
    if (!session) return;
    const updated: StoredSession = {
      ...session,
      actionCount: (session.actionCount ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    this.cache.set(id, updated);
    // Persist async — best effort, don't block action flow
    this.save(id, updated.cookies, updated.url).catch(() => {});
  }

  /**
   * Returns true if the session has exceeded the max actions threshold.
   * Use before executing actions to decide whether to refresh first.
   */
  async needsRefresh(id: string, maxActions: number): Promise<boolean> {
    const session = await this.load(id);
    if (!session) return false;
    return (session.actionCount ?? 0) >= maxActions;
  }

  /**
   * Reset the action counter for a session (call after page refresh).
   */
  async resetActionCount(id: string): Promise<void> {
    const session = await this.load(id);
    if (!session) return;
    const updated: StoredSession = {
      ...session,
      actionCount: 0,
      updatedAt: new Date().toISOString(),
    };
    this.cache.set(id, updated);
    this.save(id, updated.cookies, updated.url).catch(() => {});
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

/** Check if a session has valid (non-expired) cookies */
export async function isSessionValid(sessionId: string): Promise<boolean> {
  return getSessionManager().isLoggedIn(sessionId);
}

/** Reset singleton (for testing) */
export function resetSessionManager(): void {
  manager = null;
}
