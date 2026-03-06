/**
 * AI fallback for social media tools.
 *
 * When structured parsers fail (ytInitialData, .json API, rehydration data),
 * this uses the existing LLM infrastructure to extract data from ARIA trees
 * or raw HTML markdown.
 *
 * Structured extraction = primary (free, fast).
 * AI fallback = backup (costs tokens, slower, but always works).
 */

import type { Page } from "rebrowser-playwright";
import { hasLLMConfigured, createLLMClient } from "../llm/index.js";
import { extractWithLLM } from "../llm/extractor.js";
import { getEnhancedSnapshot } from "../snapshot/extractor.js";
import { smartFetch } from "../stealth/index.js";
import { htmlToMarkdown } from "../utils/markdown.js";
import { parseCompactNumber } from "./parsers.js";
import type { SocialVideo, SocialPost, SocialComment, SocialProfile, InstagramProfile } from "./types.js";

// ── Action types ──

export type SocialAction =
  | "youtube:search" | "youtube:video" | "youtube:comments"
  | "youtube:transcript" | "youtube:channel"
  | "reddit:search" | "reddit:posts" | "reddit:comments" | "reddit:subreddit"
  | "instagram:profile";

// ── Schemas for LLM extraction ──

const SOCIAL_SCHEMAS: Record<SocialAction, string> = {
  "youtube:search": `{ "videos": [{ "id": "video ID", "title": "string", "url": "full URL", "duration": "M:SS", "views": "view count text", "author": "channel name", "author_url": "channel URL", "published": "relative time" }] }`,
  "youtube:video": `{ "id": "video ID", "title": "string", "url": "full URL", "views": "view count text", "likes": "like count text", "author": "channel name", "author_url": "channel URL", "published": "date text", "description": "first 2000 chars" }`,
  "youtube:comments": `{ "comments": [{ "author": "string", "text": "comment text", "likes": "like count", "published": "relative time" }] }`,
  "youtube:transcript": `{ "segments": [{ "start": "timestamp M:SS", "text": "string" }] }`,
  "youtube:channel": `{ "name": "channel name", "url": "channel URL", "description": "about text", "subscribers": "subscriber count text", "verified": true/false }`,
  "reddit:search": `{ "posts": [{ "title": "string", "url": "permalink", "author": "string", "score": "number or text", "comments_count": "number", "subreddit": "string", "published": "relative time" }] }`,
  "reddit:posts": `{ "posts": [{ "title": "string", "url": "permalink", "author": "string", "score": "number or text", "comments_count": "number", "published": "relative time", "flair": "flair text or null" }] }`,
  "reddit:comments": `{ "post": { "title": "string", "author": "string", "score": "number" }, "comments": [{ "author": "string", "text": "comment body", "score": "number", "published": "relative time" }] }`,
  "reddit:subreddit": `{ "name": "subreddit name", "description": "description text", "subscribers": "subscriber count text", "created": "creation date" }`,
  "instagram:profile": `{ "username": "string", "full_name": "string", "bio": "string", "followers": "follower count text", "following": "following count text", "posts_count": "post count text", "is_verified": true/false, "is_business": true/false, "business_email": "email or null" }`,
};

// ── Main fallback function ──

export async function socialAiFallback<T>(opts: {
  action: SocialAction;
  page?: Page;
  url?: string;
  maxTokens?: number;
}): Promise<{ data: T; model: string } | null> {
  if (!hasLLMConfigured()) return null;

  const schema = SOCIAL_SCHEMAS[opts.action];
  if (!schema) return null;

  let content: string;

  if (opts.page) {
    // Playwright mode: ARIA tree from already-open page
    const snapshot = await getEnhancedSnapshot(opts.page, { compact: true });
    content = snapshot.tree;
  } else if (opts.url) {
    // HTTP mode: fetch + convert to markdown
    const result = await smartFetch(opts.url, { maxLevel: 2 });
    content = htmlToMarkdown(result.html);
  } else {
    return null;
  }

  if (!content || content.length < 50) return null;

  const client = await createLLMClient();
  const extraction = await extractWithLLM(client, content, schema, opts.maxTokens ?? 4000);

  const raw = extraction.data as Record<string, unknown>;
  const normalized = normalizeResult(opts.action, raw);

  return { data: normalized as T, model: extraction.model };
}

