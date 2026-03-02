import express from "express";
import rateLimit from "express-rate-limit";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export async function startHttp(server: McpServer, port: number): Promise<void> {
  const app = express();

  // Body size limit — reject payloads over 1MB
  app.use(express.json({ limit: "1mb" }));

  // Rate limiting — 100 requests per minute per IP
  app.use(rateLimit({
    windowMs: 60_000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later." },
  }));

  // Request timeout — 5 minutes max
  app.use((_req, res, next) => {
    res.setTimeout(300_000, () => {
      res.status(408).json({ error: "Request timeout" });
    });
    next();
  });

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
    console.log(`imperium-crawl HTTP server listening on port ${port}`);
  });
}
