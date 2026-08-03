# TLD-Checker

Crowdsourced Top Level Domain availability checker — rebuilt on Cloudflare Workers + D1 + Vue 3.

## Architecture

- **Client (Vue 3 SPA):** Checks dns.google DoH for every TLD, shows live results. Cached consensus results are fetched from `/api/check` first.
- **Worker (JSON API):**
  - `GET /api/check?fqdns=...` — trusted, unexpired D1 cache rows only.
  - `POST /api/challenge { fqdns: [...] }` — issues HMAC-SHA-256 vote tokens (60 s TTL).
  - `POST /api/report { results: [{ fqdn, status, token, ts }] }` — verifies tokens, forwards votes to the Durable Object. When a domain reaches ≥3 distinct voters with ≥90% agreement, the Worker does ONE server-side DoH spot-check. If it matches, the canonical row is written to D1 (30 d TTL).
- **D1:** Trusted cache + per-IP minute-window rate-limit counters.
- **Durable Object (`VoteAgg`):** Ephemeral per-fqdn vote buckets + 24 h deny list for mismatched spot-checks.
- **Anti-spoof model:** HMAC tokens + replay protection, quorum + agreement, server-side DoH spot-check on promotion, deny list on mismatch, per-IP rate limits.

## Local dev

```bash
npm ci
npm run build
npm test
wrangler dev --local        # worker on :8787, SPA proxied by Vite on :5173
```

## Deploy

```bash
# 1) Create D1 + get IDs
wrangler d1 create tld-checker
# -> update wrangler.toml database_id

# 2) Apply migrations
wrangler d1 migrations apply DB --remote

# 3) Set secrets (once)
wrangler secret put VOTE_TOKEN_SECRET

# 4) Deploy
npm run deploy
```

## Required Cloudflare secrets

| Secret | Purpose |
|--------|---------|
| `CLOUDFLARE_API_TOKEN` | CI deploy (GitHub Actions) |
| `CLOUDFLARE_ACCOUNT_ID` | CI deploy (GitHub Actions) |
| `VOTE_TOKEN_SECRET` | HMAC key for vote tokens — never commit, set via `wrangler secret put` |

## Scripts

| Command | Action |
|---------|--------|
| `npm run build` | `vite build` (SPA → `dist/`) + `tsc --noEmit` (Worker type-check) |
| `npm test` | All vitest tests (Worker + frontend) |
| `npm run deploy` | Build + `wrangler deploy` |
| `npm run db:migrate` | Apply D1 migrations to remote |

## CI

`.github/workflows/ci.yml` runs on every push/PR to `main` and `feat/cloudflare-worker-vue`: install → build → test.
`.github/workflows/deploy.yml` deploys on push to `main` (requires the three secrets above).

## Legacy cleanup

Removed: PHP hosting (`.htaccess`, `index.php`, `de/`, `en/`, `imprint/`, `js.php`), `docker-compose.yml`, `nginx/`, old asset images.