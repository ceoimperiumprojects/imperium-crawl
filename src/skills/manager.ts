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

export interface SkillConfig {
  name: string;
  description: string;
  url: string;
  created_at: string;
  selectors: {
    items: string;
    fields: SkillFieldSelectors;
  };
  output_format: "list" | "single";
  pagination?: SkillPagination;
}

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
