import { describe, it, expect } from "vitest";
import { schema, computeSignature } from "../../src/tools/watch.js";

describe("watch schema", () => {
  it("requires url", () => {
    expect(schema.safeParse({}).success).toBe(false);
  });

  it("applies defaults", () => {
    const r = schema.parse({ url: "https://example.com" });
    expect(r.output_dir).toBe("./data/watch");
    expect(r.hash_on).toBe("readability");
    expect(r.diff_format).toBe("unified");
    expect(r.one_shot).toBe(true);
  });

  it("rejects invalid hash_on", () => {
    const r = schema.safeParse({ url: "https://example.com", hash_on: "bogus" });
    expect(r.success).toBe(false);
  });

  it("accepts webhook url", () => {
    const r = schema.safeParse({
      url: "https://example.com",
      webhook: "https://hooks.example.com/abc",
    });
    expect(r.success).toBe(true);
  });
});

describe("watch computeSignature", () => {
  it("content strategy returns raw html", async () => {
    const html = "<html><body><p>hi</p></body></html>";
    const sig = await computeSignature(html, "https://example.com", "content");
    expect(sig).toBe(html);
  });

  it("markdown strategy reduces html to markdown text", async () => {
    const html = "<html><body><h1>Hello</h1><p>World</p></body></html>";
    const sig = await computeSignature(html, "https://example.com", "markdown");
    expect(sig).toMatch(/Hello/);
    expect(sig).not.toContain("<h1>");
  });

  it("readability strategy produces stable text for same page", async () => {
    const html =
      "<html><body><article><h1>News</h1><p>" +
      "Some long content that readability can detect as the main body. ".repeat(10) +
      "</p></article></body></html>";
    const a = await computeSignature(html, "https://example.com", "readability");
    const b = await computeSignature(html, "https://example.com", "readability");
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });
});
