/**
 * Browser State persistence — stores CDP endpoint + PID between CLI invocations.
 *
 * Each named session gets its own directory under ~/.imperium-crawl/sessions/{name}/
 * with browser.json holding the CDP connection info and Chrome PID.
 *
 * This enables persistent browser sessions: Chrome lives independently of Node.js,
 * and each CLI call reconnects via CDP (connectOverCDP).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { getSessionsDir } from "../config.js";

export interface BrowserState {
  /** CDP WebSocket endpoint, e.g. "http://127.0.0.1:9222" */
  endpoint: string;
  /** Chrome process ID */
  pid: number;
  /** ISO timestamp when browser was started */
  startedAt: string;
  /** Whether browser was launched with headed mode */
  headed: boolean;
  /** CDP port used */
  port: number;
}

function browserDir(session: string): string {
  const safe = session.replace(/[^a-zA-Z0-9_\-]/g, "_");
  return path.join(getSessionsDir(), safe);
}

function browserStatePath(session: string): string {
  return path.join(browserDir(session), "browser.json");
}

export async function saveBrowserState(session: string, state: BrowserState): Promise<void> {
  const dir = browserDir(session);
  await fs.mkdir(dir, { recursive: true });
  const filePath = browserStatePath(session);
  const tmpPath = `${filePath}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(state, null, 2), "utf-8");
  try {
    await fs.rename(tmpPath, filePath);
  } catch {
    await fs.unlink(tmpPath).catch(() => {});
    throw new Error(`Failed to save browser state for session "${session}"`);
  }
}

export async function loadBrowserState(session: string): Promise<BrowserState | null> {
  try {
    const data = await fs.readFile(browserStatePath(session), "utf-8");
    return JSON.parse(data) as BrowserState;
  } catch {
    return null;
  }
}

export async function clearBrowserState(session: string): Promise<void> {
  try {
    await fs.unlink(browserStatePath(session));
  } catch {
    // Already gone — fine
  }
}

/**
 * Check if the Chrome process for a session is still alive.
 * Sends signal 0 (no-op) to test if PID exists.
 */
export async function isBrowserAlive(session: string): Promise<boolean> {
  const state = await loadBrowserState(session);
  if (!state) return false;
  try {
    process.kill(state.pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the directory path for a session's persistent data.
 * Used by snapshot refs disk persistence.
 */
export function getSessionDir(session: string): string {
  return browserDir(session);
}
