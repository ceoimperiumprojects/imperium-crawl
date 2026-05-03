import { smartFetch, StealthError, type FetchResult, type StealthLevel, type StealthOptions } from "../stealth/index.js";
import { isAllowed } from "./robots.js";
import { getDomain } from "./url.js";
import { DEFAULT_CONCURRENCY, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS } from "../core/constants.js";
import { getKnowledgeEngine } from "../knowledge/index.js";

// ── Concurrency Limiter ──

export class ConcurrencyLimiter {
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(private maxConcurrent: number = DEFAULT_CONCURRENCY) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    while (this.running >= this.maxConcurrent) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

export const defaultLimiter = new ConcurrencyLimiter();

// ── Circuit Breaker (per endpoint + per domain) ──

type CircuitState = "closed" | "open" | "half-open";

interface CircuitBreaker {
  state: CircuitState;
  failures: number;
  openedAt: number;
  probeSuccesses: number;
  lastAccessed: number;
}

const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_OPEN_DURATION_MS = 60_000;
const CIRCUIT_PROBE_SUCCESSES = 3;
// Domain-level circuit: higher threshold — only opens when multiple endpoints fail
const DOMAIN_CIRCUIT_FAILURE_THRESHOLD = 10;

const circuits = new Map<string, CircuitBreaker>();

// Periodic cleanup: remove closed circuits idle for >1 hour
const CIRCUIT_STALE_MS = 3_600_000;
setInterval(() => {
  const now = Date.now();
  for (const [key, circuit] of circuits) {
    if (now - circuit.lastAccessed > CIRCUIT_STALE_MS) {
      circuits.delete(key);
    }
  }
}, 300_000).unref();

/**
 * Get circuit breaker key for a URL.
 * Uses domain + first 2 path segments for endpoint-level granularity.
 */
function getCircuitKey(url: string): string {
  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const pathPrefix = pathParts.slice(0, 2).join("/");
    return pathPrefix ? `${parsed.hostname}/${pathPrefix}` : parsed.hostname;
  } catch {
    return getDomain(url);
  }
}

function getCircuit(key: string): CircuitBreaker {
  let circuit = circuits.get(key);
  if (!circuit) {
    circuit = { state: "closed", failures: 0, openedAt: 0, probeSuccesses: 0, lastAccessed: Date.now() };
    circuits.set(key, circuit);
  }

  circuit.lastAccessed = Date.now();

  // Check if open circuit should transition to half-open
  if (circuit.state === "open" && Date.now() - circuit.openedAt >= CIRCUIT_OPEN_DURATION_MS) {
    circuit.state = "half-open";
    circuit.probeSuccesses = 0;
  }

  return circuit;
}

function recordSuccess(key: string): void {
  const circuit = getCircuit(key);
  if (circuit.state === "half-open") {
    circuit.probeSuccesses++;
    if (circuit.probeSuccesses >= CIRCUIT_PROBE_SUCCESSES) {
      // Fully recovered
      circuit.state = "closed";
      circuit.failures = 0;
    }
  } else {
    circuit.failures = 0;
  }
}

function recordFailure(key: string): void {
  const circuit = getCircuit(key);
  // Half-open probe failed → immediately reopen circuit
  if (circuit.state === "half-open") {
    circuit.state = "open";
    circuit.openedAt = Date.now();
    circuit.failures = CIRCUIT_FAILURE_THRESHOLD;
    return;
  }
  circuit.failures++;
  if (circuit.failures >= CIRCUIT_FAILURE_THRESHOLD) {
    circuit.state = "open";
    circuit.openedAt = Date.now();
  }
}

/**
 * Check domain-level circuit: opens when 3+ endpoint circuits are open for this domain.
 */
function isDomainCircuitOpen(domain: string): boolean {
  let openEndpoints = 0;
  for (const [key, circuit] of circuits) {
    if (key.startsWith(domain) && circuit.state === "open") {
      openEndpoints++;
    }
  }
  return openEndpoints >= 3;
}

// Exported for testing
export { circuits, getCircuit, getCircuitKey, recordSuccess, recordFailure, isDomainCircuitOpen, CIRCUIT_FAILURE_THRESHOLD, CIRCUIT_OPEN_DURATION_MS, CIRCUIT_PROBE_SUCCESSES, CIRCUIT_STALE_MS };

// ── Exponential Backoff with Full Jitter (AWS pattern) ──

const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 30_000;
const RATE_LIMIT_EXTRA_JITTER_MS = 10_000; // Extra jitter for 429 responses

function fullJitterBackoff(attempt: number, is429 = false): number {
  const expDelay = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * Math.pow(2, attempt));
  const baseJitter = Math.random() * expDelay;
  // On 429, add extra random jitter to avoid thundering herd
  if (is429) {
    return baseJitter + 5000 + Math.random() * RATE_LIMIT_EXTRA_JITTER_MS;
  }
  return baseJitter;
}

// ── Per-Domain Rate Limiter ──

const DEFAULT_DOMAIN_RATE_MS = parseInt(process.env.DOMAIN_RATE_LIMIT_MS || "500", 10);

class DomainThrottle {
  private lastRequest = new Map<string, number>();
  private defaultDelay: number;

  constructor(defaultDelayMs: number = DEFAULT_DOMAIN_RATE_MS) {
    this.defaultDelay = defaultDelayMs;
  }

