# Built-in Recipes & Custom Skill Format

## Built-in Recipes (14)

These are pre-made skills shipped with imperium-crawl. Run them without creating anything.

| Recipe | Tool | Description | Override URL? |
|--------|------|-------------|---------------|
| `hn-top-stories` | extract | Hacker News front page with title, points, comments, URL | No (HN-specific) |
| `github-trending` | extract | GitHub trending repos with name, description, stars, language | No (GitHub-specific) |
| `job-listings-greenhouse` | extract | Greenhouse ATS job boards — title, location, department | Yes — any Greenhouse board URL |
| `ecommerce-product` | ai_extract | E-commerce product details (name, price, description, images) | Yes — any product page |
| `product-reviews` | ai_extract | Product reviews with author, rating, text, sentiment analysis | Yes — any review page |
| `crypto-websocket` | monitor_websocket | Binance BTC/USDT live trades via WebSocket | No (Binance-specific) |
| `news-article-reader` | readability | Clean article text extraction (strips ads, nav, noise) | Yes — any article URL |
| `reddit-posts` | scrape | Reddit JSON API — posts with title, score, author, comments | Yes — any subreddit URL |
| `seo-page-audit` | extract | SEO meta tags, headings, structured data, canonical URL | Yes — any page |
| `social-media-mentions` | ai_extract | Social media posts with author, content, timestamp, sentiment | Yes — any social page |

### Running a Recipe

```bash
imperium-crawl run-skill --name "hn-top-stories"
imperium-crawl run-skill --name "ecommerce-product" --url "https://shop.example.com/product/123"
imperium-crawl run-skill --name "crypto-websocket" --duration-seconds 30 --max-messages 50
```

### Listing All Recipes + Custom Skills

`imperium-crawl list-skills`

Output shows both built-in recipes and user-created skills with source indicator.

---

## Custom Skill JSON Format

Skills are stored as JSON files in `~/.imperium-crawl/skills/{name}.json`.

### Structure

```json
{
  "name": "my-products",
  "description": "Extract product listings from example.com",
  "tool": "extract",
  "url": "https://example.com/products",
  "config": {
    "selectors": {
      "name": ".product-title",
      "price": ".price-tag",
      "image": "img.product-image@src",
      "url": "a.product-link@href"
    },
    "items_selector": ".product-card"
  },
  "created_at": "2024-01-15T10:30:00Z",
  "updated_at": "2024-01-15T10:30:00Z"
}
```

### Key Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Skill identifier (alphanumeric + hyphens/underscores) |
| `description` | string | What this skill extracts |
| `tool` | string | Which tool to use: `extract`, `scrape`, `ai_extract`, `readability`, `monitor_websocket` |
| `url` | string | Default URL (can be overridden at runtime) |
| `config` | object | Tool-specific configuration |
| `created_at` | string | ISO timestamp |
| `updated_at` | string | ISO timestamp |

### Config by Tool Type

**extract skills:**
```json
{
  "selectors": { "field": "css selector" },
  "items_selector": ".container"
}
```

**ai_extract skills:**
```json
{
  "schema": "extract product name, price, and rating",
  "format": "json",
  "max_tokens": 2000
}
```

**scrape skills:**
```json
{
  "format": "markdown",
  "include": ["structured_data", "metadata"]
}
```

**readability skills:**
```json
{
  "format": "markdown"
}
```

**monitor_websocket skills:**
```json
{
  "duration_seconds": 30,
  "max_messages": 100,
  "filter_url": "wss://specific-endpoint"
}
```

---

## Manual Skill Editing

You can edit skill JSON files directly:

1. Find the file: `~/.imperium-crawl/skills/{name}.json`
2. Edit selectors, URL, config, etc.
3. Test: `run_skill(name)` or `imperium-crawl run-skill --name NAME`

**Common edits:**
- Fix broken selectors → update `config.selectors`
- Change default URL → update `url`
- Switch from CSS to AI extraction → change `tool` to `ai_extract` and update `config`

**Overwrite via create_skill:** Creating a skill with the same name replaces the existing file.

---

---

## Workflow: Multi-Platform Influencer Discovery

Find influencers by combining Instagram, YouTube, Brave Search, and Reddit.
Each step uses an existing imperium-crawl tool. The AI agent orchestrates steps and cross-references results in memory.

**When to use:** Influencer outreach, partnership scouting, competitive analysis, creator discovery.

### Overview

```
Sources (parallel)           Enrich               Score & Rank
─────────────────           ───────               ────────────
Brave → IG usernames  ─┐
                        ├─→ IG profiles  ─┐
Brave → YT channels   ─┤                  ├─→ Cross-reference → Unified ranked list
                        ├─→ YT channels  ─┤
YouTube search        ──┘                  │
                          Reddit search  ──┘
```

### Step 1 — Collect candidates from multiple sources

Run these searches to build a candidate pool. More sources = more candidates.

**Source A: Brave → Instagram profiles**
```bash
imperium-crawl search --query "site:instagram.com travel serbia" --count 20
imperium-crawl search --query "site:instagram.com hotel beograd influencer" --count 20
imperium-crawl search --query "site:instagram.com food blogger serbia" --count 20
```
From results, extract Instagram usernames from URLs matching `instagram.com/{username}`.
Skip non-profile paths: `/p/`, `/reel/`, `/explore/`, `/accounts/`.

