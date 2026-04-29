/**
 * Browser-based image extraction engine for imperium-crawl v2.5.1
 * Executes inside the browser via page.evaluate() for 100% coverage.
 *
 * Discovers images from:
 * - <img> tags (src, data-src, data-lazy-src, srcset)
 * - <picture> + <source srcset>
 * - Inline style="background-image:url(...)"
 * - All <style> tags → parsed CSS rules → background-image
 * - Shadow DOM — recursively walks all web components
 * - JSON-LD <script type="application/ld+json"> → image/images fields
 * - Inline <script> window.__INITIAL_STATE__ / __DATA__ → regex image URLs
 * - Same-origin iframes → recursive DOM scan
 *
 * Triggers lazy-load via scroll, optionally auto-clicks "load more" buttons.
 */

import { debugLog } from "../utils/debug.js";

export interface ExtractedImage {
  url: string;
  alt: string;
  width: number;
  height: number;
  selector: string;
  source:
    | "img"
    | "background-inline"
    | "background-css"
    | "picture"
    | "jsonld"
    | "inline-script"
    | "iframe";
}

export interface ImageExtractionOptions {
  /** Scroll full page to trigger lazy loading */
  scrollFull?: boolean;
  /** Auto-click "load more" / "gallery" buttons before extraction */
  autoClick?: boolean;
  /** Scan same-origin iframes recursively */
  iframeScan?: boolean;
  /** Wait for a CSS selector to exist before extracting */
  waitForSelector?: string;
  /** Minimum image width (px) to include */
  minWidth?: number;
  /** Maximum image width (px) to include */
  maxWidth?: number;
  /** Hard limit on number of images returned */
  limit?: number;
}

// ── Browser-side extraction script (runs inside page.evaluate) ──

const EXTRACTION_SCRIPT = `
(() => {
  const results = [];
  const seen = new Set();

  function resolveUrl(href, base) {
    if (!href || href.startsWith("data:")) return null;
    try {
      return new URL(href, base).href;
    } catch { return null; }
  }

  function addImage(url, alt, width, height, selector, source) {
    if (!url || seen.has(url)) return;
    seen.add(url);
    results.push({ url, alt: alt || "", width: width || 0, height: height || 0, selector, source });
  }

  function extractFromRoot(root, docUrl, prefix) {
    // 1. <img> tags
    root.querySelectorAll("img").forEach((img) => {
      const src = img.currentSrc || img.src || img.dataset.src || img.dataset.lazySrc || img.getAttribute("data-src");
      if (src) {
        const url = resolveUrl(src, docUrl);
        if (url) addImage(url, img.alt, img.naturalWidth, img.naturalHeight, prefix + getSelector(img), "img");
      }
      // srcset
      const srcset = img.srcset || img.getAttribute("data-srcset");
      if (srcset) {
        srcset.split(",").forEach((s) => {
          const u = s.trim().split(/\\s+/)[0];
          const url = resolveUrl(u, docUrl);
          if (url) addImage(url, img.alt, img.naturalWidth, img.naturalHeight, prefix + getSelector(img), "img");
        });
      }
    });

    // 2. <picture> + <source srcset>
    root.querySelectorAll("picture").forEach((pic) => {
      pic.querySelectorAll("source").forEach((source) => {
        const srcset = source.srcset || source.getAttribute("data-srcset");
        if (srcset) {
          srcset.split(",").forEach((s) => {
            const u = s.trim().split(/\\s+/)[0];
            const url = resolveUrl(u, docUrl);
            if (url) addImage(url, "", 0, 0, prefix + getSelector(pic), "picture");
          });
        }
      });
    });

    // 3. Inline style background-image
    root.querySelectorAll("*[style]").forEach((el) => {
      const style = el.getAttribute("style") || "";
      const match = style.match(/background-image\\s*:\\s*url\\([\"']?([^\"')]+)[\"']?\\)/i);
      if (match) {
        const url = resolveUrl(match[1], docUrl);
        if (url) addImage(url, "", 0, 0, prefix + getSelector(el), "background-inline");
      }
    });

    // 4. <style> tag CSS parsing
    root.querySelectorAll("style").forEach((styleTag) => {
      const css = styleTag.textContent || "";
      const regex = /background-image\\s*:\\s*url\\([\"']?([^\"')]+)[\"']?\\)/gi;
      let m;
      while ((m = regex.exec(css)) !== null) {
        const url = resolveUrl(m[1], docUrl);
        if (url) addImage(url, "", 0, 0, prefix + "<style>", "background-css");
      }
    });

    // 5. JSON-LD
    root.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
      try {
        const data = JSON.parse(script.textContent || "{}");
        const extractImages = (obj) => {
          if (!obj) return;
          if (typeof obj === "string" && /^https?:\\/\\//.test(obj) && /\\.(jpg|jpeg|png|gif|webp|svg|avif|bmp)(\\?|$)/i.test(obj)) {
            addImage(obj, "", 0, 0, prefix + "<json-ld>", "jsonld");
            return;
          }
          if (Array.isArray(obj)) { obj.forEach(extractImages); return; }
          if (typeof obj === "object") {
            if (obj.image) extractImages(obj.image);
            if (obj.images) extractImages(obj.images);
            if (obj.thumbnailUrl) extractImages(obj.thumbnailUrl);
            if (obj.contentUrl && /\\.(jpg|jpeg|png|gif|webp|svg|avif|bmp)(\\?|$)/i.test(obj.contentUrl)) {
              addImage(obj.contentUrl, obj.name || "", 0, 0, prefix + "<json-ld>", "jsonld");
            }
            Object.values(obj).forEach((v) => {
              if (typeof v === "string" && /^https?:\\/\\//.test(v) && /\\.(jpg|jpeg|png|gif|webp|svg|avif|bmp)(\\?|$)/i.test(v)) {
                addImage(v, "", 0, 0, prefix + "<json-ld>", "jsonld");
              }
            });
          }
        };
        extractImages(data);
      } catch {}
    });

    // 6. Inline scripts — window.__INITIAL_STATE__, __DATA__, etc.
    root.querySelectorAll("script:not([src])").forEach((script) => {
      const text = script.textContent || "";
      const regex = /https?:\\/\\/[^\\s\"'<>]+\\.(jpg|jpeg|png|gif|webp|svg|avif|bmp)(\\?[^\\s\"'<>]*)?/gi;
      let m;
      while ((m = regex.exec(text)) !== null) {
        addImage(m[0], "", 0, 0, prefix + "<inline-script>", "inline-script");
      }
    });

    // 7. Shadow DOM recursion
    root.querySelectorAll("*").forEach((el) => {
      if (el.shadowRoot) {
        extractFromRoot(el.shadowRoot, docUrl, prefix + getSelector(el) + "::shadow ");
      }
    });
  }

  function getSelector(el) {
    if (el.id) return "#" + el.id;
    let path = el.tagName.toLowerCase();
    if (el.className && typeof el.className === "string") {
      path += "." + el.className.split(/\\s+/).filter(Boolean).join(".");
    }
    return path;
  }

  // Main extraction
  extractFromRoot(document, document.location.href, "");

  return results;
})()
`;

