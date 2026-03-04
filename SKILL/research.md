# Research — Multi-Source Topic Investigation

Search, select authoritative sources, extract key info, synthesize a structured report.

> **Full tool reference:** See [tool-reference.md](tool-reference.md) for all parameters.

---

## Mode Detection

| Mode | Tool format | Param format |
|------|-------------|--------------|
| **MCP** | `mcp__imperium-crawl__search` | snake_case JSON |
| **CLI** | `imperium-crawl search --query "..."` | --kebab-case flags |

---

## Available Tools — Dual Mode

| Action | MCP Tool | CLI Command | Key Params |
|--------|----------|-------------|------------|
| Web search | `mcp__imperium-crawl__search` | `imperium-crawl search --query "..."` | `query`, `count`, `freshness` |
| News search | `mcp__imperium-crawl__news_search` | `imperium-crawl news-search --query "..."` | `query`, `count`, `freshness` |
| Clean article | `mcp__imperium-crawl__readability` | `imperium-crawl readability --url URL` | `format` |
| General scrape | `mcp__imperium-crawl__scrape` | `imperium-crawl scrape --url URL` | `format`, `include`, `stealth_level` |
| Batch scrape | `mcp__imperium-crawl__batch_scrape` | `imperium-crawl batch-scrape --urls "..."` | `urls`, `concurrency`, `extraction_schema` |
| AI extract | `mcp__imperium-crawl__ai_extract` | `imperium-crawl ai-extract --url URL --schema "..."` | `schema`, `format` |

---

## Workflow

### Step 1: Understand the Research Question

Decompose the request:
- Core question
- Angles to explore (technical, business, historical, comparative)
- Is recency important? (news vs evergreen)
- Depth needed (quick overview vs deep dive)

### Step 2: Formulate Search Queries

Create 2-3 targeted queries from different angles:
- **Primary:** Direct question or topic
- **Comparative:** "X vs Y" or "alternatives to X"
- **Expert:** Add "guide", "analysis", "explained"

### Step 3: Execute Search

**MCP:** `{ "query": "topic query", "count": 10 }`
**CLI:** `imperium-crawl search --query "topic query" --count 10`

**For time-sensitive topics:** Also run news search:

**MCP:** `{ "query": "topic", "count": 10, "freshness": "pw" }`
**CLI:** `imperium-crawl news-search --query "topic" --count 10 --freshness pw`

**Freshness values:** `pd` (past day), `pw` (past week), `pm` (past month), `py` (past year)

**If `BRAVE_API_KEY` not configured:** Ask user for specific URLs or suggest `imperium-crawl setup`.

### Step 4: Source Selection

Select 3-5 URLs to deep-scrape. Prioritize:
- Authoritative (official docs, established publications, expert blogs)
- Content-rich (long-form, comprehensive)
- Diverse perspectives
- Recent over outdated

Avoid: paywalls, SEO spam, duplicate content, social media posts.

### Step 5: Deep Scrape Sources

For each URL, scrape sequentially:

1. Try `readability` first (best for articles)
2. If empty → fallback to `scrape` with `format: "markdown"`
3. For data tables → `scrape` with `include: ["structured_data"]`

**MCP:** `{ "url": "...", "format": "markdown" }`
**CLI:** `imperium-crawl readability --url "URL"`

Note per source: key facts, data points, expert opinions, contradictions.

### Bulk Research Alternative (5+ sources)

For bulk research, use batch_scrape instead of sequential scraping:

**MCP:** `{ "urls": ["url1", "url2", "url3", "url4", "url5"], "return_content": true, "concurrency": 3 }`
**CLI:** `imperium-crawl batch-scrape --urls "url1,url2,url3,url4,url5" --return-content --concurrency 3`

With AI extraction for structured summaries:
**MCP:** `{ "urls": [...], "extraction_schema": "extract key findings, facts, statistics, and conclusions" }`
**CLI:** `imperium-crawl batch-scrape --urls "..." --extraction-schema "extract key findings, facts, statistics, and conclusions"`

### Step 6: Synthesize Report

```markdown
## Research: [Topic]

### Key Findings
- [3-5 bullet points with most important discoveries]

### Detailed Analysis

#### [Angle 1 — e.g., "Technical Overview"]
[Synthesized content from multiple sources]

#### [Angle 2 — e.g., "Current Trends"]
[Cross-referenced information]

#### [Angle 3 — e.g., "Best Practices"]
[Actionable insights]

### Sources
1. [Title](URL) — [one-line summary]
2. [Title](URL) — [one-line summary]
```

---

## Tool Combinations

### search → readability (Standard Research)
```
search(query, count: 10) → get URLs
  → readability(url) per source → clean article text
    → synthesize findings
```

### news_search → batch_scrape (Bulk News)
```
news_search(query, freshness: "pd") → today's news URLs
  → batch_scrape(urls, return_content: true) → parallel fetch all articles
    → job_status(job_id) → get all content at once
```

### search + news_search (Multi-Source)
```
search(query) → evergreen content
  + news_search(query, freshness: "pw") → recent coverage
    → combine best sources from both → deep scrape
```

### search → ai_extract (Structured Research)
```
search(query) → find sources
  → ai_extract(url, schema: "extract key claims, evidence, and conclusions") → structured per source
    → compare structured findings across sources
```

---

## Research Depth Guidelines

| Request type | Sources | Approach |
|-------------|---------|----------|
| Quick question | 1-2 | Single search, top results |
| Standard research | 3-5 | 2 searches, curated selection |
| Deep dive | 5-8 | 3 searches + news, thorough analysis |
| Competitive analysis | 4-6 per competitor | Targeted searches per entity |

---

## CLI Gotchas

- **Query:** `--query "multi word query"` (quotes for multi-word)
- **Freshness:** `--freshness pd` (pd/pw/pm/py)
- **Count:** `--count 10` (1-20)
- **Output:** `--output-format json` for structured, `--pretty` for readable
- **Batch URLs:** `--urls "url1,url2,url3"` (comma-separated in quotes)

---

## Error Recovery

| Problem | Solution |
|---------|----------|
| Search returns no results | Broaden query, remove quotes, simpler keywords |
| Sources paywalled | Use different search terms, look for cached versions |
| Content outdated | Add year to query, use `news_search` with freshness |
| Source blocked | Retry with `stealth_level: 3` |
| Conflicting information | Note contradiction, cite both, present stronger evidence |
| `BRAVE_API_KEY` not set | Required for search tools; run `imperium-crawl setup` |

---

## Important Notes

- Always cite sources — never present scraped content without attribution
- Distinguish facts (from sources) from your synthesis/interpretation
- Controversial topics → present multiple perspectives fairly
- Legal/medical/financial → add disclaimer (web research, not professional advice)
- Scrape sources sequentially unless using batch_scrape — prevent rate limiting
