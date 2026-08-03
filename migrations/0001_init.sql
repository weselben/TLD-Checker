-- D1 schema for TLD-Checker.
-- Only consensus-promoted rows live here; ephemeral votes live in the VoteAgg Durable Object.

-- One row per promoted domain. `expires_at` enforces the 30d cache TTL.
CREATE TABLE IF NOT EXISTS cache (
  fqdn        TEXT PRIMARY KEY,
  status      TEXT NOT NULL CHECK (status IN ('available', 'taken')),
  confirmed_at INTEGER NOT NULL,          -- unix seconds, server-side DoH confirmation time
  expires_at  INTEGER NOT NULL            -- unix seconds; row is stale after this
);
CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache (expires_at);

-- Per-IP request counters, bucketed to minute windows for /api/* endpoints.
CREATE TABLE IF NOT EXISTS rate_limit (
  bucket   TEXT NOT NULL,                 -- e.g. "challenge:1.2.3.4"
  window   INTEGER NOT NULL,              -- unix epoch floored to 60s
  count    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window)
);
