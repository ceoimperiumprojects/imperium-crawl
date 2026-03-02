import { z } from "zod";
import { generateHeaders } from "../stealth/headers.js";
import { resolveProxy } from "../stealth/proxy.js";
import { DEFAULT_TIMEOUT_MS, MAX_URL_LENGTH, MAX_BODY_LENGTH, MAX_TIMEOUT_MS } from "../constants.js";

export const name = "query_api";

export const description =
  "Make a direct HTTP request to an API endpoint. Use after discover_apis to call discovered endpoints directly, bypassing DOM rendering for faster structured data access.";

export const schema = z.object({
  url: z.string().max(MAX_URL_LENGTH).describe("The API endpoint URL"),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET").describe("HTTP method"),
  headers: z.record(z.string()).optional().describe("Custom request headers"),
  body: z.string().max(MAX_BODY_LENGTH).optional().describe("Request body (for POST/PUT/PATCH)"),
  params: z.record(z.string()).optional().describe("URL query parameters"),
  timeout: z.number().min(1).max(MAX_TIMEOUT_MS).default(DEFAULT_TIMEOUT_MS).describe("Timeout in ms"),
  stealth_headers: z.boolean().default(true).describe("Include realistic browser headers"),
  proxy: z.string().max(MAX_URL_LENGTH).optional().describe("Proxy URL (http/https/socks4/socks5). Overrides PROXY_URL env var."),
});

export type QueryApiInput = z.infer<typeof schema>;

export async function execute(input: QueryApiInput) {
  // Build URL with query params
  let requestUrl: string;
  try {
    const u = new URL(input.url);
    if (input.params) {
      for (const [key, value] of Object.entries(input.params)) {
        u.searchParams.set(key, value);
      }
    }
    requestUrl = u.toString();
  } catch {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ error: `Invalid URL: ${input.url}` }, null, 2),
        },
      ],
    };
  }

  // Build headers — normalize all keys to lowercase to prevent case-sensitivity duplication
  const headers: Record<string, string> = {};
  if (input.stealth_headers) {
    const stealthHeaders = generateHeaders();
    for (const [key, value] of Object.entries(stealthHeaders)) {
      headers[key.toLowerCase()] = value;
    }
  }
  // Accept JSON by default
  headers["accept"] = "application/json, text/plain, */*";
  // Remove accept-encoding to let Node handle decompression natively
  delete headers["accept-encoding"];
  // Custom headers override stealth headers
  if (input.headers) {
    for (const [key, value] of Object.entries(input.headers)) {
      headers[key.toLowerCase()] = value;
    }
  }

  // Build request options
  const fetchOptions: RequestInit & { dispatcher?: unknown } = {
    method: input.method,
    headers,
    signal: AbortSignal.timeout(input.timeout),
    redirect: "follow",
  };

  // Proxy support via undici ProxyAgent
  const proxyUrl = resolveProxy(input.proxy);
  if (proxyUrl) {
    const { ProxyAgent } = await import("undici");
    (fetchOptions as Record<string, unknown>).dispatcher = new ProxyAgent(proxyUrl);
  }

  // Add body for non-GET methods
  if (input.body && input.method !== "GET") {
    fetchOptions.body = input.body;
    // Auto-detect content type if not set
    if (!headers["content-type"]) {
      try {
        JSON.parse(input.body);
        headers["content-type"] = "application/json";
      } catch {
        headers["content-type"] = "text/plain";
      }
    }
  }

  try {
    const response = await fetch(requestUrl, fetchOptions as RequestInit);
    const contentType = response.headers.get("content-type") || "";
    const responseHeaders = Object.fromEntries(response.headers.entries());

    let data: unknown;
    if (contentType.includes("application/json")) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              url: requestUrl,
              method: input.method,
              status: response.status,
              status_text: response.statusText,
              content_type: contentType,
              response_headers: responseHeaders,
              data,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              error: err instanceof Error ? err.message : String(err),
              url: requestUrl,
              method: input.method,
            },
            null,
            2,
          ),
        },
      ],
    };
  }
}
