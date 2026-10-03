-- worker/api-schema-002-monthly-limit.sql — one-off migration for databases
-- created from the original api-schema.sql (daily limits). Limits are now per
-- UTC calendar month. Run once; fresh databases get monthly_limit directly
-- from api-schema.sql and must NOT run this.
--
--   npx wrangler d1 execute borrowclever-clicks --remote --file=api-schema-002-monthly-limit.sql

ALTER TABLE api_keys RENAME COLUMN daily_limit TO monthly_limit;
