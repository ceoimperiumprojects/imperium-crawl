import { z } from "zod";
import { isPlaywrightAvailable } from "../stealth/browser.js";
import { acquirePage } from "../stealth/chrome-profile.js";
import { resolveProxy } from "../stealth/proxy.js";
import { normalizeUrl } from "../utils/url.js";
import { getSessionManager } from "../sessions/index.js";
import { getEnhancedSnapshot, getSnapshotStore, annotateScreenshot } from "../snapshot/index.js";
import { installDomainFilter } from "../security/domain-filter.js";
import { MAX_URL_LENGTH, MAX_TIMEOUT_MS } from "../constants.js";

export const name = "snapshot";

export const description =
  "Take an ARIA-based accessibility snapshot of a web page. Returns a structured tree with interactive element refs (e.g. [ref=e1]) that can be used in the interact tool for precise element targeting. Workflow: snapshot → analyze refs → interact with ref targeting → snapshot again to verify.";

export const schema = z.object({
  url: z.string().max(MAX_URL_LENGTH).describe("URL to snapshot"),
  session_id: z
    .string()
    .max(200)
    .optional()
    .describe("Session ID to restore cookies and store refs. Also used as snapshot key for ref resolution."),
  interactive: z
    .boolean()
    .default(true)
    .describe("Only include interactive elements (buttons, links, inputs). Set false for full page content. (default: true)"),
  cursor: z
    .boolean()
    .default(false)
    .describe("Detect cursor:pointer/onclick elements without ARIA roles (default: false)"),
  compact: z
    .boolean()
    .default(true)
    .describe("Filter structural elements without refs for a cleaner tree (default: true)"),
  scope_selector: z
    .string()
    .max(500)
    .optional()
    .describe("CSS selector to scope snapshot to a subtree (e.g. '#main-content', '.sidebar')"),
  return_screenshot: z
    .boolean()
    .default(false)
    .describe("Include a screenshot of the page"),
  annotate: z
    .boolean()
    .default(false)
    .describe("Overlay numbered badges on interactive elements in the screenshot. Requires return_screenshot: true."),
  chrome_profile: z
    .string()
    .max(1000)
    .optional()
    .describe("Path to Chrome user data directory. Overrides CHROME_PROFILE_PATH env var."),
  proxy: z
    .string()
    .max(MAX_URL_LENGTH)
    .optional()
    .describe("Proxy URL. Overrides PROXY_URL env var."),
  timeout: z
    .number()
    .min(1000)
    .max(MAX_TIMEOUT_MS)
    .default(30000)
    .describe("Navigation timeout in ms (default: 30000)"),
  allowed_domains: z
    .array(z.string().max(500))
    .max(100)
    .optional()
    .describe("Domain whitelist. Blocks requests to non-allowed domains. Supports wildcards (e.g. '*.example.com')."),
});

export type SnapshotInput = z.infer<typeof schema>;

export async function execute(input: SnapshotInput) {
  if (!(await isPlaywrightAvailable())) {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          error: "rebrowser-playwright is required for the snapshot tool. Install with: npm i rebrowser-playwright",
        }, null, 2),
      }],
    };
  }

  const url = normalizeUrl(input.url);
  const proxyUrl = resolveProxy(input.proxy);
  const snapshotId = input.session_id ?? `snap_${Date.now()}`;

  const handle = await acquirePage({
    chromeProfile: input.chrome_profile,
    proxyUrl,
  });

  try {
    const { page } = handle;

    // Install domain filter
    if (input.allowed_domains?.length) {
      await installDomainFilter(page.context(), input.allowed_domains);
    }

    // Restore session cookies if session_id provided
    if (input.session_id) {
      const session = await getSessionManager().load(input.session_id);
      if (session?.cookies.length) {
        await page.context().addCookies(session.cookies);
      }
    }

    // Navigate
    await page.goto(url, { waitUntil: "load", timeout: input.timeout });

    // Take snapshot
    const snapshot = await getEnhancedSnapshot(page, {
      interactive: input.interactive,
      cursor: input.cursor,
      compact: input.compact,
      selector: input.scope_selector,
    });

    // Store refs for later use by interact tool
    getSnapshotStore().save(snapshotId, snapshot.refs, page.url());

    // Build output
    const output: Record<string, unknown> = {
      snapshot_id: snapshotId,
      url: page.url(),
      tree: snapshot.tree,
      stats: {
        ...snapshot.stats,
        refCount: Object.keys(snapshot.refs).length,
        treeLines: snapshot.tree.split("\n").length,
        treeChars: snapshot.tree.length,
      },
    };

    const content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> = [
      { type: "text", text: JSON.stringify(output, null, 2) },
    ];

    // Optional screenshot (plain or annotated)
    if (input.return_screenshot) {
      const buf = input.annotate
        ? await annotateScreenshot(page, snapshot.refs)
        : await page.screenshot({ fullPage: false });
      content.push({
        type: "image",
        data: buf.toString("base64"),
        mimeType: "image/png",
      });
    }

    // Save session if session_id provided
    if (input.session_id) {
      try {
        const cookies = await page.context().cookies();
        const stored = cookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          expires: c.expires,
          httpOnly: c.httpOnly,
          secure: c.secure,
          sameSite: c.sameSite as "Strict" | "Lax" | "None",
        }));
        await getSessionManager().save(input.session_id, stored, page.url());
      } catch {
        // Non-critical — snapshot was still taken successfully
      }
    }

    return { content };
  } finally {
    await handle.cleanup();
  }
}
