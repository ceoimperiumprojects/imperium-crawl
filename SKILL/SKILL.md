# imperium-crawl — Agent Skill Guide

Comprehensive guide for AI agents using imperium-crawl's 22 MCP tools. Covers scraping, extraction, research, API discovery, skill building, and batch processing — in both MCP and CLI modes.

> **Supporting files in this folder:**
> - [`tool-reference.md`](tool-reference.md) — All 22 tools with full parameters, return values, and gotchas
> - [`pipelines.md`](pipelines.md) — 9 reusable pipeline patterns with dual-mode examples
> - [`recipes.md`](recipes.md) — 10 built-in recipes + custom skill JSON format

---

## Table of Contents

1. [Mode Detection](#mode-detection)
2. [All Tools — Dual Mode Reference](#all-tools--dual-mode-reference)
3. [Smart Scrape](#1-smart-scrape--intelligent-page-content-extraction)
4. [Build Skill](#2-build-skill--create-reusable-scraping-patterns)
5. [Site Intel](#3-site-intel--comprehensive-website-analysis)
6. [Research](#4-research--multi-source-topic-investigation)
7. [API Recon](#5-api-recon--api-discovery-and-network-analysis)
8. [Tool Combinations](#tool-combinations--9-core-patterns)
9. [CLI Gotchas](#cli-gotchas)
10. [Error Recovery](#error-recovery)

---

## Mode Detection

Detect your execution environment and use the correct invocation format:

| Mode | How to detect | Tool format | Param format |
|------|--------------|-------------|--------------|
| **MCP** | You have `mcp__imperium-crawl__*` tools | `mcp__imperium-crawl__scrape` | snake_case JSON: `{ url: "...", stealth_level: 3 }` |
| **CLI** | User says "CLI", "command line", or no MCP tools available | `imperium-crawl scrape --url URL` | --kebab-case flags: `--stealth-level 3` |

**Naming convention:**
- MCP tool names: underscore → `create_skill`, `ai_extract`, `discover_apis`
- CLI commands: hyphen → `create-skill`, `ai-extract`, `discover-apis`

---

## All Tools — Dual Mode Reference

See [`tool-reference.md`](tool-reference.md) for full parameter details per tool.

| Action | MCP Tool | CLI Command | Key Params |
|--------|----------|-------------|------------|
| Scrape page | `mcp__imperium-crawl__scrape` | `imperium-crawl scrape --url URL` | `include`, `stealth_level`, `format` |
| Crawl site | `mcp__imperium-crawl__crawl` | `imperium-crawl crawl --url URL` | `max_depth`, `max_pages`, `concurrency` |
| Map URLs | `mcp__imperium-crawl__map` | `imperium-crawl map --url URL` | `max_urls`, `include_sitemap` |
| CSS extract | `mcp__imperium-crawl__extract` | `imperium-crawl extract --url URL --selectors '{}'` | `selectors`, `items_selector`, `llm_fallback` |
| Clean article | `mcp__imperium-crawl__readability` | `imperium-crawl readability --url URL` | `format` |
| Screenshot | `mcp__imperium-crawl__screenshot` | `imperium-crawl screenshot --url URL` | `full_page` |
| Web search | `mcp__imperium-crawl__search` | `imperium-crawl search --query "..."` | `query`, `count`, `freshness` |
| News search | `mcp__imperium-crawl__news_search` | `imperium-crawl news-search --query "..."` | `query`, `count`, `freshness` |
| Image search | `mcp__imperium-crawl__image_search` | `imperium-crawl image-search --query "..."` | `query`, `count` |
| Video search | `mcp__imperium-crawl__video_search` | `imperium-crawl video-search --query "..."` | `query`, `count`, `freshness` |
| AI extract | `mcp__imperium-crawl__ai_extract` | `imperium-crawl ai-extract --url URL --schema "..."` | `schema` (string/object/"auto"), `format` |
| Create skill | `mcp__imperium-crawl__create_skill` | `imperium-crawl create-skill --url URL --name NAME --description "..."` | `url`, `name`, `description` |
| Run skill | `mcp__imperium-crawl__run_skill` | `imperium-crawl run-skill --name NAME` | `name`, `url` (override), `max_items` |
| List skills | `mcp__imperium-crawl__list_skills` | `imperium-crawl list-skills` | *(none)* |
| Discover APIs | `mcp__imperium-crawl__discover_apis` | `imperium-crawl discover-apis --url URL` | `wait_seconds`, `include_headers` |
| Query API | `mcp__imperium-crawl__query_api` | `imperium-crawl query-api --url URL` | `method`, `headers`, `body`, `params` |
| Monitor WS | `mcp__imperium-crawl__monitor_websocket` | `imperium-crawl monitor-websocket --url URL` | `duration_seconds`, `max_messages` |
| Interact | `mcp__imperium-crawl__interact` | `imperium-crawl interact --url URL --actions '[...]'` | `actions`, `session_id`, `return_screenshot` |
| Batch scrape | `mcp__imperium-crawl__batch_scrape` | `imperium-crawl batch-scrape --urls "url1,url2"` | `urls`, `extraction_schema`, `concurrency` |
| List jobs | `mcp__imperium-crawl__list_jobs` | `imperium-crawl list-jobs` | *(none)* |
| Job status | `mcp__imperium-crawl__job_status` | `imperium-crawl job-status --job-id ID` | `job_id` |
| Delete job | `mcp__imperium-crawl__delete_job` | `imperium-crawl delete-job --job-id ID` | `job_id` |

---

## Master Decision Tree

```
User has a web data task
│
├─ "Read this article / get the text"
│  └─ readability → if fails → scrape (markdown)
│
├─ "Scrape this page / get content"
│  └─ scrape (markdown + metadata) → offer extract if structured needed
│
├─ "Extract specific data (products, prices, listings)"
│  ├─ Know CSS selectors? → extract (fast, deterministic)
│  │  └─ Empty results? → enable llm_fallback: true
│  └─ Don't know structure? → ai_extract with "auto" or natural language
│
├─ "Create a reusable scraper / build a skill"
│  └─ inspect → extract/ai_extract → create_skill → run_skill → verify
│
├─ "Analyze this website / site audit"
│  └─ map → scrape homepage → crawl → screenshot → compile report
│
├─ "Research a topic / find information"
│  └─ search (+ news_search) → select sources → readability → synthesize
│
├─ "Find APIs / reverse engineer"
│  └─ discover_apis → categorize → query_api → monitor_websocket
│
├─ "Page behind login"
│  └─ interact (session_id) → login → then scrape/extract
│     └─ Or use chrome_profile for existing browser session
│
├─ "Suspect hidden API (SPA, dynamic)"
│  └─ discover_apis → query_api (10x faster than HTML scraping)
│
├─ "Bulk URLs (10+)"
│  └─ batch_scrape (parallel, resumable, soft-fail)
│
└─ "Full site harvest"
   └─ map → batch_scrape (parallel fetch)
```

---

# 1. Smart Scrape — Intelligent Page Content Extraction

*Use when: "scrape a website", "get content from URL", "read this article", "grab the text", "get product info"*

### Decision Tree

| User intent | Tool path |
|-------------|-----------|
| Read article / get text | `readability` → if empty → `scrape` (markdown) |
| Get product info / extract prices | `scrape` (structured_data) → `extract` (CSS) → `llm_fallback` if empty |
| Unknown page structure | `ai_extract` (schema: "auto") |
| General scrape | `scrape` (markdown + metadata + links) |
| Visual capture | `screenshot` (full_page) |

### Stealth Escalation

| Situation | Action |
|-----------|--------|
| Simple static site | Default (auto-escalation handles it) |
| Known anti-bot (Cloudflare, Amazon, LinkedIn) | `stealth_level: 3` directly |
| JavaScript SPA (React, Angular, Vue) | `stealth_level: 3` (needs browser) |
| Empty/blocked results | `stealth_level: 3` + `proxy` |

### Tool Chains

- **readability → scrape** escalation: `readability(url)` → if garbage → `scrape(url, format: "markdown")`
- **extract + llm_fallback**: CSS first, LLM if empty — best of both worlds
- **ai_extract → extract**: AI discovers structure → CSS for fast repeat runs
- **screenshot debug loop**: `screenshot` → `extract` → empty? → `screenshot` → refine selectors

---

# 2. Build Skill — Create Reusable Scraping Patterns

*Use when: "create a scraper", "build an extractor", "make a skill", "save this pattern", "automate this scraping"*

### Workflow — 6 Steps

**Step 1: Gather Requirements** — What data? Single/multiple pages? Login needed? One-time or recurring?

**Step 2: Page Inspection**
- MCP: `scrape` with `include: ["structured_data", "links", "metadata"]`
- CLI: `imperium-crawl scrape --url URL --include structured_data,links,metadata`
- Decision: structured_data present? → use it. Repeating elements? → CSS extract. JS-heavy? → discover_apis. Unknown? → ai_extract "auto"

**Step 3: Pattern Detection**
- **Option A — CSS** (fastest): `extract` with `selectors` + `items_selector`
- **Option B — AI** (unknown structure): `ai_extract` with `schema: "auto"` or natural language
- **Option C — Hybrid**: `extract` with `llm_fallback: true`

**Step 4: Create Skill**
- MCP: `create_skill` with `url`, `name`, `description`
- CLI: `imperium-crawl create-skill --url URL --name "my-skill" --description "What it extracts"`
- Names: alphanumeric + hyphens/underscores only

**Step 5: Verify — MANDATORY**
- Run `run_skill` with the skill name. Test on a DIFFERENT page if possible.
- Bad results? → Back to Step 3, refine, recreate (same name overwrites).
- **Rule: NEVER declare a skill finished without `run_skill` verification!**

**Step 6: Educate User** — How to run, override URL, limit items, where stored (`~/.imperium-crawl/skills/`)

### Common Selector Patterns

| Site Type | items_selector | Typical Fields |
|-----------|---------------|----------------|
| E-commerce | `.product-card`, `.item`, `[data-product]` | name, price, image, url, rating |
| News/Blog | `article`, `.post`, `.story` | title, date, author, excerpt, url |
| Job Board | `.job-listing`, `.vacancy` | title, company, location, salary, url |
| Directory | `.listing`, `.result` | name, address, phone, website, category |
| Table Data | `table tbody tr` | cell values by `td:nth-child(N)` |

### Built-in Recipes

Check before creating custom skills — see [`recipes.md`](recipes.md) for full details:

| Recipe | Tool | What it does |
|--------|------|-------------|
| `hn-top-stories` | extract | Hacker News front page |
| `github-trending` | extract | GitHub trending repos |
| `job-listings-greenhouse` | extract | Greenhouse ATS boards |
| `ecommerce-product` | ai_extract | Product details (AI) |
| `product-reviews` | ai_extract | Reviews with sentiment |
| `crypto-websocket` | monitor_websocket | Binance BTC/USDT trades |
| `news-article-reader` | readability | Clean article text |
| `reddit-posts` | scrape | Reddit JSON API |
| `seo-page-audit` | extract | SEO meta + structured data |
| `social-media-mentions` | ai_extract | Social media + sentiment |

Run: `run_skill(name: "recipe-name")` / `imperium-crawl run-skill --name "recipe-name"`

---

# 3. Site Intel — Comprehensive Website Analysis

*Use when: "analyze this website", "map this site", "site audit", "what is this website about"*

### Workflow

**Step 1: Site Mapping** — `map(url, max_urls: 100, include_sitemap: true)` → group URLs by section

**Step 2: Homepage Deep-Dive** — `scrape(url, include: [structured_data, metadata, links])` → identity, tech stack, navigation

**Step 3: Content Crawl** — `crawl(url, max_depth: 2, max_pages: 10)` → content types, quality, frequency

**Step 4: Visual Capture** — `screenshot(url)` → design, layout, above-the-fold

**Step 5: Compile Report** — Overview, Site Structure (table), Content Analysis, Technology, Scraping Recommendations, Visual Reference

### Depth Guidelines

| Request | map max_urls | crawl max_pages |
|---------|-------------|-----------------|
| Quick overview | 50 | 5 |
| Standard analysis | 100 | 10 |
| Deep audit | 200-500 | 20-30 |

### Bonus Steps

- **Batch harvest**: `map` → `batch_scrape(urls, concurrency: 5)` → full site data
- **API discovery**: `discover_apis(url, wait_seconds: 10)` → find hidden JSON endpoints
- **SEO extract**: `extract(url, selectors: {title, h1, meta_desc})` per page

---

# 4. Research — Multi-Source Topic Investigation

*Use when: "research a topic", "find information about X", "deep dive into Z", "gather intel"*

### Workflow

**Step 1: Decompose** — Core question, angles, recency needs, depth

**Step 2: Formulate queries** — 2-3 targeted queries (primary, comparative, expert)

**Step 3: Search** — `search(query, count: 10)` + optionally `news_search(query, freshness: "pw")`

Freshness: `pd` (day), `pw` (week), `pm` (month), `py` (year). Requires `BRAVE_API_KEY`.

**Step 4: Select sources** — 3-5 URLs. Prioritize: authoritative, content-rich, diverse, recent.

**Step 5: Deep scrape** — `readability` first → fallback `scrape` (markdown). Or `batch_scrape` for 5+ sources.

**Step 6: Synthesize report** — Key Findings, Detailed Analysis per angle, Sources with summaries

### Depth Guidelines

| Request | Sources | Approach |
|---------|---------|----------|
| Quick | 1-2 | Single search, top results |
| Standard | 3-5 | 2 searches, curated |
| Deep dive | 5-8 | 3 searches + news |
| Competitive | 4-6 per competitor | Targeted per entity |

### Tool Chains

- **search → readability** — standard research
- **news_search → batch_scrape** — bulk news collection
- **search + news_search** — multi-source (evergreen + recent)
- **search → ai_extract** — structured extraction per source

---

# 5. API Recon — API Discovery and Network Analysis

*Use when: "find APIs on a website", "discover hidden endpoints", "reverse engineer an API", "monitor WebSocket"*

### Workflow

**Step 1: Discovery** — `discover_apis(url, wait_seconds: 8, include_headers: true)`

| Site type | wait_seconds |
|-----------|-------------|
| Simple static | 5 |
| Standard web app | 8 |
| Heavy SPA | 12-15 |
| Infinite scroll | 15-20 |

**Step 2: Categorize** — By type (REST/GraphQL/WebSocket), origin (first/third-party), auth (none/cookie/bearer/API key/CSRF)

**Step 3: Investigate** — `query_api` for GET endpoints, GraphQL introspection, pagination testing. Only safe operations unless user asks.

**Step 4: WebSocket** — `monitor_websocket(url, duration: 15-60)` → message format, types, channels, auth

**Step 5: Report** — Summary, API Inventory table, Detailed Endpoint Analysis, WebSocket Analysis, Recommendations

### Tool Chains

- **discover → query → monitor** — full recon chain
- **interact (login) → discover** — authenticated API recon
- **websocket → query_api** — REST fallback (easier to automate than WS)

---

## Tool Combinations — 9 Core Patterns

See [`pipelines.md`](pipelines.md) for full dual-mode examples.

### 1. Inspect → Extract → Skill (Standard Path)
**When:** Known page with repeating elements
```
scrape(include: structured_data) → extract(selectors) → create_skill → run_skill (verify)
```

### 2. AI Auto-Discover → Skill (Unknown Structure)
**When:** Unknown page, let LLM figure it out
```
ai_extract(schema: "auto") → create_skill → run_skill (verify)
```

### 3. API-First → Query (Bypass HTML, 10x Faster)
**When:** SPA, trading platforms, hidden JSON APIs
```
discover_apis(wait: 10) → query_api(endpoint) → create_skill (optional)
```

### 4. Login → Session → Extract (Authenticated)
**When:** Content behind login wall
```
interact(login actions, session_id) → scrape/extract(protected page)
```
Alternative: `chrome_profile` param for existing browser cookies.

### 5. Search → Batch → AI Extract (Research Pipeline)
**When:** Research, competitor analysis, bulk collection
```
search(query) → batch_scrape(urls, extraction_schema) → job_status
```

### 6. Map → Batch (Full Site Harvest)
**When:** Site audit, content migration, full backup
```
map(max_urls: 200) → batch_scrape(urls, concurrency: 5)
```

### 7. WebSocket → API Reverse Engineering
**When:** Trading, chat, live dashboards
```
monitor_websocket(duration: 30) → discover_apis → query_api (REST fallback)
```

### 8. Screenshot → Debug → Refine (Visual Feedback)
**When:** Selectors not working
```
screenshot → extract(selectors) → [empty?] → screenshot → refine → extract
```

### 9. Skill Iteration Loop (Feedback)
**When:** ALWAYS — every skill needs validation
```
create_skill → run_skill → [bad?] → extract (manual) → create_skill (overwrite) → run_skill
```

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
--output-format json|csv|jsonl|markdown
--pretty          # human-readable JSON
--output file.json # write to file
```

**Pipe-safe:** Spinner → stderr, data → stdout:
```bash
imperium-crawl scrape --url URL --output-format json | jq '.title'
```

**Include:** `--include structured_data,links,metadata` (comma-separated, no spaces)

**Actions JSON:**
```bash
imperium-crawl interact --url URL --actions '[{"type":"click","selector":"button"},{"type":"wait","duration":2000}]'
```

**Batch URLs:** `--urls "url1,url2,url3"` (comma-separated in quotes)

**Freshness:** `--freshness pd` (pd=day, pw=week, pm=month, py=year)

---

## Error Recovery

| Error | Cause | Fix |
|-------|-------|-----|
| Empty content | JS-rendered or blocked | `stealth_level: 3` or `llm_fallback: true` |
| 403/Blocked | Anti-bot protection | `stealth_level: 3` + `proxy` |
| Timeout | Slow page / heavy JS | Increase `timeout`; try `readability` |
| Readability garbage | Non-article page | Fallback to `scrape` (markdown) |
| CAPTCHA | Bot detection | Auto-solved if `TWOCAPTCHA_API_KEY` set + Level 3 |
| Login required | Protected content | `interact` with session_id, or `chrome_profile` |
| Skill works, run_skill fails | Selectors changed | Re-inspect, recreate skill |
| `LLM_API_KEY` missing | ai_extract needs it | Run `imperium-crawl setup` |
| `BRAVE_API_KEY` missing | Search tools need it | Run `imperium-crawl setup` |
| CLI JSON parse error | Bad JSON | Validate JSON, single quotes, escape inner quotes |
| Batch job stalled | Network issues | Resume with same `job_id` (completed URLs skipped) |
| No APIs captured | Site needs interaction | Increase `wait_seconds` to 15-20 |
| All third-party APIs | Server-side rendering | Try HTML scraping instead |
| WebSocket refused | Needs auth cookies | `interact` login first, or `chrome_profile` |

---

## Environment Variables

| Variable | Required for | Purpose |
|----------|-------------|---------|
| `BRAVE_API_KEY` | search, news/image/video search | Brave Search API |
| `LLM_API_KEY` | ai_extract, llm_fallback, batch extraction | Anthropic or OpenAI |
| `LLM_PROVIDER` | — | `anthropic` (default), `openai`, `minimax` |
| `TWOCAPTCHA_API_KEY` | Auto CAPTCHA solving | 2Captcha API |
| `PROXY_URL` | — | Single proxy URL |
| `PROXY_URLS` | — | Comma-separated proxy rotation |
| `CHROME_PROFILE_PATH` | — | Chrome user data dir for authenticated sessions |
| `RESPECT_ROBOTS` | — | Honor robots.txt (default: `true`) |

Quick setup: `imperium-crawl setup` (interactive wizard)
