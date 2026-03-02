import { z } from "zod";
import { isPlaywrightAvailable } from "../stealth/browser.js";
import { normalizeUrl } from "../utils/url.js";
import { DEFAULT_TIMEOUT_MS } from "../constants.js";

export const name = "discover_apis";

export const description =
  "Navigate to a page and capture all API calls (XHR/fetch) from network traffic. Discovers REST and GraphQL endpoints automatically. Requires rebrowser-playwright.";

export const schema = z.object({
  url: z.string().describe("The URL to navigate to and capture API traffic from"),
  wait_seconds: z.number().default(5).describe("How many seconds to wait for API calls after page load (default: 5)"),
  timeout: z.number().default(DEFAULT_TIMEOUT_MS).describe("Navigation timeout in ms"),
  include_headers: z.boolean().default(false).describe("Include request headers in output"),
  filter_content_type: z
    .string()
    .optional()
    .describe("Filter by response content type (e.g. 'application/json')"),
});

export type DiscoverApisInput = z.infer<typeof schema>;

interface DiscoveredApi {
  url: string;
  method: string;
  status: number;
  content_type: string;
  request_headers?: Record<string, string>;
  query_params?: Record<string, string>;
  request_body?: string;
  response_preview?: unknown;
  is_graphql: boolean;
}

// Filter out noise — static assets, tracking pixels, etc.
const IGNORED_EXTENSIONS = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|map)(\?|$)/i;
const IGNORED_DOMAINS = [
  "google-analytics.com", "googletagmanager.com", "doubleclick.net",
  "facebook.net", "facebook.com/tr", "hotjar.com", "segment.io",
  "segment.com", "mixpanel.com", "amplitude.com", "sentry.io",
  "newrelic.com", "datadoghq.com", "cdn.jsdelivr.net",
  "fonts.googleapis.com", "fonts.gstatic.com",
];

function isApiCall(url: string, contentType: string): boolean {
  // Skip static assets
  if (IGNORED_EXTENSIONS.test(url)) return false;

  // Skip tracking/analytics
  if (IGNORED_DOMAINS.some((d) => url.includes(d))) return false;

  // Include JSON responses
  if (contentType.includes("application/json")) return true;

  // Include GraphQL
  if (url.includes("graphql") || url.includes("/gql")) return true;

  // Include API-like paths
  if (/\/api\//i.test(url) || /\/v\d+\//i.test(url)) return true;

  return false;
}

function detectGraphQL(url: string, body: string | null): boolean {
  if (url.includes("graphql") || url.includes("/gql")) return true;
  if (body) {
    try {
      const parsed = JSON.parse(body);
      if (parsed.query && typeof parsed.query === "string") return true;
    } catch {
      // Not JSON
    }
  }
  return false;
}

function truncatePreview(data: unknown, maxLength: number = 500): unknown {
  const str = JSON.stringify(data);
  if (str.length <= maxLength) return data;
  // Return a truncated version with indicator
  try {
    const parsed = JSON.parse(str.substring(0, maxLength));
    return parsed;
  } catch {
    return "[Response too large - truncated]";
  }
}

export async function execute(input: DiscoverApisInput) {
  if (!(await isPlaywrightAvailable())) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            { error: "rebrowser-playwright is required for API discovery. Install with: npm i rebrowser-playwright" },
            null,
            2,
          ),
        },
      ],
    };
  }

  const url = normalizeUrl(input.url);
  const pw = await import("rebrowser-playwright");
  let browser;

  try {
    browser = await pw.chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    const discoveredApis: DiscoveredApi[] = [];
    const seenUrls = new Set<string>();

    // Intercept all network responses
    page.on("response", async (response) => {
      try {
        const reqUrl = response.url();
        const request = response.request();
        const method = request.method();
        const contentType = response.headers()["content-type"] || "";
        const status = response.status();

        // Dedup by method+url
        const key = `${method}:${reqUrl}`;
        if (seenUrls.has(key)) return;

        // Apply filters
        if (!isApiCall(reqUrl, contentType)) return;
        if (input.filter_content_type && !contentType.includes(input.filter_content_type)) return;

        seenUrls.add(key);

        // Extract query params
        let queryParams: Record<string, string> | undefined;
        try {
          const u = new URL(reqUrl);
          if (u.searchParams.toString()) {
            queryParams = Object.fromEntries(u.searchParams.entries());
          }
        } catch {
          // Invalid URL
        }

        // Get request body (for POST)
        const postData = request.postData();
        const isGraphql = detectGraphQL(reqUrl, postData);

        // Try to get response preview
        let responsePreview: unknown;
        try {
          if (contentType.includes("application/json")) {
            const json = await response.json();
            responsePreview = truncatePreview(json);
          }
        } catch {
          responsePreview = "[Could not parse response]";
        }

        const api: DiscoveredApi = {
          url: reqUrl,
          method,
          status,
          content_type: contentType,
          is_graphql: isGraphql,
        };

        if (queryParams) api.query_params = queryParams;
        if (postData) api.request_body = postData.substring(0, 500);
        if (responsePreview) api.response_preview = responsePreview;

        if (input.include_headers) {
          const reqHeaders = request.headers();
          // Filter out standard browser headers for cleaner output
          const filtered: Record<string, string> = {};
          for (const [k, v] of Object.entries(reqHeaders)) {
            if (!["accept", "accept-encoding", "accept-language", "connection", "host", "user-agent", "sec-", "upgrade-insecure-requests"].some(
              (prefix) => k.toLowerCase().startsWith(prefix),
            )) {
              filtered[k] = v;
            }
          }
          if (Object.keys(filtered).length > 0) api.request_headers = filtered;
        }

        discoveredApis.push(api);
      } catch {
        // Response handling failed, skip
      }
    });

    // Navigate — use "load" instead of "networkidle" because SPAs and streaming sites
    // may never reach networkidle. The wait_seconds param handles lazy API calls.
    await page.goto(url, {
      waitUntil: "load",
      timeout: input.timeout,
    });

    // Wait additional time for lazy-loaded API calls
    if (input.wait_seconds > 0) {
      await page.waitForTimeout(input.wait_seconds * 1000);
    }

    // Scroll down to trigger more API calls
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight / 2);
    });
    await page.waitForTimeout(1000);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              url,
              apis_found: discoveredApis.length,
              graphql_endpoints: discoveredApis.filter((a) => a.is_graphql).length,
              apis: discoveredApis,
            },
            null,
            2,
          ),
        },
      ],
    };
  } finally {
    await browser?.close();
  }
}
