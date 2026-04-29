# Changelog

All notable changes to `imperium-crawl` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.5.1] — 2026-04-29

### Added

- **Browser-based image extraction overhaul** — `download` tool now uses L3 headless browser for 100% image coverage. Executes full page render with JavaScript, lazy-load triggering, shadow DOM walk, and same-origin iframe scan.
- **Image discovery sources** — Extracts from: `<img>` (src, data-src, srcset), `<picture>` + `<source>`, inline `style="background-image"`, all `<style>` tag CSS rules, shadow DOM recursively, JSON-LD `<script type="application/ld+json">`, inline `<script>` globals (`__INITIAL_STATE__`, `__DATA__`), and same-origin iframes.
- **Image targeting** — Precise filtering via `--selector`, `--index`, `--alt-match`, `--min-width`, `--max-width`. Select exactly the image you need instead of bulk-downloading.
- **Lazy-load trigger** — `--scroll-full` (default: true) scrolls the entire page to force lazy-loaded images into DOM before extraction.
- **Auto-click** — `--auto-click` finds and clicks "Load more" / "Gallery" / "Show more" buttons (multilingual keyword matching) to reveal hidden images before extraction. Also available as standalone `interact` action: `auto_click`.
- **Referer injection** — All image downloads include `Referer: <page_url>` header, fixing 403 errors on image CDN anti-hotlink protection.
- **Image dimension filtering** — `--min-width` / `--max-width` to skip thumbnails and oversized assets.
- **`--wait-for` selector** — Pause extraction until a specific element appears (useful for SPAs that load galleries asynchronously).
- **`--iframe-scan`** — Recursively scan same-origin iframes for images.
- **`--limit`** — Hard cap on number of images per page (default: 500).

### Changed

- `download` tool description updated to reflect browser-based image extraction.
- Default image download behavior (no flags) now uses browser extraction instead of L2 HTTP fetch + Cheerio, dramatically improving accuracy on JS-heavy oglasne platforme.

---

## [2.5.0] — 2026-04-20

### Added

- **`pdf-extract`** — Extract text, pages, tables and metadata from local or remote PDFs using a native `pdfjs-dist` text-layer strategy. No native bindings, no external services. Flags: `--input`, `--output`, `--max-pages`, `--preserve-layout`, `--extract-tables`. Returns JSON with `{ text, pages, tables, metadata, confidence, strategy_used }`. Smoke-tested against the 98-page CBAM Guidance PDF (199,822 chars, confidence 0.99).
- **`watch`** — One-shot URL change detector. Scrapes a URL, hashes the content (readability / markdown / full), diffs against the last snapshot, and fires a webhook on change. Cron-friendly — pair with `*/30 * * * *` for periodic monitoring. Flags: `--url`, `--input-file`, `--output-dir`, `--hash-on`, `--webhook`, `--diff-format`. State persisted to `.state.json` for cross-run memory.
- **`monitor`** — Multi-URL intelligence digest generator. Reads a JSON config grouping URLs by topic, runs change detection across all of them, and emits a markdown digest filtered by `--min-change-pct`. Ideal for daily competitive/regulatory intel runs.
- **Imperium Flows** — Six generic browser workflow tools: `record-flow`, `run-flow`, `serve-flow`, `list-flows`, `inspect-flow`, and `validate-flow`. Record headed browser workflows as reusable family/variant JSON, run them with runtime inputs, expose them as a local HTTP API, and retain rich recording telemetry for selector healing and debugging.

### Changed

- Tool count bumped to 39 across `README.md`, `src/tools/manifest.ts`, `src/tools/index.ts`, and `tests/tool-registry.test.ts`.
- Test count bumped: 580 passing in this environment. New focused coverage for `pdf-extract`, `watch`, `monitor`, Flow schema/storage/server behavior, and recorder telemetry.
- `package.json` keywords extended with `pdf-extract`, `web-monitoring`, `url-watch`, `content-diff`, `intelligence-digest`, `browser-workflows`, `workflow-recorder`, and `flow-api`.
- `package.json` description updated to reflect the broader surface: web scraping, PDF extraction, content monitoring, reusable browser flows, and RSS aggregation.

### Dependencies

- **Added** `pdfjs-dist@^4.0.379` — pure-JS PDF text layer. No native bindings, Node-friendly.

### Deferred to v2.6.0

- `pdf-extract`: OCR fallback (tesseract.js), Claude Vision fallback for scanned PDFs, x-coordinate table clustering for proper column detection.
- `watch`: daemon mode with SIGINT loop, human-friendly interval parser (`--interval 1h`), email alert transport.
- `monitor`: YAML config, per-change LLM summarize (1-sentence), scheduled digest (hourly/weekly), HTML export.
- Imperium Flow Recorder Chrome extension, selector healing UI, and local import server.

### Known Issues

- 1 preexisting Playwright screenshot integration test timed out in this environment. Unrelated to v2.5.0 work; install or refresh browsers with `npx playwright install chromium` if local Playwright checks hang.

---

## [2.4.0] — Previous release

See git history (`git log v2.3.1..v2.4.0`) for details.

## [2.3.1] — Previous release

See git history.

## [2.3.0] — Previous release

See git history.

## [2.2.0] — Previous release

See git history.

## [2.1.0] — Previous release

See git history.
