/**
 * camofox-update — update CamoFox to the latest version.
 *
 * Checks npm registry for the latest @askjo/camofox-browser version,
 * compares with installed version, and runs npm update if newer.
 */

import { z } from "zod";
import { spawn } from "node:child_process";
import {
  isCamofoxAvailable,
  getCamofoxVersion,
  getCamofoxLatestVersion,
  camofoxEngine,
} from "../engines/camofox.js";

export const name = "camofox_update";

export const description =
  "Update CamoFox browser engine to the latest version. Checks npm registry, compares versions, and runs npm update if a newer release is available.";

export const schema = z.object({
  check: z
    .boolean()
    .optional()
    .describe("Only check for updates, don't install"),
  force: z
    .boolean()
    .optional()
    .describe("Force reinstall even if up to date"),
});

export async function execute(input: {
  check?: boolean;
  force?: boolean;
}): Promise<{
  content: Array<{ type: string; text: string }>;
}> {
  const results: Record<string, unknown> = {};
  const checkOnly = input.check ?? false;
  const force = input.force ?? false;

  // Get versions
  const currentVersion = await getCamofoxVersion();
  results.current_version = currentVersion ?? "not installed";

  let latestVersion: string | null = null;
  try {
    latestVersion = await getCamofoxLatestVersion();
  } catch {
    results.error = "Could not reach npm registry to check latest version.";
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  }
  results.latest_version = latestVersion;

  if (!latestVersion) {
    results.error = "Could not determine latest version.";
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  }

  // Check if update needed
  const needsUpdate = force || !currentVersion || currentVersion !== latestVersion;

  if (!needsUpdate) {
    results.status = "up_to_date";
    results.message = `CamoFox is up to date (${currentVersion})`;
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  }

  results.status = "update_available";
  results.message = `Update available: ${currentVersion ?? "none"} → ${latestVersion}`;

  if (checkOnly) {
    results.hint = "Run without --check to install the update.";
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  }

  // Perform update
  // Shut down server if running
  try {
    await camofoxEngine.shutdown();
  } catch {
    // not running — ok
  }

  results.installing = true;

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("npm", ["install", "@askjo/camofox-browser@latest", "--save-optional"], {
        stdio: "pipe",
        cwd: process.cwd(),
      });

      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
      child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`npm install exited with code ${code}: ${stderr.slice(-200)}`));
      });
    });

    const newVersion = await getCamofoxVersion();
    results.installed_version = newVersion;
    results.success = true;
    results.message = `CamoFox updated to ${newVersion}`;
    results.changelog = `https://github.com/jo-inc/camofox-browser/releases/tag/v${newVersion}`;
  } catch (err) {
    results.error = `Update failed: ${err instanceof Error ? err.message : String(err)}`;
    results.success = false;

    // Try to restart server
    try { await camofoxEngine.launch(); } catch { /* best effort */ }
  }

  return {
    content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
  };
}
