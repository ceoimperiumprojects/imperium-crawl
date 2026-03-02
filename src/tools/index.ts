import { z } from "zod";

import * as scrape from "./scrape.js";
import * as crawl from "./crawl.js";
import * as map from "./map.js";
import * as extract from "./extract.js";
import * as readability from "./readability.js";
import * as screenshot from "./screenshot.js";
import * as search from "./search.js";
import * as newsSearch from "./news-search.js";
import * as imageSearch from "./image-search.js";
import * as videoSearch from "./video-search.js";
import * as createSkill from "./create-skill.js";
import * as runSkill from "./run-skill.js";
import * as listSkills from "./list-skills.js";
import * as discoverApis from "./discover-apis.js";
import * as queryApi from "./query-api.js";
import * as monitorWebsocket from "./monitor-websocket.js";

export interface ToolDefinition {
  name: string;
  description: string;
  schema: z.ZodType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute: (input: any) => Promise<{ content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> }>;
}

export const allTools: ToolDefinition[] = [
  // Scraping tools (no API key needed)
  scrape as ToolDefinition,
  crawl as ToolDefinition,
  map as ToolDefinition,
  extract as ToolDefinition,
  readability as ToolDefinition,
  screenshot as ToolDefinition,
  // Search tools (Brave API key needed)
  search as ToolDefinition,
  newsSearch as ToolDefinition,
  imageSearch as ToolDefinition,
  videoSearch as ToolDefinition,
  // Skills tools
  createSkill as ToolDefinition,
  runSkill as ToolDefinition,
  listSkills as ToolDefinition,
  // API discovery & real-time tools (Playwright needed)
  discoverApis as ToolDefinition,
  queryApi as ToolDefinition,
  monitorWebsocket as ToolDefinition,
];
