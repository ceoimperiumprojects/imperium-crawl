import { z } from "zod";
import { smartFetch } from "../stealth/index.js";
import { isPlaywrightAvailable } from "../stealth/browser.js";
import { acquirePage } from "../stealth/chrome-profile.js";
import { MAX_QUERY_LENGTH, MAX_ITEMS } from "../constants.js";
import { extractScriptJson, parseCompactNumber, sanitizeText } from "../social/parsers.js";
import { hasWhisperConfigured, transcribeAudio } from "../social/whisper.js";
import { socialAiFallback } from "../social/ai-fallback.js";
import type { SocialVideo, SocialComment, SocialProfile, SocialSearchResult } from "../social/types.js";

export const name = "youtube";

export const description =
  "Search YouTube videos, get video details, comments, transcripts, and channel info. No API key needed.";

const ActionEnum = z.enum(["search", "video", "comments", "transcript", "channel"]);

export const schema = z.object({
  action: ActionEnum.describe("Action to perform"),
  query: z.string().max(MAX_QUERY_LENGTH).optional().describe("Search query (for action: search)"),
  url: z.string().max(8192).optional().describe("Video URL or ID (for action: video, comments, transcript)"),
  channel_url: z.string().max(8192).optional().describe("Channel URL like youtube.com/@name (for action: channel)"),
  limit: z.number().min(1).max(MAX_ITEMS).default(10).describe("Max results to return"),
  sort: z.enum(["relevance", "date", "views"]).default("relevance").describe("Sort order for search"),
});

export type YoutubeInput = z.infer<typeof schema>;

// ── Helpers ──

function extractVideoId(input: string): string | null {
  // Full URL: youtube.com/watch?v=xxx, youtu.be/xxx, youtube.com/shorts/xxx
  try {
    const url = new URL(input.startsWith("http") ? input : `https://${input}`);
    if (url.hostname.includes("youtu.be")) return url.pathname.slice(1);
    if (url.pathname.startsWith("/shorts/")) return url.pathname.split("/")[2];
    return url.searchParams.get("v");
  } catch {
    // Maybe just a video ID
    if (/^[\w-]{11}$/.test(input)) return input;
    return null;
  }
}

function sortParam(sort: string): string {
  switch (sort) {
    case "date": return "&sp=CAI%253D";
    case "views": return "&sp=CAM%253D";
    default: return "";
  }
}

// ── ytInitialData Extractors ──

function extractSearchResults(data: unknown, limit: number): SocialVideo[] {
  const results: SocialVideo[] = [];
  try {
    // Navigate the ytInitialData structure
    const contents = (data as any)?.contents?.twoColumnSearchResultsRenderer
      ?.primaryContents?.sectionListRenderer?.contents;
    if (!Array.isArray(contents)) return results;

    for (const section of contents) {
      const items = section?.itemSectionRenderer?.contents;
      if (!Array.isArray(items)) continue;

      for (const item of items) {
        if (results.length >= limit) break;
        const v = item?.videoRenderer;
        if (!v) continue;

        results.push({
          id: v.videoId || "",
          title: v.title?.runs?.[0]?.text || "",
          url: `https://www.youtube.com/watch?v=${v.videoId}`,
          thumbnail: v.thumbnail?.thumbnails?.slice(-1)?.[0]?.url,
          duration: v.lengthText?.simpleText,
          views: parseCompactNumber(v.viewCountText?.simpleText || v.shortViewCountText?.simpleText || ""),
          author: v.ownerText?.runs?.[0]?.text || "",
          author_url: v.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl
            ? `https://www.youtube.com${v.ownerText.runs[0].navigationEndpoint.browseEndpoint.canonicalBaseUrl}`
            : undefined,
          published: v.publishedTimeText?.simpleText,
        });
      }
    }
  } catch {
    // Malformed data
  }
  return results;
}

