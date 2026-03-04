---
name: build-skill
description: "Creates reusable scraping skills and extraction patterns. Use when user asks to 'create a scraper', 'build an extractor', 'make a skill', 'save this pattern', 'set up automated extraction', 'create a reusable recipe', or 'automate this scraping'. Supports both MCP and CLI modes."
argument-hint: "[url] [skill-name]"
---

# Build Skill — Create Reusable Scraping Patterns

Create, test, and iterate reusable extraction skills that work across pages with similar structure.

> **Reference files** (read when you need detail):
> - `tool-reference.md` — All 22 tools with params, returns, gotchas
> - `pipelines.md` — 9 pipeline patterns with dual-mode examples
> - `recipes.md` — 10 built-in recipes + custom skill JSON format

---

## Mode Detection

Detect your execution environment and use the correct tool invocation format:

| Mode | How to detect | Tool format | Param format |
|------|--------------|-------------|--------------|
| **MCP** | You have `mcp__imperium-crawl__*` tools | `mcp__imperium-crawl__scrape` | snake_case JSON: `{ url: "...", stealth_level: 3 }` |
| **CLI** | User says "CLI", "command line", or no MCP tools available | `imperium-crawl scrape --url URL` | --kebab-case flags: `--stealth-level 3` |

**Naming convention:**
- MCP tool names: underscore → `create_skill`, `ai_extract`, `discover_apis`
- CLI commands: hyphen → `create-skill`, `ai-extract`, `discover-apis`

---

## Available Tools — Dual Mode

| Action | MCP Tool | CLI Command | Key Params |
|--------|----------|-------------|------------|
| Inspect page | `mcp__imperium-crawl__scrape` | `imperium-crawl scrape --url URL` | `include`, `stealth_level`, `format` |
| Visual inspect | `mcp__imperium-crawl__screenshot` | `imperium-crawl screenshot --url URL` | `full_page` |
| CSS extract | `mcp__imperium-crawl__extract` | `imperium-crawl extract --url URL --selectors '{}'` | `selectors`, `items_selector`, `llm_fallback` |
| AI extract | `mcp__imperium-crawl__ai_extract` | `imperium-crawl ai-extract --url URL --schema "..."` | `schema` (string/object/"auto"), `format` |
| Create skill | `mcp__imperium-crawl__create_skill` | `imperium-crawl create-skill --url URL --name NAME --description "..."` | `url`, `name`, `description`, `max_pages` |
| Run skill | `mcp__imperium-crawl__run_skill` | `imperium-crawl run-skill --name NAME` | `name`, `url` (override), `max_items` |
| List skills | `mcp__imperium-crawl__list_skills` | `imperium-crawl list-skills` | *(none)* |
| Clean article | `mcp__imperium-crawl__readability` | `imperium-crawl readability --url URL` | `format` |
| Discover APIs | `mcp__imperium-crawl__discover_apis` | `imperium-crawl discover-apis --url URL` | `wait_seconds`, `include_headers` |
| Query API | `mcp__imperium-crawl__query_api` | `imperium-crawl query-api --url URL` | `method`, `headers`, `body`, `params` |
| Batch scrape | `mcp__imperium-crawl__batch_scrape` | `imperium-crawl batch-scrape --urls "url1,url2"` | `urls`, `extraction_schema`, `concurrency` |
| Site map | `mcp__imperium-crawl__map` | `imperium-crawl map --url URL` | `max_urls`, `include_sitemap` |
| Interact | `mcp__imperium-crawl__interact` | `imperium-crawl interact --url URL --actions '[...]'` | `actions`, `session_id`, `return_screenshot` |
| Monitor WS | `mcp__imperium-crawl__monitor_websocket` | `imperium-crawl monitor-websocket --url URL` | `duration_seconds`, `max_messages` |

---

## Decision Tree

When the user wants to extract data from a website, follow this tree:

