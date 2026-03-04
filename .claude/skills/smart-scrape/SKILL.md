---
name: smart-scrape
description: "This skill should be used when the user asks to 'scrape a website', 'get content from a URL', 'extract data from a page', 'read this article', 'grab the text', 'get product info', 'pull data from this site', or 'fetch page content'. Supports both MCP and CLI modes."
---

# Smart Scrape — Intelligent Page Content Extraction

Extract the right content from any URL using the optimal tool and settings.

> **Full tool reference:** See `../build-skill/tool-reference.md` for all parameters and gotchas.

---

## Mode Detection

| Mode | Tool format | Param format |
|------|-------------|--------------|
| **MCP** | `mcp__imperium-crawl__scrape` | snake_case JSON: `{ stealth_level: 3 }` |
| **CLI** | `imperium-crawl scrape --url URL` | --kebab-case flags: `--stealth-level 3` |

---

## Available Tools — Dual Mode

| Action | MCP Tool | CLI Command | When to use |
|--------|----------|-------------|-------------|
| Clean article | `mcp__imperium-crawl__readability` | `imperium-crawl readability --url URL` | Articles, blogs, news |
| General scrape | `mcp__imperium-crawl__scrape` | `imperium-crawl scrape --url URL` | General pages, product pages |
| CSS extract | `mcp__imperium-crawl__extract` | `imperium-crawl extract --url URL --selectors '{}'` | Structured data with known selectors |
| AI extract | `mcp__imperium-crawl__ai_extract` | `imperium-crawl ai-extract --url URL --schema "..."` | Unknown structure, let LLM figure it out |
| Visual capture | `mcp__imperium-crawl__screenshot` | `imperium-crawl screenshot --url URL` | Visual inspection, debugging |

---

## Decision Tree

### Step 1: Classify User Intent

- **"Read this article" / "get the text"** → Article path
- **"Get product info" / "extract prices"** → Structured data path
- **"Scrape this page" / general request** → General scrape path
- **"Show me what it looks like"** → Visual path
- **"I don't know what's on the page"** → AI auto-discover path

### Step 2: Execute

#### Article Path (readability first)

1. Call `readability` with the URL
2. If good content (title present, text > 200 chars) → present it
3. If empty/garbage → fallback to `scrape` with `format: "markdown"`, `include: ["metadata"]`

**MCP:** `{ "url": "...", "format": "markdown" }`
**CLI:** `imperium-crawl readability --url "URL"`

#### Structured Data Path

1. Inspect: `scrape` with `include: ["structured_data"]` — check JSON-LD, OpenGraph
2. If structured data has what user needs → present directly
3. If not → `extract` with CSS selectors tailored to content
4. If selectors return empty → enable `llm_fallback: true` (hybrid cascade)
5. If you don't know selectors → use `ai_extract` with natural language or `"auto"`

**MCP:** `{ "url": "...", "selectors": {"name": ".title", "price": ".cost"}, "items_selector": ".product", "llm_fallback": true }`
**CLI:** `imperium-crawl extract --url "URL" --selectors '{"name":".title","price":".cost"}' --items-selector ".product" --llm-fallback`

#### AI Auto-Discover Path (NEW)

When you don't know the page structure at all:

1. Call `ai_extract` with `schema: "auto"` — LLM discovers what data exists
2. Or use natural language: `schema: "extract all products with name, price, and rating"`
3. Review results — if good, present them

**MCP:** `{ "url": "...", "schema": "auto" }`
**CLI:** `imperium-crawl ai-extract --url "URL" --schema auto`

**Requires:** `LLM_API_KEY` env var. If not set, suggest `imperium-crawl setup`.

#### General Scrape Path

1. Call `scrape` with `format: "markdown"`, `include: ["metadata", "links"]`
2. Present clean summary
3. Offer to extract specific data or run readability

**MCP:** `{ "url": "...", "format": "markdown", "include": ["metadata", "links"] }`
**CLI:** `imperium-crawl scrape --url "URL" --include metadata,links`

#### Visual Path

1. Call `screenshot` — set `full_page: true` for full captures
2. Present screenshot, offer to scrape content

**MCP:** `{ "url": "...", "full_page": true }`
**CLI:** `imperium-crawl screenshot --url "URL" --full-page`

---

## Stealth Escalation Guide

The stealth engine auto-escalates (Level 1 → 2 → 3), but you can skip ahead:

| Situation | Recommended | Why |
|-----------|-------------|-----|
| Simple static site | Default (auto) | Level 1 handles it |
| Known anti-bot (Cloudflare, Amazon, LinkedIn) | `stealth_level: 3` | Skip straight to browser — saves time |
| JavaScript SPA (React, Angular, Vue) | `stealth_level: 3` | Content requires browser rendering |
| After getting empty/blocked results | `stealth_level: 3` + `proxy` | Full stealth with proxy rotation |

**MCP:** `{ "url": "...", "stealth_level": 3 }`
**CLI:** `imperium-crawl scrape --url "URL" --stealth-level 3`

---

## Tool Combinations

### readability → scrape Escalation
```
readability(url) → if empty/garbage → scrape(url, format: "markdown") → clean content
```

### extract + llm_fallback (Hybrid Cascade)
```
extract(url, selectors, llm_fallback: true) → CSS first, LLM if empty
```
Best of both worlds: fast deterministic extraction with AI safety net.

### Screenshot Debug Loop
```
screenshot(url) → extract(url, selectors) → [empty?] → screenshot(url) → refine selectors
```
Visual verification when selectors don't work.

### ai_extract → extract Refinement
```
ai_extract(url, schema: "auto") → discover structure → extract(url, exact_selectors) → faster repeat runs
```
Use AI to discover, then CSS for speed on repeat.

---

## CLI Gotchas

- **Boolean flags:** `--full-page` not `--full-page true`
- **JSON selectors:** `--selectors '{"title":"h1","price":".cost"}'` (single quotes around JSON)
- **Include:** `--include structured_data,links,metadata` (comma-separated, no spaces)
- **Output formats:** `--output-format json|csv|jsonl|markdown`
- **Pretty print:** `--pretty` for human-readable JSON
- **File output:** `--output results.json`
- **Pipe-safe:** Spinner → stderr, data → stdout

---

## Error Recovery

| Problem | Solution |
|---------|----------|
| Empty content | Retry with `stealth_level: 3` — likely blocked or JS-rendered |
| Timeout | Increase `timeout` (up to 60000ms); try `readability` instead |
| Readability returns garbage | Fallback to `scrape` with `format: "markdown"` |
| CAPTCHA detected | Level 3 handles auto if `TWOCAPTCHA_API_KEY` set; otherwise inform user |
| 403/429 | Use `stealth_level: 3` + `proxy` |
| `LLM_API_KEY` not set | Required for `ai_extract` and `llm_fallback`; run `imperium-crawl setup` |
| Login required | Use `interact` tool with session_id, or `chrome_profile` param |

---

## Output Formatting

- **Articles:** Title, author, date, word count, then content
- **Structured data:** Table or organized list
- **General scrape:** Summary first, then key content sections
- **Screenshots:** Display inline

If content > 2000 words, summarize key points first, offer full content.

---

## Important Notes

- Sequential calls for multi-page — prevent rate limiting
- Tell user which tool + stealth level was used
- If login required → suggest `interact` tool for session-based access, or `chrome_profile`
- `RESPECT_ROBOTS=true` is honored by default
