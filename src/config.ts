import path from "node:path";
import os from "node:os";
import { SKILLS_DIR_NAME, SKILLS_SUBDIR } from "./constants.js";

export interface ServerOptions {
  braveApiKey?: string;
  twoCaptchaApiKey?: string;
  transport: "stdio" | "http";
  port: number;
  respectRobots: boolean;
}

export function getOptions(): ServerOptions {
  return {
    braveApiKey: process.env.BRAVE_API_KEY || undefined,
    twoCaptchaApiKey: process.env.TWOCAPTCHA_API_KEY || process.env.TWO_CAPTCHA_API_KEY || undefined,
    transport: (process.env.TRANSPORT as "stdio" | "http") || "stdio",
    port: parseInt(process.env.PORT || "3000", 10),
    respectRobots: process.env.RESPECT_ROBOTS !== "false",
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

export function getSkillsDir(): string {
  return path.join(os.homedir(), SKILLS_DIR_NAME, SKILLS_SUBDIR);
}
