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
  InfluencerDiscoverySkillConfig,
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
  // Influencer discovery params
  niche: z.string().max(200).optional().describe("Niche keywords for influencer discovery"),
  location: z.string().max(100).optional().describe("Location filter"),
  hashtags: z.array(z.string()).max(10).optional().describe("Hashtags to search (hashtag_scout workflow)"),
  competitor: z.string().max(200).optional().describe("Competitor brand/handle (competitor_spy workflow)"),
  output_format: z.enum(["json", "markdown", "csv"]).optional().describe("Output format for influencer discovery"),
  threshold: z.number().min(0).max(100).optional().describe("Tier qualification threshold (default 60)"),
  min_subscribers: z.number().min(0).optional().describe("Min YouTube subscribers (content_scout, default 300)"),
  max_subscribers: z.number().min(0).optional().describe("Max YouTube subscribers (content_scout, default 100000)"),
});

export type RunSkillInput = z.infer<typeof schema>;

// --- Helpers ---

function toolResult(data: unknown) {
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

  return toolResult({
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
    return toolResult({
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

  return toolResult({
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
    return toolResult({ error: "Could not extract article content", url: result.url });
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

  return toolResult({
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
    return toolResult({
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

  return toolResult({
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
    return toolResult({
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

    return toolResult({
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

// --- Influencer Discovery ---

interface InfluencerProfile {
  handle: string;
  name: string;
  youtube_url?: string;
  instagram_url?: string;
  subscribers?: number;
  ig_followers?: number;
  description?: string;
  engagement_rate?: number;
  avg_views?: number;
  avg_likes?: number;
  video_count?: number;
  recent_videos?: Array<{ title: string; views?: number; likes?: number; published?: string }>;
  email?: string;
  website?: string;
  has_business_contact?: boolean;
  has_collab_signals?: boolean;
  niche_match_pct?: number;
  posting_frequency?: string;
  ig_engagement_rate?: number;
  ig_posts_count?: number;
  niche_depth?: "SPECIALIST" | "MIXED" | "GENERALIST";
  views_per_sub?: number;
  likes_per_view?: number;
  view_consistency?: number;
  platform_count: number;
  scores: { reach: number; conversion: number; partnership: number };
  tier: "GOLDEN" | "SILVER" | "BRONZE" | "UNRANKED";
}

// Brave Search helper
async function braveSearch(query: string, count = 10): Promise<unknown> {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) return null;
  const { issueRequest } = await import("../brave-api/index.js");
  try {
    return await issueRequest(apiKey, "/web/search", { q: query, count });
  } catch {
    return null;
  }
}

// YouTube tool helper — direct in-process call
async function ytExecute(action: string, params: Record<string, unknown>): Promise<unknown> {
  const yt = await import("./youtube.js");
  const result = await yt.execute({ action, limit: 10, sort: "relevance", ...params } as any);
  try {
    return JSON.parse(result.content[0].text || "{}");
  } catch {
    return null;
  }
}

// Instagram tool helper — direct in-process call
async function igExecute(action: string, params: Record<string, unknown>): Promise<unknown> {
  const ig = await import("./instagram.js");
  const result = await ig.execute({ action, limit: 1, sort: "engagement", ...params } as any);
  try { return JSON.parse(result.content[0].text || "{}"); } catch { return null; }
}

// Parse IG handle from YouTube description
function parseIgHandles(description: string): string[] {
  if (!description) return [];
  const handles: string[] = [];
  // Look for patterns like "instagram: @handle", "ig: @handle", "insta: @handle"
  const patterns = [
    /(?:instagram|ig|insta)[:\s]*@?([\w.]{3,30})/gi,
    /instagram\.com\/([\w.]{3,30})/gi,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(description)) !== null) {
      const h = match[1].toLowerCase();
      if (!handles.includes(h) && h !== "com" && h !== "www") handles.push(h);
    }
  }
  return handles;
}

// Parse followers from Brave snippet — uses inline compact number parsing
function parseFollowersFromSnippet(snippet: string): number | undefined {
  if (!snippet) return undefined;
  // Match patterns like "1.2M Followers", "842K followers"
  const match = snippet.match(/([\d,.]+)\s*([KMB])?\s*[Ff]ollowers/i);
  if (!match) return undefined;
  const num = parseFloat(match[1].replace(/,/g, ""));
  if (isNaN(num)) return undefined;
  const suffix = match[2]?.toUpperCase();
  const mult: Record<string, number> = { K: 1_000, M: 1_000_000, B: 1_000_000_000 };
  return Math.round(num * (suffix ? (mult[suffix] || 1) : 1));
}

// IG API call with rate limiting
async function igApiCall(
  endpoint: string,
  igCallsUsed: { count: number },
  igMaxCalls: number,
): Promise<unknown> {
  if (igCallsUsed.count >= igMaxCalls) return null;
  const sessionId = process.env.IG_SESSION_ID;
  const csrfToken = process.env.IG_CSRF_TOKEN;
  const dsUserId = process.env.IG_DS_USER_ID;
  if (!sessionId) return null;

  igCallsUsed.count++;
  try {
    const res = await fetch(`https://www.instagram.com/${endpoint}`, {
      headers: {
        "Cookie": `sessionid=${sessionId}; csrftoken=${csrfToken || ""}; ds_user_id=${dsUserId || ""}`,
        "X-CSRFToken": csrfToken || "",
        "X-IG-App-ID": "936619743392459",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Calculate engagement rate
function calcEngagement(avgViews?: number, avgLikes?: number, subscribers?: number): number {
  if (!subscribers || subscribers === 0) return 0;
  if (avgLikes && avgViews) return ((avgLikes / avgViews) * 100);
  if (avgLikes) return ((avgLikes / subscribers) * 100);
  if (avgViews) return ((avgViews / subscribers) * 100);
  return 0;
}

// Scoring weights per category
const REACH_WEIGHTS = { audience_size: 25, engagement_rate: 20, niche_relevance: 15, multi_platform: 15, consistency: 10, frequency: 8, contact: 5, collab_signals: 2 };
const CONVERSION_WEIGHTS = { engagement_rate: 30, niche_relevance: 25, consistency: 15, contact: 10, collab_signals: 8, frequency: 5, audience_size: 5, multi_platform: 2 };
const PARTNERSHIP_WEIGHTS = { niche_relevance: 20, engagement_rate: 20, contact: 15, collab_signals: 15, consistency: 12, frequency: 8, audience_size: 5, multi_platform: 5 };

function scoreCriterion(profile: InfluencerProfile, criterion: string): number {
  switch (criterion) {
    case "audience_size": {
      const total = (profile.subscribers || 0) + (profile.ig_followers || 0);
      if (total >= 100_000) return 10; // macro — lower score (harder to partner)
      if (total >= 10_000) return 25;  // micro — sweet spot
      if (total >= 1_000) return 15;   // nano — good for niche
      return 5;
    }
    case "engagement_rate": {
      const er = profile.engagement_rate || 0;
      if (er > 8) return 20;
      if (er > 5) return 16;
      if (er > 3) return 12;
      if (er > 1) return 8;
      return 4;
    }
    case "niche_relevance":
      return Math.round((profile.niche_match_pct || 0) / 100 * 15);
    case "multi_platform": {
      if (profile.platform_count >= 3) return 15;
      if (profile.platform_count >= 2) return 10;
      return 5;
    }
    case "consistency":
      return Math.round((profile.niche_match_pct || 50) / 100 * 10);
    case "frequency": {
      const freq = profile.posting_frequency;
      if (freq === "weekly") return 8;
      if (freq === "biweekly") return 5;
      if (freq === "monthly") return 3;
      return 0;
    }
    case "contact": {
      if (profile.email) return 5;
      if (profile.website) return 3;
      if (profile.has_business_contact) return 2;
      return 0;
    }
    case "collab_signals": {
      let s = 0;
      if (profile.has_collab_signals) s += 1;
      if (profile.has_business_contact) s += 1;
      return s;
    }
    default: return 0;
  }
}

function calculateScores(profile: InfluencerProfile): { reach: number; conversion: number; partnership: number } {
  const calc = (weights: Record<string, number>) => {
    let score = 0;
    const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
    for (const [criterion, weight] of Object.entries(weights)) {
      const raw = scoreCriterion(profile, criterion);
      // Normalize: raw is scored out of the max for that criterion, scale to weight
      const maxRaw = criterion === "audience_size" ? 25 : criterion === "engagement_rate" ? 20 : criterion === "niche_relevance" ? 15 : criterion === "multi_platform" ? 15 : criterion === "consistency" ? 10 : criterion === "frequency" ? 8 : criterion === "contact" ? 5 : 2;
      score += (raw / maxRaw) * weight;
    }
    return Math.round((score / totalWeight) * 100);
  };

  return {
    reach: calc(REACH_WEIGHTS),
    conversion: calc(CONVERSION_WEIGHTS),
    partnership: calc(PARTNERSHIP_WEIGHTS),
  };
}

function classifyTier(scores: { reach: number; conversion: number; partnership: number }, threshold: number): "GOLDEN" | "SILVER" | "BRONZE" | "UNRANKED" {
  const above = [scores.reach, scores.conversion, scores.partnership].filter(s => s >= threshold).length;
  if (above >= 3) return "GOLDEN";
  if (above >= 2) return "SILVER";
  if (above >= 1) return "BRONZE";
  return "UNRANKED";
}

// Estimate posting frequency from recent video dates
function estimateFrequency(videos: Array<{ published?: string }>): string {
  if (!videos.length) return "inactive";
  // Simple heuristic based on last 3 videos' published text
  const hasRecent = videos.some(v => {
    const p = v.published?.toLowerCase() || "";
    return p.includes("day") || p.includes("hour") || p.includes("minute");
  });
  if (hasRecent && videos.length >= 3) return "weekly";
  const hasWeekly = videos.some(v => {
    const p = v.published?.toLowerCase() || "";
    return p.includes("week");
  });
  if (hasWeekly) return "biweekly";
  return "monthly";
}

// Calculate niche depth from video titles
function calcNicheDepth(videoTitles: string[], nicheKeywords: string[]): "SPECIALIST" | "MIXED" | "GENERALIST" {
  if (!videoTitles.length || !nicheKeywords.length) return "GENERALIST";
  const count = Math.min(videoTitles.length, 5);
  let matching = 0;
  for (let i = 0; i < count; i++) {
    const lower = videoTitles[i].toLowerCase();
    if (nicheKeywords.some(kw => lower.includes(kw.toLowerCase()))) matching++;
  }
  if (matching >= 4 || (count <= 3 && matching === count)) return "SPECIALIST";
  if (matching >= Math.ceil(count * 0.5)) return "MIXED";
  return "GENERALIST";
}

// Calculate view consistency (0-100) — low coefficient of variation = high consistency
function calcViewConsistency(views: number[]): number {
  if (views.length < 2) return 50;
  const mean = views.reduce((a, b) => a + b, 0) / views.length;
  if (mean === 0) return 0;
  const variance = views.reduce((s, v) => s + (v - mean) ** 2, 0) / views.length;
  const cv = Math.sqrt(variance) / mean; // coefficient of variation
  // cv=0 → 100 (perfectly consistent), cv>=2 → 0 (wildly inconsistent)
  return Math.round(Math.max(0, Math.min(100, (1 - cv / 2) * 100)));
}

// Composite content quality score (0-100)
function calcContentScore(profile: InfluencerProfile): number {
  let score = 0;
  // Likes per view (25 pts) — higher = more engaged audience
  const lpv = profile.likes_per_view || 0;
  if (lpv >= 0.08) score += 25;
  else if (lpv >= 0.05) score += 20;
  else if (lpv >= 0.03) score += 15;
  else if (lpv >= 0.01) score += 8;

  // Views per sub (25 pts) — higher = loyal audience
  const vps = profile.views_per_sub || 0;
  if (vps >= 0.5) score += 25;
  else if (vps >= 0.3) score += 20;
  else if (vps >= 0.15) score += 15;
  else if (vps >= 0.05) score += 8;

  // Niche depth (30 pts)
  if (profile.niche_depth === "SPECIALIST") score += 30;
  else if (profile.niche_depth === "MIXED") score += 15;

  // View consistency (20 pts)
  score += Math.round((profile.view_consistency || 0) / 100 * 20);

  return score;
}

// Calculate niche match % from descriptions/titles
function calcNicheMatch(texts: string[], nicheKeywords: string[]): number {
  if (!texts.length || !nicheKeywords.length) return 50;
  const lowerTexts = texts.map(t => t.toLowerCase()).join(" ");
  let matches = 0;
  for (const kw of nicheKeywords) {
    if (lowerTexts.includes(kw.toLowerCase())) matches++;
  }
  return Math.round((matches / nicheKeywords.length) * 100);
}

// Extract contact info from description
function extractContactInfo(desc: string): { email?: string; website?: string; hasBusiness: boolean; hasCollab: boolean } {
  const emailMatch = desc.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  const websiteMatch = desc.match(/https?:\/\/(?!(?:youtube|instagram|twitter|facebook|tiktok)\.com)[^\s"'<>]+/i);
  const hasBusiness = /business|collab|partner|sponsor|inquir/i.test(desc);
  const hasCollab = /collab|partner|sponsor|brand|work with/i.test(desc);
  return {
    email: emailMatch?.[0],
    website: websiteMatch?.[0],
    hasBusiness,
    hasCollab,
  };
}

// Format output
function formatInfluencerOutput(
  influencers: InfluencerProfile[],
  format: "json" | "markdown" | "csv",
  meta: { workflow: string; niche: string; threshold: number },
) {
  // Sort by tier then by highest avg score
  const tierOrder = { GOLDEN: 0, SILVER: 1, BRONZE: 2, UNRANKED: 3 };
  influencers.sort((a, b) => {
    const td = tierOrder[a.tier] - tierOrder[b.tier];
    if (td !== 0) return td;
    const avgA = (a.scores.reach + a.scores.conversion + a.scores.partnership) / 3;
    const avgB = (b.scores.reach + b.scores.conversion + b.scores.partnership) / 3;
    return avgB - avgA;
  });

  if (format === "csv") {
    const header = "handle,name,tier,reach,conversion,partnership,subscribers,ig_followers,engagement_rate,niche_depth,views_per_sub,likes_per_view,view_consistency,youtube_url,instagram_url,email";
    const rows = influencers.map(i =>
      [i.handle, i.name, i.tier, i.scores.reach, i.scores.conversion, i.scores.partnership,
       i.subscribers || "", i.ig_followers || "", i.engagement_rate?.toFixed(1) || "",
       i.niche_depth || "", i.views_per_sub ?? "", i.likes_per_view ?? "", i.view_consistency ?? "",
       i.youtube_url || "", i.instagram_url || "", i.email || ""].join(",")
    );
    return header + "\n" + rows.join("\n");
  }

  if (format === "markdown") {
    const tierBadge = { GOLDEN: "🥇", SILVER: "🥈", BRONZE: "🥉", UNRANKED: "⬜" };
    let md = `# Influencer Discovery: ${meta.niche}\n\n`;
    md += `**Workflow**: ${meta.workflow} | **Threshold**: ${meta.threshold} | **Found**: ${influencers.length}\n\n`;
    md += `| Tier | Handle | Subscribers | IG Followers | Engagement | Niche | V/Sub | L/View | Consist | Reach | Conv | Partner | Contact |\n`;
    md += `|------|--------|-------------|-------------|-----------|-------|-------|--------|---------|-------|------|---------|--------|\n`;
    for (const i of influencers) {
      const subs = i.subscribers ? formatNum(i.subscribers) : "-";
      const igf = i.ig_followers ? formatNum(i.ig_followers) : "-";
      const er = i.engagement_rate ? `${i.engagement_rate.toFixed(1)}%` : "-";
      const nd = i.niche_depth || "-";
      const vps = i.views_per_sub !== undefined ? i.views_per_sub.toFixed(2) : "-";
      const lpv = i.likes_per_view !== undefined ? i.likes_per_view.toFixed(3) : "-";
      const vc = i.view_consistency !== undefined ? String(i.view_consistency) : "-";
      const contact = i.email ? "📧" : i.website ? "🌐" : i.has_business_contact ? "💼" : "-";
      md += `| ${tierBadge[i.tier]} ${i.tier} | ${i.handle} | ${subs} | ${igf} | ${er} | ${nd} | ${vps} | ${lpv} | ${vc} | ${i.scores.reach} | ${i.scores.conversion} | ${i.scores.partnership} | ${contact} |\n`;
    }
    return md;
  }

  // JSON (default)
  return {
    workflow: meta.workflow,
    niche: meta.niche,
    threshold: meta.threshold,
    total_found: influencers.length,
    tiers: {
      golden: influencers.filter(i => i.tier === "GOLDEN").length,
      silver: influencers.filter(i => i.tier === "SILVER").length,
      bronze: influencers.filter(i => i.tier === "BRONZE").length,
      unranked: influencers.filter(i => i.tier === "UNRANKED").length,
    },
    influencers,
  };
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// --- Workflow: niche_discovery ---

async function runNicheDiscovery(
  config: InfluencerDiscoverySkillConfig,
  input: RunSkillInput,
): Promise<InfluencerProfile[]> {
  const { parseCompactNumber } = await import("../social/parsers.js");
  const niche = input.niche || config.niche;
  const location = input.location || "";
  const nicheKeywords = niche.split(/[\s,]+/).filter(Boolean);

  // Step 1: YouTube search with 3 queries
  const queries = [
    `${niche} vlog`,
    `${niche} guide`,
    location ? `${location} ${niche}` : `best ${niche}`,
  ];

  const searchResults: Array<{ author: string; author_url?: string }> = [];
  for (const q of queries) {
    const data = await ytExecute("search", { query: q }) as any;
    if (data?.results) {
      for (const v of data.results) {
        searchResults.push({ author: v.author, author_url: v.author_url });
      }
    }
  }

  // Step 2: Deduplicate by author_url
  const uniqueCreators = new Map<string, string>();
  for (const r of searchResults) {
    if (r.author_url && !uniqueCreators.has(r.author_url)) {
      uniqueCreators.set(r.author_url, r.author);
    }
  }

  // Take top 10
  const creatorEntries = Array.from(uniqueCreators.entries()).slice(0, 10);
  const igCallsUsed = { count: 0 };
  const igMaxCalls = input.threshold !== undefined ? config.ig_max_calls ?? 15 : config.ig_max_calls ?? 15;

  const influencers: InfluencerProfile[] = [];

  for (const [channelUrl, authorName] of creatorEntries) {
    // Step 3: Get channel details
    const channelHandle = channelUrl.replace("https://www.youtube.com", "");
    const channel = await ytExecute("channel", { channel_url: channelUrl }) as any;

    // Step 4: Get recent videos
    const recentSearch = await ytExecute("search", { query: `${authorName} ${niche}` }) as any;
    const recentVideos = (recentSearch?.results || []).slice(0, 3);

    // Calculate engagement from recent videos
    const videoDetails: Array<{ title: string; views?: number; likes?: number; published?: string }> = [];
    for (const v of recentVideos) {
      if (v.url) {
        const vd = await ytExecute("video", { url: v.url }) as any;
        if (vd && !vd.error) {
          videoDetails.push({
            title: vd.title || v.title,
            views: vd.views,
            likes: vd.likes,
            published: vd.published,
          });
        }
      }
    }

    const avgViews = videoDetails.length > 0
      ? videoDetails.reduce((s, v) => s + (v.views || 0), 0) / videoDetails.length
      : undefined;
    const avgLikes = videoDetails.length > 0
      ? videoDetails.reduce((s, v) => s + (v.likes || 0), 0) / videoDetails.length
      : undefined;

    const subscribers = channel?.subscribers;
    const description = channel?.description || "";
    const contactInfo = extractContactInfo(description);

    // Step 5: Parse IG handles from description
    const igHandles = parseIgHandles(description);
    let igFollowers: number | undefined;
    let igUrl: string | undefined;

    // Step 6: Brave Search for IG data
    if (igHandles.length > 0) {
      const braveResult = await braveSearch(`"${igHandles[0]}" instagram`, 3) as any;
      if (braveResult?.web?.results) {
        for (const r of braveResult.web.results) {
          const f = parseFollowersFromSnippet(r.description || "");
          if (f) {
            igFollowers = f;
            igUrl = `https://instagram.com/${igHandles[0]}`;
            break;
          }
        }
      }

      // Step 7: IG API enrichment for top candidates
      if (!igFollowers && process.env.IG_SESSION_ID) {
        const igData = await igApiCall(
          `api/v1/users/web_profile_info/?username=${igHandles[0]}`,
          igCallsUsed,
          config.ig_max_calls ?? 15,
        ) as any;
        if (igData?.data?.user) {
          igFollowers = igData.data.user.edge_followed_by?.count;
          igUrl = `https://instagram.com/${igHandles[0]}`;
        }
      }
    }

    const platformCount = 1 + (igFollowers ? 1 : 0); // YouTube + IG if found
    const engagementRate = calcEngagement(avgViews, avgLikes, subscribers);
    const nicheMatchPct = calcNicheMatch(
      [description, ...videoDetails.map(v => v.title)],
      nicheKeywords,
    );
    const postingFreq = estimateFrequency(videoDetails);

    const profile: InfluencerProfile = {
      handle: channelHandle || authorName,
      name: channel?.name || authorName,
      youtube_url: channelUrl,
      instagram_url: igUrl,
      subscribers,
      ig_followers: igFollowers,
      description: description.substring(0, 300),
      engagement_rate: Math.round(engagementRate * 10) / 10,
      avg_views: avgViews ? Math.round(avgViews) : undefined,
      avg_likes: avgLikes ? Math.round(avgLikes) : undefined,
      recent_videos: videoDetails,
      email: contactInfo.email,
      website: contactInfo.website,
      has_business_contact: contactInfo.hasBusiness,
      has_collab_signals: contactInfo.hasCollab,
      niche_match_pct: nicheMatchPct,
      posting_frequency: postingFreq,
      platform_count: platformCount,
      scores: { reach: 0, conversion: 0, partnership: 0 },
      tier: "UNRANKED",
    };

    profile.scores = calculateScores(profile);
    profile.tier = classifyTier(profile.scores, input.threshold ?? config.threshold ?? 60);
    influencers.push(profile);
  }

  return influencers;
}

// --- Workflow: hashtag_scout ---

async function runHashtagScout(
  config: InfluencerDiscoverySkillConfig,
  input: RunSkillInput,
): Promise<InfluencerProfile[]> {
  const { parseCompactNumber } = await import("../social/parsers.js");
  const niche = input.niche || config.niche;
  const nicheKeywords = niche.split(/[\s,]+/).filter(Boolean);
  const hashtags = input.hashtags || [niche.replace(/\s+/g, "")];
  const igCallsUsed = { count: 0 };
  const igMaxCalls = config.ig_max_calls ?? 15;

  const handles = new Map<string, { source: string }>();

  if (process.env.IG_SESSION_ID) {
    // IG hashtag API
    for (const tag of hashtags) {
      const data = await igApiCall(
        `api/v1/tags/${tag}/sections/`,
        igCallsUsed,
        igMaxCalls,
      ) as any;
      if (data?.sections) {
        for (const section of data.sections) {
          const medias = section?.layout_content?.medias || [];
          for (const m of medias) {
            const username = m?.media?.user?.username;
            if (username && !handles.has(username)) {
              handles.set(username, { source: `#${tag}` });
            }
          }
        }
      }
    }
  }

  // Fallback: Brave Search for hashtag discovery
  if (handles.size === 0) {
    for (const tag of hashtags) {
      const data = await braveSearch(`site:instagram.com #${tag} ${niche}`, 10) as any;
      if (data?.web?.results) {
        for (const r of data.web.results) {
          const urlMatch = r.url?.match(/instagram\.com\/([\w.]+)/);
          if (urlMatch && urlMatch[1] !== "p" && urlMatch[1] !== "explore") {
            handles.set(urlMatch[1], { source: `#${tag}` });
          }
        }
      }
    }
  }

  // Take top 10
  const topHandles = Array.from(handles.entries()).slice(0, 10);
  const influencers: InfluencerProfile[] = [];

  for (const [handle, meta] of topHandles) {
    // Brave Search cross-ref for followers
    let igFollowers: number | undefined;
    const braveResult = await braveSearch(`"${handle}" instagram followers`, 3) as any;
    if (braveResult?.web?.results) {
      for (const r of braveResult.web.results) {
        const f = parseFollowersFromSnippet(r.description || "");
        if (f) { igFollowers = f; break; }
      }
    }

    // IG API enrichment
    if (!igFollowers && process.env.IG_SESSION_ID) {
      const igData = await igApiCall(
        `api/v1/users/web_profile_info/?username=${handle}`,
        igCallsUsed,
        igMaxCalls,
      ) as any;
      if (igData?.data?.user) {
        igFollowers = igData.data.user.edge_followed_by?.count;
      }
    }

    // YouTube verification
    let ytChannel: any = null;
    const ytSearch = await ytExecute("search", { query: handle }) as any;
    if (ytSearch?.results?.[0]?.author_url) {
      ytChannel = await ytExecute("channel", { channel_url: ytSearch.results[0].author_url }) as any;
    }

    const subscribers = ytChannel?.subscribers;
    const description = ytChannel?.description || "";
    const contactInfo = extractContactInfo(description);
    const platformCount = (igFollowers ? 1 : 0) + (subscribers ? 1 : 0) || 1;

    const profile: InfluencerProfile = {
      handle: `@${handle}`,
      name: ytChannel?.name || handle,
      youtube_url: ytChannel?.url,
      instagram_url: `https://instagram.com/${handle}`,
      subscribers,
      ig_followers: igFollowers,
      description: description.substring(0, 300),
      engagement_rate: 0,
      niche_match_pct: calcNicheMatch([description, handle], nicheKeywords),
      posting_frequency: "monthly",
      platform_count: platformCount,
      email: contactInfo.email,
      website: contactInfo.website,
      has_business_contact: contactInfo.hasBusiness,
      has_collab_signals: contactInfo.hasCollab,
      scores: { reach: 0, conversion: 0, partnership: 0 },
      tier: "UNRANKED",
    };

    profile.scores = calculateScores(profile);
    profile.tier = classifyTier(profile.scores, input.threshold ?? config.threshold ?? 60);
    influencers.push(profile);
  }

  return influencers;
}

// --- Workflow: competitor_spy ---

async function runCompetitorSpy(
  config: InfluencerDiscoverySkillConfig,
  input: RunSkillInput,
): Promise<InfluencerProfile[]> {
  const { parseCompactNumber } = await import("../social/parsers.js");
  const niche = input.niche || config.niche;
  const nicheKeywords = niche.split(/[\s,]+/).filter(Boolean);
  const competitor = input.competitor || niche;

  // Step 1: Brave Search for sponsored/collab content
  const braveQueries = [
    `"${competitor}" sponsored site:youtube.com`,
    `"${competitor}" collab site:youtube.com`,
  ];

  const creatorUrls = new Map<string, string>();

  for (const q of braveQueries) {
    const data = await braveSearch(q, 10) as any;
    if (data?.web?.results) {
      for (const r of data.web.results) {
        // Extract channel from YouTube video URLs
        if (r.url?.includes("youtube.com/watch")) {
          // Use the title to extract channel name if available
          const channelMatch = r.description?.match(/by\s+([\w\s]+)/i);
          if (channelMatch) {
            creatorUrls.set(r.url, channelMatch[1].trim());
          } else {
            creatorUrls.set(r.url, r.title || "Unknown");
          }
        }
      }
    }
  }

  // Step 2: YouTube search for reviews/unboxings
  const ytQueries = [`${competitor} review`, `${competitor} unboxing`];
  for (const q of ytQueries) {
    const data = await ytExecute("search", { query: q }) as any;
    if (data?.results) {
      for (const v of data.results) {
        if (v.author_url && !creatorUrls.has(v.author_url)) {
          creatorUrls.set(v.author_url, v.author);
        }
      }
    }
  }

  // Deduplicate by channel URL
  const uniqueChannels = new Map<string, string>();
  for (const [url, name] of creatorUrls) {
    // If it's a video URL, we need to get the channel from video details
    if (url.includes("youtube.com/watch")) {
      const vd = await ytExecute("video", { url }) as any;
      if (vd?.author_url && !uniqueChannels.has(vd.author_url)) {
        uniqueChannels.set(vd.author_url, vd.author || name);
      }
    } else if (url.includes("youtube.com/@") || url.includes("youtube.com/c/") || url.includes("youtube.com/channel/")) {
      if (!uniqueChannels.has(url)) uniqueChannels.set(url, name);
    }
  }

  const topCreators = Array.from(uniqueChannels.entries()).slice(0, 10);
  const influencers: InfluencerProfile[] = [];

  for (const [channelUrl, authorName] of topCreators) {
    const channel = await ytExecute("channel", { channel_url: channelUrl }) as any;
    const recentSearch = await ytExecute("search", { query: `${authorName} ${competitor}` }) as any;
    const recentVideos = (recentSearch?.results || []).slice(0, 3);

    const videoDetails: Array<{ title: string; views?: number; likes?: number; published?: string }> = [];
    for (const v of recentVideos) {
      if (v.url) {
        const vd = await ytExecute("video", { url: v.url }) as any;
        if (vd && !vd.error) {
          videoDetails.push({ title: vd.title || v.title, views: vd.views, likes: vd.likes, published: vd.published });
        }
      }
    }

    const avgViews = videoDetails.length > 0
      ? videoDetails.reduce((s, v) => s + (v.views || 0), 0) / videoDetails.length
      : undefined;
    const avgLikes = videoDetails.length > 0
      ? videoDetails.reduce((s, v) => s + (v.likes || 0), 0) / videoDetails.length
      : undefined;

    const subscribers = channel?.subscribers;
    const description = channel?.description || "";
    const contactInfo = extractContactInfo(description);
    const igHandles = parseIgHandles(description);

    let igFollowers: number | undefined;
    let igUrl: string | undefined;
    if (igHandles.length > 0) {
      const braveResult = await braveSearch(`"${igHandles[0]}" instagram`, 3) as any;
      if (braveResult?.web?.results) {
        for (const r of braveResult.web.results) {
          const f = parseFollowersFromSnippet(r.description || "");
          if (f) { igFollowers = f; igUrl = `https://instagram.com/${igHandles[0]}`; break; }
        }
      }
    }

    const platformCount = 1 + (igFollowers ? 1 : 0);
    const engagementRate = calcEngagement(avgViews, avgLikes, subscribers);
    const nicheMatchPct = calcNicheMatch(
      [description, ...videoDetails.map(v => v.title)],
      nicheKeywords,
    );

    const profile: InfluencerProfile = {
      handle: channelUrl.replace("https://www.youtube.com", "") || authorName,
      name: channel?.name || authorName,
      youtube_url: channelUrl,
      instagram_url: igUrl,
      subscribers,
      ig_followers: igFollowers,
      description: description.substring(0, 300),
      engagement_rate: Math.round(engagementRate * 10) / 10,
      avg_views: avgViews ? Math.round(avgViews) : undefined,
      avg_likes: avgLikes ? Math.round(avgLikes) : undefined,
      recent_videos: videoDetails,
      email: contactInfo.email,
      website: contactInfo.website,
      has_business_contact: contactInfo.hasBusiness,
      has_collab_signals: contactInfo.hasCollab,
      niche_match_pct: nicheMatchPct,
      posting_frequency: estimateFrequency(videoDetails),
      platform_count: platformCount,
      scores: { reach: 0, conversion: 0, partnership: 0 },
      tier: "UNRANKED",
    };

    profile.scores = calculateScores(profile);
    profile.tier = classifyTier(profile.scores, input.threshold ?? config.threshold ?? 60);
    influencers.push(profile);
  }

  return influencers;
}

// --- Workflow: content_scout ---

async function runContentScout(
  config: InfluencerDiscoverySkillConfig,
  input: RunSkillInput,
): Promise<InfluencerProfile[]> {
  const niche = input.niche || config.niche;
  const location = input.location || "";
  const nicheKeywords = niche.split(/[\s,]+/).filter(Boolean);
  const minSubs = input.min_subscribers ?? 300;
  const maxSubs = input.max_subscribers ?? 100_000;
  const igMaxCalls = config.ig_max_calls ?? 5;

  // --- Phase 1: DISCOVERY (Brave + YouTube) ---
  const channelUrls = new Map<string, string>(); // url → name

  // Brave queries
  const braveQueries = [
    `site:youtube.com "${niche}" vlog|review|guide`,
    location ? `site:youtube.com "${niche}" "${location}"` : `site:youtube.com "${niche}" tips`,
    `site:youtube.com "${niche}" collab|partner small creator`,
    `"underrated channel" "${niche}" youtube`,
    `site:youtube.com "${niche}" -"million subscribers"`,
  ];

  const bravePromises = braveQueries.map(q => braveSearch(q, 10));
  const braveResults = await Promise.all(bravePromises);

  for (const data of braveResults) {
    const results = (data as any)?.web?.results || [];
    for (const r of results) {
      const url = r.url || "";
      // Extract channel URLs directly
      const channelMatch = url.match(/youtube\.com\/(@[\w.-]+|c\/[\w.-]+|channel\/[\w-]+)/);
      if (channelMatch && !channelUrls.has(channelMatch[0])) {
        channelUrls.set(`https://www.${channelMatch[0]}`, r.title || "");
        continue;
      }
      // Video URLs — we'll resolve to channels in phase 2
      if (url.includes("youtube.com/watch")) {
        channelUrls.set(url, r.title || "");
      }
    }
  }

  // YouTube searches (sort by date for fresh content)
  const ytQueries = [
    `${niche} ${location || ""}`.trim(),
    `${niche} review`,
    `${niche} vlog 2026`,
  ];

  for (const q of ytQueries) {
    const data = await ytExecute("search", { query: q, sort: "date" }) as any;
    if (data?.results) {
      for (const v of data.results) {
        if (v.author_url && !channelUrls.has(v.author_url)) {
          channelUrls.set(v.author_url, v.author || "");
        }
      }
    }
  }

  // Resolve video URLs to channel URLs
  const resolvedChannels = new Map<string, string>();
  for (const [url, name] of channelUrls) {
    if (url.includes("youtube.com/watch")) {
      const vd = await ytExecute("video", { url }) as any;
      if (vd?.author_url && !resolvedChannels.has(vd.author_url)) {
        resolvedChannels.set(vd.author_url, vd.author || name);
      }
    } else {
      if (!resolvedChannels.has(url)) resolvedChannels.set(url, name);
    }
  }

  // --- Phase 2: SIZE GATE ---
  const qualifiedChannels: Array<{ url: string; name: string; subscribers: number; description: string }> = [];
  const channelEntries = Array.from(resolvedChannels.entries()).slice(0, 40);

  for (const [channelUrl, authorName] of channelEntries) {
    const channel = await ytExecute("channel", { channel_url: channelUrl }) as any;
    if (!channel || channel.error) continue;
    const subs = channel.subscribers || 0;
    if (subs < minSubs || subs > maxSubs) continue;
    qualifiedChannels.push({
      url: channelUrl,
      name: channel.name || authorName,
      subscribers: subs,
      description: channel.description || "",
    });
  }

  // --- Phase 3: CONTENT DEPTH ---
  const influencers: InfluencerProfile[] = [];

  for (const ch of qualifiedChannels) {
    // Get 5 recent videos
    const recentSearch = await ytExecute("search", { query: ch.name, sort: "date" }) as any;
    const recentResults = (recentSearch?.results || []).slice(0, 5);

    const videoDetails: Array<{ title: string; views?: number; likes?: number; published?: string }> = [];
    for (const v of recentResults) {
      if (v.url) {
        const vd = await ytExecute("video", { url: v.url }) as any;
        if (vd && !vd.error) {
          videoDetails.push({
            title: vd.title || v.title,
            views: vd.views,
            likes: vd.likes,
            published: vd.published,
          });
        }
      }
    }

    if (videoDetails.length === 0) continue;

    // Calculate content quality metrics
    const views = videoDetails.map(v => v.views || 0).filter(v => v > 0);
    const likes = videoDetails.map(v => v.likes || 0).filter(v => v > 0);
    const avgViews = views.length > 0 ? views.reduce((a, b) => a + b, 0) / views.length : 0;
    const avgLikes = likes.length > 0 ? likes.reduce((a, b) => a + b, 0) / likes.length : 0;

    const viewsPerSub = ch.subscribers > 0 ? avgViews / ch.subscribers : 0;
    const likesPerView = avgViews > 0 ? avgLikes / avgViews : 0;
    const viewConsistency = calcViewConsistency(views);
    const nicheDepth = calcNicheDepth(videoDetails.map(v => v.title), nicheKeywords);

    // Skip GENERALIST channels
    if (nicheDepth === "GENERALIST") continue;

    const contactInfo = extractContactInfo(ch.description);
    const igHandles = parseIgHandles(ch.description);
    const engagementRate = calcEngagement(avgViews, avgLikes, ch.subscribers);
    const nicheMatchPct = calcNicheMatch(
      [ch.description, ...videoDetails.map(v => v.title)],
      nicheKeywords,
    );

    // Brave Search for IG followers
    let igFollowers: number | undefined;
    let igUrl: string | undefined;
    if (igHandles.length > 0) {
      const braveResult = await braveSearch(`"${igHandles[0]}" instagram`, 3) as any;
      if (braveResult?.web?.results) {
        for (const r of braveResult.web.results) {
          const f = parseFollowersFromSnippet(r.description || "");
          if (f) { igFollowers = f; igUrl = `https://instagram.com/${igHandles[0]}`; break; }
        }
      }
    }

    const platformCount = 1 + (igFollowers ? 1 : 0);

    const profile: InfluencerProfile = {
      handle: ch.url.replace("https://www.youtube.com", "") || ch.name,
      name: ch.name,
      youtube_url: ch.url,
      instagram_url: igUrl,
      subscribers: ch.subscribers,
      ig_followers: igFollowers,
      description: ch.description.substring(0, 300),
      engagement_rate: Math.round(engagementRate * 10) / 10,
      avg_views: avgViews ? Math.round(avgViews) : undefined,
      avg_likes: avgLikes ? Math.round(avgLikes) : undefined,
      recent_videos: videoDetails,
      email: contactInfo.email,
      website: contactInfo.website,
      has_business_contact: contactInfo.hasBusiness,
      has_collab_signals: contactInfo.hasCollab,
      niche_match_pct: nicheMatchPct,
      posting_frequency: estimateFrequency(videoDetails),
      niche_depth: nicheDepth,
      views_per_sub: Math.round(viewsPerSub * 1000) / 1000,
      likes_per_view: Math.round(likesPerView * 1000) / 1000,
      view_consistency: viewConsistency,
      platform_count: platformCount,
      scores: { reach: 0, conversion: 0, partnership: 0 },
      tier: "UNRANKED",
    };

    // Custom scoring for content_scout:
    // reach ← Content Quality Score
    // conversion ← Partnership Readiness
    // partnership ← Reach + Authenticity
    const contentScore = calcContentScore(profile);

    // Partnership readiness: email, collab signals, business account, posting frequency
    let partnershipReady = 0;
    if (contactInfo.email) partnershipReady += 30;
    if (contactInfo.hasCollab) partnershipReady += 20;
    if (contactInfo.hasBusiness) partnershipReady += 15;
    if (profile.posting_frequency === "weekly") partnershipReady += 20;
    else if (profile.posting_frequency === "biweekly") partnershipReady += 10;
    if (igFollowers) partnershipReady += 15;

    // Reach + Authenticity: audience size, multi-platform, views/subs sanity
    let reachAuth = 0;
    if (ch.subscribers >= 10_000) reachAuth += 25;
    else if (ch.subscribers >= 1_000) reachAuth += 15;
    else reachAuth += 5;
    if (platformCount >= 2) reachAuth += 20;
    if (viewsPerSub >= 0.15) reachAuth += 25;
    else if (viewsPerSub >= 0.05) reachAuth += 15;
    reachAuth += Math.round(viewConsistency / 100 * 30);

    profile.scores = {
      reach: Math.min(100, contentScore),
      conversion: Math.min(100, partnershipReady),
      partnership: Math.min(100, reachAuth),
    };
    profile.tier = classifyTier(profile.scores, input.threshold ?? config.threshold ?? 60);
    influencers.push(profile);
  }

  // --- Phase 4: IG ENRICHMENT (top 5 only) ---
  const sorted = [...influencers].sort((a, b) => {
    const scoreA = (a.scores.reach + a.scores.conversion + a.scores.partnership) / 3;
    const scoreB = (b.scores.reach + b.scores.conversion + b.scores.partnership) / 3;
    return scoreB - scoreA;
  });

  let igCallsUsed = 0;
  for (const profile of sorted) {
    if (igCallsUsed >= igMaxCalls) break;
    const igHandle = profile.instagram_url?.replace("https://instagram.com/", "");
    if (!igHandle) continue;

    try {
      const igData = await igExecute("profile", { username: igHandle }) as any;
      if (igData && !igData.error) {
        if (igData.followers !== undefined) profile.ig_followers = igData.followers;
        if (igData.engagement_rate !== undefined) profile.ig_engagement_rate = igData.engagement_rate;
        if (igData.posts_count !== undefined) profile.ig_posts_count = igData.posts_count;
        if (igData.business_email) profile.email = profile.email || igData.business_email;
        profile.platform_count = Math.max(profile.platform_count, 2);
      }
    } catch {
      // IG enrichment is bonus — skip on failure
    }
    igCallsUsed++;
  }

  return influencers;
}

// --- Main influencer discovery dispatcher ---

async function runInfluencerDiscovery(
  config: InfluencerDiscoverySkillConfig,
  input: RunSkillInput,
) {
  let influencers: InfluencerProfile[];

  switch (config.workflow) {
    case "niche_discovery":
      influencers = await runNicheDiscovery(config, input);
      break;
    case "hashtag_scout":
      influencers = await runHashtagScout(config, input);
      break;
    case "competitor_spy":
      influencers = await runCompetitorSpy(config, input);
      break;
    case "content_scout":
      influencers = await runContentScout(config, input);
      break;
    default:
      return toolResult({ error: `Unknown influencer discovery workflow: ${(config as any).workflow}` });
  }

  const outputFormat = input.output_format ?? config.output_format ?? "json";
  const threshold = input.threshold ?? config.threshold ?? 60;
  const data = formatInfluencerOutput(influencers, outputFormat, {
    workflow: config.workflow,
    niche: input.niche || config.niche,
    threshold,
  });

  if (typeof data === "string") {
    return { content: [{ type: "text" as const, text: data }] };
  }
  return toolResult(data);
}

// --- Main execute ---

export async function execute(input: RunSkillInput) {
  // Load with recipe fallback
  const config = await manager.loadWithRecipes(input.name);
  if (!config) {
    const skills = await manager.listAll();
    return toolResult({
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
    case "influencer_discovery":
      return runInfluencerDiscovery(config as InfluencerDiscoverySkillConfig, input);
    default:
      return toolResult({ error: `Unknown skill tool type: ${tool}` });
  }
}
