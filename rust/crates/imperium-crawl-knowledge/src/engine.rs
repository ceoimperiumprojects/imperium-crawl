//! `AdaptiveLearningEngine` — async, file-backed adaptive store.
//!
//! Port of `src/knowledge/store.ts`. The TS version uses a self-rescheduling
//! `setTimeout` debounce; we replace that with explicit `flush()` calls (the
//! caller decides when to persist) plus an internal `dirty` flag. Callers can
//! optionally spawn a tokio task that periodically calls `flush()` — but the
//! engine itself does not own a background timer to keep ownership semantics
//! simple. See `docs/PROGRESS.md` for rationale.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use chrono::Utc;
use imperium_crawl_core::{CrawlError, Result};
use tokio::fs;
use tokio::sync::RwLock;
use tracing::warn;

use crate::predictor::{
    aggregate_outcome, predict, DomainKnowledge, FetchOutcome, PredictedConfig,
};

// ── Constants (port from store.ts) ──

#[allow(dead_code)] // Reserved for future background-flusher tokio task.
const DEBOUNCE_MS: u64 = 30_000;
const MAX_DOMAINS: usize = 2_000;
const PRUNE_AGE_DAYS: u64 = 30;
const PARENT_DOMAIN_CONFIDENCE_MULTIPLIER: f64 = 0.5;

// ── Engine ──

pub struct AdaptiveLearningEngine {
    file_path: PathBuf,
    store: Arc<RwLock<HashMap<String, DomainKnowledge>>>,
    anti_bot_index: Arc<RwLock<HashMap<String, HashSet<String>>>>,
    dirty: Arc<AtomicBool>,
}

impl AdaptiveLearningEngine {
    /// Construct an engine bound to `file_path` and load any existing state.
    pub async fn open(file_path: PathBuf) -> Result<Self> {
        let engine = Self {
            file_path,
            store: Arc::new(RwLock::new(HashMap::new())),
            anti_bot_index: Arc::new(RwLock::new(HashMap::new())),
            dirty: Arc::new(AtomicBool::new(false)),
        };
        engine.load().await?;
        Ok(engine)
    }

    /// Path the engine reads/writes.
    pub fn file_path(&self) -> &Path {
        &self.file_path
    }

