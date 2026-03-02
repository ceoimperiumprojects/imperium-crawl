import { z } from "zod";
import { fetchPage } from "../utils/fetcher.js";
import { normalizeUrl } from "../utils/url.js";
import { MAX_URL_LENGTH, MAX_SELECTOR_LENGTH, MAX_SELECTOR_KEYS } from "../constants.js";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

export const name = "extract";

export const description =
  "Extract structured data from a web page using CSS selectors. Returns JSON with the extracted fields.";

export const schema = z.object({
  url: z.string().max(MAX_URL_LENGTH).describe("The URL to extract data from"),
  selectors: z.preprocess(
    (val) => (typeof val === "string" ? JSON.parse(val) : val),
    z
      .record(z.string().max(MAX_SELECTOR_LENGTH))
      .refine((obj) => Object.keys(obj).length <= MAX_SELECTOR_KEYS, {
        message: `Too many selectors (max ${MAX_SELECTOR_KEYS})`,
      }),
  ).describe("Map of field names to CSS selectors. Use @attr suffix to extract attributes (e.g. 'a @href')"),
  items_selector: z
    .string()
    .max(MAX_SELECTOR_LENGTH)
    .optional()
    .describe("CSS selector for repeating items. Each item will have fields extracted."),
  proxy: z.string().max(MAX_URL_LENGTH).optional().describe("Proxy URL (http/https/socks4/socks5). Overrides PROXY_URL env var."),
  chrome_profile: z.string().max(1000).optional().describe("Path to Chrome user data directory for authenticated sessions (cookies, localStorage). Overrides CHROME_PROFILE_PATH env var."),
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
  const result = await fetchPage(url, { proxy: input.proxy, chromeProfile: input.chrome_profile });
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
