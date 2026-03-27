# Imperium-Crawl Improvements (from SimpleSurplus development)

Last updated: 2026-03-17

## DONE (v2.3.1 — 2026-03-16)

### ✅ 1. respectRobots per-request override
**Fix**: Added `respect_robots` option to scrape tool schema, wired through `fetchPage({ respectRobots })`.

### ✅ 2. Session login detection — `isLoggedIn(sessionId)` / `isSessionValid()`
**Fix**: `SessionManager.isLoggedIn(id)` — checks session exists + has non-expired cookies.
**Tested**: 30+ consecutive OCS lookups, login only fires once.

### ✅ 3. Interact paginate action type
**Fix**: New `paginate` action — loop → extract_script → click next → wait → accumulate all pages.

### ✅ 4. L1/L2 session cookie injection
**Fix**: `StealthOptions.sessionId` → `buildCookieHeader()` → injected into L1/L2 headers.

### ✅ 5. Per-domain rate limiter
**Fix**: `DomainThrottle` class in `fetcher.ts` — 500ms default, uses knowledge engine value.

### ✅ 6. Skill system: interact tool type
**Fix**: `InteractSkillConfig` type, `runInteract()` dispatch, pagination support.

### ✅ 7. Sessions export in package.json
**Fix**: Added `"./sessions"` to package.json exports.

---

## DONE (v2.4.0 — 2026-03-17)

### ✅ 8. Interactive CLI: `explore` command
**Fix**: `imperium-crawl explore <url>` — 15-command interactive REPL with persistent browser session.
**Commands**: navigate, click, type, select, wait, screenshot, snapshot, evaluate, scroll, save-skill, undo, history, back, reload, exit.
**File**: `src/cli-explore.ts`

### ✅ 9. Workflow recording: `save-skill` command
**Fix**: `ActionRecorder` records all actions during `explore` session. `save-skill <name>` exports to interact skill JSON with auto-detected parameters.
**File**: `src/cli-recorder.ts`

### ✅ 10. Skill parameters / template variables
**Fix**: Full parameter system — `{{env:VAR}}`, `{{input:field}}`, `{{computed:X}}` (8 computed values: date_today, timestamp, date_iso, year, month, day, unix_ms, uuid).
**File**: `src/skills/parameters.ts`

### ✅ 12. Skill chains
**Fix**: Chain executor with `$step.field` variable resolution between steps, safe conditions evaluator (no eval) for if/else branching.
**Files**: `src/skills/chain.ts`, `src/skills/conditions.ts`

### ✅ 13. Gemini/LLM rate limit handling
**Fix**: LLM full-jitter backoff retry in `src/llm/retry.ts`. Covers Gemini 503 bursts.

### ✅ 14. OCS session staleness — session refresh tracking
**Fix**: `actionCount/needsRefresh/resetActionCount` added to SessionManager. Sessions now track how many actions have been executed and flag when refresh is needed.
**File**: `src/sessions/manager.ts`

### ✅ 15. `utils/*` package exports
**Fix**: `utils/*` now exported in package.json. SimpleSurplus can import `fetchPage` directly.

### ✅ 18. Knowledge engine CLI tool (#29)
**Fix**: `knowledge` tool added — query per-domain knowledge, inspect safe_rate_limit, success rates, anti-bot detection.
**File**: `src/tools/knowledge.ts`

---

## TODO — Still Open

### Priority: HIGH

