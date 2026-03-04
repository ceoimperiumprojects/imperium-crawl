/**
 * MiniMax LLM provider — thin wrapper around OpenAIClient.
 *
 * MiniMax uses an OpenAI-compatible API, so only the base URL
 * and default model differ.
 *
 * Env vars:
 *   LLM_PROVIDER=minimax
 *   LLM_API_KEY=sk-cp-...
 *   LLM_MODEL=MiniMax-M2.5  (optional, default below)
 */

import { OpenAIClient } from "./openai.js";

const MINIMAX_API_URL = "https://api.minimax.io/v1/chat/completions";
export const MINIMAX_DEFAULT_MODEL = "MiniMax-M2.5";

export class MiniMaxClient extends OpenAIClient {
  constructor(apiKey: string, model = MINIMAX_DEFAULT_MODEL) {
    super(apiKey, model, MINIMAX_API_URL);
  }
}