function extractVideoDetails(data: unknown): SocialVideo | null {
  try {
    const vd = (data as any)?.contents?.twoColumnWatchNextResults?.results
      ?.results?.contents;
    if (!Array.isArray(vd)) return null;

    const primary = vd.find((c: any) => c.videoPrimaryInfoRenderer);
    const secondary = vd.find((c: any) => c.videoSecondaryInfoRenderer);

    const pi = primary?.videoPrimaryInfoRenderer;
    const si = secondary?.videoSecondaryInfoRenderer;

    const videoId = (data as any)?.currentVideoEndpoint?.watchEndpoint?.videoId || "";
    const title = pi?.title?.runs?.map((r: any) => r.text).join("") || "";
    const viewCountText = pi?.viewCount?.videoViewCountRenderer?.viewCount?.simpleText || "";
    const views = parseCompactNumber(viewCountText);
    const published = pi?.dateText?.simpleText;

    // Like count from toggle buttons
    let likes: number | undefined;
    const buttons = pi?.videoActions?.menuRenderer?.topLevelButtons;
    if (Array.isArray(buttons)) {
      for (const btn of buttons) {
        const seg = btn?.segmentedLikeDislikeButtonViewModel;
        const likeText = seg?.likeButtonViewModel?.likeButtonViewModel
          ?.toggleButtonViewModel?.toggleButtonViewModel?.defaultButtonViewModel
          ?.buttonViewModel?.title;
        if (likeText) {
          likes = parseCompactNumber(likeText);
          break;
        }
      }
    }

    const author = si?.owner?.videoOwnerRenderer?.title?.runs?.[0]?.text || "";
    const authorUrl = si?.owner?.videoOwnerRenderer?.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl;
    const description = si?.attributedDescription?.content || "";

    return {
      id: videoId,
      title,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      views: isNaN(views) ? undefined : views,
      likes: likes && !isNaN(likes) ? likes : undefined,
      author,
      author_url: authorUrl ? `https://www.youtube.com${authorUrl}` : undefined,
      published,
      description: description.substring(0, 2000),
    };
  } catch {
    return null;
  }
}

function extractChannelInfo(data: unknown): SocialProfile | null {
  try {
    const header = (data as any)?.header;
    const c4 = header?.c4TabbedHeaderRenderer;
    const ph = header?.pageHeaderRenderer;
    const metadata = (data as any)?.metadata?.channelMetadataRenderer;

    if (!metadata) return null;

    // Subscriber count: try c4 header first, then pageHeaderRenderer
    let subscriberText: string | undefined;
    if (c4?.subscriberCountText?.simpleText) {
      subscriberText = c4.subscriberCountText.simpleText;
    } else if (ph) {
      // New YouTube layout: pageHeaderViewModel → metadataRows
      const rows = ph?.content?.pageHeaderViewModel?.metadata?.contentMetadataViewModel?.metadataRows;
      if (Array.isArray(rows)) {
        for (const row of rows) {
          for (const part of row?.metadataParts || []) {
            const text = part?.text?.content || "";
            if (text.includes("subscriber")) {
              subscriberText = text;
              break;
            }
          }
          if (subscriberText) break;
        }
      }
    }

    // Verified badge: check c4 badges or pageHeaderViewModel
    let verified = false;
    if (c4?.badges) {
      verified = c4.badges.some((b: any) => b.metadataBadgeRenderer?.style?.includes("VERIFIED"));
    }

    return {
      name: metadata.title || "",
      url: metadata.channelUrl || "",
      description: (metadata.description || "").substring(0, 1000),
      subscribers: subscriberText ? parseCompactNumber(subscriberText) : undefined,
      avatar: metadata.avatar?.thumbnails?.slice(-1)?.[0]?.url,
      verified,
    };
  } catch {
    return null;
  }
}

function extractTranscriptUrl(data: unknown): string | null {
  try {
    // Look for captions in playerResponse
    const captions = (data as any)?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (Array.isArray(captions) && captions.length > 0) {
      // Prefer English, fallback to first
      const en = captions.find((c: any) => c.languageCode === "en");
      return (en || captions[0])?.baseUrl || null;
    }
  } catch {
    // No captions
  }
  return null;
}

// ── Actions ──

async function searchYouTube(query: string, limit: number, sort: string): Promise<SocialSearchResult<SocialVideo>> {
  const encoded = encodeURIComponent(query);
  const result = await smartFetch(`https://www.youtube.com/results?search_query=${encoded}${sortParam(sort)}`, {
    maxLevel: 2,
  });

  const data = extractScriptJson(result.html, "ytInitialData");
  const videos = data ? extractSearchResults(data, limit) : [];

  if (videos.length === 0) {
    const url = `https://www.youtube.com/results?search_query=${encoded}${sortParam(sort)}`;
    const fb = await socialAiFallback<SocialSearchResult<SocialVideo>>({ action: "youtube:search", url });
    if (fb?.data?.results?.length) return { query, platform: "youtube", results: fb.data.results.slice(0, limit) };
  }

  return { query, platform: "youtube", results: videos };
}

