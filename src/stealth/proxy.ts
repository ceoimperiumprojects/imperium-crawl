/**
 * Proxy parsing, validation, round-robin rotation with health tracking.
 *
 * Supports: http, https, socks4, socks5 proxy URLs.
 * Priority: per-request override > rotator.next() > undefined (no proxy).
 *
 * Health tracking: each proxy tracks success/failure counts and cooldown.
 * Failed proxies are skipped for COOLDOWN_MS before being retried.
 */

export interface ParsedProxy {
  url: string;
  protocol: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
}

interface ProxyHealth {
  successCount: number;
  failureCount: number;
  lastSuccessTime: number;
  lastFailureTime: number;
  cooldownUntil: number; // Timestamp: skip this proxy until this time
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

// ── Round-Robin Rotator with Health Tracking ──

const COOLDOWN_MS = 60_000; // 60s cooldown after failure

export class ProxyRotator {
  private proxies: ParsedProxy[];
  private index = 0;
  private health = new Map<string, ProxyHealth>();

  constructor(urls: string[]) {
    this.proxies = [];
    for (const url of urls) {
      try {
        const proxy = parseProxyUrl(url);
        this.proxies.push(proxy);
        this.health.set(proxy.url, {
          successCount: 0,
          failureCount: 0,
          lastSuccessTime: 0,
          lastFailureTime: 0,
          cooldownUntil: 0,
        });
      } catch {
        console.warn(`[imperium-crawl] Skipping invalid proxy URL: ${url}`);
      }
    }
  }

  get size(): number {
    return this.proxies.length;
  }

  /**
   * Get next healthy proxy, skipping those in cooldown.
   * If ALL proxies are in cooldown, returns the one whose cooldown expires soonest.
   */
  next(): ParsedProxy | undefined {
    if (this.proxies.length === 0) return undefined;

    const now = Date.now();

    // Try to find a healthy proxy (not in cooldown)
    for (let i = 0; i < this.proxies.length; i++) {
      const idx = (this.index + i) % this.proxies.length;
      const proxy = this.proxies[idx];
      const h = this.health.get(proxy.url);

      if (!h || now >= h.cooldownUntil) {
        this.index = (idx + 1) % this.proxies.length;
        return proxy;
      }
    }

    // All in cooldown — return the one with soonest expiry
    let bestProxy = this.proxies[this.index];
    let soonestCooldown = Infinity;

    for (const proxy of this.proxies) {
      const h = this.health.get(proxy.url);
      if (h && h.cooldownUntil < soonestCooldown) {
        soonestCooldown = h.cooldownUntil;
        bestProxy = proxy;
      }
    }

    this.index = (this.proxies.indexOf(bestProxy) + 1) % this.proxies.length;
    return bestProxy;
  }

  /**
   * Mark a proxy as having succeeded. Resets its failure state.
   */
  markSuccess(proxyUrl: string): void {
    const h = this.health.get(proxyUrl);
    if (h) {
      h.successCount++;
      h.lastSuccessTime = Date.now();
      h.cooldownUntil = 0; // Clear cooldown on success
    }
  }

  /**
   * Mark a proxy as having failed. Puts it in cooldown.
   */
  markFailed(proxyUrl: string): void {
    const h = this.health.get(proxyUrl);
    if (h) {
      h.failureCount++;
      h.lastFailureTime = Date.now();
      h.cooldownUntil = Date.now() + COOLDOWN_MS;
    }
  }

  /**
   * Get health stats for all proxies (for debugging/monitoring).
   */
  getHealthStats(): Array<{ url: string; health: ProxyHealth }> {
    return this.proxies.map((p) => ({
      url: p.url,
      health: this.health.get(p.url)!,
    }));
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

/**
 * Mark a proxy as having succeeded (for health tracking).
 */
export function markProxySuccess(proxyUrl?: string): void {
  if (proxyUrl && rotator) {
    rotator.markSuccess(proxyUrl);
  }
}

/**
 * Mark a proxy as having failed (puts it in cooldown).
 */
export function markProxyFailed(proxyUrl?: string): void {
  if (proxyUrl && rotator) {
    rotator.markFailed(proxyUrl);
  }
}

export function hasProxyConfigured(): boolean {
  return !!(process.env.PROXY_URL?.trim() || process.env.PROXY_URLS?.trim());
}
