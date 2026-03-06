import { z } from "zod";
import { smartFetch } from "../stealth/index.js";
import { issueRequest } from "../brave-api/index.js";
import { hasBraveApiKey } from "../config.js";
import { MAX_QUERY_LENGTH, MAX_ITEMS } from "../constants.js";
import { parseCompactNumber, sanitizeText, extractScriptJson } from "../social/parsers.js";
import { toolResult, errorResult } from "../utils/tool-response.js";
import { debugLog } from "../utils/debug.js";
import type { InstagramProfile, InstagramPost, InstagramDiscoverResult } from "../social/types.js";

export const name = "instagram";

export const description =
  "Search Instagram profiles, get profile details with engagement metrics, and discover influencers by niche/location. Search/discover require BRAVE_API_KEY.";

const ActionEnum = z.enum(["search", "profile", "discover"]);

export const schema = z.object({
  action: ActionEnum.describe("Action: search (find profiles), profile (get details), discover (full pipeline)"),
  // search + discover
  query: z.string().max(MAX_QUERY_LENGTH).optional().describe("Search query (for action: search)"),
  location: z.string().max(200).optional().describe("Location filter, e.g. 'beograd', 'new york'"),
  niche: z.string().max(500).optional().describe("Niche/industry for discovery, e.g. 'travel hotel', 'food'"),
  // profile
  username: z.string().max(200).optional().describe("Single username (for action: profile)"),
  usernames: z.array(z.string().max(200)).max(100).optional().describe("Multiple usernames (for action: profile)"),
  // filters (discover)
  min_followers: z.number().min(0).default(1000).optional().describe("Minimum followers (discover filter)"),
  max_followers: z.number().min(0).default(80000).optional().describe("Maximum followers (discover filter)"),
  min_engagement: z.number().min(0).default(3).optional().describe("Minimum engagement rate % (discover filter)"),
  max_days_since_post: z.number().min(1).default(30).optional().describe("Max days since last post (discover filter)"),
  // general
  limit: z.number().min(1).max(MAX_ITEMS).default(20).describe("Max results to return"),
  sort: z.enum(["engagement", "followers"]).default("engagement").describe("Sort order for results"),
});

export type InstagramInput = z.infer<typeof schema>;

// ── Constants ──

const IG_API_BASE = "https://i.instagram.com/api/v1";
const IG_APP_ID = "936619743392459";
const IG_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

// Paths that are NOT user profiles
const NON_PROFILE_PATHS = new Set([
  "explore", "accounts", "about", "legal", "privacy", "terms",
  "developer", "reels", "stories", "p", "reel", "tv", "direct",
  "directory", "web", "challenge", "emails", "session", "nametag",
  "lite", "ar", "creators", "branded_content", "shopping",
]);