```
User wants data from a site
│
├─ Know the CSS selectors?
│  └─ YES → extract (fast, deterministic)
│     └─ Empty results? → enable llm_fallback: true (hybrid cascade)
│
├─ Don't know the page structure?
│  └─ ai_extract with schema: "auto" (LLM discovers what's there)
│     └─ Good results? → create_skill to save the pattern
│
├─ Need recurring extraction?
│  └─ create_skill → run_skill → verify → iterate
│     └─ Check built-in recipes first! (list_skills shows them)
│
├─ Page behind login/auth?
│  └─ interact (session_id) → login → then scrape/extract
│     └─ Or use chrome_profile for existing browser session
│
├─ Suspect hidden API? (SPA, dynamic content)
│  └─ discover_apis → query_api (10x faster than HTML scraping)
│     └─ Save API endpoint as a skill for reuse
│
├─ Bulk URLs (10+)?
│  └─ batch_scrape (parallel, resumable, soft-fail)
│     └─ With extraction_schema for structured output
│
└─ Full site harvest?
   └─ map (discover URLs) → batch_scrape (parallel fetch)
```

---

## Tool Combinations — The Core Patterns

**These are the most important patterns.** Learn when and how to chain tools.

### Combo 1: Inspect → Extract → Skill (Standard Path)
**When:** Known page with repeating elements (product listing, job board, news feed)
```
scrape(url, include: ["structured_data", "links"]) → understand page structure
  → extract(url, selectors: {...}, items_selector: "...") → test selectors
    → create_skill(url, name, description) → save pattern
      → run_skill(name, url: different_page) → verify on another page
```

MCP example:
```json
// Step 1: Inspect
{ "url": "https://example.com/products", "include": ["structured_data", "links"] }
// Step 2: Extract
{ "url": "https://example.com/products", "selectors": {"name": ".product-title", "price": ".price"}, "items_selector": ".product-card" }
// Step 3: Create skill
{ "url": "https://example.com/products", "name": "example-products", "description": "Extract product listings" }
// Step 4: Verify
{ "name": "example-products", "url": "https://example.com/products?page=2" }
```

CLI example:
```bash
imperium-crawl scrape --url "https://example.com/products" --include structured_data,links
imperium-crawl extract --url "https://example.com/products" --selectors '{"name":".product-title","price":".price"}' --items-selector ".product-card"
imperium-crawl create-skill --url "https://example.com/products" --name "example-products" --description "Extract product listings"
imperium-crawl run-skill --name "example-products" --url "https://example.com/products?page=2"
```

### Combo 2: AI Auto-Discover → Skill (Unknown Structure)
**When:** Unknown page structure, let LLM figure it out
```
ai_extract(url, schema: "auto") → LLM discovers what data exists
  → create_skill(url, name, description) → save discovered pattern
    → run_skill(name, url: different_page) → test on another page
```

### Combo 3: API-First → Query (Bypass HTML, 10x Faster)
**When:** SPA sites, trading platforms, any site with hidden JSON APIs
```
discover_apis(url, wait_seconds: 10) → find JSON endpoints
  → query_api(endpoint_url, method, headers) → direct data access
    → create_skill(url: api_endpoint, name, description) → save as skill
```

### Combo 4: Login → Session → Extract (Authenticated)
**When:** Content behind login wall
```
interact(url: login_page, actions: [type username, type password, click submit], session_id: "my-session")
  → scrape/extract(url: protected_page) → access protected content
    → create_skill(url, name, description) → save for reuse
```
**Alternative:** Use `chrome_profile` param to leverage existing browser cookies.

### Combo 5: Search → Batch → AI Extract (Research Pipeline)
**When:** Research, competitor analysis, bulk data collection
```
search(query) → get relevant URLs
  → batch_scrape(urls, extraction_schema: "extract names, prices...") → parallel scrape + extract
    → job_status(job_id) → check progress and get results
```

### Combo 6: Map → Batch (Full Site Harvest)
**When:** Site audit, content migration, full site backup
```
map(url, max_urls: 200, include_sitemap: true) → discover all URLs
  → batch_scrape(urls, concurrency: 5) → harvest entire site
```

