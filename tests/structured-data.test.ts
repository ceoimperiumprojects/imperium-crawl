import { describe, it, expect } from "vitest";
import { extractStructuredData, extractLinks } from "../src/utils/structured-data.js";
import * as cheerio from "cheerio";

describe("extractStructuredData", () => {
  // ── JSON-LD ──
  describe("JSON-LD", () => {
    it("extracts single JSON-LD object", () => {
      const html = `<html><head>
        <script type="application/ld+json">{"@type":"Article","headline":"Test Article","author":"John"}</script>
      </head><body></body></html>`;
      const result = extractStructuredData(html);
      expect(result.jsonLd).toHaveLength(1);
      expect(result.jsonLd[0]).toMatchObject({ "@type": "Article", headline: "Test Article" });
    });

    it("extracts multiple JSON-LD blocks", () => {
      const html = `<html><head>
        <script type="application/ld+json">{"@type":"Article","headline":"Test"}</script>
        <script type="application/ld+json">{"@type":"BreadcrumbList"}</script>
      </head><body></body></html>`;
      const result = extractStructuredData(html);
      expect(result.jsonLd).toHaveLength(2);
    });

    it("handles JSON-LD array", () => {
      const html = `<html><head>
        <script type="application/ld+json">[{"@type":"Article"},{"@type":"Organization"}]</script>
      </head><body></body></html>`;
      const result = extractStructuredData(html);
      expect(result.jsonLd).toHaveLength(2);
    });

    it("skips malformed JSON-LD gracefully", () => {
      const html = `<html><head>
        <script type="application/ld+json">{broken json</script>
        <script type="application/ld+json">{"@type":"Valid"}</script>
      </head><body></body></html>`;
      const result = extractStructuredData(html);
      expect(result.jsonLd).toHaveLength(1);
      expect(result.jsonLd[0]).toMatchObject({ "@type": "Valid" });
    });
  });

  // ── OpenGraph ──
  describe("OpenGraph", () => {
    it("extracts og: meta tags", () => {
      const html = `<html><head>
        <meta property="og:title" content="My Page">
        <meta property="og:description" content="Page description">
        <meta property="og:image" content="https://example.com/img.jpg">
        <meta property="og:url" content="https://example.com/page">
      </head><body></body></html>`;
      const result = extractStructuredData(html);
      expect(result.openGraph["og:title"]).toBe("My Page");
      expect(result.openGraph["og:description"]).toBe("Page description");
      expect(result.openGraph["og:image"]).toBe("https://example.com/img.jpg");
    });
  });

  // ── Twitter Cards ──
  describe("Twitter Cards", () => {
    it("extracts twitter: meta tags", () => {
      const html = `<html><head>
        <meta name="twitter:card" content="summary_large_image">
        <meta name="twitter:title" content="Tweet Title">
      </head><body></body></html>`;
      const result = extractStructuredData(html);
      expect(result.twitterCards["twitter:card"]).toBe("summary_large_image");
      expect(result.twitterCards["twitter:title"]).toBe("Tweet Title");
    });
  });

  // ── Microdata ──
  describe("Microdata", () => {
    it("extracts microdata items", () => {
      const html = `<html><body>
        <div itemscope itemtype="https://schema.org/Product">
          <span itemprop="name">Cool Product</span>
          <meta itemprop="price" content="19.99">
          <a itemprop="url" href="https://example.com/product">Link</a>
        </div>
      </body></html>`;
      const result = extractStructuredData(html);
      expect(result.microdata).toHaveLength(1);
      expect(result.microdata[0]).toMatchObject({
        "@type": "https://schema.org/Product",
        name: "Cool Product",
        price: "19.99",
        url: "https://example.com/product",
      });
    });
  });

  // ── Page Meta ──
  describe("Page metadata", () => {
    it("extracts title, description, canonical, language, author", () => {
      const html = `<html lang="en"><head>
        <title>My Page Title</title>
        <meta name="description" content="This is the description">
        <link rel="canonical" href="https://example.com/page">
        <meta name="author" content="John Doe">
      </head><body></body></html>`;
      const result = extractStructuredData(html);
      expect(result.meta.title).toBe("My Page Title");
      expect(result.meta.description).toBe("This is the description");
      expect(result.meta.canonical).toBe("https://example.com/page");
      expect(result.meta.language).toBe("en");
      expect(result.meta.author).toBe("John Doe");
    });

    it("handles missing meta gracefully", () => {
      const html = `<html><head></head><body></body></html>`;
      const result = extractStructuredData(html);
      expect(result.meta.title).toBe("");
      expect(result.meta.description).toBe("");
    });
  });

  // ── Empty / No data ──
  describe("Edge cases", () => {
    it("returns empty arrays for page with no structured data", () => {
      const html = `<html><body><p>Just text</p></body></html>`;
      const result = extractStructuredData(html);
      expect(result.jsonLd).toHaveLength(0);
      expect(result.openGraph).toEqual({});
      expect(result.twitterCards).toEqual({});
      expect(result.microdata).toHaveLength(0);
    });
  });
});

// ── extractLinks ──

describe("extractLinks", () => {
  it("extracts absolute and relative links", () => {
    const html = `<html><body>
      <a href="https://example.com/page1">Page 1</a>
      <a href="/page2">Page 2</a>
      <a href="page3">Page 3</a>
    </body></html>`;
    const $ = cheerio.load(html);
    const links = extractLinks($, "https://example.com");
    expect(links).toContain("https://example.com/page1");
    expect(links).toContain("https://example.com/page2");
    expect(links).toContain("https://example.com/page3");
  });

  it("deduplicates links", () => {
    const html = `<html><body>
      <a href="https://example.com/page">Link 1</a>
      <a href="https://example.com/page">Link 2</a>
    </body></html>`;
    const $ = cheerio.load(html);
    const links = extractLinks($, "https://example.com");
    expect(links.filter((l) => l === "https://example.com/page")).toHaveLength(1);
  });

  it("skips mailto, javascript, and fragment-only links", () => {
    const html = `<html><body>
      <a href="mailto:test@example.com">Email</a>
      <a href="javascript:void(0)">JS</a>
      <a href="#section">Fragment</a>
      <a href="https://example.com/real">Real</a>
    </body></html>`;
    const $ = cheerio.load(html);
    const links = extractLinks($, "https://example.com");
    expect(links).toHaveLength(1);
    expect(links[0]).toBe("https://example.com/real");
  });
});
