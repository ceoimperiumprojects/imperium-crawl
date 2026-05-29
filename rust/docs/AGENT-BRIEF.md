# Agent Operating Brief — imperium-crawl Rust Port

**For:** The Claude Opus 4.7 instance launched 2026-05-26 night to execute the rewrite.
**By:** The Claude instance that prepared this workspace.
**Authority:** Pavle Anđelković (CEO Imperium Tech) approved this plan and launched you.

---

## Your mission in one sentence

Port the TypeScript `imperium-crawl` (in `../src/`) to Rust in this workspace (`crates/`), one sprint at a time, with green tests at every commit, stopping cleanly at sprint boundaries when you hit blockers.

---

## Read FIRST, in this order

1. **`README.md`** — workspace overview
2. **`docs/RUST-PORT-MAPPING.md`** — npm → crate mapping (your dependency bible)
3. **`docs/SPRINT-CONTRACT.md`** — sprint order, scope, exit criteria
4. **`../package.json`** — TS dependency list to confirm mapping
5. **`../src/`** layout — read tree, don't read all files yet

Do NOT start coding until you've read all four documents. If anything in them is ambiguous, write the question to `BLOCKERS.md` and ask Pavle in the morning rather than guessing.

---

## Rules of engagement

### Hard rules (never violate)

1. **NEVER modify `../src/` or `../tests/`.** TypeScript is the read-only source of truth during the port.
2. **NEVER force-push, rebase, or rewrite git history.** Append commits only.
3. **NEVER skip the test suite.** A sprint is not complete without passing tests.
4. **NEVER guess a dependency.** If `RUST-PORT-MAPPING.md` doesn't cover something, document the gap.
5. **NEVER use `unwrap()` in library crates.** Use `?` or explicit `match`.
6. **NEVER introduce `unsafe` without a `// SAFETY: <reason>` comment.**
7. **NEVER bundle sprints.** Commit per sprint as defined in SPRINT-CONTRACT.

### Soft rules (apply judgment)

- Prefer feature-gating heavy deps (chromium, pdfium) over making them required
- Prefer `thiserror` for typed errors in library crates, `anyhow` for the CLI binary
- Prefer `tracing::debug!` over `println!` for development output
- Prefer `tokio::spawn` over OS threads
- Prefer `&str` and slices over owned `String` in function signatures where lifetime allows

### When in doubt

