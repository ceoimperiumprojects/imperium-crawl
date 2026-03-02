import { z } from "zod";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { fetchPage } from "../utils/fetcher.js";
import * as manager from "../skills/manager.js";

export const name = "run_skill";

export const description =
  "Run a previously created skill to extract fresh structured data from its URL.";

export const schema = z.object({
  name: z.string().describe("The skill name to run"),
  url: z.string().optional().describe("Override the skill's default URL"),
  max_items: z.number().default(50).describe("Maximum items to return"),
});

export type RunSkillInput = z.infer<typeof schema>;

function extractField(
  $: cheerio.CheerioAPI,
  el: cheerio.Cheerio<AnyNode>,
  selectorRaw: string,
): string {
  const parts = selectorRaw.split(" @");
  const selector = parts[0].trim();
  const attr = parts[1]?.trim();
  const target = selector ? el.find(selector) : el;
  return attr ? target.attr(attr) || "" : target.text().trim();
}

export async function execute(input: RunSkillInput) {
  const config = await manager.load(input.name);
  if (!config) {
    const skills = await manager.list();
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              error: `Skill '${input.name}' not found.`,
              available_skills: skills.map((s) => s.name),
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  const url = input.url || config.url;
  const allItems: Record<string, string>[] = [];
  let currentUrl = url;
  let page = 0;
  const maxPages = config.pagination?.max_pages || 1;

  while (page < maxPages && allItems.length < input.max_items) {
    const result = await fetchPage(currentUrl);
    const $ = cheerio.load(result.html);

    $(config.selectors.items).each((_, el) => {
      if (allItems.length >= input.max_items) return;
      const item: Record<string, string> = {};
      for (const [field, selector] of Object.entries(config.selectors.fields)) {
        item[field] = extractField($, $(el), selector);
      }
      // Skip empty items
      const hasContent = Object.values(item).some((v) => v.length > 0);
      if (hasContent) allItems.push(item);
    });

    // Check for next page
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

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            skill: config.name,
            description: config.description,
            url,
            items_count: allItems.length,
            pages_fetched: page + 1,
            items: allItems,
          },
          null,
          2,
        ),
      },
    ],
  };
}
