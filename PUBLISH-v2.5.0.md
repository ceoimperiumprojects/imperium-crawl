# Publish checklist — imperium-crawl v2.5.0

Pre-built tarball lives at:
`/run/media/pavle/Data/Projekti-desktop/Pumpmyride/imperium-crawl-2.5.0.tgz` (333 KB, 498 files)

## Pre-publish

- [ ] `npm run build` (verify `dist/` is current — Agent 5 already ran it, re-run if you've touched any `src/`)
- [ ] `npm test` (current focused local run: build passes; 35 focused Flow/CAPTCHA/recorder tests pass; full suite has 1 preexisting Playwright screenshot timeout — unrelated)
- [ ] `npm pack --dry-run` (eyeball what ships — should match the existing `.tgz`)
- [ ] CHANGELOG.md reviewed
- [ ] README.md reflects 39 tools + v2.5.0 tools section
- [ ] `git status` clean except intentional changes
- [ ] Commit + tag (see below)
- [ ] Push: `git push && git push --tags`

## Commit (conventional commits)

```bash
cd /run/media/pavle/Data/Projekti-desktop/Pumpmyride

git add \
  src/tools/pdf-extract.ts src/tools/watch.ts src/tools/monitor.ts \
  src/flows src/tools/record-flow.ts src/tools/run-flow.ts src/tools/serve-flow.ts \
  src/tools/list-flows.ts src/tools/inspect-flow.ts src/tools/validate-flow.ts \
  tests/pdf-extract.test.ts tests/watch.test.ts tests/monitor.test.ts \
  tests/flows.test.ts \
  src/tools/index.ts src/tools/manifest.ts src/constants.ts \
  tests/tool-registry.test.ts \
  package.json package-lock.json \
  README.md CHANGELOG.md PUBLISH-v2.5.0.md

git commit -m "$(cat <<'EOF'
feat: add pdf extraction, monitoring, and flow tools (v2.5.0)

- pdf-extract: native PDF text/table/metadata extraction via pdfjs-dist
- watch: hash-based URL change detection with webhook alerts
- monitor: multi-URL daily digest generator
- Imperium Flows: record, run, serve, list, inspect, and validate reusable browser workflows

Tests: build passing; focused Flow/CAPTCHA/recorder tests passing
Deferred: OCR fallback, daemon mode, LLM summarize, Chrome extension recorder
EOF
)"

git tag -a v2.5.0 -m "v2.5.0 — pdf-extract, watch, monitor, Imperium Flows"
```

## Publish (the one-liner)

```bash
cd /run/media/pavle/Data/Projekti-desktop/Pumpmyride && npm login && npm publish --access public
```

(If already logged in, drop `npm login &&`.)

## Post-publish

- [ ] Verify: https://www.npmjs.com/package/imperium-crawl → v2.5.0 live
- [ ] GitHub Release: copy v2.5.0 section from CHANGELOG.md into new Release at `github.com/ceoimperiumprojects/imperium-crawl/releases/new?tag=v2.5.0`
- [ ] Fresh install smoke test:
  ```bash
  npm install -g imperium-crawl@latest
  imperium-crawl --version   # → 2.5.0
  imperium-crawl pdf-extract --help
  imperium-crawl watch --help
  imperium-crawl monitor --help
  imperium-crawl record-flow --help
  imperium-crawl run-flow --help
  imperium-crawl serve-flow --help
  ```
- [ ] Social post (drafts below)

## Rollback plan

If something's broken in published 2.5.0:

```bash
# Mark the version deprecated (doesn't delete; users still see warning):
npm deprecate imperium-crawl@2.5.0 "Use 2.5.1 — see CHANGELOG"

# Ship a patch:
# 1. Fix the bug
# 2. Bump package.json + src/constants.ts to 2.5.1
# 3. Add CHANGELOG [2.5.1] entry
# 4. npm run build && npm test
# 5. npm publish --access public
```

Never `npm unpublish` after 72h — it's permanent and breaks downstream.

---

## Social media drafts

### LinkedIn (SR, building-in-public vibe)

```
imperium-crawl v2.5.0 je live na npm-u. 🚀

Dodato 9 novih komandi, sve zero-API-key za core workflow:

• pdf-extract — izvuci tekst, tabele i metadata iz bilo kog PDF-a
   Testirano na 98 strana CBAM Guidance dokumenta — 199K karaktera, confidence 0.99.

• watch — hash-based detekcija promene na URL-u.
   Cron-friendly. Webhook kad se nešto promeni.

• monitor — multi-URL intelligence digest.
   JSON config, markdown report. Daily competitive intel u 10 linija koda.

• Imperium Flows — snimi browser workflow jednom, pokreni ga iz CLI-ja ili izloži kao API.
   Headed recording, CAPTCHA-aware runtime, family/variant flow JSON.

39 alata sad, 580 passing testova, 0 dolara.

npm i -g imperium-crawl
github.com/ceoimperiumprojects/imperium-crawl

Next up: Chrome extension Flow Recorder, selector healing UI, OCR fallback + Claude Vision.

Gradi se dalje.
```

### Twitter/X (EN, punchy)

```
imperium-crawl v2.5.0 shipped 🚀

9 new tools, zero API keys:

• pdf-extract — native PDF → text/tables/metadata (tested on 98-page CBAM doc)
• watch — hash-based URL change detection, cron-friendly
• monitor — multi-URL intelligence digest
• Imperium Flows — record browser workflows, run them anywhere, expose as API

39 tools. 580 passing tests. MIT.

npm i -g imperium-crawl
```

---

## Estimated time to publish (cold start, no blockers)

~10–12 minutes:
- 1 min: `git status` + visual diff review
- 2 min: `npm run build && npm test` (if re-running)
- 1 min: stage + commit + tag
- 1 min: `git push && git push --tags`
- 1 min: `npm login` (first time only)
- 1 min: `npm publish --access public`
- 3 min: GitHub Release + fresh install smoke test
- 2 min: social post
