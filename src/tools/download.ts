import { z } from "zod";
import { promises as fs } from "fs";
import { join, basename, extname } from "path";
import { MAX_URL_LENGTH } from "../constants.js";
import { smartFetch } from "../stealth/index.js";
import { isPlaywrightAvailable } from "../stealth/browser.js";
import { acquirePage } from "../stealth/chrome-profile.js";
import { toolResult, errorResult } from "../utils/tool-response.js";
import { debugLog } from "../utils/debug.js";
import * as cheerio from "cheerio";

export const name = "download";

export const description =
  "Download media files (images, videos) from URLs. Supports direct files, page media extraction, YouTube, TikTok, and bulk downloads.";

export const schema = z.object({
  url: z.string().max(MAX_URL_LENGTH).optional().describe("URL to download from (page, direct file, or video)"),
  urls: z.string().optional().describe("Comma-separated list of URLs for bulk download"),
  file: z.string().optional().describe("Path to text file with one URL per line for bulk download"),
  output: z.string().describe("Output directory for downloaded files"),
  images: z.boolean().default(false).describe("Download all images from the page"),
  og_only: z.boolean().default(false).describe("Download only og:image / twitter:image from the page"),
  video: z.boolean().default(false).describe("Download video elements from the page"),
  all: z.boolean().default(false).describe("Download all media (images + video) from the page"),
});

export type DownloadInput = z.infer<typeof schema>;

// ── URL Type Detection ──

type UrlType = "youtube" | "tiktok" | "direct-media" | "webpage";

const MEDIA_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".ico", ".bmp", ".avif",
  ".mp4", ".webm", ".mov", ".avi", ".mkv", ".mp3", ".wav", ".ogg", ".flac",
]);

function detectUrlType(url: string): UrlType {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();

    if (host.includes("youtube.com") || host.includes("youtu.be")) return "youtube";
    if (host.includes("tiktok.com")) return "tiktok";

    const ext = extname(parsed.pathname).toLowerCase().split("?")[0];
    if (MEDIA_EXTENSIONS.has(ext)) return "direct-media";
  } catch {}
  return "webpage";
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 200);
}

// ── Download Helpers ──

interface DownloadResult {
  path: string;
  size: number;
  source: string;
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function downloadDirect(url: string, outputDir: string, filenameHint?: string): Promise<DownloadResult> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(60_000),
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} downloading ${url}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") || "";

  // Determine filename
  let filename: string;
  if (filenameHint) {
    filename = sanitizeFilename(filenameHint);
  } else {
    const urlPath = new URL(url).pathname;
    const base = basename(urlPath);
    if (base && base.includes(".")) {
      filename = sanitizeFilename(base);
    } else {
      const ext = contentType.includes("png") ? ".png"
        : contentType.includes("gif") ? ".gif"
        : contentType.includes("webp") ? ".webp"
        : contentType.includes("svg") ? ".svg"
        : contentType.includes("mp4") ? ".mp4"
        : contentType.includes("webm") ? ".webm"
        : ".jpg";
      filename = `download-${Date.now()}${ext}`;
    }
  }

  await ensureDir(outputDir);
  const filePath = join(outputDir, filename);

  // Avoid overwrite — append counter if file exists
  let finalPath = filePath;
  let counter = 1;
  while (true) {
    try {
      await fs.access(finalPath);
      const ext = extname(filePath);
      const base = filePath.slice(0, -ext.length);
      finalPath = `${base}-${counter}${ext}`;
      counter++;
    } catch {
      break; // file doesn't exist, good
    }
  }

  await fs.writeFile(finalPath, buffer);
  return { path: finalPath, size: buffer.length, source: url };
}

// ── Page Media Extraction ──

interface ExtractedMedia {
  images: string[];
  ogImages: string[];
  videos: string[];
}

