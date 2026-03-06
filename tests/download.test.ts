import { describe, it, expect } from "vitest";
import { schema } from "../src/tools/download.js";

describe("Download tool", () => {
  describe("schema validation", () => {
    it("accepts valid url + output input", () => {
      const result = schema.safeParse({ url: "https://example.com/image.jpg", output: "/tmp/test" });
      expect(result.success).toBe(true);
    });

    it("accepts --urls for bulk mode", () => {
      const result = schema.safeParse({ urls: "https://a.com/1.jpg,https://b.com/2.jpg", output: "/tmp/test" });
      expect(result.success).toBe(true);
    });

    it("accepts --file for bulk mode", () => {
      const result = schema.safeParse({ file: "/tmp/urls.txt", output: "/tmp/test" });
      expect(result.success).toBe(true);
    });

    it("accepts --images flag", () => {
      const result = schema.safeParse({ url: "https://example.com/gallery", output: "/tmp/test", images: true });
      expect(result.success).toBe(true);
      expect(result.data!.images).toBe(true);
    });

    it("accepts --og-only flag", () => {
      const result = schema.safeParse({ url: "https://example.com/article", output: "/tmp/test", og_only: true });
      expect(result.success).toBe(true);
      expect(result.data!.og_only).toBe(true);
    });

    it("accepts --video flag", () => {
      const result = schema.safeParse({ url: "https://example.com/page", output: "/tmp/test", video: true });
      expect(result.success).toBe(true);
    });

    it("accepts --all flag", () => {
      const result = schema.safeParse({ url: "https://example.com/page", output: "/tmp/test", all: true });
      expect(result.success).toBe(true);
      expect(result.data!.all).toBe(true);
    });

    it("requires output directory", () => {
      const result = schema.safeParse({ url: "https://example.com/image.jpg" });
      expect(result.success).toBe(false);
    });

    it("defaults boolean flags to false", () => {
      const result = schema.parse({ url: "https://example.com", output: "/tmp" });
      expect(result.images).toBe(false);
      expect(result.og_only).toBe(false);
      expect(result.video).toBe(false);
      expect(result.all).toBe(false);
    });
  });

  describe("URL type detection", () => {
    // We test the detectUrlType function indirectly through execute behavior,
    // but we can validate schema accepts all URL types
    it("accepts YouTube URLs", () => {
      const result = schema.safeParse({ url: "https://youtube.com/watch?v=abc123", output: "/tmp" });
      expect(result.success).toBe(true);
    });

    it("accepts TikTok URLs", () => {
      const result = schema.safeParse({ url: "https://tiktok.com/@user/video/123", output: "/tmp" });
      expect(result.success).toBe(true);
    });

    it("accepts direct media URLs", () => {
      const result = schema.safeParse({ url: "https://cdn.example.com/photo.png", output: "/tmp" });
      expect(result.success).toBe(true);
    });
  });
});
