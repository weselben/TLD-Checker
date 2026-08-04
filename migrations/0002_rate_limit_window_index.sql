-- Index on rate_limit.window so the prune query
-- (DELETE FROM rate_limit WHERE window < ?) doesn't table-scan.
CREATE INDEX IF NOT EXISTS idx_rate_limit_window ON rate_limit (window);
