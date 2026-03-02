import * as cheerio from "cheerio";

export interface StructuredData {
  jsonLd: object[];
  openGraph: Record<string, string>;
  twitterCards: Record<string, string>;
  microdata: object[];
  meta: {
    title: string;
    description: string;
    canonical: string;
    language: string;
    author: string;
  };
}

function extractJsonLd($: cheerio.CheerioAPI): object[] {
  const results: object[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const text = $(el).html();
      if (!text) return;
      const parsed = JSON.parse(text);
      // Handle arrays of JSON-LD objects
      if (Array.isArray(parsed)) {
        results.push(...parsed);
      } else {
        results.push(parsed);
      }
    } catch {
      // Malformed JSON-LD, skip
    }
  });
  return results;
}

function extractMetaTags($: cheerio.CheerioAPI, prefix: string): Record<string, string> {
  const data: Record<string, string> = {};
  // Try both property and name attributes (OG uses property, Twitter uses name)
  $(`meta[property^="${prefix}"], meta[name^="${prefix}"]`).each((_, el) => {
    const key = $(el).attr("property") || $(el).attr("name") || "";
    const value = $(el).attr("content") || "";
    if (key && value) {
      data[key] = value;
    }
  });
  return data;
}

function extractMicrodata($: cheerio.CheerioAPI): object[] {
  const items: object[] = [];
  $("[itemscope]").each((_, el) => {
    const $el = $(el);
    // Skip nested itemscopes (they'll be included in parent)
    if ($el.parents("[itemscope]").length > 0) return;

    const item: Record<string, string | string[]> = {};
    const itemType = $el.attr("itemtype");
    if (itemType) item["@type"] = itemType;

    $el.find("[itemprop]").each((_, prop) => {
      const $prop = $(prop);
      const name = $prop.attr("itemprop");
      if (!name) return;

      let value: string;
      if ($prop.is("meta")) {
        value = $prop.attr("content") || "";
      } else if ($prop.is("a, link")) {
        value = $prop.attr("href") || "";
      } else if ($prop.is("img")) {
        value = $prop.attr("src") || "";
      } else if ($prop.is("time")) {
        value = $prop.attr("datetime") || $prop.text().trim();
      } else {
        value = $prop.text().trim();
      }

      if (value) {
        const existing = item[name];
        if (existing) {
          item[name] = Array.isArray(existing) ? [...existing, value] : [existing, value];
        } else {
          item[name] = value;
        }
      }
    });

    if (Object.keys(item).length > (itemType ? 1 : 0)) {
      items.push(item);
    }
  });
  return items;
}

function extractPageMeta($: cheerio.CheerioAPI): StructuredData["meta"] {
  return {
    title: $("title").first().text().trim(),
    description: $('meta[name="description"]').attr("content") || "",
    canonical: $('link[rel="canonical"]').attr("href") || "",
    language: $("html").attr("lang") || "",
    author: $('meta[name="author"]').attr("content") || "",
  };
}

export function extractStructuredData(html: string): StructuredData {
  const $ = cheerio.load(html);
  return {
    jsonLd: extractJsonLd($),
    openGraph: extractMetaTags($, "og:"),
    twitterCards: extractMetaTags($, "twitter:"),
    microdata: extractMicrodata($),
    meta: extractPageMeta($),
  };
}

export function extractLinks($: cheerio.CheerioAPI, baseUrl: string): string[] {
  const links: string[] = [];
  const seen = new Set<string>();
  $("a[href]").each((_, el) => {
    try {
      const href = $(el).attr("href");
      if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:")) return;
      const absolute = new URL(href, baseUrl).toString();
      if (!seen.has(absolute)) {
        seen.add(absolute);
        links.push(absolute);
      }
    } catch {
      // Invalid URL
    }
  });
  return links;
}
