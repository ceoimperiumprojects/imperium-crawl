# Morning Review Checklist — for Pavle, 2026-05-27 ujutru

After the overnight agent finishes, run through this checklist in order. Stop at the first ❌ and decide what to do.

---

## 1. Quick visual scan (2 min)

```bash
cd /data/pavle/projekti/Projekti-desktop/Imperium-crawl/rust
cat MORNING-REPORT.md    # what the agent says it did
cat BLOCKERS.md          # what got stuck
git log --oneline -20    # actual commit history
```

✅ Should see:
- `MORNING-REPORT.md` exists and lists completed sprints S1, S2, S3 (minimum)
- `BLOCKERS.md` has either "no blockers" or 1-3 documented blockers with alternatives
- `git log` shows commits matching `feat(rust-port): sprint Sx - <name>` pattern

❌ Red flags:
- No MORNING-REPORT.md → agent crashed or skipped reporting
- Commits without sprint Sx prefix → agent improvised
- A single huge commit covering everything → agent ignored "one sprint per commit" rule
- Hundreds of files changed → agent went off-rails

---

## 2. Compiler health (1 min)

```bash
cargo check --workspace
```

✅ Pass = good baseline.
❌ Fail = agent left broken state. Look at the error, decide if it's a sprint S5 leftover (revert that sprint) or a real bug.

```bash
cargo clippy --workspace -- -D warnings
```

✅ Pass = clean lints.
❌ Many warnings = agent ignored clippy step in DoD. Run `cargo clippy --fix` after morning coffee.

---

## 3. Test health (3 min)

```bash
cargo test --workspace 2>&1 | tail -40
```

✅ Should see:
- All tests pass
- Each completed sprint contributed tests (S1 ~5 tests, S2 ~8, S3 ~3, S4 ~5, S5 ~10+)

❌ Red flags:
- `#[ignore]` on tests that should be running → agent skipped to claim sprint done
- 0 tests added for a "completed" sprint → not actually completed
- Failing tests → sprint not done; revert that sprint's commit

---

## 4. Behavioral spot check (5 min)

Pick ONE completed tool from S5 (scrape, crawl, extract, readability, map) and compare TS vs Rust output:

```bash
# TS version
cd /data/pavle/projekti/Projekti-desktop/Imperium-crawl
node dist/index.js scrape https://example.com > /tmp/ts-out.json

# Rust version
cd rust
cargo run -p imperium-crawl-cli -- scrape https://example.com > /tmp/rust-out.json

# Diff
diff /tmp/ts-out.json /tmp/rust-out.json | head -50
```

✅ Output equivalent (may differ in whitespace/ordering, not semantics).
❌ Wildly different → agent misread TS source. Document in BLOCKERS, fix tonight.

---

## 5. Code quality spot check (5 min)

Open ONE Rust file the agent wrote. Look for:

- `// SAFETY:` comments on any `unsafe` blocks
- No `.unwrap()` outside of `tests/` or `main.rs`
- Functions have rustdoc `///` comments where the TS function had JSDoc
- Sprint number tagged in TODO comments where work continues
- Error variants use `thiserror`, not `String` for error types

✅ Code looks idiomatic Rust.
❌ Looks like TS transliterated → ask agent to fix in next session (don't fix yourself, that's the agent's job).

---

## 6. Decide: merge, hand back, or revert

After steps 1-5, you have three options:

### Option A: Merge (sprints S1-S3 look clean)
```bash
git push origin rust-port-2026-05-26
# Or merge to main if branch was main
```

### Option B: Hand back (1-2 sprints have issues)
Add notes to `BLOCKERS.md` describing what to fix. Next agent session starts with "Read BLOCKERS.md, fix the issues, then continue from where you stopped."

### Option C: Revert (everything is wrong)
```bash
git reset --hard <commit-before-sprint-1>
```
Then update `AGENT-BRIEF.md` with whatever rule the agent violated and try again tonight.

---

## 7. Update Obsidian (2 min)

Append to `~/Obsidian/Imperium/Daily/2026-05-27.md`:

```markdown
## Imperium-crawl Rust port — overnight result
- Sprints completed: S1-S?
- Blockers: N
- Decision: merged / handed-back / reverted
- Next session: continue from S?
```

---

## 8. GTM check (1 min)

**Đorđetova direktiva check:**
- Did this rewrite touch any customer-facing ReVesta work? NO (internal infra)
- Am I going to slow down GTM today because of it? NO (review takes 15 min)
- Should I do another agent session tonight? Only if S1-S5 merged clean. Else, GTM first.

---

## Total time

~20 minutes. If you're spending more than 30 minutes reviewing, the agent did too much and you need to tighten the sprint contract for tonight's session.
