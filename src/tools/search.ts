import { z } from "zod";
import { issueRequest } from "../brave-api/index.js";
import { hasBraveApiKey } from "../config.js";
import { MAX_QUERY_LENGTH } from "../constants.js";

export const name = "search";

export const description = "Search the web using Brave Search API. Requires BRAVE_API_KEY environment variable.";

export const schema = z.object({
  query: z.string().min(1).max(MAX_QUERY_LENGTH).describe("Search query"),
  count: z.number().min(1).max(20).default(10).describe("Number of results"),
  country: z.string().max(10).optional().describe("Country code (e.g. 'US', 'GB')"),
  freshness: z
    .enum(["pd", "pw", "pm", "py"])
    .optional()
    .describe("Freshness: pd=past day, pw=past week, pm=past month, py=past year"),
});

export type SearchInput = z.infer<typeof schema>;

export async function execute(input: SearchInput) {
  if (!hasBraveApiKey()) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ error: "BRAVE_API_KEY is required for search. Set it in your environment." }),
        },
      ],
    };
  }

  const data = await issueRequest(process.env.BRAVE_API_KEY!, "/web/search", {
    q: input.query,
    count: input.count,
    country: input.country,
    freshness: input.freshness,
  });

  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}
