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
        "BRAVE_API_KEY": "your-brave-api-key"
      }
    }
  }
}
```

> **API keys are optional.** Without `BRAVE_API_KEY`, only the 4 search tools are disabled. All 12 other tools work out of the box.

### Enable full stealth (Level 3 — headless browser)

```bash
npm i rebrowser-playwright
npx playwright install chromium
```

### Enable CAPTCHA auto-solving

```bash
# Add to your MCP config env:
"TWOCAPTCHA_API_KEY": "your-2captcha-api-key"
```

Supports reCAPTCHA v2/v3, hCaptcha, and Cloudflare Turnstile. Auto-detects CAPTCHA type and solves transparently.

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

This is the workflow that no other MCP server supports:

```
1. discover_apis({ url: "https://github.com/anthropics" })
   → Finds 5 hidden JSON API endpoints (refs, tree-commit-info, overview-files...)

2. query_api({ url: "https://github.com/.../refs", method: "GET" })
   → Direct API call, bypasses DOM entirely — 10x faster, structured JSON response

3. monitor_websocket({ url: "https://binance.com/en/trade/BTC_USDT", duration_seconds: 10 })
   → Captures 38 real-time WebSocket messages from 3 connections
```

Turn any website into an API. No documentation needed.

---

## Resilience

- **Exponential backoff with full jitter** — AWS-recommended retry pattern, no thundering herd
- **Per-domain circuit breaker** — 5 consecutive failures opens the circuit for 60s, then half-open probing
- **URL normalization** — 11-step pipeline removes tracking params (utm_*, fbclid, gclid), sorts query params, normalizes encoding
- **Concurrency limiting** — per-domain request throttling via p-queue
- **robots.txt** — respected by default (configurable)

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `BRAVE_API_KEY` | No | Brave Search API key (enables 4 search tools) |
| `TWOCAPTCHA_API_KEY` | No | 2Captcha API key (enables auto CAPTCHA solving) |
| `TRANSPORT` | No | `stdio` (default) or `http` |
| `PORT` | No | HTTP port (default: 3000) |
| `RESPECT_ROBOTS` | No | Respect robots.txt (default: `true`) |

---

## Development

```bash
git clone https://github.com/ceoimperiumprojects/imperium-crawl
cd imperium-crawl
npm install
npm run build
npm test        # 120 tests
npm start
```

---

## License

MIT — use it however you want. Free forever.
