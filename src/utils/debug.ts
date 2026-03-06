const DEBUG = process.env.DEBUG === "1" || process.env.VERBOSE === "1";

export function debugLog(tool: string, msg: string, err?: unknown): void {
  if (DEBUG) console.error(`[${tool}] ${msg}`, err instanceof Error ? err.message : "");
}
