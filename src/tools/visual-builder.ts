/**
 * MCP Tool: visual_builder
 *
 * Opens a headed browser in recording mode. Every click the user makes is
 * captured. When the user clicks "End Workflow", the recorded clicks are
 * returned for AI interpretation.
 */

import { z } from "zod";
import { MAX_URL_LENGTH } from "../constants.js";

export const name = "visual_builder";

export const description =
  "Open a browser in workflow-recording mode. The user interacts with the page — " +
  "clicking elements, typing in fields, navigating between pages, opening new tabs " +
  "(Ctrl+Click / middle-click), and working across popups — while a minimal recording " +
  "bar tracks all events on every page. Clicking 'End Workflow' returns all recorded " +
  "events (clicks, inputs, navigations, tab opens/closes with selectors and attributes) " +
  "plus a page summary for the AI to interpret and build an extraction skill or replay " +
  "the workflow.";

export const schema = z.object({
  url: z.string().max(MAX_URL_LENGTH).describe("URL to open in the visual builder"),
});

type Input = z.infer<typeof schema>;

export async function execute(input: Input) {
  const { runVisualBuilder } = await import("../visual-builder/index.js");

  try {
    const recording = await runVisualBuilder({ url: input.url });

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(recording, null, 2),
        },
      ],
    };
  } catch (err) {
    if (err instanceof Error && err.message === "browser-closed") {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ cancelled: true, reason: "Browser closed before ending workflow" }),
          },
        ],
      };
    }
    throw err;
  }
}
