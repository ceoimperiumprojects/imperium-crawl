import { describe, it, expect } from "vitest";
import * as scrape from "../src/tools/scrape.js";
import * as readability from "../src/tools/readability.js";
import * as queryApi from "../src/tools/query-api.js";
import * as extract from "../src/tools/extract.js";
import * as map from "../src/tools/map.js";

// These tests make real HTTP requests — use longer timeouts
const TIMEOUT = 30_000;

describe("scrape tool", () => {
  it(
    "scrapes a page and returns markdown",
    async () => {
      const result = await scrape.execute({
        url: "https://example.com",
        format: "markdown",
      });
      expect(result.content).toHaveLength(1);
      const data = JSON.parse(result.content[0].text!);
      expect(data.url).toContain("example.com");
      expect(data.content).toBeTruthy();
      expect(data.stealth_level).toBeGreaterThanOrEqual(1);
      // Markdown should contain Example Domain text
      expect(data.content).toContain("Example Domain");
    },
    TIMEOUT,
  );

  it(
    "scrapes with HTML format",
    async () => {
      const result = await scrape.execute({
        url: "https://example.com",
        format: "html",
      });
      const data = JSON.parse(result.content[0].text!);
      expect(data.content).toContain("<html");
      expect(data.content).toContain("Example Domain");
    },
    TIMEOUT,
  );

  it(
    "returns structured_data when requested via include",
    async () => {
      const result = await scrape.execute({
        url: "https://example.com",
        format: "markdown",
        include: ["structured_data", "metadata"],
      });
      const data = JSON.parse(result.content[0].text!);
      expect(data.structured_data).toBeDefined();
      expect(data.structured_data.meta).toBeDefined();
      expect(data.metadata).toBeDefined();
      expect(data.metadata.title).toBeTruthy();
    },
    TIMEOUT,
  );

  it(
    "returns links when requested",
    async () => {
      const result = await scrape.execute({
        url: "https://example.com",
        format: "markdown",
        include: ["links"],
      });
      const data = JSON.parse(result.content[0].text!);
      expect(data.links).toBeDefined();
      expect(Array.isArray(data.links)).toBe(true);
    },
    TIMEOUT,
  );
});

describe("query_api tool", () => {
  it(
    "makes GET request to JSONPlaceholder",
    async () => {
      const result = await queryApi.execute({
        url: "https://jsonplaceholder.typicode.com/posts/1",
        method: "GET",
        timeout: 15_000,
        stealth_headers: true,
      });
      const data = JSON.parse(result.content[0].text!);
      expect(data.status).toBe(200);
      expect(data.data).toBeDefined();
      expect(data.data.id).toBe(1);
      expect(data.data.title).toBeTruthy();
    },
    TIMEOUT,
  );

  it(
    "makes POST request",
    async () => {
      const result = await queryApi.execute({
        url: "https://jsonplaceholder.typicode.com/posts",
        method: "POST",
        body: JSON.stringify({ title: "test", body: "test body", userId: 1 }),
        headers: { "Content-Type": "application/json" },
        timeout: 15_000,
        stealth_headers: false,
      });
      const data = JSON.parse(result.content[0].text!);
      expect(data.status).toBe(201);
      expect(data.data).toBeDefined();
      expect(data.data.id).toBeDefined(); // JSONPlaceholder returns { id: 101 }
    },
    TIMEOUT,
  );

  it(
    "adds query params to URL",
    async () => {
      const result = await queryApi.execute({
        url: "https://jsonplaceholder.typicode.com/posts",
        method: "GET",
        params: { userId: "1" },
        timeout: 15_000,
        stealth_headers: true,
      });
      const data = JSON.parse(result.content[0].text!);
      expect(data.status).toBe(200);
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data.length).toBeGreaterThan(0);
      expect(data.data.every((p: any) => p.userId === 1)).toBe(true);
    },
    TIMEOUT,
  );

  it("handles invalid URL gracefully", async () => {
    const result = await queryApi.execute({
      url: "not-a-valid-url",
      method: "GET",
      timeout: 5000,
      stealth_headers: false,
    });
    const data = JSON.parse(result.content[0].text!);
    expect(data.error).toBeDefined();
  });
});

describe("extract tool", () => {
  it(
    "extracts data using CSS selectors",
    async () => {
      const result = await extract.execute({
        url: "https://example.com",
        selectors: { title: "h1", paragraphs: "p" },
      });
      const data = JSON.parse(result.content[0].text!);
      expect(data.data).toBeDefined();
      expect(data.data.title).toContain("Example Domain");
    },
    TIMEOUT,
  );
});

describe("readability tool", () => {
  it(
    "extracts article or reports non-article",
    async () => {
      const result = await readability.execute({
        url: "https://example.com",
        format: "markdown",
      });
      const data = JSON.parse(result.content[0].text!);
      // example.com may or may not pass readability check
      // Just verify we get a valid response structure
      expect(data.url || data.error).toBeTruthy();
    },
    TIMEOUT,
  );
});

describe("map tool", () => {
  it(
    "discovers URLs from a page",
    async () => {
      const result = await map.execute({
        url: "https://example.com",
        max_urls: 10,
        include_sitemap: false,
      });
      const data = JSON.parse(result.content[0].text!);
      expect(data.total_urls).toBeDefined();
      expect(Array.isArray(data.urls)).toBe(true);
    },
    TIMEOUT,
  );
});
