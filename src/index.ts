#!/usr/bin/env node

import "dotenv/config";
import { applyCliConfig } from "./cli-config.js";
import { initProxyRotator } from "./stealth/proxy.js";
import { getPool } from "./stealth/browser-pool.js";

// ── Graceful Shutdown ──
function setupShutdownHandlers(): void {
  const shutdown = async () => {
    try {
      await Promise.race([
        (async () => {
          const { getKnowledgeEngine } = await import("./knowledge/index.js");
          await getKnowledgeEngine().flush();
          await getPool().closeAll();
        })(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Shutdown timeout")), 10_000),
        ),
      ]);
    } catch {
      // timeout or error — force exit
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function main() {
  applyCliConfig(); // load ~/.imperium-crawl/config.json → process.env (system env takes priority)
  initProxyRotator();
  setupShutdownHandlers();

  const hasSubcommand = !!process.argv[2];

  if (hasSubcommand) {
    const { runCli } = await import("./cli.js");
    await runCli();
  } else if (process.stdout.isTTY) {
    // TTY + no args → interactive TUI
    const { runTui } = await import("./cli-tui.js");
    await runTui();
  } else {
    // Non-TTY + no args → show help
    const { runCli } = await import("./cli.js");
    process.argv.push("--help");
    await runCli();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
