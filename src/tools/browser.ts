/**
 * Persistent Browser tool — Chrome lives between CLI invocations via CDP.
 *
 * Subcommands:
 *   start     — Launch Chrome with CDP debugging, save endpoint + PID
 *   stop      — Close Chrome, clean up state
 *   snapshot  — ARIA tree with refs (saved to disk for cross-process access)
 *   click     — Click an element by ref or selector
 *   type      — Fill text into an element
 *   navigate  — Go to a URL
 *   scroll    — Scroll the page
 *   wait      — Wait for element, text, or timeout
 *   eval      — Execute JavaScript in page context
 *   get-url   — Return current page URL
 *   screenshot — Take a screenshot
 *
 * Architecture:
 *   - Chrome is spawned as a detached process (survives Node exit)
 *   - Each CLI call connects via connectOverCDP, does work, then disconnects
 *   - Snapshot refs are persisted to disk so click/type can use them
 *   - Cookies are synced to SessionManager on each disconnect
 *
 * Note: The eval action uses new Function() intentionally — same pattern as
 * action-executor.ts. Users explicitly provide JS for browser-side execution.
 */

import { z } from "zod";
import { MAX_URL_LENGTH } from "../constants.js";

export const name = "browser";

export const description =
  "Persistent browser session. Start a Chrome instance that stays alive between CLI calls. Use snapshot to see the page, then click/type/navigate to interact. All cookies are shared via --session.";

export const schema = z.object({
  action: z.enum([
    "start", "stop", "snapshot", "click", "type", "navigate",
    "scroll", "wait", "eval", "get-url", "screenshot",
  ]).describe("Browser action to perform"),
  session: z.string().default("default").describe("Session name for browser persistence"),
  url: z.string().max(MAX_URL_LENGTH).optional().describe("URL for start/navigate actions"),
  headed: z.boolean().default(false).describe("Launch Chrome in headed (visible) mode"),
  ref: z.string().optional().describe("Element ref from snapshot (e.g. @e1)"),
  selector: z.string().optional().describe("CSS selector to target an element"),
  text: z.string().optional().describe("Text to type into an element"),
  script: z.string().optional().describe("JavaScript to evaluate in page context"),
  direction: z.enum(["up", "down", "left", "right"]).optional().describe("Scroll direction"),
  px: z.number().optional().describe("Scroll distance in pixels (default: 500)"),
  ms: z.number().optional().describe("Wait duration in milliseconds"),
  wait_for: z.string().optional().describe("Wait for selector or text to appear"),
  output: z.string().optional().describe("Output file path for screenshot"),
  full: z.boolean().default(false).describe("Full page screenshot"),
  depth: z.enum(["full", "interactive"]).default("interactive").describe("Snapshot depth: full=all elements, interactive=only interactive"),
  scope: z.string().optional().describe("CSS selector to scope snapshot to a subtree"),
});

export type BrowserInput = z.infer<typeof schema>;

// ── Helpers ──

function result(data: unknown) {
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify(data, null, 2),
    }],
  };
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    import("node:net").then(({ createServer }) => {
      const server = createServer();
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          const port = addr.port;
          server.close(() => resolve(port));
        } else {
          reject(new Error("Could not find free port"));
        }
      });
      server.on("error", reject);
    });
  });
}

// ── Action Handlers ──

