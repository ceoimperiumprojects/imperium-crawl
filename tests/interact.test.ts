import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { SessionManager, resetSessionManager } from "../src/sessions/index.js";
import { schema } from "../src/tools/interact.js";

// ── Unit: SessionManager ────────────────────────────────────────────────────

describe("SessionManager", () => {
  let tmpDir: string;
  let manager: SessionManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "imperium-sessions-test-"));
    manager = new SessionManager(tmpDir);
    resetSessionManager();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const mockCookies = [
    { name: "session", value: "abc123", domain: "example.com", path: "/" },
    { name: "csrf", value: "tok456", domain: "example.com", path: "/" },
  ];

  it("saves and loads a session", async () => {
    await manager.save("my-session", mockCookies, "https://example.com/dashboard");
    const loaded = await manager.load("my-session");

    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe("my-session");
    expect(loaded!.url).toBe("https://example.com/dashboard");
    expect(loaded!.cookies).toHaveLength(2);
    expect(loaded!.cookies[0].name).toBe("session");
    expect(loaded!.cookies[0].value).toBe("abc123");
  });

  it("persists session to disk (atomic write)", async () => {
    await manager.save("disk-test", mockCookies, "https://example.com");
    const filePath = path.join(tmpDir, "disk-test.json");
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.id).toBe("disk-test");
    expect(parsed.cookies).toHaveLength(2);
  });

  it("returns null for unknown session", async () => {
    const result = await manager.load("nonexistent");
    expect(result).toBeNull();
  });

  it("serves from in-memory cache on second load", async () => {
    await manager.save("cache-test", mockCookies, "https://example.com");
    // First load populates cache
    await manager.load("cache-test");
    // Delete the file — second load must hit cache
    await fs.unlink(path.join(tmpDir, "cache-test.json"));
    const fromCache = await manager.load("cache-test");
    expect(fromCache).not.toBeNull();
    expect(fromCache!.id).toBe("cache-test");
  });

  it("sets createdAt on first save and keeps it on update", async () => {
    await manager.save("ts-test", mockCookies, "https://example.com/page1");
    const first = await manager.load("ts-test");
    const createdAt = first!.createdAt;

    // Small delay so updatedAt differs
    await new Promise((r) => setTimeout(r, 10));

    await manager.save("ts-test", mockCookies, "https://example.com/page2");
    const second = await manager.load("ts-test");

    expect(second!.createdAt).toBe(createdAt);
    expect(second!.url).toBe("https://example.com/page2");
  });

  it("deletes a session from cache and disk", async () => {
    await manager.save("del-test", mockCookies, "https://example.com");
    await manager.delete("del-test");

    const result = await manager.load("del-test");
    expect(result).toBeNull();

    const files = await fs.readdir(tmpDir);
    expect(files.filter((f) => f.startsWith("del-test"))).toHaveLength(0);
  });

  it("lists session IDs from disk", async () => {
    await manager.save("session-a", mockCookies, "https://a.com");
    await manager.save("session-b", mockCookies, "https://b.com");

    const ids = await manager.list();
    expect(ids).toContain("session-a");
    expect(ids).toContain("session-b");
  });

  it("returns empty array when sessions dir does not exist", async () => {
    const emptyManager = new SessionManager(path.join(tmpDir, "nonexistent"));
    const ids = await emptyManager.list();
    expect(ids).toEqual([]);
  });

  it("sanitizes session ID to prevent path traversal", async () => {
    // Nasty ID — should be sanitized, not throw
    await manager.save("../../../etc/passwd", mockCookies, "https://evil.com");
    const files = await fs.readdir(tmpDir);
    // Should have created a file with sanitized name (dots → underscores)
    expect(files.some((f) => f.includes("passwd"))).toBe(true);
    expect(files.every((f) => !f.startsWith(".."))).toBe(true);
  });
});

// ── Unit: interact tool schema ──────────────────────────────────────────────

describe("interact tool schema", () => {
  it("accepts minimal valid input", () => {
    const result = schema.safeParse({
      url: "https://example.com",
      actions: [],
    });
    expect(result.success).toBe(true);
  });

  it("applies defaults: return_content=true, return_screenshot=false, timeout=30000", () => {
    const result = schema.parse({ url: "https://example.com", actions: [] });
    expect(result.return_content).toBe(true);
    expect(result.return_screenshot).toBe(false);
    expect(result.timeout).toBe(30000);
  });

  it("accepts all valid action types", () => {
    const actions = [
      { type: "click", selector: "#btn" },
      { type: "type", selector: "#input", text: "hello" },
      { type: "scroll", x: 0, y: 300 },
      { type: "wait", duration: 1000 },
      { type: "wait", selector: ".loaded" },
      { type: "screenshot" },
      { type: "evaluate", script: "return document.title" },
      { type: "select", selector: "#dropdown", value: "option1" },
      { type: "hover", selector: ".menu" },
      { type: "press", key: "Enter" },
      { type: "navigate", url: "https://example.com/page2" },
    ];

    const result = schema.safeParse({ url: "https://example.com", actions });
    expect(result.success).toBe(true);
  });

  it("rejects unknown action type", () => {
    const result = schema.safeParse({
      url: "https://example.com",
      actions: [{ type: "magic" }],
    });
    expect(result.success).toBe(false);
  });

  it("enforces max 50 actions", () => {
    const actions = Array.from({ length: 51 }, () => ({ type: "screenshot" }));
    const result = schema.safeParse({ url: "https://example.com", actions });
    expect(result.success).toBe(false);
  });

  it("enforces evaluate script max 50000 chars", () => {
    const result = schema.safeParse({
      url: "https://example.com",
      actions: [{ type: "evaluate", script: "x".repeat(50001) }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts session_id and proxy fields", () => {
    const result = schema.safeParse({
      url: "https://example.com",
      actions: [],
      session_id: "my-session",
      proxy: "http://proxy:8080",
      chrome_profile: "/home/user/.config/chrome",
    });
    expect(result.success).toBe(true);
  });

  it("rejects timeout below 1000ms", () => {
    const result = schema.safeParse({
      url: "https://example.com",
      actions: [],
      timeout: 500,
    });
    expect(result.success).toBe(false);
  });
});
