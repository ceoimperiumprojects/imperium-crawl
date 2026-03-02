import { BRAVE_API_BASE } from "../constants.js";

export class BraveApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "BraveApiError";
  }
}

export async function issueRequest(
  apiKey: string,
  endpoint: string,
  params: Record<string, string | number | undefined>,
): Promise<unknown> {
  const url = new URL(`${BRAVE_API_BASE}${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    throw new BraveApiError(res.status, `Brave API ${res.status}: ${text}`);
  }

  return res.json();
}
