# Autoresearch Program — imperium-crawl

You are an autonomous research agent. Your mission is to continuously improve imperium-crawl's web scraping toolkit by making small, measured changes and evaluating their impact.

## The Loop

```
FOREVER:
  1. Analyze current score and identify lowest-scoring component
  2. Hypothesize an improvement (stealth, parsing, extraction, etc.)
  3. Make a SMALL code change (src/**, SKILL/**)
  4. Run: npx tsx autoresearch/eval.ts --verbose
  5. Read the __SCORE__ line and compare to previous score
  6. IF score improved → git commit with description → KEEP
  7. IF score decreased → git checkout -- . → DISCARD
  8. Log result to results.tsv
  9. REPEAT — never stop
```

## Sacred Files (DO NOT MODIFY)

These files define the evaluation criteria. Modifying them would be cheating:

- `autoresearch/eval.ts` — Main eval harness
- `autoresearch/scoring.ts` — Score calculations
- `autoresearch/types.ts` — Type definitions
- `autoresearch/fixtures/` — All fixture files and loader
- `autoresearch/benchmarks/` — All benchmark files and loader
- `tests/` — Existing unit tests (DO NOT delete, only add)

## Modifiable Files

You can freely modify:

- `src/**` — All source code (tools, stealth, utils, sessions, skills, recipes)
- `SKILL/**` — Skill documentation
- `tests/` — Add new tests (never remove existing)

## Score Components

| Component | Weight | What Moves It |
|-----------|--------|---------------|
| fixture (30%) | Parsing accuracy on fixed HTML | Improve htmlToMarkdown, cleanHtml, extractStructuredData, noise selectors |
| live (25%) | Real website scraping success | Stealth improvements, anti-bot bypasses, JS rendering |
| workflow (15%) | Multi-step pipeline completion | Chain executor robustness, tool interop |
| perf (10%) | Fixture suite speed | Optimize parsing, reduce allocations |
| tests (10%) | Unit test pass rate | Add tests, fix broken tests |
| docs (10%) | SKILL doc completeness | Document all tools, add recipes |

## Research Directions

### Priority 1: Fixture Score (30% weight)
- Improve NOISE_SELECTORS in `src/utils/markdown.ts` (more ad/popup patterns)
- Better table preservation in markdown conversion
- Improve structured data extraction edge cases
- Handle malformed HTML more gracefully

### Priority 2: Stealth & Live Score (25% weight)
- Fingerprint randomization (canvas, WebGL, fonts, screen resolution)
- Human behavior simulation (mouse, scroll, typing patterns)
- Adaptive rate limiting (parse Retry-After, per-domain token bucket)
- Proxy health checking (track success rates)
- Viewport rotation (randomize from realistic distribution)
- WebRTC leak prevention
- Timezone/locale matching to proxy geo

### Priority 3: New Tools
- `pdf` — PDF text/table extraction (unlocks academic, business content)
- `graphql` — GraphQL introspection and query
- `watch` — Page change monitoring
- `wayback` — Archive.org historical access
- `fingerprint` — Browser fingerprint profile management
- `humanize` — Human behavior injection

### Priority 4: Doc Score (10% weight)
- Ensure every tool in allTools[] is documented in SKILL/
- Document all built-in recipes
- Add usage examples for each tool

## Rules

1. **Small changes** — One logical change per iteration. Never rewrite entire files.
2. **Always eval** — Every change must be evaluated before keeping.
3. **Never break tests** — If tests fail, the gate closes (score = 0).
4. **Never break build** — If build fails, the gate closes (score = 0).
5. **Never delete tests** — Only add new tests, never remove existing ones.
6. **Log everything** — Every experiment gets a results.tsv entry.
7. **Never stop** — Keep iterating. There's always something to improve.
8. **Commit messages** — Format: `autoresearch: <what changed> (score: X.XXXXXX)`

## Understanding the Output

```
score:     0.650000    ← Composite (this is THE number)
fixture:   0.900000    ← 9/10 fixtures passed
live:      0.000000    ← Not implemented yet
workflow:  0.000000    ← Not implemented yet
perf:      1.000000    ← At or above baseline speed
tests:     691/691     ← All tests passing
docs:      0.850000    ← 85% doc coverage
```

The `__SCORE__:X.XXXXXX` line at the end is machine-readable — use it for automated comparisons.

## results.tsv Format

```
commit	timestamp	score	fixture	live	workflow	perf	tests	docs	duration_ms	status	description
abc1234	2024-03-15T10:00:00Z	0.650000	0.900000	0.000000	0.000000	1.000000	691/691	0.850000	12345	baseline	initial baseline
def5678	2024-03-15T10:05:00Z	0.670000	0.950000	0.000000	0.000000	1.000000	693/693	0.850000	11234	keep	improved noise selectors
```

## Getting Started

1. Run baseline: `npx tsx autoresearch/eval.ts --baseline --verbose`
2. Study the scores — which component is lowest?
3. Make a targeted improvement
4. Eval again and compare
5. Keep or discard based on score delta
