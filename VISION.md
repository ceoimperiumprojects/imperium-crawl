# Imperium-Crawl Vision: Autonomous Scraper Factory

**Status**: Working draft — living document
**Last updated**: 2026-03-16

---

## The Goal

Imperium-crawl should be **the Playwright of web scraping** — but smarter. Where Playwright gives you browser primitives, imperium-crawl gives you **complete scraping infrastructure**: stealth, sessions, rate limiting, anti-bot evasion, knowledge, and reusable skills. Any downstream product (SimpleSurplus, lead gen, price monitoring) writes only business logic. Zero infrastructure code.

---

## Current State (v2.3.1)

What works:
- 3-tier stealth escalation (headers → TLS → browser)
- Session management with cookie persistence + encryption + `isSessionValid()`
- Knowledge engine (per-domain learning)
- 28 CLI tools (scrape, interact, search, extract, etc.)
- Skill system (reusable extraction recipes, including `interact` type)
- Browser automation (click, type, paginate, evaluate)
- Network interception, snapshots, auth vault
- Per-domain rate throttle, L1/L2 cookie injection

What's missing for "factory" status:
- Skills can't compose (no chaining/dependencies)
- No workflow recording/replay
- No schema validation on extracted data
- No scheduling/monitoring layer
- CLI interactive mode needs polish

---

## Phase 1: Interactive CLI + Workflow Recording → Skill

### The Idea

Imperium-crawl already works as:
1. **CLI tool** — `imperium-crawl scrape https://...`
2. **Node library** — `import { execute } from "imperium-crawl/tools/scrape"`

The missing piece: **interactive CLI sessions** where you explore a site hands-on, and then **save that session as a reusable skill**.

### How It Would Work

```bash
# Start an interactive scraping session
imperium-crawl explore https://www2.miamidadeclerk.gov/ocs/

# Inside the session, you use familiar CLI commands:
> navigate https://www2.miamidadeclerk.gov/usermanagementservices/?hs=ocs
> type #userName myuser
> type #password mypass
> click input[name=btnCall]
> wait 2000
> screenshot                    # visual check
> snapshot                      # see element refs
> navigate https://www2.miamidadeclerk.gov/ocs/
> click "[role=button]:has-text('Local Case')"
> select #caseYear 2025
> type #caseSeq 006110
> click button[type=submit]
> wait 3000
> evaluate "return JSON.stringify(window.__ocsCapture)"
> save-skill ocs-case-lookup    # <-- saves everything as a skill!
```

### What `save-skill` Does

Records the entire session and exports it as a skill config:

```json
{
  "name": "ocs-case-lookup",
  "tool": "interact",
  "url": "https://www2.miamidadeclerk.gov/ocs/",
  "session_id": "ocs-miami-dade",
  "actions": [
    { "type": "type", "selector": "#userName", "text": "{{username}}" },
    { "type": "type", "selector": "#password", "text": "{{password}}" },
    { "type": "click", "selector": "input[name=btnCall]" },
    { "type": "wait", "duration": 2000 },
    { "type": "navigate", "url": "https://www2.miamidadeclerk.gov/ocs/" },
    { "type": "click", "selector": "[role=button]:has-text('Local Case')" },
    { "type": "select", "selector": "#caseYear", "value": "{{case_year}}" },
    { "type": "type", "selector": "#caseSeq", "text": "{{case_seq}}" },
    { "type": "click", "selector": "button[type=submit]" },
    { "type": "wait", "duration": 3000 },
    { "type": "evaluate", "script": "return JSON.stringify(window.__ocsCapture)" }
  ],
  "parameters": {
    "username": { "source": "env", "key": "OR_USERNAME" },
    "password": { "source": "env", "key": "OR_PASSWORD" },
    "case_year": { "source": "input" },
    "case_seq": { "source": "input" }
  }
}
```

Then anyone can run it:
```bash
imperium-crawl run-skill ocs-case-lookup --case_year 2025 --case_seq 006110
```

Or from code:
```typescript
import { execute } from "imperium-crawl/tools/run-skill";
await execute({ name: "ocs-case-lookup", case_year: "2025", case_seq: "006110" });
```

### Key Advantages Over MCP

| | MCP Server | CLI Interactive + Skill |
|---|---|---|
| Dependencies | @modelcontextprotocol/sdk | None — just imperium-crawl CLI |
| Who drives it | LLM (needs API key) | Human (direct control) |
| State | MCP protocol overhead | Simple CLI session state |
| Reusability | Depends on LLM remembering | Skill JSON is portable, versioned |
| Debugging | Opaque protocol | Direct terminal, familiar commands |
| Deployment | Needs MCP-compatible client | Works anywhere Node runs |

### Implementation Plan

1. **`src/cli/explore.ts`** — Interactive REPL with browser session
   - Commands: navigate, click, type, select, wait, screenshot, snapshot, evaluate, scroll
   - Live browser visible (headed mode) for visual feedback
   - Action history tracked in memory

2. **`src/cli/recorder.ts`** — Session recorder
   - Logs every action with timestamps
   - Detects parameterizable values (text inputs, env vars)
   - Suggests template variables

