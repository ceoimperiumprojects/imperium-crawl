# Tool Reference — All 22 imperium-crawl Tools

Complete catalog with MCP + CLI names, parameters, and gotchas.

**Convention:** MCP uses underscore (`ai_extract`), CLI uses hyphen (`ai-extract`).

**Common optional params** (most scraping/browser tools): `proxy` (string), `chrome_profile` (string, max 1000).

---

## Scraping Tools (6)

### scrape
**MCP:** `mcp__imperium-crawl__scrape` | **CLI:** `imperium-crawl scrape`

Scrape a URL, return Markdown (default), HTML, structured data, links, metadata.

| Param | Type | Default | Required |
|-------|------|---------|----------|
| `url` | string | — | YES |
| `format` | `"markdown"` \| `"html"` | `"markdown"` | no |
| `include` | array of `"markdown"` `"html"` `"structured_data"` `"links"` `"metadata"` | — | no |
| `stealth_level` | number (1-3) | auto | no |
| `timeout` | number (ms) | 30000 | no |
| `proxy` | string | — | no |
| `chrome_profile` | string | — | no |

**Returns:** Markdown/HTML content + optionally structured data, links, metadata.
**CLI:** `--include structured_data,links` (comma-separated, no spaces)

---

### crawl
**MCP:** `mcp__imperium-crawl__crawl` | **CLI:** `imperium-crawl crawl`

Priority-based multi-page crawl. Returns Markdown per page.

| Param | Type | Default | Required |
|-------|------|---------|----------|
| `url` | string | — | YES |
| `max_depth` | number (0-10) | 2 | no |
| `max_pages` | number (1-100) | 10 | no |
| `concurrency` | number (1-10) | 3 | no |
| `proxy` | string | — | no |
| `chrome_profile` | string | — | no |

**Returns:** Array of `{ url, content }` per crawled page.

---

### map
**MCP:** `mcp__imperium-crawl__map` | **CLI:** `imperium-crawl map`

Discover all URLs on a site (sitemap.xml + link crawling).

| Param | Type | Default | Required |
|-------|------|---------|----------|
| `url` | string | — | YES |
| `max_urls` | number (1-10000) | 100 | no |
| `include_sitemap` | boolean | true | no |
| `proxy` | string | — | no |
| `chrome_profile` | string | — | no |

**Returns:** List of discovered URLs grouped by section.
**CLI:** `--include-sitemap` (boolean flag, no value)

---

### extract
**MCP:** `mcp__imperium-crawl__extract` | **CLI:** `imperium-crawl extract`

Extract structured data using CSS selectors. Hybrid cascade: if selectors return empty + `llm_fallback: true`, automatically falls back to AI extraction.

| Param | Type | Default | Required |
|-------|------|---------|----------|
| `url` | string | — | YES |
| `selectors` | object `{ field: "css selector" }` | — | YES |
| `items_selector` | string (container selector) | — | no |
| `llm_fallback` | boolean | false | no |
| `proxy` | string | — | no |
| `chrome_profile` | string | — | no |

**Returns:** Array of extracted items with named fields.
**CLI:** `--selectors '{"name":".title","price":".cost"}'` (JSON string in single quotes)
**Gotcha:** `selectors` accepts JSON string — CLI auto-parses it.

---

### readability
**MCP:** `mcp__imperium-crawl__readability` | **CLI:** `imperium-crawl readability`

Extract main article content using Mozilla Readability algorithm.

| Param | Type | Default | Required |
|-------|------|---------|----------|
| `url` | string | — | YES |
| `format` | `"markdown"` \| `"html"` \| `"text"` | `"markdown"` | no |
| `proxy` | string | — | no |
| `chrome_profile` | string | — | no |

**Returns:** `{ title, author, excerpt, publishedTime, content }`
**Best for:** Articles, blog posts, news. Strips ads/nav/noise.

---

### screenshot
**MCP:** `mcp__imperium-crawl__screenshot` | **CLI:** `imperium-crawl screenshot`

Take a PNG screenshot of a page. Requires Playwright.

| Param | Type | Default | Required |
|-------|------|---------|----------|
| `url` | string | — | YES |
| `full_page` | boolean | true | no |
| `proxy` | string | — | no |
| `chrome_profile` | string | — | no |

**Returns:** Base64 PNG image (MCP image content type).
**CLI:** `--full-page` (boolean flag). Outputs base64 or saves to `--output file.png`.

---

## Search Tools (4) — Require `BRAVE_API_KEY`

### search
**MCP:** `mcp__imperium-crawl__search` | **CLI:** `imperium-crawl search`

Web search via Brave Search API.

| Param | Type | Default | Required |
|-------|------|---------|----------|
| `query` | string (1-400 chars) | — | YES |
| `count` | number (1-20) | 10 | no |
| `country` | string (max 10) | — | no |
| `freshness` | `"pd"` \| `"pw"` \| `"pm"` \| `"py"` | — | no |

**Returns:** Array of `{ title, url, description }`. TTY mode shows table.
**Freshness:** pd=past day, pw=past week, pm=past month, py=past year.

---

