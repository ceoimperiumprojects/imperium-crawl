import { z } from "zod";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { fetchPage } from "../utils/fetcher.js";
import * as manager from "../skills/manager.js";
import type {
  SkillConfig,
  ExtractSkillConfig,
  AiExtractSkillConfig,
  ReadabilitySkillConfig,
  WebSocketSkillConfig,
} from "../skills/manager.js";
import { MAX_URL_LENGTH, MAX_ITEMS } from "../constants.js";

export const name = "run_skill";

export const description =
  "Run a previously created skill or built-in recipe to extract fresh structured data from its URL. Built-in recipes cover common use cases like HN, GitHub trending, e-commerce, news, SEO, and more.";

export const schema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_-]+$/, "Skill name may only contain letters, numbers, hyphens, and underscores").describe("The skill name or built-in recipe to run"),
  url: z.string().max(MAX_URL_LENGTH).optional().describe("Override the skill's default URL"),
  max_items: z.number().min(1).max(MAX_ITEMS).default(50).describe("Maximum items to return"),
  proxy: z.string().max(MAX_URL_LENGTH).optional().describe("Proxy URL (http/https/socks4/socks5). Overrides PROXY_URL env var."),
  chrome_profile: z.string().max(1000).optional().describe("Path to Chrome user data directory for authenticated sessions (cookies, localStorage). Overrides CHROME_PROFILE_PATH env var."),
  duration_seconds: z.number().min(1).max(300).optional().describe("Override WebSocket monitoring duration (seconds). Only applies to monitor_websocket recipes."),
  max_messages: z.number().min(1).max(1000).optional().describe("Override max WebSocket messages to capture. Only applies to monitor_websocket recipes."),
});

export type RunSkillInput = z.infer<typeof schema>;

// --- Helpers ---

function mcpResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function extractField(
  $: cheerio.CheerioAPI,
  el: cheerio.Cheerio<AnyNode>,
  selectorRaw: string,
): string {
  // Support "selector | attr" syntax for attribute extraction
  const pipeIdx = selectorRaw.indexOf(" | ");
  if (pipeIdx !== -1) {
    const selector = selectorRaw.slice(0, pipeIdx).trim();
    const attr = selectorRaw.slice(pipeIdx + 3).trim();
    const target = selector ? el.find(selector) : el;
    return target.attr(attr) || "";
  }

  // Support "@ attr" syntax for attribute on the element itself
  const parts = selectorRaw.split(" @");
  const selector = parts[0].trim();
  const attr = parts[1]?.trim();
  const target = selector ? el.find(selector) : el;
  return attr ? target.attr(attr) || "" : target.text().trim();
}

// --- Dispatch: CSS extract (default / tool: "extract") ---

async function runExtract(
  config: ExtractSkillConfig,
  url: string,
  input: RunSkillInput,
) {
  const allItems: Record<string, string>[] = [];
  let currentUrl = url;
  let page = 0;
  const maxPages = config.pagination?.max_pages || 1;

  while (page < maxPages && allItems.length < input.max_items) {
    const result = await fetchPage(currentUrl, { proxy: input.proxy, chromeProfile: input.chrome_profile });
    const $ = cheerio.load(result.html);

    $(config.selectors.items).each((_, el) => {
      if (allItems.length >= input.max_items) return;
      const item: Record<string, string> = {};
      for (const [field, selector] of Object.entries(config.selectors.fields)) {
        item[field] = extractField($, $(el), selector);
      }
      const hasContent = Object.values(item).some((v) => v.length > 0);
      if (hasContent) allItems.push(item);
    });

    if (config.pagination?.next) {
      const nextLink = $(config.pagination.next).attr("href");
      if (nextLink) {
        currentUrl = new URL(nextLink, currentUrl).toString();
        page++;
      } else {
        break;
      }
    } else {
      break;
    }
  }

  return mcpResult({
    skill: config.name,
    description: config.description,
    tool: "extract",
    url,
    items_count: allItems.length,
    pages_fetched: page + 1,
    items: allItems,
  });
}

// --- Dispatch: AI extract (tool: "ai_extract") ---