function extractMediaUrls(html: string, pageUrl: string): ExtractedMedia {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  const resolve = (href: string): string | null => {
    if (!href || href.startsWith("data:")) return null;
    try {
      return new URL(href, base).href;
    } catch {
      return null;
    }
  };

  const images: string[] = [];
  const ogImages: string[] = [];
  const videos: string[] = [];
  const seen = new Set<string>();

  // og:image, twitter:image
  $('meta[property="og:image"], meta[name="twitter:image"]').each((_, el) => {
    const content = $(el).attr("content");
    const url = content ? resolve(content) : null;
    if (url && !seen.has(url)) {
      seen.add(url);
      ogImages.push(url);
    }
  });

  // <img> tags
  $("img").each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src") || $(el).attr("data-lazy-src");
    const url = src ? resolve(src) : null;
    if (url && !seen.has(url)) {
      seen.add(url);
      images.push(url);
    }
    // Also check srcset
    const srcset = $(el).attr("srcset");
    if (srcset) {
      const urls = srcset.split(",").map((s) => s.trim().split(/\s+/)[0]);
      for (const u of urls) {
        const resolved = resolve(u);
        if (resolved && !seen.has(resolved)) {
          seen.add(resolved);
          images.push(resolved);
        }
      }
    }
  });

  // <video> and <source> tags
  $("video").each((_, el) => {
    const src = $(el).attr("src");
    const url = src ? resolve(src) : null;
    if (url && !seen.has(url)) {
      seen.add(url);
      videos.push(url);
    }
  });
  $("video source").each((_, el) => {
    const src = $(el).attr("src");
    const url = src ? resolve(src) : null;
    if (url && !seen.has(url)) {
      seen.add(url);
      videos.push(url);
    }
  });

  return { images, ogImages, videos };
}

// ── YouTube Download ──

