# SKILL.md — imperium-crawl Agent Guide

You are a web intelligence specialist using imperium-crawl, an MCP server with 16 tools for scraping, crawling, search, API discovery, and reusable extraction skills. This guide teaches you to select the right tool, follow proven workflows, and recover from errors.

## Tool Inventory

### Scraping Tools (no API key needed)

| Tool | When to use | Key Parameters |
|------|-------------|---------------|
| `scrape` | General page content, product pages, multi-format output | `url`, `format` (markdown/html), `include` (structured_data, links, metadata), `stealth_level` |
| `readability` | Articles, blog posts, news — clean text extraction | `url`, `format` (markdown/html/text) |
| `extract` | Structured data with CSS selectors, repeating items | `url`, `selectors` (field-to-CSS map), `items_selector` |
| `crawl` | Multi-page content, site sections, documentation | `url`, `max_depth`, `max_pages`, `concurrency` |
| `map` | URL discovery, site structure, sitemap parsing | `url`, `max_urls`, `include_sitemap` |
| `screenshot` | Visual capture, layout verification, anti-bot pages | `url`, `full_page` |

### Search Tools (require `BRAVE_API_KEY`)

| Tool | When to use | Key Parameters |
|------|-------------|---------------|
| `search` | Web search across all content types | `query`, `count`, `country` |
| `news_search` | Recent news with freshness ranking | `query`, `count`, `freshness` (pd/pw/pm) |
| `image_search` | Image discovery | `query`, `count`, `country` |
| `video_search` | Video discovery across platforms | `query`, `count`, `country` |

### Skills Tools (no API key needed)

| Tool | When to use | Key Parameters |
|------|-------------|---------------|
| `create_skill` | Auto-detect extraction patterns, save reusable scraper | `url`, `name`, `description`, `max_pages` |
| `run_skill` | Execute a saved skill for fresh data | `name`, `url` (override), `max_items` |
| `list_skills` | See all saved skills | (none) |

### API Discovery Tools (require Playwright)

| Tool | When to use | Key Parameters |
|------|-------------|---------------|
| `discover_apis` | Find hidden REST/GraphQL endpoints from network traffic | `url`, `wait_seconds`, `include_headers`, `filter_content_type` |
| `query_api` | Call discovered API endpoints directly | `url`, `method`, `headers`, `body`, `timeout` |
| `monitor_websocket` | Capture real-time WebSocket messages | `url`, `duration_seconds`, `max_messages`, `filter_url` |

---

## Decision Tree — Which Tool First

```
User request
  |
  |-- "Read this article / get the text"
  |     --> Workflow 1: Content Extraction
  |
  |-- "Get product info / extract prices / pull all items"
  |     --> Workflow 2: Structured Data Extraction
  |
  |-- "Create a scraper / extract this regularly"
  |     --> Workflow 3: Build a Skill
  |
  |-- "Find APIs / what endpoints does this site use"
  |     --> Workflow 4: API Discovery
  |
  |-- "Research [topic] / find information about"
  |     --> Workflow 5: Multi-Source Research
  |
  |-- "Analyze this website / site audit"
  |     --> Workflow 6: Site Intelligence
```

---

## Workflow 1: Content Extraction

**Goal:** Extract readable content from a URL.

### Step 1: Try Readability First

```
readability({ url: "https://example.com/article" })
```

This returns clean title, author, date, and body text — ideal for articles, blog posts, news.

### Step 2: Evaluate the Result

- **Good content** (title present, text > 200 chars) → present it, done
- **Empty or garbage** → fallback to Step 3
- **Page is a JavaScript SPA** → skip to Step 3 with `stealth_level: 3`

### Step 3: Fallback to Scrape

```
scrape({ url: "https://example.com/article", format: "markdown", include: ["metadata"] })
```

If still empty, the page likely needs browser rendering:

```
scrape({ url: "https://example.com/article", format: "markdown", stealth_level: 3 })
```

### Error Recovery

