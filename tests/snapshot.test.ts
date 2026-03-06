import { describe, it, expect, beforeEach } from "vitest";
import { schema } from "../src/tools/snapshot.js";
import { getSnapshotStore, resetSnapshotStore } from "../src/snapshot/store.js";
import { diffSnapshots } from "../src/snapshot/differ.js";
import type { RefMap } from "../src/snapshot/types.js";

describe("Snapshot tool", () => {
  describe("schema validation", () => {
    it("accepts valid snapshot input", () => {
      const result = schema.safeParse({ url: "https://example.com" });
      expect(result.success).toBe(true);
    });

    it("applies defaults", () => {
      const result = schema.parse({ url: "https://example.com" });
      expect(result.interactive).toBe(true);
      expect(result.cursor).toBe(false);
      expect(result.compact).toBe(true);
      expect(result.return_screenshot).toBe(false);
      expect(result.annotate).toBe(false);
      expect(result.timeout).toBe(30000);
    });

    it("accepts scope_selector", () => {
      const result = schema.safeParse({ url: "https://example.com", scope_selector: "#main-content" });
      expect(result.success).toBe(true);
    });

    it("accepts allowed_domains array", () => {
      const result = schema.safeParse({
        url: "https://example.com",
        allowed_domains: ["example.com", "*.cdn.example.com"],
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing url", () => {
      expect(schema.safeParse({}).success).toBe(false);
    });

    it("enforces timeout bounds", () => {
      expect(schema.safeParse({ url: "https://x.com", timeout: 500 }).success).toBe(false);
    });

    it("enforces url max length", () => {
      const longUrl = "https://example.com/" + "a".repeat(50000);
      expect(schema.safeParse({ url: longUrl }).success).toBe(false);
    });
  });
});

describe("SnapshotStore", () => {
  beforeEach(() => {
    resetSnapshotStore();
  });

  it("saves and retrieves refs", () => {
    const store = getSnapshotStore();
    const refs: RefMap = {
      e1: { selector: "getByRole('button', { name: 'Submit' })", role: "button", name: "Submit" },
      e2: { selector: "getByRole('link', { name: 'Home' })", role: "link", name: "Home" },
    };

    store.save("session1", refs, "https://example.com");
    expect(store.size).toBe(1);
    expect(store.getRefs("session1")).toEqual(refs);
  });

  it("resolves ref with and without @ prefix", () => {
    const store = getSnapshotStore();
    const refs: RefMap = {
      e5: { selector: "getByRole('button')", role: "button", name: "Click" },
    };

    store.save("s1", refs, "https://example.com");
    expect(store.resolveRef("s1", "e5")).toEqual(refs.e5);
    expect(store.resolveRef("s1", "@e5")).toEqual(refs.e5);
  });

  it("returns null for unknown ref", () => {
    const store = getSnapshotStore();
    const refs: RefMap = { e1: { selector: "x", role: "button", name: "A" } };
    store.save("s1", refs, "https://example.com");

    expect(store.resolveRef("s1", "e99")).toBeNull();
  });

  it("returns null for unknown session", () => {
    const store = getSnapshotStore();
    expect(store.resolveRef("nonexistent", "e1")).toBeNull();
    expect(store.getRefs("nonexistent")).toBeNull();
  });

  it("overwrites refs for same session_id", () => {
    const store = getSnapshotStore();
    store.save("s1", { e1: { selector: "a", role: "button", name: "Old" } }, "https://old.com");
    store.save("s1", { e1: { selector: "b", role: "link", name: "New" } }, "https://new.com");

    expect(store.size).toBe(1);
    expect(store.resolveRef("s1", "e1")?.name).toBe("New");
  });

  it("invalidates a session", () => {
    const store = getSnapshotStore();
    store.save("s1", { e1: { selector: "x", role: "button", name: "X" } }, "https://x.com");
    store.invalidate("s1");

    expect(store.size).toBe(0);
    expect(store.getRefs("s1")).toBeNull();
  });

  it("clears all snapshots", () => {
    const store = getSnapshotStore();
    store.save("s1", {}, "https://a.com");
    store.save("s2", {}, "https://b.com");
    store.clear();

    expect(store.size).toBe(0);
  });
});

describe("diffSnapshots (Myers text diff)", () => {
  it("detects identical snapshots", () => {
    const result = diffSnapshots("line1\nline2", "line1\nline2");
    expect(result.changed).toBe(false);
    expect(result.additions).toBe(0);
    expect(result.removals).toBe(0);
    expect(result.unchanged).toBe(2);
  });

  it("detects additions", () => {
    const result = diffSnapshots("line1", "line1\nline2");
    expect(result.changed).toBe(true);
    expect(result.additions).toBeGreaterThanOrEqual(1);
  });

  it("detects removals", () => {
    const result = diffSnapshots("line1\nline2", "line1");
    expect(result.changed).toBe(true);
    expect(result.removals).toBeGreaterThanOrEqual(1);
  });

  it("detects modifications (remove + add)", () => {
    const result = diffSnapshots("hello world", "hello planet");
    expect(result.changed).toBe(true);
    expect(result.additions).toBeGreaterThanOrEqual(1);
    expect(result.removals).toBeGreaterThanOrEqual(1);
  });

  it("handles empty to non-empty", () => {
    const result = diffSnapshots("", "new content");
    expect(result.changed).toBe(true);
    expect(result.additions).toBeGreaterThanOrEqual(1);
  });

  it("diff output uses unified format with +/- prefixes", () => {
    const result = diffSnapshots("keep\nremove", "keep\nadd");
    expect(result.diff).toContain("  keep");
    expect(result.diff).toContain("- remove");
    expect(result.diff).toContain("+ add");
  });
});
