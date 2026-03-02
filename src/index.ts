#!/usr/bin/env node

import "dotenv/config";
import { createMcpServer } from "./server.js";
import { getOptions } from "./config.js";
import { startStdio, startHttp } from "./protocols/index.js";

async function main() {
  const options = getOptions();
  const server = createMcpServer();

  if (options.transport === "http") {
    await startHttp(server, options.port);
  } else {
    await startStdio(server);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
