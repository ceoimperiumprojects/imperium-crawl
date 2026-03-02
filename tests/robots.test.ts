import { describe, it, expect, afterEach, vi } from "vitest";
import { isAllowed, getSitemapUrls } from "../src/utils/robots.js";

// We mock global.fetch to control robots.txt responses
// NOTE: the robots module has an internal cache keyed by base URL.
// We use unique domains per test to avoid cache interference.
const originalFetch = global.fetch;

function mockFetch(robotsTxtContent: string, ok = true) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    text: async () => robotsTxtContent,
  }) as unknown as typeof fetch;
}

function mockFetchError() {
  global.fetch = vi.fn().mockRejectedValue(new Error("Network error")) as unknown as typeof fetch;
}

describe("robots.txt", () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("allows URL when robots.txt permits", async () => {
    mockFetch(`User-agent: *\nAllow: /`);
    const allowed = await isAllowed("https://allow-test.com/page");
    expect(allowed).toBe(true);
  });

  it("blocks URL when robots.txt disallows", async () => {
    mockFetch(`User-agent: *\nDisallow: /private/`);
    const allowed = await isAllowed("https://block-test.com/private/secret");
    expect(allowed).toBe(false);
  });

  it("allows URL when fetch fails (permissive default)", async () => {
    mockFetchError();
    const allowed = await isAllowed("https://unreachable-test.com/page");
    expect(allowed).toBe(true);
  });

  it("allows URL when robots.txt returns non-ok status", async () => {
    mockFetch("", false); // 404 response
    const allowed = await isAllowed("https://notfound-test.com/page");
    expect(allowed).toBe(true);
  });

  it("extracts sitemap URLs", async () => {
    mockFetch(
      `User-agent: *\nAllow: /\nSitemap: https://sitemap-test.com/sitemap.xml\nSitemap: https://sitemap-test.com/sitemap2.xml`,
    );
    const sitemaps = await getSitemapUrls("https://sitemap-test.com/page");
    expect(sitemaps).toContain("https://sitemap-test.com/sitemap.xml");
    expect(sitemaps).toContain("https://sitemap-test.com/sitemap2.xml");
  });

  it("returns empty sitemaps when none declared", async () => {
    mockFetch(`User-agent: *\nAllow: /`);
    const sitemaps = await getSitemapUrls("https://nositemaps-test.com/page");
    expect(sitemaps).toHaveLength(0);
  });

  it("returns empty sitemaps on fetch error", async () => {
    mockFetchError();
    const sitemaps = await getSitemapUrls("https://unreachable-sitemap.com/page");
    expect(sitemaps).toHaveLength(0);
  });

  it("respects specific user-agent rules", async () => {
    mockFetch(
      `User-agent: *\nAllow: /\n\nUser-agent: BadBot\nDisallow: /`,
    );
    // Default user-agent (*) should be allowed
    const allowed = await isAllowed("https://ua-test.com/page", "*");
    expect(allowed).toBe(true);
  });
});
