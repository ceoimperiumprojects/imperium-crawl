import { z } from "zod";
import { fetchPage } from "../utils/fetcher.js";
import { normalizeUrl } from "../utils/url.js";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

export const name = "extract";

export const description =
  "Extract structured data from a web page using CSS selectors. Returns JSON with the extracted fields.";

export const schema = z.object({
  url: z.string().describe("The URL to extract data from"),
  selectors: z
    .record(z.string())
    .describe("Map of field names to CSS selectors. Use @attr suffix to extract attributes (e.g. 'a @href')"),
  items_selector: z
    .string()
    .optional()
    .describe("CSS selector for repeating items. Each item will have fields extracted."),
});

export type ExtractInput = z.infer<typeof schema>;

function extractField($: cheerio.CheerioAPI, el: cheerio.Cheerio<AnyNode>, selectorRaw: string): string {
  const parts = selectorRaw.split(" @");
  const selector = parts[0].trim();
  const attr = parts[1]?.trim();

  const target = selector ? el.find(selector) : el;
  if (attr) {
    return target.attr(attr) || "";
  }
  return target.text().trim();
}

export async function execute(input: ExtractInput) {
  const url = normalizeUrl(input.url);
  const result = await fetchPage(url);
  const $ = cheerio.load(result.html);

  if (input.items_selector) {
    // Extract list of items
    const items: Record<string, string>[] = [];
    $(input.items_selector).each((_, el) => {
      const item: Record<string, string> = {};
      for (const [field, selector] of Object.entries(input.selectors)) {
        item[field] = extractField($, $(el), selector);
      }
      items.push(item);
    });

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ url: result.url, items_count: items.length, items }, null, 2),
        },
      ],
    };
  }

  // Extract single values
  const data: Record<string, string> = {};
  for (const [field, selectorRaw] of Object.entries(input.selectors)) {
    const parts = selectorRaw.split(" @");
    const selector = parts[0].trim();
    const attr = parts[1]?.trim();

    if (attr) {
      data[field] = $(selector).attr(attr) || "";
    } else {
      data[field] = $(selector).text().trim();
    }
  }

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ url: result.url, data }, null, 2),
      },
    ],
  };
}
