-- worker/api-schema.sql — API key & usage tables for /api/v1 and /admin routes.
-- Additive only. Unlike worker/schema.sql's "fresh start" pattern, this file
-- must NEVER contain a DROP TABLE for api_keys — that table holds real
-- customer keys once this is live.

CREATE TABLE IF NOT EXISTS api_keys (
  key_hash    TEXT    PRIMARY KEY,          -- sha256(plaintext key), hex — never store the plaintext key
  key_prefix  TEXT    NOT NULL,              -- first 8 chars after "bc_live_", for display/support lookups only
  email       TEXT    NOT NULL,
  tier        TEXT    NOT NULL DEFAULT 'free',    -- 'free' | 'paid' — descriptive label, not what's enforced
  daily_limit INTEGER NOT NULL DEFAULT 100,        -- the number actually checked on every request
  status      TEXT    NOT NULL DEFAULT 'active',   -- 'active' | 'revoked'
  created_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_api_keys_email ON api_keys (email);

CREATE TABLE IF NOT EXISTS api_usage (
  key_hash TEXT    NOT NULL,
  day      TEXT    NOT NULL,                 -- 'YYYY-MM-DD', UTC — same convention as clicks.day
  count    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key_hash, day)
);
CREATE INDEX IF NOT EXISTS idx_api_usage_day ON api_usage (day);
