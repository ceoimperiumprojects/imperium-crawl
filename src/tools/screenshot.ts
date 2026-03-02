import { z } from "zod";
import { normalizeUrl } from "../utils/url.js";
import { isPlaywrightAvailable } from "../stealth/index.js";
import { browserFetch } from "../stealth/browser.js";

export const name = "screenshot";

export const description =
  "Take a screenshot of a web page. Requires rebrowser-playwright to be installed.";

export const schema = z.object({
  url: z.string().describe("The URL to screenshot"),
  full_page: z.boolean().default(true).describe("Capture full page or just viewport"),
});

export type ScreenshotInput = z.infer<typeof schema>;

export async function execute(input: ScreenshotInput) {
  const url = normalizeUrl(input.url);

  if (!(await isPlaywrightAvailable())) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              error:
                "Screenshot requires rebrowser-playwright. Install with: npm i rebrowser-playwright && npx playwright install chromium",
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  const result = await browserFetch(url, { screenshot: true });

  if (!result.screenshot) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ error: "Failed to capture screenshot" }, null, 2),
        },
      ],
    };
  }

  return {
    content: [
      {
        type: "image" as const,
        data: result.screenshot,
        mimeType: "image/png" as const,
      },
    ],
  };
}
