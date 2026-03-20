export const PACKAGE_NAME = "imperium-crawl";
export const PACKAGE_VERSION = "2.3.1";

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_PAGES = 10;
export const DEFAULT_MAX_DEPTH = 2;
export const DEFAULT_CONCURRENCY = 3;
export const DEFAULT_ROBOTS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export const SKILLS_DIR_NAME = ".imperium-crawl";
export const SKILLS_SUBDIR = "skills";
export const SESSIONS_SUBDIR = "sessions";
export const JOBS_SUBDIR = "jobs";

export const BRAVE_API_BASE = "https://api.search.brave.com/res/v1";

export const DEFAULT_BROWSER_POOL_SIZE = 3;
export const DEFAULT_BROWSER_IDLE_TIMEOUT_MS = 300_000; // 5 min

export const KNOWLEDGE_FILE = "knowledge.json";

// ── Stealth defaults ──

// Random window size variation for fingerprint diversity
const W_OFFSET = Math.floor(Math.random() * 101) - 50; // -50 to +50
const H_OFFSET = Math.floor(Math.random() * 101) - 50;

export const STEALTH_ARGS: string[] = [
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
  // Phase 9 additions
  "--disable-dev-shm-usage",     // Docker compatibility (shared memory)
  "--disable-extensions",         // No extension detection fingerprint
  "--lang=en-US,en",             // Consistent language fingerprint
  `--window-size=${1920 + W_OFFSET},${1080 + H_OFFSET}`, // Random window size variation
];

export const DEFAULT_VIEWPORT = { width: 1920, height: 1080 };

export const HUMAN_DELAY_MIN_MS = 800;
export const HUMAN_DELAY_MAX_MS = 2500;

export const MIN_REPEATING_ELEMENTS = 3;

// ── Input validation bounds ──

export const MAX_STRING_LENGTH = 10_000;
export const MAX_BODY_LENGTH = 1_048_576;    // 1MB
export const MAX_QUERY_LENGTH = 2_000;
export const MAX_SELECTOR_LENGTH = 1_000;
export const MAX_URL_LENGTH = 8_192;
export const MAX_PAGES = 100;
export const MAX_URLS = 10_000;
export const MAX_ITEMS = 1_000;
export const MAX_MESSAGES = 1_000;
export const MAX_CONCURRENCY = 20;
export const MAX_WAIT_SECONDS = 300;
export const MAX_DURATION_SECONDS = 300;
export const MAX_TIMEOUT_MS = 300_000;
export const MAX_SELECTOR_KEYS = 50;
export const MAX_CRAWL_CONTENT_PER_PAGE = 102_400; // 100KB

// ── Snapshot system ──

export const MAX_STORED_SNAPSHOTS = 100;
