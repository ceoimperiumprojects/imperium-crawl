import { describe, it, expect } from "vitest";
import { schema } from "../src/tools/instagram.js";

describe("Instagram tool", () => {
  describe("schema validation", () => {
    it("accepts valid search input", () => {
      const result = schema.safeParse({ action: "search", query: "travel bloggers" });
      expect(result.success).toBe(true);
    });

    it("accepts search with location", () => {
      const result = schema.safeParse({ action: "search", query: "food", location: "new york" });
      expect(result.success).toBe(true);
    });

    it("accepts valid profile with single username", () => {
      const result = schema.safeParse({ action: "profile", username: "testuser" });
      expect(result.success).toBe(true);
    });

    it("accepts valid profile with multiple usernames", () => {
      const result = schema.safeParse({ action: "profile", usernames: ["user1", "user2", "user3"] });
      expect(result.success).toBe(true);
    });

    it("accepts valid discover input", () => {
      const result = schema.safeParse({ action: "discover", niche: "travel hotel" });
      expect(result.success).toBe(true);
    });

    it("accepts discover with all filters", () => {
      const result = schema.safeParse({
        action: "discover",
        niche: "fitness",
        location: "beograd",
        min_followers: 5000,
        max_followers: 50000,
        min_engagement: 5,
        max_days_since_post: 14,
        limit: 10,
        sort: "engagement",
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid action", () => {
      const result = schema.safeParse({ action: "invalid" });
      expect(result.success).toBe(false);
    });

    it("applies default limit", () => {
      const result = schema.parse({ action: "search", query: "test" });
      expect(result.limit).toBe(20);
    });

    it("applies default sort", () => {
      const result = schema.parse({ action: "search", query: "test" });
      expect(result.sort).toBe("engagement");
    });

    it("filter fields are optional (defaults applied at runtime in execute)", () => {
      // .default(X).optional() means: if field is omitted → undefined (optional wins)
      // Runtime code uses ?? to apply defaults: input.min_followers ?? 1000
      const result = schema.parse({ action: "discover", niche: "tech" });
      expect(result.min_followers).toBeUndefined();
      expect(result.max_followers).toBeUndefined();
      expect(result.min_engagement).toBeUndefined();
      expect(result.max_days_since_post).toBeUndefined();
    });

    it("accepts both sort options", () => {
      for (const sort of ["engagement", "followers"]) {
        expect(schema.safeParse({ action: "search", query: "test", sort }).success).toBe(true);
      }
    });

    it("rejects invalid sort option", () => {
      expect(schema.safeParse({ action: "search", query: "test", sort: "date" }).success).toBe(false);
    });

    it("enforces limit bounds", () => {
      expect(schema.safeParse({ action: "search", query: "test", limit: 0 }).success).toBe(false);
      expect(schema.safeParse({ action: "search", query: "test", limit: 1001 }).success).toBe(false);
    });

    it("enforces username max length", () => {
      const longUsername = "a".repeat(201);
      expect(schema.safeParse({ action: "profile", username: longUsername }).success).toBe(false);
    });

    it("enforces usernames array max size", () => {
      const tooMany = Array.from({ length: 101 }, (_, i) => `user${i}`);
      expect(schema.safeParse({ action: "profile", usernames: tooMany }).success).toBe(false);
    });

    it("enforces query max length", () => {
      const longQuery = "a".repeat(5001);
      expect(schema.safeParse({ action: "search", query: longQuery }).success).toBe(false);
    });
  });

  describe("execute validation errors", () => {
    // Import execute to test error responses
    let execute: typeof import("../src/tools/instagram.js").execute;

    it("returns error when search has no query", async () => {
      const mod = await import("../src/tools/instagram.js");
      execute = mod.execute;
      const result = await execute({ action: "search", limit: 20, sort: "engagement" } as any);
      const text = JSON.parse(result.content[0].text);
      expect(text.error).toContain("query is required");
    });

    it("returns error when profile has no username", async () => {
      const mod = await import("../src/tools/instagram.js");
      const result = await mod.execute({ action: "profile", limit: 20, sort: "engagement" } as any);
      const text = JSON.parse(result.content[0].text);
      expect(text.error).toContain("username or usernames is required");
    });
  });
});
