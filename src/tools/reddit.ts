import { z } from "zod";
import { smartFetch } from "../stealth/index.js";
import { MAX_QUERY_LENGTH, MAX_ITEMS } from "../constants.js";
import { sanitizeText } from "../social/parsers.js";
import { socialAiFallback } from "../social/ai-fallback.js";
import type { SocialPost, SocialComment, SocialProfile, SocialSearchResult } from "../social/types.js";

export const name = "reddit";

export const description =
  "Search Reddit, browse subreddits, get posts and comments. No API key needed.";

const ActionEnum = z.enum(["search", "posts", "comments", "subreddit"]);

export const schema = z.object({
  action: ActionEnum.describe("Action to perform"),
  query: z.string().max(MAX_QUERY_LENGTH).optional().describe("Search query (for action: search)"),
  subreddit: z.string().max(200).optional().describe("Subreddit name without r/ (for action: posts, subreddit)"),
  post_url: z.string().max(8192).optional().describe("Full Reddit post URL (for action: comments)"),
  sort: z.enum(["hot", "new", "top", "rising"]).default("hot").describe("Sort order"),
  time: z.enum(["hour", "day", "week", "month", "year", "all"]).default("week").describe("Time filter (for sort: top)"),
  limit: z.number().min(1).max(MAX_ITEMS).default(25).describe("Max results to return"),
});

export type RedditInput = z.infer<typeof schema>;

// ── Reddit JSON API Helpers ──

const REDDIT_BASE = "https://www.reddit.com";
const OLD_REDDIT = "https://old.reddit.com"; // Server-rendered, better for AI fallback

async function redditJson(path: string): Promise<unknown> {
  // Reddit public JSON: append .json to any URL
  const separator = path.includes("?") ? "&" : "?";
  const url = `${REDDIT_BASE}${path}${separator}raw_json=1`;

  const result = await smartFetch(url, { maxLevel: 2 });

  // Reddit returns JSON directly
  try {
    return JSON.parse(result.html);
  } catch {
    throw new Error(`Failed to parse Reddit JSON from ${path}`);
  }
}

function mapPost(post: any): SocialPost {
  const d = post?.data || post;
  return {
    id: d.id || d.name || "",
    title: d.title || "",
    url: d.permalink ? `${REDDIT_BASE}${d.permalink}` : "",
    author: d.author || "[deleted]",
    score: d.score ?? 0,
    comments_count: d.num_comments ?? 0,
    published: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : undefined,
    subreddit: d.subreddit || undefined,
    text: d.selftext ? d.selftext.substring(0, 2000) : undefined,
    thumbnail: d.thumbnail && d.thumbnail !== "self" && d.thumbnail !== "default" ? d.thumbnail : undefined,
    is_video: d.is_video || false,
    flair: d.link_flair_text || undefined,
  };
}

function mapComment(comment: any, depth = 0): SocialComment {
  const d = comment?.data || comment;
  return {
    id: d.id || d.name || "",
    author: d.author || "[deleted]",
    text: sanitizeText(d.body_html || "") || d.body || "",
    score: d.score ?? 0,
    published: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : undefined,
    replies_count: d.replies?.data?.children?.length ?? 0,
  };
}

// ── Actions ──

async function searchReddit(query: string, sort: string, time: string, limit: number): Promise<SocialSearchResult<SocialPost>> {
  const encoded = encodeURIComponent(query);
  try {
    const data = await redditJson(`/search.json?q=${encoded}&sort=${sort}&t=${time}&limit=${limit}`);
    const children = (data as any)?.data?.children || [];
    const posts = children.map(mapPost).slice(0, limit);
    return { query, platform: "reddit", results: posts, total: (data as any)?.data?.dist };
  } catch {
    const fb = await socialAiFallback<SocialSearchResult<SocialPost>>({ action: "reddit:search", url: `${OLD_REDDIT}/search?q=${encoded}&sort=${sort}&t=${time}` });
    if (fb?.data?.results) return { query, platform: "reddit", results: fb.data.results.slice(0, limit) };
    throw new Error("Reddit search failed and AI fallback unavailable");
  }
}

