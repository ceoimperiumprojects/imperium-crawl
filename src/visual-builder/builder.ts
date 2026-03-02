/**
 * Visual Workflow Recorder — Node-side orchestrator.
 *
 * Opens a headed browser, injects a minimal recording bar on ALL pages
 * (including popups and new tabs), and captures every user interaction.
 * Events are pushed to Node in real-time via context-level bindings,
 * so nothing is lost when tabs close.
 */

import { getOverlayScript, type RecordedEvent } from "./overlay.js";

export interface VisualBuilderOptions {
  url: string;
}

export interface PageSummary {
  pageId: string;
  url: string;
  title: string;
  openedAt: number;
  closedAt?: number;
  opener?: string;
}

export interface WorkflowRecording {
  url: string;
  recordedAt: string;
  events: RecordedEvent[];
  pages: PageSummary[];
}

export async function runVisualBuilder(options: VisualBuilderOptions): Promise<WorkflowRecording> {
  const { chromium } = await import("playwright");

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });

  try {
    // ── Node-side event collection ──
    const events: RecordedEvent[] = [];
    const pages: PageSummary[] = [];
    const pageIds = new WeakMap<import("playwright").Page, string>();
    let pageCounter = 0;

    let resolveRecording!: (data: WorkflowRecording) => void;
    let rejectRecording!: (err: Error) => void;
    const recordingPromise = new Promise<WorkflowRecording>((resolve, reject) => {
      resolveRecording = resolve;
      rejectRecording = reject;
    });

    // ── Context-level bindings (work on ALL pages) ──
    await context.exposeFunction("__imperiumPushEvent__", (jsonStr: string) => {
      try { events.push(JSON.parse(jsonStr) as RecordedEvent); } catch { /* skip malformed */ }
    });

    let completed = false;
    await context.exposeFunction("__imperiumComplete__", () => {
      if (completed) return;
      completed = true;
      resolveRecording({
        url: options.url,
        recordedAt: new Date().toISOString(),
        events,
        pages,
      });
    });

    // ── Inject overlay on ALL pages (including popups/new tabs) ──
    await context.addInitScript(getOverlayScript());

    // ── Track pages ──
    function trackPage(page: import("playwright").Page, opener?: string) {
      const id = `page-${pageCounter++}`;
      pageIds.set(page, id);

      const summary: PageSummary = {
        pageId: id,
        url: page.url() || options.url,
        title: "",
        openedAt: Date.now(),
        opener,
      };
      pages.push(summary);

      // Update title once page loads
      page.on("load", () => {
        summary.url = page.url();
        page.title().then((t) => { summary.title = t; }).catch(() => {});
      });

      // Track tab close
      page.on("close", () => {
        summary.closedAt = Date.now();

        events.push({
          type: "tab-close",
          selector: "",
          tagName: "",
          text: summary.title,
          attributes: {},
          parentSelector: "",
          siblingIndex: 0,
          timestamp: Date.now(),
          pageUrl: summary.url,
          tabInfo: { pageId: id, opener },
        });
      });

      return id;
    }

    // ── Listen for new pages (popups, Ctrl+Click new tabs) ──
    context.on("page", async (newPage) => {
      // Find the opener page ID (async in Playwright)
      const openerPage = await newPage.opener();
      const openerId = openerPage ? pageIds.get(openerPage) : undefined;

      const newId = trackPage(newPage, openerId);

      events.push({
        type: "tab-open",
        selector: "",
        tagName: "",
        text: "",
        attributes: {},
        parentSelector: "",
        siblingIndex: 0,
        timestamp: Date.now(),
        pageUrl: newPage.url() || "about:blank",
        tabInfo: { pageId: newId, opener: openerId },
      });
    });

    // Track the initial page
    const page = await context.newPage();
    trackPage(page);

    // Close signal when browser is closed
    context.on("close", () => rejectRecording(new Error("browser-closed")));

    await page.goto(options.url, { waitUntil: "domcontentloaded", timeout: 30_000 });

    // Capture initial title immediately — load event may not have fired yet
    const initialSummary = pages[0];
    if (initialSummary) {
      initialSummary.url = page.url();
      initialSummary.title = await page.title();
    }

    return await recordingPromise;
  } finally {
    await context.close();
    await browser.close();
  }
}
