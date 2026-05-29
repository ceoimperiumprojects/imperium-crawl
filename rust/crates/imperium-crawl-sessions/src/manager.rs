//! Session persistence — load/save/list/delete [`StoredSession`] values.
//!
//! Two on-disk formats are supported:
//!
//! 1. **Plaintext JSON** at `<data_dir>/<id>.json` — when the manager has no
//!    [`Vault`] attached.
//! 2. **Encrypted blob** at `<data_dir>/<id>.enc` with layout
//!    `[salt(16) || nonce(12) || ciphertext || tag(16)]` — when a vault is
//!    attached via [`SessionManager::with_vault`]. The password is needed up
//!    front so the manager can both encrypt new saves and decrypt existing
//!    files (re-deriving the per-file key from the on-disk salt).
//!
//! All I/O is async via `tokio::fs`. Session ids are sanitized to a safe
//! `[A-Za-z0-9_-]` subset to prevent path traversal.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use imperium_crawl_core::{CrawlError, Result, StoredSession};
use tokio::fs;

use crate::vault::{Vault, NONCE_LEN, SALT_LEN, TAG_LEN};

/// Default action count before a session is considered stale.
pub const DEFAULT_REFRESH_THRESHOLD: u32 = 15;

const PLAINTEXT_EXT: &str = "json";
const ENCRYPTED_EXT: &str = "enc";
const HEADER_LEN: usize = SALT_LEN + NONCE_LEN;

/// Manages on-disk session storage.
#[derive(Clone)]
pub struct SessionManager {
    data_dir: PathBuf,
    refresh_threshold: u32,
    /// Password used to derive per-file vaults. Held only when encryption is on.
    password: Option<Arc<String>>,
}

impl SessionManager {
    /// Create a plaintext-only session manager.
    pub fn new(data_dir: PathBuf, refresh_threshold: u32) -> Self {
        Self { data_dir, refresh_threshold, password: None }
    }

    /// Attach an encryption password. Future saves will be AES-256-GCM-encrypted;
    /// loads will transparently decrypt `.enc` files using the per-file salt.
    pub fn with_vault(mut self, password: impl Into<String>) -> Self {
        self.password = Some(Arc::new(password.into()));
        self
    }

    /// Where session files live.
    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    /// Refresh threshold the manager was configured with.
    pub fn refresh_threshold(&self) -> u32 {
        self.refresh_threshold
    }

    /// True if this manager will encrypt newly-saved sessions.
    pub fn is_encrypted(&self) -> bool {
        self.password.is_some()
    }

    /// Sanitize the session id to a safe filename token.
    fn sanitize(id: &str) -> String {
        id.chars()
            .map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
            .collect()
    }

    fn plaintext_path(&self, id: &str) -> PathBuf {
        self.data_dir
            .join(format!("{}.{}", Self::sanitize(id), PLAINTEXT_EXT))
    }

    fn encrypted_path(&self, id: &str) -> PathBuf {
        self.data_dir
            .join(format!("{}.{}", Self::sanitize(id), ENCRYPTED_EXT))
    }

    /// Load a session by id. Returns `Ok(None)` when no file exists for that id.
    ///
    /// Prefers `.enc` over `.json` when both exist (encryption takes priority).
    pub async fn load(&self, id: &str) -> Result<Option<StoredSession>> {
        let enc_path = self.encrypted_path(id);
        if fs::try_exists(&enc_path).await.unwrap_or(false) {
            return self.load_encrypted(&enc_path).await.map(Some);
        }
        let pt_path = self.plaintext_path(id);
        if fs::try_exists(&pt_path).await.unwrap_or(false) {
            return self.load_plaintext(&pt_path).await.map(Some);
        }
        Ok(None)
    }

    async fn load_plaintext(&self, path: &Path) -> Result<StoredSession> {
        let bytes = fs::read(path).await?;
        let session: StoredSession = serde_json::from_slice(&bytes)?;
        Ok(session)
    }

    async fn load_encrypted(&self, path: &Path) -> Result<StoredSession> {
        let password = self.password.as_ref().ok_or_else(|| {
            CrawlError::Session(
                "encrypted session file found but no password configured".into(),
            )
        })?;
        let blob = fs::read(path).await?;
        if blob.len() < HEADER_LEN + TAG_LEN {
            return Err(CrawlError::Encryption(format!(
                "encrypted session file too short: {} bytes",
                blob.len()
            )));
        }
        let (salt, rest) = blob.split_at(SALT_LEN);
        let vault = Vault::from_password_with_salt(password, salt)?;
        let plaintext = vault.decrypt(rest)?;
        let session: StoredSession = serde_json::from_slice(&plaintext)?;
        Ok(session)
    }

