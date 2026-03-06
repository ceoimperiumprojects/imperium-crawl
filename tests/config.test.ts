import { describe, it, expect, afterEach } from "vitest";
import { getBrowserPoolSize } from "../src/config.js";

describe("getBrowserPoolSize", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns default when env not set", () => {
    delete process.env.BROWSER_POOL_SIZE;
    expect(getBrowserPoolSize()).toBe(3);
  });

  it("accepts valid pool size", () => {
    process.env.BROWSER_POOL_SIZE = "5";
    expect(getBrowserPoolSize()).toBe(5);
  });

  it("clamps to default when > 20", () => {
    process.env.BROWSER_POOL_SIZE = "50";
    expect(getBrowserPoolSize()).toBe(3);
  });

  it("clamps to default when < 1", () => {
    process.env.BROWSER_POOL_SIZE = "0";
    expect(getBrowserPoolSize()).toBe(3);
  });

  it("clamps negative to default", () => {
    process.env.BROWSER_POOL_SIZE = "-5";
    expect(getBrowserPoolSize()).toBe(3);
  });

  it("clamps non-numeric to default", () => {
    process.env.BROWSER_POOL_SIZE = "abc";
    expect(getBrowserPoolSize()).toBe(3);
  });

  it("accepts boundary value 1", () => {
    process.env.BROWSER_POOL_SIZE = "1";
    expect(getBrowserPoolSize()).toBe(1);
  });

  it("accepts boundary value 20", () => {
    process.env.BROWSER_POOL_SIZE = "20";
    expect(getBrowserPoolSize()).toBe(20);
  });
});