async function getVideoDetails(videoUrl: string): Promise<SocialVideo | null> {
  const videoId = extractVideoId(videoUrl);
  if (!videoId) return null;

  const result = await smartFetch(`https://www.youtube.com/watch?v=${videoId}`, { maxLevel: 2 });

  const data = extractScriptJson(result.html, "ytInitialData");
  const video = data ? extractVideoDetails(data) : null;

  if (!video) {
    const fb = await socialAiFallback<SocialVideo>({ action: "youtube:video", url: `https://www.youtube.com/watch?v=${videoId}` });
    return fb?.data ?? null;
  }

  // Also try to get more info from ytInitialPlayerResponse
  if (video) {
    const playerData = extractScriptJson(result.html, "ytInitialPlayerResponse");
    if (playerData) {
      const pd = playerData as any;
      video.duration = video.duration || pd?.videoDetails?.lengthSeconds
        ? `${Math.floor(Number(pd.videoDetails.lengthSeconds) / 60)}:${String(Number(pd.videoDetails.lengthSeconds) % 60).padStart(2, "0")}`
        : undefined;
      video.thumbnail = video.thumbnail || pd?.videoDetails?.thumbnail?.thumbnails?.slice(-1)?.[0]?.url;
    }
  }

  return video;
}

async function getComments(videoUrl: string, limit: number): Promise<SocialComment[]> {
  if (!(await isPlaywrightAvailable())) {
    throw new Error("rebrowser-playwright is required for YouTube comments. Install with: npm i rebrowser-playwright");
  }

  const videoId = extractVideoId(videoUrl);
  if (!videoId) return [];

  const handle = await acquirePage();
  try {
    const { page } = handle;
    await page.goto(`https://www.youtube.com/watch?v=${videoId}`, {
      waitUntil: "load",
      timeout: 30_000,
    });

    // Scroll down to load comments
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await page.waitForTimeout(1500);
    }

    // Wait for comment section
    await page.waitForSelector("ytd-comment-thread-renderer", { timeout: 10_000 }).catch(() => {});

    const comments: SocialComment[] = await page.evaluate((lim) => {
      const elements = document.querySelectorAll("ytd-comment-thread-renderer");
      const result: any[] = [];
      for (let i = 0; i < Math.min(elements.length, lim); i++) {
        const el = elements[i];
        const authorEl = el.querySelector("#author-text span");
        const textEl = el.querySelector("#content-text");
        const likesEl = el.querySelector("#vote-count-middle");
        const timeEl = el.querySelector(".published-time-text a");

        result.push({
          id: `comment-${i}`,
          author: authorEl?.textContent?.trim() || "Unknown",
          text: textEl?.textContent?.trim() || "",
          score: parseInt(likesEl?.textContent?.trim() || "0", 10) || 0,
          published: timeEl?.textContent?.trim(),
        });
      }
      return result;
    }, limit);

    if (comments.length === 0) {
      const fb = await socialAiFallback<{ comments: SocialComment[] }>({ action: "youtube:comments", page });
      if (fb?.data?.comments?.length) return fb.data.comments.slice(0, limit);
    }

    return comments;
  } finally {
    await handle.cleanup();
  }
}