// ── Auto-click script (runs inside page.evaluate) ──

const AUTOCLICK_SCRIPT = `
(() => {
  const keywords = [
    "show more", "load more", "gallery", "view images", "view photos",
    "prikaži više", "učitaj još", "galerija", "slike", "fotografije",
    "photos", "images", "see more", "more images", "more photos",
    "expand", "prikazi jos", "jos slika", "vise slika",
  ];
  const clicked = [];
  const buttons = Array.from(document.querySelectorAll("button, a, [role=button], .btn, .button, [class*=gallery], [class*=image], [class*=photo], [class*=more], [class*=load]"));
  for (const btn of buttons) {
    const text = (btn.textContent || btn.title || btn.getAttribute("aria-label") || "").toLowerCase();
    const found = keywords.some((k) => text.includes(k));
    if (found && btn.offsetParent !== null) {
      try {
        btn.click();
        btn.scrollIntoView({ behavior: "instant", block: "center" });
        clicked.push(text.slice(0, 100));
      } catch {}
    }
  }
  return clicked;
})()
`;

// ── Node.js API ──

export async function extractImagesFromPage(
  page: any, // Playwright Page
  options: ImageExtractionOptions = {},
): Promise<ExtractedImage[]> {
  const {
    scrollFull = false,
    autoClick = false,
    iframeScan = false,
    waitForSelector,
    minWidth = 0,
    maxWidth = 99999,
    limit = 500,
  } = options;

  // Wait for selector if requested
  if (waitForSelector) {
    try {
      await page.waitForSelector(waitForSelector, { timeout: 10_000 });
    } catch {
      debugLog("image-extract", `waitForSelector "${waitForSelector}" timed out, continuing anyway`);
    }
  }

  // Scroll full page to trigger lazy loading
  if (scrollFull) {
    await scrollFullPage(page);
  }

  // Auto-click "load more" buttons
  if (autoClick) {
    for (let i = 0; i < 5; i++) {
      const clicked: string[] = await page.evaluate(AUTOCLICK_SCRIPT);
      if (clicked.length === 0) break;
      debugLog("image-extract", `Auto-clicked: ${clicked.join(", ")}`);
      await page.waitForTimeout(2500);
      if (scrollFull) await scrollFullPage(page);
    }
  }

  // Main extraction
  let images: ExtractedImage[] = await page.evaluate(EXTRACTION_SCRIPT);

  // Iframe scan (same-origin only)
  if (iframeScan) {
    const iframeImages = await extractFromIframes(page, options);
    images = images.concat(iframeImages);
  }

  // Deduplicate by URL
  const unique = new Map<string, ExtractedImage>();
  for (const img of images) {
    if (!unique.has(img.url)) unique.set(img.url, img);
  }
  images = Array.from(unique.values());

  // Filter by dimensions
  images = images.filter((img) => img.width >= minWidth && img.width <= maxWidth);

  // Limit
  if (limit > 0 && images.length > limit) {
    images = images.slice(0, limit);
  }

  debugLog("image-extract", `Discovered ${images.length} unique images`);
  return images;
}

async function scrollFullPage(page: any): Promise<void> {
  await page.evaluate(async () => {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const height = document.body.scrollHeight;
    const viewport = window.innerHeight;
    let current = 0;
    while (current < height) {
      current += viewport;
      window.scrollTo(0, current);
      await delay(800);
    }
    window.scrollTo(0, 0);
    await delay(500);
  });
}

async function extractFromIframes(
  page: any,
  options: ImageExtractionOptions,
): Promise<ExtractedImage[]> {
  const frames = page.frames();
  const results: ExtractedImage[] = [];

  for (const frame of frames) {
    if (frame === page.mainFrame()) continue;
    try {
      const url = frame.url();
      if (!url || url === "about:blank") continue;
      // Only same-origin frames (cross-origin frames block evaluate)
      const frameImages: ExtractedImage[] = await frame.evaluate(EXTRACTION_SCRIPT);
      for (const img of frameImages) {
        img.source = "iframe";
        results.push(img);
      }
    } catch {
      // Cross-origin or detached frame — skip
    }
  }

  return results;
}
