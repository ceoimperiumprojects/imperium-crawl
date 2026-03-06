import { describe, it, expect } from "vitest";
import { schema } from "../src/tools/reddit.js";

describe("Reddit tool", () => {
  describe("schema validation", () => {
    it("accepts valid search input", () => {
      const result = schema.safeParse({ action: "search", query: "javascript" });
      expect(result.success).toBe(true);
    });

    it("accepts valid posts input", () => {
      const result = schema.safeParse({ action: "posts", subreddit: "programming" });
      expect(result.success).toBe(true);
    });

    it("accepts valid comments input", () => {
      const result = schema.safeParse({
        action: "comments",
        post_url: "https://reddit.com/r/programming/comments/abc123/some_post/",
      });
      expect(result.success).toBe(true);
    });

    it("accepts valid subreddit info input", () => {
      const result = schema.safeParse({ action: "subreddit", subreddit: "programming" });
      expect(result.success).toBe(true);
    });

    it("rejects invalid action", () => {
      const result = schema.safeParse({ action: "invalid" });
      expect(result.success).toBe(false);
    });

    it("applies defaults", () => {
      const result = schema.parse({ action: "search", query: "test" });
      expect(result.sort).toBe("hot");
      expect(result.time).toBe("week");
      expect(result.limit).toBe(25);
    });

    it("accepts all sort options", () => {
      for (const sort of ["hot", "new", "top", "rising"]) {
        expect(schema.safeParse({ action: "posts", subreddit: "test", sort }).success).toBe(true);
      }
    });

    it("accepts all time options", () => {
      for (const time of ["hour", "day", "week", "month", "year", "all"]) {
        expect(schema.safeParse({ action: "search", query: "test", time }).success).toBe(true);
      }
    });
  });
});
