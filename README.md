# imperium-crawl

The most powerful open-source MCP server for web scraping, crawling, and data extraction. **16 tools. Zero API keys required for scraping. One `npx` command to install.**

While others charge $19+/month for basic scraping, imperium-crawl gives you **more features for free** — including capabilities that no other MCP server offers at any price.

## vs. The Competition

| Feature | **imperium-crawl** | Firecrawl MCP | fetch MCP | Crawl4AI MCP | Browserbase MCP |
|---------|:------------------:|:-------------:|:---------:|:------------:|:---------------:|
| Price | **Free forever** | $19+/month | Free | Free | $0.01/min |
| Scraping tools | **6** | 3 | 1 | 1 | 1 |
| Search tools | **4** | 0 | 0 | 0 | 0 |
| Stealth levels | **3 (auto-escalate)** | Cloud-based | None | 1 | Cloud-based |
| Anti-bot detection | **7 systems** | Partial | None | Partial | Partial |
| TLS fingerprinting | **Yes (JA3/JA4)** | No | No | No | No |
| CAPTCHA auto-solving | **Yes (2Captcha)** | No | No | No | No |
| API discovery from network traffic | **Yes** | No | No | No | No |
| WebSocket monitoring | **Yes** | No | No | No | No |
| Direct API calls | **Yes** | No | No | No | No |
| Reusable skills system | **Yes** | No | No | No | No |
| Structured data extraction (JSON-LD/OG) | **Yes** | Partial | No | No | No |
| Priority-based crawling | **Yes** | No | No | No | No |
| Circuit breaker + jitter backoff | **Yes** | No | No | No | No |
| URL normalization (11 steps) | **Yes** | No | No | No | No |
| Adaptive learning (self-improving) | **Yes** | No | No | No | No |
| Self-hosted | **Yes** | No | N/A | Yes | No |
| Requires external service | **No** | Yes | No | No | Yes |
| Total tools | **16** | 5 | 2 | 2 | 4 |

> **TLDR:** More tools, more features, zero cost, no external dependencies. Self-hosted, open-source, and it runs on your machine.

## Installation

```bash
npm install -g imperium-crawl
```

Or run directly without installing:

```bash
npx -y imperium-crawl
```

### MCP Client Config

Add to your MCP client config (Claude Code, Cursor, VS Code, Windsurf, or any MCP client):

```json
{
  "mcpServers": {
    "imperium-crawl": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "imperium-crawl"],
      "env": {
        "BRAVE_API_KEY": "your-brave-api-key",
        "TWOCAPTCHA_API_KEY": "your-2captcha-api-key",
        "PROXY_URL": "http://user:pass@proxy:8080",
        "PROXY_URLS": "http://proxy1:8080,socks5://proxy2:1080"
      }
    }
  }
}
```