| Problem | Solution |
|---------|----------|
| Readability returns garbage | Fallback to `scrape` with `format: "markdown"` |
| Empty content with default stealth | Retry with `stealth_level: 3` — page needs browser rendering |
| Timeout | Increase `timeout` to 30000-60000ms |
| 403/429 status | Retry with `stealth_level: 3` and/or `proxy` |
| CAPTCHA page | Level 3 handles it automatically if `TWOCAPTCHA_API_KEY` is set |

---

## Workflow 2: Structured Data Extraction

**Goal:** Extract specific fields from pages with repeating items (products, listings, tables).

### Step 1: Check for Existing Structured Data

```
scrape({ url: "https://example.com/products", include: ["structured_data"] })
```

Many sites embed JSON-LD, OpenGraph, or Microdata that already contains what you need. If the structured data has the fields → done, no selectors needed.

### Step 2: Use CSS Selectors with Extract

If structured data is insufficient, use `extract` with CSS selectors:

```
extract({
  url: "https://example.com/products",
  items_selector: ".product-card",
  selectors: {
    "name": ".product-title",
    "price": ".price-tag",
    "url": "a @href",
    "image": "img @src",
    "rating": ".stars @data-rating"
  }
})
```

**CSS Selector Patterns:**
- Text content: `.class-name` or `tag.class`
- Attribute: `selector @attribute` (e.g., `a @href`, `img @src`)
- Nested: `.parent .child`
- Specificity: `span.titleline > a` (direct child only)

### Step 3: Verify and Iterate

Review the extracted items:
- Are all fields populated?
- Are values clean (no extra text, correct URLs)?
- Does `items_count` match the visible items on the page?

If selectors are wrong, take a screenshot to visually inspect the page layout:

```
screenshot({ url: "https://example.com/products" })
```

Then refine selectors and re-run `extract`.

### Error Recovery

| Problem | Solution |
|---------|----------|
| Extract returns empty fields | CSS selectors are wrong — take a screenshot to verify page structure |
| Title has domain name appended | Selector is too broad — use more specific selector like `span.titleline > a` |
| URL is relative (e.g., `/page/123`) | This is normal — the system resolves relative URLs to absolute |
| Items count is 0 | Page may be JS-rendered — retry with `stealth_level: 3` |
| Too many items (noise) | Make `items_selector` more specific to target only the desired repeating elements |

---

## Workflow 3: Build a Reusable Skill

**Goal:** Create a saved extraction pattern that can be re-run for fresh data anytime — 30x fewer tokens, 5x faster than re-scraping.

### Why Skills Matter

| Without Skills | With Skills |
|---------------|-------------|
| ~15,000 tokens per extraction | ~500 tokens per extraction |
| 10+ seconds (AI reads full page) | 2 seconds (direct CSS extraction) |
| AI may pick different fields each time | 100% consistent output every time |
| Requires full page in context | Only structured JSON returned |

### Step 1: Auto-Detect Patterns

```
create_skill({
  url: "https://news.ycombinator.com",
  name: "hn-stories",
  description: "Top stories from Hacker News"
})
```

The tool scrapes the page, auto-detects repeating elements, identifies fields (title, url, date, image, summary, author), scores patterns, detects pagination, and saves the skill.

### Step 2: Evaluate the Preview

Review the response carefully:
- **`preview_items`** — Do titles, URLs, and other fields look correct?
- **`alternative_patterns`** — Are there better pattern options with higher item counts?
- **`total_items_on_page`** — Does this match expected item count?

**If preview looks good:** Proceed to Step 4 (verification).

**If preview is wrong (garbled text, wrong URLs, missing fields):** Go to Step 3.

### Step 3: Manual Refinement

Auto-detection works for ~80% of sites. For non-standard HTML (like Hacker News where titles and metadata are in separate table rows), manual refinement is needed:

1. Test better selectors with `extract`:
   ```
   extract({
     url: "https://news.ycombinator.com",
     items_selector: "tr.athing.submission",
     selectors: {
       "title": "span.titleline > a",
       "url": "span.titleline > a @href",
       "site": "span.sitestr"
     }
   })
   ```

