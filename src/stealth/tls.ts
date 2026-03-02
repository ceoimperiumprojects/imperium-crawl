import { Impit } from "impit";
import { generateHeaders } from "./headers.js";

export interface StealthFetchOptions {
  url: string;
  timeout?: number;
  headers?: Record<string, string>;
}

export interface StealthFetchResult {
  html: string;
  status: number;
  url: string;
}

export async function stealthFetch(options: StealthFetchOptions): Promise<StealthFetchResult> {
  const headers = generateHeaders(options.headers);
  const impit = new Impit();

  const res = await impit.fetch(options.url, {
    headers,
  });

  const html = await res.text();
  return {
    html,
    status: res.status,
    url: res.url || options.url,
  };
}
