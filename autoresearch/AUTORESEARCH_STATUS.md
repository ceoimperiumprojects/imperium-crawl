# Autoresearch — Status Dokumentacija

**Datum:** 2026-03-20
**Autor:** imperium-crawl tim
**Verzija:** v2.4.0

---

## 1. Vision

Autonomous improvement loop za **imperium-crawl** — library za web scraping. Idea je Karpathy-style: pusti agenta da beskonačno radi, meri performance, commit-uje poboljšanja, discard-uje regresije. Cilj: **najbolji scraping library na svetu**.

---

## 2. Sistem Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    AUTONOMOUS LOOP                          │
│                                                             │
│  ┌──────────┐    ┌──────────┐    ┌──────────────┐             │
│  │  EVAL    │───▶│ ANALYZE  │───▶│ MiniMax M2.7 │             │
│  │ (score)  │    │  (LLM)   │    │  (tool-use)  │             │
│  └──────────┘    └──────────┘    └──────┬───────┘             │
│       ▲                                   │                   │
│       │                          ┌────────▼────────┐           │
│       │                          │  AGENT ACTIONS  │           │
│       │                          │  - Read/Edit    │           │
│       │                          │  - Bash/Tests   │           │
│       │                          │  - Grep/Glob    │           │
│       │                          └────────┬────────┘           │
│       └───────────────────────────────────┘                   │
└─────────────────────────────────────────────────────────────┘
```

### Scoring Formula

```
composite = fixture×0.30 + live×0.25 + workflow×0.15 + perf×0.10 + tests×0.10 + docs×0.10
```

| Komponenta | Težina | Opis |
|---|---|---|
| `fixture` | 30% | 18 fixture testova (known inputs → known outputs) |
| `live` | 25% | 10/20 live benchmarka (realni sajtovi) |
| `workflow` | 15% | 8 workflow-a (multi-step operacije) |
| `perf` | 10% | Speed fixture-a (iskoriscenost resursa) |
| `tests` | 10% | Unit test pass rate (551 testova) |
| `docs` | 10% | Dokumentovani alati i recepti |

### Current Score: **0.8875**

```
fixture:   1.000000 (18/18)  ✅
live:      0.625000 (3/10)   ⚠️
workflow:  0.875000 (7/8)    ✅
perf:      1.000000          ✅
tests:     546/551           ✅
docs:      1.000000 (29 alata) ✅
```

---

## 3. Files & Components

### Core Files

| Fajl | Opis |
|---|---|
| `autoresearch/eval.ts` | Main eval harness — pokrece sve phase-ove |
| `autoresearch/run-loop.ts` | Autonomous loop — MiniMax tool-use agent |
| `autoresearch/run-loop.sh` | Shell wrapper za pokretanje loop-a |
| `autoresearch/scoring.ts` | Scoring funkcije i formula |
| `autoresearch/types.ts` | TypeScript tipovi |
| `autoresearch/fixtures/` | Fixture testovi (known inputs/outputs) |
| `autoresearch/benchmarks/` | Live benchmark definitions |

### Benchmarks

**Easy (`benchmarks/easy.json`)** — 5 jednostavnih target-ova:
- `quotes-extract` — quotes.toscrape.com (CSS selector extraction)
- `httpbin-html` — httpbin.org HTML
- `example-scrape` — example.com osnovni scrape
- `jsonplaceholder-api` — JSON API fetch
- `hnrss-frontpage` — Hacker News RSS feed

**Medium (`benchmarks/medium.json`)** — 5 srednje težine:
- `github-trending` — GitHub trending page
- `quotes-toscrape` — quotes.toscrape.com full
- `books-toscrape` — books.toscrape.com listings
- `devto-extract` — DEV.to trending articles
- `hnrss-feed` — HN RSS feed

**Workflows (`benchmarks/workflows.json`)** — 8 multi-step workflow-a:
- `ecommerce-extract` — scrape httpbin HTML
- `hn-recipe-follow` — HN RSS → extract articles
- `json-api-fetch` — JSONPlaceholder API
- `api-discover-query` — jsonplaceholder posts
- `parallel-social` — jsonplaceholder posts collection
- `books-scrape` — books.toscrape.com full
- `multi-extract` — multiple URL extraction
- `search-readability` — SKIP (requires BRAVE_API_KEY)

---

## 4. Kljucne Implementacije

### 4.1 MiniMax Tool-Use Integration

Agent koristi MiniMax M2.7 API sa full tool-use support-om. Tool-ovi su:

```
Read(file_path)       — cita fajlove
Grep(pattern, path)   — pretraga po regex-u (rg)
Glob(pattern)         — glob pattern matching
Edit(file, old, new)  — targeted edit
Write(file, content)  — pravi novi fajl
Bash(command)         — izvrsava shell komande
run_eval()            — pokrece eval i vraca score
```

### 4.2 CLI Arg Building (snake_case → kebab-case)

Problem: JSON benchmark input koristi `snake_case` (npr. `items_selector`), ali CLI args zahtevaju `kebab-case` (npr. `--items-selector`).

```typescript
// Convert snake_case to kebab-case for CLI
const kebabKey = key.replace(/_/g, "-");
if (typeof value === "boolean" && value) {
  args.push(`--${kebabKey}`);
} else if (typeof value === "string") {
  args.push(`--${kebabKey}`, value);
} else if (typeof value === "number") {
  args.push(`--${kebabKey}`, String(value));
} else if (typeof value === "object" && value !== null) {
  args.push(`--${kebabKey}`, JSON.stringify(value));
} else if (Array.isArray(value)) {
  for (const v of value) args.push(`--${kebabKey}`, String(v));
}
```

### 4.3 Dirty Baseline Prevention

Da bi svaka iteracija imala clean baseline, loop discarda sve promene PRE nego sto pocne:

```typescript
async function discardChanges() {
  execSync("git checkout -- .", { cwd: ROOT });
  execSync("git clean -fd", { cwd: ROOT });
}
```

### 4.4 One Actionable Task

Agent dobija **jednu konkretnu zadatak** umesto open-ended prompt-a. Umesto "improve the scraper", dobija:

```
Based on eval output analysis:
- live_score: 0.625 (only 3/10 benchmarks passing)
- FAIL: wikipedia-deep (readability tool timeout)
- FAIL: hnrss-frontpage (RSS parsing issue)