2. Once `extract` returns clean data, edit the saved skill file directly at `~/.imperium-crawl/skills/[name].json` to update the `fields` selectors.

3. The skill JSON structure:
   ```json
   {
     "name": "hn-stories",
     "selectors": {
       "items": "tr.athing.submission",
       "fields": {
         "title": "span.titleline > a",
         "url": "span.titleline > a @href",
         "site": "span.sitestr"
       }
     },
     "pagination": { "next": "a[rel='next']", "max_pages": 3 }
   }
   ```

### Step 4: Verify the Skill

```
run_skill({ name: "hn-stories", max_items: 10 })
```

Present results as a table. Confirm all fields are clean and correct. Test pagination by checking if `pages_fetched > 1`.

### Step 5: Educate

After building:
- **Re-run anytime:** `run_skill({ name: "hn-stories" })`
- **Different URL, same structure:** `run_skill({ name: "hn-stories", url: "https://news.ycombinator.com/newest" })`
- **Skills saved at:** `~/.imperium-crawl/skills/`
- **List all skills:** `list_skills()`
- **Overwrite:** Create a new skill with the same name

### Common Skill Patterns

| Site Type | Container Selector | Typical Fields |
|-----------|-------------------|----------------|
| News/blog feed | `article`, `.post` | title, date, author, excerpt, url |
| E-commerce listing | `.product-card`, `.item` | name, price, image, url, rating |
| Job board | `.job-listing`, `.vacancy` | title, company, location, salary, url |
| Directory | `.listing`, `.result` | name, address, phone, website |
| Table data | `table tbody tr` | cell values by position |

### Error Recovery

| Problem | Solution |
|---------|----------|
| Auto-detect finds wrong elements | Use manual selectors with `extract`, then edit skill JSON |
| Preview items have garbled text | Selector is too broad — use more specific CSS path |
| Skill works on page 1 but not page 2 | Pagination selector may be wrong — check `pagination.next` in skill JSON |
| Empty results | Page is JS-rendered — recreate with `stealth_level: 3` on the page |
| Skill name already exists | Creating with same name overwrites the existing skill |

---

## Workflow 4: API Discovery

**Goal:** Discover hidden REST, GraphQL, and WebSocket endpoints that a website uses — then call them directly for 10x faster data access.

### Step 1: Discover Network Traffic

```
discover_apis({ url: "https://weather.com", wait_seconds: 8, include_headers: true })
```

**Tuning `wait_seconds`:**

| Site Type | Recommended | Why |
|-----------|-------------|-----|
| Simple static sites | 5s | Few async calls |
| Standard web apps | 8s (default) | Initial API calls complete |
| Heavy SPAs (React, Angular) | 12-15s | Many async calls after hydration |
| Infinite scroll / lazy load | 15-20s | Scroll-triggered requests need time |

### Step 2: Categorize Endpoints

From the results, classify each endpoint:

**By Origin:**
- **First-party** (same domain) — the interesting data APIs
- **Third-party** (analytics, ads, tracking) — usually noise, filter out

**By Type:**
- **REST API** — GET/POST with JSON responses
- **GraphQL** — POST to `/graphql` with `query` in body
- **WebSocket** — `wss://` connections for real-time data

**By Authentication:**
- **None** — public endpoints, freely accessible
- **Cookie-based** — session cookies sent automatically
- **Bearer token** — `Authorization: Bearer ...` header (often JWT)
- **API key** — custom header or query param

### Step 3: Query Interesting Endpoints

For promising first-party APIs:

```
query_api({ url: "https://api.example.com/v2/products", method: "GET" })
```

For GraphQL, try introspection:

```
query_api({
  url: "https://example.com/graphql",
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{\"query\": \"{ __schema { types { name fields { name } } } }\"}"
})
```

Direct API calls bypass DOM rendering entirely — **10x faster** than scraping HTML.

### Step 4: Monitor WebSockets (if applicable)

```
monitor_websocket({ url: "https://binance.com/en/trade/BTC_USDT", duration_seconds: 15 })
```

