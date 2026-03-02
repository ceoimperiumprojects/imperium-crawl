import { z } from "zod";
import { issueRequest } from "../brave-api/index.js";
import { hasBraveApiKey } from "../config.js";
import { MAX_QUERY_LENGTH } from "../constants.js";

export const name = "news_search";

export const description = "Search for news articles using Brave Search API. Requires BRAVE_API_KEY.";

export const schema = z.object({
  query: z.string().min(1).max(MAX_QUERY_LENGTH).describe("News search query"),
  count: z.number().min(1).max(20).default(10).describe("Number of results"),
  country: z.string().max(10).optional().describe("Country code"),
  freshness: z
    .enum(["pd", "pw", "pm", "py"])
    .optional()
    .describe("Freshness filter"),
});

export type NewsSearchInput = z.infer<typeof schema>;

export async function execute(input: NewsSearchInput) {
  if (!hasBraveApiKey()) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ error: "BRAVE_API_KEY is required for news search." }),
        },
      ],
    };
  }

  const data = await issueRequest(process.env.BRAVE_API_KEY!, "/news/search", {
    q: input.query,
    count: input.count,
    country: input.country,
    freshness: input.freshness,
  });

  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}
