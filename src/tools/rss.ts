import { z } from "zod";
import RSSParser from "rss-parser";
import { MAX_URL_LENGTH } from "../constants.js";
import { toolResult, errorResult } from "../utils/tool-response.js";
import { debugLog } from "../utils/debug.js";

export const name = "rss";

export const description =
  "Fetch and parse RSS/Atom feeds. Returns structured items with title, link, date, author, content, and categories.";

export const schema = z.object({
  url: z.string().max(MAX_URL_LENGTH).describe("RSS/Atom feed URL"),
  limit: z.number().min(1).max(100).default(20).describe("Max items to return"),
  format: z.enum(["json", "markdown"]).default("json").describe("Output format"),
  since: z
    .string()
    .optional()
    .describe("Only return items published after this date (YYYY-MM-DD)"),
});

export type RssInput = z.infer<typeof schema>;

interface FeedItem {
  title: string;
  link: string;
  date?: string;
  author?: string;
  summary?: string;
  categories?: string[];
  image?: string;
}

function extractImage(item: RSSParser.Item & Record<string, unknown>): string | undefined {
  // Enclosure (podcasts, media feeds)
  if (item.enclosure?.url && /image|jpg|jpeg|png|webp/i.test(item.enclosure.type || item.enclosure.url)) {
    return item.enclosure.url;
  }
  // media:content or media:thumbnail (common RSS extension)
  const media = item["media:content"] as Record<string, unknown> | undefined;
  if (media && typeof media === "object") {
    const url = (media as any).$?.url || (media as any).url;
    if (url) return url;
  }
  const thumb = item["media:thumbnail"] as Record<string, unknown> | undefined;
  if (thumb && typeof thumb === "object") {
    const url = (thumb as any).$?.url || (thumb as any).url;
    if (url) return url;
  }
  // og:image from content snippet
  const content = item["content:encoded"] || item.content || "";
  if (typeof content === "string") {
    const match = content.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (match) return match[1];
  }
  return undefined;
}

function toMarkdown(feed: { title?: string; link?: string }, items: FeedItem[]): string {
  const lines: string[] = [];
  if (feed.title) lines.push(`# ${feed.title}\n`);
  if (feed.link) lines.push(`Source: ${feed.link}\n`);

  for (const item of items) {
    lines.push(`## ${item.title}`);
    lines.push(`- Link: ${item.link}`);
    if (item.date) lines.push(`- Date: ${item.date}`);
    if (item.author) lines.push(`- Author: ${item.author}`);
    if (item.categories?.length) lines.push(`- Categories: ${item.categories.join(", ")}`);
    if (item.image) lines.push(`- Image: ${item.image}`);
    if (item.summary) lines.push(`\n${item.summary}`);
    lines.push("");
  }

  return lines.join("\n");
}

export async function execute(input: RssInput) {
  try {
    const parser = new RSSParser({
      timeout: 15_000,
      customFields: {
        item: [
          ["media:content", "media:content"],
          ["media:thumbnail", "media:thumbnail"],
        ],
      },
    });

    const feed = await parser.parseURL(input.url);

    let items = (feed.items || []).map((item) => {
      const fi: FeedItem = {
        title: item.title || "(untitled)",
        link: item.link || "",
        date: item.isoDate || item.pubDate,
        author: item.creator,
        summary: (item.contentSnippet || item.content || "").substring(0, 500),
        categories: item.categories,
        image: extractImage(item as unknown as RSSParser.Item & Record<string, unknown>),
      };
      return fi;
    });

    // Filter by --since
    if (input.since) {
      const sinceDate = new Date(input.since);
      if (!isNaN(sinceDate.getTime())) {
        items = items.filter((item) => {
          if (!item.date) return true;
          return new Date(item.date) >= sinceDate;
        });
      }
    }

    items = items.slice(0, input.limit);

    if (input.format === "markdown") {
      return toolResult(toMarkdown({ title: feed.title, link: feed.link }, items));
    }

    return toolResult({
      feed: {
        title: feed.title,
        link: feed.link,
        description: feed.description,
        language: feed.language,
        last_updated: feed.lastBuildDate,
      },
      items_count: items.length,
      items,
    });
  } catch (err) {
    debugLog("rss", "feed parse failed", err);
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}
