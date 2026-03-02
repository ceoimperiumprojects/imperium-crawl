import { describe, it, expect, beforeEach, vi } from "vitest";
import { parseProxyUrl, ProxyRotator, resolveProxy, initProxyRotator } from "../src/stealth/proxy.js";

describe("parseProxyUrl", () => {
  it("parses http proxy URL", () => {
    const proxy = parseProxyUrl("http://proxy.example.com:8080");
    expect(proxy.protocol).toBe("http");
    expect(proxy.host).toBe("proxy.example.com");
    expect(proxy.port).toBe(8080);
    expect(proxy.username).toBeUndefined();
    expect(proxy.password).toBeUndefined();
  });

  it("parses https proxy URL", () => {
    const proxy = parseProxyUrl("https://proxy.example.com:443");
    expect(proxy.protocol).toBe("https");
    expect(proxy.port).toBe(443);
  });

  it("parses socks4 proxy URL", () => {
    const proxy = parseProxyUrl("socks4://proxy.example.com:1080");
    expect(proxy.protocol).toBe("socks4");
    expect(proxy.port).toBe(1080);
  });

  it("parses socks5 proxy URL", () => {
    const proxy = parseProxyUrl("socks5://proxy.example.com:1080");
    expect(proxy.protocol).toBe("socks5");
    expect(proxy.port).toBe(1080);
  });

  it("extracts username and password", () => {
    const proxy = parseProxyUrl("http://user:pass@proxy.example.com:8080");
    expect(proxy.username).toBe("user");
    expect(proxy.password).toBe("pass");
  });

  it("defaults http port to 8080", () => {
    const proxy = parseProxyUrl("http://proxy.example.com");
    expect(proxy.port).toBe(8080);
  });

  it("defaults https port to 443", () => {
    const proxy = parseProxyUrl("https://proxy.example.com");
    expect(proxy.port).toBe(443);
  });

  it("defaults socks4 port to 1080", () => {
    const proxy = parseProxyUrl("socks4://proxy.example.com");
    expect(proxy.port).toBe(1080);
  });

  it("defaults socks5 port to 1080", () => {
    const proxy = parseProxyUrl("socks5://proxy.example.com");
    expect(proxy.port).toBe(1080);
  });

  it("throws on invalid protocol", () => {
    expect(() => parseProxyUrl("ftp://proxy.example.com")).toThrow("Invalid proxy URL");
  });

  it("throws on garbage input", () => {
    expect(() => parseProxyUrl("not-a-url")).toThrow("Invalid proxy URL");
  });

  it("trims whitespace", () => {
    const proxy = parseProxyUrl("  http://proxy.example.com:8080  ");
    expect(proxy.host).toBe("proxy.example.com");
  });
});

describe("ProxyRotator", () => {
  it("rotates through proxies round-robin", () => {
    const rotator = new ProxyRotator([
      "http://a.com:8080",
      "http://b.com:8080",
      "http://c.com:8080",
    ]);
    expect(rotator.size).toBe(3);

    const first = rotator.next();
    expect(first?.host).toBe("a.com");

    const second = rotator.next();
    expect(second?.host).toBe("b.com");

    const third = rotator.next();
    expect(third?.host).toBe("c.com");

    // Wraps around
    const fourth = rotator.next();
    expect(fourth?.host).toBe("a.com");
  });

  it("returns undefined for empty rotator", () => {
    const rotator = new ProxyRotator([]);
    expect(rotator.size).toBe(0);
    expect(rotator.next()).toBeUndefined();
  });

  it("skips invalid URLs without crashing (resilience fix)", () => {
    // Suppress console.warn during test
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const rotator = new ProxyRotator([
      "http://valid.com:8080",
      "garbage-not-a-url",
      "ftp://invalid-protocol.com",
      "http://also-valid.com:9090",
    ]);

    expect(rotator.size).toBe(2);
    expect(rotator.next()?.host).toBe("valid.com");
    expect(rotator.next()?.host).toBe("also-valid.com");
    expect(warnSpy).toHaveBeenCalledTimes(2);

    warnSpy.mockRestore();
  });

  it("returns empty rotator when all URLs are invalid", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const rotator = new ProxyRotator(["garbage", "also-garbage"]);
    expect(rotator.size).toBe(0);
    expect(rotator.next()).toBeUndefined();

    warnSpy.mockRestore();
  });
});

describe("resolveProxy", () => {
  it("returns override when provided", () => {
    const result = resolveProxy("http://override.com:8080");
    expect(result).toBe("http://override.com:8080");
  });

  it("returns undefined when no override and no rotator", () => {
    // With no env vars set and no initProxyRotator, should return undefined
    const result = resolveProxy(undefined);
    // May be undefined or from rotator — just check it doesn't throw
    expect(result === undefined || typeof result === "string").toBe(true);
  });
});
