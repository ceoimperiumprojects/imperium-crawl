# API Recon — API Discovery and Network Analysis

Discover, categorize, and document APIs that websites use behind the scenes.

> **Full tool reference:** See [tool-reference.md](tool-reference.md) for all parameters.

---

## Tool Invocation

| Tool format | Param format |
|-------------|--------------|
| `imperium-crawl discover-apis --url URL` | --kebab-case flags |

---

## Available Tools

| Action | CLI Command | Key Params |
|--------|-------------|------------|
| Capture API calls | `imperium-crawl discover-apis --url URL` | `wait_seconds`, `include_headers`, `filter_content_type` |
| Test endpoint | `imperium-crawl query-api --url URL` | `method`, `headers`, `body`, `params` |
| Monitor WebSocket | `imperium-crawl monitor-websocket --url URL` | `duration_seconds`, `max_messages`, `filter_url` |
| Browser interact | `imperium-crawl interact --url URL --actions '[...]'` | `actions`, `session_id` |
| Scrape (fallback) | `imperium-crawl scrape --url URL` | `include`, `stealth_level` |

---

## Workflow

### Step 1: Initial Discovery

Capture all network requests during page load.

`imperium-crawl discover-apis --url "URL" --wait-seconds 8 --include-headers`

**Tuning `wait_seconds`:**

| Site type | wait_seconds | Why |
|-----------|-------------|-----|
| Simple static | 5 | Few async calls |
| Standard web app | 8 | Default, covers most cases |
| Heavy SPA (React/Angular/Vue) | 12-15 | Many async calls after initial load |
| Infinite scroll / lazy load | 15-20 | Scroll-triggered requests |

### Step 2: Categorize Discovered APIs

#### By Type
- **REST API:** Standard HTTP methods, JSON responses
- **GraphQL:** POST to `/graphql` with `query` in body
- **WebSocket:** `wss://` or `ws://` connections
- **Static resources:** CDN, images, fonts — usually noise, filter out

#### By Origin
- **First-party:** Same domain — these are the interesting ones
- **Third-party:** Analytics, ads, tracking — usually noise

#### By Authentication
- **No auth:** Public, freely accessible
- **Cookie-based:** Session cookies sent automatically
- **Bearer token:** `Authorization: Bearer ...` (often JWT)
- **API key:** Custom header `X-API-Key` or query param `?api_key=...`
- **CSRF token:** Anti-forgery tokens in headers/body

### Step 3: Investigate Endpoints

Test promising first-party endpoints.

**GET requests:**
`imperium-crawl query-api --url "https://api.example.com/data" --method GET`

**GraphQL introspection:**
`imperium-crawl query-api --url "https://example.com/graphql" --method POST --body '{"query":"{ __schema { types { name fields { name } } } }"}'`

**Pagination testing:** Try `?page=2`, `?offset=10`, `?cursor=...`, `?limit=20`

`imperium-crawl query-api --url "https://api.example.com/data?page=2&limit=20"`

**Important:** Only query GET or safe operations. Don't POST/PUT/DELETE unless user explicitly asks.

### Step 4: WebSocket Monitoring

If WebSocket connections found, or user specifically asks:

`imperium-crawl monitor-websocket --url "https://example.com" --duration-seconds 15 --max-messages 100`

For trading/chat/live feeds: increase to `30-60` seconds.

Filter specific connections:
`imperium-crawl monitor-websocket --url "URL" --filter-url "wss://specific-endpoint" --duration-seconds 30`

Analyze messages: format (JSON/binary), types (subscribe/heartbeat/data), channels, auth.

### Step 5: Compile Report

```markdown
## API Reconnaissance: [Target Site]

### Summary
- **Total endpoints discovered:** [N]
- **First-party APIs:** [N]
- **Third-party services:** [list]
- **Authentication:** [type(s) detected]

### API Inventory

| # | Endpoint | Method | Auth | Response | Notes |
|---|----------|--------|------|----------|-------|
| 1 | `/api/v2/products` | GET | None | JSON array | Paginated, 20/page |
| 2 | `/graphql` | POST | Bearer JWT | JSON | Introspection disabled |
| 3 | `wss://ws.example.com` | WS | Cookie | JSON messages | Real-time updates |

