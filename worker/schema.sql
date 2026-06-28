-- borrowclever.ie click tracker — D1 schema (v2)
-- Aggregate counts only: no IPs, no cookies, no per-user data.
-- Fresh start: drops and recreates the table.

DROP TABLE IF EXISTS clicks;
DROP INDEX IF EXISTS idx_clicks_day;

CREATE TABLE clicks (
  slug     TEXT    NOT NULL,
  lender   TEXT    NOT NULL,
  category TEXT    NOT NULL,
  product  TEXT    NOT NULL,
  day      TEXT    NOT NULL,            -- 'YYYY-MM-DD' (UTC)
  count    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (slug, day)
);

CREATE INDEX idx_clicks_day ON clicks (day);
