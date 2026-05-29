//! Core types, errors, and configuration for imperium-crawl.
//!
//! This crate is dependency-free of higher layers (stealth, browser, tools).
//! It defines the shared vocabulary used across the workspace.

pub mod config;
pub mod constants;
pub mod error;
pub mod tool;
pub mod types;

pub use config::Config;
pub use error::{CrawlError, Result};
pub use tool::{Tool, ToolArgs, ToolMeta, ToolOutput, ToolRegistry, ToolSchema};
pub use types::{
    normalize_url, validate_url, ContentKind, Cookie, FetchResult, LlmProvider, SameSite,
    StealthLevel, StoredSession,
};
