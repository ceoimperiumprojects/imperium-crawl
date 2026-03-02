import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import * as cheerio from "cheerio";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

// GFM plugin: tables, task lists, strikethrough
turndown.use(gfm);

// Remove unwanted elements
turndown.remove(["script", "style", "nav", "footer", "header", "noscript", "iframe"]);

// Add rule to remove SVGs
turndown.addRule("removeSvg", {
  filter: (node) => node.nodeName === "SVG",
  replacement: () => "",
});

// Noise selectors to strip before conversion
const NOISE_SELECTORS = [
  // Ads
  ".advertisement", ".ad", "[class*='ad-']", "[class*='ads-']", "[id*='ad-']",
  ".ad-container", ".ad-wrapper", ".adsbygoogle",
  // Cookie banners
  ".cookie-banner", ".cookie-consent", ".cookie-notice", "[class*='cookie']",
  ".consent-banner", "#cookie-notice", "#gdpr",
  // Popups & modals
  ".popup", ".modal", ".overlay", "[class*='popup']", "[class*='modal']",
  // Social sharing
  ".social-share", ".share-buttons", ".social-links", "[class*='share-']", "[class*='social-']",
  // Comments
  ".comments", ".comment-section", "#comments", "[class*='comment']",
  // Related & recommended
  ".related-articles", ".recommended", "[class*='related-']", "[class*='recommended']",
  // Navigation & structural noise
  "[role='navigation']", "[role='banner']", "[role='complementary']",
  "aside", "[class*='sidebar']",
  // Newsletter & signup
  "[class*='newsletter']", "[class*='subscribe']", "[class*='signup']",
  // Breadcrumbs
  ".breadcrumb", ".breadcrumbs", "[class*='breadcrumb']",
];

/**
 * Clean HTML by removing noise elements (ads, banners, sidebars, etc.)
 * before markdown conversion.
 */
export function cleanHtml(html: string): string {
  const $ = cheerio.load(html);
  for (const selector of NOISE_SELECTORS) {
    try {
      $(selector).remove();
    } catch {
      // Invalid selector, skip
    }
  }
  return $.html();
}

export function htmlToMarkdown(html: string): string {
  const cleaned = cleanHtml(html);
  return turndown.turndown(cleaned).trim();
}
