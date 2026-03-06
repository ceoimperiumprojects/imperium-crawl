export function toolResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

export function errorResult(error: string) {
  return { content: [{ type: "text" as const, text: JSON.stringify({ error }, null, 2) }] };
}
