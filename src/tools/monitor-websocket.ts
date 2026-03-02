import { z } from "zod";
import { isPlaywrightAvailable } from "../stealth/browser.js";
import { acquirePage } from "../stealth/chrome-profile.js";
import { resolveProxy } from "../stealth/proxy.js";
import { normalizeUrl } from "../utils/url.js";
import { DEFAULT_TIMEOUT_MS, MAX_URL_LENGTH, MAX_DURATION_SECONDS, MAX_TIMEOUT_MS, MAX_MESSAGES } from "../constants.js";

export const name = "monitor_websocket";

export const description =
  "Navigate to a page and capture WebSocket messages for a specified duration. Essential for monitoring real-time data feeds, chat applications, live dashboards, and financial tickers. Requires rebrowser-playwright.";

export const schema = z.object({
  url: z.string().max(MAX_URL_LENGTH).describe("The URL to navigate to"),
  duration_seconds: z.number().min(1).max(MAX_DURATION_SECONDS).default(10).describe("How many seconds to capture WebSocket messages (default: 10)"),
  timeout: z.number().min(1).max(MAX_TIMEOUT_MS).default(DEFAULT_TIMEOUT_MS).describe("Navigation timeout in ms"),
  max_messages: z.number().min(1).max(MAX_MESSAGES).default(100).describe("Maximum number of messages to capture"),
  filter_url: z.string().max(MAX_URL_LENGTH).optional().describe("Only capture WebSocket connections matching this substring"),
  proxy: z.string().max(MAX_URL_LENGTH).optional().describe("Proxy URL (http/https/socks4/socks5). Overrides PROXY_URL env var."),
  chrome_profile: z.string().max(1000).optional().describe("Path to Chrome user data directory for authenticated sessions (cookies, localStorage). Overrides CHROME_PROFILE_PATH env var."),
});

export type MonitorWebSocketInput = z.infer<typeof schema>;

interface WebSocketMessage {
  ws_url: string;
  direction: "sent" | "received";
  data: unknown;
  timestamp: number;
}

interface WebSocketConnection {
  url: string;
  messages_sent: number;
  messages_received: number;
}

export async function execute(input: MonitorWebSocketInput) {
  if (!(await isPlaywrightAvailable())) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            { error: "rebrowser-playwright is required for WebSocket monitoring. Install with: npm i rebrowser-playwright" },
            null,
            2,
          ),
        },
      ],
    };
  }

  const url = normalizeUrl(input.url);
  const proxyUrl = resolveProxy(input.proxy);
  const handle = await acquirePage({
    chromeProfile: input.chrome_profile,
    proxyUrl,
  });

  try {
    const { page } = handle;

    const messages: WebSocketMessage[] = [];
    const connections = new Map<string, WebSocketConnection>();

    // Listen for WebSocket connections
    page.on("websocket", (ws) => {
      const wsUrl = ws.url();

      // Apply URL filter
      if (input.filter_url && !wsUrl.includes(input.filter_url)) return;

      const conn: WebSocketConnection = {
        url: wsUrl,
        messages_sent: 0,
        messages_received: 0,
      };
      connections.set(wsUrl, conn);

      ws.on("framereceived", (frame) => {
        if (messages.length >= input.max_messages) return;
        conn.messages_received++;

        let data: unknown;
        try {
          data = JSON.parse(frame.payload as string);
        } catch {
          data = frame.payload;
        }

        messages.push({
          ws_url: wsUrl,
          direction: "received",
          data,
          timestamp: Date.now(),
        });
      });

      ws.on("framesent", (frame) => {
        if (messages.length >= input.max_messages) return;
        conn.messages_sent++;

        let data: unknown;
        try {
          data = JSON.parse(frame.payload as string);
        } catch {
          data = frame.payload;
        }

        messages.push({
          ws_url: wsUrl,
          direction: "sent",
          data,
          timestamp: Date.now(),
        });
      });
    });

    // Navigate — use "domcontentloaded" because streaming sites never reach "networkidle"
    // WebSocket connections open during/after load, and we capture them via the event listener
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: input.timeout,
    });

    // Wait for the specified duration to capture messages
    await page.waitForTimeout(input.duration_seconds * 1000);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              url,
              duration_seconds: input.duration_seconds,
              websocket_connections: connections.size,
              total_messages: messages.length,
              connections: Array.from(connections.values()),
              messages,
            },
            null,
            2,
          ),
        },
      ],
    };
  } finally {
    await handle.cleanup();
  }
}
