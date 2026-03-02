import { z } from "zod";
import * as cheerio from "cheerio";
import { fetchPage } from "../utils/fetcher.js";
import { htmlToMarkdown } from "../utils/markdown.js";
import { normalizeUrl } from "../utils/url.js";
import { extractStructuredData, extractLinks } from "../utils/structured-data.js";
import { MAX_URL_LENGTH, MAX_TIMEOUT_MS } from "../constants.js";
import type { StealthLevel } from "../stealth/index.js";

export const name = "scrape";

export const description =
  "Scrape a URL and return content in multiple formats. Returns Markdown by default, with optional HTML, structured data (JSON-LD/OpenGraph), links, and page metadata.";

const INCLUDE_VALUES = ["markdown", "html", "structured_data", "links", "metadata"] as const;

export const schema = z.object({
  url: z.string().max(MAX_URL_LENGTH).describe("The URL to scrape"),
  format: z.enum(["markdown", "html"]).default("markdown").describe("Primary content format"),
  include: z
    .array(z.enum(INCLUDE_VALUES))
    .optional()
    .describe("Additional data to include: structured_data, links, metadata, html, markdown"),
  stealth_level: z
    .number()
    .min(1)
    .max(3)
    .optional()
    .describe("Force stealth level: 1=headers, 2=TLS, 3=browser"),
  timeout: z.number().min(1).max(MAX_TIMEOUT_MS).optional().describe("Timeout in ms"),
  proxy: z.string().max(MAX_URL_LENGTH).optional().describe("Proxy URL (http/https/socks4/socks5). Overrides PROXY_URL env var."),
  chrome_profile: z.string().max(1000).optional().describe("Path to Chrome user data directory for authenticated sessions (cookies, localStorage). Overrides CHROME_PROFILE_PATH env var."),
});

export type ScrapeInput = z.infer<typeof schema>;

export async function execute(input: ScrapeInput) {
  const url = normalizeUrl(input.url);
  const result = await fetchPage(url, {
    forceLevel: input.stealth_level as StealthLevel | undefined,
    timeout: input.timeout,
    proxy: input.proxy,
    chromeProfile: input.chrome_profile,
  });

  // Determine what to include
  const include = new Set(input.include || []);
  const primaryFormat = input.format || "markdown";

  // Always include primary content
  const output: Record<string, unknown> = {
    url: result.url,
    stealth_level: result.level,
  };

  // Primary content
  if (primaryFormat === "markdown" || include.has("markdown")) {
    output.markdown = htmlToMarkdown(result.html);
  }
  if (primaryFormat === "html" || include.has("html")) {
    output.html = result.html;
  }

  // Set content field to primary format
  if (primaryFormat === "markdown") {
    output.content = output.markdown;
  } else {
    output.content = output.html;
  }

  // Structured data (JSON-LD, OpenGraph, Twitter Cards, Microdata)
  // Lazy-cached to avoid parsing HTML twice when both structured_data and metadata are requested
  let structuredDataCache: ReturnType<typeof extractStructuredData> | undefined;
  function getStructuredData() {
    if (!structuredDataCache) structuredDataCache = extractStructuredData(result.html);
    return structuredDataCache;
  }

  if (include.has("structured_data")) {
    output.structured_data = getStructuredData();
  }

  // Links
  if (include.has("links")) {
    const $ = cheerio.load(result.html);
    output.links = extractLinks($, result.url);
  }

  // Page metadata
  if (include.has("metadata")) {
    const structured = getStructuredData();
    output.metadata = {
      title: structured.meta.title,
      description: structured.meta.description,
      canonical: structured.meta.canonical,
      language: structured.meta.language,
      author: structured.meta.author,
      openGraph: Object.keys(structured.openGraph).length > 0 ? structured.openGraph : undefined,
    };
  }

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(output, null, 2),
      },
    ],
  };
}
