import robotsParser from "robots-parser";
import { DEFAULT_ROBOTS_CACHE_TTL_MS } from "../constants.js";
import { getBaseUrl } from "./url.js";

interface Robot {
  isAllowed(url: string, ua?: string): boolean | undefined;
  getSitemaps(): string[];
}

interface CacheEntry {
  parser: Robot;
  sitemaps: string[];
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();

function createParser(url: string, text: string): Robot {
  return (robotsParser as any)(url, text) as Robot;
}

async function fetchRobotsTxt(baseUrl: string): Promise<CacheEntry> {
  const robotsUrl = `${baseUrl}/robots.txt`;
  try {
    const res = await fetch(robotsUrl, { signal: AbortSignal.timeout(5000) });
    const text = res.ok ? await res.text() : "";
    const parser = createParser(robotsUrl, text);
    const sitemaps = parser.getSitemaps();
    const entry: CacheEntry = { parser, sitemaps, timestamp: Date.now() };
    cache.set(baseUrl, entry);
    return entry;
  } catch {
    const parser = createParser(robotsUrl, "");
    const entry: CacheEntry = { parser, sitemaps: [], timestamp: Date.now() };
    cache.set(baseUrl, entry);
    return entry;
  }
}

async function getEntry(url: string): Promise<CacheEntry> {
  const base = getBaseUrl(url);
  const cached = cache.get(base);
  if (cached && Date.now() - cached.timestamp < DEFAULT_ROBOTS_CACHE_TTL_MS) {
    return cached;
  }
  return fetchRobotsTxt(base);
}

export async function isAllowed(url: string, userAgent = "*"): Promise<boolean> {
  const entry = await getEntry(url);
  return entry.parser.isAllowed(url, userAgent) ?? true;
}

export async function getSitemapUrls(url: string): Promise<string[]> {
  const entry = await getEntry(url);
  return entry.sitemaps;
}
