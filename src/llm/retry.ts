/**
 * Retry helper for LLM API calls — retries on 429 (rate limit) and 5xx (server error).
 */

const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000;

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

/**
 * Wraps a fetch call with retry logic for transient errors.
 * Extracts status from error message format "API error {status}: ..."
 * and retries with exponential backoff (1s, 2s, 4s).
 */
export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Extract HTTP status from error message
      const statusMatch = lastError.message.match(/error (\d{3}):/);
      const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;

      if (attempt < MAX_RETRIES && isRetryableStatus(status)) {
        const delay = BACKOFF_BASE_MS * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      throw lastError;
    }
  }

  throw lastError!;
}
