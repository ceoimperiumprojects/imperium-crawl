import type { LLMClient } from "./index.js";

export type ExtractionSchema = string | Record<string, unknown> | "auto";

export interface ExtractionResult {
  data: unknown;
  model: string;
  schemaUsed: ExtractionSchema;
  tokenUsage?: { input: number; output: number };
}

const SYSTEM_PROMPT_EXTRACT = `You are a precise data extraction engine. Your job is to extract structured data from web page content.

Rules:
- Return ONLY valid JSON. No explanation, no markdown code blocks, no prose.
- If a field is not found, use null.
- For lists/arrays, return all matching items.
- Be thorough — extract every instance that matches the schema.
- Do not invent or hallucinate data that isn't present in the content.`;

const SYSTEM_PROMPT_AUTO = `You are an intelligent data extraction engine. Your job is to analyze web page content and automatically identify and extract all meaningful structured information.

Rules:
- Return ONLY valid JSON. No explanation, no markdown code blocks, no prose.
- Identify what type of page this is (product listing, article, profile, search results, etc.)
- Extract all structured data that would be useful (prices, titles, links, dates, ratings, authors, etc.)
- Group related data logically.
- Do not include raw HTML, scripts, or navigation noise.
- Be thorough but focused on meaningful content.`;

function buildUserPrompt(schema: ExtractionSchema, content: string): string {
  if (schema === "auto") {
    return `Analyze this web page content and extract all meaningful structured data:\n\n${content}`;
  }

  const schemaStr = typeof schema === "string" ? schema : JSON.stringify(schema, null, 2);
  return `Extract the following information from this web page content.

Schema (what to extract):
${schemaStr}

Web page content:
${content}`;
}

/**
 * Attempt to parse JSON from LLM response.
 * Tries: direct parse → JSON in code block → largest JSON-like substring.
 */
export function parseJsonFromLLMResponse(text: string): unknown {
  const trimmed = text.trim();

  // 1. Direct parse
  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue to fallbacks
  }

  // 2. Extract from markdown code block (```json ... ``` or ``` ... ```)
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch {
      // Continue
    }
  }

  // 3. Find the first complete JSON object or array
  const firstBrace = trimmed.indexOf("{");
  const firstBracket = trimmed.indexOf("[");
  let startIdx = -1;

  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    startIdx = firstBrace;
  } else if (firstBracket !== -1) {
    startIdx = firstBracket;
  }

  if (startIdx !== -1) {
    // Try progressively shorter substrings from startIdx
    for (let end = trimmed.length; end > startIdx; end--) {
      try {
        return JSON.parse(trimmed.slice(startIdx, end));
      } catch {
        // Shrink
      }
    }
  }

  throw new Error(`Could not parse JSON from LLM response. Raw response:\n${trimmed.slice(0, 500)}`);
}

/**
 * Truncate content to avoid hitting token limits.
 * Targets ~120k chars (~30k tokens) which is safe for most models.
 */
function truncateContent(content: string, maxChars = 120_000): string {
  if (content.length <= maxChars) return content;
  return content.slice(0, maxChars) + "\n\n[Content truncated due to length]";
}

export async function extractWithLLM(
  client: LLMClient,
  content: string,
  schema: ExtractionSchema,
  maxTokens = 2000,
): Promise<ExtractionResult> {
  const truncated = truncateContent(content);
  const systemPrompt = schema === "auto" ? SYSTEM_PROMPT_AUTO : SYSTEM_PROMPT_EXTRACT;
  const userPrompt = buildUserPrompt(schema, truncated);

  const response = await client.complete(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    maxTokens,
  );

  const data = parseJsonFromLLMResponse(response.text);

  return {
    data,
    model: response.model,
    schemaUsed: schema,
    tokenUsage:
      response.inputTokens !== undefined && response.outputTokens !== undefined
        ? { input: response.inputTokens, output: response.outputTokens }
        : undefined,
  };
}
