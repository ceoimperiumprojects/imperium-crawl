<div align="center">

# imperium-crawl

**The most powerful open-source CLI tool for web scraping, crawling, and data extraction.**

28 tools. Zero API keys required. One `npx` command.

[![npm version](https://img.shields.io/npm/v/imperium-crawl.svg)](https://www.npmjs.com/package/imperium-crawl)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Tests](https://img.shields.io/badge/tests-466%20passing-brightgreen.svg)]()
[![npm downloads](https://img.shields.io/npm/dm/imperium-crawl.svg)](https://www.npmjs.com/package/imperium-crawl)

</div>

---

## Quick Start

Get running in 30 seconds.

**CLI** (zero install):

```bash
npx -y imperium-crawl scrape --url https://example.com
```

**Global install:**

```bash
npm install -g imperium-crawl
```

> That's it. 22 of 28 tools work with zero API keys. Add optional keys later to unlock search, AI extraction, and CAPTCHA solving.

---

## Power Examples

Real results. Copy-paste and try.

### Scrape through Cloudflare

```bash
imperium-crawl scrape --url https://blog.cloudflare.com
```

```
Level 1 (headers) → blocked
Level 2 (TLS fingerprint) → blocked
Level 3 (browser + stealth) → success ✅
→ Full markdown content extracted, 213K characters
→ Next visit: skips straight to Level 3 (learned)
```

### Discover hidden APIs on any website

```bash
imperium-crawl discover-apis --url https://weather.com
```

```
Found 11 hidden API endpoints:
  • api.weather.com — main weather API (exposed API key!)
  • mParticle analytics endpoints
  • Taboola content recommendation API
  • OneTrust consent management API
  • DAA/AdChoices opt-out endpoints
→ Call any endpoint directly with query_api — 10x faster than DOM scraping
```

### AI extraction in plain English

```bash
imperium-crawl ai-extract --url https://amazon.com/dp/B0D1XD1ZV3 \
  --schema "extract product name, price, rating, and review count"
```

```json
{
  "product_name": "Apple AirPods Pro 2",
  "price": "$189.99",
  "rating": "4.7 out of 5",
  "review_count": "45,297"
}
```

### Batch scrape with resume

```bash
imperium-crawl batch-scrape \
  --urls '["https://bbc.com","https://cnn.com","https://reuters.com","https://techcrunch.com"]' \
  --concurrency 3
```

```
Scraping 4 URLs (concurrency: 3)...
  ✅ bbc.com — 47K chars
  ✅ cnn.com — 52K chars
  ✅ reuters.com — 38K chars
  ✅ techcrunch.com — 61K chars
→ 4/4 succeeded. Job ID: abc123 (resume with --job-id if interrupted)
```

---

## Why imperium-crawl?

🔓 **Zero API Keys Required**
22 of 28 tools work out of the box. No accounts, no tokens, no credit cards. Just `npx` and go.

🛡️ **3-Level Auto-Escalating Stealth**
Headers → TLS fingerprinting → headless browser + CAPTCHA solving. Automatically escalates until it gets through.

🧠 **Self-Improving**
Adaptive learning engine remembers what works per domain. Second visit is 3x faster. The more you use it, the smarter it gets.

🧰 **28 Tools, 2 Modes**
CLI tool or interactive TUI. Scraping, crawling, search, extraction, API discovery, WebSocket monitoring, browser automation, batch processing.

📜 **14 Built-in Recipes**
Pre-built workflows for common tasks — news extraction, e-commerce scraping, API reverse engineering, and more.

⚡ **Skills System**
Teach it once, run forever. Auto-detect patterns on any page, save as reusable skills, get fresh data on demand.

---

## vs. The Competition

| Feature | **imperium-crawl** | Firecrawl | Crawl4AI | Browserbase | Puppeteer |
|---------|:------------------:|:---------:|:--------:|:-----------:|:---------:|
| Price | **Free forever** | $19+/month | Free | $0.01/min | Free |
| Total tools | **28** | 5 | 2 | 4 | N/A |
| Stealth levels | **3 (auto-escalate)** | Cloud-based | 1 | Cloud-based | None |
| Anti-bot detection | **7 systems** | Partial | Partial | Partial | None |
| TLS fingerprinting | **JA3/JA4** | No | No | No | No |
| CAPTCHA auto-solving | **Yes** | No | No | No | No |
| API discovery | **Yes** | No | No | No | No |
| WebSocket monitoring | **Yes** | No | No | No | No |
| AI-powered extraction | **Yes** | No | No | No | No |
| Adaptive learning | **Yes** | No | No | No | No |
| Batch processing | **Yes** | No | No | No | No |
| ARIA Snapshots | **Yes** | No | No | No | No |
| Session Encryption | **Yes** | No | No | No | No |
| Self-hosted | **Yes** | No | Yes | No | Yes |
| Requires external service | **No** | Yes | No | Yes | No |

---

## Stealth Engine

```
Request → [L1: Headers + UA rotation]
              │
              ├─ success → Done
              ↓ fail
          [L2: TLS Fingerprint (JA3/JA4)]
              │
              ├─ success → Done
              ↓ fail
          [L3: Browser + Fingerprint Injection + CAPTCHA]
              │
              ├─ success → Done
              ↓
          [Learning Engine records optimal level for next time]
```

### Stealth Levels

| Level | Method | What It Defeats |
|-------|--------|-----------------|
| **1** | `header-generator` — Bayesian realistic headers + UA rotation | Basic bot detection, simple WAFs |
| **2** | `impit` — browser-identical TLS fingerprints (JA3/JA4) | Cloudflare, Akamai, TLS fingerprinting WAFs |
| **3** | `rebrowser-playwright` + `fingerprint-injector` + auto CAPTCHA | JavaScript challenges, SPAs, advanced anti-bot, CAPTCHAs |

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

Once imperium-crawl determines a domain needs Level 3 (browser), it caches that decision for 1 hour. Subsequent requests to the same domain skip straight to browser rendering — no wasted time on failed lower levels.

---

## Adaptive Learning Engine

imperium-crawl **learns from every request** and gets smarter over time. No configuration needed — fully automatic.

Every time you scrape a website, the engine records which stealth level worked, which anti-bot system was detected, whether a proxy was needed, response timing, and success/failure. Next time you hit the same domain, it **predicts the optimal configuration** — skipping failed levels and going straight to what works.

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

### Smart Features

- **Time decay** — Knowledge older than 7 days loses weight, adapts when sites change defenses
- **Confidence scoring** — Low data = start from level 1. High confidence = skip to optimal level
- **Auto-prune** — Domains unused for 30 days are cleaned up. Max 2,000 domains stored
- **Atomic persistence** — Knowledge saved via atomic write (tmp → rename). Never corrupts

> **The more you use it, the faster it gets.**

---

## All 28 Tools

### 📄 Scraping (no API key needed)

| Tool | What It Does |
|------|-------------|
| **scrape** | URL to clean Markdown/HTML with 3-level auto-escalating stealth. Structured data (JSON-LD, OpenGraph, Microdata), metadata, and links. |
| **crawl** | Priority-based crawling with depth control, concurrency limiting, and smart URL scoring. |
| **map** | Discover all URLs on a domain via sitemap.xml + page link extraction. |
| **extract** | CSS selectors to structured JSON. Point at any repeating pattern and get clean data. |
| **readability** | Mozilla Readability article extraction — title, author, content, publish date. |
| **screenshot** | Full-page or viewport PNG screenshots via headless Chromium. |

### 🔍 Search (requires free Brave API key)

| Tool | What It Does |
|------|-------------|
| **search** | Web search via Brave Search API. |
| **news_search** | News-specific search with freshness ranking. |
| **image_search** | Image search with thumbnails and source URLs. |
| **video_search** | Video search across platforms. |

### ⚡ Skills (no API key needed)

| Tool | What It Does |
|------|-------------|
| **create_skill** | Analyze any page, auto-detect repeating patterns, generate CSS selectors, save as reusable skill. |
| **run_skill** | Run a saved skill for fresh structured data. Supports pagination. |
| **list_skills** | List all saved skills with configurations. |

### 🔓 API Discovery & Real-Time (no API key needed, requires Playwright)

| Tool | What It Does |
|------|-------------|
| **discover_apis** | Navigate to any page, intercept XHR/fetch calls, map hidden REST/GraphQL endpoints. Auto-detects GraphQL, filters noise, returns response previews. |
| **query_api** | Call any API endpoint directly with stealth headers. Bypass DOM rendering for 10x faster data access. |
| **monitor_websocket** | Capture real-time WebSocket messages — financial tickers, chat feeds, live dashboards. |

### 🧠 AI Extraction (requires LLM API key)

| Tool | What It Does |
|------|-------------|
| **ai_extract** | Describe what you want in natural language or JSON schema. 3 providers (Anthropic, OpenAI, MiniMax). The `extract` tool also supports `llm_fallback: true` for hybrid CSS→AI extraction. |

### 🖱️ Interaction (no API key needed, requires Playwright)

| Tool | What It Does |
|------|-------------|
| **interact** | Browser automation with 18 action types (click, type, scroll, wait, screenshot, evaluate, select, hover, press, navigate, drag, upload, storage, cookies, pdf, auth_login). Ref targeting via ARIA snapshot, session encryption, action policy, domain filter, network interception, device emulation. |
| **snapshot** | ARIA-based page snapshot with interactive element refs. Use refs in interact for precise targeting. Annotated screenshots. |

### 📱 Social Media (no API key needed)

| Tool | What It Does |
|------|-------------|
| **youtube** | Search videos, get video details, comments, transcripts, chapters, and channel info. Parses `ytInitialData` — no API key needed. Add `OPENAI_API_KEY` to unlock Whisper AI transcription for videos without captions. |
| **reddit** | Search Reddit, browse subreddits, get posts and comments via Reddit's public JSON API. |
| **instagram** | Search profiles, get detailed profile info with engagement metrics, and discover influencers by niche/location. Search/discover require `BRAVE_API_KEY`. |

### 📥 Media & Feeds (no API key needed)

| Tool | What It Does |
|------|-------------|
| **download** | Download media files from any URL — images, video, YouTube, TikTok, bulk. Auto-detects URL type and applies optimal strategy. |
| **rss** | Fetch and parse RSS/Atom feeds. Filter by date, output as JSON or Markdown. |

### 📦 Batch Processing (no API key needed)

| Tool | What It Does |
|------|-------------|
| **batch_scrape** | Parallel URL scraping with configurable concurrency, soft failure, and resume via job_id. Optional AI extraction per URL. |
| **list_jobs** | List all batch jobs with status and progress. |
| **job_status** | Full results for a specific batch job including per-URL outcomes. |
| **delete_job** | Clean up completed or failed batch jobs. |

---

## Setup

### API Keys

| Key | What It Unlocks | Where to Get It |
|-----|----------------|-----------------|
| `BRAVE_API_KEY` | 4 search tools (web, news, image, video) | [brave.com/search/api](https://brave.com/search/api/) (free tier available) |
| `TWOCAPTCHA_API_KEY` | Auto CAPTCHA solving (reCAPTCHA v2/v3, hCaptcha, Turnstile) | [2captcha.com](https://2captcha.com/) |
| `LLM_API_KEY` | AI-powered data extraction (`ai_extract` tool) | Anthropic, OpenAI, or MiniMax API key |
| `OPENAI_API_KEY` | Whisper AI transcription — transcribe any YouTube video, even without captions | [platform.openai.com](https://platform.openai.com/) |
| `CHROME_PROFILE_PATH` | Authenticated browser sessions (use your Chrome cookies) | Path to Chrome user data dir |
| `PROXY_URL` | Route all requests through a proxy (http/https/socks4/socks5) | Any proxy provider |

### Enable Full Stealth (Level 3)

```bash
npm i rebrowser-playwright
npx playwright install chromium
```

---

## CLI Usage

**With subcommand** = runs that tool. **No args in TTY** = interactive TUI. **No args in pipe** = shows help.

```bash
# Scrape a website to markdown
imperium-crawl scrape --url https://bbc.com/news

# Crawl with depth control
imperium-crawl crawl --url https://blog.cloudflare.com --max-depth 2 --max-pages 5

# AI-powered extraction — plain English
imperium-crawl ai-extract --url https://amazon.com/dp/B0D1XD1ZV3 \
  --schema "extract product name, price, rating, and review count"

# Discover hidden APIs
imperium-crawl discover-apis --url https://weather.com

# Batch scrape in parallel
imperium-crawl batch-scrape --urls '["https://site1.com","https://site2.com"]' --concurrency 3

# Interactive setup wizard
imperium-crawl setup
```

### Output Formats

```bash
imperium-crawl scrape --url https://example.com                          # JSON (default)
imperium-crawl scrape --url https://example.com --output-format markdown  # Markdown
imperium-crawl scrape --url https://example.com --output-format csv       # CSV
imperium-crawl scrape --url https://example.com --pretty                  # Pretty JSON
imperium-crawl scrape --url https://example.com --output result.json      # Write to file
```

### TUI Mode

```bash
imperium-crawl tui
```

Interactive slash-command terminal with parameter prompts, table rendering, markdown display, and session state. Use `/save` to export results and `/again` to re-run the last command.

---

## Skills & Recipes

Skills let you teach imperium-crawl how to extract data from any website, then re-run for fresh content whenever you want.

**Create a skill:**
```
create_skill({
  url: "https://techcrunch.com/category/artificial-intelligence",
  name: "tc-ai-news",
  description: "Latest AI news from TechCrunch"
})
```

**Run a skill:**
```
run_skill({ name: "tc-ai-news" })
→ Returns fresh structured data with all detected fields
```

Skills are saved in `~/.imperium-crawl/skills/` as JSON files — human-readable, editable, portable.

### Built-in Recipes

| Recipe | What It Does |
|--------|-------------|
| `hn-top-stories` | Hacker News front page — titles, scores, comment counts |
| `github-trending` | GitHub trending repos — stars, language, description |
| `job-listings-greenhouse` | Greenhouse job boards — title, team, location |
| `ecommerce-product` | Product name, price, rating, reviews, images |
| `product-reviews` | Review text, ratings, author, date from product pages |
| `crypto-websocket` | Live crypto prices via WebSocket monitoring |
| `news-article-reader` | Article title, author, date, content from news sites |
| `reddit-posts` | Subreddit posts — title, score, comments, flair |
| `seo-page-audit` | SEO signals — meta tags, headings, structured data |
| `social-media-mentions` | Brand mentions across social platforms |
| `influencer-niche-discovery` | Find influencers by niche + location via Instagram |
| `influencer-hashtag-scout` | Discover influencers through hashtag analysis |
| `influencer-competitor-spy` | Find influencers from competitor brand mentions |
| `influencer-content-scout` | Analyze content patterns of niche influencers |

See [`SKILL/`](./SKILL/) for detailed workflow guides and agent integration.

---

## API Discovery Workflow

Turn any website into an API. No documentation needed.

```
1. discover_apis({ url: "https://weather.com" })
   → Found 11 hidden API endpoints:
     • Main weather API (api.weather.com) with exposed API key
     • mParticle analytics endpoints
     • Taboola content recommendation API
     • OneTrust consent management API

2. query_api({ url: "https://api.weather.com/v3/...", method: "GET" })
   → Direct API call, bypasses DOM entirely — 10x faster, structured JSON

3. monitor_websocket({ url: "https://binance.com/en/trade/BTC_USDT", duration_seconds: 10 })
   → Captures real-time WebSocket messages — live BTC price feed
```

---

## AI Agent Guide

imperium-crawl ships with [`SKILL/`](./SKILL/) — a structured guide that teaches AI agents how to use all 28 tools effectively. Includes proven workflows, decision trees, error recovery, and advanced patterns.

### Two Ways to Connect

| Method | Setup | Works With |
|--------|-------|-----------|
| **CLI + SKILL/** | `npm i -g imperium-crawl` + SKILL.md in agent context | **Any agent with bash access** — Claude Code, Cursor, OpenClaw, ChatGPT, custom agents |
| **TUI** | `imperium-crawl tui` — interactive terminal | Direct human use, demos, debugging |

### Per-Agent Setup

| AI Agent | How to Add SKILL/ |
|----------|-------------------|
| **Claude Code** | Copy `SKILL.md` to project root — auto-detected |
| **Cursor / Windsurf** | Add `SKILL.md` to project rules or system prompt |
| **OpenClaw / custom agents** | Include SKILL.md in system prompt or context window |
| **ChatGPT / GPT agents** | Paste SKILL.md content into custom instructions |

---

## Resilience

- **Exponential backoff with full jitter** — AWS-recommended retry pattern, no thundering herd
- **Per-domain circuit breaker** — 5 failures opens circuit for 60s, then half-open probing with auto recovery
- **URL normalization** — 11-step pipeline removes tracking params (utm_*, fbclid, gclid), sorts query params
- **Proxy support** — single proxy or rotating pool with http/https/socks4/socks5
- **Browser pool** — keyed by proxy URL, auto-eviction, configurable pool size
- **robots.txt** — respected by default (configurable)
- **Graceful shutdown** — 10s timeout on browser cleanup to prevent hung processes

---

## Real-World Test Results

Every tool tested against production websites with real anti-bot defenses:

| Tool | Target | Result |
|------|--------|--------|
| 📄 **scrape** | BBC News | Full markdown, stealth level 3 auto-escalation |
| 🕸️ **crawl** | Cloudflare Blog | 213K characters crawled with depth control |
| 🗺️ **map** | BBC | Full URL discovery via sitemap + link extraction |
| 🕷️ **extract** | Amazon (AirPods Pro 2) | Product title, 45,297 reviews, brand extracted |
| 📖 **readability** | Medium article | Clean — title, author, content, publish date |
| 📸 **screenshot** | ProductHunt | Captured Cloudflare Turnstile challenge page |
| 🔍 **search** | Brave Web | Web results with snippets and URLs |
| 📰 **news_search** | Brave News | News results with freshness ranking |
| 🖼️ **image_search** | Brave Image | Images with thumbnails and source URLs |
| 🎬 **video_search** | Brave Video | Video results across platforms |
| 🛠️ **create_skill** | Hacker News | Auto-detected 30 stories with CSS selectors |
| ▶️ **run_skill** | Saved skill | Fresh structured data from saved config |
| 📋 **list_skills** | — | Lists all skills with configurations |
| 🔓 **discover_apis** | Airbnb Paris | **34 hidden APIs** — DataDome, Google Maps key, internal APIs |
| ⚡ **query_api** | jsonplaceholder | Direct JSON API call with stealth headers |
| 📡 **monitor_websocket** | Binance BTC/USDT | 3 WebSocket connections, 23 live messages — BTC price live |
| 🧠 **ai_extract** | Amazon product | AI extracted name, price, rating, review count |
| 🎯 **snapshot** | GitHub, Wikipedia | ARIA tree with 107/113 refs, annotated screenshots |
| 🖱️ **interact** | Login flow | Click → type → submit — ref targeting, session encryption, 18 action types |
| 📦 **batch_scrape** | 10 news sites | Parallel, concurrency 3, soft failure, 9/10 succeeded |
| 📋 **list_jobs** | — | Batch jobs with status and progress |
| 📊 **job_status** | Batch job | Full per-URL results with timing |
| 🗑️ **delete_job** | Completed job | Cleaned up job data from disk |
| 🎬 **youtube** | "web scraping tutorial" | Search results, video details, comments, transcripts — no API key |
| 💬 **reddit** | r/webscraping | Subreddit posts, comments, search — public JSON API |
| 📸 **instagram** | @nike profile | Profile details, engagement rate, recent posts — internal API |
| 📥 **download** | YouTube video, web page images | Auto-detect URL type, download media files — images, video, og:image |
| 📡 **rss** | Hacker News RSS | Parsed feed items with title, link, date, author, categories |

> **28/28 tools. 34 hidden APIs on Airbnb. Live BTC feed. Zero API keys for scraping.**

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `BRAVE_API_KEY` | No | Brave Search API key (enables 4 search tools) |
| `TWOCAPTCHA_API_KEY` | No | 2Captcha API key (enables auto CAPTCHA solving) |
| `LLM_API_KEY` | No | Anthropic, OpenAI, or MiniMax API key (enables `ai_extract`) |
| `LLM_PROVIDER` | No | `anthropic`, `openai`, or `minimax` (default: `anthropic`). **Recommended: `minimax` with MiniMax-M1** — best price/performance for extraction |
| `LLM_MODEL` | No | Override default LLM model |
| `OPENAI_API_KEY` | No | OpenAI API key for Whisper transcription (transcribe any YouTube video without captions) |
| `SESSION_ENCRYPTION_KEY` | No | 32-byte hex key for encrypting session files at rest |
| `PROXY_URL` | No | Single proxy URL (http/https/socks4/socks5) |
| `PROXY_URLS` | No | Comma-separated proxy URLs for rotation |
| `BROWSER_POOL_SIZE` | No | Max pooled browser instances (default: 3) |
| `RESPECT_ROBOTS` | No | Respect robots.txt (default: `true`) |
| `CHROME_PROFILE_PATH` | No | Chrome user data dir for authenticated sessions |
| `NO_COLOR` | No | Disable colored output |
| `CI` | No | Auto-detected; disables TTY features |

---

## Development

```bash
git clone https://github.com/ceoimperiumprojects/imperium-crawl
cd imperium-crawl
npm install
npm run build
npm run dev         # Watch mode (rebuild on changes)
npm test            # 466 tests
npm start           # Start CLI (shows help or TUI)
```

---

## Contributing

Contributions welcome! Whether it's a bug fix, new tool, or documentation improvement — open an issue or PR.

```bash
# Fork the repo, then:
git clone https://github.com/YOUR_USERNAME/imperium-crawl
cd imperium-crawl
npm install
git checkout -b my-feature
# Make changes...
npm test
git push origin my-feature
# Open a PR
```

---

## License

MIT — use it however you want. Free forever.
