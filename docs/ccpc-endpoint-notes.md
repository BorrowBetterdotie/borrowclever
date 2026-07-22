# CCPC compare.ccpc.ie loan endpoint — research notes

**Last verified: 2026-07-22**

This documents an **undocumented, unpublished** internal API that backs the
CCPC's (Competition and Consumer Protection Commission) public loan
comparison tool at `https://compare.ccpc.ie/`. It is not a supported public
API — no stability guarantee, no published schema, no rate-limit docs. It
could change or disappear without notice. If `scripts/check-rates-ccpc.mjs`
starts failing, re-run the exploration steps below before assuming the
script is broken.

## Endpoint

```
POST https://compare.ccpc.ie/loan/get-loans
Content-Type: application/json

{"Amount": 10000, "Term": 5, "TypeId": 5}
```

- Fields are **PascalCase** — lowercase/camelCase field names produce
  `HTTP 500 {"Message":"Something went wrong when tried to get loans!"}`.
- `Term` is in **years**, not months. `Term: 60` (interpreted as 60 years)
  returns very few/no results since it exceeds every product's
  `MaximumTerm`; `Term: 5` (5 years = 60 months) is what returns
  borrowclever's baseline product set.
- `Amount` genuinely filters/tiers results — several lenders (Bank of
  Ireland, PTSB, An Post Money, Avant Money) return a **lower** Rate at
  higher loan amounts (see "Amount changes the Rate" below). Must use
  `Amount: 10000` to match products.json's tracked €10,000/60-month
  methodology — do not treat Amount as cosmetic.
- Response is a JSON array, `Content-Type: application/json; charset=utf-8`.
  An empty/no-match query (e.g. an unused `TypeId`) returns `[]` with
  `HTTP 200` — absence of results is not an error condition.
