import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { JobStore, resetJobStore } from "../src/batch/index.js";
import type { BatchJob } from "../src/batch/index.js";
import { schema } from "../src/tools/batch-scrape.js";

// ── JobStore tests ──

describe("JobStore", () => {
  let tmpDir: string;
  let store: JobStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "batch-test-"));
    store = new JobStore(tmpDir);
    resetJobStore();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function makeJob(id: string, partial: Partial<BatchJob> = {}): BatchJob {
    return {
      id,
      status: "running",
      urls_total: 3,
      urls_completed: 0,
      urls_failed: 0,
      results: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...partial,
    };
  }

  it("saves and loads a job", async () => {
    const job = makeJob("test-job-1");
    await store.save(job);

    const loaded = await store.load("test-job-1");
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe("test-job-1");
    expect(loaded!.status).toBe("running");
  });

  it("returns null for non-existent job", async () => {
    const result = await store.load("does-not-exist");
    expect(result).toBeNull();
  });

  it("updates updated_at on save", async () => {
    const job = makeJob("test-job-2", { updated_at: "2020-01-01T00:00:00.000Z" });
    await store.save(job);

    const loaded = await store.load("test-job-2");
    expect(loaded!.updated_at).not.toBe("2020-01-01T00:00:00.000Z");
  });

  it("cache hit returns same object without file read", async () => {
    const job = makeJob("cached-job");
    await store.save(job);

    // Load once → populates cache
    const first = await store.load("cached-job");
    // Load again → cache hit
    const second = await store.load("cached-job");
    expect(first).toBe(second); // same reference
  });

  it("lists saved jobs", async () => {
    await store.save(makeJob("job-alpha"));
    await store.save(makeJob("job-beta"));

    const ids = await store.list();
    expect(ids).toContain("job-alpha");
    expect(ids).toContain("job-beta");
    expect(ids).toHaveLength(2);
  });

  it("sanitizes job id to prevent path traversal", async () => {
    const job = makeJob("../evil/../path");
    await store.save(job);

    // Dots and slashes are replaced with underscores — file stays in tmpDir
    const files = await fs.readdir(tmpDir);
    // The sanitized filename should exist (contains "evil" and "path" as alphanumeric parts)
    expect(files.some((f) => f.endsWith(".json") && !f.endsWith(".tmp.json"))).toBe(true);
    // No file should contain literal ".." or "/"
    expect(files.every((f) => !f.includes("..") && !f.includes("/"))).toBe(true);
  });

  it("persists results in job", async () => {
    const job = makeJob("result-job");
    job.results.push({ url: "https://example.com", success: true, duration_ms: 100 });
    job.urls_completed = 1;
    await store.save(job);

    const loaded = await store.load("result-job");
    expect(loaded!.results).toHaveLength(1);
    expect(loaded!.results[0].url).toBe("https://example.com");
    expect(loaded!.urls_completed).toBe(1);
  });
});

// ── Schema validation tests ──

describe("batch_scrape schema validation", () => {
  it("accepts minimal valid input", () => {
    const result = schema.safeParse({ urls: ["https://example.com"] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.return_content).toBe(false);
      expect(result.data.concurrency).toBe(3);
    }
  });

  it("rejects empty urls array", () => {
    const result = schema.safeParse({ urls: [] });
    expect(result.success).toBe(false);
  });

  it("rejects more than 500 URLs", () => {
    const urls = Array.from({ length: 501 }, (_, i) => `https://example.com/${i}`);
    const result = schema.safeParse({ urls });
    expect(result.success).toBe(false);
  });

  it("accepts string extraction_schema", () => {
    const result = schema.safeParse({
      urls: ["https://example.com"],
      extraction_schema: "extract product name and price",
    });
    expect(result.success).toBe(true);
  });

  it("accepts object extraction_schema", () => {
    const result = schema.safeParse({
      urls: ["https://example.com"],
      extraction_schema: { type: "object", properties: { title: { type: "string" } } },
    });
    expect(result.success).toBe(true);
  });

  it("accepts 'auto' extraction_schema", () => {
    const result = schema.safeParse({
      urls: ["https://example.com"],
      extraction_schema: "auto",
    });
    expect(result.success).toBe(true);
  });

  it("rejects concurrency above max", () => {
    const result = schema.safeParse({
      urls: ["https://example.com"],
      concurrency: 100,
    });
    expect(result.success).toBe(false);
  });

  it("accepts job_id for resume", () => {
    const result = schema.safeParse({
      urls: ["https://example.com"],
      job_id: "my-existing-job-123",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.job_id).toBe("my-existing-job-123");
    }
  });

  it("return_content defaults to false", () => {
    const result = schema.safeParse({ urls: ["https://example.com"] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.return_content).toBe(false);
    }
  });
});
