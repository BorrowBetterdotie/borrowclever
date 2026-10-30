# Irish mortgage market research — 2026-07-22

Data-gathering and schema groundwork for a future mortgage comparison.
**Nothing here is published to the live site.** The populated dataset is
[`mortgages.json`](../mortgages.json) (553 rate rows, 11 lenders); the CCPC
endpoint mechanics are documented in
[`ccpc-endpoint-notes.md`](ccpc-endpoint-notes.md) (mortgage section).

## Why a separate file, not products.json

Mortgages fragment simultaneously by LTV band, BER rating, fixed-term
length and buyer type — a single product line has up to 24 price points
(BOI: 8 BER tiers × cashback variants; AIB: 3 LTV bands × 8 terms × green
variants). The flat €10k/60-month loans model cannot rank these, so
`mortgages.json` is a sibling file with its own schema (camelCase field
names mirroring `products.json` conventions: `slug`, `lender`,
`lenderName`, `rateType`, `notes`, etc.). It also carries a `lenders`
array recording distribution channel and fetchability per lender, and a
`meta` block documenting field semantics.

One deviation from the requested schema: LTV bands are stored as
`ltvMinPercent`/`ltvMaxPercent` pairs (not just a max) because Irish
lenders price genuine ranges (">50% ≤80%"), and a max alone would make
"≤80%" and ">50% ≤80%" indistinguishable.

## Confirmed lender list (as of 2026-07-22)

| Lender | Legal/trading name | Distribution | New business? | Rates page fetchable? |
|---|---|---|---|---|
| AIB | Allied Irish Banks, p.l.c. | Direct | ✅ | ✅ static HTML (APRC is JS-rendered — from CCPC) |
| Bank of Ireland | Governor & Company of the Bank of Ireland | Direct | ✅ | ✅ partial (HVM tables + variable in static HTML; full BER matrix from CCPC, spot-checks agree) |
| PTSB | Permanent TSB p.l.c. | Direct | ✅ | ❌ HTTP 403 (same bot-blocking as their loan pages) |
| EBS | EBS d.a.c. (AIB Group) | Direct | ✅ | ❌ HTTP 403 |
| Haven | Haven Mortgages Limited (AIB Group) | **Broker-only** | ✅ | ❌ HTTP 403 |
| Avant Money | Avantcard DAC | **Broker-only** | ✅ | ❌ HTTP 403 |
| ICS Mortgages | Dilosk DAC t/a ICS Mortgages | Direct | ✅ | ✅ (page dated 01.07.2026) |
| MoCo | MoCo Mortgages (Bawag Group) | **Broker-only** | ✅ | ✅ |
| Nua Money | Nua Money Limited | **Broker-only** | ✅ | ❌ JS-rendered (static HTML has no rate data) |
| Credit Union Mortgages | Credit Union Mortgages CLG | Direct (via member CUs) | ✅ | ✅ |
| Finance Ireland | Finance Ireland Credit Solutions DAC | Broker-only | **❌ closed** | ✅ (but page explicitly labels all rates "existing customers") |

Notes:

- **Finance Ireland is out of the new-business market.** Their rates page
  labels every variable and fixed table "existing customers", and they're
  absent from CCPC's comparison. No rate rows included; recorded in the
  `lenders` array with `activeForNewBusiness: false`.
- **Credit unions**: mortgage lending is not centrally standardised. The
  `creditunionmortgages.com` platform (Credit Union Mortgages CLG) covers
  **51 participating credit unions** (list extracted from their enquiry
  form) with a single product: Capped Variable 3.85% (APRC 3.92%), capped
  at 4.40% for the first 3 years. Individual credit unions outside this
  platform may offer their own mortgages — those are NOT captured here
  and would need per-CU research if ever wanted.
- **Broker-only matters for `/go/{slug}`**: Haven, Avant, MoCo and Nua
  cannot take a direct application — a future redirect would have to
  land on a "find a broker" step, not an application form.

## Dataset summary

553 rate rows in `mortgages.json`, all with `lastVerified: 2026-07-22`:

| Verification status | Rows | Meaning |
|---|---|---|
| `lender-page+ccpc-agree` | 118 | Extracted from the lender's own page AND independently confirmed against CCPC (AIB 71, MoCo 18, ICS 26, CU Mortgages 3) |
| `lender-page-partial+ccpc` | 195 | BOI: full BER matrix from CCPC; static-page spot-checks (1yr HVM × 3 BERs, variable × 3) all agree |
| `ccpc-only` | 239 | PTSB, EBS, Haven, Avant (403-blocked), Nua (JS-rendered) — CCPC is the only machine-readable source |
| `SOURCES_CONFLICT` | 1 | AIB 3-year fixed >80% LTV: AIB's page says 3.70%, CCPC says 3.75% — flagged in the row's notes, not auto-resolved |