### Combo 7: WebSocket → API Reverse Engineering
**When:** Trading platforms, chat apps, live dashboards
```
monitor_websocket(url, duration_seconds: 30) → capture real-time messages
  → discover_apis(url) → find REST fallback endpoints
    → query_api(rest_endpoint) → test REST access to same data
```

### Combo 8: Screenshot → Debug → Refine (Visual Feedback Loop)
**When:** Selectors not working, need visual debugging
```
screenshot(url) → visualize the page
  → extract(url, selectors) → test selectors
    → [if empty] screenshot(url) → check what's wrong visually
      → extract(url, refined_selectors) → fix and retry
```

### Combo 9: Skill Iteration Loop (Feedback)
**When:** ALWAYS — every skill must pass validation before it's "done"
```
create_skill(url, name, description) → first draft
  → run_skill(name) → test it
    → [bad results?] extract(url, manual_selectors) → test manually
      → create_skill(url, same_name, description) → overwrite with better selectors
        → run_skill(name) → verify again
```
**Rule:** NEVER declare a skill finished without `run_skill` verification!

---

## Workflow — 6 Steps

### Step 1: Gather Requirements
- What data does the user need? (product names, prices, articles, etc.)
- Is it a single page or multiple pages with same structure?
- Does the page require login?
- How often will they run this? (one-time vs recurring)

### Step 2: Page Inspection
**Goal:** Understand the page structure before building anything.

MCP: `mcp__imperium-crawl__scrape` with `include: ["structured_data", "links", "metadata"]`
CLI: `imperium-crawl scrape --url URL --include structured_data,links,metadata`

**Decision point:**
- Has structured_data (JSON-LD, microdata)? → Extract directly from it
- Has repeating HTML elements? → CSS selectors with `extract`
- Dynamic/JS-heavy? → Try `discover_apis` first (Combo 3)
- Complex/unknown? → Use `ai_extract` with "auto" (Combo 2)

### Step 3: Pattern Detection
Try the fastest approach first:

**Option A — CSS Selectors (fastest, most reliable):**
MCP: `mcp__imperium-crawl__extract` with `selectors` + `items_selector`
CLI: `imperium-crawl extract --url URL --selectors '{"title":"h2.name","price":".price"}' --items-selector ".product-card"`

**Option B — AI Extraction (when structure is unknown):**
MCP: `mcp__imperium-crawl__ai_extract` with `schema: "auto"` or natural language
CLI: `imperium-crawl ai-extract --url URL --schema "extract all products with name, price, rating"`

**Option C — Hybrid (CSS first, LLM fallback):**
MCP: `mcp__imperium-crawl__extract` with `llm_fallback: true`
CLI: `imperium-crawl extract --url URL --selectors '...' --llm-fallback`

### Step 4: Create Skill
MCP: `mcp__imperium-crawl__create_skill` with `url`, `name`, `description`
CLI: `imperium-crawl create-skill --url URL --name "my-skill" --description "What it extracts"`

Skill names: alphanumeric + hyphens/underscores only (`^[a-zA-Z0-9_-]+$`)

### Step 5: Verify — MANDATORY
MCP: `mcp__imperium-crawl__run_skill` with the skill name
CLI: `imperium-crawl run-skill --name "my-skill"`

Test on a DIFFERENT page with same structure if possible:
```
run_skill(name: "my-skill", url: "https://example.com/products?page=2")
```

**If results are bad:** Go back to Step 3, refine selectors, re-create skill (same name overwrites).

### Step 6: Educate User
Tell the user:
- How to run their skill: `run_skill` (MCP) or `imperium-crawl run-skill --name NAME` (CLI)
- How to override URL: pass `url` param
- How to limit items: pass `max_items` param
- Where skills are stored: `~/.imperium-crawl/skills/`
- Check `list_skills` / `imperium-crawl list-skills` to see all saved + built-in recipes

---

## Common Selector Patterns

