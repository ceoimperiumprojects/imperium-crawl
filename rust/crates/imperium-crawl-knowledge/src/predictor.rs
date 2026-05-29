//! Pure prediction + aggregation functions for the adaptive learning engine.
//!
//! Port of `src/knowledge/predictor.ts`. These functions are deliberately
//! stateless; the [`crate::engine::AdaptiveLearningEngine`] owns the store and
//! orchestrates persistence.

use std::collections::HashMap;

use chrono::Utc;
use imperium_crawl_core::StealthLevel;
use serde::{Deserialize, Serialize};

// ── Constants (mirror predictor.ts) ──

pub(crate) const DECAY_THRESHOLD_DAYS: f64 = 7.0;
pub(crate) const DECAY_FACTOR: f64 = 0.5;
pub(crate) const HIGH_CONFIDENCE_MIN_SAMPLES: f64 = 3.0;
pub(crate) const HIGH_CONFIDENCE_SUCCESS_RATE: f64 = 0.8;

// ── Types ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FetchOutcome {
    pub url: String,
    pub domain: String,
    pub level_used: StealthLevel,
    pub success: bool,
    pub response_time_ms: u64,
    pub anti_bot_system: Option<String>,
    pub captcha_type: Option<String>,
    pub proxy_used: bool,
    pub blocked: bool,
    pub http_status: u16,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LevelStats {
    pub success: u64,
    pub fail: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DomainKnowledge {
    pub domain: String,
    pub optimal_stealth_level: StealthLevel,
    pub antibot_system: Option<String>,
    pub captcha_type: Option<String>,
    pub needs_proxy: bool,
    pub avg_response_time_ms: u64,
    pub safe_rate_limit: u64,
    pub success_count: u64,
    pub fail_count: u64,
    /// ISO 8601 timestamp.
    pub last_updated: String,
    /// Key is the StealthLevel variant name (e.g. "L1Headers").
    pub level_stats: HashMap<String, LevelStats>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PredictedConfig {
    pub start_level: StealthLevel,
    /// Confidence in [0.0, 1.0].
    pub confidence: f64,
    pub needs_proxy: bool,
    pub expected_response_time_ms: u64,
    pub reason: String,
}

// ── Helpers ──

/// Variant name used as the level_stats HashMap key.
pub(crate) fn level_key(level: StealthLevel) -> &'static str {
    match level {
        StealthLevel::L1Headers => "L1Headers",
        StealthLevel::L2Tls => "L2Tls",
        StealthLevel::L3Browser => "L3Browser",
        StealthLevel::L4Camofox => "L4Camofox",
    }
}

/// Parse a level_stats key back into a StealthLevel. Returns None for
/// unrecognized keys (forward compatibility with future variants).
pub(crate) fn level_from_key(key: &str) -> Option<StealthLevel> {
    match key {
        "L1Headers" => Some(StealthLevel::L1Headers),
        "L2Tls" => Some(StealthLevel::L2Tls),
        "L3Browser" => Some(StealthLevel::L3Browser),
        "L4Camofox" => Some(StealthLevel::L4Camofox),
        _ => None,
    }
}

/// Lower-is-better ordinal used when breaking ties in `aggregate_outcome`
/// (matches `parseInt(lvl, 10) < optimalLevel` in TS).
fn level_ordinal(level: StealthLevel) -> u8 {
    match level {
        StealthLevel::L1Headers => 1,
        StealthLevel::L2Tls => 2,
        StealthLevel::L3Browser => 3,
        StealthLevel::L4Camofox => 4,
    }
}

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

/// Parse an ISO 8601 timestamp and return age in days from `now`. Returns 0.0
/// on parse failure (treat unknown as fresh, conservative).
fn age_days(last_updated: &str) -> f64 {
    match chrono::DateTime::parse_from_rfc3339(last_updated) {
        Ok(ts) => {
            let now = Utc::now();
            let delta = now.signed_duration_since(ts.with_timezone(&Utc));
            let ms = delta.num_milliseconds() as f64;
            ms / (24.0 * 60.0 * 60.0 * 1000.0)
        }
        Err(_) => 0.0,
    }
}

fn decay_weight(last_updated: &str) -> f64 {
    if age_days(last_updated) > DECAY_THRESHOLD_DAYS {
        DECAY_FACTOR
    } else {
        1.0
    }
}

// ── Pure API ──

/// Predict the optimal fetch configuration for a domain from accumulated
/// knowledge. Mirrors `predict()` in predictor.ts.
pub fn predict(knowledge: &DomainKnowledge) -> PredictedConfig {
    let weight = decay_weight(&knowledge.last_updated);
    let effective_success = knowledge.success_count as f64 * weight;
    let effective_fail = knowledge.fail_count as f64 * weight;
    let total = effective_success + effective_fail;

    if total < 1.0 {
        return PredictedConfig {
            start_level: StealthLevel::L1Headers,
            confidence: 0.0,
            needs_proxy: false,
            expected_response_time_ms: 0,
            reason: "no data".to_string(),
        };
    }

    let success_rate = effective_success / total;

    // Find best level from per-level stats.
    let mut best_level = knowledge.optimal_stealth_level;
    let mut best_level_rate = 0.0_f64;
    for (key, stats) in &knowledge.level_stats {
        let lvl_total = (stats.success + stats.fail) as f64;
        if lvl_total == 0.0 {
            continue;
        }
        let rate = stats.success as f64 / lvl_total;
        if rate > best_level_rate {
            if let Some(lvl) = level_from_key(key) {
                best_level_rate = rate;
                best_level = lvl;
            }
        }
    }

    // Confidence buckets.
    let confidence = if effective_success >= HIGH_CONFIDENCE_MIN_SAMPLES
        && success_rate >= HIGH_CONFIDENCE_SUCCESS_RATE
    {
        (0.5 + success_rate * 0.5).min(1.0)
    } else if total >= HIGH_CONFIDENCE_MIN_SAMPLES {
        0.3 + success_rate * 0.3
    } else {
        0.1 + (total / HIGH_CONFIDENCE_MIN_SAMPLES) * 0.2
    };

    // Proxy inference: if failures dominate and no proxy was used.
    // The TS source had a redundant `&& !needs_proxy` clause; we collapse it
    // to the logically-equivalent shorter form (clippy: nonminimal_bool).
    let needs_proxy = knowledge.needs_proxy || effective_fail > effective_success;

    let mut reasons: Vec<String> = Vec::new();
    if let Some(ab) = &knowledge.antibot_system {
        reasons.push(ab.clone());
    }
    reasons.push(best_level.as_str().to_string());
    reasons.push(format!("{}% success", (success_rate * 100.0).round() as i64));

    PredictedConfig {
        start_level: best_level,
        confidence: round_to_2dp(confidence),
        needs_proxy,
        expected_response_time_ms: knowledge.avg_response_time_ms,
        reason: reasons.join(", "),
    }
}

/// Aggregate a new outcome into existing domain knowledge (or create a fresh
/// entry if none exists). Mirrors `aggregateOutcome()` in predictor.ts.
pub fn aggregate_outcome(
    existing: Option<&DomainKnowledge>,
    outcome: &FetchOutcome,
) -> DomainKnowledge {
    let level_key_str = level_key(outcome.level_used).to_string();

    let Some(existing) = existing else {
        let mut level_stats = HashMap::new();
        level_stats.insert(
            level_key_str,
            LevelStats {
                success: if outcome.success { 1 } else { 0 },
                fail: if outcome.success { 0 } else { 1 },
            },
        );
        return DomainKnowledge {
            domain: outcome.domain.clone(),
            optimal_stealth_level: outcome.level_used,
            antibot_system: outcome.anti_bot_system.clone(),
            captcha_type: outcome.captcha_type.clone(),
            needs_proxy: outcome.proxy_used && outcome.success,
            avg_response_time_ms: outcome.response_time_ms,
            safe_rate_limit: if outcome.http_status == 429 { 30 } else { 60 },
            success_count: if outcome.success { 1 } else { 0 },
            fail_count: if outcome.success { 0 } else { 1 },
            last_updated: now_iso(),
            level_stats,
        };
    };

    // EMA for response time (alpha = 0.3, matching TS).
    let alpha = 0.3_f64;
    let avg_response_time = if existing.avg_response_time_ms == 0 {
        outcome.response_time_ms as f64
    } else {
        existing.avg_response_time_ms as f64 * (1.0 - alpha)
            + outcome.response_time_ms as f64 * alpha
    };

    let mut level_stats = existing.level_stats.clone();
    let prev = level_stats.entry(level_key_str.clone()).or_default();
    prev.success += if outcome.success { 1 } else { 0 };
    prev.fail += if outcome.success { 0 } else { 1 };

    // Recompute optimal level: highest success rate, ties broken by lower
    // numeric level (matches TS `parseInt(lvl) < optimalLevel`).
    let mut optimal_level = existing.optimal_stealth_level;
    let mut best_rate = 0.0_f64;
    for (key, stats) in &level_stats {
        let total = (stats.success + stats.fail) as f64;
        if total == 0.0 {
            continue;
        }
        let rate = stats.success as f64 / total;
        let Some(candidate) = level_from_key(key) else {
            continue;
        };
        if rate > best_rate
            || (rate == best_rate && level_ordinal(candidate) < level_ordinal(optimal_level))
        {
            best_rate = rate;
            optimal_level = candidate;
        }
    }

    // 429 → tighten rate limit by 30%, floor 10.
    let safe_rate_limit = if outcome.http_status == 429 {
        10.max((existing.safe_rate_limit as f64 * 0.7).floor() as u64)
    } else {
        existing.safe_rate_limit
    };

    // Proxy inference.
    let needs_proxy = existing.needs_proxy
        || (outcome.blocked && !outcome.proxy_used && existing.fail_count > existing.success_count);

    DomainKnowledge {
        domain: existing.domain.clone(),
        optimal_stealth_level: optimal_level,
        antibot_system: outcome
            .anti_bot_system
            .clone()
            .or_else(|| existing.antibot_system.clone()),
        captcha_type: outcome
            .captcha_type
            .clone()
            .or_else(|| existing.captcha_type.clone()),
        needs_proxy,
        avg_response_time_ms: avg_response_time.round() as u64,
        safe_rate_limit,
        success_count: existing.success_count + if outcome.success { 1 } else { 0 },
        fail_count: existing.fail_count + if outcome.success { 0 } else { 1 },
        last_updated: now_iso(),
        level_stats,
    }
}

fn round_to_2dp(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn empty_knowledge(domain: &str) -> DomainKnowledge {
        DomainKnowledge {
            domain: domain.to_string(),
            optimal_stealth_level: StealthLevel::L1Headers,
            antibot_system: None,
            captcha_type: None,
            needs_proxy: false,
            avg_response_time_ms: 0,
            safe_rate_limit: 60,
            success_count: 0,
            fail_count: 0,
            last_updated: now_iso(),
            level_stats: HashMap::new(),
        }
    }

    fn outcome(domain: &str, level: StealthLevel, success: bool) -> FetchOutcome {
        FetchOutcome {
            url: format!("https://{domain}/"),
            domain: domain.to_string(),
            level_used: level,
            success,
            response_time_ms: 250,
            anti_bot_system: None,
            captcha_type: None,
            proxy_used: false,
            blocked: !success,
            http_status: if success { 200 } else { 403 },
        }
    }

    #[test]
    fn predict_with_no_data_returns_l1_confidence_zero() {
        let k = empty_knowledge("example.com");
        let p = predict(&k);
        assert_eq!(p.start_level, StealthLevel::L1Headers);
        assert_eq!(p.confidence, 0.0);
        assert!(!p.needs_proxy);
        assert_eq!(p.expected_response_time_ms, 0);
        assert_eq!(p.reason, "no data");
    }

    #[test]
    fn predict_with_high_success_rate_returns_high_confidence() {
        let mut k = empty_knowledge("example.com");
        k.success_count = 10;
        k.fail_count = 0;
        k.level_stats.insert(
            "L1Headers".to_string(),
            LevelStats { success: 10, fail: 0 },
        );
        let p = predict(&k);
        assert_eq!(p.start_level, StealthLevel::L1Headers);
        assert!(
            p.confidence >= 0.9,
            "expected high confidence, got {}",
            p.confidence
        );
        assert!(!p.needs_proxy);
    }

    #[test]
    fn aggregate_first_outcome_creates_new_knowledge() {
        let o = outcome("first.com", StealthLevel::L2Tls, true);
        let k = aggregate_outcome(None, &o);
        assert_eq!(k.domain, "first.com");
        assert_eq!(k.optimal_stealth_level, StealthLevel::L2Tls);
        assert_eq!(k.success_count, 1);
        assert_eq!(k.fail_count, 0);
        assert_eq!(k.safe_rate_limit, 60);
        assert_eq!(k.avg_response_time_ms, 250);
        let stat = k.level_stats.get("L2Tls").expect("L2Tls stat present");
        assert_eq!(stat.success, 1);
        assert_eq!(stat.fail, 0);
    }

    #[test]
    fn aggregate_existing_outcome_updates_counts() {
        let o1 = outcome("ex.com", StealthLevel::L1Headers, true);
        let k1 = aggregate_outcome(None, &o1);
        let o2 = outcome("ex.com", StealthLevel::L1Headers, false);
        let k2 = aggregate_outcome(Some(&k1), &o2);
        assert_eq!(k2.success_count, 1);
        assert_eq!(k2.fail_count, 1);
        let stat = k2.level_stats.get("L1Headers").unwrap();
        assert_eq!(stat.success, 1);
        assert_eq!(stat.fail, 1);
    }

    #[test]
    fn aggregate_429_reduces_safe_rate_limit() {
        let o1 = outcome("rl.com", StealthLevel::L1Headers, true);
        let k1 = aggregate_outcome(None, &o1);
        assert_eq!(k1.safe_rate_limit, 60);
        let mut o2 = outcome("rl.com", StealthLevel::L1Headers, false);
        o2.http_status = 429;
        let k2 = aggregate_outcome(Some(&k1), &o2);
        // floor(60 * 0.7) = 42
        assert_eq!(k2.safe_rate_limit, 42);
        // Repeated 429s keep tightening but never below 10.
        let mut k = k2;
        for _ in 0..30 {
            let mut o = outcome("rl.com", StealthLevel::L1Headers, false);
            o.http_status = 429;
            k = aggregate_outcome(Some(&k), &o);
        }
        assert!(k.safe_rate_limit >= 10);
    }
}
