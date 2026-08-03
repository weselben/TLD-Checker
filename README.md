# TLD-Checker

Cloudflare Worker + Vue 3 rebuild. The browser still walks the TLD list and
calls `dns.google`, but the worker backs every result with a consensus-promoted
cache: a domain only enters the D1 cache once **≥3 distinct voter IPs agree
≥90%** on `available` / `taken` *and* a server-side DoH spot-check matches.

> TLD-Checker.net is publicly based for transparency. No license — any copies
> outside of private or distribution of this material is prohibited.

## Architecture

| Layer | Path | Role |
| --- | --- | --- |
| Vue 3 SPA | `src/web/` | User input; does its own DoH sweep; reads cache via `/api/check`; reports votes via `/api/challenge` + `/api/report`. |
| Worker entry | `src/worker/index.ts` | Routes `/api/*` to handlers; everything else falls through to the `ASSETS` binding for the SPA. |
| API handlers | `src/worker/api/{check,challenge,report}.ts` | Cache lookup, HMAC challenge, vote ingestion. |
| VoteAgg Durable Object | `src/worker/durable/vote-agg.ts` | One stub per fqdn. Holds an ephemeral vote bucket and a 24h deny list. |
| D1 (binding `DB`) | `migrations/0001_init.sql` | `cache` (promoted rows, 30d TTL) and `rate_limit` (per-minute counters). **No votes table** — votes live only in the DO. |
| Shared types | `src/shared/` | Promotion rules + domain status enum shared between Worker, SPA, and tests. |

### Request flow

```
SPA            Worker               Durable Object      D1            dns.google
 |── /api/check ───────────────────────────────►  read fresh cache  ◄─────────┐
 |◄── cached rows ────────────────────────────────────────────────────────────┘
 |── /api/challenge ──► sign HMAC tokens (TTL 60s) ─────►                     │
 |── DoH lookups (still client-side)                                           │
 |── /api/report ──► verify token ──► POST /vote ──► bucket update            │
 |                       spot-check DOH ─────────────────────────────────────► │
 |                       if consensus reached: write cache row ──────────────►│
```

## Endpoints

### `GET /api/check?fqdns=a.com,b.net`
- Max 50 fqdns per call.
- Returns `{ cached: { fqdn: status } }` with **only** rows whose `expires_at > now`.

### `POST /api/challenge { fqdns: ["a.com", …] }`
- Max 50 fqdns per call, 120 req/min per IP.
- Returns `{ tokens: { fqdn: { token, ts } }, ttlMs: 60000 }`.

### `POST /api/report { results: [{ fqdn, status, token, ts }] }`
- Max 50 results per call, 120 req/min per IP.
- For each result: validate fqdn, verify HMAC token, ensure freshness
  (`ts` within 60s of `now`), forward to the per-fqdn VoteAgg stub.
- VoteAgg dedupes by voter IP and tracks per-side distinct voters.
- When `decidePromotion` returns `done=true` with a status, the worker fires
  one `dns.google/resolve` call; **only on match** does it write to the
  D1 `cache` row (`ON CONFLICT` refreshes `confirmed_at` and `expires_at`).

### Promotion rules

```ts
// src/shared/voting.ts
PROMOTE_MIN_VOTERS   = 3
PROMOTE_MIN_AGREEMENT = 0.9
PROMOTE_MAX_VOTERS   = 10   // bucket dies (no promotion) once it crosses this
```

In-memory state of the VoteAgg instance is intentionally ephemeral — it is not
synced across regions. A region restart simply drops votes for that fqdn; the
D1 cache survives.

## Configuration

### Cloudflare bindings (`wrangler.toml`)

| Binding | Kind | Notes |
| --- | --- | --- |
| `ASSETS` | ASSETS (SPA) | `directory = "./dist"`, `not_found_handling = "single-page-application"` |
| `DB` | D1 | `database_name = "tld-checker"`; create with `wrangler d1 create tld-checker` and replace `database_id` before first deploy. |
| `VOTE_AGG` | Durable Object | `class_name = "VoteAgg"`; declared in the `v1` migration. |

### Secrets

`VOTE_TOKEN_SECRET` is consumed via `env.VOTE_TOKEN_SECRET`. Provide it per
environment with:

```bash
wrangler secret put VOTE_TOKEN_SECRET              # required in prod
echo "dev-only-insecure-secret-change-me" > .dev.vars   # local-only
```

The `[vars]` block in `wrangler.toml` ships a placeholder for local dev
**only** — replace it with `wrangler secret put` before any real deploy.

### D1 migrations

```bash
wrangler d1 migrations apply DB --local     # while developing
wrangler d1 migrations apply DB --remote    # after the first deploy
```

## Local development

```bash
npm install
npm test                                  # vitest run — 38 tests
npm run build                             # vite build + tsc --noEmit
npm run preview                           # wrangler dev (SPA + Worker)
npm run dev                               # vite dev server (SPA only, proxies /api)
```

## CI

`.github/workflows/ci.yml` runs `npm ci`, `npm run build`, and `npm test` on
every push and PR. The deploy workflow publishes to the worker's `production`
environment on pushes to the integration branch.

## Credits

Every helper on this site is listed on the credits page (TBD).