    /// Persist `session` to disk. Writes `.enc` when a vault is attached,
    /// otherwise `.json`. Creates `data_dir` if missing.
    pub async fn save(&self, session: &StoredSession) -> Result<()> {
        fs::create_dir_all(&self.data_dir).await?;
        let json = serde_json::to_vec_pretty(session)?;

        match self.password.as_ref() {
            None => {
                let path = self.plaintext_path(&session.id);
                Self::atomic_write(&path, &json).await?;
            }
            Some(password) => {
                let vault = Vault::from_password(password)?;
                let body = vault.encrypt(&json)?;
                let mut blob = Vec::with_capacity(SALT_LEN + body.len());
                blob.extend_from_slice(vault.salt());
                blob.extend_from_slice(&body);
                let path = self.encrypted_path(&session.id);
                Self::atomic_write(&path, &blob).await?;
            }
        }
        Ok(())
    }

    /// Write `bytes` to `path` via a temp file + rename (atomic on POSIX).
    async fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
        let tmp = path.with_extension(format!(
            "{}.tmp",
            path.extension().and_then(|e| e.to_str()).unwrap_or("part")
        ));
        fs::write(&tmp, bytes).await?;
        fs::rename(&tmp, path).await?;
        Ok(())
    }

    /// Delete a session file. Silently succeeds if no file exists.
    pub async fn delete(&self, id: &str) -> Result<()> {
        for path in [self.encrypted_path(id), self.plaintext_path(id)] {
            match fs::remove_file(&path).await {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(e.into()),
            }
        }
        Ok(())
    }

    /// List all session ids on disk (both encrypted and plaintext).
    pub async fn list(&self) -> Result<Vec<String>> {
        let mut out = Vec::new();
        let mut rd = match fs::read_dir(&self.data_dir).await {
            Ok(r) => r,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(out),
            Err(e) => return Err(e.into()),
        };
        while let Some(entry) = rd.next_entry().await? {
            let path = entry.path();
            let Some(ext) = path.extension().and_then(|e| e.to_str()) else { continue };
            if ext != PLAINTEXT_EXT && ext != ENCRYPTED_EXT {
                continue;
            }
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                let s = stem.to_string();
                if !out.contains(&s) {
                    out.push(s);
                }
            }
        }
        out.sort();
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use imperium_crawl_core::{Cookie, SameSite};
    use tempfile::TempDir;

    fn sample_session(id: &str) -> StoredSession {
        StoredSession {
            id: id.to_string(),
            cookies: vec![Cookie {
                name: "session".into(),
                value: "abc123".into(),
                domain: ".example.com".into(),
                path: "/".into(),
                expires: Some(1_900_000_000),
                http_only: Some(true),
                secure: Some(true),
                same_site: Some(SameSite::Lax),
            }],
            url: "https://example.com/dashboard".into(),
            created_at: "2026-05-26T10:00:00Z".into(),
            updated_at: "2026-05-26T10:05:00Z".into(),
            action_count: Some(3),
        }
    }

    #[tokio::test]
    async fn save_then_load_roundtrip() {
        let tmp = TempDir::new().unwrap();
        let mgr = SessionManager::new(tmp.path().to_path_buf(), 15);

        let s = sample_session("plain-1");
        mgr.save(&s).await.unwrap();
        let loaded = mgr.load("plain-1").await.unwrap().expect("session present");
        assert_eq!(loaded.id, s.id);
        assert_eq!(loaded.url, s.url);
        assert_eq!(loaded.cookies, s.cookies);
        assert_eq!(loaded.created_at, s.created_at);
        assert_eq!(loaded.updated_at, s.updated_at);
        assert_eq!(loaded.action_count, s.action_count);
    }

    #[tokio::test]
    async fn save_encrypted_then_load_encrypted() {
        let tmp = TempDir::new().unwrap();
        let mgr = SessionManager::new(tmp.path().to_path_buf(), 15)
            .with_vault("hunter2-correct-horse");

        let s = sample_session("crypt-1");
        mgr.save(&s).await.unwrap();

        // The plaintext .json file should NOT exist; the .enc one should.
        assert!(!tmp.path().join("crypt-1.json").exists());
        assert!(tmp.path().join("crypt-1.enc").exists());

        // And the bytes on disk should not contain the literal cookie value.
        let raw = std::fs::read(tmp.path().join("crypt-1.enc")).unwrap();
        assert!(
            !raw.windows(6).any(|w| w == b"abc123"),
            "encrypted blob leaked plaintext"
        );

        let loaded = mgr.load("crypt-1").await.unwrap().expect("present");
        assert_eq!(loaded.id, s.id);
        assert_eq!(loaded.cookies, s.cookies);
        assert_eq!(loaded.url, s.url);
        assert_eq!(loaded.action_count, s.action_count);
    }

    #[tokio::test]
    async fn encrypted_load_wrong_password_errors() {
        let tmp = TempDir::new().unwrap();
        let saver = SessionManager::new(tmp.path().to_path_buf(), 15)
            .with_vault("good-password");
        saver.save(&sample_session("ck")).await.unwrap();

        let loader = SessionManager::new(tmp.path().to_path_buf(), 15)
            .with_vault("bad-password");
        let err = loader.load("ck").await.unwrap_err();
        assert!(matches!(err, CrawlError::Encryption(_)));
    }

    #[tokio::test]
    async fn load_missing_returns_none() {
        let tmp = TempDir::new().unwrap();
        let mgr = SessionManager::new(tmp.path().to_path_buf(), 15);
        let got = mgr.load("does-not-exist").await.unwrap();
        assert!(got.is_none());
    }

    #[tokio::test]
    async fn list_finds_saved_sessions() {
        let tmp = TempDir::new().unwrap();
        let mgr = SessionManager::new(tmp.path().to_path_buf(), 15);
        for id in ["a", "b", "c"] {
            mgr.save(&sample_session(id)).await.unwrap();
        }
        let ids = mgr.list().await.unwrap();
        assert_eq!(ids, vec!["a".to_string(), "b".into(), "c".into()]);
    }

    #[tokio::test]
    async fn list_mixed_encrypted_and_plain() {
        let tmp = TempDir::new().unwrap();
        let plain = SessionManager::new(tmp.path().to_path_buf(), 15);
        let enc = SessionManager::new(tmp.path().to_path_buf(), 15).with_vault("pw");
        plain.save(&sample_session("plain")).await.unwrap();
        enc.save(&sample_session("enc")).await.unwrap();
        let ids = plain.list().await.unwrap();
        assert_eq!(ids, vec!["enc".to_string(), "plain".into()]);
    }

    #[tokio::test]
    async fn delete_removes_file() {
        let tmp = TempDir::new().unwrap();
        let mgr = SessionManager::new(tmp.path().to_path_buf(), 15);
        mgr.save(&sample_session("kill-me")).await.unwrap();
        let path = tmp.path().join("kill-me.json");
        assert!(path.exists());
        mgr.delete("kill-me").await.unwrap();
        assert!(!path.exists());
        // Idempotent — second delete is fine.
        mgr.delete("kill-me").await.unwrap();
    }

    #[tokio::test]
    async fn delete_handles_encrypted_too() {
        let tmp = TempDir::new().unwrap();
        let mgr = SessionManager::new(tmp.path().to_path_buf(), 15).with_vault("pw");
        mgr.save(&sample_session("crypt-kill")).await.unwrap();
        assert!(tmp.path().join("crypt-kill.enc").exists());
        mgr.delete("crypt-kill").await.unwrap();
        assert!(!tmp.path().join("crypt-kill.enc").exists());
    }

    #[tokio::test]
    async fn sanitization_blocks_path_traversal() {
        let tmp = TempDir::new().unwrap();
        let mgr = SessionManager::new(tmp.path().to_path_buf(), 15);
        let mut s = sample_session("../escape");
        s.id = "../escape".into();
        mgr.save(&s).await.unwrap();
        // Every non-[A-Za-z0-9_-] char becomes '_', so "../escape" -> "___escape".
        assert!(tmp.path().join("___escape.json").exists());
        // And nothing escaped the data_dir.
        assert!(!tmp.path().parent().unwrap().join("escape.json").exists());
    }
}