async function downloadYouTube(url: string, outputDir: string): Promise<DownloadResult> {
  const ytdl = (await import("@distube/ytdl-core")).default;

  const info = await ytdl.getInfo(url);
  const title = sanitizeFilename(info.videoDetails.title || `youtube-${info.videoDetails.videoId}`);

  // Pick best format with both audio and video, preferring mp4
  const format = ytdl.chooseFormat(info.formats, {
    quality: "highest",
    filter: (f) => f.hasVideo && f.hasAudio && f.container === "mp4",
  }) || ytdl.chooseFormat(info.formats, {
    quality: "highest",
    filter: (f) => f.hasVideo && f.hasAudio,
  });

  if (!format) {
    throw new Error("No suitable video format found");
  }

  // Download using fetch with the format URL
  const response = await fetch(format.url, {
    signal: AbortSignal.timeout(300_000), // 5 min timeout for large files
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} downloading YouTube video`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const ext = format.container === "webm" ? ".webm" : ".mp4";
  const filename = `${title}${ext}`;

  await ensureDir(outputDir);
  const filePath = join(outputDir, filename);
  await fs.writeFile(filePath, buffer);

  return { path: filePath, size: buffer.length, source: url };
}

// ── TikTok Download ──

async function downloadTikTok(url: string, outputDir: string): Promise<DownloadResult> {
  if (!(await isPlaywrightAvailable())) {
    throw new Error("rebrowser-playwright is required for TikTok downloads. Install with: npm i rebrowser-playwright");
  }

  const handle = await acquirePage();
  try {
    const { page } = handle;
    await page.goto(url, { waitUntil: "load", timeout: 30_000 });
    await page.waitForTimeout(3000);

    // Extract video src from the page
    const videoSrc = await page.evaluate(() => {
      const video = document.querySelector("video");
      if (video?.src) return video.src;
      const source = document.querySelector("video source");
      if (source && (source as HTMLSourceElement).src) return (source as HTMLSourceElement).src;
      return null;
    });

    if (!videoSrc) {
      throw new Error("Could not find video element on TikTok page");
    }

    // Download from browser context (may have session cookies)
    const videoBase64 = await page.evaluate(async (src: string) => {
      const resp = await fetch(src);
      if (!resp.ok) return null;
      const buf = await resp.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    }, videoSrc);

    if (!videoBase64) {
      throw new Error("Failed to download TikTok video data");
    }

    const buffer = Buffer.from(videoBase64, "base64");

    // Extract video ID from URL
    const match = url.match(/video\/(\d+)/);
    const videoId = match ? match[1] : Date.now().toString();
    const filename = `tiktok-${videoId}.mp4`;

    await ensureDir(outputDir);
    const filePath = join(outputDir, filename);
    await fs.writeFile(filePath, buffer);

    return { path: filePath, size: buffer.length, source: url };
  } finally {
    await handle.cleanup();
  }
}

// ── Execute ──

export async function execute(input: DownloadInput) {
  try {
    // Collect URLs for bulk mode
    let urls: string[] = [];

    if (input.urls) {
      urls = input.urls.split(",").map((u) => u.trim()).filter(Boolean);
    } else if (input.file) {
      const content = await fs.readFile(input.file, "utf-8");
      urls = content.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    } else if (input.url) {
      urls = [input.url];
    } else {
      return errorResult("Provide --url, --urls, or --file");
    }

    if (urls.length === 0) {
      return errorResult("No valid URLs provided");
    }

    const results: DownloadResult[] = [];
    const errors: Array<{ url: string; error: string }> = [];

    for (const url of urls) {
      try {
        const type = detectUrlType(url);
        debugLog("download", `Processing ${url} (type: ${type})`);

        switch (type) {
          case "youtube": {
            const r = await downloadYouTube(url, input.output);
            results.push(r);
            break;
          }
          case "tiktok": {
            const r = await downloadTikTok(url, input.output);
            results.push(r);
            break;
          }
          case "direct-media": {
            const r = await downloadDirect(url, input.output);
            results.push(r);
            break;
          }
          case "webpage": {
            // Fetch page and extract media
            const pageResult = await smartFetch(url, { maxLevel: 2 });
            const media = extractMediaUrls(pageResult.html, pageResult.url);

            let toDownload: string[] = [];

            if (input.og_only) {
              toDownload = media.ogImages;
            } else if (input.images) {
              toDownload = [...media.ogImages, ...media.images];
            } else if (input.video) {
              toDownload = media.videos;
            } else if (input.all) {
              toDownload = [...media.ogImages, ...media.images, ...media.videos];
            } else {
              // Default: og:image if available, else first few images
              toDownload = media.ogImages.length > 0 ? media.ogImages : media.images.slice(0, 5);
            }

            if (toDownload.length === 0) {
              errors.push({ url, error: "No media found on page" });
              break;
            }

            // Download in sequence to avoid overwhelming target server
            let count = 0;
            for (const mediaUrl of toDownload) {
              try {
                count++;
                const hostname = new URL(url).hostname.replace(/^www\./, "");
                const hint = `${sanitizeFilename(hostname)}-${count}${extname(new URL(mediaUrl).pathname) || ".jpg"}`;
                const r = await downloadDirect(mediaUrl, input.output, hint);
                results.push(r);
              } catch (err) {
                debugLog("download", `Failed to download ${mediaUrl}`, err);
                errors.push({ url: mediaUrl, error: err instanceof Error ? err.message : String(err) });
              }
            }
            break;
          }
        }
      } catch (err) {
        debugLog("download", `Failed to process ${url}`, err);
        errors.push({ url, error: err instanceof Error ? err.message : String(err) });
      }
    }

    const totalSize = results.reduce((sum, r) => sum + r.size, 0);

    return toolResult({
      downloaded: results.length,
      failed: errors.length,
      total_size: totalSize,
      total_size_human: formatSize(totalSize),
      files: results.map((r) => ({
        path: r.path,
        size: r.size,
        size_human: formatSize(r.size),
        source: r.source,
      })),
      ...(errors.length > 0 ? { errors } : {}),
    });
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}
