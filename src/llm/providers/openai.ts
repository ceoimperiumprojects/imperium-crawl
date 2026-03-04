import type { LLMClient, LLMMessage, LLMResponse } from "../index.js";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

export class OpenAIClient implements LLMClient {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly apiUrl: string = OPENAI_API_URL,
  ) {}

  async complete(messages: LLMMessage[], maxTokens = 2000): Promise<LLMResponse> {
    const res = await fetch(this.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: maxTokens,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => res.statusText);
      throw new Error(`OpenAI API error ${res.status}: ${errorText}`);
    }

    const data = (await res.json()) as {
      choices: Array<{ message?: { content?: string } }>;
      model: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const text = data.choices[0]?.message?.content || "";
    return {
      text,
      model: data.model,
      inputTokens: data.usage?.prompt_tokens,
      outputTokens: data.usage?.completion_tokens,
    };
  }
}
