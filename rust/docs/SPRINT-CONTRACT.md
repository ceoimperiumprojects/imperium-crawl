# imperium-crawl Rust Port: Sprint Contract

**Version:** 1.0
**Date:** 2026-05-26
**Source:** `../src/` (TypeScript v2.6.1, 21,715 LOC, 43 tools, 38 test files)
**Target:** `crates/` (Rust workspace, 9 crates)

**Authority:** This document defines what the rewrite agent does and in what order. Agent must NOT improvise sprint boundaries, NOT skip ahead, NOT bundle sprints.

---

## Operating rules (read first)

1. **One sprint = one git commit minimum.** Commit on green build + green tests for that sprint's crate.
2. **Each sprint has an exit criterion.** If exit criterion is not met, do NOT proceed to next sprint. Document the blocker in `BLOCKERS.md` and stop.
3. **TypeScript source is read-only.** Never modify `../src/` or `../tests/`. Read for reference, port to Rust.
4. **Cargo workspace builds at all times.** `cargo check --workspace` must pass after every sprint. If a sprint introduces compile errors in unrelated crates, fix them before commit.
5. **Tests must match behavior, not implementation.** If a TS test does `expect(result.markdown).toContain("hello")`, the Rust test does the same assertion in `cargo test`. Don't port test scaffolding (jest/vitest mocks) — port test intent.
6. **Stub before implement.** Each crate starts with `lib.rs` containing typed function signatures + `todo!()` bodies. Implementation fills in `todo!()` per sprint.
7. **No unsafe Rust** unless documented (FFI to pdfium/camofox). All `unsafe` blocks require a `// SAFETY:` comment.
8. **No `unwrap()` in library code.** Use `?` propagation or explicit `match`. `unwrap()` is allowed in tests and `main.rs` only.

---

## Sprint Dependency Graph

```
S0 (workspace setup)
  ↓
S1 (core types + errors)
  ↓
S2 (stealth L1+L2: headers + wreq TLS) ──┐
  ↓                                       │
S3 (sessions + encryption)                │
  ↓                                       │
S4 (browser L3: chromiumoxide)            │  PARALLEL OK
  ↓                                       │
S5 (HTML tools: scrape/extract/crawl/...) ┘
  ↓
S6 (search: Brave API)
  ↓
S7 (PDF: pdfium-render)
  ↓
S8 (feeds + downloads: rss/download/batch)
  ↓
S9 (interaction: interact/snapshot/screenshot)
  ↓
S10 (API discovery: discover-apis/query-api/monitor-websocket)
  ↓
S11 (monitoring: monitor/watch)
  ↓
S12 (social: youtube/reddit/instagram)
  ↓
S13 (knowledge engine: adaptive learning)
  ↓
S14 (LLM providers + ai-extract)
  ↓
S15 (skills + flows: create-skill/run-skill/record-flow/run-flow)
  ↓
S16 (CLI layer: clap + TUI + formatters)
  ↓
S17 (parity gate: full test suite + benchmark vs TS)
```

---

## Sprint definitions

### Sprint 0 — Workspace setup ✅ DONE (by Claude prep)

**Exit:** `cargo check --workspace` passes with empty stub crates. Workspace Cargo.toml has all internal crate paths declared.

---

### Sprint 1 — Core types + errors (`imperium-crawl-core`)

**Scope:**
- Port `src/types/` and `src/core/constants.ts` to `imperium-crawl-core/src/lib.rs`
- Define error enum (`CrawlError` via `thiserror`)
- Port `core/config.ts` → `Config::load()` reading `~/.imperium-crawl/config.json`
- Common types: `Url`, `FetchResult`, `ContentKind`, `StealthLevel`, `Cookie`
- Define `Tool` trait (async fn execute, schema export)

**Exit:**
- `cargo test -p imperium-crawl-core` passes (at least 5 tests for config parsing, URL validation, error display)
- `cargo doc -p imperium-crawl-core` builds without warnings
- All public types have rustdoc comments

