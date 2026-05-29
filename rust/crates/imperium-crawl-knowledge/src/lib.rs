//! Adaptive learning engine for per-domain stealth-level prediction.
//!
//! Sprint S13 — port of `src/knowledge/{predictor,store}.ts`.
//!
//! Public surface:
//! - [`predictor::predict`] and [`predictor::aggregate_outcome`] — pure functions.
//! - [`engine::AdaptiveLearningEngine`] — async file-backed store.

pub mod engine;
pub mod predictor;

pub use engine::AdaptiveLearningEngine;
pub use predictor::{
    aggregate_outcome, predict, DomainKnowledge, FetchOutcome, LevelStats, PredictedConfig,
};
