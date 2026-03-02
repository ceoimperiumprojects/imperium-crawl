# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**imperium-crawl** — Open-source MCP (Model Context Protocol) server providing 16 tools for web scraping, crawling, search, and API discovery. Published as an npm package (`imperium-crawl`). TypeScript, ES2022, NodeNext modules, strict mode.

## Commands

```bash
npm run build          # tsc + chmod +x dist/index.js
npm run dev            # tsc --watch
npm start              # node dist/index.js (stdio MCP server)
npm run inspect        # MCP Inspector for debugging tools
npm test               # vitest run (all tests)
npm run test:watch     # vitest (watch mode)
npx vitest run tests/foo.test.ts  # single test file
```

Build must succeed before `npm start` or `npm run inspect`. After any source change, rebuild or use `npm run dev` for watch mode.

## Architecture

```
src/index.ts          → CLI entry (shebang, dotenv, transport selection)
src/server.ts         → MCP server init, registers all tools from allTools[]
src/config.ts         → Env vars: BRAVE_API_KEY, TWOCAPTCHA_API_KEY, TRANSPORT, PORT
src/constants.ts      → Defaults (timeouts, concurrency, paths)
src/protocols/        → stdio (default) and http (Express) transports
```

### Tool System

Each tool in `src/tools/` exports: `name`, `description`, `schema` (Zod), `execute()`. All are collected in `src/tools/index.ts` as `allTools: ToolDefinition[]` and dynamically registered via `server.tool()` in server.ts.

**16 tools in 4 categories:**
- **Scraping (6):** scrape, crawl, map, extract, readability, screenshot — no API key needed
- **Search (4):** search, news-search, image-search, video-search — require `BRAVE_API_KEY`
- **Skills (3):** create-skill, run-skill, list-skills — saved to `~/.imperium-crawl/skills/`
- **API Discovery (3):** discover-apis, query-api, monitor-websocket — use Playwright

### 3-Level Stealth Engine (`src/stealth/`)

`smartFetch(url, options?)` auto-escalates through 3 levels:

1. **Level 1** (`headers.ts`): Native `fetch()` + `header-generator` realistic headers
2. **Level 2** (`tls.ts`): `impit` for JA3/JA4 TLS fingerprinting
3. **Level 3** (`browser.ts`): Playwright + `fingerprint-injector` + auto CAPTCHA solving

Key behaviors:
- **Proxy support** (`proxy.ts`) — `resolveProxy(override?)` threads proxy through all 3 levels. Level 1: undici `ProxyAgent`, Level 2: `Impit({ proxyUrl })`, Level 3: `chromium.launch({ proxy })`
- **Browser pool** (`browser-pool.ts`) — Keyed by proxy URL. `acquire(proxyUrl?)` / `release(browser)`. Max `BROWSER_POOL_SIZE` (default 3). Overflow → temporary browser closed on release. Idle eviction every 60s (5min TTL).
- **Rendering cache** (`Map<domain, level>`, 1h TTL) — skips escalation for known domains
- **Anti-bot detection** (`antibot-detector.ts`) — detects Cloudflare, Akamai, PerimeterX, DataDome, Kasada, AWS WAF, F5/Shape; may skip Level 2 and jump straight to Level 3
- **Block detection** (`detector.ts`) — checks HTTP status, content indicators, SPA shells
- **Chrome Profile** (`chrome-profile.ts`) — `acquirePage(options?)` returns a `PageHandle` with unified cleanup. Profile mode: `launchPersistentContext` with user's Chrome cookies/sessions (opt-in via `chrome_profile` schema field or `CHROME_PROFILE_PATH` env). Pool mode: browser pool + fingerprint-injector (default). Profile mutex prevents concurrent access to same userDataDir

### CAPTCHA System (`src/captcha/`)

Auto-enabled when `TWOCAPTCHA_API_KEY` env var is set and Level 3 fetch is active.

- `detector.ts` — Detects reCAPTCHA v2/v3, hCaptcha, Cloudflare Turnstile; extracts sitekey
- `solver.ts` — `TwoCaptchaSolver` class: pure HTTP client (no npm dep), submit→poll→token
- `index.ts` — Orchestrator: detect→solve→inject token into page→submit form

### Utilities (`src/utils/`)

- `fetcher.ts` — Circuit breaker per domain (5 failures → 60s open), exponential backoff with full jitter, `p-queue` concurrency limiting
- `markdown.ts` — Turndown + GFM plugin, noise removal (ads, nav, cookie banners)
- `url.ts` — 11-step URL normalization including tracking param removal (utm_*, fbclid, etc.)
- `structured-data.ts` — Extracts JSON-LD, OpenGraph, Twitter Cards, Microdata
- `robots.ts` — robots.txt parsing + caching (1h TTL)

## TypeScript Gotchas

These are real issues encountered in this codebase — follow these patterns:

- `cheerio.Element` type → import `Element` from `domhandler`, not cheerio
- `impit 0.9.x` → instantiate with `new Impit()`, no `redirect` option in its RequestInit
- `robots-parser` → requires cast: `(robotsParser as any)(url, text)`
- `turndown-plugin-gfm` → no built-in types; custom `.d.ts` lives in `src/types/turndown-plugin-gfm.d.ts`
- `linkedom` → cast `document as unknown as Document` when passing to Readability
- Form submit in CAPTCHA injection → use `if (form.requestSubmit) {...} else {...}`, not optional chaining `?.()` (TS strict won't allow it)

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `BRAVE_API_KEY` | For search tools | Brave Search API |
| `TWOCAPTCHA_API_KEY` (or `TWO_CAPTCHA_API_KEY`) | For auto CAPTCHA | 2Captcha API |
| `TRANSPORT` | No (default: `stdio`) | `stdio` or `http` |
| `PORT` | No (default: `3000`) | HTTP transport port |
| `PROXY_URL` | No | Single proxy URL (http/https/socks4/socks5) |
| `PROXY_URLS` | No | Comma-separated proxy URLs for rotation |
| `BROWSER_POOL_SIZE` | No (default: `3`) | Max pooled browser instances |
| `CHROME_PROFILE_PATH` | No | Chrome user data dir for authenticated sessions |
| `RESPECT_ROBOTS` | No (default: `true`) | Honor robots.txt |

## Adding a New Tool

1. Create `src/tools/my-tool.ts` exporting `name`, `description`, `schema` (Zod object), `execute` function
2. Import and add to `allTools[]` in `src/tools/index.ts`
3. `execute()` must return `{ content: [{ type: "text", text: string }] }` (MCP response format)
4. Use `smartFetch()` from `src/stealth/index.ts` for any HTTP fetching — never raw `fetch()`

## Testing

Vitest with `pool: "forks"` for isolation. 30s test timeout, 15s hook timeout. Config in `vitest.config.ts`. Test files go in `tests/` directory with `.test.ts` extension.
