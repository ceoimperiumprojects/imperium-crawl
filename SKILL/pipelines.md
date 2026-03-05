# Pipeline Patterns — 10 Reusable Workflows

Each pipeline shows the tool chain, when to use it, and examples in both MCP and CLI modes.

---

## Pipeline 1: Search → Scrape → AI Extract (Research)

**When:** Research a topic, gather data from multiple sources.

```
search(query) → get URLs
  → readability(url) per source → clean article text
    → ai_extract(url, schema) → structured findings (optional)
```

**MCP:**
```json
// 1. Search
{ "query": "best project management tools 2024", "count": 10 }
// 2. Read top results
{ "url": "https://example.com/article", "format": "markdown" }
// 3. Extract structured data (optional)
{ "url": "https://example.com/comparison", "schema": "extract tool names, pricing, key features, rating" }
```

**CLI:**
```bash
imperium-crawl search --query "best project management tools 2024" --count 10
imperium-crawl readability --url "https://example.com/article"
imperium-crawl ai-extract --url "https://example.com/comparison" --schema "extract tool names, pricing, key features"
```

---

## Pipeline 2: Map → Batch Scrape (Site Harvest)

**When:** Full site backup, content migration, site audit.

```
map(url, max_urls: 200) → discover all URLs
  → batch_scrape(urls, concurrency: 5) → parallel fetch
    → job_status(job_id) → get results
```

**MCP:**
```json
// 1. Discover URLs
{ "url": "https://blog.example.com", "max_urls": 200, "include_sitemap": true }
// 2. Batch scrape (use URLs from step 1)
{ "urls": ["https://blog.example.com/post-1", "..."], "concurrency": 5, "return_content": true }
// 3. Check results
{ "job_id": "abc123" }
```

**CLI:**
```bash
imperium-crawl map --url "https://blog.example.com" --max-urls 200 --include-sitemap
imperium-crawl batch-scrape --urls "url1,url2,url3" --concurrency 5 --return-content
imperium-crawl job-status --job-id "abc123"
```

---

## Pipeline 3: Discover APIs → Query API (Bypass Rendering)

**When:** SPA sites, trading platforms, data dashboards. 10x faster than HTML scraping.

```
discover_apis(url, wait_seconds: 10) → find JSON endpoints
  → query_api(endpoint, method, headers) → direct data access
    → create_skill(url: endpoint) → save for reuse (optional)
```

**MCP:**
```json
// 1. Discover
{ "url": "https://dashboard.example.com", "wait_seconds": 10, "include_headers": true }
// 2. Query found endpoint
{ "url": "https://api.example.com/data?page=1", "method": "GET", "headers": {"Accept": "application/json"} }
// 3. Save as skill (optional)
{ "url": "https://api.example.com/data", "name": "example-api", "description": "Direct API data access" }
```

**CLI:**
```bash
imperium-crawl discover-apis --url "https://dashboard.example.com" --wait-seconds 10 --include-headers
imperium-crawl query-api --url "https://api.example.com/data?page=1" --method GET
imperium-crawl create-skill --url "https://api.example.com/data" --name "example-api" --description "Direct API access"
```

---

## Pipeline 4: Create Skill → Run → Verify → Iterate (Skill Loop)

**When:** Building any reusable extraction pattern. ALWAYS use this loop.

```
create_skill(url, name, description) → first draft
  → run_skill(name) → test
    → [bad?] extract(url, manual_selectors) → debug
      → create_skill(same name) → overwrite
        → run_skill(name) → verify again
```

**MCP:**
```json
// 1. Create
{ "url": "https://jobs.example.com", "name": "example-jobs", "description": "Extract job listings" }
// 2. Test
{ "name": "example-jobs" }
// 3. Debug (if needed)
{ "url": "https://jobs.example.com", "selectors": {"title": "h3.job-title", "company": ".company"}, "items_selector": ".job-card" }
// 4. Recreate with better config
{ "url": "https://jobs.example.com", "name": "example-jobs", "description": "Extract job listings - refined" }
// 5. Verify
{ "name": "example-jobs", "url": "https://jobs.example.com/page/2" }
```

**Rule:** Never ship a skill without running it at least once!

---

## Pipeline 5: Interact (Login) → Scrape (Authenticated)

**When:** Content behind login wall, member-only data.

```
interact(login_url, actions: [type user, type pass, click submit], session_id) → save cookies
  → scrape/extract(protected_url) → access authenticated content
    → create_skill(url, name) → save for reuse (optional)
```

**MCP:**
```json
// 1. Login
{
  "url": "https://example.com/login",
  "session_id": "my-account",
  "actions": [
    { "type": "type", "selector": "#email", "text": "user@example.com" },
    { "type": "type", "selector": "#password", "text": "password123" },
    { "type": "click", "selector": "button[type=submit]" },
    { "type": "wait", "duration": 3000 }
  ]
}
// 2. Scrape protected content (cookies auto-restored via session_id)
{ "url": "https://example.com/dashboard" }
```

**CLI:**
```bash
imperium-crawl interact --url "https://example.com/login" --session-id "my-account" --actions '[{"type":"type","selector":"#email","text":"user@example.com"},{"type":"type","selector":"#password","text":"password123"},{"type":"click","selector":"button[type=submit]"},{"type":"wait","duration":3000}]'
imperium-crawl scrape --url "https://example.com/dashboard"
```

**Alternative:** `--chrome-profile /path/to/chrome/profile` to use existing browser session.

---

