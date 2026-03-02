/**
 * Proxy parsing, validation, and round-robin rotation.
 *
 * Supports: http, https, socks4, socks5 proxy URLs.
 * Priority: per-request override > rotator.next() > undefined (no proxy).
 */

export interface ParsedProxy {
  url: string;
  protocol: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
}

function defaultPort(protocol: string): number {
  if (protocol === "socks4:" || protocol === "socks5:") return 1080;
  if (protocol === "https:") return 443;
  return 8080; // http
}

export function parseProxyUrl(raw: string): ParsedProxy {
  const trimmed = raw.trim();
  // Validate protocol
  if (!/^(https?|socks[45]):\/\//i.test(trimmed)) {
    throw new Error(`Invalid proxy URL (must start with http/https/socks4/socks5): ${trimmed}`);
  }

  const parsed = new URL(trimmed);
  return {
    url: trimmed,
    protocol: parsed.protocol.replace(":", ""),
    host: parsed.hostname,
    port: parseInt(parsed.port, 10) || defaultPort(parsed.protocol),
    username: parsed.username || undefined,
    password: parsed.password || undefined,
  };
}

// ── Round-Robin Rotator ──

export class ProxyRotator {
  private proxies: ParsedProxy[];
  private index = 0;

  constructor(urls: string[]) {
    this.proxies = [];
    for (const url of urls) {
      try {
        this.proxies.push(parseProxyUrl(url));
      } catch {
        console.warn(`[imperium-crawl] Skipping invalid proxy URL: ${url}`);
      }
    }
  }

  get size(): number {
    return this.proxies.length;
  }

  next(): ParsedProxy | undefined {
    if (this.proxies.length === 0) return undefined;
    const proxy = this.proxies[this.index % this.proxies.length];
    this.index++;
    return proxy;
  }
}

// ── Singleton ──

let rotator: ProxyRotator | undefined;

export function initProxyRotator(): void {
  const single = process.env.PROXY_URL?.trim();
  const multi = process.env.PROXY_URLS?.trim();

  const urls: string[] = [];

  if (multi) {
    // PROXY_URLS takes precedence for rotation list
    urls.push(...multi.split(",").map((u) => u.trim()).filter(Boolean));
  } else if (single) {
    urls.push(single);
  }

  if (urls.length > 0) {
    const r = new ProxyRotator(urls);
    if (r.size > 0) {
      rotator = r;
    }
  }
}

/**
 * Resolve which proxy to use for a request.
 * Priority: per-request override > rotator > undefined.
 */
export function resolveProxy(override?: string): string | undefined {
  if (override) return override;
  return rotator?.next()?.url;
}

export function hasProxyConfigured(): boolean {
  return !!(process.env.PROXY_URL?.trim() || process.env.PROXY_URLS?.trim());
}
