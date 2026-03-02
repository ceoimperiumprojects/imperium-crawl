import path from "node:path";
import os from "node:os";
import { SKILLS_DIR_NAME, SKILLS_SUBDIR, DEFAULT_BROWSER_POOL_SIZE, KNOWLEDGE_FILE } from "./constants.js";

export interface ServerOptions {
  braveApiKey?: string;
  twoCaptchaApiKey?: string;
  transport: "stdio" | "http";
  port: number;
  respectRobots: boolean;
  proxyUrl?: string;
  browserPoolSize: number;
  chromeProfilePath?: string;
}

export function getOptions(): ServerOptions {
  const transportRaw = process.env.TRANSPORT || "stdio";
  if (transportRaw !== "stdio" && transportRaw !== "http") {
    throw new Error(`Invalid TRANSPORT value "${transportRaw}". Must be "stdio" or "http".`);
  }

  const portRaw = parseInt(process.env.PORT || "3000", 10);
  const port = isNaN(portRaw) || portRaw < 1 || portRaw > 65535 ? 3000 : portRaw;

  return {
    braveApiKey: process.env.BRAVE_API_KEY || undefined,
    twoCaptchaApiKey: process.env.TWOCAPTCHA_API_KEY || process.env.TWO_CAPTCHA_API_KEY || undefined,
    transport: transportRaw,
    port,
    respectRobots: process.env.RESPECT_ROBOTS !== "false",
    proxyUrl: process.env.PROXY_URL || undefined,
    browserPoolSize: getBrowserPoolSize(),
    chromeProfilePath: getChromeProfilePath(),
  };
}

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

export function getChromeProfilePath(): string | undefined {
  return process.env.CHROME_PROFILE_PATH?.trim() || undefined;
}

export function hasChromeProfileConfigured(): boolean {
  return !!getChromeProfilePath();
}
