import { z } from "zod";
import { fetchPage } from "../utils/fetcher.js";
import { normalizeUrl, isSameOrigin } from "../utils/url.js";
import { getSitemapUrls } from "../utils/robots.js";
import { MAX_URL_LENGTH, MAX_URLS } from "../constants.js";
import * as cheerio from "cheerio";

export const name = "map";

export const description =
  "Discover all URLs on a website by parsing sitemap.xml and crawling links. Returns a list of discovered URLs.";

export const schema = z.object({
  url: z.string().max(MAX_URL_LENGTH).describe("The website URL to map"),
  max_urls: z.number().min(1).max(MAX_URLS).default(100).describe("Maximum number of URLs to return"),
  include_sitemap: z.boolean().default(true).describe("Parse sitemap.xml"),
  proxy: z.string().max(MAX_URL_LENGTH).optional().describe("Proxy URL (http/https/socks4/socks5). Overrides PROXY_URL env var."),
  chrome_profile: z.string().max(1000).optional().describe("Path to Chrome user data directory for authenticated sessions (cookies, localStorage). Overrides CHROME_PROFILE_PATH env var."),
});

export type MapInput = z.infer<typeof schema>;

async function parseSitemap(sitemapUrl: string, proxy?: string, chromeProfile?: string): Promise<string[]> {
  try {
    const result = await fetchPage(sitemapUrl, { maxLevel: 1, proxy, chromeProfile });
    const $ = cheerio.load(result.html, { xmlMode: true });
    const urls: string[] = [];

    // Standard sitemap
    $("url > loc").each((_, el) => {
      urls.push($(el).text().trim());
    });

    // Sitemap index
    $("sitemap > loc").each((_, el) => {
      urls.push($(el).text().trim());
    });

    return urls;
  } catch {
    return [];
  }
}

export async function execute(input: MapInput) {
  const baseUrl = normalizeUrl(input.url);
  const discovered = new Set<string>();

  // 1. Try sitemap.xml
  if (input.include_sitemap) {
    const sitemapUrls = await getSitemapUrls(baseUrl);
    const defaultSitemap = `${new URL(baseUrl).origin}/sitemap.xml`;

    const sitemaps = sitemapUrls.length > 0 ? sitemapUrls : [defaultSitemap];

    for (const sitemap of sitemaps) {
      if (discovered.size >= input.max_urls) break;
      const urls = await parseSitemap(sitemap, input.proxy, input.chrome_profile);
      for (const url of urls) {
        if (discovered.size >= input.max_urls) break;
        discovered.add(url);
      }
    }
  }

  // 2. Crawl page for links
  try {
    const result = await fetchPage(baseUrl, { proxy: input.proxy, chromeProfile: input.chrome_profile });
    const $ = cheerio.load(result.html);
    $("a[href]").each((_, el) => {
      if (discovered.size >= input.max_urls) return;
      try {
        const href = $(el).attr("href");
        if (!href) return;
        const absoluteUrl = normalizeUrl(new URL(href, baseUrl).toString());
        if (isSameOrigin(baseUrl, absoluteUrl)) {
          discovered.add(absoluteUrl);
        }
      } catch {
        // Invalid URL
      }
    });
  } catch {
    // Failed to fetch page
  }

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            total_urls: discovered.size,
            urls: [...discovered],
          },
          null,
          2,
        ),
      },
    ],
  };
}