// ── Helpers ──

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function extractUsernamesFromUrls(urls: string[]): string[] {
  const usernames = new Set<string>();
  const usernameRegex = /instagram\.com\/([a-zA-Z0-9_.]{1,30})\/?(?:\?|$|#|\/)/;

  for (const url of urls) {
    const match = usernameRegex.exec(url);
    if (match) {
      const username = match[1].toLowerCase();
      if (!NON_PROFILE_PATHS.has(username)) {
        usernames.add(username);
      }
    }
  }

  return Array.from(usernames);
}

// ── Search via Brave ──

async function searchProfiles(query: string, location?: string, limit = 20): Promise<string[]> {
  if (!hasBraveApiKey()) {
    throw new Error("BRAVE_API_KEY is required for instagram search/discover. Set it in your environment or run: imperium-crawl setup");
  }

  // Build search queries — no quotes around terms for broader results
  const baseQuery = `site:instagram.com ${query}`;
  const locationSuffix = location ? ` ${location}` : "";
  const excludes = ' -"/p/" -"/reel/" -"/explore/"';

  // Build multiple query variations to gather more profiles
  const queries = [
    `${baseQuery}${locationSuffix}${excludes}`,
  ];
  // Add variation queries for discover (when we need more results)
  if (limit > 20) {
    queries.push(`site:instagram.com ${query} influencer${locationSuffix}${excludes}`);
    queries.push(`site:instagram.com ${query} blogger${locationSuffix}${excludes}`);
    queries.push(`site:instagram.com ${query} content creator${locationSuffix}${excludes}`);
    queries.push(`site:instagram.com ${query} guide${locationSuffix}${excludes}`);
  }

  const allUrls: string[] = [];
  for (const q of queries) {
    try {
      const data = await issueRequest(process.env.BRAVE_API_KEY!, "/web/search", {
        q,
        count: 20,
      });
      const results = (data as any)?.web?.results || [];
      allUrls.push(...results.map((r: any) => r.url).filter(Boolean));
    } catch (err) {
      debugLog("instagram", `Brave search query failed: ${q}`, err);
    }

    // Respect Brave rate limit (Free: 1 req/sec)
    if (queries.indexOf(q) < queries.length - 1) {
      await sleep(1500);
    }

    // Stop if we have enough unique usernames
    if (extractUsernamesFromUrls(allUrls).length >= limit * 2) break;
  }

  return extractUsernamesFromUrls(allUrls);
}

// ── Profile Fetch — Dual Strategy ──

/** Strategy 1: Instagram internal API (fast, but rate-limited) */
async function fetchProfileViaApi(username: string): Promise<InstagramProfile | null> {
  const res = await fetch(
    `${IG_API_BASE}/users/web_profile_info/?username=${encodeURIComponent(username)}`,
    {
      headers: {
        "x-ig-app-id": IG_APP_ID,
        "User-Agent": IG_USER_AGENT,
        Accept: "*/*",
      },
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (res.status === 429) return null; // Signal to try fallback
  if (!res.ok) return null;

  let data: any;
  try { data = await res.json(); } catch (err) { debugLog("instagram", `API JSON parse failed for @${username}`, err); return null; }

  if (data?.status === "fail" || !data?.data?.user) return null;
  return parseApiUser(data.data.user, username);
}

/** Strategy 2: Web scrape profile page — requires browser (level 3) for IG */
async function fetchProfileViaWeb(username: string): Promise<InstagramProfile | null> {
  try {
    const result = await smartFetch(`https://www.instagram.com/${encodeURIComponent(username)}/`, {
      forceLevel: 3,
    });

    // Try embedded JSON first (older IG layouts)
    const jsonData = extractScriptJson(result.html, "__additionalDataLoaded")
      ?? extractScriptJson(result.html, "__initialData");

    if (jsonData) {
      const user = (jsonData as any)?.graphql?.user
        ?? (jsonData as any)?.data?.user
        ?? (jsonData as any)?.user;
      if (user && (user.edge_followed_by || user.follower_count)) {
        return parseProfileData(user, username);
      }
    }

    // Fallback: extract from meta tags (works on current IG layout)
    const metaData = extractProfileFromMeta(result.html, username);
    if (metaData) {
      return parseProfileData(metaData, username);
    }

    return null;
  } catch (err) {
    debugLog("instagram", `Web scrape failed for @${username}`, err);
    return null;
  }
}

/** Extract profile data from meta tags — works on current IG layout.
 *  OG description format: "298M Followers, 243 Following, 1,614 Posts - See Instagram photos..." */
function extractProfileFromMeta(html: string, username: string): Record<string, any> | null {
  // Match og:description — try multiple patterns
  const descMatch = html.match(/og:description[^>]*content="([^"]+)"/i)
    ?? html.match(/og:description[^>]*content='([^']+)'/i)
    ?? html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
  if (!descMatch) return null;

  const desc = descMatch[1];
  const followersMatch = desc.match(/([\d,.]+[KMB]?)\s*Followers/i);
  const followingMatch = desc.match(/([\d,.]+[KMB]?)\s*Following/i);
  const postsMatch = desc.match(/([\d,.]+[KMB]?)\s*Posts/i);

  if (!followersMatch) return null;

  const followers = parseCompactNumber(followersMatch[1]);
  const following = parseCompactNumber(followingMatch?.[1] || "0");
  const posts = parseCompactNumber(postsMatch?.[1] || "0");

  // Extract name from title: "Name (@username) • Instagram photos and videos"
  const titleMatch = html.match(/<title>\s*([^<]+)/);
  let name = username;
  if (titleMatch) {
    // Clean: remove " • Instagram..." suffix, extract before (@username)
    let raw = titleMatch[1].replace(/\s*[•·|]\s*Instagram.*/i, "").trim();
    const parenIdx = raw.indexOf("(@");
    if (parenIdx > 0) raw = raw.substring(0, parenIdx).trim();
    if (raw) name = raw;
  }

  // Extract bio from description after stats
  // Format: "1,614 Posts - See Instagram photos and videos from Nike (@nike)"
  // Or with bio: "1,614 Posts - Bio text here. See Instagram photos..."
  let bio = "";
  const afterPosts = desc.match(/Posts\s*[-–]\s*(.+)/i);
  if (afterPosts) {
    let rawBio = afterPosts[1];
    // Remove "See Instagram photos and videos from Name (@username)" boilerplate
    rawBio = rawBio.replace(/See Instagram photos and videos from .+$/i, "").trim();
    // Remove trailing (@username) fragments
    rawBio = rawBio.replace(/\(@?[\w.]+\)\s*$/, "").trim();
    bio = sanitizeText(rawBio).substring(0, 1000);
  }

  return {
    full_name: name,
    biography: bio,
    edge_followed_by: { count: isNaN(followers) ? 0 : followers },
    edge_follow: { count: isNaN(following) ? 0 : following },
    edge_owner_to_timeline_media: { count: isNaN(posts) ? 0 : posts, edges: [] },
    is_private: false,
    is_verified: html.includes('"is_verified":true'),
    is_business_account: html.includes('"is_business_account":true') || html.includes('"is_professional_account":true'),
  };
}

/** Parse user data from API response format */
function parseApiUser(user: any, username: string): InstagramProfile | null {
  if (user.is_private) return null;

  const followers = user.edge_followed_by?.count ?? 0;
  const following = user.edge_follow?.count ?? 0;
  const postsCount = user.edge_owner_to_timeline_media?.count ?? 0;

  const edges = user.edge_owner_to_timeline_media?.edges ?? [];
  const recentPosts = extractRecentPosts(edges);

  const engagementRate = calcEngagement(followers, recentPosts);

  return {
    name: user.full_name || username,
    username,
    url: `https://www.instagram.com/${username}/`,
    description: (user.biography || "").substring(0, 1000),
    avatar: user.profile_pic_url_hd || user.profile_pic_url,
    verified: user.is_verified ?? false,
    followers,
    following,
    posts_count: postsCount,
    is_business: user.is_business_account ?? user.is_professional_account ?? false,
    business_email: user.business_email || undefined,
    engagement_rate: engagementRate,
    recent_posts: recentPosts,
  };
}

/** Parse user data from web scrape (similar structure, slightly different fields) */
function parseProfileData(user: any, username: string): InstagramProfile | null {
  if (user.is_private) return null;

  const followers = user.edge_followed_by?.count ?? user.follower_count ?? 0;
  const following = user.edge_follow?.count ?? user.following_count ?? 0;
  const postsCount = user.edge_owner_to_timeline_media?.count ?? user.media_count ?? 0;

  const edges = user.edge_owner_to_timeline_media?.edges ?? [];
  const recentPosts = extractRecentPosts(edges);

  const engagementRate = calcEngagement(followers, recentPosts);

  return {
    name: user.full_name || username,
    username,
    url: `https://www.instagram.com/${username}/`,
    description: (user.biography || "").substring(0, 1000),
    avatar: user.profile_pic_url_hd || user.profile_pic_url,
    verified: user.is_verified ?? false,
    followers,
    following,
    posts_count: postsCount,
    is_business: user.is_business_account ?? user.is_professional_account ?? false,
    business_email: user.business_email || undefined,
    engagement_rate: engagementRate,
    recent_posts: recentPosts,
  };
}

function extractRecentPosts(edges: any[]): InstagramPost[] {
  const posts: InstagramPost[] = [];
  for (let i = 0; i < Math.min(edges.length, 3); i++) {
    const node = edges[i]?.node;
    if (!node) continue;
    posts.push({
      id: node.id || node.shortcode || "",
      url: node.shortcode ? `https://www.instagram.com/p/${node.shortcode}/` : "",
      likes: node.edge_liked_by?.count ?? node.edge_media_preview_like?.count ?? 0,
      comments: node.edge_media_to_comment?.count ?? 0,
      caption: sanitizeText(
        node.edge_media_to_caption?.edges?.[0]?.node?.text || "",
      ).substring(0, 500),
      timestamp: node.taken_at_timestamp
        ? new Date(node.taken_at_timestamp * 1000).toISOString()
        : "",
      is_video: node.is_video ?? false,
    });
  }
  return posts;
}

function calcEngagement(followers: number, posts: InstagramPost[]): number {
  if (followers <= 0 || posts.length === 0) return 0;
  const total = posts.reduce((sum, p) => sum + p.likes + p.comments, 0);
  return Math.round((total / posts.length / followers) * 100 * 100) / 100;
}

/** Main fetch with fallback chain: API → Web → Meta tags */
async function fetchProfile(username: string): Promise<InstagramProfile | null> {
  // Try API first (fastest)
  try {
    const profile = await fetchProfileViaApi(username);
    if (profile) return profile;
  } catch (err) {
    debugLog("instagram", `API fetch failed for @${username}, trying web`, err);
  }

  // Fallback: web scrape profile page
  try {
    const profile = await fetchProfileViaWeb(username);
    if (profile) return profile;
  } catch (err) {
    debugLog("instagram", `Web fetch also failed for @${username}`, err);
  }

  return null;
}

// ── Batch Profile Fetch ──

async function fetchProfiles(
  usernames: string[],
  onProgress?: (current: number, total: number, username: string) => void,
): Promise<{ profiles: (InstagramProfile | null)[]; stopped_early: boolean }> {
  const profiles: (InstagramProfile | null)[] = [];
  let stoppedEarly = false;

  let consecutiveNulls = 0;

  for (let i = 0; i < usernames.length; i++) {
    if (onProgress) onProgress(i + 1, usernames.length, usernames[i]);

    const profile = await fetchProfile(usernames[i]);
    profiles.push(profile);

    if (profile) {
      consecutiveNulls = 0;
    } else {
      consecutiveNulls++;
      // 5 consecutive nulls likely means rate limiting — stop early
      if (consecutiveNulls >= 5) {
        process.stderr.write(
          `\n⚠️  ${consecutiveNulls} consecutive failures after ${i + 1}/${usernames.length} profiles. Likely rate-limited. Returning partial results.\n`,
        );
        stoppedEarly = true;
        break;
      }
    }

    // Rate limit: 1.5 req/sec between calls
    if (i < usernames.length - 1) {
      await sleep(1500);
    }
  }

  return { profiles, stopped_early: stoppedEarly };
}

// ── Discover Pipeline ──

async function discoverInfluencers(input: InstagramInput): Promise<InstagramDiscoverResult> {
  const niche = input.niche || input.query || "";
  if (!niche) {
    throw new Error("niche or query is required for discover action");
  }

  const minFollowers = input.min_followers ?? 1000;
  const maxFollowers = input.max_followers ?? 80000;
  const minEngagement = input.min_engagement ?? 3;
  const maxDaysSincePost = input.max_days_since_post ?? 30;
  const limit = input.limit;

  // Phase 1: Search for usernames
  process.stderr.write(`🔍 Searching Instagram profiles for "${niche}"${input.location ? ` in ${input.location}` : ""}...\n`);
  const usernames = await searchProfiles(niche, input.location, limit * 3);

  if (usernames.length === 0) {
    return {
      query: niche,
      location: input.location,
      filters: { min_followers: minFollowers, max_followers: maxFollowers, min_engagement: minEngagement },
      profiles: [],
      total_scanned: 0,
      total_matched: 0,
    };
  }

  process.stderr.write(`📋 Found ${usernames.length} potential profiles. Fetching details...\n`);

  // Phase 2: Fetch profiles with rate limiting
  const { profiles: rawProfiles, stopped_early } = await fetchProfiles(
    usernames,
    (current, total, username) => {
      process.stderr.write(`  Fetching profile ${current}/${total}: @${username}...\r`);
    },
  );

  process.stderr.write("\n");

  // Phase 3: Filter
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - maxDaysSincePost);

  const filtered = rawProfiles.filter((p): p is InstagramProfile => {
    if (!p) return false;
    if (p.followers < minFollowers || p.followers > maxFollowers) return false;
    if (p.engagement_rate < minEngagement) return false;

    // Check recency of last post
    if (p.recent_posts.length > 0) {
      const lastPost = p.recent_posts[0];
      if (lastPost.timestamp && new Date(lastPost.timestamp) < cutoffDate) return false;
    }

    return true;
  });

  // Phase 4: Sort
  const sorted = filtered.sort((a, b) =>
    input.sort === "followers"
      ? b.followers - a.followers
      : b.engagement_rate - a.engagement_rate,
  );

  const result = sorted.slice(0, limit);

  if (stopped_early) {
    process.stderr.write(`⚠️  Results may be incomplete due to rate limiting.\n`);
  }
  process.stderr.write(`✅ Found ${result.length} influencers matching criteria.\n`);

  return {
    query: niche,
    location: input.location,
    filters: { min_followers: minFollowers, max_followers: maxFollowers, min_engagement: minEngagement },
    profiles: result,
    total_scanned: rawProfiles.length,
    total_matched: result.length,
  };
}