async function runAiExtract(
  config: AiExtractSkillConfig,
  url: string,
  input: RunSkillInput,
) {
  const { hasLLMConfigured, createLLMClient } = await import("../llm/index.js");
  const { extractWithLLM } = await import("../llm/extractor.js");
  const { smartFetch } = await import("../stealth/index.js");
  const { htmlToMarkdown } = await import("../utils/markdown.js");

  if (!hasLLMConfigured()) {
    return mcpResult({
      error: "LLM not configured",
      message: "Set the LLM_API_KEY environment variable to enable AI extraction. Run `imperium-crawl setup` for guided configuration.",
    });
  }

  const fetchResult = await smartFetch(url, {
    proxy: input.proxy,
    chromeProfile: input.chrome_profile,
  });

  // Truncate huge HTML before markdown conversion to avoid parser crashes
  const html = fetchResult.html.length > 500_000
    ? fetchResult.html.slice(0, 500_000)
    : fetchResult.html;

  let markdown: string;
  let markdownFallback = false;
  try {
    markdown = htmlToMarkdown(html);
  } catch {
    // Fallback: strip tags manually if Turndown crashes
    markdownFallback = true;
    markdown = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120_000);
  }

  const client = await createLLMClient();
  const result = await extractWithLLM(client, markdown, config.schema, config.max_tokens ?? 2000);

  return mcpResult({
    skill: config.name,
    description: config.description,
    tool: "ai_extract",
    url: fetchResult.url,
    model: result.model,
    format: config.format ?? "json",
    ...(markdownFallback && { warning: "Markdown conversion failed, used raw text extraction" }),
    data: result.data,
  });
}

// --- Dispatch: Readability (tool: "readability") ---

async function runReadability(
  config: ReadabilitySkillConfig,
  url: string,
  input: RunSkillInput,
) {
  const { parseHTML } = await import("linkedom");
  const { Readability } = await import("@mozilla/readability");
  const { htmlToMarkdown } = await import("../utils/markdown.js");

  const result = await fetchPage(url, { proxy: input.proxy, chromeProfile: input.chrome_profile });
  const { document } = parseHTML(result.html);
  const reader = new Readability(document as unknown as Document, { charThreshold: 50 });
  const article = reader.parse();

  if (!article) {
    return mcpResult({ error: "Could not extract article content", url: result.url });
  }

  const format = config.format ?? "markdown";
  let content: string;
  switch (format) {
    case "html":
      content = article.content;
      break;
    case "text":
      content = article.textContent;
      break;
    case "markdown":
    default:
      content = htmlToMarkdown(article.content);
  }

  return mcpResult({
    skill: config.name,
    description: config.description,
    tool: "readability",
    url: result.url,
    title: article.title,
    byline: article.byline,
    excerpt: article.excerpt,
    siteName: article.siteName,
    content,
  });
}

// --- Dispatch: Scrape (tool: "scrape") ---

/** Detect if URL is likely a JSON API endpoint */
function isJsonApiUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.pathname.endsWith(".json") ||
      u.hostname.startsWith("api.") ||
      u.searchParams.has("format") && u.searchParams.get("format") === "json"
    );
  } catch {
    return false;
  }
}

/** Truncate large JSON arrays to keep output manageable */
function truncateJsonData(data: unknown, maxItems: number): { data: unknown; truncated: boolean } {
  if (Array.isArray(data) && data.length > maxItems) {
    return { data: data.slice(0, maxItems), truncated: true };
  }
  // Reddit-style: { data: { children: [...] } }
  if (
    data && typeof data === "object" && "data" in data &&
    (data as Record<string, unknown>).data &&
    typeof (data as Record<string, unknown>).data === "object"
  ) {
    const inner = (data as Record<string, Record<string, unknown>>).data;
    if ("children" in inner && Array.isArray(inner.children) && inner.children.length > maxItems) {
      return {
        data: { ...data as object, data: { ...inner, children: inner.children.slice(0, maxItems) } },
        truncated: true,
      };
    }
  }
  return { data, truncated: false };
}