Captures real-time data feeds: financial tickers, chat messages, live dashboards. Analyze message format (JSON/binary), types (subscribe, heartbeat, data push), and channel structure.

### Step 5: Compile Report

Present findings as a structured API intelligence report with:
- Total endpoints discovered (first-party vs third-party)
- API inventory table (endpoint, method, auth, response type)
- Detailed analysis of useful endpoints (parameters, pagination, rate limiting)
- WebSocket analysis (if applicable)
- Recommendations for which endpoints to use

### Error Recovery

| Problem | Solution |
|---------|----------|
| No API calls captured | Increase `wait_seconds` to 15-20 — site may load data lazily |
| All requests are third-party | Site loads content server-side — try scraping HTML instead |
| API returns 401/403 | Endpoint requires auth — note the auth type, don't bypass |
| WebSocket connection refused | May require specific cookies/headers from a browser session |
| GraphQL introspection blocked | Analyze the queries captured during page load instead |

---

## Workflow 5: Multi-Source Research

**Goal:** Research a topic by searching, selecting authoritative sources, extracting content, and synthesizing findings.

### Step 1: Formulate Search Queries

Create 2-3 targeted queries from different angles:

- **Primary:** Direct question or topic
- **Comparative:** "X vs Y" or "alternatives to X"
- **Expert:** Add "guide", "analysis", "explained" for in-depth content

### Step 2: Execute Search

```
search({ query: "web scraping best practices 2025", count: 10 })
```

For time-sensitive topics, also run:

```
news_search({ query: "web scraping regulation", freshness: "pm" })
```

**Note:** Search tools require `BRAVE_API_KEY`. If not configured, ask the user for specific URLs instead.

### Step 3: Select Sources

From results, pick 3-5 URLs. Prioritize:
- **Authoritative:** Official docs, established publications, expert blogs
- **Content-rich:** Long-form articles, comprehensive guides
- **Diverse:** Different viewpoints, not just one angle
- **Recent:** Prefer recent over outdated

Avoid: paywall sites, SEO spam, social media posts.

### Step 4: Deep Scrape (Sequential)

For each URL, scrape **one at a time** (prevents rate limiting):

1. Try `readability` first — best for articles
2. If empty/garbage → fallback to `scrape` with `format: "markdown"`
3. For pages with data tables → use `scrape` with `include: ["structured_data"]`

### Step 5: Synthesize Report

Structure findings as:
- **Key Findings** — 3-5 bullet points
- **Detailed Analysis** — organized by angle/subtopic
- **Sources** — cited with URLs and one-line summaries

### Depth Guidelines

| Request Type | Sources | Approach |
|-------------|---------|----------|
| Quick question | 1-2 | Single search, top results |
| Standard research | 3-5 | 2 searches, curated selection |
| Deep dive | 5-8 | 3 searches + news, thorough analysis |

---

## Workflow 6: Site Intelligence

**Goal:** Map, crawl, and analyze a website to produce a comprehensive intelligence report.

### Step 1: Map the Site

```
map({ url: "https://example.com", max_urls: 100, include_sitemap: true })
```

Group URLs by section (`/blog/`, `/products/`, `/docs/`), count pages per section, identify patterns.

### Step 2: Deep-Scrape the Homepage

```
scrape({ url: "https://example.com", include: ["structured_data", "metadata", "links"] })
```

Extract: site identity, technology signals, structured data, navigation structure, external services.

### Step 3: Content Crawl

```
crawl({ url: "https://example.com", max_depth: 2, max_pages: 10 })
```

Assess content types, quality, update frequency, and internal linking patterns.

### Step 4: Visual Capture

```
screenshot({ url: "https://example.com" })
```

### Step 5: Compile Report

Structure as: Overview (type, technology, language) → Site Structure (sections table) → Content Analysis → Technology & Metadata → Scraping Recommendations (best tool, stealth level, rate limiting).

### Depth Guidelines

