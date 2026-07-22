# CCPC cross-check — 2026-07-22

Secondary rate verification against CCPC's public loan comparison tool (compare.ccpc.ie), alongside the lender-scraper snapshot (`rates/rates-2026-07-21.csv`).

20 of 20 rows need attention.

## Sources conflict — needs manual review

CCPC and the lender-scraper disagree with each other. Not auto-resolved — one source's parser may be wrong.

| Product | Published | CCPC | Matched CCPC product | Lender-scraper |
|---|---|---|---|---|
| AIB — AIB SBCI Home Energy Upgrade | 3.55% | 3.55% | AIB — SBCI Home Energy Upgrade Loan Scheme | 11.45% |
| AIB — AIB Green Personal Loan | 6.40% | 6.4% | AIB — Green Personal Loan | 11.45% |
| Bank of Ireland — Bank of Ireland Green Car / Home Improvement | 6.50% | 6.5% | Bank of Ireland — Green home improvement loan | 6.3% |
| Bank of Ireland — Bank of Ireland Personal Loan | 8.30% | 8.3% | Bank of Ireland — Personal Loan | 7.1% |
| An Post Money — An Post Money Personal Loan | 8.40% | 8.4% | An Post Money — An Post Money Personal Loan | 8.1% |
| Avant Money — Avant Money Personal Loan (under €30k) | 8.50% | 8.5% | Avant Money — Personal Loan | 6.7% |
| AIB — AIB Personal Loan | 8.95% | 8.95% | AIB — Personal Loan | 8.65% |
| Credit Union average — Credit Union average Personal Loan — ILCU affiliated | 10.42% | 10.42% | Credit Union — Standard Personal Loan (Rate varies by CU) | 12% |

## Single source only

| Product | Published | CCPC | Matched CCPC product | Lender-scraper | Detail |
|---|---|---|---|---|---|
| Bank of Ireland — Bank of Ireland SBCI Home Energy Upgrade | 2.95 | 3 | Bank of Ireland — Home Energy Upgrade Loan Scheme | — | only CCPC has data for this product this run |
| PTSB — PTSB SBCI Home Energy Upgrade | 4.20 | 4.2 | ptsb — SBCI Home Energy Upgrade Loan | — | only CCPC has data for this product this run |
| PTSB — PTSB Personal Loan | 7.20 | 7.2 | ptsb — Personal Loan | — | only CCPC has data for this product this run |
| Revolut — Revolut Personal Loan | 6.50 | — | — | — | no independent source available (CCPC: no match; lender-scraper: UNREACHABLE) |
| AIB — AIB Home Improvement Loan | 8.95 | 3.55 | AIB — SBCI Home Energy Upgrade Loan Scheme | — | only CCPC has data for this product this run |
| First Choice CU — First Choice CU Personal Loan (€15k–€25k) | 8.84 | — | — | — | no independent source available (CCPC: no match; lender-scraper: PARSE_FAILED) |
| AIB — Student Contribution Charge Loan - Variable | — | 8.45 | — | — | CCPC lists this product but it has no products.json counterpart |
| AIB — Student Personal Loan | — | 8.45 | — | — | CCPC lists this product but it has no products.json counterpart |
| An Post Money — An Post Money Home Improvement Loan | — | 8.4 | — | — | CCPC lists this product but it has no products.json counterpart |
| An Post Money — SBCI Home Energy Upgrade Loan Scheme | — | 5.9 | — | — | CCPC lists this product but it has no products.json counterpart |
| Credit Union — Car Loan (Rate varies by CU) | — | 7.77 | — | — | CCPC lists this product but it has no products.json counterpart |
| Credit Union — Home Improvement Loan (Rate Varies by CU) | — | 7.22 | — | — | CCPC lists this product but it has no products.json counterpart |