**Source B: Brave → YouTube channels**
```bash
imperium-crawl search --query "site:youtube.com travel serbia channel" --count 20
imperium-crawl search --query "site:youtube.com hotel beograd vlog" --count 20
```
Extract channel handles from URLs matching `youtube.com/@{handle}` or `youtube.com/c/{name}`.

**Source C: YouTube search (no API key needed)**
```bash
imperium-crawl youtube --action search --query "travel serbia vlog" --limit 20
imperium-crawl youtube --action search --query "beograd hotel review" --limit 20
```
Collect unique `author` and `author_url` fields from video results — these are channel handles.

**Or use the instagram tool's built-in search:**
```bash
imperium-crawl instagram --action search --query "travel serbia" --limit 20
```
Returns deduplicated usernames directly.

> **Rate limits:** Brave Free plan = 1 req/sec. Space search queries 1.5s apart.
> YouTube search uses smartFetch (no rate limit, but don't spam).

### Step 2 — Fetch profiles from each platform

**Instagram profiles** (browser-based, ~15s per profile):
```bash
# Single profile
imperium-crawl instagram --action profile --username explore_serbia

# Batch (1.5s rate limit between fetches)
imperium-crawl instagram --action profile \
  --usernames explore_serbia \
  --usernames serbiatourism \
  --usernames visit_belgrade
```
Returns: `followers`, `following`, `posts_count`, `verified`, `engagement_rate`.

**YouTube channels** (fast, no browser needed):
```bash
imperium-crawl youtube --action channel --channel-url "youtube.com/@explore_serbia"
imperium-crawl youtube --action channel --channel-url "youtube.com/@serbiatourism"
```
Returns: `name`, `subscribers`, `verified`, `description`.

> **Speed difference:** YouTube channel fetch = ~2s (HTTP only). Instagram profile = ~15s (needs browser).
> Fetch all YouTube channels first, then Instagram profiles for matched candidates only.

### Step 3 — Cross-reference across platforms

For each candidate, check if they exist on the other platform:

**IG influencer → check YouTube:**
```bash
imperium-crawl youtube --action channel --channel-url "youtube.com/@{ig_username}"
```
If 404/not found, try searching:
```bash
imperium-crawl youtube --action search --query "{full_name} {niche}" --limit 3
```
Match by name similarity in results.

**YouTube creator → check Instagram:**
```bash
imperium-crawl instagram --action profile --username {yt_handle}
```

**Optional — Reddit signal:**
```bash
imperium-crawl reddit --action search --query "{username}" --limit 5
```
Reddit activity = authenticity signal (real person, not just a brand page).

### Step 4 — Score and rank

Build a unified score per influencer using data from all platforms:

```
Score = (ig_score × 0.5) + (yt_score × 0.3) + (reddit_score × 0.2)

ig_score:
  - followers 1K-10K = 5pts, 10K-50K = 10pts, 50K+ = 15pts
  - engagement_rate > 3% = +5pts
  - is_business = +2pts
  - has business_email = +3pts

yt_score:
  - subscribers 1K-10K = 5pts, 10K-100K = 10pts, 100K+ = 15pts
  - verified = +3pts
  - recent video activity = +5pts

reddit_score:
  - found in niche subreddits = 5pts per subreddit
  - high karma posts = +3pts

Multipliers:
  - Present on 2 platforms = score × 1.3
  - Present on 3 platforms = score × 1.5
  - Has contact info (email) = priority flag
```

Sort by score DESC. Output top N.

### Step 5 — Output format

Final output per influencer:
```json
{
  "rank": 1,
  "name": "Explore Serbia",
  "score": 42.5,
  "platforms": {
    "instagram": {
      "username": "explore_serbia",
      "url": "https://instagram.com/explore_serbia/",
      "followers": 19000,
      "engagement_rate": 4.2
    },
    "youtube": {
      "handle": "@explore_serbia",
      "url": "https://youtube.com/@explore_serbia",
      "subscribers": 8500
    },
    "reddit": { "mentions": 3 }
  },
  "contact": { "email": "info@exploreserbia.com" },
  "cross_platform": true,
  "tags": ["travel", "serbia", "tourism"]
}
```

### Practical tips

- **Start with YouTube** — faster to fetch (no browser), gives you channel handles to check on IG
- **Use Brave query variations** — "influencer", "blogger", "vlog", "guide", "content creator" find different people
- **Location matters** — add city names, not just country: "beograd", "novi sad", "nis"
- **Small influencers** (1K-50K followers) have higher engagement rates and are more reachable
- **Batch smartly** — fetch all YT channels first (~2s each), then only fetch IG for top candidates (~15s each)
- **Rate limit Brave** — 1.5s between requests on Free plan. YouTube/Instagram have their own limits

---

## Tips

- **Check recipes first** — before building a custom skill, run `list_skills` to see if a recipe already covers the use case
- **URL override** — most recipes accept a different URL at runtime (see table above)
- **Skill iteration** — create → run → check → recreate (same name) → run again
- **Naming** — use descriptive names: `hn-top-stories` not `skill1`
- **Sharing** — skill JSON files are portable; copy to another machine's `~/.imperium-crawl/skills/`
