# Site Intel — Comprehensive Website Analysis

Map, crawl, and analyze a website to produce a site intelligence report.

> **Full tool reference:** See [tool-reference.md](tool-reference.md) for all parameters.

---

## Mode Detection

| Mode | Tool format | Param format |
|------|-------------|--------------|
| **MCP** | `mcp__imperium-crawl__map` | snake_case JSON |
| **CLI** | `imperium-crawl map --url URL` | --kebab-case flags |

---

## Available Tools — Dual Mode

| Action | MCP Tool | CLI Command | Key Params |
|--------|----------|-------------|------------|
| Discover URLs | `mcp__imperium-crawl__map` | `imperium-crawl map --url URL` | `max_urls`, `include_sitemap` |
| Multi-page crawl | `mcp__imperium-crawl__crawl` | `imperium-crawl crawl --url URL` | `max_depth`, `max_pages`, `concurrency` |
| Deep page analysis | `mcp__imperium-crawl__scrape` | `imperium-crawl scrape --url URL` | `include`, `stealth_level` |
| Visual capture | `mcp__imperium-crawl__screenshot` | `imperium-crawl screenshot --url URL` | `full_page` |
| Batch harvest | `mcp__imperium-crawl__batch_scrape` | `imperium-crawl batch-scrape --urls "..."` | `urls`, `concurrency`, `return_content` |
| API discovery | `mcp__imperium-crawl__discover_apis` | `imperium-crawl discover-apis --url URL` | `wait_seconds`, `include_headers` |
| CSS extract | `mcp__imperium-crawl__extract` | `imperium-crawl extract --url URL --selectors '{}'` | `selectors`, `items_selector` |

---

## Workflow

### Step 1: Site Mapping

Discover the site structure first.

**MCP:** `{ "url": "...", "max_urls": 100, "include_sitemap": true }`
**CLI:** `imperium-crawl map --url "URL" --max-urls 100 --include-sitemap`

Analyze the URL list:
- **Group by section:** `/blog/`, `/products/`, `/docs/`, `/api/`
- **Count URLs per section** — understand site focus
- **Identify patterns:** Pagination, date archives, category hierarchies
- **Note endpoints:** `/api/`, `/feed/`, `/sitemap.xml`, `/robots.txt`

### Step 2: Homepage Deep-Dive

Scrape homepage for identity and tech signals.

**MCP:** `{ "url": "...", "include": ["structured_data", "metadata", "links"] }`
**CLI:** `imperium-crawl scrape --url "URL" --include structured_data,metadata,links`

Extract: site identity, tech stack (Next.js, WordPress, Shopify), structured data (JSON-LD), navigation structure, external services.

### Step 3: Content Crawl

Sample the site content.

**MCP:** `{ "url": "...", "max_depth": 2, "max_pages": 10, "concurrency": 3 }`
**CLI:** `imperium-crawl crawl --url "URL" --max-depth 2 --max-pages 10`

Analyze: content types, quality, update frequency, content patterns, internal linking.

### Step 4: Visual Capture

Screenshot the homepage.

**MCP:** `{ "url": "...", "full_page": false }`
**CLI:** `imperium-crawl screenshot --url "URL"`

### Step 5: Compile Report

```markdown
## Site Intelligence: [Site Name] ([domain])

### Overview
- **Type:** [E-commerce / Blog / SaaS / News / Documentation]
- **Technology:** [Detected framework, CMS]
- **Language:** [Primary language(s)]
- **Organization:** [Company/person]

### Site Structure
- **Total URLs discovered:** [N]
- **Key sections:**
  | Section | URL Pattern | Est. Pages | Content Type |
  |---------|-------------|------------|--------------|
  | Blog | `/blog/*` | ~150 | Articles |

### Content Analysis
- **Content depth:** [Thin / Medium / Rich]
- **Update frequency:** [Daily / Weekly / Monthly / Stale]
- **Media:** [Text-only / Image-heavy / Video]

### Technology & Metadata
- **Framework/CMS:** [Detected]
- **Structured data:** [JSON-LD types, OpenGraph]
- **SEO signals:** [Meta descriptions, canonical, sitemap quality]

### Scraping Recommendations
- **Best approach:** [readability / extract / ai_extract / API-first]
- **Anti-bot protection:** [None / Cloudflare / etc.]
- **Recommended stealth level:** [1 / 2 / 3]
- **robots.txt notes:** [Key rules]

### Visual Reference
[Screenshot]
```

---

## Bonus Steps (for deeper analysis)

### Batch Harvest (for site-wide data)

After mapping, batch scrape key sections:

**MCP:** `{ "urls": ["url1", "url2", ...], "concurrency": 5, "return_content": true }`
**CLI:** `imperium-crawl batch-scrape --urls "url1,url2,url3" --concurrency 5 --return-content`

Then check results: `job_status(job_id)` / `imperium-crawl job-status --job-id "ID"`

### API Discovery (for SPA sites)

If the site is JS-heavy, check for hidden APIs:

**MCP:** `{ "url": "...", "wait_seconds": 10, "include_headers": true }`
**CLI:** `imperium-crawl discover-apis --url "URL" --wait-seconds 10 --include-headers`

Add discovered APIs to the report's Technology section.

### SEO Extract (per page)

Extract SEO data from individual pages:

**MCP:** `{ "url": "...", "selectors": {"title": "title", "h1": "h1", "meta_desc": "meta[name=description]@content"} }`
**CLI:** `imperium-crawl extract --url "URL" --selectors '{"title":"title","h1":"h1","meta_desc":"meta[name=description]@content"}'`

---

## Tool Combinations

### map → batch_scrape (Site Harvest)
```
map(url, max_urls: 200) → discover URLs
  → batch_scrape(urls, concurrency: 5) → parallel fetch all pages
    → job_status(job_id) → get results
```

### crawl → extract (Site Audit)
```
crawl(url, max_depth: 2) → get page content
  → extract(url, selectors: SEO fields) per page → structured audit data
```

### discover_apis (SPA Bonus)
```
discover_apis(url, wait_seconds: 10) → find hidden JSON endpoints
  → query_api(endpoint) → direct data access (10x faster)
```

---

## Depth Guidelines

| Request type | map max_urls | crawl max_pages | Approach |
|-------------|-------------|-----------------|----------|
| Quick overview | 50 | 5 | Map + homepage scrape + screenshot |
| Standard analysis | 100 | 10 | Full workflow above |
| Deep audit | 200-500 | 20-30 | Extended crawl, multiple screenshots, section-by-section + batch_scrape |

---

## CLI Gotchas

- **Boolean flags:** `--include-sitemap` not `--include-sitemap true`
- **Include:** `--include structured_data,metadata,links` (comma-separated)
- **Output:** `--output-format json` for structured output, `--pretty` for human-readable
- **Batch URLs:** `--urls "url1,url2,url3"` (comma-separated in quotes)

---

## Error Recovery

| Problem | Solution |
|---------|----------|
| Map returns few URLs | Site blocks crawlers — use `stealth_level: 3`; check `/sitemap.xml` directly |
| Crawl blocked after few pages | Reduce `max_pages`, use Level 3, add proxy |
| Homepage is SPA (empty content) | `stealth_level: 3` for browser rendering |
| No structured data | Common — rely on HTML metadata and content analysis |
| Screenshot fails | Retry with `stealth_level: 3` |

---

## Important Notes

- Start with mapping — big picture before details
- Don't over-crawl — 10-20 pages gives a solid sample
- Large sites (>10k pages) — focus on key sections
- Always mention anti-bot protections in report
- If user wants to scrape after analysis, recommend best tool + approach from findings
