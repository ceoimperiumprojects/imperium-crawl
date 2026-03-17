/**
 * Retry helper for LLM API calls — retries on 429 (rate limit) and 5xx (server error).
 * Uses full-jitter exponential backoff (AWS pattern) to prevent thundering herd.
 */

const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 30_000;

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

/**
 * Full-jitter backoff: random value in [0, min(cap, base * 2^attempt)].
 * Matches the pattern in src/utils/fetcher.ts for consistency.
 */
function fullJitterBackoff(attempt: number): number {
  const expDelay = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * Math.pow(2, attempt));
  return Math.random() * expDelay;
}

/**
 * Wraps an LLM API call with retry logic for transient errors.
 * Extracts status from error message format "API error {status}: ..."
 * and retries with full-jitter exponential backoff (up to 30s cap).
 * 429s and 5xx are retried; all other errors throw immediately.
 */
export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Extract HTTP status from error message
      const statusMatch = lastError.message.match(/error (\d{3}):/i);
      const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;

      if (attempt < MAX_RETRIES && isRetryableStatus(status)) {
        const delay = fullJitterBackoff(attempt);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      throw lastError;
    }
  }

  throw lastError!;
}
