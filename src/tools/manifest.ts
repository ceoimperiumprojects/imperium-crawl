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
      "Search YouTube videos, get video details, comments, transcripts, and channel info. No API key needed.",
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
];
