# Built-in Recipes & Custom Skill Format

## Built-in Recipes (10)

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

## Tips

- **Check recipes first** — before building a custom skill, run `list_skills` to see if a recipe already covers the use case
- **URL override** — most recipes accept a different URL at runtime (see table above)
- **Skill iteration** — create → run → check → recreate (same name) → run again
- **Naming** — use descriptive names: `hn-top-stories` not `skill1`
- **Sharing** — skill JSON files are portable; copy to another machine's `~/.imperium-crawl/skills/`
