import { describe, it, expect } from "vitest";
import {
  MAX_QUERY_LENGTH,
  MAX_URL_LENGTH,
  MAX_BODY_LENGTH,
  MAX_PAGES,
  MAX_URLS,
  MAX_ITEMS,
  MAX_CONCURRENCY,
  MAX_TIMEOUT_MS,
  MAX_DURATION_SECONDS,
  MAX_WAIT_SECONDS,
  MAX_MESSAGES,
  MAX_SELECTOR_KEYS,
  MAX_SELECTOR_LENGTH,
  MAX_STRING_LENGTH,
} from "../src/constants.js";

import { schema as searchSchema } from "../src/tools/search.js";
import { schema as newsSearchSchema } from "../src/tools/news-search.js";
import { schema as imageSearchSchema } from "../src/tools/image-search.js";
import { schema as videoSearchSchema } from "../src/tools/video-search.js";
import { schema as crawlSchema } from "../src/tools/crawl.js";
import { schema as mapSchema } from "../src/tools/map.js";
import { schema as extractSchema } from "../src/tools/extract.js";
import { schema as scrapeSchema } from "../src/tools/scrape.js";
import { schema as screenshotSchema } from "../src/tools/screenshot.js";
import { schema as readabilitySchema } from "../src/tools/readability.js";
import { schema as queryApiSchema } from "../src/tools/query-api.js";
import { schema as discoverApisSchema } from "../src/tools/discover-apis.js";
import { schema as monitorWsSchema } from "../src/tools/monitor-websocket.js";
import { schema as createSkillSchema } from "../src/tools/create-skill.js";
import { schema as runSkillSchema } from "../src/tools/run-skill.js";


// Helper: string of length n
const strOf = (n: number) => "x".repeat(n);

describe("Search tool schemas", () => {
  const searchSchemas = [
    { name: "search", schema: searchSchema },
    { name: "news_search", schema: newsSearchSchema },
    { name: "image_search", schema: imageSearchSchema },
    { name: "video_search", schema: videoSearchSchema },
  ];

  for (const { name, schema } of searchSchemas) {
    describe(name, () => {
      it("accepts valid query", () => {
        const result = schema.safeParse({ query: "test" });
        expect(result.success).toBe(true);
      });

      it("rejects empty query", () => {
        const result = schema.safeParse({ query: "" });
        expect(result.success).toBe(false);
      });

      it("rejects oversized query", () => {
        const result = schema.safeParse({ query: strOf(MAX_QUERY_LENGTH + 1) });
        expect(result.success).toBe(false);
      });

      it("rejects oversized country code", () => {
        const result = schema.safeParse({ query: "test", country: strOf(11) });
        expect(result.success).toBe(false);
      });
    });
  }
});

describe("Crawl schema", () => {
  it("accepts valid input with defaults", () => {
    const result = crawlSchema.safeParse({ url: "https://example.com" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.max_pages).toBe(10);
      expect(result.data.concurrency).toBe(3);
    }
  });

  it("rejects max_pages > MAX_PAGES", () => {
    const result = crawlSchema.safeParse({ url: "https://example.com", max_pages: MAX_PAGES + 1 });
    expect(result.success).toBe(false);
  });

  it("rejects concurrency > MAX_CONCURRENCY", () => {
    const result = crawlSchema.safeParse({ url: "https://example.com", concurrency: MAX_CONCURRENCY + 1 });
    expect(result.success).toBe(false);
  });

  it("rejects max_depth > 10", () => {
    const result = crawlSchema.safeParse({ url: "https://example.com", max_depth: 11 });
    expect(result.success).toBe(false);
  });

  it("rejects URL over max length", () => {
    const result = crawlSchema.safeParse({ url: "https://example.com/" + strOf(MAX_URL_LENGTH) });
    expect(result.success).toBe(false);
  });
});

describe("Map schema", () => {
  it("rejects max_urls > MAX_URLS", () => {
    const result = mapSchema.safeParse({ url: "https://example.com", max_urls: MAX_URLS + 1 });
    expect(result.success).toBe(false);
  });

  it("accepts valid max_urls", () => {
    const result = mapSchema.safeParse({ url: "https://example.com", max_urls: 500 });
    expect(result.success).toBe(true);
  });
});

