import http from "node:http";
import { URL } from "node:url";
import { listFlows, loadFlow, parseFlowRef, validateStoredFlow } from "./storage.js";
import { runFlow } from "./engine.js";
import type { FlowStorageOptions } from "./types.js";

export interface ServeFlowOptions extends FlowStorageOptions {
  family?: string;
  host: string;
  port: number;
  requireAuth?: boolean;
  apiToken?: string;
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body, null, 2));
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  return raw ? JSON.parse(raw) as Record<string, unknown> : {};
}

function needsAuth(options: ServeFlowOptions): boolean {
  return !!options.requireAuth || !["127.0.0.1", "localhost", "::1"].includes(options.host);
}

function authorized(req: http.IncomingMessage, options: ServeFlowOptions): boolean {
  if (!needsAuth(options)) return true;
  const token = options.apiToken || process.env.IMPERIUM_FLOW_TOKEN;
  if (!token) return false;
  return req.headers.authorization === `Bearer ${token}`;
}

export function createFlowServer(options: ServeFlowOptions): http.Server {
  return http.createServer(async (req, res) => {
    try {
      if (!authorized(req, options)) return send(res, 401, { ok: false, error: "Unauthorized" });
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const parts = url.pathname.split("/").filter(Boolean);

      if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { ok: true });

      if (req.method === "GET" && parts[0] === "flows" && parts.length === 1) {
        const flows = (await listFlows(options)).filter((f) => !options.family || f.family === options.family);
        return send(res, 200, { ok: true, flows });
      }

      if (parts[0] === "flows" && parts[1] && parts[2] && req.method === "GET" && parts.length === 3) {
        const { flow, path } = await loadFlow({ family: parts[1], variant: parts[2] }, options);
        return send(res, 200, { ok: true, path, flow });
      }

      if (parts[0] === "flows" && parts[1] && req.method === "GET" && parts.length === 2) {
        const flows = (await listFlows(options)).filter((f) => f.family === parts[1]);
        return send(res, 200, { ok: true, family: parts[1], variants: flows });
      }

      if (parts[0] === "flows" && parts[1] && parts[2] && req.method === "POST" && parts[3] === "validate") {
        const validation = await validateStoredFlow({ family: parts[1], variant: parts[2] }, options);
        return send(res, 200, { ok: true, ...validation });
      }

      if (parts[0] === "flows" && parts[1] && parts[2] && req.method === "POST" && parts[3] === "run") {
        const body = await readJson(req);
        const result = await runFlow(
          { family: parts[1], variant: parts[2] },
          {
            ...options,
            input: (body.input && typeof body.input === "object" ? body.input : {}) as Record<string, string>,
            evidence: body.evidence as never,
          },
        );
        return send(res, result.ok ? 200 : 500, result);
      }

      if (parts[0] === "runs" && parts[1] && req.method === "GET") {
        return send(res, 200, { ok: true, run_id: parts[1], message: "Run metadata is returned inline by POST /flows/:family/:variant/run." });
      }

      if (options.family && req.method === "POST" && parts[0] && parts[1] === "run") {
        const body = await readJson(req);
        const ref = parseFlowRef(`${options.family}/${parts[0]}`);
        const result = await runFlow(ref, {
          ...options,
          input: (body.input && typeof body.input === "object" ? body.input : {}) as Record<string, string>,
          evidence: body.evidence as never,
        });
        return send(res, result.ok ? 200 : 500, result);
      }

      return send(res, 404, { ok: false, error: "Not found" });
    } catch (err) {
      return send(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
}
