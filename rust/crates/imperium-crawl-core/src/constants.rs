//! Port of `src/core/constants.ts` — all numeric defaults and string constants
//! used across the workspace. Mirrors the TS file 1:1 so behavior parity is provable.

pub const PACKAGE_NAME: &str = "imperium-crawl";
pub const PACKAGE_VERSION: &str = "3.0.0-alpha.1";

pub const DEFAULT_TIMEOUT_MS: u64 = 30_000;
pub const DEFAULT_MAX_PAGES: usize = 10;
pub const DEFAULT_MAX_DEPTH: usize = 2;
pub const DEFAULT_CONCURRENCY: usize = 3;
pub const DEFAULT_ROBOTS_CACHE_TTL_MS: u64 = 60 * 60 * 1000;

pub const SKILLS_DIR_NAME: &str = ".imperium-crawl";
pub const SKILLS_SUBDIR: &str = "skills";
pub const SESSIONS_SUBDIR: &str = "sessions";
pub const JOBS_SUBDIR: &str = "jobs";
pub const FLOWS_SUBDIR: &str = "flows";

pub const BRAVE_API_BASE: &str = "https://api.search.brave.com/res/v1";

pub const DEFAULT_BROWSER_POOL_SIZE: usize = 3;
pub const DEFAULT_BROWSER_IDLE_TIMEOUT_MS: u64 = 300_000;

pub const KNOWLEDGE_FILE: &str = "knowledge.json";

pub const DEFAULT_VIEWPORT_WIDTH: u32 = 1920;
pub const DEFAULT_VIEWPORT_HEIGHT: u32 = 1080;

pub const HUMAN_DELAY_MIN_MS: u64 = 800;
pub const HUMAN_DELAY_MAX_MS: u64 = 2500;

pub const MIN_REPEATING_ELEMENTS: usize = 3;

// ── Input validation bounds (mirror TS) ──

pub const MAX_STRING_LENGTH: usize = 10_000;
pub const MAX_BODY_LENGTH: usize = 1_048_576; // 1MB
pub const MAX_QUERY_LENGTH: usize = 2_000;
pub const MAX_SELECTOR_LENGTH: usize = 1_000;
pub const MAX_URL_LENGTH: usize = 8_192;
pub const MAX_PAGES: usize = 100;
pub const MAX_URLS: usize = 10_000;
pub const MAX_ITEMS: usize = 1_000;
pub const MAX_MESSAGES: usize = 1_000;
pub const MAX_CONCURRENCY: usize = 20;
pub const MAX_WAIT_SECONDS: u64 = 300;
pub const MAX_DURATION_SECONDS: u64 = 300;
pub const MAX_TIMEOUT_MS: u64 = 300_000;
pub const MAX_SELECTOR_KEYS: usize = 50;
pub const MAX_CRAWL_CONTENT_PER_PAGE: usize = 102_400;

pub const MAX_STORED_SNAPSHOTS: usize = 100;

/// Chrome stealth args (mirror of `STEALTH_ARGS` in `src/core/constants.ts`).
/// The window-size offset is computed at runtime — see `stealth_args_with_jitter`.
pub fn stealth_args_base() -> Vec<&'static str> {
    vec![
        "--disable-blink-features=AutomationControlled",
        "--disable-features=AutomationControlled",
        "--disable-infobars",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-default-apps",
        "--disable-hang-monitor",
        "--disable-popup-blocking",
        "--disable-prompt-on-repost",
        "--disable-sync",
        "--metrics-recording-only",
        "--no-service-autorun",
        "--password-store=basic",
        "--disable-dev-shm-usage",
        "--disable-extensions",
        "--lang=en-US,en",
        "--disable-webgl",
        "--disable-webgl2",
        "--disable-canvas-aa",
        "--disable-client-side-phishing-detection",
        "--disable-histogram-customizer",
        "--disable-peer-connection",
        "--disable-permissions-api",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
        "--disable-ipc-flooding-protection",
        "--disable-gpu-sandbox",
        "--enable-features=NetworkService,NetworkServiceInProcess",
        "--webdriver-active=false",
        "--browser.search.isOnDefaultSearchProvider=false",
    ]
}

/// Build stealth args with a randomized window size for fingerprint diversity.
pub fn stealth_args_with_jitter() -> Vec<String> {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let w_offset: i32 = rng.gen_range(-50..=50);
    let h_offset: i32 = rng.gen_range(-50..=50);
    let w = (DEFAULT_VIEWPORT_WIDTH as i32 + w_offset) as u32;
    let h = (DEFAULT_VIEWPORT_HEIGHT as i32 + h_offset) as u32;
    let mut out: Vec<String> = stealth_args_base().into_iter().map(String::from).collect();
    out.push(format!("--window-size={w},{h}"));
    out
}