describe("Extract schema", () => {
  it("accepts valid selectors", () => {
    const result = extractSchema.safeParse({
      url: "https://example.com",
      selectors: { title: "h1", link: "a @href" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects too many selector keys", () => {
    const selectors: Record<string, string> = {};
    for (let i = 0; i <= MAX_SELECTOR_KEYS; i++) {
      selectors[`field_${i}`] = `.class-${i}`;
    }
    const result = extractSchema.safeParse({
      url: "https://example.com",
      selectors,
    });
    expect(result.success).toBe(false);
  });

  it("rejects oversized selector value", () => {
    const result = extractSchema.safeParse({
      url: "https://example.com",
      selectors: { title: strOf(MAX_SELECTOR_LENGTH + 1) },
    });
    expect(result.success).toBe(false);
  });

  it("rejects oversized items_selector", () => {
    const result = extractSchema.safeParse({
      url: "https://example.com",
      selectors: { title: "h1" },
      items_selector: strOf(MAX_SELECTOR_LENGTH + 1),
    });
    expect(result.success).toBe(false);
  });
});

describe("QueryApi schema", () => {
  it("rejects body > MAX_BODY_LENGTH", () => {
    const result = queryApiSchema.safeParse({
      url: "https://api.example.com",
      body: strOf(MAX_BODY_LENGTH + 1),
    });
    expect(result.success).toBe(false);
  });

  it("rejects timeout > MAX_TIMEOUT_MS", () => {
    const result = queryApiSchema.safeParse({
      url: "https://api.example.com",
      timeout: MAX_TIMEOUT_MS + 1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects timeout < 1", () => {
    const result = queryApiSchema.safeParse({
      url: "https://api.example.com",
      timeout: 0,
    });
    expect(result.success).toBe(false);
  });
});

describe("MonitorWebSocket schema", () => {
  it("rejects duration_seconds > MAX_DURATION_SECONDS", () => {
    const result = monitorWsSchema.safeParse({
      url: "https://example.com",
      duration_seconds: MAX_DURATION_SECONDS + 1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects max_messages > MAX_MESSAGES", () => {
    const result = monitorWsSchema.safeParse({
      url: "https://example.com",
      max_messages: MAX_MESSAGES + 1,
    });
    expect(result.success).toBe(false);
  });
});

describe("DiscoverApis schema", () => {
  it("rejects wait_seconds > MAX_WAIT_SECONDS", () => {
    const result = discoverApisSchema.safeParse({
      url: "https://example.com",
      wait_seconds: MAX_WAIT_SECONDS + 1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects filter_content_type > 200 chars", () => {
    const result = discoverApisSchema.safeParse({
      url: "https://example.com",
      filter_content_type: strOf(201),
    });
    expect(result.success).toBe(false);
  });
});

describe("CreateSkill schema", () => {
  it("rejects empty description", () => {
    const result = createSkillSchema.safeParse({
      url: "https://example.com",
      name: "test-skill",
      description: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects oversized description", () => {
    const result = createSkillSchema.safeParse({
      url: "https://example.com",
      name: "test-skill",
      description: strOf(MAX_STRING_LENGTH + 1),
    });
    expect(result.success).toBe(false);
  });

  it("rejects max_pages > MAX_PAGES", () => {
    const result = createSkillSchema.safeParse({
      url: "https://example.com",
      name: "test-skill",
      description: "Test",
      max_pages: MAX_PAGES + 1,
    });
    expect(result.success).toBe(false);
  });
});

describe("RunSkill schema", () => {
  it("rejects max_items > MAX_ITEMS", () => {
    const result = runSkillSchema.safeParse({
      name: "test-skill",
      max_items: MAX_ITEMS + 1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects max_items < 1", () => {
    const result = runSkillSchema.safeParse({
      name: "test-skill",
      max_items: 0,
    });
    expect(result.success).toBe(false);
  });
});

describe("URL max length on all URL-bearing tools", () => {
  const oversizedUrl = "https://example.com/" + strOf(MAX_URL_LENGTH);

  const urlSchemas = [
    { name: "scrape", schema: scrapeSchema },
    { name: "screenshot", schema: screenshotSchema },
    { name: "readability", schema: readabilitySchema },

  ];

  for (const { name, schema } of urlSchemas) {
    it(`${name} rejects oversized URL`, () => {
      const result = schema.safeParse({ url: oversizedUrl });
      expect(result.success).toBe(false);
    });
  }
});

describe("Proxy max length on proxy-bearing tools", () => {
  const oversizedProxy = "http://" + strOf(MAX_URL_LENGTH);

  const proxySchemas = [
    { name: "scrape", schema: scrapeSchema, extra: {} },
    { name: "crawl", schema: crawlSchema, extra: {} },
    { name: "map", schema: mapSchema, extra: {} },
    { name: "readability", schema: readabilitySchema, extra: {} },
    { name: "query_api", schema: queryApiSchema, extra: {} },
  ];

  for (const { name, schema, extra } of proxySchemas) {
    it(`${name} rejects oversized proxy`, () => {
      const result = schema.safeParse({ url: "https://example.com", proxy: oversizedProxy, ...extra });
      expect(result.success).toBe(false);
    });
  }
});

describe("Chrome profile max length", () => {
  const oversizedPath = strOf(1001);

  it("crawl rejects oversized chrome_profile", () => {
    const result = crawlSchema.safeParse({ url: "https://example.com", chrome_profile: oversizedPath });
    expect(result.success).toBe(false);
  });

  it("scrape rejects oversized chrome_profile", () => {
    const result = scrapeSchema.safeParse({ url: "https://example.com", chrome_profile: oversizedPath });
    expect(result.success).toBe(false);
  });
});
