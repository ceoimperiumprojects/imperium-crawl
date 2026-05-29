import { z } from "zod";
import { issueRequest } from "../brave-api/index.js";
import { hasBraveApiKey } from "../core/config.js";
import { MAX_QUERY_LENGTH } from "../core/constants.js";
import { toolResult, errorResult } from "../utils/tool-response.js";
import { browserFetch } from "../stealth/browser.js";
import * as cheerio from "cheerio";

export const name = "search";

export const description = "Search the web using Brave Search API (fallback to DuckDuckGo if Brave API key is missing or fails).";

export const schema = z.object({
  query: z.string().min(1).max(MAX_QUERY_LENGTH).describe("Search query"),
  count: z.number().min(1).max(20).default(10).describe("Number of results"),
  country: z.string().max(10).optional().describe("Country code (e.g. 'US', 'GB')"),
  freshness: z
    .enum(["pd", "pw", "pm", "py"])
    .optional()
    .describe("Freshness: pd=past day, pw=past week, pm=past month, py=past year"),
});

export type SearchInput = z.infer<typeof schema>;

export async function execute(input: SearchInput) {
  if (hasBraveApiKey()) {
    try {
      const data = await issueRequest(process.env.BRAVE_API_KEY!, "/web/search", {
        q: input.query,
        count: input.count,
        country: input.country,
        freshness: input.freshness,
      });
      return toolResult(data);
    } catch (err) {
      console.warn("Brave Search API failed, falling back to DuckDuckGo:", err);
    }
  }

  // Fallback to DuckDuckGo HTML
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(input.query)}`;
    const fetchResult = await browserFetch(url, { screenshot: false });
    
    const $ = cheerio.load(fetchResult.html);
    const results: Array<{ title: string; url: string; description: string }> = [];
    
    $(".result__body").each((_, el) => {
      const titleEl = $(el).find(".result__title .result__a");
      const title = titleEl.text().trim();
      const link = titleEl.attr("href");
      const snippet = $(el).find(".result__snippet").text().trim();
      
      if (title && link) {
        let cleanLink = link;
        if (link.includes("uddg=")) {
          const part = link.split("uddg=")[1];
          if (part) {
            cleanLink = decodeURIComponent(part.split("&")[0]);
          }
        }
        results.push({ title, url: cleanLink, description: snippet });
      }
    });

    return toolResult({
      web: {
        results: results.slice(0, input.count),
      },
    });
  } catch (err) {
    return errorResult(`Search failed. Brave API error and DDG fallback failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