    /// Re-read state from disk. Missing file is treated as empty store
    /// (matches ENOENT path in TS).
    pub async fn load(&self) -> Result<()> {
        let read_result = fs::read_to_string(&self.file_path).await;
        let parsed: HashMap<String, DomainKnowledge> = match read_result {
            Ok(text) => match serde_json::from_str::<HashMap<String, DomainKnowledge>>(&text) {
                Ok(map) => map,
                Err(e) => {
                    warn!(
                        path = %self.file_path.display(),
                        error = %e,
                        "knowledge: failed to parse knowledge file, starting empty"
                    );
                    HashMap::new()
                }
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => HashMap::new(),
            Err(e) => {
                warn!(
                    path = %self.file_path.display(),
                    error = %e,
                    "knowledge: failed to read knowledge file, starting empty"
                );
                HashMap::new()
            }
        };

        // Rebuild store + anti-bot index.
        let mut store = self.store.write().await;
        let mut index = self.anti_bot_index.write().await;
        store.clear();
        index.clear();
        for (domain, knowledge) in parsed {
            index_anti_bot(&mut index, &domain, &knowledge);
            store.insert(domain, knowledge);
        }
        drop(store);
        drop(index);

        // Prune if over the cap (matches load-time prune in TS).
        if self.size().await > MAX_DOMAINS {
            self.prune().await;
        }

        Ok(())
    }

    /// Atomically persist the store to disk: write `*.tmp`, then rename.
    /// Clears the dirty flag on success.
    pub async fn save(&self) -> Result<()> {
        if let Some(parent) = self.file_path.parent() {
            fs::create_dir_all(parent).await?;
        }

        let snapshot: HashMap<String, DomainKnowledge> = {
            let store = self.store.read().await;
            store.clone()
        };

        let json = serde_json::to_string_pretty(&snapshot)?;

        let mut tmp_path = self.file_path.clone();
        let file_name = self
            .file_path
            .file_name()
            .ok_or_else(|| CrawlError::Config("knowledge path has no file name".into()))?
            .to_string_lossy()
            .into_owned();
        tmp_path.set_file_name(format!("{file_name}.tmp"));

        fs::write(&tmp_path, json.as_bytes()).await?;
        fs::rename(&tmp_path, &self.file_path).await?;

        self.dirty.store(false, Ordering::Release);
        Ok(())
    }

    /// Save iff dirty.
    pub async fn flush(&self) -> Result<()> {
        if self.dirty.load(Ordering::Acquire) {
            self.save().await?;
        }
        Ok(())
    }

    /// Look up exact-domain knowledge.
    pub async fn get(&self, domain: &str) -> Option<DomainKnowledge> {
        let store = self.store.read().await;
        store.get(domain).cloned()
    }

    /// Predict optimal configuration for a URL. Falls back to the parent
    /// domain (e.g. `shop.example.com` → `example.com`) with reduced
    /// confidence when no exact match exists.
    pub async fn predict(&self, url: &str) -> Option<PredictedConfig> {
        let domain = extract_domain(url)?;
        let store = self.store.read().await;
        if let Some(k) = store.get(&domain) {
            return Some(predict(k));
        }
        if let Some(parent) = parent_domain(&domain) {
            if let Some(k) = store.get(&parent) {
                let mut prediction = predict(k);
                prediction.confidence = round_to_2dp(
                    prediction.confidence * PARENT_DOMAIN_CONFIDENCE_MULTIPLIER,
                );
                prediction.reason = format!("parent:{parent}, {}", prediction.reason);
                return Some(prediction);
            }
        }
        None
    }

    /// Domains observed to use a given anti-bot system.
    pub async fn domains_with_antibot(&self, system: &str) -> Vec<String> {
        let index = self.anti_bot_index.read().await;
        index
            .get(system)
            .map(|set| set.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// Record a fetch outcome. Marks the store dirty; caller is responsible
    /// for `flush()` (or a periodic flusher).
    pub async fn record(&self, outcome: FetchOutcome) {
        let mut store = self.store.write().await;
        let existing = store.get(&outcome.domain).cloned();
        let updated = aggregate_outcome(existing.as_ref(), &outcome);
        let domain = outcome.domain.clone();
        store.insert(domain.clone(), updated.clone());
        drop(store);

        let mut index = self.anti_bot_index.write().await;
        index_anti_bot(&mut index, &domain, &updated);
        drop(index);

        self.dirty.store(true, Ordering::Release);
    }

    /// Drop entries older than PRUNE_AGE_DAYS; if still over MAX_DOMAINS, drop
    /// the oldest until under cap. Rebuilds the anti-bot index after pruning.
    pub async fn prune(&self) {
        let prune_ms = PRUNE_AGE_DAYS as i64 * 24 * 60 * 60 * 1_000;
        let now_ms = Utc::now().timestamp_millis();

        let mut store = self.store.write().await;

        // Age-based pruning.
        let stale: Vec<String> = store
            .iter()
            .filter_map(|(domain, k)| {
                let ts = chrono::DateTime::parse_from_rfc3339(&k.last_updated)
                    .ok()?
                    .with_timezone(&Utc)
                    .timestamp_millis();
                if now_ms - ts > prune_ms {
                    Some(domain.clone())
                } else {
                    None
                }
            })
            .collect();
        for d in &stale {
            store.remove(d);
        }

        // Size-based pruning.
        if store.len() > MAX_DOMAINS {
            let mut entries: Vec<(String, i64)> = store
                .iter()
                .map(|(k, v)| {
                    let ts = chrono::DateTime::parse_from_rfc3339(&v.last_updated)
                        .ok()
                        .map(|t| t.with_timezone(&Utc).timestamp_millis())
                        .unwrap_or(0);
                    (k.clone(), ts)
                })
                .collect();
            entries.sort_by_key(|(_, ts)| *ts);
            let to_remove = entries.len() - MAX_DOMAINS;
            for (domain, _) in entries.into_iter().take(to_remove) {
                store.remove(&domain);
            }
        }

        // Rebuild index.
        let mut index = self.anti_bot_index.write().await;
        index.clear();
        for (domain, knowledge) in store.iter() {
            index_anti_bot(&mut index, domain, knowledge);
        }
        drop(index);

        if !store.is_empty() && !stale.is_empty() {
            self.dirty.store(true, Ordering::Release);
        }
    }

    /// Number of domains tracked.
    pub async fn size(&self) -> usize {
        self.store.read().await.len()
    }
}

// ── Helpers ──

fn index_anti_bot(
    index: &mut HashMap<String, HashSet<String>>,
    domain: &str,
    knowledge: &DomainKnowledge,
) {
    if let Some(system) = &knowledge.antibot_system {
        index
            .entry(system.clone())
            .or_default()
            .insert(domain.to_string());
    }
}

/// Extract `host` from a URL, lowercase, stripping leading `www.`.
pub(crate) fn extract_domain(input: &str) -> Option<String> {
    let parsed = url::Url::parse(input).ok()?;
    let host = parsed.host_str()?.to_ascii_lowercase();
    Some(host.strip_prefix("www.").map(str::to_string).unwrap_or(host))
}

/// `shop.example.com` → `Some("example.com")`. Returns None for two-label
/// hosts (already a root domain) and single-label hosts.
pub(crate) fn parent_domain(domain: &str) -> Option<String> {
    let parts: Vec<&str> = domain.split('.').collect();
    if parts.len() > 2 {
        Some(parts[1..].join("."))
    } else {
        None
    }
}

fn round_to_2dp(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::predictor::LevelStats;
    use imperium_crawl_core::StealthLevel;
    use tempfile::TempDir;

    fn outcome(
        domain: &str,
        level: StealthLevel,
        success: bool,
        anti_bot: Option<&str>,
    ) -> FetchOutcome {
        FetchOutcome {
            url: format!("https://{domain}/"),
            domain: domain.to_string(),
            level_used: level,
            success,
            response_time_ms: 250,
            anti_bot_system: anti_bot.map(str::to_string),
            captcha_type: None,
            proxy_used: false,
            blocked: !success,
            http_status: if success { 200 } else { 403 },
        }
    }

    #[tokio::test]
    async fn record_then_predict_roundtrip() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("knowledge.json");
        let engine = AdaptiveLearningEngine::open(path).await.unwrap();
        for _ in 0..5 {
            engine
                .record(outcome("example.com", StealthLevel::L1Headers, true, None))
                .await;
        }
        let p = engine
            .predict("https://example.com/foo")
            .await
            .expect("prediction available");
        assert_eq!(p.start_level, StealthLevel::L1Headers);
        assert!(
            p.confidence >= 0.9,
            "expected high confidence, got {}",
            p.confidence
        );
    }

    #[tokio::test]
    async fn parent_domain_fallback() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("knowledge.json");
        let engine = AdaptiveLearningEngine::open(path).await.unwrap();
        for _ in 0..5 {
            engine
                .record(outcome("example.com", StealthLevel::L2Tls, true, None))
                .await;
        }
        let p = engine
            .predict("https://shop.example.com/x")
            .await
            .expect("parent prediction");
        assert_eq!(p.start_level, StealthLevel::L2Tls);
        assert!(p.reason.starts_with("parent:example.com"));
        // Confidence should be halved (PARENT_DOMAIN_CONFIDENCE_MULTIPLIER=0.5).
        // The exact-match prediction for example.com would be ≥0.9; halved → ~0.45+.
        assert!(p.confidence > 0.0 && p.confidence < 0.6);
    }

    #[tokio::test]
    async fn save_then_load_persists_state() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("knowledge.json");
        {
            let engine = AdaptiveLearningEngine::open(path.clone()).await.unwrap();
            engine
                .record(outcome(
                    "persist.com",
                    StealthLevel::L3Browser,
                    true,
                    Some("cloudflare"),
                ))
                .await;
            engine.flush().await.unwrap();
        }
        let engine2 = AdaptiveLearningEngine::open(path).await.unwrap();
        let k = engine2.get("persist.com").await.expect("entry survived");
        assert_eq!(k.optimal_stealth_level, StealthLevel::L3Browser);
        assert_eq!(k.antibot_system.as_deref(), Some("cloudflare"));
        let domains = engine2.domains_with_antibot("cloudflare").await;
        assert!(domains.contains(&"persist.com".to_string()));
    }