### news_search
**MCP:** `mcp__imperium-crawl__news_search` | **CLI:** `imperium-crawl news-search`

News search via Brave Search API.

| Param | Type | Default | Required |
|-------|------|---------|----------|
| `query` | string (1-400 chars) | — | YES |
| `count` | number (1-20) | 10 | no |
| `country` | string (max 10) | — | no |
| `freshness` | `"pd"` \| `"pw"` \| `"pm"` \| `"py"` | — | no |

**Returns:** Array of `{ title, url, description, age }`.

---

### image_search
**MCP:** `mcp__imperium-crawl__image_search` | **CLI:** `imperium-crawl image-search`

Image search via Brave Search API.

| Param | Type | Default | Required |
|-------|------|---------|----------|
| `query` | string (1-400 chars) | — | YES |
| `count` | number (1-20) | 10 | no |
| `country` | string (max 10) | — | no |

**Returns:** Array of `{ title, url, thumbnail, source }`.

---

### video_search
**MCP:** `mcp__imperium-crawl__video_search` | **CLI:** `imperium-crawl video-search`

Video search via Brave Search API.

| Param | Type | Default | Required |
|-------|------|---------|----------|
| `query` | string (1-400 chars) | — | YES |
| `count` | number (1-20) | 10 | no |
| `country` | string (max 10) | — | no |
| `freshness` | `"pd"` \| `"pw"` \| `"pm"` \| `"py"` | — | no |

**Returns:** Array of `{ title, url, description, age, creator }`.

---

## Skill Tools (3)

### create_skill
**MCP:** `mcp__imperium-crawl__create_skill` | **CLI:** `imperium-crawl create-skill`

Analyze a page, auto-detect extraction patterns, save as reusable skill.

| Param | Type | Default | Required |
|-------|------|---------|----------|
| `url` | string | — | YES |
| `name` | string (regex: `^[a-zA-Z0-9_-]+$`) | — | YES |
| `description` | string (1-1000 chars) | — | YES |
| `max_pages` | number (1-100) | 3 | no |

**Returns:** Skill config with `preview_items`, `fields_detected`, `alternative_patterns`.
**Storage:** `~/.imperium-crawl/skills/{name}.json`
**Gotcha:** Same name overwrites existing skill.

---

### run_skill
**MCP:** `mcp__imperium-crawl__run_skill` | **CLI:** `imperium-crawl run-skill`

Execute a saved skill or built-in recipe.

| Param | Type | Default | Required |
|-------|------|---------|----------|
| `name` | string (regex: `^[a-zA-Z0-9_-]+$`) | — | YES |
| `url` | string | skill's saved URL | no |
| `max_items` | number (1-500) | 50 | no |
| `proxy` | string | — | no |
| `chrome_profile` | string | — | no |
| `duration_seconds` | number (1-300) | — | no |
| `max_messages` | number (1-1000) | — | no |

**Returns:** Extracted items array.
**Note:** `duration_seconds` and `max_messages` only apply to WebSocket-based skills.

---

### list_skills
**MCP:** `mcp__imperium-crawl__list_skills` | **CLI:** `imperium-crawl list-skills`

List all saved skills and built-in recipes.

| Param | Type | Default | Required |
|-------|------|---------|----------|
| *(none)* | — | — | — |

**Returns:** Table of skills with name, description, tool, source (custom/built-in).

---

## API Discovery Tools (3)

### discover_apis
**MCP:** `mcp__imperium-crawl__discover_apis` | **CLI:** `imperium-crawl discover-apis`

Navigate to page and capture all API calls (XHR/fetch). Requires Playwright.

| Param | Type | Default | Required |
|-------|------|---------|----------|
| `url` | string | — | YES |
| `wait_seconds` | number (0-60) | 5 | no |
| `timeout` | number (ms) | 30000 | no |
| `include_headers` | boolean | false | no |
| `filter_content_type` | string (max 200) | — | no |
| `proxy` | string | — | no |
| `chrome_profile` | string | — | no |

**Returns:** Array of `{ url, method, status, content_type, size, headers? }`.
**Tip:** Use `wait_seconds: 10-20` for SPAs that load data lazily. `include_headers: true` for auth analysis.

---

### query_api
**MCP:** `mcp__imperium-crawl__query_api` | **CLI:** `imperium-crawl query-api`

Direct HTTP request to an API endpoint. Ideal after `discover_apis`.

| Param | Type | Default | Required |
|-------|------|---------|----------|
| `url` | string | — | YES |
| `method` | `"GET"` \| `"POST"` \| `"PUT"` \| `"PATCH"` \| `"DELETE"` | `"GET"` | no |
| `headers` | object `{ key: value }` | — | no |
| `body` | string (max 50000) | — | no |
| `params` | object `{ key: value }` | — | no |
| `timeout` | number (ms) | 30000 | no |
| `stealth_headers` | boolean | true | no |
| `proxy` | string | — | no |

**Returns:** `{ status, headers, body, content_type }`.
**CLI:** `--method POST --body '{"query":"..."}' --headers '{"Authorization":"Bearer token"}'`

---

