import { z } from "zod";
import { fetchPage, ConcurrencyLimiter } from "../utils/fetcher.js";
import { htmlToMarkdown } from "../utils/markdown.js";
import { normalizeUrl, isSameOrigin } from "../utils/url.js";
import { DEFAULT_MAX_DEPTH, DEFAULT_MAX_PAGES, DEFAULT_CONCURRENCY, MAX_URL_LENGTH, MAX_PAGES, MAX_CONCURRENCY, MAX_CRAWL_CONTENT_PER_PAGE } from "../constants.js";
import * as cheerio from "cheerio";

export const name = "crawl";

export const description =
  "Crawl a website using priority-based traversal. Prioritizes content-rich URLs (articles, blog posts) over navigation pages. Returns Markdown content for each page.";

export const schema = z.object({
  url: z.string().max(MAX_URL_LENGTH).describe("Starting URL to crawl"),
  max_depth: z.number().min(0).max(10).default(DEFAULT_MAX_DEPTH).describe("Maximum crawl depth"),
  max_pages: z.number().min(1).max(MAX_PAGES).default(DEFAULT_MAX_PAGES).describe("Maximum number of pages to crawl"),
  concurrency: z.number().min(1).max(MAX_CONCURRENCY).default(DEFAULT_CONCURRENCY).describe("Max concurrent requests"),
  proxy: z.string().max(MAX_URL_LENGTH).optional().describe("Proxy URL (http/https/socks4/socks5). Overrides PROXY_URL env var."),
  chrome_profile: z.string().max(1000).optional().describe("Path to Chrome user data directory for authenticated sessions (cookies, localStorage). Overrides CHROME_PROFILE_PATH env var."),
});

export type CrawlInput = z.infer<typeof schema>;

interface CrawlResult {
  url: string;
  depth: number;
  content: string;
}

interface QueueEntry {
  url: string;
  depth: number;
  score: number;
}

// Content-rich path patterns (higher score)
const CONTENT_PATH_PATTERNS = [
  /\/blog\//i,
  /\/article/i,
  /\/post\//i,
  /\/news\//i,
  /\/story\//i,
  /\/guide\//i,
  /\/tutorial\//i,
  /\/docs?\//i,
  /\/learn\//i,
  /\/\d{4}\/\d{2}\//,  // Date-based paths like /2024/01/
];

// Low-value path patterns (lower score)
const LOW_VALUE_PATTERNS = [
  /\/tag\//i,
  /\/category\//i,
  /\/page\/\d+/i,
  /\/author\//i,
  /\/search/i,
  /\/login/i,
  /\/signup/i,
  /\/register/i,
  /\/cart/i,
  /\/checkout/i,
  /\/account/i,
  /\/admin/i,
  /\.(xml|json|rss|atom)$/i,
  /\/feed\/?$/i,
];

// Anchor text that signals content
const CONTENT_ANCHOR_PATTERNS = [
  /read more/i,
  /continue reading/i,
  /full article/i,
  /learn more/i,
  /view details/i,
];

function scoreUrl(url: string, depth: number, anchorText: string): number {
  let score = 100 - depth * 20; // Shallower = better

  try {
    const u = new URL(url);
    const path = u.pathname;

    // Boost content-rich paths
    if (CONTENT_PATH_PATTERNS.some((p) => p.test(path))) score += 30;

    // Penalize low-value paths
    if (LOW_VALUE_PATTERNS.some((p) => p.test(path))) score -= 40;

    // Boost if anchor text suggests content
    if (anchorText && CONTENT_ANCHOR_PATTERNS.some((p) => p.test(anchorText))) score += 20;

    // Boost shorter paths (usually more important pages)
    const segments = path.split("/").filter(Boolean);
    if (segments.length <= 2) score += 10;
    if (segments.length >= 5) score -= 10;

  } catch {
    // Invalid URL, low score
    score -= 50;
  }

  return score;
}

export async function execute(input: CrawlInput) {
  const startUrl = normalizeUrl(input.url);
  const limiter = new ConcurrencyLimiter(input.concurrency);
  const visited = new Set<string>();
  const results: CrawlResult[] = [];

  // Priority queue (sorted by score descending)
  const queue: QueueEntry[] = [{ url: startUrl, depth: 0, score: 200 }];

  function insertSorted(entry: QueueEntry): void {
    // Binary search for insertion point
    let lo = 0, hi = queue.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (queue[mid].score > entry.score) lo = mid + 1;
      else hi = mid;
    }
    queue.splice(lo, 0, entry);
  }

  while (queue.length > 0 && results.length < input.max_pages) {
    // Take batch from front (highest scores)
    const batchSize = Math.min(input.concurrency, input.max_pages - results.length);
    const batch: QueueEntry[] = [];
    while (batch.length < batchSize && queue.length > 0) {
      const entry = queue.shift()!;
      if (!visited.has(entry.url)) {
        visited.add(entry.url);
        batch.push(entry);
      }
    }

    if (batch.length === 0) break;

    const tasks = batch.map(({ url, depth }) =>
      limiter.run(async () => {
        try {
          const result = await fetchPage(url, { proxy: input.proxy, chromeProfile: input.chrome_profile });
          let content = htmlToMarkdown(result.html);
          if (content.length > MAX_CRAWL_CONTENT_PER_PAGE) {
            content = content.substring(0, MAX_CRAWL_CONTENT_PER_PAGE) + "\n\n[Content truncated at 100KB]";
          }
          results.push({ url: result.url, depth, content });

          // Extract and score links for next depth
          if (depth < input.max_depth) {
            const $ = cheerio.load(result.html);
            $("a[href]").each((_, el) => {
              try {
                const href = $(el).attr("href");
                if (!href) return;
                const absoluteUrl = normalizeUrl(new URL(href, url).toString());
                if (isSameOrigin(startUrl, absoluteUrl) && !visited.has(absoluteUrl)) {
                  const anchorText = $(el).text().trim();
                  const score = scoreUrl(absoluteUrl, depth + 1, anchorText);
                  insertSorted({ url: absoluteUrl, depth: depth + 1, score });
                }
              } catch {
                // Invalid URL, skip
              }
            });
          }
        } catch {
          // Failed to fetch, skip
        }
      }),
    );

    await Promise.all(tasks);
  }

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            pages_crawled: results.length,
            results: results.map((r) => ({
              url: r.url,
              depth: r.depth,
              content: r.content,
            })),
          },
          null,
          2,
        ),
      },
    ],
  };
}
