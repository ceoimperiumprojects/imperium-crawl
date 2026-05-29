use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::constants::{
    JOBS_SUBDIR, KNOWLEDGE_FILE, SESSIONS_SUBDIR, SKILLS_DIR_NAME, SKILLS_SUBDIR, FLOWS_SUBDIR,
};
use crate::error::{CrawlError, Result};
use crate::types::LlmProvider;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Config {
    pub brave_api_key: Option<String>,
    pub anthropic_api_key: Option<String>,
    pub openai_api_key: Option<String>,
    pub minimax_api_key: Option<String>,
    pub two_captcha_api_key: Option<String>,
    pub default_stealth_level: Option<String>,
    pub proxy_pool: Option<Vec<String>>,
    pub data_dir: Option<PathBuf>,
    pub chrome_profile_path: Option<PathBuf>,
    pub browser_pool_size: Option<usize>,
    pub llm_provider: Option<String>,
    pub llm_api_key: Option<String>,
    pub llm_model: Option<String>,
    pub session_passphrase: Option<String>,
}

impl Config {
    /// Load from `~/.imperium-crawl/config.json`, fall back to env vars
    /// (including .env files), fall back to defaults.
    ///
    /// `.env` is searched starting in CWD and walking up to repo root.
    /// API keys present in env take precedence over config file (so CI
    /// secrets win over committed values).
    pub fn load() -> Result<Self> {
        // dotenv: search CWD upwards. Ignore "file not found" — env vars from
        // the parent process may already be set.
        let _ = dotenvy::dotenv();

        // Also try the imperium-crawl repo root explicitly — when run from
        // the rust/ subdirectory we want ../.env.
        if let Ok(cwd) = std::env::current_dir() {
            for ancestor in cwd.ancestors() {
                let candidate = ancestor.join(".env");
                if candidate.exists() {
                    let _ = dotenvy::from_path(&candidate);
                    break;
                }
            }
        }

        let path = Self::default_config_path()?;
        let mut cfg = if path.exists() {
            let text = std::fs::read_to_string(&path)?;
            serde_json::from_str::<Config>(&text)?
        } else {
            Config::default()
        };
        cfg.fill_from_env();
        Ok(cfg)
    }

    pub fn fill_from_env(&mut self) {
        fn env_or(target: &mut Option<String>, key: &str) {
            if target.is_none() {
                if let Ok(v) = std::env::var(key) {
                    if !v.trim().is_empty() {
                        *target = Some(v);
                    }
                }
            }
        }
        env_or(&mut self.brave_api_key, "BRAVE_API_KEY");
        env_or(&mut self.anthropic_api_key, "ANTHROPIC_API_KEY");
        env_or(&mut self.openai_api_key, "OPENAI_API_KEY");
        env_or(&mut self.minimax_api_key, "MINIMAX_API_KEY");
        env_or(&mut self.two_captcha_api_key, "TWOCAPTCHA_API_KEY");
        env_or(&mut self.two_captcha_api_key, "TWO_CAPTCHA_API_KEY");
        env_or(&mut self.llm_api_key, "LLM_API_KEY");
        env_or(&mut self.llm_provider, "LLM_PROVIDER");
        env_or(&mut self.llm_model, "LLM_MODEL");
        env_or(&mut self.session_passphrase, "IMPERIUM_CRAWL_PASSPHRASE");

        // Numeric env var
        if self.browser_pool_size.is_none() {
            if let Ok(v) = std::env::var("BROWSER_POOL_SIZE") {
                if let Ok(n) = v.parse::<usize>() {
                    if (1..=20).contains(&n) {
                        self.browser_pool_size = Some(n);
                    }
                }
            }
        }

        // Chrome profile path
        if self.chrome_profile_path.is_none() {
            if let Ok(v) = std::env::var("CHROME_PROFILE_PATH") {
                if !v.trim().is_empty() {
                    self.chrome_profile_path = Some(PathBuf::from(v));
                }
            }
        }

        // Data dir
        if self.data_dir.is_none() {
            if let Ok(v) = std::env::var("IMPERIUM_DATA_DIR") {
                if !v.trim().is_empty() {
                    self.data_dir = Some(PathBuf::from(v));
                }
            }
        }

        // Proxy URL(s) — single or comma-separated.
        if self.proxy_pool.is_none() {
            let raw = std::env::var("PROXY_URL")
                .ok()
                .or_else(|| std::env::var("PROXY_URLS").ok());
            if let Some(s) = raw {
                let urls: Vec<String> = s
                    .split(',')
                    .map(|p| p.trim().to_string())
                    .filter(|p| !p.is_empty())
                    .collect();
                if !urls.is_empty() {
                    self.proxy_pool = Some(urls);
                }
            }
        }
    }