async function getTranscript(
  videoUrl: string,
): Promise<{ segments: Array<{ start: string; text: string }>; total: number; source: "captions" | "whisper" } | null> {
  const videoId = extractVideoId(videoUrl);
  if (!videoId) return null;

  // YouTube transcript requires Playwright — click "Show transcript" and parse DOM.
  if (!(await isPlaywrightAvailable())) {
    throw new Error("rebrowser-playwright is required for YouTube transcripts. Install with: npm i rebrowser-playwright");
  }

  const handle = await acquirePage();
  try {
    const { page } = handle;

    await page.goto(`https://www.youtube.com/watch?v=${videoId}`, {
      waitUntil: "load",
      timeout: 30_000,
    });
    await page.waitForTimeout(3000);

    // Scroll down to reveal description area
    await page.evaluate(() => window.scrollBy(0, 400));
    await page.waitForTimeout(1000);

    // Expand description to reveal "Show transcript" button
    const expandBtn = page.locator("#expand, tp-yt-paper-button#expand").first();
    if (await expandBtn.isVisible().catch(() => false)) {
      await expandBtn.click();
      await page.waitForTimeout(1500);
    }

    // Try captions first — click "Show transcript"
    const transcriptBtn = page.locator('button:has-text("Show transcript")').first();
    const hasTranscriptBtn = await transcriptBtn.isVisible({ timeout: 5000 }).catch(() => false);

    if (hasTranscriptBtn) {
      await transcriptBtn.click();
      await page.waitForTimeout(5000);

      const segments = await page.evaluate(() => {
        const panel = document.querySelector(
          'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]',
        );
        if (!panel) return [];

        const renderers = panel.querySelectorAll("ytd-transcript-segment-renderer");
        const result: Array<{ start: string; text: string }> = [];

        for (const renderer of renderers) {
          const textNodes: string[] = [];
          const walker = document.createTreeWalker(renderer, NodeFilter.SHOW_TEXT, null);
          let node;
          while ((node = walker.nextNode())) {
            const t = node.textContent?.trim();
            if (t && t.length > 0) textNodes.push(t);
          }
          if (textNodes.length >= 2) {
            result.push({ start: textNodes[0], text: textNodes.slice(1).join(" ") });
          }
        }
        return result;
      });

      if (segments.length > 0) {
        return { segments, total: segments.length, source: "captions" };
      }
    }

    // No captions — try AI fallback for on-screen transcript data
    if (!hasWhisperConfigured()) {
      const fb = await socialAiFallback<{ segments: Array<{ start: string; text: string }> }>({ action: "youtube:transcript", page });
      if (fb?.data?.segments?.length) return { segments: fb.data.segments, total: fb.data.segments.length, source: "captions" };
      return null;
    }

    // Extract audio URL from player data
    const audioInfo = await page.evaluate(() => {
      const pd = (window as any).ytInitialPlayerResponse;
      if (!pd?.streamingData?.adaptiveFormats) return null;

      // Find audio-only format — prefer lowest bitrate (smallest file)
      const audioFormats = pd.streamingData.adaptiveFormats
        .filter((f: any) => f.mimeType?.startsWith("audio/") && f.url)
        .sort((a: any, b: any) => (a.bitrate || 0) - (b.bitrate || 0));

      if (audioFormats.length === 0) return null;

      const fmt = audioFormats[0];
      return {
        url: fmt.url,
        mimeType: fmt.mimeType,
        contentLength: parseInt(fmt.contentLength || "0", 10),
        bitrate: fmt.bitrate,
        duration: parseInt(pd.videoDetails?.lengthSeconds || "0", 10),
      };
    });

    if (!audioInfo?.url) return null;

    // Check file size (Whisper limit: 25MB)
    if (audioInfo.contentLength > 25 * 1024 * 1024) {
      throw new Error(
        `Video audio too large for Whisper (${Math.round(audioInfo.contentLength / 1024 / 1024)}MB). Limit is 25MB. Try a shorter video.`,
      );
    }

    // Download audio from within browser context (URLs are session-signed)
    const audioBase64 = await page.evaluate(async (url: string) => {
      const resp = await fetch(url);
      if (!resp.ok) return null;
      const buffer = await resp.arrayBuffer();
      // Convert to base64
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    }, audioInfo.url);

    if (!audioBase64) return null;

    const audioBuffer = Buffer.from(audioBase64, "base64");

    // Transcribe with Whisper
    const ext = audioInfo.mimeType?.includes("webm") ? "webm" : "mp4";
    const whisperResult = await transcribeAudio(audioBuffer, { filename: `video.${ext}` });

    // Convert Whisper segments to our format
    const segments = whisperResult.segments?.map((s) => ({
      start: formatSeconds(s.start),
      text: s.text,
    })) || [{ start: "0:00", text: whisperResult.text }];

    return { segments, total: segments.length, source: "whisper" };
  } finally {
    await handle.cleanup();
  }
}

function formatSeconds(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

async function getChannel(channelUrl: string): Promise<SocialProfile | null> {
  // Normalize URL
  let url = channelUrl;
  if (!url.startsWith("http")) {
    url = url.startsWith("@") ? `https://www.youtube.com/${url}` : `https://www.youtube.com/@${url}`;
  }

  const result = await smartFetch(url, { maxLevel: 2 });
  const data = extractScriptJson(result.html, "ytInitialData");
  const channel = data ? extractChannelInfo(data) : null;

  if (!channel) {
    const fb = await socialAiFallback<SocialProfile>({ action: "youtube:channel", url });
    return fb?.data ?? null;
  }

  return channel;
}

// ── Execute ──

export async function execute(input: YoutubeInput) {
  try {
    let result: unknown;

    switch (input.action) {
      case "search": {
        if (!input.query) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: "query is required for search action" }) }] };
        }
        result = await searchYouTube(input.query, input.limit, input.sort);
        break;
      }
      case "video": {
        if (!input.url) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: "url is required for video action" }) }] };
        }
        const video = await getVideoDetails(input.url);
        result = video || { error: "Could not extract video details" };
        break;
      }
      case "comments": {
        if (!input.url) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: "url is required for comments action" }) }] };
        }
        const comments = await getComments(input.url, input.limit);
        result = { video_url: input.url, comments_count: comments.length, comments };
        break;
      }
      case "transcript": {
        if (!input.url) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: "url is required for transcript action" }) }] };
        }
        const transcript = await getTranscript(input.url);
        result = transcript || {
          error: "No transcript available for this video",
          hint: hasWhisperConfigured()
            ? undefined
            : "Set OPENAI_API_KEY to enable Whisper AI transcription for videos without captions.",
        };
        break;
      }
      case "channel": {
        const url = input.channel_url || input.url;
        if (!url) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: "channel_url or url is required for channel action" }) }] };
        }
        const channel = await getChannel(url);
        result = channel || { error: "Could not extract channel info" };
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