### Detailed Endpoint Analysis

#### [Endpoint — /api/v2/products]
- **Full URL:** `https://example.com/api/v2/products`
- **Parameters:** `page`, `limit`, `category`, `sort`
- **Response structure:** `{ data: [...], meta: { total, page, per_page } }`
- **Rate limiting:** [if detected]

### WebSocket Analysis (if applicable)
- **Connection URL:** `wss://...`
- **Protocol:** JSON pub/sub
- **Message types:** [list]

### Recommendations
- [Most useful endpoints for data extraction]
- [Auth requirements for protected endpoints]
- [Rate limiting considerations]
```

---

## Tool Combinations

### discover → query → monitor (Full Recon Chain)
```
discover_apis(url, wait_seconds: 10) → find all endpoints
  → query_api(endpoint, method, headers) → test each endpoint
    → monitor_websocket(url, duration: 30) → capture real-time data
```

### interact (login) → discover (Authenticated Recon)
```
interact(login_url, actions: [login steps], session_id: "recon") → authenticate
  → discover_apis(url, wait_seconds: 10) → capture authenticated API calls
    → query_api(endpoint) → test with auth cookies
```

**When:** APIs behind login wall. Session cookies from interact carry over.

```bash
# 1. Login
imperium-crawl interact --url "https://example.com/login" --session-id "recon" --actions '[{"type":"type","selector":"#email","text":"user@example.com"},{"type":"type","selector":"#password","text":"pass"},{"type":"click","selector":"button[type=submit]"},{"type":"wait","duration":3000}]'

# 2. Discover authenticated APIs
imperium-crawl discover-apis --url "https://example.com/dashboard" --wait-seconds 10 --include-headers
```

### snapshot → interact (Ref Login) → discover (Precise Auth)
```
snapshot(login_url) → find login form refs
  → interact(login_url, actions: [{ref: "N", ...}], session_id) → precise login
    → discover_apis(protected_url) → authenticated API recon
```

**When:** Login form has dynamic selectors or no unique CSS. Use ARIA refs for reliable targeting.

### websocket → query_api (REST Fallback)
```
monitor_websocket(url, duration: 30) → capture real-time data
  → discover_apis(url) → find REST endpoints serving same data
    → query_api(rest_endpoint) → use REST for easier programmatic access
```

**When:** Trading platforms, chat apps, dashboards with live data. REST is easier to automate than WebSocket.

---

## CLI Gotchas

- **Boolean flags:** `--include-headers` not `--include-headers true`
- **Method:** `--method POST` (GET/POST/PUT/PATCH/DELETE)
- **Body:** `--body '{"query":"..."}'` (JSON string in single quotes)
- **Headers:** `--headers '{"Authorization":"Bearer token","Content-Type":"application/json"}'`
- **Params:** `--params '{"page":"2","limit":"20"}'` (added as query params)
- **Output:** `--output-format json --pretty` for readable JSON

---

## Error Recovery

| Problem | Solution |
|---------|----------|
| No API calls captured | Increase `wait_seconds` to 15-20; site may need interaction to trigger requests |
| All third-party requests | Site loads content server-side — try HTML scraping instead |
| 401/403 on endpoints | Auth required — note auth type; try `interact` for login-based session |
| WebSocket refused | May need specific cookies — use `interact` login first, or `chrome_profile` |
| GraphQL introspection blocked | Analyze queries captured during page load instead |
| Too many requests captured | Use `filter_content_type: "application/json"` to focus on JSON APIs |

---

## Important Notes

- Legitimate research and auditing — never bypass auth or access unauthorized data
- API structures change — discoveries are point-in-time snapshots
- Don't hammer endpoints — rate limiting applies
- For automated extraction from discovered APIs → suggest `create_skill` with `query_api`
- `query_api` with `stealth_headers: true` (default) — sends realistic browser headers