    #[tokio::test]
    async fn prune_removes_old_entries() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("knowledge.json");
        let engine = AdaptiveLearningEngine::open(path).await.unwrap();
        // Insert a fresh entry.
        engine
            .record(outcome("fresh.com", StealthLevel::L1Headers, true, None))
            .await;
        // Insert an artificially-old entry directly into the store.
        {
            let old_ts = (Utc::now() - chrono::Duration::days(40)).to_rfc3339();
            let stale = DomainKnowledge {
                domain: "stale.com".to_string(),
                optimal_stealth_level: StealthLevel::L1Headers,
                antibot_system: None,
                captcha_type: None,
                needs_proxy: false,
                avg_response_time_ms: 100,
                safe_rate_limit: 60,
                success_count: 5,
                fail_count: 0,
                last_updated: old_ts,
                level_stats: {
                    let mut m = HashMap::new();
                    m.insert(
                        "L1Headers".to_string(),
                        LevelStats { success: 5, fail: 0 },
                    );
                    m
                },
            };
            let mut store = engine.store.write().await;
            store.insert("stale.com".to_string(), stale);
        }
        assert_eq!(engine.size().await, 2);
        engine.prune().await;
        assert!(engine.get("stale.com").await.is_none());
        assert!(engine.get("fresh.com").await.is_some());
    }

    #[tokio::test]
    async fn domains_with_antibot_indexes_correctly() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("knowledge.json");
        let engine = AdaptiveLearningEngine::open(path).await.unwrap();
        for d in ["a.com", "b.com", "c.com"] {
            engine
                .record(outcome(d, StealthLevel::L1Headers, true, Some("cloudflare")))
                .await;
        }
        let domains = engine.domains_with_antibot("cloudflare").await;
        assert_eq!(domains.len(), 3);
        let mut sorted = domains;
        sorted.sort();
        assert_eq!(sorted, vec!["a.com", "b.com", "c.com"]);
    }

    #[test]
    fn parent_domain_basic() {
        assert_eq!(
            parent_domain("shop.example.com"),
            Some("example.com".to_string())
        );
        assert_eq!(parent_domain("example.com"), None);
        assert_eq!(parent_domain("localhost"), None);
        assert_eq!(
            parent_domain("a.b.example.co.uk"),
            Some("b.example.co.uk".to_string())
        );
    }

    #[test]
    fn extract_domain_strips_www() {
        assert_eq!(
            extract_domain("https://www.example.com/path"),
            Some("example.com".to_string())
        );
        assert_eq!(
            extract_domain("https://Example.COM/"),
            Some("example.com".to_string())
        );
        assert_eq!(extract_domain("not a url"), None);
    }
}
