import { z } from "zod";
import { toolResult, errorResult } from "../utils/tool-response.js";
import { createFlowServer } from "../flows/index.js";

export const name = "serve_flow";
export const description = "Expose saved Imperium Flows as a local HTTP API.";

export const schema = z.object({
  family: z.string().optional().describe("Optional family to expose; omit to expose all flows"),
  host: z.string().default("127.0.0.1").describe("Host to bind"),
  port: z.number().min(1).max(65535).default(8787).describe("Port to bind"),
  flows_dir: z.string().optional().describe("Flow storage directory override"),
  global: z.boolean().default(false).describe("Use ~/.imperium-crawl/flows instead of ./flows"),
  require_auth: z.boolean().default(false).describe("Require bearer token even on localhost"),
  api_token: z.string().optional().describe("Bearer token; fallback IMPERIUM_FLOW_TOKEN"),
});

export type ServeFlowInput = z.infer<typeof schema>;

export async function execute(input: ServeFlowInput) {
  try {
    const server = createFlowServer({
      family: input.family,
      host: input.host,
      port: input.port,
      flowsDir: input.flows_dir,
      global: input.global,
      requireAuth: input.require_auth,
      apiToken: input.api_token,
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(input.port, input.host, resolve);
    });
    process.stderr.write(`Imperium Flows listening on http://${input.host}:${input.port}\n`);
    await new Promise<void>((resolve) => {
      const close = () => server.close(() => resolve());
      process.once("SIGINT", close);
      process.once("SIGTERM", close);
    });
    return toolResult({ ok: true, stopped: true });
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}
