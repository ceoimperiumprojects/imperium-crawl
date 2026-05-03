import { z } from "zod";
import { promises as fs } from "fs";
import { join, basename, extname } from "path";
import { MAX_URL_LENGTH, DEFAULT_CONCURRENCY } from "../core/constants.js";
import { ConcurrencyLimiter } from "../utils/fetcher.js";
import { generateHeaders } from "../stealth/headers.js";
import { toolResult, errorResult } from "../utils/tool-response.js";
import { debugLog } from "../utils/debug.js";
import type { StoredCookie } from "../sessions/types.js";

export const name = "batch_download";

export const description =
  "Download multiple files (PDFs, images, documents) in parallel with session cookie support. Uses L1 HTTP fetch with realistic headers — 10x faster than browser-based downloads. Ideal for bulk file retrieval from authenticated sessions.";

export const schema = z.object({
  urls: z
    .array(z.string().max(MAX_URL_LENGTH))
    .min(1)
    .max(500)
    .describe("List of URLs to download"),
  output: z
    .string()
    .describe("Output directory for downloaded files"),
  session_id: z
    .string()
    .max(200)
    .optional()
    .describe("Session ID to inject cookies for authenticated downloads"),
  concurrency: z
    .number()
    .min(1)
    .max(20)
    .default(DEFAULT_CONCURRENCY)
    .describe("Maximum concurrent downloads (default: 3)"),
  rate_limit_ms: z
    .number()
    .min(0)
    .max(30000)
    .default(500)
    .describe("Minimum delay between downloads to same domain in ms (default: 500)"),
  filename_template: z
    .string()
    .max(200)
    .optional()
    .describe("Filename template. Use {index} for file number, {basename} for URL basename. Default: URL basename."),
});

export type BatchDownloadInput = z.infer<typeof schema>;

interface DownloadResult {
  url: string;
  path: string;
  size: number;
  status: number;
}

interface DownloadError {
  url: string;
  error: string;
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 200);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

/**
 * Build Cookie header from session cookies for a given URL.
 */
async function buildCookieHeader(sessionId: string | undefined, url: string): Promise<string | undefined> {
  if (!sessionId) return undefined;
  const { getSessionManager } = await import("../sessions/manager.js");
  const session = await getSessionManager().load(sessionId);
  if (!session?.cookies.length) return undefined;

  const parsed = new URL(url);
  const hostname = parsed.hostname;
  const pathname = parsed.pathname;
  const now = Date.now() / 1000;

  const header = session.cookies
    .filter((c: StoredCookie) => {
      const cookieDomain = c.domain.startsWith(".") ? c.domain : `.${c.domain}`;
      if (!`.${hostname}`.endsWith(cookieDomain)) return false;
      if (c.path && !pathname.startsWith(c.path)) return false;
      if (c.expires && c.expires > 0 && c.expires < now) return false;
      return true;
    })
    .map((c: StoredCookie) => `${c.name}=${c.value}`)
    .join("; ");

  return header || undefined;
}

// Per-domain rate limiting
const domainLastFetch = new Map<string, number>();

function getDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

async function waitForRateLimit(url: string, rateLimitMs: number): Promise<void> {
  const domain = getDomain(url);
  const lastFetch = domainLastFetch.get(domain);
  if (lastFetch) {
    const elapsed = Date.now() - lastFetch;
    if (elapsed < rateLimitMs) {
      await new Promise((resolve) => setTimeout(resolve, rateLimitMs - elapsed));
    }
  }
  domainLastFetch.set(domain, Date.now());
}

export async function execute(input: BatchDownloadInput) {
  try {
    await fs.mkdir(input.output, { recursive: true });

    const limiter = new ConcurrencyLimiter(input.concurrency);
    const results: DownloadResult[] = [];
    const errors: DownloadError[] = [];

    // Pre-load session cookie header once (same session for all URLs)
    // We'll build per-URL cookies since domains may differ
    const sessionId = input.session_id;

    const downloads = input.urls.map((url, index) =>
      limiter.run(async () => {
        try {
          await waitForRateLimit(url, input.rate_limit_ms);

          const headers: Record<string, string> = {
            ...generateHeaders(undefined, url) as Record<string, string>,
          };

          const cookieHeader = await buildCookieHeader(sessionId, url);
          if (cookieHeader) {
            headers["Cookie"] = cookieHeader;
          }

          const response = await fetch(url, {
            headers,
            signal: AbortSignal.timeout(60_000),
            redirect: "follow",
          });

          if (!response.ok) {
            errors.push({ url, error: `HTTP ${response.status}` });
            return;
          }

          const buffer = Buffer.from(await response.arrayBuffer());
          const contentType = response.headers.get("content-type") || "";

          // Determine filename
          let filename: string;
          if (input.filename_template) {
            const urlBasename = basename(new URL(url).pathname) || `file-${index}`;
            filename = input.filename_template
              .replace("{index}", String(index + 1).padStart(3, "0"))
              .replace("{basename}", sanitizeFilename(urlBasename));
          } else {
            const urlPath = new URL(url).pathname;
            const base = basename(urlPath);
            if (base && base.includes(".")) {
              filename = sanitizeFilename(base);
            } else {
              const ext = contentType.includes("pdf") ? ".pdf"
                : contentType.includes("png") ? ".png"
                : contentType.includes("jpeg") || contentType.includes("jpg") ? ".jpg"
                : contentType.includes("octet-stream") ? ".bin"
                : ".dat";
              filename = `download-${String(index + 1).padStart(3, "0")}${ext}`;
            }
          }

          // Avoid overwrite
          let filePath = join(input.output, filename);
          let counter = 1;
          while (true) {
            try {
              await fs.access(filePath);
              const ext = extname(filename);
              const base = filename.slice(0, -ext.length || undefined);
              filePath = join(input.output, `${base}-${counter}${ext}`);
              counter++;
            } catch {
              break;
            }
          }

          await fs.writeFile(filePath, buffer);
          results.push({ url, path: filePath, size: buffer.length, status: response.status });
          debugLog("batch-download", `OK ${url} → ${filePath} (${formatSize(buffer.length)})`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push({ url, error: msg.slice(0, 200) });
          debugLog("batch-download", `FAIL ${url}: ${msg.slice(0, 100)}`);
        }
      }),
    );

    await Promise.all(downloads);

    const totalSize = results.reduce((sum, r) => sum + r.size, 0);

    return toolResult({
      downloaded: results.length,
      failed: errors.length,
      total: input.urls.length,
      total_size: totalSize,
      total_size_human: formatSize(totalSize),
      files: results.map((r) => ({
        path: r.path,
        size: r.size,
        size_human: formatSize(r.size),
        source: r.url,
      })),
      ...(errors.length > 0 ? { errors } : {}),
    });
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}
