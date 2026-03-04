import type { Company, CareersDiscoveryResult } from "./types.js";
import {
  CAREERS_PATHS,
  CAREERS_URL_PATTERNS,
  CAREERS_ANCHOR_PATTERNS,
  JOB_BOARD_DOMAINS,
  COMMON_PATH_TIMEOUT_MS,
} from "./config.js";
import { smartFetch } from "../../src/stealth/index.js";
import { execute as mapExecute } from "../../src/tools/map.js";
import { execute as scrapeExecute } from "../../src/tools/scrape.js";

// ── Strategy A: Common Paths ──────────────────────────────────

async function tryCommonPaths(baseUrl: string): Promise<string | null> {
  const base = baseUrl.replace(/\/+$/, "");

  for (const pathStr of CAREERS_PATHS) {
    const url = base + pathStr;
    try {
      const result = await smartFetch(url, {
        maxLevel: 1,
        timeout: COMMON_PATH_TIMEOUT_MS,
      });

      // 2xx and reasonable content length = found
      if (result.status >= 200 && result.status < 300 && result.html.length > 500) {
        // Quick sanity check: does the page mention careers/jobs?
        const lower = result.html.toLowerCase();
        if (
          lower.includes("career") ||
          lower.includes("job") ||
          lower.includes("position") ||
          lower.includes("opening") ||
          lower.includes("hiring") ||
          lower.includes("role")
        ) {
          return url;
        }
      }
    } catch {
      // Timeout, 404, network error — skip
    }
  }
  return null;
}

// ── Strategy B: Sitemap Filter ────────────────────────────────

async function trySitemap(baseUrl: string): Promise<string | null> {
  try {
    const result = await mapExecute({
      url: baseUrl,
      max_urls: 200,
      include_sitemap: true,
    });

    const text = result.content[0].text;
    const parsed = JSON.parse(text) as { urls?: string[] };
    const urls = parsed.urls ?? [];

    // Check for job board platform redirects first
    for (const u of urls) {
      if (JOB_BOARD_DOMAINS.some((d) => u.includes(d))) {
        return u;
      }
    }

    // Check for careers path patterns
    for (const u of urls) {
      if (CAREERS_URL_PATTERNS.some((p) => p.test(u))) {
        return u;
      }
    }
  } catch {
    // Sitemap unavailable
  }
  return null;
}

// ── Strategy C: Homepage Link Scan ────────────────────────────

async function tryHomepageLinks(baseUrl: string): Promise<string | null> {
  try {
    const result = await scrapeExecute({
      url: baseUrl,
      format: "markdown",
      include: ["links"],
    });

    const text = result.content[0].text;
    const parsed = JSON.parse(text) as {
      links?: Array<{ href: string; text: string }>;
    };
    const links = parsed.links ?? [];

    // Priority: job board domains
    for (const link of links) {
      if (JOB_BOARD_DOMAINS.some((d) => link.href.includes(d))) {
        return link.href;
      }
    }

    // Check URL patterns
    for (const link of links) {
      if (CAREERS_URL_PATTERNS.some((p) => p.test(link.href))) {
        return link.href;
      }
    }

    // Check anchor text
    for (const link of links) {
      if (CAREERS_ANCHOR_PATTERNS.some((p) => p.test(link.text))) {
        return link.href;
      }
    }
  } catch {
    // Scrape failed
  }
  return null;
}

// ── Main: 3-Strategy Cascade ──────────────────────────────────

export async function findCareersUrl(
  company: Company,
): Promise<CareersDiscoveryResult> {
  const base: Omit<CareersDiscoveryResult, "careersUrl" | "strategy"> = {
    companyId: company.id,
    companyName: company.name,
    companyUrl: company.url,
    timestamp: new Date().toISOString(),
  };

  // Strategy A: Common paths (fastest — Level 1 only)
  const fromPaths = await tryCommonPaths(company.url);
  if (fromPaths) {
    return { ...base, careersUrl: fromPaths, strategy: "common-paths" };
  }

  // Strategy B: Sitemap
  const fromSitemap = await trySitemap(company.url);
  if (fromSitemap) {
    return { ...base, careersUrl: fromSitemap, strategy: "sitemap" };
  }

  // Strategy C: Homepage links
  const fromLinks = await tryHomepageLinks(company.url);
  if (fromLinks) {
    return { ...base, careersUrl: fromLinks, strategy: "homepage-links" };
  }

  // Nothing found
  return { ...base, careersUrl: null, strategy: null };
}
