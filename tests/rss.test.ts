import { describe, it, expect } from "vitest";
import { schema } from "../src/tools/rss.js";

describe("RSS tool", () => {
  describe("schema validation", () => {
    it("accepts valid input", () => {
      const result = schema.safeParse({ url: "https://techcrunch.com/feed/" });
      expect(result.success).toBe(true);
    });

    it("applies default limit of 20", () => {
      const result = schema.parse({ url: "https://example.com/feed" });
      expect(result.limit).toBe(20);
    });

    it("applies default format of json", () => {
      const result = schema.parse({ url: "https://example.com/feed" });
      expect(result.format).toBe("json");
    });

    it("accepts markdown format", () => {
      const result = schema.safeParse({ url: "https://example.com/feed", format: "markdown" });
      expect(result.success).toBe(true);
    });

    it("accepts --since date filter", () => {
      const result = schema.safeParse({ url: "https://example.com/feed", since: "2026-03-01" });
      expect(result.success).toBe(true);
    });

    it("rejects missing url", () => {
      const result = schema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("enforces limit bounds", () => {
      expect(schema.safeParse({ url: "https://example.com/feed", limit: 0 }).success).toBe(false);
      expect(schema.safeParse({ url: "https://example.com/feed", limit: 101 }).success).toBe(false);
    });

    it("rejects invalid format", () => {
      const result = schema.safeParse({ url: "https://example.com/feed", format: "csv" });
      expect(result.success).toBe(false);
    });
  });
});
