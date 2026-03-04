/**
 * Interactive setup wizard for imperium-crawl CLI.
 *
 * Usage: imperium-crawl setup
 *
 * Guides the user through configuring API keys and saves them to
 * ~/.imperium-crawl/config.json for persistent use.
 */

import chalk from "chalk";
import { input, select, confirm } from "@inquirer/prompts";
import { loadCliConfig, saveCliConfig, getCliConfigPath } from "./cli-config.js";

const BANNER = chalk.cyan(`
  ██╗███╗   ███╗██████╗ ███████╗██████╗ ██╗██╗   ██╗███╗   ███╗
  ██║████╗ ████║██╔══██╗██╔════╝██╔══██╗██║██║   ██║████╗ ████║
  ██║██╔████╔██║██████╔╝█████╗  ██████╔╝██║██║   ██║██╔████╔██║
  ██║██║╚██╔╝██║██╔═══╝ ██╔══╝  ██╔══██╗██║██║   ██║██║╚██╔╝██║
  ██║██║ ╚═╝ ██║██║     ███████╗██║  ██║██║╚██████╔╝██║ ╚═╝ ██║
  ╚═╝╚═╝     ╚═╝╚═╝     ╚══════╝╚═╝  ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
`);

export async function runSetup(): Promise<void> {
  console.log(BANNER);
  console.log(chalk.bold("  API Key Setup\n"));

  const existing = loadCliConfig();
  const config: Record<string, string> = { ...existing };

  // ── Brave Search ──────────────────────────────────────────────────
  const hasBrave = !!(process.env.BRAVE_API_KEY || existing.BRAVE_API_KEY);
  if (hasBrave) {
    console.log(
      chalk.green("  ✓ BRAVE_API_KEY") +
        chalk.dim(" — already configured (search, news_search, image_search, video_search)"),
    );
  } else {
    console.log(chalk.dim("  Brave Search enables 4 search tools. Free tier: https://brave.com/search/api/\n"));
    const braveKey = await input({
      message: "Brave Search API key (press Enter to skip):",
    });
    if (braveKey.trim()) config.BRAVE_API_KEY = braveKey.trim();
  }

  console.log();

  // ── LLM Provider ─────────────────────────────────────────────────
  const hasLLM = !!(process.env.LLM_API_KEY || existing.LLM_API_KEY);
  if (hasLLM) {
    const currentProvider = process.env.LLM_PROVIDER || existing.LLM_PROVIDER || "anthropic";
    console.log(
      chalk.green(`  ✓ LLM_API_KEY (${currentProvider})`) +
        chalk.dim(" — already configured (ai_extract tool)"),
    );
  } else {
    console.log(chalk.dim("  LLM key enables the ai_extract tool — natural language data extraction.\n"));
    const provider = await select({
      message: "LLM provider (for ai_extract tool):",
      choices: [
        {
          name: "Anthropic (Claude Haiku — default)",
          value: "anthropic",
          description: "Fast, affordable. Get key: https://console.anthropic.com",
        },
        {
          name: "OpenAI (GPT-4o mini — default)",
          value: "openai",
          description: "Widely used. Get key: https://platform.openai.com",
        },
        {
          name: "MiniMax (M2.5 — 200K context, reasoning)",
          value: "minimax",
          description: "Strong model, OpenAI-compatible API.",
        },
        {
          name: "Skip for now",
          value: "skip",
          description: "Configure later via env vars or run setup again.",
        },
      ],
    });

    if (provider !== "skip") {
      config.LLM_PROVIDER = provider;
      const providerLabel =
        provider === "anthropic" ? "Anthropic" : provider === "openai" ? "OpenAI" : "MiniMax";
      const llmKey = await input({
        message: `${providerLabel} API key:`,
      });
      if (llmKey.trim()) config.LLM_API_KEY = llmKey.trim();
    }
  }

  console.log();

  // ── 2Captcha ─────────────────────────────────────────────────────
  const hasCaptcha = !!(
    process.env.TWOCAPTCHA_API_KEY ||
    process.env.TWO_CAPTCHA_API_KEY ||
    existing.TWOCAPTCHA_API_KEY
  );
  if (hasCaptcha) {
    console.log(
      chalk.green("  ✓ TWOCAPTCHA_API_KEY") +
        chalk.dim(" — already configured (auto CAPTCHA solving in stealth level 3)"),
    );
  } else {
    const wantCaptcha = await confirm({
      message: "Configure 2Captcha for automatic CAPTCHA solving? (optional)",
      default: false,
    });
    if (wantCaptcha) {
      const captchaKey = await input({
        message: "2Captcha API key (https://2captcha.com):",
      });
      if (captchaKey.trim()) config.TWOCAPTCHA_API_KEY = captchaKey.trim();
    }
  }

  // ── Save + Summary ────────────────────────────────────────────────
  saveCliConfig(config);

  console.log("\n" + chalk.bold("  ─────────────────────────────────────────"));

  const enabledTools: string[] = [];
  if (config.BRAVE_API_KEY || process.env.BRAVE_API_KEY) {
    enabledTools.push("search, news_search, image_search, video_search");
  }
  if (config.LLM_API_KEY || process.env.LLM_API_KEY) {
    enabledTools.push("ai_extract");
  }
  if (config.TWOCAPTCHA_API_KEY || process.env.TWOCAPTCHA_API_KEY) {
    enabledTools.push("CAPTCHA auto-solve (stealth lvl 3)");
  }

  if (enabledTools.length > 0) {
    console.log(chalk.green(`\n  🚀 Ready! Extra tools enabled: ${enabledTools.join(", ")}`));
  } else {
    console.log(
      chalk.yellow("\n  ⚠ No API keys configured.") +
        chalk.dim(" Basic scraping tools work without keys."),
    );
  }

  console.log(chalk.dim(`\n  Config saved → ${getCliConfigPath()}\n`));
}
