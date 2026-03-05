/**
 * Dual diff system — text (Myers) + image (pixel comparison).
 *
 * Text diff: Line-level Myers algorithm on snapshot strings.
 * Image diff: Canvas-based pixel comparison in an isolated browser page.
 */

type Page = import("rebrowser-playwright").Page;
type BrowserContext = import("rebrowser-playwright").BrowserContext;

// ── Text Diff (Myers algorithm) ──

export interface TextDiffResult {
  diff: string;
  additions: number;
  removals: number;
  unchanged: number;
  changed: boolean;
}

interface EditPath {
  x: number;
  history: Array<{ type: "equal" | "add" | "remove"; line: string }>;
}

/**
 * Myers diff algorithm (line-level).
 * Returns unified diff format with +/- prefixes.
 */
export function diffSnapshots(before: string, after: string): TextDiffResult {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");

  const n = beforeLines.length;
  const m = afterLines.length;
  const max = n + m;

  // Shortcut: identical
  if (before === after) {
    return {
      diff: beforeLines.map((l) => `  ${l}`).join("\n"),
      additions: 0,
      removals: 0,
      unchanged: n,
      changed: false,
    };
  }

  // Myers shortest edit script
  const v: Record<number, EditPath> = { 1: { x: 0, history: [] } };

  for (let d = 0; d <= max; d++) {
    for (let k = -d; k <= d; k += 2) {
      let path: EditPath;

      // Choose path: go down (insert) or go right (delete)
      if (k === -d || (k !== d && v[k - 1].x < v[k + 1].x)) {
        // Move down: insert from after
        const prev = v[k + 1];
        path = {
          x: prev.x,
          history: [...prev.history, { type: "add", line: afterLines[prev.x - k - 1] ?? "" }],
        };
      } else {
        // Move right: delete from before
        const prev = v[k - 1];
        path = {
          x: prev.x + 1,
          history: [...prev.history, { type: "remove", line: beforeLines[prev.x] ?? "" }],
        };
      }

      // Follow diagonal (equal lines)
      while (path.x < n && path.x - k < m && beforeLines[path.x] === afterLines[path.x - k]) {
        path.history = [...path.history, { type: "equal", line: beforeLines[path.x] }];
        path.x++;
      }

      // Check if we reached the end
      if (path.x >= n && path.x - k >= m) {
        let additions = 0;
        let removals = 0;
        let unchanged = 0;
        const lines: string[] = [];

        for (const entry of path.history) {
          switch (entry.type) {
            case "equal":
              lines.push(`  ${entry.line}`);
              unchanged++;
              break;
            case "add":
              lines.push(`+ ${entry.line}`);
              additions++;
              break;
            case "remove":
              lines.push(`- ${entry.line}`);
              removals++;
              break;
          }
        }

        return {
          diff: lines.join("\n"),
          additions,
          removals,
          unchanged,
          changed: additions > 0 || removals > 0,
        };
      }

      v[k] = path;
    }
  }

  // Should never reach here for valid inputs
  return { diff: "", additions: 0, removals: 0, unchanged: 0, changed: false };
}

// ── Image Diff (pixel comparison via canvas) ──

export interface ImageDiffResult {
  mismatchPercentage: number;
  match: boolean;
  diffImage: Buffer;
  totalPixels: number;
  changedPixels: number;
}

export interface ImageDiffOptions {
  /** Color distance threshold (0-255). Default: 30 */
  threshold?: number;
  /** Match if mismatch is below this % (default: 1.0) */
  matchThreshold?: number;
}

/**
 * Pixel-level comparison of two screenshots.
 * Opens an isolated page, loads images via intercepted routes,
 * computes per-pixel color distance, generates diff PNG.
 */
export async function diffScreenshots(
  context: BrowserContext,
  baseline: Buffer,
  current: Buffer,
  options: ImageDiffOptions = {},
): Promise<ImageDiffResult> {
  const { threshold = 30, matchThreshold = 1.0 } = options;

  const page: Page = await context.newPage();

  try {
    // Intercept image routes to serve our buffers
    await page.route("**/baseline.png", (route) => {
      route.fulfill({
        status: 200,
        contentType: "image/png",
        body: baseline,
      });
    });

    await page.route("**/current.png", (route) => {
      route.fulfill({
        status: 200,
        contentType: "image/png",
        body: current,
      });
    });

    // Canvas-based pixel diff in browser context
    const result = await page.evaluate(async (thresh: number) => {
      // Load images
      const loadImage = (src: string): Promise<HTMLImageElement> =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = src;
        });

      const [img1, img2] = await Promise.all([
        loadImage("/baseline.png"),
        loadImage("/current.png"),
      ]);

      const width = Math.max(img1.width, img2.width);
      const height = Math.max(img1.height, img2.height);

      // Draw images to canvases
      const canvas1 = document.createElement("canvas");
      canvas1.width = width;
      canvas1.height = height;
      canvas1.getContext("2d")!.drawImage(img1, 0, 0);

      const canvas2 = document.createElement("canvas");
      canvas2.width = width;
      canvas2.height = height;
      canvas2.getContext("2d")!.drawImage(img2, 0, 0);

      // Diff canvas
      const diffCanvas = document.createElement("canvas");
      diffCanvas.width = width;
      diffCanvas.height = height;
      const diffCtx = diffCanvas.getContext("2d")!;

      const data1 = canvas1.getContext("2d")!.getImageData(0, 0, width, height).data;
      const data2 = canvas2.getContext("2d")!.getImageData(0, 0, width, height).data;
      const diffData = diffCtx.createImageData(width, height);

      let changed = 0;
      const totalPixels = width * height;

      for (let i = 0; i < data1.length; i += 4) {
        const dr = Math.abs(data1[i] - data2[i]);
        const dg = Math.abs(data1[i + 1] - data2[i + 1]);
        const db = Math.abs(data1[i + 2] - data2[i + 2]);
        const dist = Math.sqrt(dr * dr + dg * dg + db * db);

        if (dist > thresh) {
          // Highlight difference in red
          diffData.data[i] = 255;
          diffData.data[i + 1] = 0;
          diffData.data[i + 2] = 0;
          diffData.data[i + 3] = 200;
          changed++;
        } else {
          // Darken unchanged pixels
          diffData.data[i] = Math.floor(data2[i] * 0.3);
          diffData.data[i + 1] = Math.floor(data2[i + 1] * 0.3);
          diffData.data[i + 2] = Math.floor(data2[i + 2] * 0.3);
          diffData.data[i + 3] = 255;
        }
      }

      diffCtx.putImageData(diffData, 0, 0);

      // Export as data URL
      const dataUrl = diffCanvas.toDataURL("image/png");
      return {
        totalPixels,
        changedPixels: changed,
        mismatchPercentage: (changed / totalPixels) * 100,
        dataUrl,
      };
    }, threshold);

    // Convert data URL to buffer
    const base64Data = result.dataUrl.split(",")[1];
    const diffImage = Buffer.from(base64Data, "base64");

    return {
      mismatchPercentage: result.mismatchPercentage,
      match: result.mismatchPercentage <= matchThreshold,
      diffImage,
      totalPixels: result.totalPixels,
      changedPixels: result.changedPixels,
    };
  } finally {
    await page.close();
  }
}
