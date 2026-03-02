import { z } from "zod";
import * as cheerio from "cheerio";
import { fetchPage } from "../utils/fetcher.js";
import { normalizeUrl } from "../utils/url.js";
import { detectPatterns, detectPagination } from "../skills/detector.js";
import * as manager from "../skills/manager.js";

export const name = "create_skill";

export const description =
  "Analyze a web page and create a reusable skill for extracting structured data. The skill can be re-run later with run_skill to get fresh content instantly.";

export const schema = z.object({
  url: z.string().describe("The URL to analyze for repeating patterns"),
  name: z.string().describe("Unique name for this skill (e.g. 'tc-ai-news')"),
  description: z.string().describe("What this skill extracts (e.g. 'Latest AI news from TechCrunch')"),
  max_pages: z.number().default(3).describe("Max pagination pages to follow"),
});

export type CreateSkillInput = z.infer<typeof schema>;

export async function execute(input: CreateSkillInput) {
  const url = normalizeUrl(input.url);

  // 1. Scrape the page
  const result = await fetchPage(url);
  const $ = cheerio.load(result.html);

  // 2. Detect repeating patterns
  const patterns = detectPatterns(result.html);
  if (patterns.length === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              error: "No repeating patterns found on this page. Try a page with lists of items (articles, products, etc.)",
              url: result.url,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  // 3. Use the best pattern
  const best = patterns[0];

  // 4. Detect pagination
  const paginationSelector = detectPagination($);

  // 5. Create skill config
  const config: manager.SkillConfig = {
    name: input.name,
    description: input.description,
    url,
    created_at: new Date().toISOString().split("T")[0],
    selectors: {
      items: best.items_selector,
      fields: best.fields,
    },
    output_format: "list",
    pagination: paginationSelector
      ? { next: paginationSelector, max_pages: input.max_pages }
      : undefined,
  };

  // 6. Verify by extracting preview data
  const preview: Record<string, string>[] = [];
  $(best.items_selector)
    .slice(0, 3)
    .each((_, el) => {
      const item: Record<string, string> = {};
      for (const [field, selectorRaw] of Object.entries(best.fields)) {
        const parts = selectorRaw.split(" @");
        const selector = parts[0].trim();
        const attr = parts[1]?.trim();
        const target = selector ? $(el).find(selector) : $(el);
        item[field] = attr ? target.attr(attr) || "" : target.text().trim();
      }
      preview.push(item);
    });

  if (preview.length === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              error: "Detected patterns but could not extract data. The page structure may be too complex.",
              patterns_found: patterns.length,
              best_pattern: best.items_selector,
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  // 7. Save
  await manager.save(input.name, config);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            success: true,
            skill: {
              name: config.name,
              description: config.description,
              url: config.url,
              items_selector: config.selectors.items,
              fields: Object.keys(config.selectors.fields),
              pagination: !!config.pagination,
            },
            preview_items: preview,
            total_items_on_page: $(best.items_selector).length,
            alternative_patterns: patterns.slice(1, 4).map((p) => ({
              selector: p.items_selector,
              fields: Object.keys(p.fields),
              count: p.count,
            })),
          },
          null,
          2,
        ),
      },
    ],
  };
}
