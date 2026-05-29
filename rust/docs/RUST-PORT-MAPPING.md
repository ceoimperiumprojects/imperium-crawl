# imperium-crawl: NPM → Rust Crate Mapping

Authoritative mapping for the TypeScript → Rust port. **Agent: do not improvise dependencies. If a mapping is missing here, stop and document the gap rather than guess.**

Source: `../package.json` v2.6.1
Target: `Cargo.toml` workspace v3.0.0-alpha.1

---

## 1. Core runtime + async

| TypeScript | Rust crate | Version | Notes |
|---|---|---|---|
| `node` event loop | `tokio` | 1.40 | full features; multi-thread runtime |
| Promises | `async`/`.await` | — | native language feature |
| AbortController | `tokio_util::sync::CancellationToken` | 0.7 | |
| `EventEmitter` | `tokio::sync::broadcast` | 1.40 | |
| `setTimeout`/`setInterval` | `tokio::time::sleep`/`interval` | 1.40 | |

## 2. HTTP / Network

| TypeScript | Rust crate | Notes |
|---|---|---|
| `node:fetch`, axios | `reqwest` 0.12 | default HTTP client, rustls-tls feature |
| `impit` (TLS spoofing) | **`wreq` 6.0-rc** | **CRITICAL**: BoringSSL fork already in `imperium-core-browser`. Reuse. JA3/JA4 Chrome-identical fingerprint. |
| `header-generator` | `wreq-util` 3.0-rc + custom | 135 browser profile catalog already exists in `imperium-core-browser/persona.rs` — reuse the persona system |
| `normalize-url` | `url` 2.5 + custom normalize fn | inline helper, no external crate |
| `robots-parser` | `robotxt` 0.6 | spec-compliant parser |

**Reuse from imperium-core-browser:** `network.rs`, `persona.rs`, `proxy.rs`, `cookie_jar.rs` — these are already Rust and battle-tested. Wrap them as a crate dependency or symlink during port.

## 3. Browser automation

| TypeScript | Rust crate | Notes |
|---|---|---|
| `playwright` 1.52 | **`chromiumoxide` 0.7** | Pure Rust CDP client, tokio-runtime feature. ~70% Playwright feature parity. |
| `rebrowser-playwright` 1.51 | `chromiumoxide` + custom CDP commands | Inject anti-detect JS via `Runtime.evaluate` |
| `@askjo/camofox-browser` 1.8 | **shell out to camofox binary** | C++ binary, don't reimplement. Spawn subprocess. |
| `fingerprint-injector` 2.1 | custom via CDP `Page.addScriptToEvaluateOnNewDocument` | Inject canvas/WebGL spoofing scripts |

**Mapping notes:**
- `page.click(selector)` → `page.find_element(selector).await?.click().await?`
- `page.evaluate(script)` → `page.evaluate(script).await?.into_value()?`
- `page.waitForSelector` → `page.wait_for_navigation` or custom polling loop
- `page.screenshot` → `page.screenshot(ScreenshotParams::builder().build()).await?`
- Playwright contexts → `Browser::new_browser_context().await?`

**Known gap:** chromiumoxide does NOT have built-in Playwright-style auto-wait. Implement explicit wait helpers in `imperium-crawl-browser`.

## 4. HTML / DOM parsing

| TypeScript | Rust crate | Notes |
|---|---|---|
| `cheerio` 1.0 | **`scraper` 0.20** | jQuery-like CSS selectors, html5ever-based |
| `jsdom` 26.0 | `scraper` for parsing + `html5ever` direct for full DOM | jsdom equivalent for full DOM rarely needed in this codebase |
| `linkedom` 0.18 | `scraper` | linkedom is just a faster jsdom — scraper covers the use case |
| `@mozilla/readability` 0.5 | **`readability` 0.3** | Mozilla algorithm port |
| `turndown` 7.2 + `turndown-plugin-gfm` 1.0 | **`html2md` 0.2** | HTML → Markdown with GFM tables |

## 5. PDF / Media

| TypeScript | Rust crate | Notes |
|---|---|---|
| `pdfjs-dist` 4.0 | **`pdfium-render` 0.8** | Chrome's PDFium via Rust bindings. Native quality. Requires `libpdfium.so` at runtime — bundle it. |
| `@distube/ytdl-core` 4.16 | **shell out to `yt-dlp`** | Don't port. yt-dlp is industry standard, updated weekly for YouTube format changes. Spawn subprocess. |
| `rss-parser` 3.13 | **`rss` 2.0** + `atom_syndication` 0.12 | RSS 2.0 + Atom both supported |

## 6. CLI / TUI

| TypeScript | Rust crate | Notes |
|---|---|---|
| `commander` 13.1 | **`clap` 4.5** | derive macros, env var support, wrap_help |
| `@clack/prompts`, `@inquirer/prompts` | **`inquire` 0.7** | interactive prompts |
| `chalk` 5.6 | **`owo-colors` 4** | colored terminal output |
| `ora` 8.2 | **`indicatif` 0.17** | spinners + progress bars |
| `cli-table3` 0.6 | **`comfy-table` 7** | terminal tables |
| `zod` 3.24 | **`serde` + `validator`** | Use `#[derive(Deserialize, Validate)]` instead of zod runtime parsing. Schema export via `schemars` 0.8. |

