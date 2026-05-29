//! Session management: cookie vault with optional AES-256-GCM encryption.
//!
//! Ports `../src/sessions/manager.ts` and `../src/sessions/encryption.ts` from
//! the TypeScript codebase, using AES-256-GCM (via `aes-gcm`) with an
//! Argon2id-derived key (via `argon2`). The cookie data model lives in
//! `imperium-crawl-core` ([`imperium_crawl_core::Cookie`] /
//! [`imperium_crawl_core::StoredSession`]); this crate owns persistence plus
//! the cookie-jar merge / URL-match helpers.

pub mod jar;
pub mod manager;
pub mod vault;

pub use jar::{cookies_for_url, merge_cookies};
pub use manager::{SessionManager, DEFAULT_REFRESH_THRESHOLD};
pub use vault::{Vault, KEY_LEN, NONCE_LEN, SALT_LEN, TAG_LEN};