// ── Normalizers ──

function normalizeResult(action: SocialAction, raw: Record<string, unknown>): unknown {
  const platform = action.split(":")[0];
  const type = action.split(":")[1];

  if (type === "search" || type === "posts") {
    const items = (raw.videos || raw.posts || []) as any[];
    const normalized = items.map((item) =>
      platform === "reddit" ? normalizePost(item) : normalizeVideo(item),
    );
    return platform === "reddit"
      ? { platform: "reddit", results: normalized }
      : { platform, results: normalized };
  }

  if (type === "video") return normalizeVideo(raw);
  if (type === "profile") return normalizeInstagramProfile(raw);
  if (type === "user" || type === "channel" || type === "subreddit") return normalizeProfile(raw);
  if (type === "comments") {
    const comments = ((raw.comments || []) as any[]).map(normalizeComment);
    return { ...raw, comments };
  }

  return raw;
}

function normalizeVideo(raw: any): SocialVideo {
  return {
    id: raw.id || "",
    title: raw.title || "",
    url: raw.url || "",
    thumbnail: raw.thumbnail,
    duration: raw.duration,
    views: typeof raw.views === "number" ? raw.views : parseNum(raw.views),
    likes: typeof raw.likes === "number" ? raw.likes : parseNum(raw.likes),
    author: raw.author || "",
    author_url: raw.author_url,
    published: raw.published,
    description: raw.description?.substring(0, 2000),
  };
}

function normalizePost(raw: any): SocialPost {
  return {
    id: raw.id || "",
    title: raw.title || "",
    url: raw.url || "",
    author: raw.author || "",
    score: typeof raw.score === "number" ? raw.score : parseNum(raw.score),
    comments_count: typeof raw.comments_count === "number" ? raw.comments_count : parseNum(raw.comments_count),
    published: raw.published,
    subreddit: raw.subreddit,
    text: raw.text,
    flair: raw.flair,
  };
}

function normalizeComment(raw: any): SocialComment {
  return {
    id: raw.id || `comment-${Math.random().toString(36).slice(2, 8)}`,
    author: raw.author || "",
    text: raw.text || "",
    score: typeof raw.score === "number" ? raw.score : (typeof raw.likes === "number" ? raw.likes : parseNum(raw.score || raw.likes)),
    published: raw.published,
  };
}

function normalizeProfile(raw: any): SocialProfile {
  const subs = raw.subscribers || raw.followers;
  return {
    name: raw.name || raw.username || "",
    url: raw.url || "",
    description: raw.description?.substring(0, 1000),
    subscribers: typeof subs === "number" ? subs : parseNum(subs),
    avatar: raw.avatar,
    verified: raw.verified ?? false,
    video_count: typeof raw.video_count === "number" ? raw.video_count : parseNum(raw.video_count),
    created: raw.created,
  };
}

function normalizeInstagramProfile(raw: any): InstagramProfile {
  return {
    name: raw.full_name || raw.username || "",
    username: raw.username || "",
    url: raw.url || (raw.username ? `https://www.instagram.com/${raw.username}/` : ""),
    description: raw.bio?.substring(0, 1000),
    verified: raw.is_verified ?? false,
    followers: typeof raw.followers === "number" ? raw.followers : (parseNum(raw.followers) ?? 0),
    following: typeof raw.following === "number" ? raw.following : (parseNum(raw.following) ?? 0),
    posts_count: typeof raw.posts_count === "number" ? raw.posts_count : (parseNum(raw.posts_count) ?? 0),
    is_business: raw.is_business ?? false,
    business_email: raw.business_email || undefined,
    engagement_rate: 0,
    recent_posts: [],
  };
}

/** Parse a number string, returning undefined for NaN. */
function parseNum(val: unknown): number | undefined {
  if (val == null) return undefined;
  const n = parseCompactNumber(String(val));
  return isNaN(n) ? undefined : n;
}