## 7. Concurrency / queues

| TypeScript | Rust crate | Notes |
|---|---|---|
| `p-queue` 8.1 | **`tokio::sync::Semaphore` + `tower::concurrency`** | concurrent rate-limited job queue |
| `p-limit` | `tokio::sync::Semaphore` | |
| Rate limiting | **`governor` 0.7** | token bucket rate limiter |

## 8. Crypto / Sessions

| TypeScript | Rust crate | Notes |
|---|---|---|
| `crypto.createCipheriv('aes-256-gcm', ...)` | **`aes-gcm` 0.10** | RustCrypto stack |
| Password hash | `argon2` 0.5 | for session vault password |
| RNG | `rand` 0.8 | for nonces |
| HKDF/HMAC | `ring` 0.17 | for key derivation |

## 9. LLM providers

| TypeScript | Rust crate | Notes |
|---|---|---|
| `@anthropic-ai/sdk` | **custom via `reqwest`** | No mature Anthropic Rust crate yet. Build a minimal client in `imperium-crawl-llm/src/anthropic.rs`. ~150 LOC. |
| `openai` | **`async-openai` 0.27** | community-maintained, stable |
| MiniMax | **custom via `reqwest`** | minor provider, ~100 LOC client |

## 10. Logging / observability

| TypeScript | Rust crate | Notes |
|---|---|---|
| `console.log` | `tracing` 0.1 + `tracing-subscriber` 0.3 | structured logs |
| `debug` package | `tracing::debug!` | |

## 11. Env / config

| TypeScript | Rust crate | Notes |
|---|---|---|
| `dotenv` 16.4 | **`dotenvy` 0.15** | drop-in dotenv replacement |
| `process.env.X` | `std::env::var("X")` | |
| Config file (`~/.imperium-crawl/config.json`) | `serde_json` + `dirs` 5 | |

## 12. Error handling

| TypeScript | Rust crate | Notes |
|---|---|---|
| `try/catch`, custom Error classes | **`thiserror` 1** (library crates) + **`anyhow` 1** (binary/CLI) | thiserror for typed errors, anyhow for unstructured propagation |

## 13. Testing

| TypeScript | Rust crate | Notes |
|---|---|---|
| `vitest` | **`cargo test`** + **`tokio-test`** | built-in, no extra deps for unit tests |
| HTTP mocks | **`wiremock` 0.6** | for stealth/scrape tests |
| Snapshot tests | **`insta` 1.40** | for output format tests |
| Benchmarks | **`criterion` 0.5** | for stealth engine perf gates |

---

## What does NOT have a clean Rust port

These TS dependencies need **custom implementation** rather than 1:1 mapping. Agent must flag these in `IMPLEMENTATION-NOTES.md` as it goes:

1. **`@askjo/camofox-browser`** — proprietary C++ binary. Wrap as subprocess, do NOT reimplement.
2. **YouTube downloading** — yt-dlp shell-out, do NOT port `@distube/ytdl-core` (rapidly changing format internals).
3. **`fingerprint-injector`** — inject JS via CDP. The JS payload itself stays in a `.js` asset file embedded via `include_str!`.
4. **`rebrowser-playwright`** — anti-detection patches. Reimplement the patches as CDP `Page.addScriptToEvaluateOnNewDocument` calls.

---

## Quick reference: crate selection rationale

- **Why `wreq` over `reqwest` everywhere?** Because reqwest's TLS is rustls/native-tls — does NOT fingerprint as Chrome. wreq uses BoringSSL with Chrome cipher suite ordering, extension permutation, and HTTP/2 SETTINGS frame matching. **For stealth, wreq is non-negotiable.**
- **Why `chromiumoxide` over `headless_chrome`?** chromiumoxide has better tokio integration, more active maintenance, and CDP type safety via codegen.
- **Why no `playwright-rust`?** It exists but is unmaintained (last commit 2022) and bindings are fragile. chromiumoxide is the production choice.
- **Why `pdfium-render` over `lopdf`?** lopdf is pure Rust but misses 30%+ of real-world PDFs. pdfium is Chrome's PDF engine — same quality as the original `pdfjs-dist`.

---

## Cargo features matrix (per-tool feature gates)

To keep the binary lean, gate heavy deps behind features:

```toml
[features]
default = ["html", "search", "session"]
html = ["scraper", "readability", "html2md"]
search = []  # Brave API via reqwest, no extra dep
session = ["aes-gcm", "argon2"]
browser = ["chromiumoxide"]              # +50MB binary (chromium download)
pdf = ["pdfium-render"]                  # +10MB (pdfium binary)
youtube = []                             # shell out, no Rust dep
ai = ["async-openai"]                    # +1MB
camofox = []                             # subprocess to camofox binary
all = ["html", "search", "session", "browser", "pdf", "youtube", "ai", "camofox"]
```

This means a user who only needs scraping doesn't pull in pdfium/chromium binaries.
