import type { StealthLevel } from "../stealth/index.js";

// ── Interfaces ──

export interface FetchOutcome {
  url: string;
  domain: string;
  levelUsed: StealthLevel;
  success: boolean;
  responseTimeMs: number;
  antiBotSystem: string | null;
  captchaType: string | null;
  proxyUsed: boolean;
  blocked: boolean;
  httpStatus: number;
}

export interface DomainKnowledge {
  domain: string;
  optimal_stealth_level: StealthLevel;
  antibot_system: string | null;
  captcha_type: string | null;
  needs_proxy: boolean;
  avg_response_time_ms: number;
  safe_rate_limit: number;
  success_count: number;
  fail_count: number;
  last_updated: string; // ISO date
  level_stats: Record<string, { success: number; fail: number }>;
}

export interface PredictedConfig {
  startLevel: StealthLevel;
  confidence: number; // 0-1
  needsProxy: boolean;
  expectedResponseTimeMs: number;
  reason: string;
}

// ── Constants ──

const DECAY_THRESHOLD_DAYS = 7;
const DECAY_FACTOR = 0.5;
const HIGH_CONFIDENCE_MIN_SAMPLES = 3;
const HIGH_CONFIDENCE_SUCCESS_RATE = 0.8;

// ── Pure Functions ──

/**
 * Compute time-decay weight for a knowledge entry.
 * Entries older than DECAY_THRESHOLD_DAYS get halved weight.
 */
function decayWeight(lastUpdated: string): number {
  const ageMs = Date.now() - new Date(lastUpdated).getTime();
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  return ageDays > DECAY_THRESHOLD_DAYS ? DECAY_FACTOR : 1.0;
}

/**
 * Predict optimal fetch configuration for a domain based on accumulated knowledge.
 */
export function predict(knowledge: DomainKnowledge): PredictedConfig {
  const weight = decayWeight(knowledge.last_updated);
  const effectiveSuccess = knowledge.success_count * weight;
  const effectiveFail = knowledge.fail_count * weight;
  const total = effectiveSuccess + effectiveFail;

  // Not enough data
  if (total < 1) {
    return {
      startLevel: 1,
      confidence: 0,
      needsProxy: false,
      expectedResponseTimeMs: 0,
      reason: "no data",
    };
  }

  const successRate = effectiveSuccess / total;

  // Find best level from stats
  let bestLevel: StealthLevel = knowledge.optimal_stealth_level;
  let bestLevelRate = 0;
  for (const [levelStr, stats] of Object.entries(knowledge.level_stats)) {
    const lvlTotal = stats.success + stats.fail;
    if (lvlTotal === 0) continue;
    const rate = stats.success / lvlTotal;
    if (rate > bestLevelRate) {
      bestLevelRate = rate;
      bestLevel = parseInt(levelStr, 10) as StealthLevel;
    }
  }

  // Calculate confidence
  let confidence: number;
  if (effectiveSuccess >= HIGH_CONFIDENCE_MIN_SAMPLES && successRate >= HIGH_CONFIDENCE_SUCCESS_RATE) {
    confidence = Math.min(0.5 + successRate * 0.5, 1.0);
  } else if (total >= HIGH_CONFIDENCE_MIN_SAMPLES) {
    confidence = 0.3 + successRate * 0.3;
  } else {
    confidence = 0.1 + (total / HIGH_CONFIDENCE_MIN_SAMPLES) * 0.2;
  }

  // Proxy needed if failures dominate and no proxy was used
  const needsProxy = knowledge.needs_proxy || (effectiveFail > effectiveSuccess && !knowledge.needs_proxy);

  const reasons: string[] = [];
  if (knowledge.antibot_system) reasons.push(knowledge.antibot_system);
  reasons.push(`L${bestLevel}`);
  reasons.push(`${Math.round(successRate * 100)}% success`);

  return {
    startLevel: bestLevel,
    confidence: Math.round(confidence * 100) / 100,
    needsProxy,
    expectedResponseTimeMs: knowledge.avg_response_time_ms,
    reason: reasons.join(", "),
  };
}

/**
 * Aggregate a new fetch outcome into existing domain knowledge.
 * Returns a new DomainKnowledge object (immutable pattern).
 */
export function aggregateOutcome(
  existing: DomainKnowledge | null,
  outcome: FetchOutcome,
): DomainKnowledge {
  const levelKey = String(outcome.levelUsed);

  if (!existing) {
    return {
      domain: outcome.domain,
      optimal_stealth_level: outcome.levelUsed,
      antibot_system: outcome.antiBotSystem,
      captcha_type: outcome.captchaType,
      needs_proxy: outcome.proxyUsed && outcome.success,
      avg_response_time_ms: outcome.responseTimeMs,
      safe_rate_limit: outcome.httpStatus === 429 ? 30 : 60,
      success_count: outcome.success ? 1 : 0,
      fail_count: outcome.success ? 0 : 1,
      last_updated: new Date().toISOString(),
      level_stats: {
        [levelKey]: {
          success: outcome.success ? 1 : 0,
          fail: outcome.success ? 0 : 1,
        },
      },
    };
  }

  // Exponential moving average for response time (alpha = 0.3)
  const alpha = 0.3;
  const avgResponseTime = existing.avg_response_time_ms === 0
    ? outcome.responseTimeMs
    : existing.avg_response_time_ms * (1 - alpha) + outcome.responseTimeMs * alpha;

  // Update level stats
  const levelStats = { ...existing.level_stats };
  const prevLevelStat = levelStats[levelKey] || { success: 0, fail: 0 };
  levelStats[levelKey] = {
    success: prevLevelStat.success + (outcome.success ? 1 : 0),
    fail: prevLevelStat.fail + (outcome.success ? 0 : 1),
  };

  // Find optimal level (highest success rate)
  let optimalLevel = existing.optimal_stealth_level;
  let bestRate = 0;
  for (const [lvl, stats] of Object.entries(levelStats)) {
    const total = stats.success + stats.fail;
    if (total === 0) continue;
    const rate = stats.success / total;
    if (rate > bestRate || (rate === bestRate && parseInt(lvl, 10) < optimalLevel)) {
      bestRate = rate;
      optimalLevel = parseInt(lvl, 10) as StealthLevel;
    }
  }

  // Rate limit adjustment on 429
  const safeRateLimit = outcome.httpStatus === 429
    ? Math.max(10, Math.floor(existing.safe_rate_limit * 0.7))
    : existing.safe_rate_limit;

  // Proxy inference: if failing without proxy, suggest proxy
  const needsProxy = existing.needs_proxy ||
    (outcome.blocked && !outcome.proxyUsed && existing.fail_count > existing.success_count);

  return {
    domain: existing.domain,
    optimal_stealth_level: optimalLevel,
    antibot_system: outcome.antiBotSystem || existing.antibot_system,
    captcha_type: outcome.captchaType || existing.captcha_type,
    needs_proxy: needsProxy,
    avg_response_time_ms: Math.round(avgResponseTime),
    safe_rate_limit: safeRateLimit,
    success_count: existing.success_count + (outcome.success ? 1 : 0),
    fail_count: existing.fail_count + (outcome.success ? 0 : 1),
    last_updated: new Date().toISOString(),
    level_stats: levelStats,
  };
}
