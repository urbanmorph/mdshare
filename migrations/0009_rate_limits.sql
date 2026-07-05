-- Durable rate-limit counters for the public create endpoint.
--
-- The in-memory limiter in lib/rate-limit.ts is per-isolate, so a cap like
-- "50 documents/day/IP" never held across Cloudflare's many edge isolates —
-- a spam bot created 133 docs in a single day despite the cap. This table
-- backs the daily create limit with D1 so the counter is shared globally.
--
-- Rows are self-expiring: the window resets once reset_at passes, and the
-- daily cron in src/worker.ts sweeps stale rows.
CREATE TABLE IF NOT EXISTS rate_limits (
  key       TEXT PRIMARY KEY,   -- "<action>:<ip>"
  count     INTEGER NOT NULL DEFAULT 0,
  reset_at  INTEGER NOT NULL    -- epoch ms; window resets once passed
);
