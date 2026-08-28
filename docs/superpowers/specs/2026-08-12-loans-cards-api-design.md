# Loans & Cards API — Design Spec

**Date:** 2026-08-12
**Status:** Draft, pending user review
**Author:** Claude (with Luke Watters)

## 1. Overview

Expose the loan and credit card comparison data that already powers `loans.html`/`cards.html` as a monetized, key-authenticated JSON API, served from the existing Cloudflare Worker (`worker/worker.js`) that already handles `/go/{slug}` redirects and `/stats`.

**Business model (decided):** API keys with manual billing. No self-serve signup or payment processor in v1 — keys are issued by hand after a request comes in (email, form, whatever), and upgrading a key from free to paid is a manual DB update after Luke invoices or sends a payment link. The schema is shaped so self-serve Stripe billing can be bolted on later without a redesign (see §10).

## 2. Goals

- Serve the same loan/card data already on the site, as JSON, to paying and free-tier developers.
- Reuse existing infrastructure (the deployed Worker, D1 database, `STATS_TOKEN`-style secret-gating pattern) rather than standing up new services.
- Meter usage per key so tiers can be enforced and, later, billed accurately.
- Keep the existing `clicks` table and its "fresh start" migration pattern completely untouched — new tables only, additive migration.

## 3. Non-goals (v1)

- No self-serve signup UI, no Stripe/payment integration, no webhook-driven key issuance.
- No historical/time-series rate-tracker data — v1 is current-snapshot loans/cards only.
- No per-endpoint field filtering, pagination, or GraphQL — flat JSON array per resource.
- No public API status page / SLA.

## 4. Architecture

New routes added to the existing Worker, alongside `/go/{slug}` and `/stats`:

```
GET  /api/v1/loans
GET  /api/v1/cards
POST /admin/keys            (issue a new key — admin-only)
GET  /admin/keys/usage      (usage report — admin-only)
```

Data source: `data/loans.json` and `data/cards.json` are bundled into the Worker at deploy time, the same way `products.json` is compiled into `worker/products.generated.js` by `build-products.mjs`. A new small build step (`build-api-data.mjs`) copies the two files into `worker/api-data.generated.js` so the API always matches what's rendered on the comparison pages — no second source of truth, no drift.

**Response shape is a pass-through**, not a hand-maintained subset: the API returns whatever fields already exist in `data/loans.json`'s `loans` array / `data/cards.json`'s `cards` array, wrapped in a small envelope. This avoids hand-duplicating a field list that would silently drift from the real data whenever the comparison tables change.

```json
{
  "meta": {
    "generated": "2026-08-12T10:00:00.000Z",
    "last_full_review": "2026-07-22",
    "source": "https://borrowclever.ie/loans.html"
  },
  "data": [ /* raw objects from data/loans.json's `loans` array */ ]
}
```

Same shape for `/api/v1/cards`, sourced from `data/cards.json`'s `cards` array and `cardsMeta.last_full_review`.

## 5. Auth

- Header only: `Authorization: Bearer <key>`. No query-string keys — those leak into logs, proxies, and browser history.
- Key format: `bc_live_<32 url-safe base64 chars>`, generated with `crypto.getRandomValues` (available natively in Workers). The `bc_live_` prefix makes keys visually identifiable; the first 8 chars after the prefix are stored separately as `key_prefix` so Luke can identify a key in a support conversation without ever re-displaying the full secret.
- Only the SHA-256 hash of the full key is stored (`crypto.subtle.digest`, also native to Workers). The plaintext key is shown exactly once, at issuance, and never persisted.
- Missing, unknown, or revoked key → `401`. **Every tier requires a key, including free** — this is a deliberate decision (not an open question): it means every user of the API leaves an email address, which is the whole point of a free tier when the business model is manual upsell to paid.

## 6. D1 schema (additive — new file, not appended to `worker/schema.sql`)

`worker/schema.sql` currently opens with `DROP TABLE IF EXISTS clicks` — a "fresh start" migration pattern that is correct for a click-counter table but would be catastrophic if ever applied to a table holding customer API keys. For that reason the API tables live in a **separate migration file**, `worker/api-schema.sql`, applied once and never re-run destructively:

```sql
-- worker/api-schema.sql — API key & usage tables. Additive only. Never DROP these.

CREATE TABLE IF NOT EXISTS api_keys (
  key_hash    TEXT    PRIMARY KEY,   -- sha256(plaintext key), hex
  key_prefix  TEXT    NOT NULL,      -- first 8 chars after "bc_live_", for display only
  email       TEXT    NOT NULL,
  tier        TEXT    NOT NULL DEFAULT 'free',   -- 'free' | 'paid' — descriptive label
  daily_limit INTEGER NOT NULL DEFAULT 100,       -- actually enforced value, set at issuance
  status      TEXT    NOT NULL DEFAULT 'active',  -- 'active' | 'revoked'
  created_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_api_keys_email ON api_keys (email);

CREATE TABLE IF NOT EXISTS api_usage (
  key_hash TEXT    NOT NULL,
  day      TEXT    NOT NULL,          -- 'YYYY-MM-DD', UTC — same convention as `clicks.day`
  count    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key_hash, day)
);
CREATE INDEX IF NOT EXISTS idx_api_usage_day ON api_usage (day);
```