| Request Type | map max_urls | crawl max_pages | Approach |
|-------------|-------------|-----------------|----------|
| Quick overview | 50 | 5 | Map + homepage scrape + screenshot |
| Standard analysis | 100 | 10 | Full workflow above |
| Deep audit | 200-500 | 20-30 | Extended crawl, multiple screenshots |

---

## Stealth Engine

The 3-level stealth engine **auto-escalates** (Level 1 → 2 → 3), so you usually don't need to specify `stealth_level`.

| Level | Technology | When Used |
|-------|-----------|-----------|
| 1 | Native `fetch()` + realistic headers | Static sites, simple pages |
| 2 | TLS fingerprinting (JA3/JA4) via `impit` | Sites checking TLS signatures |
| 3 | Full Playwright browser + fingerprint injection | SPAs, anti-bot protected sites |

### When to Force Level 3

| Site Type | Recommendation |
|-----------|---------------|
| Simple static sites, blogs | Default — Level 1 works |
| News sites (BBC, CNN) | Default — auto-escalates if needed |
| Anti-bot protected (Cloudflare, DataDome) | Set `stealth_level: 3` to save time |
| JavaScript SPAs (React, Angular, Vue) | Set `stealth_level: 3` — content requires browser rendering |
| E-commerce (Amazon, eBay) | Set `stealth_level: 3` — heavy anti-bot |

### Adaptive Learning

imperium-crawl has a built-in adaptive learning engine that **remembers which stealth level worked for each domain**. After the first visit, subsequent requests to the same domain automatically use the optimal configuration. Features:

- **Per-domain knowledge:** Tracks optimal stealth level, response times, failure rates
- **Time decay:** Recent outcomes weighted higher than old ones
- **Confidence scoring:** Only applies learned knowledge when confidence exceeds threshold
- **Auto-prune:** Stale domain data is automatically cleaned up

You don't need to manage this — it works transparently.

---

## Proxy Usage

If the user provides a proxy URL or asks to use a proxy, pass it via the `proxy` parameter:

```json
{ "url": "https://example.com", "proxy": "socks5://user:pass@proxy:1080" }
```

Supported protocols: `http`, `https`, `socks4`, `socks5`

If `PROXY_URL` or `PROXY_URLS` is set in the environment, the system automatically routes requests through proxies with round-robin rotation. Per-request `proxy` overrides the environment setting.

---

## Global Error Recovery

These apply across all workflows:

| Problem | Solution |
|---------|----------|
| Empty content returned | Retry with `stealth_level: 3` — likely blocked by anti-bot |
| Timeout error | Increase `timeout` to 30000-60000ms |
| CAPTCHA detected | Level 3 handles it automatically if `TWOCAPTCHA_API_KEY` is set |
| 403/429 status | Retry with Level 3 and/or proxy |
| URL blocked by robots.txt | Respect it — try a different URL or set `RESPECT_ROBOTS=false` |
| Search returns no results | Broaden query terms, try simpler keywords |

---

## Best Practices

1. **Sequential, not parallel** — Scrape pages one at a time. Sequential calls prevent rate limiting and reduce errors
2. **Start simple, escalate** — Try `readability` before `scrape`, try `scrape` before `extract`. Use the lightest tool that works
3. **Check structured data first** — Many sites have JSON-LD/OpenGraph that already contains the data you need, no selectors required
4. **Use skills for repeated tasks** — Create a skill once, run it forever. 30x fewer tokens, 5x faster
5. **Use API discovery for dynamic sites** — If a site loads data via JavaScript, discover its APIs and call them directly. 10x faster than HTML scraping
6. **Let stealth auto-escalate** — Only force `stealth_level: 3` on known anti-bot sites. The adaptive learning engine handles the rest
7. **Screenshot for debugging** — When extract returns unexpected results, screenshot the page to see what's actually rendered
8. **Respect robots.txt** — The system checks automatically. Don't bypass unless explicitly asked
9. **Proxy when needed** — Pass `proxy` parameter for geo-restricted content or to avoid IP blocks
10. **Name things descriptively** — Skill names like `hn-top-stories` not `skill1`. Search queries with specific terms, not vague phrases
