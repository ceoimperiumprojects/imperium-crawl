# SKILL.md — How AI Agents Should Use imperium-crawl

This document teaches AI agents (Claude, GPT, etc.) how to effectively use imperium-crawl's 16 MCP tools. It covers tool selection, workflows, error recovery, and best practices.

## Tool Reference

### Scraping Tools (no API key needed)

| Tool | Best For | Key Parameters |
|------|----------|---------------|
| `scrape` | General page content, product pages, multi-format output | `url`, `format` (markdown/html), `include` (structured_data, links, metadata), `stealth_level` |
| `readability` | Articles, blog posts, news — clean text extraction | `url`, `format` (markdown/html/text) |
| `extract` | Structured data with CSS selectors, repeating items | `url`, `selectors` (field→CSS map), `items_selector` |
| `crawl` | Multi-page content, site sections, documentation | `url`, `max_depth`, `max_pages`, `concurrency` |
| `map` | URL discovery, site structure, sitemap parsing | `url`, `max_urls`, `include_sitemap` |
| `screenshot` | Visual capture, layout verification, anti-bot pages | `url`, `full_page` |

### Search Tools (require `BRAVE_API_KEY`)

| Tool | Best For | Key Parameters |
|------|----------|---------------|
| `search` | Web search | `query`, `count`, `country` |
| `news_search` | Recent news with freshness ranking | `query`, `count`, `freshness` (pd/pw/pm) |
| `image_search` | Image discovery | `query`, `count`, `country` |
| `video_search` | Video discovery across platforms | `query`, `count`, `country` |

### Skills Tools (no API key needed)

| Tool | Best For | Key Parameters |
|------|----------|---------------|
| `create_skill` | Auto-detect extraction patterns, save reusable scraper | `url`, `name`, `description`, `max_pages` |
| `run_skill` | Execute a saved skill for fresh data | `name`, `url` (override), `max_items` |
| `list_skills` | See all saved skills | (none) |

### API Discovery Tools (require Playwright)

| Tool | Best For | Key Parameters |
|------|----------|---------------|
| `discover_apis` | Find hidden REST/GraphQL endpoints from network traffic | `url`, `wait_seconds`, `include_headers`, `filter_content_type` |
| `query_api` | Call discovered API endpoints directly | `url`, `method`, `headers`, `body`, `timeout` |
| `monitor_websocket` | Capture real-time WebSocket messages | `url`, `duration_seconds`, `max_messages`, `filter_url` |

---

## Decision Tree — Which Tool to Use

### User wants to read an article or page content
```
1. Try readability → clean article extraction
2. If empty/garbage → fallback to scrape with format: "markdown"
3. If JavaScript-heavy SPA → scrape with stealth_level: 3
```

### User wants structured data (products, listings, tables)
```
1. Try scrape with include: ["structured_data"] → check JSON-LD, OpenGraph
2. If structured data has what's needed → done
3. If not → use extract with CSS selectors + items_selector
4. If unsure about selectors → screenshot first to see layout
```

### User wants to build a reusable scraper
```
1. create_skill → auto-detects repeating patterns
2. Review preview_items → does it match expectations?
3. If yes → done, use run_skill to get fresh data anytime
4. If no → use extract to test selectors manually, then recreate skill
```

### User wants to discover APIs on a site
```
1. discover_apis with wait_seconds: 8 → capture network traffic
2. Categorize: first-party vs third-party, REST vs GraphQL vs WebSocket
3. For interesting endpoints → query_api to test them directly
4. For WebSocket feeds → monitor_websocket to capture messages
```

### User wants to research a topic
```
1. search with 2-3 targeted queries → find sources
2. Select 3-5 authoritative URLs from results
3. readability on each → extract clean content
4. Synthesize findings into a structured report with citations
```

### User wants to analyze/audit a website
```
1. map → discover site structure and URL patterns
2. scrape homepage with include: ["structured_data", "metadata", "links"]
3. crawl with max_depth: 2, max_pages: 10 → sample content
4. screenshot → visual reference
5. Compile into site intelligence report
```

---

## Stealth Level Guidance

The stealth engine **auto-escalates** (Level 1 → 2 → 3), so you usually don't need to specify `stealth_level`. However:

| Site Type | Recommendation |
|-----------|---------------|
| Simple static sites, blogs | Default (Level 1 will work) |
| News sites (BBC, CNN) | Default (auto-escalates if needed) |
| Anti-bot protected (Cloudflare, DataDome) | Set `stealth_level: 3` directly to save time |
| JavaScript SPAs (React, Angular, Vue) | Set `stealth_level: 3` — content requires browser rendering |
| E-commerce (Amazon, eBay) | Set `stealth_level: 3` — heavy anti-bot |

### Adaptive Learning

imperium-crawl has a built-in adaptive learning engine that **remembers which stealth level worked for each domain**. After the first visit, subsequent requests to the same domain automatically use the optimal configuration — no manual tuning needed.

---

## Proxy Usage

If the user provides a proxy URL or asks to use a proxy, pass it via the `proxy` parameter on any tool call:

```json
{ "url": "https://example.com", "proxy": "socks5://user:pass@proxy:1080" }
```