`tier` is informational bookkeeping; `daily_limit` is the number actually checked on every request, set from a tier default at issuance but editable per-row — so a bespoke deal for one customer never requires inventing a new tier.

**Tier defaults (decided, trivially changeable — a single `UPDATE`, not a schema or code change):**
- `free`: 100 requests/day
- `paid`: 10,000 requests/day

## 7. Request flow

1. Extract `Authorization: Bearer <key>`. Missing → `401 { "error": { "code": "unauthorized", "message": "Missing API key." } }`.
2. `SHA-256` the key, look up `api_keys` by `key_hash`.
   - Not found → `401 unauthorized`.
   - `status = 'revoked'` → `401 { "code": "revoked" }`.
3. Read today's `api_usage` row for that `key_hash` (UTC day, matching the `clicks` table convention).
   - `count >= daily_limit` → `429 { "code": "rate_limited", "message": "Daily limit of {N} requests reached.", "reset": "<ISO timestamp of next UTC midnight>" }`, with a `Retry-After` header (seconds until UTC midnight).
4. Otherwise: build the response from `worker/api-data.generated.js`, return `200` with `Cache-Control: private, no-store` (responses are per-key metered, so edge/browser caching would silently under-count usage).
5. `ctx.waitUntil()` the same fire-and-forget atomic upsert already used for `clicks`: `INSERT INTO api_usage (key_hash, day, count) VALUES (?, ?, 1) ON CONFLICT(key_hash, day) DO UPDATE SET count = count + 1`.

**Accepted race condition:** step 3's read-then-later-increment has a small TOCTOU window — two near-simultaneous requests close to the limit could both pass the check before either increments. This mirrors the existing `clicks` counter, which has the same characteristic and has been fine in production. Not worth a distributed lock for a manually-billed MVP; revisit if a customer is ever metered precisely enough that this matters financially.

## 8. Key issuance (admin, manual)

`POST /admin/keys`, gated by a new secret `ADMIN_TOKEN` (same pattern as `STATS_TOKEN` gating `/stats`, but read from a request header — `X-Admin-Token` — since this is a POST with a body, not a bookmarkable GET).

Request: `{ "email": "dev@example.com", "tier": "free" }`
Response (200, shown once): `{ "key": "bc_live_<...>", "key_prefix": "<...>", "tier": "free", "daily_limit": 100 }`

Upgrading a key to paid is a manual `UPDATE api_keys SET tier = 'paid', daily_limit = 10000 WHERE key_hash = ?` — no route needed for v1, run directly via `wrangler d1 execute`.

`GET /admin/keys/usage`, same `X-Admin-Token` gate, returns per-key usage (mirrors the existing `/stats` query shape) so Luke can see who's approaching their limit or worth upselling, without needing a dashboard.

## 9. Docs page

`/api/docs.html`, hand-authored static page (same pattern as `about.html`/`how-we-make-money.html` — not run through `build.js`'s injection pipeline). Covers: base URL, auth header, both endpoints with example request/response, rate limit headers, error codes, and how to request a key (an email address or form link). This page is fine to index normally — unlike the affiliate resources page discussed earlier, this is legitimate product content.

## 10. Explicitly deferred (not v1, but the schema doesn't block adding them later)

- Stripe Checkout + webhooks to auto-issue/revoke keys and auto-upgrade tier on payment.
- Self-serve signup form.
- Historical rate-tracker time-series endpoint.
- Per-key custom rate-limit windows (currently daily/UTC only).

## 11. Deployment steps (require explicit go-ahead before running against production)

1. Apply `worker/api-schema.sql` once via `wrangler d1 execute <DB> --file=worker/api-schema.sql` — additive, safe to run alongside the existing `clicks` table.
2. Set the new secret: `wrangler secret put ADMIN_TOKEN`.
3. `npm run deploy` (existing pipeline: build steps, then `wrangler deploy`), after adding the `build-api-data.mjs` step to `package.json`'s `build` script.

Per standing instruction, I will not run the D1 migration or touch the Worker's production secrets/config without confirming with Luke first — flagging that gate explicitly here since this spec, once approved, feeds into an implementation plan that will eventually reach this step.

## 12. Testing plan

`curl` against a preview/dev deploy:
- No `Authorization` header → `401 unauthorized`.
- Garbage key → `401 unauthorized`.
- Valid free key, first request → `200`, body matches `data/loans.json` shape, `api_usage` row created with `count = 1`.
- Same key, repeated past `daily_limit` → `429 rate_limited` with `Retry-After` header.
- Revoked key → `401 revoked`.
- `/api/v1/cards` mirrors all of the above independently (usage is per-key across both endpoints combined, not per-endpoint — one shared daily counter).

## 13. Open items to confirm with data files once filesystem access is restored

File access to `data/loans.json`/`data/cards.json` broke mid-session (`EPERM` on read/list, cause unclear — possibly a Terminal/Full Disk Access permission or a transient lock, not something fixable from inside this session). The pass-through response design in §4 means the exact field list doesn't need to be known now, but the implementation step should re-read both files to confirm they're flat arrays under `loans`/`cards` keys with a `meta.last_full_review` field, matching what `build.js` already assumes (`loansData.loans`, `loansData.meta`, `cardsData.cards`, `cardsData.meta`) — no design decision hinges on this, just a sanity check before writing `build-api-data.mjs`.
