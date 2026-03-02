import { z } from "zod";
import { issueRequest } from "../brave-api/index.js";
import { hasBraveApiKey } from "../config.js";
import { MAX_QUERY_LENGTH } from "../constants.js";

export const name = "image_search";

export const description = "Search for images using Brave Search API. Requires BRAVE_API_KEY.";

export const schema = z.object({
  query: z.string().min(1).max(MAX_QUERY_LENGTH).describe("Image search query"),
  count: z.number().min(1).max(20).default(10).describe("Number of results"),
  country: z.string().max(10).optional().describe("Country code"),
});

export type ImageSearchInput = z.infer<typeof schema>;

export async function execute(input: ImageSearchInput) {
  if (!hasBraveApiKey()) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ error: "BRAVE_API_KEY is required for image search." }),
        },
      ],
    };
  }

  const data = await issueRequest(process.env.BRAVE_API_KEY!, "/images/search", {
    q: input.query,
    count: input.count,
    country: input.country,
  });

  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}