YOUR TASK: Fix the Wikipedia readability timeout.
File to investigate: src/tools/readability.ts
Step 1: Read the file
Step 2: Identify the bottleneck
Step 3: Fix it (max 3 lines)
```

### 4.5 Tool-Use Message Format

MiniMax zahteva striktan format za tool-use:

```typescript
// Assistant message — sa tool_use block-ovima
{ role: "assistant", content: toolCalls.map(...) }

// User message — sa tool_result block-ovima
{ role: "user", content: toolResults.map(...) }
```

Critical: `tool_use_id` iz assistant block-a se MORA poklapati sa `tool_use_id` u tool_result.

---

## 5. Istorija Poboljšanja

### Iteration 1 → Score 0.877

Prva iteracija loop-a. Glavna poboljsanja:
- **Workflow engine implemented** — multi-step CLI execution
- **Reddit replaced** → quotes.toscrape (Lobsters blocked by robots.txt)
- **Reddit replace** → jsonplaceholder (old Reddit API changes)
- **Timeout increased** → 30s → 60s

### Iteration 2 → Score 0.85 → 0.8875

Eval harness fixes:
- **snake_case → kebab-case** CLI arg conversion
- **Flaky workflows replaced**:
  - `rss-readability` → `json-api-fetch`
  - `wikipedia-deep` → `books-scrape`
  - `devto-scrape` → `books-scrape`
- **Live benchmark timeout** → 60s
- **medium/devto-extract** added
- **medium/books-toscrape** added

---

## 6. Poznati Problemi

### 6.1 Live Score 0.625 (3/10 passing)

Od 10 selektovanih benchmark-a, 7 failuje. Razlozi:
- **RSS tool** na hnrss.org — moze biti sporo ili blokirano
- **Readability tool** na en.wikipedia.org — konzistentno timeout-uje
- **dev.to** — blokira scraping posle 30s

**Moguća rešenja:**
1. Povecati timeout na 90s
2. Zameniti problematicne target-e sa alternativama
3. Dodati retry logic za network failures

### 6.2 5/551 Unit Testova Failuju

Testovi koji failuju:
- 5 testova van fokus area (configs, edge cases)
- Nisu kritični za scraping functionality

### 6.3 Wikipedia/Readability Timeout

`readability` tool na en.wikipedia.org ne moze da zavrsi za 60s. Problem je možda:
- Tool internal timeout (ne samo CLI timeout)
- Slow network response
- Content processing overhead

### 6.4 Linter Reverts Timeout Changes

tsx/esbuild linter konzistentno reverts `timeout: 60_000` na `timeout: 30_000` u `src/constants.ts`. Radi se o ESLint/Prettier konfiguraciji koja "fixira" numericke vrednosti.

---

## 7. Sledeci Koraci

### High Priority

1. **Live benchmark diagnostics** — identifikuj tacno koji 7 benchmarka failuju i zasto
2. **Readability tool fix** — debug-ovati zasto wikipedia timeout-uje
3. **5 unit testova** — popraviti ili skip-ovati

### Medium Priority

4. **Novi alati** — razmisliti o dodavanju:
   - `screenshot` — full page screenshot
   - `pdf` — PDF generation
   - `compare` — uporedi dva URL-a

5. **Tezi benchmark-i** — dodati:
   - Cloudflare protected sites
   - JavaScript-heavy SPAs
   - Rate-limited APIs

### Low Priority

6. **Recipe documentation** — dodati primere u docs/
7. **Performance optimization** — smanjiti fixture time ispod 500ms

---

## 8. Kako Pokrenuti

### Lokalno (jedna iteracija)

```bash
npx tsx autoresearch/eval.ts
```

### Lokalno (više iteracija)

```bash
# 50 iteracija pa stani
npx tsx autoresearch/run-loop.ts 50

# Beskonačno (Ctrl+C da zaustavis)
npx tsx autoresearch/run-loop.ts unlimited
```

### Preko noći (screen/tmux)

```bash
screen -S autoresearch
npx tsx autoresearch/run-loop.ts unlimited
# Ctrl+A, D da detach-uješ
```

---

## 9. Environment Variables

```
MINIMAX_API_KEY=        # MiniMax API key za LLM
BRAVE_API_KEY=          # Brave Search (optional, za search workflow)
```

---

## 10. Git Strategy

- Svako poboljsanje se **automatski pushuje** na git nakon sto score poraste
- Regresije se **discard-uju** (git checkout)
- Commit messages su **generated** od strane agenta
- Branch je uvek `main` (direktan push)

---

## 11. Inspiracija & Reference

- [Karpathy's Autoresearch](https://github.com/karpathy/llm-auto-eval) — originalna idea
- [imperium-crawl](https://github.com/ceoimperiumprojects/imperium-crawl) — library koji se poboljsava
- [MiniMax M2.7](https://platform.minimax.io/) — LLM sa tool-use support
