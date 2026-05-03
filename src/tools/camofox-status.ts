/**
 * camofox-status — check CamoFox installation and server health.
 */

import { z } from "zod";
import {
  isCamofoxAvailable,
  getCamofoxVersion,
  getCamofoxLatestVersion,
} from "../engines/camofox.js";

export const name = "camofox_status";

export const description =
  "Check CamoFox browser engine status — installation, version, server health, and whether a newer version is available.";

export const schema = z.object({});

export async function execute(): Promise<{
  content: Array<{ type: string; text: string }>;
}> {
  const results: Record<string, unknown> = {};

  // Installation
  const installed = await isCamofoxAvailable();
  results.installed = installed;

  // Versions
  const currentVersion = await getCamofoxVersion();
  results.current_version = currentVersion;

  let latestVersion: string | null = null;
  try {
    latestVersion = await getCamofoxLatestVersion();
  } catch {
    // network error — skip
  }
  results.latest_version = latestVersion;

  // Update available?
  if (currentVersion && latestVersion && currentVersion !== latestVersion) {
    results.update_available = true;
    results.update_message = `New version available: ${latestVersion} (current: ${currentVersion}). Run: imperiumcrawl camofox-update`;
  } else if (currentVersion && latestVersion) {
    results.update_available = false;
    results.update_message = `Up to date (${currentVersion})`;
  } else if (!latestVersion) {
    results.update_available = null;
    results.update_message = "Could not check latest version (network issue?)";
  }

  // Server health
  let serverRunning = false;
  try {
    const res = await fetch("http://127.0.0.1:9377/health", { signal: AbortSignal.timeout(3000) });
    serverRunning = res.ok;
  } catch {
    // not running
  }
  results.server_running = serverRunning;

  // Quick start guide
  if (!installed) {
    results.setup_guide =
      "Run: npm install @askjo/camofox-browser --save-optional\nThen: imperiumcrawl camofox-update";
  } else if (!serverRunning) {
    results.setup_guide =
      "Server not running. It will auto-start on first use, or run: npx @askjo/camofox-browser";
  }

  return {
    content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
  };
}
