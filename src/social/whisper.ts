/**
 * OpenAI Whisper integration for audio transcription.
 * Used as fallback when YouTube captions are unavailable.
 *
 * Requires LLM_API_KEY with LLM_PROVIDER=openai (or any OpenAI-compatible key).
 */

import { getLLMConfig } from "../llm/index.js";

const WHISPER_API_URL = "https://api.openai.com/v1/audio/transcriptions";
const WHISPER_MODEL = "whisper-1";
const MAX_AUDIO_SIZE = 25 * 1024 * 1024; // 25MB Whisper limit

export interface WhisperResult {
  text: string;
  segments?: Array<{ start: number; end: number; text: string }>;
  language?: string;
  duration?: number;
}

/**
 * Check if Whisper transcription is available (OpenAI API key configured).
 */
export function hasWhisperConfigured(): boolean {
  const config = getLLMConfig();
  if (!config) return false;
  // Whisper only works with OpenAI API keys
  // But users might have LLM_PROVIDER=anthropic with a separate OPENAI_API_KEY
  return config.provider === "openai" || !!process.env.OPENAI_API_KEY?.trim();
}

/**
 * Get the OpenAI API key for Whisper.
 * Prefers OPENAI_API_KEY env var, falls back to LLM_API_KEY if provider is openai.
 */
function getWhisperApiKey(): string | null {
  const explicit = process.env.OPENAI_API_KEY?.trim();
  if (explicit) return explicit;

  const config = getLLMConfig();
  if (config && config.provider === "openai") return config.apiKey;

  return null;
}

/**
 * Transcribe audio data using OpenAI Whisper API.
 * Returns timestamped segments.
 */
export async function transcribeAudio(
  audioData: Buffer | Uint8Array,
  options?: { language?: string; filename?: string },
): Promise<WhisperResult> {
  const apiKey = getWhisperApiKey();
  if (!apiKey) {
    throw new Error(
      "OpenAI API key required for Whisper transcription. Set OPENAI_API_KEY or LLM_API_KEY with LLM_PROVIDER=openai.",
    );
  }

  if (audioData.length > MAX_AUDIO_SIZE) {
    throw new Error(
      `Audio file too large (${Math.round(audioData.length / 1024 / 1024)}MB). Whisper limit is 25MB. Try a shorter video.`,
    );
  }

  const filename = options?.filename || "audio.webm";

  // Build multipart form data manually (no FormData in Node < 18 without polyfill)
  const boundary = `----WhisperBoundary${Date.now()}`;
  const parts: Buffer[] = [];

  // Add model field
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${WHISPER_MODEL}\r\n`,
  ));

  // Add response_format for segments
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\nverbose_json\r\n`,
  ));

  // Add language if specified
  if (options?.language) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${options.language}\r\n`,
    ));
  }

  // Add audio file
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: audio/webm\r\n\r\n`,
  ));
  parts.push(Buffer.from(audioData));
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

  const body = Buffer.concat(parts);

  const res = await fetch(WHISPER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => res.statusText);
    throw new Error(`Whisper API error ${res.status}: ${errorText}`);
  }

  const data = await res.json() as {
    text: string;
    language?: string;
    duration?: number;
    segments?: Array<{ start: number; end: number; text: string }>;
  };

  return {
    text: data.text,
    segments: data.segments?.map((s) => ({
      start: Math.round(s.start * 100) / 100,
      end: Math.round(s.end * 100) / 100,
      text: s.text.trim(),
    })),
    language: data.language,
    duration: data.duration,
  };
}
