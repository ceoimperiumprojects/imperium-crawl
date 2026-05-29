# imperium-crawl (Rust)

Rust port of the imperium-crawl TypeScript scraping toolkit.

**Status:** Alpha — port in progress (started 2026-05-26).
**Source:** TypeScript v2.6.1 (`../src/`), 22,555 LOC, 43 tools.
**Target:** Feature parity + native single binary.

## Why Rust

Consolidation of stack with `imperium-core-browser` (also Rust). Shared crates:
- `wreq` for BoringSSL TLS fingerprinting (JA3/JA4 pixel-perfect Chrome match)
- `scraper` for HTML parsing
- `tokio` async runtime
- `v8` for JavaScript execution (where needed)

See `docs/RUST-PORT-MAPPING.md` for the npm → crate mapping.
See `docs/SPRINT-CONTRACT.md` for the rewrite execution plan.
See `docs/AGENT-BRIEF.md` for the agent operating contract.

## Workspace Layout

```
rust/
├── Cargo.toml                       # workspace root
├── crates/
│   ├── imperium-crawl-core/         # shared types, errors, config
│   ├── imperium-crawl-stealth/      # L1/L2 stealth engine (headers + TLS)
│   ├── imperium-crawl-browser/      # L3 stealth via chromiumoxide CDP
│   ├── imperium-crawl-sessions/     # cookie vault + AES-GCM encryption
│   ├── imperium-crawl-llm/          # Anthropic / OpenAI / MiniMax providers
│   ├── imperium-crawl-knowledge/    # adaptive learning per domain
│   ├── imperium-crawl-tools/        # 43 tools (scrape, crawl, ai-extract, ...)
│   ├── imperium-crawl-flows/        # browser workflow recorder + executor
│   └── imperium-crawl-cli/          # clap entry point, binary target
└── docs/
    ├── RUST-PORT-MAPPING.md
    ├── SPRINT-CONTRACT.md
    └── AGENT-BRIEF.md
```

## Build

```bash
cd rust
cargo build --release
./target/release/imperium-crawl --help
```

## Test parity

Goal: every vitest test in `../tests/` has a corresponding Rust test in the appropriate crate's `tests/` folder. Run:

```bash
cargo test --workspace
```

## Coexistence with TypeScript

The TypeScript code in `../src/` remains the source of truth during the port. Do **not** delete TS until Rust passes feature + test parity. Both can coexist:

- TS: `imperium-crawl` binary (npm published v2.6.1)
- Rust: `imperium-crawl-rs` binary (workspace target, alpha)

Cut over to Rust binary only after parity gate passes.