Read the TS source. Match the **behavior** (what the function returns / does to the world), not the **shape** (how it's implemented in JS).

Example: TS uses `class StealthFetcher { async fetch(...) }`. In Rust, this becomes a `pub fn fetch()` free function on a `StealthClient` struct, or a method on a trait. Either is fine; don't replicate OO inheritance hierarchies that don't fit Rust idioms.

---

## Sprint workflow (do this for each sprint)

1. **Read the sprint definition** in `SPRINT-CONTRACT.md`. Note the scope, dependencies, exit criterion, estimated time.
2. **Read the TS files** listed in the sprint scope. Take notes on:
   - Public API surface (what functions/classes are exported)
   - Side effects (file writes, network calls, env reads)
   - Edge cases (error handling branches)
   - Test fixtures used
3. **Stub the Rust API.** Write function signatures with `todo!()` bodies. Run `cargo check -p <crate>` — must compile.
4. **Implement one function at a time.** After each function, write its test. Run `cargo test -p <crate>`.
5. **When sprint scope is done:**
   - Run `cargo check --workspace` (must pass)
   - Run `cargo test -p <sprint-crate>` (must pass)
   - Run `cargo clippy -p <sprint-crate> -- -D warnings` (must pass)
   - Commit with message: `feat(rust-port): sprint Sx - <name>`
6. **Update `PROGRESS.md`** with: sprint done, time taken, blockers encountered, notes for future sprints.
7. **Check time budget.** If you've used >50% of allotted overnight window, prioritize finishing the current sprint cleanly over starting a new one.

---

## What "done" looks like for tonight

**Realistic overnight target (8 hours):**
- ✅ Sprint 1 (core types + errors)
- ✅ Sprint 2 (stealth L1 + L2)
- ✅ Sprint 3 (sessions + encryption)
- ✅ Sprint 4 (browser L3)
- ✅ Sprint 5 (5 HTML tools)
- 🎯 STRETCH: Sprint 6 (Brave search)

**If you finish faster, do not start Sprint 7 (PDF) without checking.** PDF requires the `libpdfium.so` binary which may not be on this machine — better to leave for Pavle's morning review.

**If you finish slower, stop at the last completed sprint.** Half-finished sprints break the parity gate. Better to ship 3 clean sprints than 5 with half-done implementations.

---

## How to report results in the morning

Write `MORNING-REPORT.md` in the workspace root with:

```markdown
# Overnight Rewrite Report — <date>

## Sprints completed
- ✅ S1: ...
- ✅ S2: ...

## Sprints attempted but blocked
- ⚠️ S5: stuck on <issue>, see BLOCKERS.md#S5

## Sprints not attempted
- S6 onwards: time ran out / dependency missing / etc

## Tests
- Total tests added: N
- Passing: N
- Failing: 0 (must be 0 — if not, sprint isn't done)

## Workspace status
- `cargo check --workspace`: ✅ pass
- `cargo test --workspace`: ✅ pass (or which crates fail)
- `cargo clippy --workspace`: ✅ pass

## Files changed
- crates/imperium-crawl-core/: N files, M LOC
- crates/imperium-crawl-stealth/: N files, M LOC
- ...

## Time breakdown
- S1: 2.5h (est 3h)
- S2: 9h (est 8h, blocked 1h on TLS profile lookup)
- ...

## Discovered gaps in plan
- (any incorrect assumption in RUST-PORT-MAPPING.md or SPRINT-CONTRACT.md)
- (any missing dependency)

## Suggested next session
- Start with S6 (Brave search)
- Investigate <unresolved question>

## Open questions for Pavle
1. ...
2. ...
```

---

## Don't waste cycles on

These are NOT goals for tonight:
- ❌ Performance optimization (write naive Rust first, optimize after parity)
- ❌ Replacing the TS version (it stays as the production binary)
- ❌ Cleaning up TS code (out of scope)
- ❌ New features not in TS source
- ❌ Refactoring the existing `imperium-core-browser` crate
- ❌ Documentation beyond rustdoc comments + PROGRESS.md
- ❌ CI/CD setup (Pavle handles)
- ❌ Publishing to crates.io (premature)
- ❌ GUI / TUI polish (functional CLI first)

---

## When to escalate to Pavle (write to BLOCKERS.md and stop)

- A required dependency doesn't exist or is unmaintained
- Two crates in the mapping table conflict at compile time (transitive dep clash)
- A TS file you need to port has logic that depends on Node-specific APIs with no Rust equivalent (e.g., `child_process` semantics, `Buffer` quirks)
- A test fixture is missing
- You need an API key or credential that isn't in `.env.example`
- You hit a 30-minute stuck point on any single sprint

Don't wake Pavle up. Document the blocker. He reviews in the morning.

---

## Cultural note

Pavle is an 18-year-old solo founder under GTM pressure (Đorđe direktiva: "stop building, start selling"). Every hour you spend on this rewrite is an hour he isn't selling to ReVesta clients. **Optimize for**: clean, complete sprints that he can review fast in the morning and either approve-merge or hand back to you tomorrow night.

**DO NOT optimize for**: showing off, exhaustive sprint completion at the cost of quality, or "while I'm at it" refactors of unrelated code.

---

## Final reminder

If you're not sure whether to do X — don't do X. Document the question in `BLOCKERS.md` and continue with the next sprint that has no dependency on X. Pavle prefers a half-finished port with clear questions over a fully-finished port full of guesses.

Good luck. Keep commits small. Keep tests green. Keep the report honest.

— Claude (prep instance, 2026-05-26 evening)
