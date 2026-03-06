import path from "node:path";
import os from "node:os";
import { SKILLS_DIR_NAME, SKILLS_SUBDIR, SESSIONS_SUBDIR, JOBS_SUBDIR, DEFAULT_BROWSER_POOL_SIZE, KNOWLEDGE_FILE } from "./constants.js";

export function hasBraveApiKey(): boolean {
  return !!process.env.BRAVE_API_KEY;
}

export function hasTwoCaptchaApiKey(): boolean {
  return !!(process.env.TWOCAPTCHA_API_KEY || process.env.TWO_CAPTCHA_API_KEY);
}

export function getTwoCaptchaApiKey(): string | undefined {
  return process.env.TWOCAPTCHA_API_KEY || process.env.TWO_CAPTCHA_API_KEY || undefined;
}

export function hasProxyConfigured(): boolean {
  return !!(process.env.PROXY_URL?.trim() || process.env.PROXY_URLS?.trim());
}

export function getBrowserPoolSize(): number {
  const size = parseInt(process.env.BROWSER_POOL_SIZE || "", 10);
  if (isNaN(size) || size < 1 || size > 20) return DEFAULT_BROWSER_POOL_SIZE;
  return size;
}

export function getSkillsDir(): string {
  return path.join(os.homedir(), SKILLS_DIR_NAME, SKILLS_SUBDIR);
}

export function getKnowledgeFilePath(): string {
  return path.join(os.homedir(), SKILLS_DIR_NAME, KNOWLEDGE_FILE);
}

export function getSessionsDir(): string {
  return path.join(os.homedir(), SKILLS_DIR_NAME, SESSIONS_SUBDIR);
}

export function getJobsDir(): string {
  return path.join(os.homedir(), SKILLS_DIR_NAME, JOBS_SUBDIR);
}

export function getChromeProfilePath(): string | undefined {
  return process.env.CHROME_PROFILE_PATH?.trim() || undefined;
}

export function hasChromeProfileConfigured(): boolean {
  return !!getChromeProfilePath();
}

export function getLLMProvider(): "anthropic" | "openai" | "minimax" {
  const raw = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();
  return raw === "openai" ? "openai" : raw === "minimax" ? "minimax" : "anthropic";
}

export function getLLMApiKey(): string | undefined {
  return process.env.LLM_API_KEY?.trim() || undefined;
}

export function getLLMModel(): string | undefined {
  return process.env.LLM_MODEL?.trim() || undefined;
}

export function hasLLMConfigured(): boolean {
  return !!getLLMApiKey();
}
