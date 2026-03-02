import { z } from "zod";
import { fetchPage } from "../utils/fetcher.js";
import { normalizeUrl, isSameOrigin } from "../utils/url.js";
import { getSitemapUrls } from "../utils/robots.js";
import * as cheerio from "cheerio";

export const name = "map";

export const description =
  "Discover all URLs on a website by parsing sitemap.xml and crawling links. Returns a list of discovered URLs.";

export const schema = z.object({
  url: z.string().describe("The website URL to map"),
  max_urls: z.number().default(100).describe("Maximum number of URLs to return"),
  include_sitemap: z.boolean().default(true).describe("Parse sitemap.xml"),
});

export type MapInput = z.infer<typeof schema>;

async function parseSitemap(sitemapUrl: string): Promise<string[]> {
  try {
    const result = await fetchPage(sitemapUrl, { maxLevel: 1 });
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
      const urls = await parseSitemap(sitemap);
      for (const url of urls) {
        if (discovered.size >= input.max_urls) break;
        discovered.add(url);
      }
    }
  }

  // 2. Crawl page for links
  try {
    const result = await fetchPage(baseUrl);
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
