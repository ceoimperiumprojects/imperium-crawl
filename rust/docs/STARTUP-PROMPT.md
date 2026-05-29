# Startup prompt for the overnight rewrite agent

**How to use:** Open a new Claude Code terminal (Opus 4.7, xhigh effort). `cd` into this rust/ folder. Paste the prompt below as the first message.

```bash
cd /data/pavle/projekti/Projekti-desktop/Imperium-crawl/rust
claude   # or your launch alias
```

---

## Paste this:

```
You are the overnight Claude Opus 4.7 instance executing the imperium-crawl
TypeScript-to-Rust port. Pavle prepared this workspace earlier today
(2026-05-26 evening). He is asleep. Do not wake him.

READ THESE FOUR FILES BEFORE WRITING ANY CODE:
1. ./README.md
2. ./docs/RUST-PORT-MAPPING.md
3. ./docs/SPRINT-CONTRACT.md
4. ./docs/AGENT-BRIEF.md

The AGENT-BRIEF.md is your operating contract. Read it carefully. It tells you:
- The hard rules (never modify ../src/, never bundle sprints, never unwrap in libs)
- The sprint workflow (stub → implement → test → commit per sprint)
- When to stop and document a blocker
- How to write the morning report

Your scope tonight: complete sprints S1 through S5 from SPRINT-CONTRACT.md.
Stretch goal: S6 (Brave search). Hard stop at S6 — do NOT attempt S7 (PDF)
because it requires libpdfium.so which may not be on this machine.

Commit per sprint with message format: `feat(rust-port): sprint Sx - <name>`.
Do not push to remote. Pavle pushes after morning review.

The TypeScript source lives at ../src/ — READ ONLY. Do not modify TS files.

If you finish before 8 hours, stop at the last clean sprint boundary and write
MORNING-REPORT.md. Do not start a sprint you cannot finish.

If you get stuck for >30 minutes on a single sprint, write the blocker to
BLOCKERS.md, skip to the next independent sprint, and continue.

Sprint 0 (workspace setup) is already done. Cargo check should pass on the
empty workspace before you begin Sprint 1. Verify with:
  cargo check --workspace
If that fails, fix the resolution issue FIRST and document what you changed
in BLOCKERS.md, then proceed to Sprint 1.

Start with Sprint 1. Confirm you've read all four prep docs by quoting one
specific rule from AGENT-BRIEF.md back to me, then begin.
```

---

## What you should see in the first 5 minutes

The agent should:
1. Read README, RUST-PORT-MAPPING, SPRINT-CONTRACT, AGENT-BRIEF in that order
2. Quote a specific rule from AGENT-BRIEF (proving it actually read)
3. Run `cargo check --workspace` to verify baseline
4. Begin Sprint 1 by reading `../src/types/` and `../src/core/constants.ts`
5. Stub `imperium-crawl-core/src/types.rs`, `error.rs`, `tool.rs`, `config.rs`
6. Implement function bodies one at a time
7. Run `cargo test -p imperium-crawl-core`
8. Commit Sprint 1

If the agent skips ahead, refuses to read the docs, or starts working on
S5 immediately — interrupt it. Something's off.

---

## What to monitor

- Don't watch the whole thing. Go to sleep.
- Set an alarm for normal wake-up. The agent runs untended.
- Morning: read `MORNING-REPORT.md` first, then `BLOCKERS.md`, then `git log`.