**Est:** 3 hours

---

### Sprint 2 — Stealth L1/L2 (`imperium-crawl-stealth`)

**Scope:**
- Port `src/stealth/headers.ts` → `headers.rs` (use `wreq-util` profiles + 135 personas from `imperium-core-browser/persona.rs`)
- Port `src/stealth/tls.ts` → `tls.rs` (wrap `wreq::Client` with Chrome JA3/JA4 profile)
- Port `src/stealth/proxy.ts` → reuse `imperium-core-browser/proxy.rs` (don't duplicate)
- Port `src/stealth/antibot-detector.ts` → `detector.rs` (36 platform signature catalog)
- Port `src/stealth/index.ts` → `escalation.rs` (L1→L2→L3 auto-escalation; L3 stubbed until Sprint 4)

**Exit:**
- `cargo test -p imperium-crawl-stealth` passes
- Integration test: fetch a known Cloudflare-protected URL, verify L1 fails and L2 succeeds (or correctly escalates)
- Headers test: verify generated User-Agent matches `wreq-util` profile output

**Est:** 8 hours

---

### Sprint 3 — Sessions + encryption (`imperium-crawl-sessions`)

**Scope:**
- Port `src/sessions/manager.ts` → `manager.rs`
- Port `src/sessions/encryption.ts` → `vault.rs` (AES-256-GCM via `aes-gcm` crate)
- Cookie persistence (reuse `imperium-core-browser/cookie_jar.rs`)
- Auto-refresh threshold logic

**Exit:**
- Encrypt → store → decrypt → load roundtrip test passes
- Cookie domain/path matching test passes
- `cargo test -p imperium-crawl-sessions` passes

**Est:** 4 hours

---

### Sprint 4 — Browser L3 (`imperium-crawl-browser`)

**Scope:**
- Port `src/stealth/browser.ts` → `browser.rs` (chromiumoxide wrapper)
- Port `src/stealth/browser-pool.ts` → `pool.rs` (concurrent page pool, max instances)
- Port `src/core/action-executor.ts` → `actions.rs` (click, type, scroll, wait, evaluate, drag, file upload, paginate)
- Port `src/stealth/chrome-profile.ts` → `profile.rs` (user data dir handling)
- Inject anti-detection JS via `Page.addScriptToEvaluateOnNewDocument`

**Exit:**
- Launch chromiumoxide headless Chrome, navigate to `https://example.com`, extract `<h1>` text, close — works
- Browser pool test: 3 concurrent pages, all isolate cookies
- Action executor test: click + wait + extract works
- `cargo test -p imperium-crawl-browser --features browser` passes

**Est:** 8 hours

---

### Sprint 5 — HTML tools (`imperium-crawl-tools` first batch)

**Scope (5 tools):**
- `scrape.rs` ← port `src/tools/scrape.ts` (127 LOC TS)
- `crawl.rs` ← port `src/tools/crawl.ts` (196 LOC TS)
- `extract.rs` ← port `src/tools/extract.ts` (154 LOC TS)
- `readability.rs` ← port `src/tools/readability.ts` (92 LOC TS)
- `map.rs` ← port `src/tools/map.ts`

**Exit:**
- Each tool exposes `async fn execute(args: ToolArgs) -> Result<ToolOutput>`
- Each tool has a schema export via `schemars`
- Snapshot test per tool against fixture HTML → expected output (use `insta` crate)
- Integration test: scrape `https://example.com` returns title "Example Domain"

**Est:** 8 hours

---

### Sprint 6 — Search tools

**Scope:**
- `search.rs` ← port `src/tools/search.ts` (Brave web search)
- `news_search.rs` ← port `src/tools/news-search.ts`
- `image_search.rs` ← port `src/tools/image-search.ts`
- `video_search.rs` ← port `src/tools/video-search.ts`
- Shared Brave API client in `imperium-crawl-core::brave`

**Exit:**
- `BRAVE_API_KEY` env var read from `.env` or `~/.imperium-crawl/config.json`
- wiremock test: stub Brave response, verify parsing
- `cargo test -p imperium-crawl-tools --test brave_search` passes

**Est:** 4 hours

---

### Sprint 7 — PDF (`pdf-extract`)

**Scope:**
- `pdf_extract.rs` ← port `src/tools/pdf-extract.ts` (310 LOC TS)
- Use `pdfium-render` for text layer extraction
- Document `libpdfium.so` runtime requirement in README

**Exit:**
- Test PDF in `tests/fixtures/sample.pdf` extracted with text matching TS output
- Tables/metadata fields ported

**Est:** 4 hours

---

### Sprint 8 — Feeds + downloads

**Scope:**
- `rss.rs` ← port `src/tools/rss.ts`
- `download.rs` ← port `src/tools/download.ts` (659 LOC TS — biggest single tool)
- `batch_download.rs` ← port `src/tools/batch-download.ts`
- `batch_scrape.rs` ← port `src/tools/batch-scrape.ts`

**Exit:**
- Batch queue test: 100 URLs, concurrency 10, all complete
- Resume on partial failure works
- Retry with backoff works
- `cargo test --workspace` still green

**Est:** 6 hours

---

### Sprint 9 — Browser interaction tools

**Scope:**
- `interact.rs` ← port `src/tools/interact.ts` (415 LOC TS)
- `snapshot.rs` ← port `src/tools/snapshot.ts`
- `screenshot.rs` ← port `src/tools/screenshot.ts`

**Exit:**
- Headless interaction test: open page, click button, capture screenshot
- DOM ref-based targeting works (snapshot then act on saved refs)

**Est:** 6 hours

---

### Sprint 10 — API discovery

**Scope:**
- `discover_apis.rs` ← port `src/tools/discover-apis.ts` (242 LOC TS)
- `query_api.rs` ← port `src/tools/query-api.ts`
- `monitor_websocket.rs` ← port `src/tools/monitor-websocket.ts`

**Exit:**
- Network interceptor captures XHR/fetch from a fixture page
- WebSocket frame stream works
- GraphQL endpoint detection works

**Est:** 6 hours

---

### Sprint 11 — Monitoring

**Scope:**
- `monitor.rs` ← port `src/tools/monitor.ts`
- `watch.rs` ← port `src/tools/watch.ts`

**Exit:**
- URL change detection test passes
- Webhook notification stub (Slack/Discord webhook URLs configurable)

**Est:** 4 hours

---

### Sprint 12 — Social parsers

**Scope:**
- `youtube.rs` ← port `src/tools/youtube.ts` (shell out to `yt-dlp`)
- `reddit.rs` ← port `src/tools/reddit.ts`
- `instagram.rs` ← port `src/tools/instagram.ts`

**Exit:**
- yt-dlp subprocess wrapper works
- Reddit JSON API (`.json` suffix) parsing works
- Instagram public scraper works (or graceful degradation when rate-limited)

**Est:** 6 hours

---

### Sprint 13 — Knowledge engine

**Scope:**
- Port `src/knowledge/store.ts` → `imperium-crawl-knowledge`
- Domain → stealth level prediction
- TTL cache (1h) with max 5,000 domains
- Persistence to disk

**Exit:**
- Predict correct stealth level for known domains after training
- Cache eviction (LRU) works

**Est:** 4 hours

---

### Sprint 14 — LLM providers + ai-extract

**Scope:**
- `imperium-crawl-llm`: Anthropic, OpenAI, MiniMax providers (trait + impls)
- `ai_extract.rs` tool ← port `src/tools/ai-extract.ts` (360 LOC TS)
- JSON schema auto-detection
- Pluggable provider selection via env var

**Exit:**
- Wiremock test: stub LLM response, verify extraction
- AI-extract end-to-end test against fixture HTML

**Est:** 6 hours

---

### Sprint 15 — Skills + Flows

**Scope:**
- `create_skill.rs`, `run_skill.rs`, `list_skills.rs`
- `record_flow.rs`, `run_flow.rs`, `serve_flow.rs`, `list_flows.rs`, `inspect_flow.rs`, `validate_flow.rs`
- Skill recipe templates (YAML)
- Flow YAML/JSON parser
- Variable interpolation (`${variable}`)

**Exit:**
- Built-in skills (extract, ai-extract, readability, interact) all run
- Flow recorder writes valid YAML
- Flow runner executes recorded YAML

**Est:** 10 hours

---

### Sprint 16 — CLI layer

**Scope:**
- `imperium-crawl-cli` binary crate
- clap derive-based argument parsing
- Dynamic tool registration (read from `tools::registry()`)
- TUI mode (port `src/cli/tui.ts`) — optional, can defer
- Formatters (TTY-aware JSON / Markdown / table output)
- Onboarding wizard (optional, can defer)

**Exit:**
- `imperium-crawl --help` lists all 43 tools
- `imperium-crawl scrape https://example.com` produces output matching TS version
- Non-TTY mode produces clean JSON to stdout

**Est:** 6 hours

---

### Sprint 17 — Parity gate

**Scope:**
- Port all 38 vitest test files to cargo tests
- Run benchmarks vs TS version (criterion):
  - Fetch latency
  - Memory per concurrent page
  - Cold start time
- Update `CHANGELOG.md` with port notes
- Tag `v3.0.0-alpha.1`

**Exit:**
- `cargo test --workspace --all-features` 100% pass
- Benchmarks documented in `BENCHMARKS.md`
- TS binary and Rust binary produce identical output for fixture suite (or documented differences)

**Est:** 8 hours

---

## Total estimated time

**~104 hours of focused agent work.** No solo Opus run completes this in one night.

**Realistic overnight scope (8-10 hours):**
- S0 (done) → S1 → S2 → S3 → S4 → S5 → maybe S6
- That covers: workspace, core types, full stealth engine, sessions, browser, HTML tools
- That's the **foundation**. The remaining 11 sprints (search, PDF, feeds, interaction, API discovery, monitoring, social, knowledge, LLM, skills/flows, CLI, parity) are follow-up sessions.

**Set agent expectation accordingly:** "Tonight you do S1-S5. If you finish early, do S6. Stop and document at the sprint boundary regardless of time."

---

## Definition of Done (per sprint)

A sprint is DONE when:
1. ✅ All listed scope items implemented
2. ✅ `cargo check --workspace` passes
3. ✅ `cargo test -p <sprint-crate>` passes
4. ✅ `cargo clippy -p <sprint-crate> -- -D warnings` passes (no lint errors)
5. ✅ Sprint exit criterion met
6. ✅ Commit pushed with message format: `feat(rust-port): sprint Sx - <name>`
7. ✅ `BLOCKERS.md` updated if any TODO/gap discovered

A sprint is NOT done if:
- ❌ `todo!()` remains in shipped code paths
- ❌ Tests are skipped (`#[ignore]`) without justification in `BLOCKERS.md`
- ❌ Clippy warnings suppressed without `#[allow(...)]` rationale

---

## Escalation / blocker protocol

If agent gets stuck for >30 minutes on a single sprint:

1. STOP. Don't burn the night on one problem.
2. Write the issue to `BLOCKERS.md` with:
   - Sprint number + crate
   - Specific Rust compiler error or design question
   - What you tried
   - 2-3 alternative approaches with pros/cons
3. Skip to next independent sprint if dependency graph allows
4. Notify in commit message: `blocker(S2): <one-line summary>`

Pavle reviews blockers in the morning.
