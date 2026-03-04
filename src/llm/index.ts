export interface LLMMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface LLMResponse {
  text: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface LLMClient {
  complete(messages: LLMMessage[], maxTokens?: number): Promise<LLMResponse>;
}

export type LLMProvider = "anthropic" | "openai" | "minimax";

export function getLLMConfig(): { provider: LLMProvider; apiKey: string; model: string } | null {
  const apiKey = process.env.LLM_API_KEY?.trim();
  if (!apiKey) return null;

  const providerRaw = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();
  const provider: LLMProvider =
    providerRaw === "openai" ? "openai" : providerRaw === "minimax" ? "minimax" : "anthropic";

  let defaultModel: string;
  if (provider === "openai") defaultModel = "gpt-4o-mini";
  else if (provider === "minimax") defaultModel = "MiniMax-M2.5";
  else defaultModel = "claude-haiku-4-5-20251001";

  const model = process.env.LLM_MODEL?.trim() || defaultModel;

  return { provider, apiKey, model };
}

export function hasLLMConfigured(): boolean {
  return !!process.env.LLM_API_KEY?.trim();
}

export async function createLLMClient(): Promise<LLMClient> {
  const config = getLLMConfig();
  if (!config) {
    throw new Error("LLM_API_KEY environment variable is not set. Set it to use AI extraction features.");
  }

  if (config.provider === "openai") {
    const { OpenAIClient } = await import("./providers/openai.js");
    return new OpenAIClient(config.apiKey, config.model);
  }

  if (config.provider === "minimax") {
    const { MiniMaxClient } = await import("./providers/minimax.js");
    return new MiniMaxClient(config.apiKey, config.model);
  }

  const { AnthropicClient } = await import("./providers/anthropic.js");
  return new AnthropicClient(config.apiKey, config.model);
}
