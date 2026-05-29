//! Chrome user-data-dir resolution.
//!
//! Mirrors `../../src/stealth/chrome-profile.ts` (resolve helper only — the
//! TS module also handles Playwright `launchPersistentContext`; that is
//! folded into `browser.rs` here because chromiumoxide does not split the
//! persistent vs. ephemeral concept the same way).

use std::path::{Path, PathBuf};

use imperium_crawl_core::{CrawlError, Result};

/// A resolved Chrome profile. Owns the directory when `owned_temp` is true
/// (i.e. the caller asked for an ephemeral profile and we created a tempdir
/// — drop semantics: the tempdir is removed when [`ChromeProfile`] is
/// dropped).
pub struct ChromeProfile {
    pub user_data_dir: PathBuf,
    _temp: Option<tempfile_compat::TempDir>,
}

impl std::fmt::Debug for ChromeProfile {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ChromeProfile")
            .field("user_data_dir", &self.user_data_dir)
            .field("owned_temp", &self._temp.is_some())
            .finish()
    }
}

impl ChromeProfile {
    /// Resolve the profile path.
    ///
    /// Priority:
    /// 1. Explicit `override_path`
    /// 2. `CHROME_PROFILE_PATH` env var
    /// 3. Ephemeral tempdir (auto-removed on drop)
    pub fn resolve(override_path: Option<&Path>) -> Result<Self> {
        if let Some(p) = override_path {
            return Ok(Self { user_data_dir: p.to_path_buf(), _temp: None });
        }
        if let Ok(env_path) = std::env::var("CHROME_PROFILE_PATH") {
            if !env_path.trim().is_empty() {
                return Ok(Self { user_data_dir: PathBuf::from(env_path), _temp: None });
            }
        }
        let dir = tempfile_compat::tempdir().map_err(|e| {
            CrawlError::Browser(format!("failed to create ephemeral profile dir: {e}"))
        })?;
        Ok(Self {
            user_data_dir: dir.path().to_path_buf(),
            _temp: Some(dir),
        })
    }

    /// Return the directory as a `&Path`.
    pub fn path(&self) -> &Path {
        &self.user_data_dir
    }

    /// Whether the profile directory is an ephemeral tempdir owned by this
    /// struct.
    pub fn is_ephemeral(&self) -> bool {
        self._temp.is_some()
    }
}

// We intentionally do not pull in the `tempfile` crate at production build
// time — but we do need a TempDir-like type. Use a tiny inline shim that
// just delegates to the `tempfile` crate when available; otherwise create a
// uniquely-named directory under `std::env::temp_dir()` and clean it up on
// drop.
mod tempfile_compat {
    use std::path::{Path, PathBuf};

    pub struct TempDir {
        path: PathBuf,
        cleanup: bool,
    }

    impl TempDir {
        pub fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            if self.cleanup {
                let _ = std::fs::remove_dir_all(&self.path);
            }
        }
    }

    pub fn tempdir() -> std::io::Result<TempDir> {
        use std::time::{SystemTime, UNIX_EPOCH};
        let mut base = std::env::temp_dir();
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        // Append PID + nanos for uniqueness (good enough for chrome profile).
        base.push(format!("imperium-crawl-chrome-{}-{}", std::process::id(), nanos));
        std::fs::create_dir_all(&base)?;
        Ok(TempDir { path: base, cleanup: true })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_explicit_override_wins() {
        let custom = std::env::temp_dir().join("imperium-crawl-test-profile-override");
        let _ = std::fs::create_dir_all(&custom);
        let profile = ChromeProfile::resolve(Some(&custom)).unwrap();
        assert_eq!(profile.path(), custom.as_path());
        assert!(!profile.is_ephemeral());
        let _ = std::fs::remove_dir_all(&custom);
    }

    #[test]
    fn resolve_creates_ephemeral_when_unset() {
        // Make sure env var is not set for this test.
        std::env::remove_var("CHROME_PROFILE_PATH");
        let profile = ChromeProfile::resolve(None).unwrap();
        assert!(profile.path().exists());
        assert!(profile.is_ephemeral());
        let dir = profile.path().to_path_buf();
        drop(profile);
        // After drop, the ephemeral dir should be removed.
        assert!(!dir.exists());
    }
}