- An invalid path (e.g. a typo'd endpoint) does **not** 404 — it returns
  `HTTP 200` with `Content-Type: text/html` (the Angular app's SPA shell).
  **Do not trust HTTP status alone to detect a broken endpoint** — check
  `Content-Type` is `application/json` and that the body actually parses
  as an array before trusting the data.

## TypeId taxonomy (confirmed by content, not assumed)

Queried `TypeId` 1–10 at `Amount: 10000, Term: 5` and inspected
`ProviderName`/`ProductName` in each response (raw dumps in
`research/ccpc-typeid-{n}.json`, gitignored — not committed):

| TypeId | Category | Count | Sample products |
|---|---|---|---|
| 1 | Personal current accounts | 3 | AIB Personal Bank Account |
| 2 | Student current accounts | 2 | AIB Student Plus, PTSB Student Current Account |
| 3 | Credit cards | 15 | AIB be/Click/Platinum Visa, BOI Classic/Platinum Advantage |
| 4 | Student credit cards | 8 | AIB/BOI student cards |
| **5** | **Personal loans (incl. SBCI green, credit union)** | **17** | **AIB/BOI/PTSB/An Post/Avant personal + SBCI loans, Credit Union buckets** |
| 6 | Student loans | 2 | AIB Student Contribution Charge Loan |
| 7 | Savings accounts | 11 | AIB Online Saver, BOI GoalSaver |
| 8 | Deposit accounts | 45 | Raisin.ie partner deposits, BOI/PTSB fixed terms |
| 9 | (empty at this Amount/Term) | 0 | — |
| 10 | (empty at this Amount/Term) | 0 | — |

**`TypeId: 5` is confirmed as the personal-loan category** — it is the only
bucket containing every loan product type borrowclever tracks (standard
personal loans, SBCI Home Energy Upgrade / green loans, and a generic
Credit Union bucket), and its entries' `Rate` values line up with
`products.json`'s current published rates for every matching lender/product
pair tested (see "Cross-check against products.json" below). This confirms
the guess from the initial manual test — it was not assumed without
checking.

Only `TypeId: 5` is relevant to borrowclever's loan tables. TypeId 3/4
(credit cards) use a **separate endpoint**
(`POST /credit-card/get-credit-cards`, documented in an earlier session —
not re-verified here since this task is loans-only) and are out of scope
for `check-rates-ccpc.mjs`.

## Response field shape (TypeId 5)

Each array element:

```json
{
  "Id": 7967,
  "ProductName": "SBCI Home Energy Upgrade Loan",
  "ProviderName": "ptsb",
  "Logo": "/Content/Uploads/4/PTSB Logo 108x108.jpg",
  "Website": "https://www.ptsb.ie/borrowing/sbci-heuls-loan/",
  "MaximumTerm": 10,
  "AdditionalInformation": "<p>...HTML...</p>",
  "MaximumAmount": 14999.0,
  "Rate": 4.2,
  "FootNotes": [],
  "337": { "Name": "Maximum term:", "Value": "10", "GroupId": 29, "GroupName": "Loan details", ... },
  "88":  { "Name": "Rate type:", "Value": "Variable", "GroupId": 29, "GroupName": "Loan details", ... },
  "90":  { "Name": "Set-up fees:", "Value": "None", ... },
  "367": { "Name": "Personal loans", "Value": "0", "GroupId": 77, "GroupName": "Purposes", ... },
  "370": { "Name": "Home energy upgrade loans (SCBI)", "Value": "1", "GroupId": 77, "GroupName": "Purposes", ... }
}
```

### Field mapping used by `check-rates-ccpc.mjs`

| Field | Meaning | Notes |
|---|---|---|
| `ProviderName` | Lender | Inconsistent casing (`"ptsb"` lowercase, `"Bank of Ireland"` title case, `"AIB"` upper) — normalise before matching. |
| `ProductName` | Product name | Free text, not a stable id — fuzzy-match against `products.json`/`lenders.csv` product names. |
| `Rate` | **The rate to compare against `products.json`'s `rate`/`apr` field.** | Single number, no `%`. No separate nominal-vs-APR fields exist in this response — CCPC exposes one rate figure per loan product. Cross-checked against 8 known-correct `products.json` values at `Amount:10000, Term:5` and every one matched exactly (see below), so this is treated as directly comparable to whatever borrowclever currently tracks for that product. |
| `MaximumAmount` | Ceiling for the amount tier the returned `Rate` applies to | Useful for sanity-checking why a lender's `Rate` changes across `Amount` queries. |
| `MaximumTerm` | Max term in years the product is available for | Products with `MaximumTerm` below the query `Term` are simply omitted from the response, not flagged. |
| `Website` | Lender's product page | Not currently used by the cross-check script; kept in raw dumps for reference. |
| Numeric-keyed sub-objects (e.g. `"88"`, `"337"`) | Extra structured attributes (rate type, fees, eligible purposes) | Keys are arbitrary CCPC internal field IDs, not stable across products — only `Name`/`Value`/`GroupName` are meaningful, and only `"Rate type:"` (fixed/variable) is currently useful to borrowclever. Not required for the cross-check script's core rate comparison, so not parsed by it.  |

**No monthly repayment, cost-of-credit, or total-repayable fields exist in
this response.** Those figures in `products.json` are computed locally from
the rate via the standard amortization formula, not sourced from CCPC —
this integration only cross-checks the rate itself, not the derived figures.

## Cross-check against products.json (Amount: 10000, Term: 5)

Confirms `TypeId: 5`'s `Rate` field is the right one to compare:

| products.json slug | products.json rate | CCPC Rate | Match? |
|---|---|---|---|
| aib-loan-sbci-energy | 3.55% | 3.55 | ✅ |
| aib-loan-green | 6.40% | 6.4 | ✅ |
| ptsb-loan-sbci-energy | 4.20% | 4.2 | ✅ |
| boi-loan-green | 6.50% | 6.5 | ✅ |
| boi-loan-personal | 8.30% | 8.3 | ✅ |
| ptsb-loan-personal | 7.20% | 7.2 | ✅ |
| avant-loan-personal | 8.50% | 8.5 | ✅ |
| aib-loan-personal | 8.95% | 8.95 | ✅ |
| anpost-loan-personal | 8.40% | 8.4 | ✅ |
| cu-loan-average | 10.42% | 10.42 (as "Standard Personal Loan (Rate varies by CU)") | ✅ |
| **boi-loan-sbci-energy** | **2.95%** | **3.0** | ❌ conflict — flagged in products.json's own notes already (BOI's own page vs CCPC disagree; BOI's live page was used as the more current source) |
| aib-loan-home | 8.95% | *(absent — no matching product in CCPC's TypeId:5 list)* | single-source only |
| revolut-loan-personal | 6.50% | *(absent — Revolut has no entries in TypeId:5 at any Term tested)* | single-source only |
| firstchoice-loan-personal | 8.84% | *(absent — CCPC only exposes a generic "Credit Union" bucket, not First Choice specifically)* | single-source only |

These absences and the one pre-existing conflict are exactly the kind of
signal `check-rates-ccpc.mjs` is meant to surface (`SINGLE_SOURCE_ONLY`,
`SOURCES_CONFLICT`) rather than resolve automatically.

## Amount changes the Rate (tiered pricing — confirmed)

Re-querying at `Amount: 50000, Term: 5` shows several lenders return a
**lower** `Rate` at the higher amount than at `Amount: 10000`:

| Lender / product | Rate @ €10k | Rate @ €50k |
|---|---|---|
| Bank of Ireland Personal Loan | 8.3 | 7.1 |
| ptsb Personal Loan | 7.2 | 6.2 |
| An Post Money Personal Loan | 8.4 | 6.9 |
| Avant Money Personal Loan | 8.5 | 6.7 |
| AIB Personal Loan | 8.95 | 8.95 (unchanged) |

This confirms `Amount` is not cosmetic — the cross-check script must query
at `Amount: 10000` to match the €10k baseline `products.json` values are
quoted against, not an arbitrary amount.

## Term behaviour

`Term` (years) filters which products are eligible/returned — it does not
change the `Rate` value of a returned product. Tested `Term` 1, 2, 3, 4, 5,
7, 10 at `Amount: 10000`:

- `Term` 1–5: 17 results (full personal-loan set — every tracked product's
  `MaximumTerm` is ≥5 years).
- `Term` 7: 13 results (some short-max-term products drop out).
- `Term` 10: 11 results (further drop-off).

**`Term: 5`** (5 years = 60 months) is the correct value to match
borrowclever's standard €10,000/60-month baseline and returns the full
product set.

## Error / edge-case behaviour observed

| Scenario | Response |
|---|---|
| Unused `TypeId` (e.g. 9, 10 at this Amount/Term) | `HTTP 200`, `[]` — valid empty result, not an error |
| Nonsense `TypeId` (e.g. 999) | `HTTP 200`, `[]` — same as above, no validation error |
| Wrong/typo'd endpoint path | `HTTP 200`, `Content-Type: text/html` — Angular SPA shell, **not** JSON. Must check `Content-Type` and attempt JSON parse, not rely on status code. |
| Lowercase/camelCase field names in request body | `HTTP 500`, `{"Message":"Something went wrong when tried to get loans!"}` |

No rate limiting was observed during this research (roughly 20 sequential
requests with a 1.5s delay between them, no 429s or throttling). The
cross-check script still applies a polite delay and identifying
User-Agent regardless, since this is an internal tool being used outside
its intended (browser, single comparison run) context.

## Re-verification

If `check-rates-ccpc.mjs` starts reporting `CCPC_SCHEMA_CHANGED_OR_UNAVAILABLE`
across the board, re-run the TypeId sweep (`Amount: 10000, Term: 5,
TypeId: 1..10`) and diff the field shape against this document before
assuming the integration needs a rewrite — CCPC could have renamed fields,
changed the TypeId taxonomy, or moved the endpoint.