Supported protocols: `http`, `https`, `socks4`, `socks5`

If `PROXY_URL` or `PROXY_URLS` is set in the environment, the system automatically routes requests through proxies. Per-request `proxy` overrides the environment setting.

---

## Skills System — Detailed Workflow

Skills are the **fastest and cheapest way** to extract data repeatedly from the same type of page.

### Why Use Skills

| Without Skills | With Skills |
|---------------|-------------|
| ~15,000 tokens per extraction | ~500 tokens per extraction |
| 10+ seconds (AI reads full page) | 2 seconds (direct CSS extraction) |
| AI may pick different fields each time | 100% consistent output every time |
| Requires full page in context | Only structured JSON returned |

### Creating a Skill

```
create_skill({
  url: "https://news.ycombinator.com",
  name: "hn-stories",
  description: "Top stories from Hacker News"
})
```

The tool:
1. Scrapes the page using the stealth engine
2. Auto-detects repeating elements (articles, products, listings)
3. Identifies fields: title, url, date, image, summary, author
4. Scores patterns and picks the best one
5. Detects pagination (next page links)
6. Saves as JSON to `~/.imperium-crawl/skills/hn-stories.json`
7. Returns a preview of extracted items for verification

### Running a Skill

```
run_skill({ name: "hn-stories" })
```

Returns fresh structured data using saved CSS selectors. Supports:
- `url` override — point the skill at a different page with the same structure
- `max_items` — limit number of returned items (default: 50)
- Automatic pagination — follows next-page links up to `max_pages`

### Common Skill Patterns

| Site Type | Container Selector | Typical Fields |
|-----------|-------------------|----------------|
| News/blog feed | `article`, `.post` | title, date, author, excerpt, url |
| E-commerce listing | `.product-card`, `.item` | name, price, image, url, rating |
| Job board | `.job-listing`, `.vacancy` | title, company, location, salary, url |
| Directory | `.listing`, `.result` | name, address, phone, website |
| Table data | `table tbody tr` | cell values by position |

---

## API Discovery — Detailed Workflow

This is the workflow that **no other MCP server supports**. It turns any website into an API.

### Step 1: Discover

```
discover_apis({ url: "https://weather.com", wait_seconds: 8 })
```

**Tuning `wait_seconds`:**
- Simple static sites: `5` seconds
- Standard web apps: `8` seconds (default)
- Heavy SPAs: `12-15` seconds
- Infinite scroll / lazy load: `15-20` seconds

### Step 2: Categorize

From the results, categorize endpoints:

- **First-party APIs** (same domain) — the interesting ones
- **Third-party** (analytics, ads, tracking) — usually noise
- **Authentication type:** none, cookie, bearer token, API key
- **Data format:** JSON, GraphQL, binary

### Step 3: Query Directly

```
query_api({ url: "https://api.weather.com/v3/...", method: "GET" })
```

Direct API calls are **10x faster** than scraping HTML — they bypass DOM rendering entirely.

### Step 4: Monitor WebSockets (if applicable)

```
monitor_websocket({ url: "https://binance.com/en/trade/BTC_USDT", duration_seconds: 15 })
```

Captures real-time data feeds: financial tickers, chat messages, live dashboards.

---

## Error Recovery

| Problem | Solution |
|---------|----------|
| Empty content returned | Retry with `stealth_level: 3` — likely blocked by anti-bot |
| Timeout error | Increase `timeout` to 30000-60000ms |
| Readability returns garbage | Fallback to `scrape` with `format: "markdown"` |
| CAPTCHA detected | Level 3 handles it automatically if `TWOCAPTCHA_API_KEY` is set |
| 403/429 status | Retry with Level 3 and/or proxy |
| No API calls captured | Increase `wait_seconds` to 15-20; site may need interaction |
| URL blocked by robots.txt | Respect it — try a different URL or set `RESPECT_ROBOTS=false` |
| Extract returns empty fields | Check CSS selectors; take a screenshot to verify page structure |
| Skill returns wrong data | Site may have changed layout; recreate the skill |
| Search returns no results | Broaden query terms, try simpler keywords |

---

## Best Practices

1. **Sequential, not parallel** — Don't scrape multiple pages in parallel. Sequential calls prevent rate limiting
2. **Start simple** — Try `readability` before `scrape`, try `scrape` before `extract`
3. **Use skills for repeated tasks** — Create a skill once, run it forever. 30x less tokens, 5x faster
4. **Use API discovery for dynamic sites** — If a site loads data via JavaScript, discover its APIs and call them directly
5. **Respect robots.txt** — The system checks automatically. Don't bypass unless explicitly asked
6. **Let stealth auto-escalate** — Only force `stealth_level: 3` on known anti-bot sites
7. **The system learns** — The adaptive learning engine remembers what works per domain. Repeat visits are automatically optimized
8. **Proxy when needed** — Pass `proxy` parameter for geo-restricted content or to avoid IP blocks
9. **Check structured data first** — Many sites have JSON-LD/OpenGraph that already contains the data you need
10. **Screenshot for debugging** — When extract returns unexpected results, screenshot the page to see what's actually there
