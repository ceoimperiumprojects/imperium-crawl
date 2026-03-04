/**
 * Config file management for imperium-crawl CLI.
 *
 * Saves API keys to ~/.imperium-crawl/config.json so users don't
 * need to set environment variables manually.
 *
 * Priority: process.env (system) > config.json
 * applyCliConfig() fills in env vars from config only if not already set.
 */

import path from "node:path";
import os from "node:os";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { SKILLS_DIR_NAME } from "./constants.js";

const CONFIG_FILENAME = "config.json";

export function getCliConfigPath(): string {
  return path.join(os.homedir(), SKILLS_DIR_NAME, CONFIG_FILENAME);
}

export function loadCliConfig(): Record<string, string> {
  try {
    const content = readFileSync(getCliConfigPath(), "utf-8");
    const parsed: unknown = JSON.parse(content);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    // File doesn't exist or invalid JSON — return empty config
  }
  return {};
}

export function saveCliConfig(config: Record<string, string>): void {
  const configPath = getCliConfigPath();
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

/**
 * Apply config.json values to process.env.
 * System env vars take priority — config values are only applied
 * when the key is not already set.
 *
 * Call this once at startup, before any tool initialization.
 */
export function applyCliConfig(): void {
  const config = loadCliConfig();
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === "string" && !process.env[key]) {
      process.env[key] = value;
    }
  }
}