// ── Execute ──

export async function execute(input: InstagramInput) {
  try {
    let result: unknown;

    switch (input.action) {
      case "search": {
        if (!input.query) {
          return errorResult("query is required for search action");
        }
        const usernames = await searchProfiles(input.query, input.location, input.limit);
        result = {
          query: input.query,
          location: input.location,
          platform: "instagram",
          usernames,
          count: usernames.length,
        };
        break;
      }

      case "profile": {
        const targets = input.usernames?.length ? input.usernames : (input.username ? [input.username] : []);
        if (targets.length === 0) {
          return errorResult("username or usernames is required for profile action");
        }

        if (targets.length === 1) {
          const profile = await fetchProfile(targets[0]);
          result = profile || { error: `Could not fetch profile for @${targets[0]}. Account may be private or not found.` };
        } else {
          const { profiles, stopped_early } = await fetchProfiles(
            targets,
            (current, total, username) => {
              process.stderr.write(`  Fetching profile ${current}/${total}: @${username}...\r`);
            },
          );
          process.stderr.write("\n");

          const successful = profiles.filter((p): p is InstagramProfile => p !== null);
          result = {
            profiles: successful,
            total_requested: targets.length,
            total_fetched: successful.length,
            failed: targets.filter((_, i) => profiles[i] === null),
            stopped_early,
          };
        }
        break;
      }

      case "discover": {
        result = await discoverInfluencers(input);
        break;
      }
    }

    return toolResult(result);
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}
