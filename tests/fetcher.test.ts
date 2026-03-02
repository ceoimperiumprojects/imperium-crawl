import { describe, it, expect } from "vitest";
import { ConcurrencyLimiter } from "../src/utils/fetcher.js";

describe("ConcurrencyLimiter", () => {
  it("runs tasks concurrently up to the limit", async () => {
    const limiter = new ConcurrencyLimiter(2);
    const running: number[] = [];
    let maxConcurrent = 0;

    const makeTask = (id: number) =>
      limiter.run(async () => {
        running.push(id);
        maxConcurrent = Math.max(maxConcurrent, running.length);
        await new Promise((r) => setTimeout(r, 50));
        running.splice(running.indexOf(id), 1);
        return id;
      });

    const results = await Promise.all([makeTask(1), makeTask(2), makeTask(3), makeTask(4)]);

    expect(results).toEqual([1, 2, 3, 4]);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it("runs single task without queue", async () => {
    const limiter = new ConcurrencyLimiter(5);
    const result = await limiter.run(async () => 42);
    expect(result).toBe(42);
  });

  it("handles errors without blocking queue", async () => {
    const limiter = new ConcurrencyLimiter(1);

    // First task throws
    await expect(
      limiter.run(async () => {
        throw new Error("fail");
      }),
    ).rejects.toThrow("fail");

    // Second task should still run
    const result = await limiter.run(async () => "ok");
    expect(result).toBe("ok");
  });
});
