import fs from "node:fs/promises";
import path from "node:path";
import { getSkillsDir } from "../config.js";

const SKILL_NAME_RE = /^[a-zA-Z0-9_-]+$/;

export function validateSkillName(name: string): void {
  if (!SKILL_NAME_RE.test(name)) {
    throw new Error(
      `Invalid skill name "${name}". Only letters, numbers, hyphens, and underscores are allowed.`,
    );
  }
}

export interface SkillFieldSelectors {
  [field: string]: string;
}

export interface SkillPagination {
  next?: string;
  max_pages?: number;
}

// --- Discriminated union for skill configs ---

export type RecipeTool = "extract" | "ai_extract" | "readability" | "scrape" | "monitor_websocket" | "influencer_discovery";

interface SkillConfigBase {
  name: string;
  description: string;
  url: string;
  created_at: string;
  builtin?: boolean;
}

export interface ExtractSkillConfig extends SkillConfigBase {
  tool?: "extract";
  selectors: {
    items: string;
    fields: SkillFieldSelectors;
  };
  output_format: "list" | "single";
  pagination?: SkillPagination;
}

export interface AiExtractSkillConfig extends SkillConfigBase {
  tool: "ai_extract";
  schema: string | Record<string, unknown> | "auto";
  format?: "json" | "csv";
  max_tokens?: number;
}

export interface ReadabilitySkillConfig extends SkillConfigBase {
  tool: "readability";
  format?: "markdown" | "html" | "text";
}

export interface ScrapeSkillConfig extends SkillConfigBase {
  tool: "scrape";
}

export interface WebSocketSkillConfig extends SkillConfigBase {
  tool: "monitor_websocket";
  duration_seconds?: number;
  max_messages?: number;
  filter_url?: string;
}

export interface InfluencerDiscoverySkillConfig extends SkillConfigBase {
  tool: "influencer_discovery";
  workflow: "niche_discovery" | "hashtag_scout" | "competitor_spy" | "content_scout";
  niche: string;
  platforms?: ("youtube" | "instagram" | "brave")[];
  output_format?: "json" | "markdown" | "csv";
  threshold?: number;
  ig_max_calls?: number;
}

export type SkillConfig =
  | ExtractSkillConfig
  | AiExtractSkillConfig
  | ReadabilitySkillConfig
  | ScrapeSkillConfig
  | WebSocketSkillConfig
  | InfluencerDiscoverySkillConfig;

// --- Storage functions ---

async function ensureDir(): Promise<string> {
  const dir = getSkillsDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function save(name: string, config: SkillConfig): Promise<void> {
  validateSkillName(name);
  const dir = await ensureDir();
  const filePath = path.join(dir, `${name}.json`);
  await fs.writeFile(filePath, JSON.stringify(config, null, 2), "utf-8");
}

export async function load(name: string): Promise<SkillConfig | null> {
  validateSkillName(name);
  const dir = getSkillsDir();
  const filePath = path.join(dir, `${name}.json`);
  try {
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data) as SkillConfig;
  } catch {
    return null;
  }
}

export async function list(): Promise<SkillConfig[]> {
  const dir = getSkillsDir();
  try {
    const files = await fs.readdir(dir);
    const skills: SkillConfig[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const data = await fs.readFile(path.join(dir, file), "utf-8");
        skills.push(JSON.parse(data) as SkillConfig);
      } catch {
        // Skip invalid files
      }
    }
    return skills;
  } catch {
    return [];
  }
}

/**
 * List all skills: user skills + builtin recipes.
 * User skills with the same name shadow builtin recipes.
 */
export async function listAll(): Promise<SkillConfig[]> {
  const { builtinRecipes } = await import("../recipes/index.js");
  const userSkills = await list();

  const userNames = new Set(userSkills.map((s) => s.name));
  const recipes = builtinRecipes.filter((r) => !userNames.has(r.name));

  return [...userSkills, ...recipes];
}

/**
 * Load a skill by name. Checks user skills first, then builtin recipes.
 */
export async function loadWithRecipes(name: string): Promise<SkillConfig | null> {
  const userSkill = await load(name);
  if (userSkill) return userSkill;

  const { builtinRecipes } = await import("../recipes/index.js");
  return builtinRecipes.find((r) => r.name === name) ?? null;
}

export async function remove(name: string): Promise<boolean> {
  validateSkillName(name);
  const dir = getSkillsDir();
  const filePath = path.join(dir, `${name}.json`);
  try {
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}