3. **`src/cli/save-skill.ts`** — Export recorded session → skill JSON
   - Prompts for parameter names
   - Auto-detects login flows (username/password → env vars)
   - Validates skill by re-running

4. **`src/skills/parameters.ts`** — Skill parameter resolution
   - `{{env:OR_USERNAME}}` → reads from .env
   - `{{input:case_year}}` → from CLI args or API input
   - `{{computed:date_today}}` → dynamic values

5. **CLI**: `imperium-crawl explore <url>` starts interactive mode

---

## Phase 2: Smart Skill Composition

### Skill Chains

Currently each skill is a single step. Real workflows need multiple:

```json
{
  "name": "miami-dade-full-enrichment",
  "type": "chain",
  "steps": [
    {
      "skill": "ocs-case-lookup",
      "input": { "case_number": "$input.case_number" },
      "output": "case_data"
    },
    {
      "skill": "or-records-search",
      "input": { "defendant": "$case_data.defendants[0]" },
      "output": "or_records"
    },
    {
      "skill": "pa-property-lookup",
      "input": { "folio": "$or_records.folio" },
      "output": "property_data"
    }
  ],
  "output": "merge($case_data, $or_records, $property_data)"
}
```

### Conditional Branching

```json
{
  "if": "$case_data.is_estate",
  "then": { "skill": "probate-search" },
  "else": { "skill": "foreclosure-docs" }
}
```

### Implementation

- **`src/skills/chain.ts`** — Chain executor with variable interpolation
- **`src/skills/conditions.ts`** — If/else/switch evaluation
- **CLI**: `imperium-crawl run-chain miami-dade-full-enrichment --case_number "2025-006110-CA-01"`

---

## Phase 3: Autonomous Scraper Generation

### Auto-Discovery

Given a URL, imperium-crawl should:
1. **Detect platform type** — is this Tyler Odyssey? RealAuction? Custom CMS?
2. **Map form fields** — what inputs does the search form expect?
3. **Identify data tables** — where are the results rendered?
4. **Infer pagination** — how does the site paginate?
5. **Generate skill** — output a complete skill config

### How

Use Claude (via API) as the reasoning engine:
1. Navigate to URL, take screenshot + snapshot
2. Send to Claude: "Analyze this page and identify form fields, data tables, pagination"
3. Claude returns structured analysis
4. imperium-crawl generates skill from analysis
5. Test skill with sample input
6. Refine if needed (Claude in the loop)

```bash
imperium-crawl auto-discover https://broward.realforeclose.com/
# → Detects: RealAuction platform
# → Generates: skill "broward-auction-scan"
# → Tests: scans today's date, finds N items
# → Saves skill if test passes
```

This is essentially **the interactive CLI flow automated** — instead of a human exploring, the system does it programmatically using Claude.

---

## Phase 4: Monitoring & Scheduling

### Cron-like Skill Execution

```bash
imperium-crawl schedule --skill miami-auctions --cron "0 8 * * 1-5" --notify webhook
```

### Data Change Detection

```json
{
  "skill": "property-tax-monitor",
  "schedule": "daily",
  "compare": "deep-diff",
  "notify": ["webhook:https://...", "email:user@..."]
}
```

### Health Dashboard

- Skill success rates
- Per-domain block rates
- Session expiry alerts
- Knowledge engine stats
- Rate limit violations

---

## Architecture Evolution

### Current
```
SimpleSurplus → imperium-crawl (library import)
                     ↓
              [tools, stealth, sessions, knowledge]
```

### Target
```
SimpleSurplus ─┐
Other App ─────┤
CLI Interactive┤──→ imperium-crawl (library / CLI)
Cron Jobs ─────┘           ↓
                    [tools, stealth, sessions, knowledge]
                           ↓
                    [skills, chains, recorder]
                           ↓
                    [scheduler, monitor, alerts]
```

---

## Concrete Next Steps (prioritized)

### Immediate (this week)
1. **`explore` command** — interactive REPL with persistent browser session
2. **Action recorder** — log every action during interactive session
3. **`save-skill` command** — export recorded session to skill JSON

### Short-term (this month)
4. **Skill parameters** — template variables (env, input, computed)
5. **Skill chain runner** — execute multi-step skill sequences
6. **Schema validation** on extracted data

### Medium-term (next quarter)
7. **Auto-discovery** — platform type detection from URL
8. **Scheduling** — cron-like skill execution
9. **Skill sharing** — export/import skill packs

### Long-term
10. **Autonomous generation** — Claude generates skills from site analysis
11. **Self-healing** — detect broken skills, auto-repair with Claude
12. **Distributed execution** — run skills across multiple IPs/proxies

---

## Design Principles

1. **Zero infrastructure in consumers** — all scraping complexity lives in imperium-crawl
2. **Progressive enhancement** — CLI → library → interactive → autonomous, each builds on the last
3. **Learn from every request** — knowledge engine improves over time
4. **Session-first** — cookies, auth, state persist across calls and processes
5. **Composable** — small tools combine into complex workflows
6. **Observable** — every action is logged, recorded, replayable
7. **CLI-native** — no protocol overhead, works in any terminal, pipes to anything
