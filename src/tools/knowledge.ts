import { z } from "zod";
import { getKnowledgeEngine } from "../knowledge/index.js";
import { toolResult } from "../utils/tool-response.js";

export const name = "knowledge";

export const description =
  "Show the adaptive knowledge engine stats — per-domain success rates, stealth levels, rate limits, and anti-bot detection history. Useful for debugging scraping issues and understanding which domains are problematic.";

export const schema = z.object({
  domain: z
    .string()
    .max(500)
    .optional()
    .describe("Filter to a specific domain (e.g. 'example.com'). Shows all domains if omitted."),
  sort: z
    .enum(["domain", "success_rate", "fail_count", "last_updated"])
    .default("last_updated")
    .describe("Sort order for results"),
  min_requests: z
    .number()
    .min(1)
    .default(1)
    .describe("Minimum total requests to include a domain (filters out noise)"),
});

export type KnowledgeInput = z.infer<typeof schema>;

export async function execute(input: KnowledgeInput) {
  const engine = getKnowledgeEngine();
  await engine.load();

  const domains: string[] = [];

  // Access internal store via get() — scan known domains
  // We need to read the file directly since store is private
  const { getKnowledgeFilePath } = await import("../core/config.js");
  const fs = await import("node:fs/promises");

  let allKnowledge: Record<string, import("../knowledge/predictor.js").DomainKnowledge> = {};
  try {
    const data = await fs.readFile(getKnowledgeFilePath(), "utf-8");
    allKnowledge = JSON.parse(data);
  } catch {
    // No knowledge file yet
  }

  let entries = Object.values(allKnowledge);

  // Filter by domain if specified
  if (input.domain) {
    const filter = input.domain.toLowerCase();
    entries = entries.filter((e) => e.domain.toLowerCase().includes(filter));
  }

  // Filter by minimum requests
  entries = entries.filter((e) => e.success_count + e.fail_count >= input.min_requests);

  // Sort
  entries.sort((a, b) => {
    switch (input.sort) {
      case "domain":
        return a.domain.localeCompare(b.domain);
      case "success_rate": {
        const rateA = a.success_count / Math.max(1, a.success_count + a.fail_count);
        const rateB = b.success_count / Math.max(1, b.success_count + b.fail_count);
        return rateB - rateA;
      }
      case "fail_count":
        return b.fail_count - a.fail_count;
      case "last_updated":
      default:
        return new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime();
    }
  });

  if (entries.length === 0) {
    return toolResult({ domains: [], total: 0, message: "No knowledge data found. Start scraping to build domain intelligence." });
  }

  const domainStats = entries.map((e) => {
    const total = e.success_count + e.fail_count;
    const successRate = total > 0 ? Math.round((e.success_count / total) * 100) : 0;
    return {
      domain: e.domain,
      optimal_level: e.optimal_stealth_level,
      success_rate: `${successRate}%`,
      requests: total,
      success: e.success_count,
      failures: e.fail_count,
      avg_response_ms: e.avg_response_time_ms,
      rate_limit_rpm: e.safe_rate_limit,
      antibot: e.antibot_system ?? "none",
      captcha: e.captcha_type ?? "none",
      needs_proxy: e.needs_proxy,
      last_updated: e.last_updated.split("T")[0],
    };
  });

  const summary = {
    total_domains: entries.length,
    domains_with_antibot: entries.filter((e) => e.antibot_system).length,
    domains_needing_proxy: entries.filter((e) => e.needs_proxy).length,
    domains_with_captcha: entries.filter((e) => e.captcha_type).length,
    total_requests: entries.reduce((sum, e) => sum + e.success_count + e.fail_count, 0),
    overall_success_rate: (() => {
      const totalS = entries.reduce((s, e) => s + e.success_count, 0);
      const totalF = entries.reduce((s, e) => s + e.fail_count, 0);
      const t = totalS + totalF;
      return t > 0 ? `${Math.round((totalS / t) * 100)}%` : "0%";
    })(),
  };

  return toolResult({ summary, domains: domainStats });
}
