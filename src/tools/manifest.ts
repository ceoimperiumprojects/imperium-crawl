/**
 * Lightweight tool manifest for CLI startup.
 *
 * Contains ONLY name + description — zero heavy imports.
 * CLI uses this to register Commander commands without loading
 * tool implementations (cheerio, playwright, linkedom, etc.).
 *
 * The actual tool module (schema + execute) is loaded lazily,
 * only when the user actually runs that specific command.
 *
 */

export interface ManifestEntry {
  /** Hyphen-case command name — matches the file name and Commander command */
  cmd: string;
  description: string;
}

export const TOOL_MANIFEST: ManifestEntry[] = [
  // Scraping
  {
    cmd: "scrape",
    description:
      "Scrape a URL and return content in multiple formats. Returns Markdown by default, with optional HTML, structured data (JSON-LD/OpenGraph), links, and page metadata.",
  },
  {
    cmd: "crawl",
    description:
      "Crawl a website using priority-based traversal. Prioritizes content-rich URLs (articles, blog posts) over navigation pages. Returns Markdown content for each page.",
  },
  {
    cmd: "map",
    description:
      "Discover all URLs on a website by parsing sitemap.xml and crawling links. Returns a list of discovered URLs.",
  },
  {
    cmd: "extract",
    description:
      "Extract structured data from a web page using CSS selectors. Supports llm_fallback to automatically use AI extraction when CSS selectors return no results.",
  },
  {
    cmd: "readability",
    description:
      "Extract the main article content from a web page using Mozilla's Readability. Returns title, author, text, date, and excerpt.",
  },
  {
    cmd: "screenshot",
    description:
      "Take a screenshot of a web page. Requires rebrowser-playwright to be installed.",
  },
  // Search
  {
    cmd: "search",
    description:
      "Search the web using Brave Search API. Requires BRAVE_API_KEY environment variable.",
  },
  {
    cmd: "news-search",
    description: "Search for news articles using Brave Search API. Requires BRAVE_API_KEY.",
  },
  {
    cmd: "image-search",
    description: "Search for images using Brave Search API. Requires BRAVE_API_KEY.",
  },
  {
    cmd: "video-search",
    description: "Search for videos using Brave Search API. Requires BRAVE_API_KEY.",
  },
  // Skills
  {
    cmd: "create-skill",
    description:
      "Analyze a web page and create a reusable skill for extracting structured data. Re-run later with run-skill to get fresh content instantly.",
  },
  {
    cmd: "run-skill",
    description: "Run a previously created skill to extract fresh structured data from its URL.",
  },
  {
    cmd: "list-skills",
    description: "List all saved skills with their descriptions and URLs.",
  },
  // API Discovery
  {
    cmd: "discover-apis",
    description:
      "Navigate to a page and capture all API calls (XHR/fetch) from network traffic. Discovers REST and GraphQL endpoints automatically. Requires rebrowser-playwright.",
  },
  {
    cmd: "query-api",
    description:
      "Make a direct HTTP request to an API endpoint. Use after discover-apis to call discovered endpoints directly.",
  },
  {
    cmd: "monitor-websocket",
    description:
      "Navigate to a page and capture WebSocket messages for a specified duration. Requires rebrowser-playwright.",
  },
  // AI
  {
    cmd: "ai-extract",
    description:
      "Extract structured data from a web page using AI/LLM. Describe what to extract in natural language or provide a JSON schema. Requires LLM_API_KEY.",
  },
  // Interaction
  {
    cmd: "interact",
    description:
      "Open a browser, execute a sequence of actions (click, type, scroll, screenshot, evaluate JS) and optionally persist sessions between calls.",
  },
  {
    cmd: "snapshot",
    description:
      "Take an ARIA-based accessibility snapshot of a web page. Returns a structured tree with interactive element refs (e.g. [ref=e1]) that can be used in the interact tool for precise element targeting. Workflow: snapshot → analyze refs → interact with ref targeting → snapshot again to verify.",
  },
  // Batch
  {
    cmd: "batch-scrape",
    description:
      "Scrape multiple URLs in parallel with optional AI extraction. Returns a job_id for polling results.",
  },
  {
    cmd: "list-jobs",
    description:
      "List all batch scrape jobs with their status and progress.",
  },
  {
    cmd: "job-status",
    description: "Get full status and results for a specific batch scrape job by job_id.",
  },
  {
    cmd: "delete-job",
    description: "Delete a batch scrape job and its stored results by job_id.",
  },
  // Social media
  {
    cmd: "youtube",
    description:
      "Search YouTube videos, get video details, comments, transcripts, chapters, and channel info. No API key needed.",
  },
  {
    cmd: "reddit",
    description:
      "Search Reddit, browse subreddits, get posts and comments. No API key needed.",
  },
  {
    cmd: "instagram",
    description:
      "Search Instagram profiles, get profile details with engagement metrics, and discover influencers by niche/location. Search/discover require BRAVE_API_KEY.",
  },
  // Intelligence
  {
    cmd: "knowledge",
    description:
      "Show adaptive knowledge engine stats — per-domain success rates, stealth levels, rate limits, and anti-bot detection history. Useful for debugging scraping issues.",
  },
  // Media & feeds
  {
    cmd: "download",
    description:
      "Download media files (images, videos) from URLs. Supports direct files, page media extraction (og:image, all images), YouTube, TikTok, and bulk downloads.",
  },
  {
    cmd: "batch-download",
    description:
      "Download multiple files (PDFs, images, documents) in parallel with session cookie support. Uses L1 HTTP fetch — 10x faster than browser downloads.",
  },
  {
    cmd: "rss",
    description:
      "Fetch and parse RSS/Atom feeds. Returns structured items with title, link, date, author, content, and categories.",
  },
  // Documents
  {
    cmd: "pdf-extract",
    description:
      "Extract text, pages, tables, and metadata from a local or remote PDF. Native text-layer strategy (pdfjs-dist). OCR + Vision fallbacks deferred to v2.6.0.",
  },
  // Change tracking
  {
    cmd: "watch",
    description:
      "One-shot change detector: scrape a URL, hash its content, compare against the last snapshot, and fire a webhook on change. Run via cron for periodic checks.",
  },
  {
    cmd: "monitor",
    description:
      "Portfolio-level change tracker across many URLs grouped by topic. Emits a markdown digest of meaningful changes per run.",
  },
  // Imperium Flows
  {
    cmd: "record-flow",
    description:
      "Record a headed browser workflow and save it as a generic Imperium Flow family/variant.",
  },
  {
    cmd: "run-flow",
    description:
      "Run a saved Imperium Flow by family/variant with runtime input JSON, CAPTCHA handling, and evidence collection.",
  },
  {
    cmd: "serve-flow",
    description:
      "Expose saved Imperium Flows as a local HTTP API.",
  },
  {
    cmd: "list-flows",
    description:
      "List saved Imperium Flows across project-local and global storage.",
  },
  {
    cmd: "inspect-flow",
    description:
      "Inspect one Imperium Flow definition by family/variant.",
  },
  {
    cmd: "validate-flow",
    description:
      "Validate an Imperium Flow schema and report its inputs, steps, and storage path.",
  },
  // CamoFox
  {
    cmd: "camofox-status",
    description:
      "Check CamoFox browser engine status — installation, version, and server health.",
  },
  {
    cmd: "camofox-update",
    description:
      "Update CamoFox browser engine to the latest version. Checks npm registry, compares versions, and installs the latest release.",
  },
];
