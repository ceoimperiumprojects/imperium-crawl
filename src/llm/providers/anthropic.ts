import type { LLMClient, LLMMessage, LLMResponse } from "../index.js";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export class AnthropicClient implements LLMClient {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async complete(messages: LLMMessage[], maxTokens = 2000): Promise<LLMResponse> {
    // Anthropic separates system messages from the messages array
    const systemMessages = messages.filter((m) => m.role === "system");
    const chatMessages = messages.filter((m) => m.role !== "system");
    const system = systemMessages.map((m) => m.content).join("\n") || undefined;

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: maxTokens,
      messages: chatMessages.map((m) => ({ role: m.role, content: m.content })),
    };
    if (system) body.system = system;

    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => res.statusText);
      throw new Error(`Anthropic API error ${res.status}: ${errorText}`);
    }

    const data = (await res.json()) as {
      content: Array<{ type: string; text?: string }>;
      model: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const text = data.content.find((c) => c.type === "text")?.text || "";
    return {
      text,
      model: data.model,
      inputTokens: data.usage?.input_tokens,
      outputTokens: data.usage?.output_tokens,
    };
  }
}