    pub fn default_config_path() -> Result<PathBuf> {
        let home = dirs::home_dir()
            .ok_or_else(|| CrawlError::Config("could not determine home directory".into()))?;
        Ok(home.join(SKILLS_DIR_NAME).join("config.json"))
    }

    pub fn data_dir_or_default(&self) -> Result<PathBuf> {
        if let Some(d) = &self.data_dir {
            return Ok(d.clone());
        }
        let home = dirs::home_dir()
            .ok_or_else(|| CrawlError::Config("could not determine home directory".into()))?;
        Ok(home.join(SKILLS_DIR_NAME))
    }

    pub fn skills_dir(&self) -> Result<PathBuf> {
        Ok(self.data_dir_or_default()?.join(SKILLS_SUBDIR))
    }

    pub fn sessions_dir(&self) -> Result<PathBuf> {
        Ok(self.data_dir_or_default()?.join(SESSIONS_SUBDIR))
    }

    pub fn jobs_dir(&self) -> Result<PathBuf> {
        Ok(self.data_dir_or_default()?.join(JOBS_SUBDIR))
    }

    pub fn flows_dir(&self) -> Result<PathBuf> {
        Ok(self.data_dir_or_default()?.join(FLOWS_SUBDIR))
    }

    pub fn knowledge_path(&self) -> Result<PathBuf> {
        Ok(self.data_dir_or_default()?.join(KNOWLEDGE_FILE))
    }

    pub fn llm_provider_resolved(&self) -> LlmProvider {
        match self.llm_provider.as_deref() {
            Some(s) => LlmProvider::from_str_lossy(s),
            None => LlmProvider::Anthropic,
        }
    }

    pub fn llm_api_key_for(&self, provider: LlmProvider) -> Option<&str> {
        match provider {
            LlmProvider::Anthropic => self.anthropic_api_key.as_deref().or(self.llm_api_key.as_deref()),
            LlmProvider::Openai => self.openai_api_key.as_deref().or(self.llm_api_key.as_deref()),
            LlmProvider::Minimax => self.minimax_api_key.as_deref().or(self.llm_api_key.as_deref()),
        }
    }

    pub fn has_brave(&self) -> bool {
        self.brave_api_key.as_deref().map(|s| !s.is_empty()).unwrap_or(false)
    }

    pub fn has_llm(&self) -> bool {
        let p = self.llm_provider_resolved();
        self.llm_api_key_for(p).map(|s| !s.is_empty()).unwrap_or(false)
    }

    /// Ensure base data dirs exist.
    pub fn ensure_dirs(&self) -> Result<()> {
        let dirs = [
            self.data_dir_or_default()?,
            self.skills_dir()?,
            self.sessions_dir()?,
            self.jobs_dir()?,
            self.flows_dir()?,
        ];
        for d in dirs {
            std::fs::create_dir_all(&d)?;
        }
        Ok(())
    }

    pub fn save(&self) -> Result<()> {
        let path = Self::default_config_path()?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let text = serde_json::to_string_pretty(self)?;
        std::fs::write(&path, text)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_round_trips() {
        let cfg = Config::default();
        let json = serde_json::to_string(&cfg).unwrap();
        let parsed: Config = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.brave_api_key, None);
        assert!(!parsed.has_brave());
        assert!(!parsed.has_llm());
    }

    #[test]
    fn config_path_resolves() {
        let path = Config::default_config_path().unwrap();
        assert!(path.ends_with(".imperium-crawl/config.json"));
    }

    #[test]
    fn fill_from_env_reads_brave() {
        // Use a unique key to avoid clobbering other tests.
        std::env::set_var("BRAVE_API_KEY", "test-key-xyz");
        let mut cfg = Config::default();
        cfg.fill_from_env();
        assert_eq!(cfg.brave_api_key.as_deref(), Some("test-key-xyz"));
        std::env::remove_var("BRAVE_API_KEY");
    }

    #[test]
    fn llm_provider_default_anthropic() {
        let cfg = Config::default();
        assert_eq!(cfg.llm_provider_resolved(), LlmProvider::Anthropic);
    }
}
