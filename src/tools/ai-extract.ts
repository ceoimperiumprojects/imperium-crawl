import { z } from "zod";
import { smartFetch } from "../stealth/index.js";
import { normalizeUrl } from "../utils/url.js";
import { htmlToMarkdown } from "../utils/markdown.js";
import { createLLMClient, hasLLMConfigured } from "../llm/index.js";
import { extractWithLLM } from "../llm/extractor.js";
import { MAX_URL_LENGTH } from "../constants.js";

export const name = "ai_extract";

export const description =
  "Extract structured data from a web page using AI/LLM. Describe what you want to extract in natural language or provide a JSON schema. Supports auto mode where the AI decides what to extract. Requires LLM_API_KEY environment variable.";

export const schema = z.object({
  url: z.string().max(MAX_URL_LENGTH).describe("The URL to extract data from"),
  schema: z
    .union([z.string(), z.record(z.unknown()), z.literal("auto")])
    .describe(
      'What to extract. Options: (1) Natural language description e.g. "extract all products with name, price, rating"; (2) JSON schema object; (3) "auto" — AI automatically identifies and extracts all structured data',
    ),
  format: z
    .enum(["json", "csv"])
    .default("json")
    .describe("Output format. json (default) returns structured JSON, csv returns comma-separated values"),
  max_tokens: z
    .number()
    .int()
    .min(100)
    .max(8000)
    .default(2000)
    .describe("Maximum tokens for LLM response (default: 2000)"),
  proxy: z.string().max(MAX_URL_LENGTH).optional().describe("Proxy URL (http/https/socks4/socks5)"),
  chrome_profile: z.string().max(1000).optional().describe("Chrome user data directory path for authenticated sessions"),
});

export type AiExtractInput = z.infer<typeof schema>;

function jsonToCsv(data: unknown): string {
  // Handle array of objects
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === "object" && data[0] !== null) {
    const headers = Object.keys(data[0] as Record<string, unknown>);
    const rows = data.map((item) => {
      const obj = item as Record<string, unknown>;
      return headers.map((h) => {
        const val = obj[h];
        const str = val === null || val === undefined ? "" : String(val);
        // Escape commas and quotes in CSV
        return str.includes(",") || str.includes('"') || str.includes("\n")
          ? `"${str.replace(/"/g, '""')}"`
          : str;
      });
    });
    return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  }

  // Fallback: JSON stringify for non-array or mixed data
  return JSON.stringify(data, null, 2);
}

export async function execute(input: AiExtractInput) {
  if (!hasLLMConfigured()) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              error: "LLM not configured",
              message:
                "Set the LLM_API_KEY environment variable to enable AI extraction. Optionally set LLM_PROVIDER (anthropic|openai) and LLM_MODEL.",
            },
            null,
            2,
          ),
        },
      ],
    };
  }

  const url = normalizeUrl(input.url);

  // Fetch page via stealth engine
  const fetchResult = await smartFetch(url, {
    proxy: input.proxy,
    chromeProfile: input.chrome_profile,
  });

  // Convert HTML to clean markdown for LLM consumption
  const markdown = htmlToMarkdown(fetchResult.html);

  // Create LLM client and run extraction
  const client = await createLLMClient();
  const result = await extractWithLLM(client, markdown, input.schema, input.max_tokens);

  // Format output
  const outputData = input.format === "csv" ? jsonToCsv(result.data) : JSON.stringify(result.data, null, 2);

  const metadata = {
    url: fetchResult.url,
    stealthLevel: fetchResult.level,
    model: result.model,
    schema: result.schemaUsed,
    format: input.format,
    ...(result.tokenUsage && { tokenUsage: result.tokenUsage }),
  };

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            metadata,
            data: input.format === "json" ? result.data : outputData,
          },
          null,
          2,
        ),
      },
    ],
  };
}