| Site Type | items_selector | Typical Fields |
|-----------|---------------|----------------|
| E-commerce | `.product-card`, `.item`, `[data-product]` | name, price, image, url, rating |
| News/Blog | `article`, `.post`, `.story` | title, date, author, excerpt, url |
| Job Board | `.job-listing`, `.vacancy`, `.position` | title, company, location, salary, url |
| Directory | `.listing`, `.result`, `.business` | name, address, phone, website, category |
| Table Data | `table tbody tr` | cell values by `td:nth-child(N)` |
| Social Feed | `.post`, `.tweet`, `.card` | author, content, timestamp, likes, shares |

---

## CLI Gotchas

**Boolean flags** — no value needed:
```bash
imperium-crawl screenshot --url URL --full-page     # correct
imperium-crawl screenshot --url URL --full-page true # wrong
```

**JSON params** — single quotes around JSON:
```bash
imperium-crawl extract --url URL --selectors '{"title":"h1","price":".cost"}'
```

**Output formats:**
```bash
imperium-crawl scrape --url URL --output-format json    # JSON (default)
imperium-crawl scrape --url URL --output-format csv     # CSV
imperium-crawl scrape --url URL --output-format jsonl   # JSON Lines
imperium-crawl scrape --url URL --output-format markdown # Markdown
```

**Pretty print:** `--pretty` for human-readable JSON output

**File output:** `--output results.json` writes to file instead of stdout

**Pipe-safe:** Spinner writes to stderr, data to stdout — safe for piping:
```bash
imperium-crawl scrape --url URL --output-format json | jq '.title'
```

**Actions JSON for interact:**
```bash
imperium-crawl interact --url URL --actions '[{"type":"click","selector":"button.submit"},{"type":"wait","duration":2000}]'
```

---

## Error Recovery

| Error | Cause | Fix |
|-------|-------|-----|
| Empty extraction results | Wrong selectors or JS-rendered content | Try `stealth_level: 3` or `llm_fallback: true` |
| 403/Blocked | Anti-bot protection | Use `stealth_level: 3` or `proxy` |
| Timeout | Slow page or heavy JS | Increase `timeout`, try `readability` instead |
| Skill creates but run_skill fails | Selectors changed or page structure differs | Re-inspect page, recreate skill |
| `LLM_API_KEY` not set | ai_extract requires it | Run `imperium-crawl setup` or set env var |
| `BRAVE_API_KEY` not set | Search tools require it | Run `imperium-crawl setup` or set env var |
| CLI JSON parse error | Bad JSON in --selectors or --actions | Validate JSON, use single quotes, escape inner quotes |
| Batch job stalled | Network issues | Resume with same `job_id` — completed URLs are skipped |

---

## Built-in Recipes

Before creating a custom skill, check if a built-in recipe already does what the user needs:

| Recipe | Tool | What it does |
|--------|------|-------------|
| `hn-top-stories` | extract | Hacker News front page stories |
| `github-trending` | extract | GitHub trending repositories |
| `job-listings-greenhouse` | extract | Greenhouse ATS job boards |
| `ecommerce-product` | ai_extract | E-commerce product details (AI) |
| `product-reviews` | ai_extract | Product reviews with sentiment |
| `crypto-websocket` | monitor_websocket | Binance BTC/USDT live trades |
| `news-article-reader` | readability | Clean article extraction |
| `reddit-posts` | scrape | Reddit JSON API posts |
| `seo-page-audit` | extract | SEO meta + structured data |
| `social-media-mentions` | ai_extract | Social media with sentiment |

Run any recipe: `run_skill(name: "recipe-name")` or `imperium-crawl run-skill --name "recipe-name"`

See all: `list_skills` or `imperium-crawl list-skills`

---

## Pipeline Quick Reference

See `pipelines.md` for full details. Top patterns:

1. **Search → Scrape → AI Extract** — research pipeline
2. **Map → Batch Scrape** — full site harvest
3. **Discover APIs → Query API** — bypass HTML rendering (10x faster)
4. **Create Skill → Run Skill → Verify → Iterate** — skill building loop
5. **Interact (login) → Scrape** — authenticated content
6. **Monitor WebSocket → Query API** — real-time reverse engineering
7. **Crawl → Extract** — site audit
8. **News Search → Readability** — news digest
9. **AI Extract auto → Create Skill** — discovery → automation
