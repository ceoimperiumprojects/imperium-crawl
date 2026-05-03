import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { SKILLS_DIR_NAME } from "../core/constants.js";
import { FLOW_NAME_RE, flowSchema, type FlowDefinition, type FlowRef, type FlowStorageOptions } from "./types.js";

export function validateFlowName(name: string, label = "flow name"): void {
  if (!FLOW_NAME_RE.test(name)) {
    throw new Error(`Invalid ${label} "${name}". Only letters, numbers, hyphens, and underscores are allowed.`);
  }
}

export function parseFlowRef(ref: string, fallbackVariant?: string): FlowRef {
  const parts = ref.split("/").filter(Boolean);
  if (parts.length === 1 && fallbackVariant) {
    validateFlowName(parts[0], "family");
    validateFlowName(fallbackVariant, "variant");
    return { family: parts[0], variant: fallbackVariant };
  }
  if (parts.length !== 2) {
    throw new Error("Flow reference must be '<family>/<variant>'");
  }
  validateFlowName(parts[0], "family");
  validateFlowName(parts[1], "variant");
  return { family: parts[0], variant: parts[1] };
}

export function getProjectFlowsDir(): string {
  return path.resolve(process.cwd(), "flows");
}

export function getGlobalFlowsDir(): string {
  return path.join(os.homedir(), SKILLS_DIR_NAME, "flows");
}

export function resolveFlowsDir(options: FlowStorageOptions = {}): string {
  if (options.flowsDir) return path.resolve(options.flowsDir);
  if (options.global) return getGlobalFlowsDir();
  return getProjectFlowsDir();
}

export function getFlowPath(ref: FlowRef, options: FlowStorageOptions = {}): string {
  return path.join(resolveFlowsDir(options), ref.family, `${ref.variant}.json`);
}

export async function saveFlow(flow: FlowDefinition, options: FlowStorageOptions = {}): Promise<string> {
  const parsed = flowSchema.parse(flow);
  const filePath = getFlowPath(parsed, options);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(parsed, null, 2), "utf-8");
  return filePath;
}

export async function loadFlow(ref: FlowRef, options: FlowStorageOptions = {}): Promise<{ flow: FlowDefinition; path: string }> {
  const search = options.flowsDir || options.global
    ? [resolveFlowsDir(options)]
    : [getProjectFlowsDir(), getGlobalFlowsDir()];

  for (const dir of search) {
    const filePath = path.join(dir, ref.family, `${ref.variant}.json`);
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      return { flow: flowSchema.parse(JSON.parse(raw)), path: filePath };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
  }

  throw new Error(`Flow not found: ${ref.family}/${ref.variant}`);
}

export async function listFlows(options: FlowStorageOptions = {}): Promise<Array<{ family: string; variant: string; path: string }>> {
  const dirs = options.flowsDir || options.global
    ? [resolveFlowsDir(options)]
    : [getProjectFlowsDir(), getGlobalFlowsDir()];
  const seen = new Set<string>();
  const flows: Array<{ family: string; variant: string; path: string }> = [];

  for (const dir of dirs) {
    let families: string[];
    try {
      families = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const family of families) {
      if (!FLOW_NAME_RE.test(family)) continue;
      const familyDir = path.join(dir, family);
      let files: string[];
      try {
        files = await fs.readdir(familyDir);
      } catch {
        continue;
      }
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const variant = file.slice(0, -5);
        if (!FLOW_NAME_RE.test(variant)) continue;
        const key = `${family}/${variant}`;
        if (seen.has(key)) continue;
        seen.add(key);
        flows.push({ family, variant, path: path.join(familyDir, file) });
      }
    }
  }

  return flows.sort((a, b) => `${a.family}/${a.variant}`.localeCompare(`${b.family}/${b.variant}`));
}

export async function validateStoredFlow(ref: FlowRef, options: FlowStorageOptions = {}) {
  const { flow, path: filePath } = await loadFlow(ref, options);
  return {
    valid: true,
    path: filePath,
    family: flow.family,
    variant: flow.variant,
    inputs: Object.keys(flow.inputs ?? {}),
    steps: flow.steps.length,
  };
}