## Pipeline 6: Monitor WebSocket → Query API (Real-Time Reverse Engineering)

**When:** Trading platforms, chat apps, live dashboards, streaming data.

```
monitor_websocket(url, duration: 30) → capture messages
  → discover_apis(url) → find REST fallback endpoints
    → query_api(rest_endpoint) → test REST access
```

**MCP:**
```json
// 1. Monitor WebSocket
{ "url": "https://trading.example.com", "duration_seconds": 30, "max_messages": 200 }
// 2. Also check REST endpoints
{ "url": "https://trading.example.com", "wait_seconds": 15, "include_headers": true }
// 3. Query REST endpoint
{ "url": "https://api.example.com/ticker?symbol=BTC", "method": "GET" }
```

**CLI:**
```bash
imperium-crawl monitor-websocket --url "https://trading.example.com" --duration-seconds 30 --max-messages 200
imperium-crawl discover-apis --url "https://trading.example.com" --wait-seconds 15 --include-headers
imperium-crawl query-api --url "https://api.example.com/ticker?symbol=BTC"
```

---

## Pipeline 7: Crawl → Extract (Site Audit)

**When:** Content quality audit, SEO review, data consistency check.

```
crawl(url, max_depth: 2, max_pages: 20) → get all page content
  → extract(url, selectors: SEO fields) per page → structured audit data
    → screenshot(url) for key pages → visual documentation
```

**MCP:**
```json
// 1. Crawl
{ "url": "https://example.com", "max_depth": 2, "max_pages": 20, "concurrency": 3 }
// 2. Extract SEO data from each page
{ "url": "https://example.com/about", "selectors": {"title": "title", "h1": "h1", "meta_desc": "meta[name=description]@content"} }
// 3. Screenshot key pages
{ "url": "https://example.com", "full_page": true }
```

**CLI:**
```bash
imperium-crawl crawl --url "https://example.com" --max-depth 2 --max-pages 20
imperium-crawl extract --url "https://example.com/about" --selectors '{"title":"title","h1":"h1","meta_desc":"meta[name=description]@content"}'
imperium-crawl screenshot --url "https://example.com" --full-page
```

---

## Pipeline 8: News Search → Readability (News Digest)

**When:** News monitoring, media analysis, press roundup.

```
news_search(query, freshness: "pd") → today's news
  → readability(url) per article → clean text
    → ai_extract(url, schema: "summarize key points") → structured digest (optional)
```

**MCP:**
```json
// 1. Search news
{ "query": "AI regulation", "count": 10, "freshness": "pd" }
// 2. Read articles
{ "url": "https://news.example.com/article", "format": "markdown" }
// 3. AI summary (optional)
{ "url": "https://news.example.com/article", "schema": "extract headline, key points, quotes, sentiment" }
```

**CLI:**
```bash
imperium-crawl news-search --query "AI regulation" --count 10 --freshness pd
imperium-crawl readability --url "https://news.example.com/article"
imperium-crawl ai-extract --url "https://news.example.com/article" --schema "extract headline, key points, quotes, sentiment"
```

---

## Pipeline 9: AI Extract Auto → Create Skill (Discovery → Automation)

**When:** Unknown page, want to discover what data exists and automate extraction.

```
ai_extract(url, schema: "auto") → LLM discovers data
  → [review output] → create_skill(url, name) → save pattern
    → run_skill(name, url: different_page) → verify generalization
```

**MCP:**
```json
// 1. Auto-discover
{ "url": "https://example.com/products", "schema": "auto" }
// 2. Create skill based on discoveries
{ "url": "https://example.com/products", "name": "example-products", "description": "Products with name, price, image, rating" }
// 3. Test on another page
{ "name": "example-products", "url": "https://example.com/products?page=2" }
```

**CLI:**
```bash
imperium-crawl ai-extract --url "https://example.com/products" --schema auto
imperium-crawl create-skill --url "https://example.com/products" --name "example-products" --description "Products with name, price, image, rating"
imperium-crawl run-skill --name "example-products" --url "https://example.com/products?page=2"
```

---

## Pipeline 10: Snapshot → Interact (Ref Targeting)

**When:** Need precise element targeting without fragile CSS selectors. Forms, complex UIs, dynamic content.

```
snapshot(url) → analyze ARIA tree with refs
  → interact(url, actions: [{type: "click", ref: "N"}]) → target by ref
    → snapshot(url) → verify result
```

**MCP:**
```json
// 1. Get page snapshot with ARIA refs
{ "url": "https://example.com/form", "return_screenshot": true }
// 2. Use ref from snapshot to interact (e.g., ref="7" is the Submit button)
{
  "url": "https://example.com/form",
  "actions": [
    { "type": "type", "ref": "3", "text": "John Doe" },
    { "type": "type", "ref": "5", "text": "john@example.com" },
    { "type": "click", "ref": "7" },
    { "type": "wait", "duration": 2000 }
  ],
  "return_snapshot": true
}
// 3. Verify — check the returned snapshot for success state
```

**CLI:**
```bash
imperium-crawl snapshot --url "https://example.com/form" --return-screenshot
imperium-crawl interact --url "https://example.com/form" --actions '[{"type":"type","ref":"3","text":"John Doe"},{"type":"click","ref":"7"}]' --return-snapshot
imperium-crawl snapshot --url "https://example.com/form"
```

**Why refs > selectors:** ARIA refs are stable across page re-renders, don't break with CSS class changes, and work on elements without unique selectors.
