/**
 * Domain Filter — Security sandbox for browser actions.
 *
 * Blocks requests to non-allowed domains via page.route().
 * Also patches WebSocket/EventSource/sendBeacon to prevent data exfiltration.
 */

type BrowserContext = import("rebrowser-playwright").BrowserContext;

/**
 * Check if a hostname matches any of the allowed patterns.
 * Supports exact match and wildcard (*.example.com).
 */
export function isDomainAllowed(hostname: string, patterns: string[]): boolean {
  const lower = hostname.toLowerCase();

  for (const pattern of patterns) {
    const p = pattern.toLowerCase();
    if (p === lower) return true;
    if (p.startsWith("*.")) {
      const suffix = p.slice(2);
      if (lower === suffix || lower.endsWith(`.${suffix}`)) return true;
    }
  }

  return false;
}

/**
 * Install domain filter on a browser context.
 * Blocks all requests to non-allowed domains + patches WebSocket/EventSource.
 */
export async function installDomainFilter(
  context: BrowserContext,
  allowedDomains: string[],
): Promise<void> {
  if (!allowedDomains.length) return;

  // Block HTTP requests to non-allowed domains
  await context.route("**/*", (route) => {
    try {
      const url = new URL(route.request().url());
      if (isDomainAllowed(url.hostname, allowedDomains)) {
        route.continue();
      } else {
        route.abort("blockedbyclient");
      }
    } catch {
      // Invalid URL — allow (probably internal)
      route.continue();
    }
  });

  // Patch WebSocket/EventSource/sendBeacon in page context
  const initScript = `
    (function() {
      const allowedDomains = ${JSON.stringify(allowedDomains)};

      function isDomainAllowed(hostname) {
        const lower = hostname.toLowerCase();
        for (const pattern of allowedDomains) {
          const p = pattern.toLowerCase();
          if (p === lower) return true;
          if (p.startsWith('*.')) {
            const suffix = p.slice(2);
            if (lower === suffix || lower.endsWith('.' + suffix)) return true;
          }
        }
        return false;
      }

      function checkUrl(urlStr) {
        try {
          const url = new URL(urlStr, window.location.href);
          return isDomainAllowed(url.hostname);
        } catch {
          return false;
        }
      }

      // Patch WebSocket
      const OrigWebSocket = window.WebSocket;
      window.WebSocket = function(url, protocols) {
        if (!checkUrl(url)) {
          console.warn('[imperium-crawl] Blocked WebSocket to:', url);
          throw new DOMException('Blocked by domain filter', 'SecurityError');
        }
        return new OrigWebSocket(url, protocols);
      };
      window.WebSocket.prototype = OrigWebSocket.prototype;

      // Patch EventSource
      const OrigEventSource = window.EventSource;
      if (OrigEventSource) {
        window.EventSource = function(url, opts) {
          if (!checkUrl(url)) {
            console.warn('[imperium-crawl] Blocked EventSource to:', url);
            throw new DOMException('Blocked by domain filter', 'SecurityError');
          }
          return new OrigEventSource(url, opts);
        };
        window.EventSource.prototype = OrigEventSource.prototype;
      }

      // Patch sendBeacon
      const origSendBeacon = navigator.sendBeacon?.bind(navigator);
      if (origSendBeacon) {
        navigator.sendBeacon = function(url, data) {
          if (!checkUrl(url)) {
            console.warn('[imperium-crawl] Blocked sendBeacon to:', url);
            return false;
          }
          return origSendBeacon(url, data);
        };
      }
    })();
  `;

  await context.addInitScript(initScript);
}
