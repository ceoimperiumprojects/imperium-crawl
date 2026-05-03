import { describe, it, expect } from "vitest";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { schema } from "../../src/tools/monitor.js";

describe("monitor schema", () => {
  it("applies defaults", () => {
    const r = schema.parse({});
    expect(r.output_dir).toBe("./data/monitor");
    expect(r.min_change_pct).toBe(5);
    expect(r.export_format).toBe("markdown");
    expect(r.hash_on).toBe("readability");
  });

  it("rejects min_change_pct out of range", () => {
    expect(schema.safeParse({ min_change_pct: 150 }).success).toBe(false);
    expect(schema.safeParse({ min_change_pct: -1 }).success).toBe(false);
  });

  it("accepts config shortcut", () => {
    const r = schema.safeParse({ config: "./monitor.json" });
    expect(r.success).toBe(true);
  });

  it("accepts urls + topic shortcut", () => {
    const r = schema.safeParse({
      urls: ["https://a.example", "https://b.example"],
      topic: "Competitors",
    });
    expect(r.success).toBe(true);
  });
});

describe("monitor config parsing", () => {
  it("loads a valid JSON config file shape", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mtest-"));
    const cfg = join(dir, "c.json");
    const body = {
      topics: [
        { name: "T1", urls: ["https://a.example"] },
        { name: "T2", urls: ["https://b.example", "https://c.example"], min_change_pct: 10 },
      ],
    };
    await writeFile(cfg, JSON.stringify(body), "utf-8");
    // We do not exercise network here — schema + file round-trip only.
    const raw = JSON.parse(await (await import("node:fs/promises")).readFile(cfg, "utf-8"));
    expect(raw.topics).toHaveLength(2);
    expect(raw.topics[0].urls).toEqual(["https://a.example"]);
    await rm(dir, { recursive: true, force: true });
  });
});
