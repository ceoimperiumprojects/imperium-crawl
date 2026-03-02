import { Impit } from "impit";
import { generateHeaders } from "./headers.js";

export interface StealthFetchOptions {
  url: string;
  timeout?: number;
  headers?: Record<string, string>;
  proxyUrl?: string;
}

export interface StealthFetchResult {
  html: string;
  status: number;
  url: string;
}

export async function stealthFetch(options: StealthFetchOptions): Promise<StealthFetchResult> {
  const headers = generateHeaders(options.headers);
  const timeout = options.timeout ?? 30_000;
  const impit = new Impit(options.proxyUrl ? { proxyUrl: options.proxyUrl } : undefined);

  const fetchPromise = impit.fetch(options.url, {
    headers,
  });

  // Impit doesn't support AbortSignal — use Promise.race as timeout guard
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Impit fetch timed out after ${timeout}ms: ${options.url}`)), timeout).unref(),
  );

  const res = await Promise.race([fetchPromise, timeoutPromise]);

  const html = await res.text();
  return {
    html,
    status: res.status,
    url: res.url || options.url,
  };
}