> **Works out of the box with zero API keys** — 12 tools are fully functional without any configuration. To unlock full power, add 2 optional API keys:
>
> | Key | What it unlocks | Where to get it |
> |-----|----------------|-----------------|
> | `BRAVE_API_KEY` | 4 search tools (web, news, image, video) | [brave.com/search/api](https://brave.com/search/api/) (free tier available) |
> | `TWOCAPTCHA_API_KEY` | Auto CAPTCHA solving (reCAPTCHA v2/v3, hCaptcha, Turnstile) | [2captcha.com](https://2captcha.com/) |
> | `PROXY_URL` | Route all requests through a proxy (http/https/socks4/socks5) | Any proxy provider |

### Enable full stealth (Level 3 — headless browser)

```bash
npm i rebrowser-playwright
npx playwright install chromium
```

### AI Agent Guide (SKILL.md)

imperium-crawl ships with [`SKILL.md`](./SKILL.md) — a structured guide that teaches AI agents (Claude, GPT, etc.) how to use all 16 tools effectively. It includes 6 proven workflows, decision trees, error recovery strategies, and advanced patterns like manual skill refinement.

**Without SKILL.md**, agents can call tools but won't know which tool to try first, when to fallback, or how to chain tools together optimally.

**With SKILL.md**, agents follow battle-tested workflows — readability → scrape → extract fallback chains, auto-detect → manual refinement for skills, search → select → deep-scrape for research, and more.

How to use it:

| AI Agent | How to add SKILL.md |
|----------|-------------------|
| **Claude Code** | Copy `SKILL.md` to your project root — Claude Code reads it automatically |
| **Cursor / Windsurf** | Add `SKILL.md` to project rules or include in system prompt |
| **Custom agents** | Include SKILL.md content in your system prompt or context window |
| **ChatGPT / GPT agents** | Paste SKILL.md content into custom instructions |

---

## CLI Mode

imperium-crawl works as both an **MCP server** and a **standalone CLI tool**. All 16 tools are available as subcommands:

```bash
# Scrape a website to markdown
imperium-crawl scrape --url https://bbc.com/news

# Crawl with depth control
imperium-crawl crawl --url https://blog.cloudflare.com --max-depth 2 --max-pages 5

# Extract structured data with CSS selectors
imperium-crawl extract --url https://news.ycombinator.com --selectors '{"title":".titleline a","score":".score"}' --items-selector ".athing"

# Discover hidden APIs on any website
imperium-crawl discover-apis --url https://weather.com

# Search the web (requires BRAVE_API_KEY)
imperium-crawl search --query "latest AI news" --count 5

# Take a screenshot
imperium-crawl screenshot --url https://github.com --full-page
```

### Output Formats

```bash
# JSON (default)
imperium-crawl scrape --url https://example.com

# CSV
imperium-crawl extract --url https://example.com --selectors '{"title":"h1"}' --output-format csv

# Markdown
imperium-crawl scrape --url https://example.com --output-format markdown

# JSONL (one JSON object per line)
imperium-crawl crawl --url https://example.com --output-format jsonl

# Pretty-print JSON
imperium-crawl scrape --url https://example.com --pretty

# Write to file
imperium-crawl scrape --url https://example.com --output result.json
```

### Help

```bash
imperium-crawl --help              # List all commands
imperium-crawl scrape --help       # Help for specific tool
imperium-crawl --version           # Show version
```

> **No arguments** = starts as MCP server (stdio). **With subcommand** = runs as CLI tool.

---

## 16 Tools

### Scraping (no API key needed)

| Tool | What It Does |
|------|-------------|
| **scrape** | URL to clean Markdown/HTML with 3-level auto-escalating stealth. Returns structured data (JSON-LD, OpenGraph, Microdata), metadata, and links on request. |
| **crawl** | Priority-based crawling with depth control, concurrency limiting, and smart URL scoring. Content paths rank higher, tracking params are stripped. |
| **map** | Discover all URLs on a domain via sitemap.xml parsing + page link extraction. |
| **extract** | CSS selectors to structured JSON. Point at any repeating pattern and get clean data. |
| **readability** | Mozilla Readability article extraction — title, author, content, publish date. 3x faster with linkedom. |
| **screenshot** | Full-page or viewport PNG screenshots via headless Chromium. |

### Search (requires free Brave API key)

| Tool | What It Does |
|------|-------------|
| **search** | Web search via Brave Search API. |
| **news_search** | News-specific search with freshness ranking. |
| **image_search** | Image search with thumbnails and source URLs. |
| **video_search** | Video search across platforms. |

### Skills (no API key needed)

| Tool | What It Does |
|------|-------------|
| **create_skill** | Analyze any page, auto-detect repeating patterns (articles, products, listings), generate CSS selectors, and save as a reusable skill. |
| **run_skill** | Run a saved skill to get fresh structured data instantly. Supports pagination. |
| **list_skills** | List all saved skills with their configurations. |

### API Discovery & Real-Time (no API key needed, requires Playwright)

| Tool | What It Does |
|------|-------------|
| **discover_apis** | Navigate to any page, intercept all XHR/fetch calls, and map every hidden REST/GraphQL API endpoint. Auto-detects GraphQL, filters noise, returns response previews. **No other MCP server does this.** |
| **query_api** | Call any API endpoint directly with stealth headers. Bypass DOM rendering entirely for 10x faster data access. Use after `discover_apis` to hit endpoints directly. |
| **monitor_websocket** | Capture real-time WebSocket messages from any page — financial tickers, chat feeds, live dashboards. Returns connection details and message payloads. **No other MCP server does this.** |

---

## Stealth Engine

imperium-crawl uses a 3-level stealth system that **auto-escalates** based on the target site's defenses:

| Level | Method | What It Defeats |
|-------|--------|-----------------|
| **1** | `header-generator` — Bayesian realistic headers + UA rotation | Basic bot detection, simple WAFs |
| **2** | `impit` — browser-identical TLS fingerprints (JA3/JA4) | Cloudflare, Akamai, TLS fingerprinting WAFs |
| **3** | `rebrowser-playwright` + `fingerprint-injector` + auto CAPTCHA solving | JavaScript challenges, SPAs, advanced anti-bot, CAPTCHAs |

### Anti-Bot System Detection

Automatically identifies which anti-bot system a site uses and chooses the optimal strategy:

| System | Detection Method |
|--------|-----------------|
| **Cloudflare** | `cf_clearance` cookies, `cf-mitigated` header, challenge page title |
| **Akamai** | `_abck`, `bm_sz` cookies |
| **PerimeterX / HUMAN** | `_px` cookies, `_pxhd` headers |
| **DataDome** | `datadome` cookies, `datadome` response header |
| **Kasada** | `x-kpsdk-*` headers |
| **AWS WAF** | `aws-waf-token` cookie |
| **F5 / Shape Security** | `TS` prefix cookies |

### Smart Rendering Cache

Once imperium-crawl determines a domain needs Level 3 (browser), it **caches that decision** for 1 hour. Subsequent requests to the same domain skip straight to browser rendering — no wasted time on failed lower levels.

---

## 🧠 Adaptive Learning Engine

imperium-crawl **learns from every request** and gets smarter over time. No configuration needed — it works automatically in the background.

### How It Works

Every time you scrape a website, the engine records:
- Which **stealth level** worked (1, 2, or 3)
- Which **anti-bot system** was detected (Cloudflare, DataDome, etc.)
- Whether a **proxy** was needed
- **Response time** and **HTTP status**
- Whether the request was **blocked or successful**

Next time you hit the same domain, the engine **predicts the optimal configuration** — skipping failed levels and going straight to what works.

### What It Learns Per Domain

| Data Point | How It's Used |
|-----------|---------------|
| Optimal stealth level | Skip straight to the level that works — no wasted escalation |
| Anti-bot system | Remember which defense the site uses |
| Proxy requirement | Auto-suggest proxy if requests keep failing without one |
| Response time | Exponential moving average — adapts to site speed changes |
| Rate limit | Auto-throttles on 429 responses (reduces rate by 30%) |
| Success/fail ratio | Confidence scoring — high confidence = use cached strategy |

### Smart Features

- **Time decay** — Knowledge older than 7 days loses weight, so the engine adapts when sites change defenses
- **Confidence scoring** — Low data = start from level 1. High confidence = skip directly to optimal level
- **Auto-prune** — Domains unused for 30 days are automatically cleaned up. Max 2,000 domains stored
- **Atomic persistence** — Knowledge saved to `~/.imperium-crawl/knowledge.json` via atomic write (tmp → rename). Never corrupts
- **Debounced writes** — Batches saves every 30 seconds to avoid disk thrashing

### Example

```
First visit to cloudflare.com:
  Level 1 → blocked ❌
  Level 2 → blocked ❌
  Level 3 → success ✅ (Cloudflare detected)
  → Engine records: cloudflare.com needs Level 3

Second visit to cloudflare.com:
  → Engine predicts: Level 3, confidence 85%, Cloudflare
  → Skips Level 1 and 2 entirely — goes straight to browser
  → 3x faster than first visit
```

> **The more you use it, the faster it gets.** Zero configuration. Fully automatic.

---

## Skills System

Skills let you teach imperium-crawl how to extract data from any website, then re-run it for fresh content whenever you want.

**Create a skill:**
```
create_skill({
  url: "https://techcrunch.com/category/artificial-intelligence",
  name: "tc-ai-news",
  description: "Latest AI news from TechCrunch"
})
```

The tool analyzes the page, auto-detects repeating elements (articles, products, listings), generates CSS selectors for each field, and saves the skill config.

**Run a skill:**
```
run_skill({ name: "tc-ai-news" })
```

Returns fresh structured data with all detected fields. Skills are saved in `~/.imperium-crawl/skills/` as JSON files — human-readable, editable, and portable.

---

## API Discovery Workflow

This is the workflow that no other MCP server supports. Real results from actual testing:

```
1. discover_apis({ url: "https://weather.com" })
   → Found 11 hidden API endpoints:
     • Main weather API (api.weather.com) with exposed API key
     • mParticle analytics endpoints
     • Taboola content recommendation API
     • OneTrust consent management API
     • DAA/AdChoices opt-out endpoints

2. query_api({ url: "https://api.weather.com/v3/...", method: "GET" })
   → Direct API call, bypasses DOM entirely — 10x faster, structured JSON response

3. monitor_websocket({ url: "https://binance.com/en/trade/BTC_USDT", duration_seconds: 10 })
   → Captures real-time WebSocket messages — financial tickers, live data feeds
```

Turn any website into an API. No documentation needed.

---

## Resilience

- **Exponential backoff with full jitter** — AWS-recommended retry pattern, no thundering herd
- **Per-domain circuit breaker** — 5 consecutive failures opens the circuit for 60s, then half-open probing with automatic recovery
- **URL normalization** — 11-step pipeline removes tracking params (utm_*, fbclid, gclid), sorts query params, normalizes encoding
- **Concurrency limiting** — per-domain request throttling via p-queue
- **Input validation** — all 16 tool schemas enforce strict bounds (URL length, query size, concurrency limits, body size)
- **HTTP transport hardening** — rate limiting (100 req/min), 1MB body limit, 5min request timeout
- **Proxy support** — single proxy (`PROXY_URL`) or rotating pool (`PROXY_URLS`) with http/https/socks4/socks5 support
- **Browser pool** — keyed by proxy URL, auto-eviction, configurable pool size
- **Adaptive learning** — remembers optimal stealth level per domain, gets faster with every request
- **Graceful shutdown** — 10s timeout on browser cleanup to prevent hung processes
- **robots.txt** — respected by default (configurable)

---

## 🔥 Real-World Test Results

Every tool tested against production websites with real anti-bot defenses:

| Tool | Target | Result |
|------|--------|--------|
| 🕷️ **extract** | Amazon (AirPods Pro 2) | Product title, 45,297 reviews, brand extracted |
| 🔓 **discover_apis** | Spotify | **8 hidden APIs** — access token exposed, client ID, dealer servers, analytics |
| 🕷️ **extract** | Stack Overflow | **15 top questions** — #1 with 27,520 votes |
| 📡 **monitor_websocket** | Binance BTC/USDT | **3 WebSocket connections, 23 live messages** — real-time price $69,390 |
| 🔓 **discover_apis** | Airbnb Paris | **34 hidden APIs** — DataDome anti-bot, Google Maps key exposed, internal search/polygon/viewport APIs |
| 🕷️ **extract** | Hacker News | **30 front-page posts** — titles + URLs extracted |
| 🔓 **discover_apis** | Netflix | **5 APIs** — OneTrust consent, geolocation (detected country: Serbia 🇷🇸) |
| 📄 **scrape** | BBC News | Full markdown content, stealth level 3 auto-escalation |
| 🕸️ **crawl** | Cloudflare Blog | **213K characters** crawled with depth control |
| 🗺️ **map** | BBC | Full URL discovery via sitemap + page link extraction |
| 📖 **readability** | Medium article | Clean extraction — title, author, content, publish date |
| 📸 **screenshot** | ProductHunt | Captured Cloudflare Turnstile challenge page |
| 🔓 **discover_apis** | weather.com | **11 hidden APIs** — main weather API with exposed key |
| ⚡ **query_api** | jsonplaceholder | Direct JSON API call with stealth headers |
| 🔍 **search** | Brave Web Search | Web results with snippets and URLs |
| 📰 **news_search** | Brave News Search | News results with freshness ranking |
| 🖼️ **image_search** | Brave Image Search | Images with thumbnails and source URLs |
| 🎬 **video_search** | Brave Video Search | Video results across platforms |
| 🛠️ **create_skill** | Any page | Auto-detects repeating patterns, generates CSS selectors |
| ▶️ **run_skill** | Saved skill | Fresh structured data from saved extraction config |
| 📋 **list_skills** | — | Lists all saved skills with configurations |

> 🏆 **16/16 tools working. 58 hidden APIs discovered. Live crypto feed captured. Zero API keys needed for scraping.**

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `BRAVE_API_KEY` | No | Brave Search API key (enables 4 search tools) |
| `TWOCAPTCHA_API_KEY` | No | 2Captcha API key (enables auto CAPTCHA solving) |
| `TRANSPORT` | No | `stdio` (default) or `http` |
| `PORT` | No | HTTP port (default: 3000) |
| `PROXY_URL` | No | Single proxy URL (http/https/socks4/socks5) |
| `PROXY_URLS` | No | Comma-separated proxy URLs for rotation |
| `BROWSER_POOL_SIZE` | No | Max pooled browser instances (default: 3) |
| `RESPECT_ROBOTS` | No | Respect robots.txt (default: `true`) |

---

## Development

```bash
git clone https://github.com/ceoimperiumprojects/imperium-crawl
cd imperium-crawl
npm install
npm run build
npm test        # 285 tests
npm start
```

---

## License

MIT — use it however you want. Free forever.