APRC coverage: every row has an APRC (CCPC's `FullRate`) — confirmed to
be APRC by reconstruction (AIB 1yr fixed 3.50% → follow-on 4.15% gives
FullRate 4.18%). No APRC was locally estimated. MoCo's published APRCs
matched CCPC's exactly on all 18 rows, which validates using `FullRate`
as APRC for the blocked lenders.

## Market shape observations (informs page design later)

- **BOI prices by BER, not LTV** — 8 price tiers per term (BER A → Exempt).
  Their cashback costs +0.50% on the rate (5yr fixed: 3.50% no-cashback
  vs 4.00% with "up to 3%" cashback) — a comparison page that ranks by
  rate alone would hide this trade-off.
- **AIB prices by LTV** (3 bands) with green/BER discounts as separate
  product lines; "Higher Value" (≥€250k) products get better pricing.
- **Cashback is product-restricted everywhere it exists** (Avant: fixed
  drawdowns >80% LTV only; BOI: excluded on their cheapest EcoSaver
  rates) — confirming the task's suspicion; captured per-row.
- **FTB and mover pricing is identical at every lender** (verified: 0
  differences across matching products). Switcher products are a separate
  CCPC set, sometimes with switcher-specific cashback.
- ICS and Nua price well above the pillar banks (ICS 5yr fixed 5.25% vs
  BOI 3.20–3.75%); ICS appears to be deprioritising owner-occupier
  lending.

## Recommended comparison baselines

A single flat baseline can't represent this market. Recommend **two
scenarios**, both at €300,000 borrowed over 25 years (matches CCPC's own
APRC assumptions and the ≥€250k "high value" threshold that unlocks the
pillar banks' best pricing):

**Scenario A — First-time buyer, 90% LTV (10% deposit), 4–5 year fixed, BER C:**

| Lender | Rate | APRC |
|---|---|---|
| Bank of Ireland (4yr HVM, BER C) | 3.20% | 3.9% |
| PTSB (4yr, >80% LTV) | 3.50% | 4.35% |
| AIB (Higher Value 4yr, >80%) | 3.60% | 4.03% |
| Avant Money (4yr High Value, >80%) | 3.60% | 3.9% |
| MoCo (5yr, 80–90%) | 3.80% | 3.96% |
| Haven (5yr) | 3.90% | 4.2% |
| EBS (5yr) | 4.40% | 4.4% |
| Nua Money (5yr, 90%) | 4.99% | 5.08% |
| ICS (5yr, ≤90%) | 5.25% | 5.16% |

**Scenario B — Switcher, 80% LTV, 3 year fixed, BER C:**

| Lender | Rate | APRC |
|---|---|---|
| Avant Money (>70% ≤80%) | 3.45% | 3.89% |
| PTSB (High Value, 60–80%) | 3.55% | 4.33% |
| AIB (≤80%) | 3.60% | 3.93% |
| MoCo (>70% ≤80%) | 3.60% | 3.93% |
| Haven | 3.75% | 4.2% |
| Bank of Ireland (BER C) | 4.00% | 4.2% |
| EBS | 4.30% | 4.3% |
| Nua Money | 4.99% | 5.06% |
| ICS (≤80%) | 5.20% | 5.09% |

Caveats for both: Credit Union Mortgages' 3.85% capped variable doesn't
appear in fixed-rate rankings but is genuinely competitive and should be
shown alongside; PTSB's APRC runs ~0.4% above peers at similar headline
rates (their follow-on variable is high — exactly the kind of thing an
APRC-first ranking surfaces and a headline-rate ranking hides). Rank by
APRC, not headline rate, for the same reason the loans page ranks by
total cost of credit.

## Verification gaps (explicit)

1. **PTSB, EBS, Haven, Avant**: rates are CCPC-sourced only — their
   sites 403 all automated fetches. Manual browser verification
   recommended before anything goes live (same caveat as
   `ptsb-loan-sbci-energy` on the loans page).
2. **Nua Money**: JS-rendered rates page; CCPC-sourced only.
3. **AIB 3yr fixed >80%**: one live conflict (page 3.70% vs CCPC 3.75%)
   — needs a manual check; likely one side is mid-update.
4. **AIB APRC values**: AIB's static HTML shows "--" for APRC (JS-filled);
   APRCs for AIB rows are CCPC's.
5. **Buy-to-let / investment**: NOT captured. CCPC's tools and this pass
   cover owner-occupier only ("investment" `buyer_type` from the task
   spec is therefore unpopulated — BTL rates exist at ICS/BOI/others and
   would need a separate pass).
6. **Self-build, negative-equity, and staff/apex products**: not captured.
7. **Individual credit unions outside the CU Mortgages platform**: not
   captured (no central source; 51-CU platform list is captured).

## ⚠️ Regulatory flag — resolve before any mortgage page goes live

Mortgage comparison/introduction sits in a **different regulatory bucket**
than the general loan/card comparison currently on the site. Specifically
worth confirming with a solicitor or the Central Bank/CCPC directly,
**separately from the existing personal-loan credit-intermediary question
already being tracked**:

- Anyone "arranging or offering to arrange" mortgage credit, or providing
  advisory services on mortgages, may fall within the **European Union
  (Consumer Mortgage Credit Agreements) Regulations 2016 (CMCAR)**
  definition of a "mortgage credit intermediary" — a Central Bank
  authorisation category with its own register, distinct from the CCPC
  credit-intermediary registration relevant to loans/cards.
- The line between "information/comparison" (generally fine) and
  "introduction/arranging" (authorisation territory) is exactly where
  `/go/{slug}` affiliate redirects to lender application forms could
  land. Broker-only lenders sharpen this: a redirect to a *broker* rather
  than a lender looks more like introducing.
- Recommendation: get a written view on (a) pure comparison tables with
  plain outbound links, (b) tracked/affiliate links, and (c) any
  lead-capture form, before building `mortgages.html`. Until then this
  dataset stays unpublished.

## Reproduction

Raw CCPC responses are in `research/` (gitignored): 19 scenario files
(`ccpc-mtg-{buyer}-{ltv}-ber{X}.json`) plus the endpoint probe. Lender
pages were fetched with plain curl (UA string in the notes doc);
extraction was ad-hoc (this was a one-off research pass, not a recurring
script — a `check-rates-ccpc.mjs`-style fortnightly checker for mortgages
is a natural follow-up once the regulatory question is resolved).
