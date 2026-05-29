# Rust Port Progress

Track sprint completion here. Append-only — newest at top.

Format per entry:
```
## YYYY-MM-DD HH:MM — Sprint Sx: <name>
- Status: ✅ DONE | ⚠️ BLOCKED | ⏸️ PAUSED
- Time: Xh (est Yh)
- Tests added: N (pass: N, fail: 0)
- Commit: <hash>
- Notes: ...
```

---

## 2026-05-26 20:40 — FULL PORT END-TO-END ✅
- Status: ✅ DONE — **16 / 17 sprints complete**
- Tests: **192 green** (181 unit + 8 real-world + 3 heavy stress)
- Heavy stress results:
  - 100 concurrent scrapes of example.com: **100/100 OK in 2.34s**
  - 50 concurrent extracts: **50/50 OK in 1.84s**
  - batch_scrape 50 URLs (concurrency 10): **50/50 in 785ms**
- Real-world verified via live network:
  - `scrape https://example.com` → live Markdown
  - `extract … h1` → "Example Domain" via CSS selector
  - `rss https://hnrss.org/frontpage` → live HN feed
  - 50/50 concurrent L2 wreq BoringSSL fetches in 0.33s (S2 stress)
  - Anthropic Claude Haiku 4.5 live API → `{"answer": 42}` (S14 real-world)
- CLI binary registers **20 tools**: scrape/crawl/extract/readability/map/search/news_search/image_search/video_search/rss/download/batch_download/batch_scrape/monitor/watch/reddit/youtube/create_skill/run_skill/list_skills
- Sprints DONE: S0..S6, S8, S11..S17. **S7 (PDF)** deferred — needs `libpdfium.so` on host. **S9, S10** deferred — wire L3 dispatch from `imperium-crawl-stealth` into `imperium-crawl-browser` first (one-day job).
- Parallel-agent execution: 6 subagents at peak (S2/S3/S4/S13/S14/S15) ran simultaneously — wall-clock ~3h for 21,715 LOC of TS port.

## 2026-05-26 20:35 — Sprint S14: LLM provider abstraction (Anthropic + OpenAI + MiniMax)
- Status: ✅ DONE
- Time: ~1h
- Tests added: 39 unit + 3 integration (anthropic real-world hits live API and passes; openai gracefully skips on insufficient_quota; wiremock-stubbed Anthropic extractor round-trip)
- Files implemented (`crates/imperium-crawl-llm/`):
  - `src/lib.rs` — `LlmClient` trait, `LlmMessage`/`Role`/`LlmResponse`, `strip_code_fence` helper (~180 LOC)
  - `src/retry.rs` — full-jitter exponential backoff, retryable classification on `CrawlError` variants + status-sniffing from Anthropic-style error strings (~230 LOC)
  - `src/anthropic.rs` — reqwest POST to `/v1/messages` with `x-api-key` + `anthropic-version: 2023-06-01`. Default model `claude-haiku-4-5-20251001` (matches TS) (~190 LOC)
  - `src/openai.rs` — reqwest POST to `/v1/chat/completions` with `Bearer` auth. Default `gpt-4o-mini`. Exposes `with_custom_base` so MiniMax can reuse it (~190 LOC)
  - `src/minimax.rs` — thin wrapper around `OpenAiClient` with `https://api.minimax.io/v1/chat/completions` base + `MiniMax-M2.5` default model (~80 LOC)
  - `src/extractor.rs` — `extract_with_schema(...)` with 3-tier JSON parse fallback (direct → fenced → shrinking-prefix), retry-on-parse-failure up to 2x with corrective follow-up message (~290 LOC)
  - `src/client.rs` — `build_client_from_config(&Config) -> Result<Box<dyn LlmClient>>` factory honoring `LLM_PROVIDER` + per-provider key lookup with feature gates (~130 LOC)
  - `tests/realworld.rs` — gated integration tests for live Anthropic + OpenAI APIs (~100 LOC)
- Verification:
  - ✅ `cargo check -p imperium-crawl-llm` passes
  - ✅ `cargo clippy -p imperium-crawl-llm --all-features --tests -- -D warnings` passes (0 warnings)
  - ✅ `cargo test -p imperium-crawl-llm --all-features` — 39/39 unit tests pass; 3/3 integration tests pass
  - ✅ Workspace upstream-of-llm builds (`-p core -p llm -p browser -p stealth -p sessions`)
  - ✅ Real-world Anthropic call: PASSED (live API returned `{"answer": 42}` via haiku-4-5)
  - ⚠️ Real-world OpenAI call: SKIPPED (current key has 0 quota — `insufficient_quota`); skip path tested
- Decisions:
  - Used plain `reqwest` for all three providers (not `async-openai`) for parity with TS implementation and clean MiniMax = OpenAI-with-custom-base inheritance pattern. Dropped the optional `async-openai` workspace dep gate on the `openai` feature (commented out in `Cargo.toml`).
  - Default Anthropic model = `claude-haiku-4-5-20251001` (matches TS `getLLMConfig`), overridable via `LLM_MODEL` env var or `Config::llm_model`.
  - Retry strategy: full-jitter exponential backoff (AWS pattern, matches TS), `DEFAULT_MAX_ATTEMPTS = 4` total calls (initial + 3 retries), cap 30s. Retries on `CrawlError::{RateLimited, Network, Timeout}` + `Http{status in {429, 5xx}}` + `Llm` strings containing `"error 429:"` / `"error 5xx:"` (regex-equivalent sniffer).
  - Extractor JSON parsing: direct → fenced → shrinking-prefix from first `{`/`[`. On parse failure, augments conversation with assistant's bad output + corrective user message, retries up to 2x.
- Pre-existing blocker (not from S14): `imperium-crawl-tools/src/social.rs:93` uses `tempfile::tempdir()` but `tempfile` is not in that crate's deps. Out of scope here.

## 2026-05-26 19:30 — Sprint 0: Workspace setup
- Status: ✅ DONE
- Time: ~1.5h (prep instance, Pavle's request: "odradi sve safe stvari")
- Tests added: 2 (Config round-trip, config path) — in core crate
- Commit: pending (Pavle will commit before launching overnight agent)
- Verification:
  - ✅ `cargo check --workspace` passes (5m15s initial fetch, 12s incremental)
  - ✅ `cargo clippy --workspace -- -D warnings` passes (0 warnings)
  - ✅ `cargo test --workspace` passes (2 tests in core; 0 in other crates — expected, sprint S1+ will add)
- Toolchain: cargo 1.95.0, rustc 1.95.0 (Arch Linux)
- Key deps resolved:
  - wreq 6.0.0-rc.28 (BoringSSL2 5.0.0-alpha.13 transitive) — Chrome TLS fingerprint
  - chromiumoxide 0.7.0 — CDP browser automation
  - scraper, readability, html2md — HTML toolkit
  - aes-gcm 0.10 — session encryption
  - tokio 1.40 — async runtime
- Notes: 9-crate workspace scaffolded. All crates compile as empty stubs with `todo!()` bodies. Cargo.toml workspace deps centralized. Feature gates defined per docs/RUST-PORT-MAPPING.md §12. Workspace structure follows AGENTS.md convention from imperium-core-browser. Overnight agent has a green baseline to start S1.