#### ~~11. OR search — name format fix~~ ✅ FIXED 2026-03-17
**Root cause (confirmed)**: Two issues: (1) OCS returns "LAST, FIRST" format, old code split on whitespace leaving trailing comma. (2) OR API changed — `partyName` is now a single combined field ("LAST FIRST"), not separate `partyName`/`firstName`/`middleName`. Also needs `dateRangeFrom`, `dateRangeTo`, `documentType`, `searchT` params instead of `token`.
**Fix**: SimpleSurplus `src/drivers/miami-dade/or.ts` — comma-aware name parsing + correct API params.
**Result**: 4/7 leads now return records (35, 18, 17 records). Remaining 3 fail due to session save race condition (#21).

#### 22. FJ PDF download failing for majority of leads
**Problem**: 47/54 leads have a Final Judgment entry in OCS docket (selectBestDocket finds it), but only 12/47 successfully downloaded the FJ PDF. 35 leads have FJ docket match with enc_id but no fj.pdf on disk.
**Root cause**: OCS PDF download (`downloadOcsPdf()` in `pdf-download.ts`) uses a Playwright session to fetch via `GetSDocumentByEvent`. During batch runs, the OCS session goes stale after ~16 lookups (issue #14 — OCS DOM staleness). Once stale, PDF downloads silently fail or return empty responses.
**Also possibly**: Session save race condition (#21) causes session loss between downloads.
**Where**: `src/drivers/miami-dade/pdf-download.ts` → `downloadOcsPdf()` — needs session refresh before each download, or batch smaller groups with session reset between them.
**Impact**: HIGH — 75% of FJ PDFs are not downloaded, meaning FJ breakdown data is missing for most leads. This directly affects lead value calculations.
**Fix approach**:
  1. Integrate `needsRefresh` check (#19) before each PDF download
  2. Reset OCS session every 10-15 downloads
  3. Retry failed downloads with fresh session
  4. Consider L1/L2 download (#20) to avoid browser dependency

#### 23. OCR must be used as fallback for all PDF extraction
**Problem**: Some scanned PDFs (court documents) have no extractable text. Gemini handles these natively but MiniMax needs OCR.
**Current state**: OCR pipeline exists (`src/utils/pdf-ocr.ts` — pdftoppm + tesseract) and is used by MiniMax path. Gemini reads PDFs natively.
**Requirement**: When primary extraction fails (empty result), automatically retry with OCR → MiniMax path.
**Where**: `src/extraction/router.ts` — after Gemini extraction, check if result is empty/insufficient. If so, force OCR + MiniMax retry.
**Complaint special case**: Already handled — `COMPLAINT_STOP` regex stops OCR at VERIFICATION page (router.ts line 87).

### Priority: MEDIUM

#### 19. OCS `needsRefresh` integration in SimpleSurplus
**What**: v2.4.0 added `actionCount/needsRefresh` to SessionManager, but SimpleSurplus doesn't use it yet.
**Where**: `src/drivers/miami-dade/ocs.ts` — check `session.needsRefresh` before each lookup, navigate to fresh OCS URL if true.
**Benefit**: Proactive staleness prevention instead of reactive retry-on-failure.

#### 20. PDF download via L1/L2 + session cookies
**Opportunity**: OCS/OR PDF downloads currently use L3 (full browser). Now that L1/L2 cookie injection works, these could use `smartFetch(pdfUrl, { sessionId, forceLevel: 1 })`.
**Benefit**: ~10x faster bulk PDF downloads — no browser spin-up per file.
**Blocker**: Verify OCS/OR image APIs work with L1 requests (binary download, no JS needed).

#### 21. Session save race condition (ENOENT on .tmp rename)
**Problem**: During sequential OR enrichment, `interact` logs `Failed to save session: ENOENT: no such file or directory, rename '...or-miami-dade.json.tmp' -> '...or-miami-dade.json'`. Causes subsequent evaluate calls to fail (`success: false`), losing records for ~40% of leads.
**Cause**: Session dir might not exist yet, or concurrent writes race on the .tmp → final rename. Observed on every other request in a 7-lead sequential run.
**Where**: `src/sessions/manager.ts` `save()` — add `mkdir -p` before write, or retry on ENOENT, or use `writeFileSync` as fallback.
**Impact**: HIGH — breaks OR enrichment for ~40% of leads in a batch run.

### Priority: LOW

#### 17. `pricing.json` config schema (SimpleSurplus side)
**Observation**: Auto-discover logs `Failed to load pricing.json: Cannot read properties of undefined (reading 'platform')` on every run.
**Fix location**: SimpleSurplus `src/drivers/auto-discover.ts` — null-check before reading platform.

---

## Strategic Roadmap

See `/home/pavle/Desktop/Projekti/Pumpmyride/VISION.md`:
- **Phase 1** ✅ Interactive CLI (`explore`) + workflow recording (`save-skill`) + skill parameters
- **Phase 2** ✅ Skill chains + conditional branching
- **Phase 3** — Auto scraper generation (Claude analyzes site → generates skill)
- **Phase 4** — Scheduling + monitoring