### monitor_websocket
**MCP:** `mcp__imperium-crawl__monitor_websocket` | **CLI:** `imperium-crawl monitor-websocket`

Monitor WebSocket traffic on a page. Requires Playwright.

| Param | Type | Default | Required |
|-------|------|---------|----------|
| `url` | string | — | YES |
| `duration_seconds` | number (1-300) | 10 | no |
| `timeout` | number (ms) | 30000 | no |
| `max_messages` | number (1-1000) | 100 | no |
| `filter_url` | string | — | no |
| `proxy` | string | — | no |
| `chrome_profile` | string | — | no |

**Returns:** Array of `{ url, direction, data, timestamp }`.
**Tip:** Use `filter_url` to focus on specific WebSocket connections.

---

## AI Extraction (1) — Requires `LLM_API_KEY`

### ai_extract
**MCP:** `mcp__imperium-crawl__ai_extract` | **CLI:** `imperium-crawl ai-extract`

AI/LLM-powered structured data extraction.

| Param | Type | Default | Required |
|-------|------|---------|----------|
| `url` | string | — | YES |
| `schema` | string \| object \| `"auto"` | — | YES |
| `format` | `"json"` \| `"csv"` | `"json"` | no |
| `max_tokens` | number (100-8000) | 2000 | no |
| `proxy` | string | — | no |
| `chrome_profile` | string | — | no |

**Schema modes:**
- **String:** Natural language — `"extract all products with name, price, rating"`
- **Object:** JSON schema — `{ "products": [{ "name": "string", "price": "number" }] }`
- **"auto":** LLM decides what to extract (magic mode)

**Returns:** Extracted structured data matching schema.
**CLI:** `--schema "extract product names and prices"` or `--schema '{"items":[...]}'`

---

## Interaction (1)

### interact
**MCP:** `mcp__imperium-crawl__interact` | **CLI:** `imperium-crawl interact`

Browser automation with action sequences and session persistence. Requires Playwright.

| Param | Type | Default | Required |
|-------|------|---------|----------|
| `url` | string | — | YES |
| `actions` | array of ActionSchema (max 50) | — | YES |
| `return_content` | boolean | true | no |
| `return_screenshot` | boolean | false | no |
| `session_id` | string (max 200) | — | no |
| `timeout` | number (ms, 1000-max) | 30000 | no |
| `proxy` | string | — | no |
| `chrome_profile` | string | — | no |

**ActionSchema fields:**

| Field | Type | Used by |
|-------|------|---------|
| `type` | `"click"` `"type"` `"scroll"` `"wait"` `"screenshot"` `"evaluate"` `"select"` `"hover"` `"press"` `"navigate"` | ALL |
| `selector` | string (CSS) | click, type, select, hover |
| `text` | string | type |
| `value` | string | select |
| `script` | string (JS) | evaluate |
| `key` | string | press (e.g., "Enter", "Tab") |
| `url` | string | navigate |
| `duration` | number (ms) | wait |
| `x`, `y` | number | scroll |

**Returns:** `{ url, actions_executed, session_saved, content?, screenshot?, screenshots[], action_results[] }`
**Session:** Cookies saved per `session_id` to `~/.imperium-crawl/sessions/{id}.json`. Restored on next call with same ID.

---

## Batch Processing (4)

### batch_scrape
**MCP:** `mcp__imperium-crawl__batch_scrape` | **CLI:** `imperium-crawl batch-scrape`

Parallel scraping of multiple URLs with optional AI extraction and resume support.

| Param | Type | Default | Required |
|-------|------|---------|----------|
| `urls` | array of strings (1-500) | — | YES |
| `extraction_schema` | string \| object \| `"auto"` | — | no |
| `return_content` | boolean | false | no |
| `concurrency` | number (1-10) | 3 | no |
| `timeout` | number (ms) | 30000 | no |
| `job_id` | string (max 200) | auto-generated | no |
| `proxy` | string | — | no |

**Returns:** `{ job_id, status, total, completed, failed, results[] }`
**Resume:** Pass same `job_id` — already completed URLs are skipped.
**CLI:** `--urls "https://a.com,https://b.com"` (comma-separated)

---

### list_jobs
**MCP:** `mcp__imperium-crawl__list_jobs` | **CLI:** `imperium-crawl list-jobs`

List all batch scrape jobs with status and progress.

| Param | Type | Default | Required |
|-------|------|---------|----------|
| *(none)* | — | — | — |

**Returns:** Table of jobs with id, status, total, completed, failed, created.

---

### job_status
**MCP:** `mcp__imperium-crawl__job_status` | **CLI:** `imperium-crawl job-status`

Get full status and results for a specific batch job.

| Param | Type | Default | Required |
|-------|------|---------|----------|
| `job_id` | string (max 200) | — | YES |

**Returns:** Full job details with all results.

---

### delete_job
**MCP:** `mcp__imperium-crawl__delete_job` | **CLI:** `imperium-crawl delete-job`

Delete a batch job and all saved results.

| Param | Type | Default | Required |
|-------|------|---------|----------|
| `job_id` | string (max 200) | — | YES |

**Returns:** Confirmation message.