  /**
   * Wait until enough time has passed since the last request to this domain.
   * Uses knowledge engine's safe_rate_limit if available, else default delay.
   */
  async throttle(domain: string, knowledgeDelayMs?: number): Promise<void> {
    const delay = knowledgeDelayMs ?? this.defaultDelay;
    if (delay <= 0) return;

    const now = Date.now();
    const last = this.lastRequest.get(domain) ?? 0;
    const elapsed = now - last;

    if (elapsed < delay) {
      await new Promise((r) => setTimeout(r, delay - elapsed));
    }

    this.lastRequest.set(domain, Date.now());
  }
}

const domainThrottle = new DomainThrottle();

// ── Fetch Page ──

export interface SmartFetchOptions extends StealthOptions {
  respectRobots?: boolean;
  retries?: number;
}

/**
 * Compute adaptive timeout based on knowledge engine data.
 * Uses avg_response_time * 3 with a floor of DEFAULT_TIMEOUT_MS and ceiling of MAX_TIMEOUT_MS.
 */
function computeAdaptiveTimeout(avgResponseTimeMs: number | undefined): number {
  if (!avgResponseTimeMs || avgResponseTimeMs <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(DEFAULT_TIMEOUT_MS, avgResponseTimeMs * 3));
}

/**
 * Determine the escalated stealth level for a retry attempt.
 * attempt 0: user's level, attempt 1: level+1, attempt 2: L3
 */
function getEscalatedLevel(
  baseLevel: StealthLevel | undefined,
  attempt: number,
  lastError: Error | undefined,
): StealthLevel {
  // If last failure was a StealthError with detected anti-bot, jump to L3
  if (lastError instanceof StealthError && lastError.antiBotSystem) {
    return 3;
  }

  const base = baseLevel || 1;
  if (attempt === 0) return base;
  if (attempt === 1) return Math.min(base + 1, 3) as StealthLevel;
  return 3; // attempt >= 2 → always L3
}

export async function fetchPage(url: string, options?: SmartFetchOptions): Promise<FetchResult> {
  const respectRobots = options?.respectRobots ?? (process.env.RESPECT_ROBOTS !== "false");

  if (respectRobots) {
    const allowed = await isAllowed(url);
    if (!allowed) {
      throw new Error(`URL blocked by robots.txt: ${url}`);
    }
  }

  // Per-endpoint circuit breaker check
  const domain = getDomain(url);
  const circuitKey = getCircuitKey(url);
  const circuit = getCircuit(circuitKey);
  if (circuit.state === "open") {
    throw new Error(`Circuit breaker open for endpoint ${circuitKey} — too many consecutive failures. Retry after cooldown.`);
  }

  // Domain-level circuit check (opens when 3+ endpoints are broken)
  if (isDomainCircuitOpen(domain)) {
    throw new Error(`Circuit breaker open for domain ${domain} — multiple endpoints failing. Retry after cooldown.`);
  }

  // Per-domain rate limiting — use knowledge engine's safe_rate_limit if available
  const engine = getKnowledgeEngine();
  const knowledge = await engine.get(domain);
  const knowledgeDelayMs = knowledge?.safe_rate_limit
    ? Math.round(60_000 / knowledge.safe_rate_limit)
    : undefined;
  await domainThrottle.throttle(domain, knowledgeDelayMs);

  // ── Adaptive timeout from knowledge engine ──
  const adaptiveTimeout = computeAdaptiveTimeout(knowledge?.avg_response_time_ms);
  const timeout = options?.timeout || adaptiveTimeout;

  const retries = options?.retries ?? 2;
  let lastError: Error | undefined;
  let lastHttpStatus = 0;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // ── Smart retry: escalate stealth level on each attempt ──
      const escalatedLevel = getEscalatedLevel(options?.forceLevel, attempt, lastError);
      const attemptOptions: StealthOptions = {
        ...options,
        timeout,
        // On retry, escalate stealth level (unless user forced a specific level)
        forceLevel: attempt > 0 && !options?.forceLevel ? escalatedLevel : options?.forceLevel,
      };

      const result = await smartFetch(url, attemptOptions);
      recordSuccess(circuitKey);

      // Feed successful strategy back to knowledge engine
      if (attempt > 0 && result.level > 1) {
        engine.record({
          url, domain,
          levelUsed: result.level,
          success: true,
          responseTimeMs: 0, // Already recorded by smartFetch
          antiBotSystem: result.antiBotSystem || null,
          captchaType: result.captchaSolved ? "detected" : null,
          proxyUsed: !!result.proxyUsed,
          blocked: false,
          httpStatus: result.status,
        });
      }

      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      recordFailure(circuitKey);

      // Track HTTP status for backoff decisions
      if (err instanceof StealthError) {
        lastHttpStatus = err.httpStatus;
      }

      // Check if endpoint circuit just opened
      const updatedCircuit = getCircuit(circuitKey);
      if (updatedCircuit.state === "open") {
        // Enrich error message with StealthError info if available
        const detail = err instanceof StealthError
          ? `L${err.lastLevel} HTTP ${err.httpStatus}${err.antiBotSystem ? ` [${err.antiBotSystem}]` : ""}`
          : "";
        throw new Error(`Circuit breaker opened for ${circuitKey}${detail ? ` (${detail})` : ""}: ${lastError.message}`);
      }

      if (attempt < retries) {
        const is429 = lastHttpStatus === 429;
        const delay = fullJitterBackoff(attempt, is429);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError!;
}
