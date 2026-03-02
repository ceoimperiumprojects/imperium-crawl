import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getOptions, getBrowserPoolSize } from "../src/config.js";

describe("getOptions", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env
    process.env = { ...originalEnv };
  });

  it("returns default transport as stdio", () => {
    delete process.env.TRANSPORT;
    const options = getOptions();
    expect(options.transport).toBe("stdio");
  });

  it("accepts http transport", () => {
    process.env.TRANSPORT = "http";
    const options = getOptions();
    expect(options.transport).toBe("http");
  });

  it("throws on invalid transport", () => {
    process.env.TRANSPORT = "websocket";
    expect(() => getOptions()).toThrow('Invalid TRANSPORT value "websocket"');
  });

  it("defaults port to 3000", () => {
    delete process.env.PORT;
    const options = getOptions();
    expect(options.port).toBe(3000);
  });

  it("accepts valid port", () => {
    process.env.PORT = "8080";
    const options = getOptions();
    expect(options.port).toBe(8080);
  });

  it("clamps invalid port to default", () => {
    process.env.PORT = "99999";
    const options = getOptions();
    expect(options.port).toBe(3000);
  });

  it("clamps negative port to default", () => {
    process.env.PORT = "-1";
    const options = getOptions();
    expect(options.port).toBe(3000);
  });

  it("clamps non-numeric port to default", () => {
    process.env.PORT = "abc";
    const options = getOptions();
    expect(options.port).toBe(3000);
  });
});

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