async function getPosts(subreddit: string, sort: string, time: string, limit: number): Promise<SocialSearchResult<SocialPost>> {
  try {
    const path = `/r/${subreddit}/${sort}.json?t=${time}&limit=${limit}`;
    const data = await redditJson(path);
    const children = (data as any)?.data?.children || [];
    const posts = children.map(mapPost).slice(0, limit);
    return { platform: "reddit", results: posts, total: (data as any)?.data?.dist };
  } catch {
    const fb = await socialAiFallback<SocialSearchResult<SocialPost>>({ action: "reddit:posts", url: `${OLD_REDDIT}/r/${subreddit}/${sort}?t=${time}` });
    if (fb?.data?.results) return { platform: "reddit", results: fb.data.results.slice(0, limit) };
    throw new Error("Reddit posts fetch failed and AI fallback unavailable");
  }
}

async function getComments(postUrl: string, limit: number): Promise<{ post: SocialPost; comments: SocialComment[] }> {
  // Extract path from URL
  let path: string;
  try {
    const url = new URL(postUrl.startsWith("http") ? postUrl : `https://reddit.com${postUrl}`);
    path = url.pathname;
  } catch {
    path = postUrl;
  }
  if (!path.endsWith("/")) path += "/";

  try {
    const data = await redditJson(`${path}.json?limit=${limit}`);
    const listings = Array.isArray(data) ? data : [data];
    const postData = listings[0]?.data?.children?.[0];
    const post = postData ? mapPost(postData) : { id: "", title: "", url: postUrl, author: "" } as SocialPost;
    const commentChildren = listings[1]?.data?.children || [];
    const comments: SocialComment[] = commentChildren
      .filter((c: any) => c.kind === "t1")
      .map((c: any) => mapComment(c))
      .slice(0, limit);
    return { post, comments };
  } catch {
    const fullUrl = `${OLD_REDDIT}${path}`;
    const fb = await socialAiFallback<{ post: SocialPost; comments: SocialComment[] }>({ action: "reddit:comments", url: fullUrl });
    if (fb?.data) return fb.data;
    throw new Error("Reddit comments fetch failed and AI fallback unavailable");
  }
}

async function getSubredditInfo(subreddit: string): Promise<SocialProfile | null> {
  try {
    const data = await redditJson(`/r/${subreddit}/about.json`);
    const d = (data as any)?.data;
    if (!d) return null;
    return {
      name: d.display_name || subreddit,
      url: `${REDDIT_BASE}/r/${d.display_name || subreddit}`,
      description: (d.public_description || d.description || "").substring(0, 1000),
      subscribers: d.subscribers ?? undefined,
      avatar: d.icon_img || d.community_icon?.split("?")?.[0] || undefined,
      created: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : undefined,
    };
  } catch {
    const fb = await socialAiFallback<SocialProfile>({ action: "reddit:subreddit", url: `${OLD_REDDIT}/r/${subreddit}` });
    return fb?.data ?? null;
  }
}

// ── Execute ──

export async function execute(input: RedditInput) {
  try {
    let result: unknown;

    switch (input.action) {
      case "search": {
        if (!input.query) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: "query is required for search action" }) }] };
        }
        result = await searchReddit(input.query, input.sort, input.time, input.limit);
        break;
      }
      case "posts": {
        if (!input.subreddit) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: "subreddit is required for posts action" }) }] };
        }
        result = await getPosts(input.subreddit, input.sort, input.time, input.limit);
        break;
      }
      case "comments": {
        if (!input.post_url) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: "post_url is required for comments action" }) }] };
        }
        result = await getComments(input.post_url, input.limit);
        break;
      }
      case "subreddit": {
        if (!input.subreddit) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: "subreddit is required for subreddit action" }) }] };
        }
        const info = await getSubredditInfo(input.subreddit);
        result = info || { error: "Could not fetch subreddit info" };
        break;
      }
    }

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }) }],
    };
  }
}
