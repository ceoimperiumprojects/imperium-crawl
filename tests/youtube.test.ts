import { describe, it, expect } from "vitest";
import { schema } from "../src/tools/youtube.js";

describe("YouTube tool", () => {
  describe("schema validation", () => {
    it("accepts valid search input", () => {
      const result = schema.safeParse({ action: "search", query: "AI news" });
      expect(result.success).toBe(true);
    });

    it("accepts valid video input", () => {
      const result = schema.safeParse({ action: "video", url: "https://youtube.com/watch?v=abc123defgh" });
      expect(result.success).toBe(true);
    });

    it("accepts valid channel input", () => {
      const result = schema.safeParse({ action: "channel", channel_url: "https://youtube.com/@mkbhd" });
      expect(result.success).toBe(true);
    });

    it("accepts valid transcript input", () => {
      const result = schema.safeParse({ action: "transcript", url: "https://youtube.com/watch?v=abc123defgh" });
      expect(result.success).toBe(true);
    });

    it("accepts valid comments input", () => {
      const result = schema.safeParse({ action: "comments", url: "https://youtube.com/watch?v=abc123defgh", limit: 5 });
      expect(result.success).toBe(true);
    });

    it("accepts valid chapters input", () => {
      const result = schema.safeParse({ action: "chapters", url: "https://youtube.com/watch?v=abc123defgh" });
      expect(result.success).toBe(true);
    });

    it("rejects invalid action", () => {
      const result = schema.safeParse({ action: "invalid" });
      expect(result.success).toBe(false);
    });

    it("applies default limit", () => {
      const result = schema.parse({ action: "search", query: "test" });
      expect(result.limit).toBe(10);
    });

    it("applies default sort", () => {
      const result = schema.parse({ action: "search", query: "test" });
      expect(result.sort).toBe("relevance");
    });

    it("enforces limit bounds", () => {
      expect(schema.safeParse({ action: "search", query: "test", limit: 0 }).success).toBe(false);
      expect(schema.safeParse({ action: "search", query: "test", limit: 1001 }).success).toBe(false);
    });
  });
});
