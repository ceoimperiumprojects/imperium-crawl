import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export async function startHttp(server: McpServer, port: number): Promise<void> {
  const app = express();
  app.use(express.json());

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  app.post("/mcp", async (req, res) => {
    await transport.handleRequest(req, res, req.body);
  });

  app.get("/mcp", async (req, res) => {
    await transport.handleRequest(req, res);
  });

  app.delete("/mcp", async (req, res) => {
    await transport.handleRequest(req, res);
  });

  await server.connect(transport);

  app.listen(port, () => {
    console.error(`imperium-crawl HTTP server listening on port ${port}`);
  });
}
