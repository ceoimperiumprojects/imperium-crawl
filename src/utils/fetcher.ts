import { smartFetch, StealthError, type FetchResult, type StealthOptions } from "../stealth/index.js";
import { isAllowed } from "./robots.js";
import { getDomain } from "./url.js";
import { getOptions } from "../config.js";
import { DEFAULT_CONCURRENCY } from "../constants.js";

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

// ── Circuit Breaker (per domain) ──

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

const circuits = new Map<string, CircuitBreaker>();

// Periodic cleanup: remove closed circuits idle for >1 hour
const CIRCUIT_STALE_MS = 3_600_000;
setInterval(() => {
  const now = Date.now();
  for (const [domain, circuit] of circuits) {
    if (now - circuit.lastAccessed > CIRCUIT_STALE_MS) {
      circuits.delete(domain);
    }
  }
}, 300_000).unref();

function getCircuit(domain: string): CircuitBreaker {
  let circuit = circuits.get(domain);
  if (!circuit) {
    circuit = { state: "closed", failures: 0, openedAt: 0, probeSuccesses: 0, lastAccessed: Date.now() };
    circuits.set(domain, circuit);
  }

  circuit.lastAccessed = Date.now();

  // Check if open circuit should transition to half-open
  if (circuit.state === "open" && Date.now() - circuit.openedAt >= CIRCUIT_OPEN_DURATION_MS) {
    circuit.state = "half-open";
    circuit.probeSuccesses = 0;
  }

  return circuit;
}

function recordSuccess(domain: string): void {
  const circuit = getCircuit(domain);
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

function recordFailure(domain: string): void {
  const circuit = getCircuit(domain);
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

// Exported for testing
export { circuits, getCircuit, recordSuccess, recordFailure, CIRCUIT_FAILURE_THRESHOLD, CIRCUIT_OPEN_DURATION_MS, CIRCUIT_PROBE_SUCCESSES, CIRCUIT_STALE_MS };

// ── Exponential Backoff with Full Jitter (AWS pattern) ──

const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 30_000;

function fullJitterBackoff(attempt: number): number {
  const expDelay = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * Math.pow(2, attempt));
  return Math.random() * expDelay;
}

// ── Fetch Page ──

export interface SmartFetchOptions extends StealthOptions {
  respectRobots?: boolean;
  retries?: number;
}

export async function fetchPage(url: string, options?: SmartFetchOptions): Promise<FetchResult> {
  const config = getOptions();
  const respectRobots = options?.respectRobots ?? config.respectRobots;

  if (respectRobots) {
    const allowed = await isAllowed(url);
    if (!allowed) {
      throw new Error(`URL blocked by robots.txt: ${url}`);
    }
  }

  // Circuit breaker check
  const domain = getDomain(url);
  const circuit = getCircuit(domain);
  if (circuit.state === "open") {
    throw new Error(`Circuit breaker open for ${domain} — too many consecutive failures. Retry after cooldown.`);
  }

  const retries = options?.retries ?? 2;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await smartFetch(url, options);
      recordSuccess(domain);
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      recordFailure(domain);

      // Check if circuit just opened
      const updatedCircuit = getCircuit(domain);
      if (updatedCircuit.state === "open") {
        // Enrich error message with StealthError info if available
        const detail = err instanceof StealthError
          ? `L${err.lastLevel} HTTP ${err.httpStatus}${err.antiBotSystem ? ` [${err.antiBotSystem}]` : ""}`
          : "";
        throw new Error(`Circuit breaker opened for ${domain}${detail ? ` (${detail})` : ""}: ${lastError.message}`);
      }

      if (attempt < retries) {
        const delay = fullJitterBackoff(attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError!;
}
