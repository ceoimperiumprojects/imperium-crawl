/**
 * Network Interceptor — Request interception and logging via page.route().
 *
 * Supports block, mock, modify, and log actions.
 * Captures request log with timing for analysis.
 */

import type { InterceptRule, NetworkRequest } from "./types.js";

type Page = import("rebrowser-playwright").Page;
type Route = import("rebrowser-playwright").Route;

// Per-page request logs
const requestLogs = new WeakMap<object, NetworkRequest[]>();

/**
 * Set up network interception rules on a page.
 * Also starts request logging.
 */
export async function setupInterception(
  page: Page,
  rules: InterceptRule[],
): Promise<void> {
  const log: NetworkRequest[] = [];
  requestLogs.set(page, log);

  // Set up request logging
  page.on("request", (request) => {
    log.push({
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      timing: { startTime: Date.now() },
    });
  });

  page.on("response", (response) => {
    const url = response.url();
    const entry = log.find((e) => e.url === url && !e.status);
    if (entry) {
      entry.status = response.status();
      entry.timing.duration = Date.now() - entry.timing.startTime;
    }
  });

  // Apply interception rules
  for (const rule of rules) {
    await page.route(rule.url_pattern, async (route: Route) => {
      switch (rule.action) {
        case "block":
          await route.abort("blockedbyclient");
          break;

        case "mock":
          await route.fulfill({
            status: rule.response?.status ?? 200,
            body: rule.response?.body ?? "",
            headers: rule.response?.headers,
            contentType: rule.response?.contentType ?? "text/plain",
          });
          break;

        case "modify":
          // Modify response: fetch original, then override parts
          try {
            const response = await route.fetch();
            const body = rule.response?.body ?? await response.text();
            await route.fulfill({
              status: rule.response?.status ?? response.status(),
              body,
              headers: {
                ...response.headers(),
                ...(rule.response?.headers ?? {}),
              },
            });
          } catch {
            await route.continue();
          }
          break;

        case "log":
          // Just continue — logging is handled by event listeners above
          await route.continue();
          break;

        default:
          await route.continue();
      }
    });
  }
}

/**
 * Get the captured request log for a page.
 */
export function getRequestLog(page: Page): NetworkRequest[] {
  return requestLogs.get(page) ?? [];
}
