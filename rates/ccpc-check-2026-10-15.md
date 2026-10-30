# CCPC cross-check — 2026-10-15

Secondary rate verification against CCPC's public loan comparison tool (compare.ccpc.ie), alongside the lender-scraper snapshot (`rates/rates-2026-10-15.csv`).

15 of 20 rows need attention.

## Sources conflict — needs manual review

CCPC and the lender-scraper disagree with each other. Not auto-resolved — one source's parser may be wrong.

| Product | Published | CCPC | Matched CCPC product | Lender-scraper |
|---|---|---|---|---|
| An Post Money — An Post Money Personal Loan | 8.40% | 8.4% | An Post Money — An Post Money Personal Loan | 8.1% |

## Single source only

| Product | Published | CCPC | Matched CCPC product | Lender-scraper | Detail |
|---|---|---|---|---|---|
| AIB — AIB SBCI Home Energy Upgrade | 3.55 | 3.55 | AIB — SBCI Home Energy Upgrade Loan Scheme | — | only CCPC has data for this product this run |
| PTSB — PTSB SBCI Home Energy Upgrade | 4.20 | 4.2 | ptsb — SBCI Home Energy Upgrade Loan | — | only CCPC has data for this product this run |
| AIB — AIB Green Personal Loan | 6.40 | 6.4 | AIB — Green Personal Loan | — | only CCPC has data for this product this run |
| PTSB — PTSB Personal Loan | 7.20 | 7.2 | ptsb — Personal Loan | — | only CCPC has data for this product this run |
| Revolut — Revolut Personal Loan | 6.50 | — | — | — | no independent source available (CCPC: no match; lender-scraper: UNREACHABLE) |
| AIB — AIB Home Improvement Loan | 8.95 | 3.55 | AIB — SBCI Home Energy Upgrade Loan Scheme | — | only CCPC has data for this product this run |
| First Choice CU — First Choice CU Personal Loan (€15k–€25k) | 8.84 | — | — | 8.84 | only lender-scraper has data for this product this run |
| AIB — AIB Personal Loan | 8.95 | 8.95 | AIB — Personal Loan | — | only CCPC has data for this product this run |
| AIB — Student Contribution Charge Loan - Variable | — | 8.45 | — | — | CCPC lists this product but it has no products.json counterpart |
| AIB — Student Personal Loan | — | 8.45 | — | — | CCPC lists this product but it has no products.json counterpart |
| An Post Money — An Post Money Home Improvement Loan | — | 8.4 | — | — | CCPC lists this product but it has no products.json counterpart |
| An Post Money — SBCI Home Energy Upgrade Loan Scheme | — | 5.9 | — | — | CCPC lists this product but it has no products.json counterpart |
| Credit Union — Car Loan (Rate varies by CU) | — | 7.77 | — | — | CCPC lists this product but it has no products.json counterpart |
| Credit Union — Home Improvement Loan (Rate Varies by CU) | — | 7.22 | — | — | CCPC lists this product but it has no products.json counterpart |
