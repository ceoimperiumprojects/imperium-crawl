#!/usr/bin/env node

import "dotenv/config";
import { applyCliConfig } from "./cli-config.js";
import { initProxyRotator } from "./stealth/proxy.js";
import { getPool } from "./stealth/browser-pool.js";

/**
 * Route: CLI mode vs MCP server mode.
 *
 * CLI mode activates when argv[2] is a known subcommand or --help/--version.
 * Otherwise (no args, or --transport), start as MCP server.
 */
function shouldRunCli(): boolean {
  const arg = process.argv[2];
  if (!arg) return false;
  if (arg === "--transport") return false;
  // --help, --version, -h, -V, or any tool subcommand
  return true;
}

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
  // Init proxy rotator from env vars (both modes)
  initProxyRotator();
  setupShutdownHandlers();

  if (shouldRunCli()) {
    const { runCli } = await import("./cli.js");
    await runCli();
  } else if (process.stdout.isTTY) {
    // TTY + no args → interactive TUI
    const { runTui } = await import("./cli-tui.js");
    await runTui();
  } else {
    const { createMcpServer } = await import("./server.js");
    const { getOptions } = await import("./config.js");
    const { startStdio, startHttp } = await import("./protocols/index.js");

    const options = getOptions();
    const server = createMcpServer();

    if (options.transport === "http") {
      await startHttp(server, options.port);
    } else {
      await startStdio(server);
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
