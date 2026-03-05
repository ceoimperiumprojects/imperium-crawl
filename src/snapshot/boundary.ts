/**
 * Content boundaries — unique markers to wrap content sections.
 * Prevents LLM confusion about where content starts/ends.
 */

import { randomBytes } from "node:crypto";

export function generateBoundary(): string {
  return randomBytes(8).toString("hex");
}

export function wrapContent(content: string, boundary: string): string {
  return `<imperium-boundary:${boundary}>\n${content}\n</imperium-boundary:${boundary}>`;
}