async function runScrape(
  config: SkillConfig,
  url: string,
  input: RunSkillInput,
) {
  const { smartFetch } = await import("../stealth/index.js");
  const { htmlToMarkdown } = await import("../utils/markdown.js");

  // JSON API endpoints: use Level 1 (headers only) to avoid browser overhead
  const isJsonApi = isJsonApiUrl(url);
  const result = await smartFetch(url, {
    proxy: input.proxy,
    chromeProfile: input.chrome_profile,
    ...(isJsonApi && { maxLevel: 1 as const }),
  });

  let data: unknown;
  let format = "markdown";

  // Try JSON parse first
  try {
    const parsed = JSON.parse(result.html);
    const { data: truncated, truncated: wasTruncated } = truncateJsonData(parsed, input.max_items);
    data = truncated;
    format = "json";
    return mcpResult({
      skill: config.name,
      description: config.description,
      tool: "scrape",
      url: result.url,
      stealth_level: result.level,
      format,
      ...(wasTruncated && { truncated: true, max_items: input.max_items }),
      data,
    });
  } catch {
    // Not JSON — convert HTML to markdown
    data = htmlToMarkdown(result.html);
    format = "markdown";
  }

  return mcpResult({
    skill: config.name,
    description: config.description,
    tool: "scrape",
    url: result.url,
    stealth_level: result.level,
    format,
    data,
  });
}

// --- Dispatch: WebSocket monitor (tool: "monitor_websocket") ---

async function runMonitorWebsocket(
  config: WebSocketSkillConfig,
  url: string,
  input: RunSkillInput,
) {
  const { isPlaywrightAvailable } = await import("../stealth/browser.js");
  const { acquirePage } = await import("../stealth/chrome-profile.js");
  const { resolveProxy } = await import("../stealth/proxy.js");

  if (!(await isPlaywrightAvailable())) {
    return mcpResult({
      error: "rebrowser-playwright is required for WebSocket monitoring. Install with: npm i rebrowser-playwright",
    });
  }

  const durationSeconds = input.duration_seconds ?? config.duration_seconds ?? 10;
  const maxMessages = input.max_messages ?? config.max_messages ?? 100;
  const filterUrl = config.filter_url;

  const proxyUrl = resolveProxy(input.proxy);
  const handle = await acquirePage({
    chromeProfile: input.chrome_profile,
    proxyUrl,
  });

  try {
    const { page } = handle;

    interface WSMessage {
      ws_url: string;
      direction: "sent" | "received";
      data: unknown;
      timestamp: number;
    }

    interface WSConnection {
      url: string;
      messages_sent: number;
      messages_received: number;
    }

    const messages: WSMessage[] = [];
    const connections = new Map<string, WSConnection>();

    page.on("websocket", (ws) => {
      const wsUrl = ws.url();
      if (filterUrl && !wsUrl.includes(filterUrl)) return;

      const conn: WSConnection = { url: wsUrl, messages_sent: 0, messages_received: 0 };
      connections.set(wsUrl, conn);

      ws.on("framereceived", (frame) => {
        if (messages.length >= maxMessages) return;
        conn.messages_received++;
        let data: unknown;
        try { data = JSON.parse(frame.payload as string); } catch { data = frame.payload; }
        messages.push({ ws_url: wsUrl, direction: "received", data, timestamp: Date.now() });
      });

      ws.on("framesent", (frame) => {
        if (messages.length >= maxMessages) return;
        conn.messages_sent++;
        let data: unknown;
        try { data = JSON.parse(frame.payload as string); } catch { data = frame.payload; }
        messages.push({ ws_url: wsUrl, direction: "sent", data, timestamp: Date.now() });
      });
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(durationSeconds * 1000);

    return mcpResult({
      skill: config.name,
      description: config.description,
      tool: "monitor_websocket",
      url,
      duration_seconds: durationSeconds,
      websocket_connections: connections.size,
      total_messages: messages.length,
      connections: Array.from(connections.values()),
      messages,
    });
  } finally {
    await handle.cleanup();
  }
}

// --- Main execute ---

export async function execute(input: RunSkillInput) {
  // Load with recipe fallback
  const config = await manager.loadWithRecipes(input.name);
  if (!config) {
    const skills = await manager.listAll();
    return mcpResult({
      error: `Skill '${input.name}' not found.`,
      available_skills: skills.map((s) => ({
        name: s.name,
        ...(s.builtin && { builtin: true }),
      })),
    });
  }

  const url = input.url || config.url;
  const tool = config.tool ?? "extract";

  switch (tool) {
    case "extract":
      return runExtract(config as ExtractSkillConfig, url, input);
    case "ai_extract":
      return runAiExtract(config as AiExtractSkillConfig, url, input);
    case "readability":
      return runReadability(config as ReadabilitySkillConfig, url, input);
    case "scrape":
      return runScrape(config, url, input);
    case "monitor_websocket":
      return runMonitorWebsocket(config as WebSocketSkillConfig, url, input);
    default:
      return mcpResult({ error: `Unknown skill tool type: ${tool}` });
  }
}