async function handleStart(input: BrowserInput) {
  const { saveBrowserState, loadBrowserState, isBrowserAlive } = await import("../sessions/browser-state.js");

  // Check if browser already running for this session
  const existing = await loadBrowserState(input.session);
  if (existing && await isBrowserAlive(input.session)) {
    return result({
      status: "already_running",
      session: input.session,
      endpoint: existing.endpoint,
      pid: existing.pid,
      message: `Browser already running for session "${input.session}". Use browser stop to close it first.`,
    });
  }

  const port = await findFreePort();
  const { spawn } = await import("node:child_process");
  const { STEALTH_ARGS, DEFAULT_VIEWPORT } = await import("../constants.js");

  // Get Chrome/Chromium executable path
  let chromePath: string | undefined;

  // Try to get playwright's chromium path first (most reliable)
  try {
    const { chromium } = await import("rebrowser-playwright");
    chromePath = chromium.executablePath();
  } catch {
    // Fall back to well-known paths
  }

  if (!chromePath) {
    const { execFileSync } = await import("node:child_process");
    const candidates = [
      "google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
    ];
    for (const bin of candidates) {
      try {
        const found = execFileSync("which", [bin], { stdio: "pipe" }).toString().trim();
        if (found) { chromePath = found; break; }
      } catch { continue; }
    }
  }

  if (!chromePath) {
    throw new Error("Chrome/Chromium not found. Install Chrome or run: npx playwright install chromium");
  }

  const args = [
    `--remote-debugging-port=${port}`,
    `--remote-debugging-address=127.0.0.1`,
    `--window-size=${DEFAULT_VIEWPORT.width},${DEFAULT_VIEWPORT.height}`,
    "--no-sandbox",         // Required on Ubuntu 23.10+ / AppArmor
    "--disable-gpu",        // Avoid GPU issues in headless
    ...STEALTH_ARGS,
    ...(input.headed ? [] : ["--headless=new"]),
    ...(input.url ? [input.url] : ["about:blank"]),
  ];

  const chromeProcess = spawn(chromePath, args, {
    detached: true,
    stdio: "ignore",
  });

  chromeProcess.unref();

  if (!chromeProcess.pid) {
    throw new Error("Failed to start Chrome process");
  }

  // Wait for CDP to be ready
  const endpoint = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${endpoint}/json/version`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  if (!ready) {
    try { process.kill(chromeProcess.pid); } catch { /* ignore */ }
    throw new Error(`Chrome started but CDP not responding on port ${port} after 6s`);
  }

  const state = {
    endpoint,
    pid: chromeProcess.pid,
    startedAt: new Date().toISOString(),
    headed: input.headed,
    port,
  };
  await saveBrowserState(input.session, state);

  return result({
    status: "started",
    session: input.session,
    endpoint,
    pid: chromeProcess.pid,
    headed: input.headed,
    url: input.url ?? "about:blank",
  });
}

async function handleStop(input: BrowserInput) {
  const { loadBrowserState, clearBrowserState } = await import("../sessions/browser-state.js");
  const { clearSnapshotFromDisk } = await import("../snapshot/store.js");

  const state = await loadBrowserState(input.session);
  if (!state) {
    return result({
      status: "not_running",
      session: input.session,
      message: `No browser running for session "${input.session}".`,
    });
  }

  // Try to close gracefully via CDP first
  try {
    const { connectToSession } = await import("../sessions/browser-connect.js");
    const conn = await connectToSession(input.session);
    await conn.disconnect();
  } catch {
    // Chrome might already be dead — that's OK
  }

  // Kill the process
  try {
    process.kill(state.pid, "SIGTERM");
  } catch {
    // Already dead
  }

  await clearBrowserState(input.session);
  await clearSnapshotFromDisk(input.session);

  return result({
    status: "stopped",
    session: input.session,
    pid: state.pid,
  });
}

async function handleSnapshot(input: BrowserInput) {
  const { connectToSession } = await import("../sessions/browser-connect.js");
  const { getEnhancedSnapshot } = await import("../snapshot/extractor.js");
  const { getSnapshotStore, saveSnapshotToDisk } = await import("../snapshot/store.js");

  const conn = await connectToSession(input.session);
  try {
    const snapshot = await getEnhancedSnapshot(conn.page, {
      interactive: input.depth === "interactive",
      compact: true,
      selector: input.scope,
    });

    // Save refs both in memory and on disk
    getSnapshotStore().save(input.session, snapshot.refs, conn.page.url());
    await saveSnapshotToDisk(input.session, snapshot.refs, conn.page.url());

    return result({
      url: conn.page.url(),
      title: await conn.page.title(),
      tree: snapshot.tree,
      stats: snapshot.stats,
      ref_count: Object.keys(snapshot.refs).length,
    });
  } finally {
    await conn.disconnect();
  }
}

async function handleClick(input: BrowserInput) {
  const { connectToSession } = await import("../sessions/browser-connect.js");

  if (!input.ref && !input.selector) {
    return result({ error: "ref or selector required for click" });
  }

  const conn = await connectToSession(input.session);
  try {
    if (input.ref) {
      await ensureRefsLoaded(input.session);
      const { getSnapshotStore } = await import("../snapshot/store.js");
      const entry = getSnapshotStore().resolveRef(input.session, input.ref);
      if (!entry) {
        return result({ error: `ref '${input.ref}' not found. Run: browser snapshot --session ${input.session}` });
      }
      const { resolveRefToLocator } = await import("./action-executor.js");
      await resolveRefToLocator(conn.page, entry).click({ timeout: 10_000 });
    } else {
      await conn.page.click(input.selector!, { timeout: 10_000 });
    }

    await conn.page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    return result({ action: "click", success: true, url: conn.page.url() });
  } finally {
    await conn.disconnect();
  }
}

async function handleType(input: BrowserInput) {
  const { connectToSession } = await import("../sessions/browser-connect.js");

  if (!input.ref && !input.selector) {
    return result({ error: "ref or selector required for type" });
  }
  if (input.text === undefined) {
    return result({ error: "text required for type action" });
  }

  const conn = await connectToSession(input.session);
  try {
    if (input.ref) {
      await ensureRefsLoaded(input.session);
      const { getSnapshotStore } = await import("../snapshot/store.js");
      const entry = getSnapshotStore().resolveRef(input.session, input.ref);
      if (!entry) {
        return result({ error: `ref '${input.ref}' not found. Run: browser snapshot --session ${input.session}` });
      }
      const { resolveRefToLocator } = await import("./action-executor.js");
      await resolveRefToLocator(conn.page, entry).fill(input.text, { timeout: 10_000 });
    } else {
      await conn.page.fill(input.selector!, input.text, { timeout: 10_000 });
    }

    return result({ action: "type", success: true });
  } finally {
    await conn.disconnect();
  }
}

async function handleNavigate(input: BrowserInput) {
  if (!input.url) {
    return result({ error: "url required for navigate action" });
  }

  const { connectToSession } = await import("../sessions/browser-connect.js");
  const conn = await connectToSession(input.session);
  try {
    await conn.page.goto(input.url, { waitUntil: "load", timeout: 30_000 });
    await Promise.race([
      conn.page.waitForLoadState("networkidle").catch(() => {}),
      new Promise((r) => setTimeout(r, 5000)),
    ]);
    return result({ action: "navigate", success: true, url: conn.page.url(), title: await conn.page.title() });
  } finally {
    await conn.disconnect();
  }
}

async function handleScroll(input: BrowserInput) {
  const { connectToSession } = await import("../sessions/browser-connect.js");
  const conn = await connectToSession(input.session);
  try {
    const distance = input.px ?? 500;
    let dx = 0, dy = 0;
    switch (input.direction ?? "down") {
      case "up": dy = -distance; break;
      case "down": dy = distance; break;
      case "left": dx = -distance; break;
      case "right": dx = distance; break;
    }
    await conn.page.evaluate(({ dx, dy }) => window.scrollBy(dx, dy), { dx, dy });
    return result({ action: "scroll", success: true, direction: input.direction ?? "down", px: distance });
  } finally {
    await conn.disconnect();
  }
}

async function handleWait(input: BrowserInput) {
  const { connectToSession } = await import("../sessions/browser-connect.js");
  const conn = await connectToSession(input.session);
  try {
    if (input.wait_for) {
      // Try as selector first, then text
      try {
        await conn.page.waitForSelector(input.wait_for, { timeout: input.ms ?? 10_000 });
      } catch {
        await conn.page.waitForFunction(
          (text: string) => document.body.innerText.includes(text),
          input.wait_for,
          { timeout: input.ms ?? 10_000 },
        );
      }
    } else {
      await conn.page.waitForTimeout(input.ms ?? 1000);
    }
    return result({ action: "wait", success: true });
  } finally {
    await conn.disconnect();
  }
}

async function handleEval(input: BrowserInput) {
  if (!input.script) {
    return result({ error: "script required for eval action" });
  }

  const { connectToSession } = await import("../sessions/browser-connect.js");
  const conn = await connectToSession(input.session);
  try {
    // Same pattern as action-executor.ts — user explicitly provides JS for browser execution
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const evalFn = new Function(input.script) as () => unknown;
    const evalResult = await conn.page.evaluate(evalFn);
    return result({ action: "eval", success: true, result: evalResult });
  } finally {
    await conn.disconnect();
  }
}

async function handleGetUrl(input: BrowserInput) {
  const { connectToSession } = await import("../sessions/browser-connect.js");
  const conn = await connectToSession(input.session);
  try {
    const url = conn.page.url();
    const title = await conn.page.title();
    return result({ url, title });
  } finally {
    await conn.disconnect();
  }
}

async function handleScreenshot(input: BrowserInput) {
  const { connectToSession } = await import("../sessions/browser-connect.js");
  const conn = await connectToSession(input.session);
  try {
    const buf = await conn.page.screenshot({ fullPage: input.full });
    const base64 = buf.toString("base64");

    if (input.output) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(input.output, buf);
      return result({ action: "screenshot", success: true, path: input.output, size: buf.length });
    }

    return {
      content: [
        { type: "image" as const, data: base64, mimeType: "image/png" },
        { type: "text" as const, text: JSON.stringify({ action: "screenshot", success: true, size: buf.length }) },
      ],
    };
  } finally {
    await conn.disconnect();
  }
}

/**
 * Ensure snapshot refs are loaded into memory for this session.
 * Checks memory first, then falls back to disk.
 */
async function ensureRefsLoaded(session: string): Promise<void> {
  const { getSnapshotStore, loadSnapshotFromDisk } = await import("../snapshot/store.js");
  const store = getSnapshotStore();
  if (store.getRefs(session)) return;
  await loadSnapshotFromDisk(session);
}

// ── Main Execute ──

export async function execute(input: BrowserInput) {
  switch (input.action) {
    case "start": return handleStart(input);
    case "stop": return handleStop(input);
    case "snapshot": return handleSnapshot(input);
    case "click": return handleClick(input);
    case "type": return handleType(input);
    case "navigate": return handleNavigate(input);
    case "scroll": return handleScroll(input);
    case "wait": return handleWait(input);
    case "eval": return handleEval(input);
    case "get-url": return handleGetUrl(input);
    case "screenshot": return handleScreenshot(input);
    default:
      return result({ error: `Unknown browser action: ${(input as { action: string }).action}` });
  }
}
