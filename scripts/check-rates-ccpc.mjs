// scripts/check-rates-ccpc.mjs
//
// Built 2026-07-22. Cross-checks products.json's loan rates against the CCPC
// (Competition and Consumer Protection Commission) comparison tool at
// compare.ccpc.ie, as a *secondary* source alongside the lender-scraper
// (scripts/check-rates.mjs) — not a replacement for it. Two independent
// sources agreeing is stronger evidence than either alone; when they
// disagree, this script flags it rather than picking a winner.
//
// IMPORTANT: `POST https://compare.ccpc.ie/loan/get-loans` is CCPC's own
// internal tool backend, reverse-engineered from their frontend's network
// calls. It is NOT a published, documented, or supported public API — there
// is no stability guarantee and no rate-limit policy. If this script starts
// failing across the board, that's expected risk materialising, not
// necessarily a bug here — see docs/ccpc-endpoint-notes.md before treating
// it as urgent, and do not escalate failures to CCPC support (they don't
// support this as an integration).
//
// Never writes to products.json — same rule as check-rates.mjs. This script
// only detects and reports.
//
// Run:  node scripts/check-rates-ccpc.mjs

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";

// Unlike check-rates.mjs, this makes exactly one request per run — CCPC's
// TypeId:5 response already returns every personal loan product across
// every lender in one call, so there's no "between requests" to space out.
// A polite identifying User-Agent and timeout still apply to that one call.
const USER_AGENT = "BorrowClever-CrossCheck/1.0 (+https://borrowclever.ie)";
const FETCH_TIMEOUT_MS = 8000;
const CCPC_URL = "https://compare.ccpc.ie/loan/get-loans";
// Matches the site's own published methodology (see loans.html): all figures
// are quoted on €10,000 borrowed over 60 months (5 years). CCPC's `Amount`
// tiers rates for several lenders (confirmed in docs/ccpc-endpoint-notes.md),
// so this must match exactly, not just be "a reasonable loan size".
const CCPC_AMOUNT = 10000;
const CCPC_TERM_YEARS = 5;
const CCPC_TYPE_ID = 5; // personal loans — confirmed by content in docs/ccpc-endpoint-notes.md

function today() {
  return new Date().toISOString().slice(0, 10);
}

function pct(s) {
  const m = String(s ?? "").match(/(\d{1,2}(?:\.\d{1,2})?)\s*%/);
  return m ? m[1] : null;
}

function ratesEqual(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return Math.abs(parseFloat(a) - parseFloat(b)) < 0.005;
}

// ── lender name normalisation for fuzzy matching ────────────────────────
const LENDER_STOPWORDS = new Set(["bank", "of", "ireland", "money", "plc", "dac", "ltd", "group", "the"]);

function normalizeLender(name) {
  const raw = String(name ?? "").toLowerCase().trim();
  const words = raw.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const stripped = words.filter((w) => !LENDER_STOPWORDS.has(w)).join(" ");
  // Some lenders (e.g. "Bank of Ireland") are made entirely of stopwords —
  // stripping them all would produce an empty, useless key. Fall back to the
  // unstripped normalised name rather than losing the lender entirely.
  return stripped || words.join(" ");
}

// Lenders rarely normalise to identical strings — e.g. products.json's
// "Credit Union average" vs CCPC's generic "Credit Union" bucket. Substring
// containment (either direction) catches these without hardcoding every
// lender-name variant. Guard against empty strings, which are a substring
// of everything in JS.
function lenderMatches(a, b) {
  const na = normalizeLender(a);
  const nb = normalizeLender(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

// ── product name matching within a single lender's CCPC entries ────────
// Lender pages and CCPC both re-state the lender's own name inside the
// product name sometimes ("An Post Money Personal Loan") and not other
// times ("Personal Loan") — comparing raw product names would penalise the
// former for "extra" words that are really just the lender name repeated.
// Stripping each side's own lender name out before comparing keeps this
// fair on both counts.
const PRODUCT_STOPWORDS = new Set(["loan", "loans", "scheme", "the", "a", "an", "for", "and", "-"]);

function productTokens(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !PRODUCT_STOPWORDS.has(w));
}

function remainderTokens(productName, lenderName) {
  const lenderWords = new Set(productTokens(lenderName));
  return productTokens(productName).filter((t) => !lenderWords.has(t) && !LENDER_STOPWORDS.has(t));
}

// Scores a candidate by how many of its (lender-stripped) tokens overlap
// with the target's, then by how few *extra* tokens it carries beyond that
// overlap — "Personal Loan" beats "Green Personal Loan" as a match for
// target tokens {personal} because it has nothing left over once the
// shared token is accounted for.
//
// This is intentionally simple counting, not TF-IDF or stemming, and it has
// a known failure mode: a single shared generic word (e.g. "home", present
// in both "home energy" and "home improvement" products) can produce a
// weak, wrong match when a lender genuinely has no real counterpart for a
// products.json product — see docs/ccpc-endpoint-notes.md. Rather than
// trying to fully eliminate that with more heuristics, the report always
// prints which CCPC product name a row matched against, so a human
// reviewer can spot a nonsensical pairing (e.g. a "Home Improvement Loan"
// matched to an "SBCI Home Energy Upgrade" entry) at a glance and dismiss
// it — safer than risking silently rejecting a real match elsewhere.
function scoreCandidate(targetTokens, candidateTokens) {
  const targetSet = new Set(targetTokens);
  const candidateSet = new Set(candidateTokens);
  let intersection = 0;
  for (const t of candidateSet) if (targetSet.has(t)) intersection++;
  return { intersection, extra: candidateSet.size - intersection };
}

// ── CCPC fetch ───────────────────────────────────────────────────────────
// Distinguishes two different failure modes on purpose (see Task 4 in the
// originating request): a network/HTTP failure (UNREACHABLE) is a different
// signal from "we got a 200 but the data doesn't look like what we expect"
// (CCPC_SCHEMA_CHANGED_OR_UNAVAILABLE, i.e. the undocumented endpoint's
// shape or behaviour has drifted since docs/ccpc-endpoint-notes.md was
// written) — the latter needs a human to re-run the Task 1 research, not
// just a retry.
async function fetchCcpcLoans(url = CCPC_URL) {
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
      body: JSON.stringify({ Amount: CCPC_AMOUNT, Term: CCPC_TERM_YEARS, TypeId: CCPC_TYPE_ID }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    const reason = e && e.name === "TimeoutError" ? "timeout" : (e && e.message) || String(e);
    return { ok: false, runStatus: "UNREACHABLE", detail: reason };
  }

  if (!res.ok) {
    return { ok: false, runStatus: "UNREACHABLE", detail: `HTTP ${res.status}` };
  }

  // A wrong/moved endpoint returns HTTP 200 with the Angular app's HTML
  // shell, not JSON — confirmed in docs/ccpc-endpoint-notes.md. Status alone
  // is not enough to trust the response.
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return { ok: false, runStatus: "CCPC_SCHEMA_CHANGED_OR_UNAVAILABLE", detail: `unexpected content-type: ${contentType || "(none)"}` };
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    return { ok: false, runStatus: "CCPC_SCHEMA_CHANGED_OR_UNAVAILABLE", detail: "response was not valid JSON" };
  }

  if (!Array.isArray(data)) {
    return { ok: false, runStatus: "CCPC_SCHEMA_CHANGED_OR_UNAVAILABLE", detail: "response was not a JSON array" };
  }

  if (data.length === 0) {
    return { ok: false, runStatus: "CCPC_SCHEMA_CHANGED_OR_UNAVAILABLE", detail: "response array was empty — expected personal loan products at TypeId 5" };
  }

  const missingFields = data.filter(
    (item) => typeof item.ProviderName !== "string" || typeof item.ProductName !== "string" || typeof item.Rate !== "number"
  );
  if (missingFields.length > 0) {
    return { ok: false, runStatus: "CCPC_SCHEMA_CHANGED_OR_UNAVAILABLE", detail: `${missingFields.length} of ${data.length} entries missing expected fields (ProviderName/ProductName/Rate) — CCPC's response shape may have changed, see docs/ccpc-endpoint-notes.md` };
  }

  return { ok: true, data };
}

// ── lender-scraper snapshot lookup ──────────────────────────────────────
function splitCsvLine(line) {
  const cells = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cur += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      cells.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  cells.push(cur);
  return cells;
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = splitCsvLine(lines[0]);
  return lines.slice(1).filter(Boolean).map((line) => {
    const cells = splitCsvLine(line);
    const row = {};
    header.forEach((h, i) => (row[h] = (cells[i] ?? "").trim()));
    return row;
  });
}

// Finds the most recent rates-YYYY-MM-DD.csv snapshot from the lender
// scraper (excluding this script's own ccpc-check-*.md output) so this run
// can cross-reference against it. Falls back to null if none exist yet
// (e.g. first-ever run before check-rates.mjs has produced a snapshot).
function findLatestLenderSnapshot(ratesDirUrl) {
  let files;
  try {
    files = readdirSync(ratesDirUrl);
  } catch (e) {
    return null;
  }
  const snapshots = files.filter((f) => /^rates-\d{4}-\d{2}-\d{2}\.csv$/.test(f)).sort();
  return snapshots.length ? snapshots[snapshots.length - 1] : null;
}

function loadLenderSnapshot(ratesDirUrl) {
  const filename = findLatestLenderSnapshot(ratesDirUrl);
  if (!filename) return { filename: null, byId: new Map() };
  const text = readFileSync(new URL(filename, ratesDirUrl), "utf8");
  const rows = parseCsv(text);
  const byId = new Map(rows.map((r) => [r.products_json_id, r]));
  return { filename, byId };
}

// ── main ───────────────────────────────────────────────────────────────
async function main() {
  const date = today();
  const products = JSON.parse(readFileSync(new URL("../products.json", import.meta.url), "utf8"));
  const loans = products.filter((p) => p.category === "loan");

  const ratesDirUrl = new URL("../rates/", import.meta.url);
  mkdirSync(ratesDirUrl, { recursive: true });
  const { filename: snapshotFilename, byId: scraperById } = loadLenderSnapshot(ratesDirUrl);

  const ccpcResult = await fetchCcpcLoans();

  if (!ccpcResult.ok) {
    // CCPC is unreachable or its shape has drifted — every loan gets the
    // same run-level status. Still write a report (so the fortnightly
    // history has a record of the outage) and exit non-zero for this step
    // only, per Task 4: this must never block the lender-scraper's commit.
    const results = loans.map((p) => ({
      slug: p.slug, lender: p.lenderName, product: p.name,
      currentRate: pct(p.rate), ccpcRate: null, scraperRate: null,
      status: ccpcResult.runStatus, detail: ccpcResult.detail,
    }));
    writeReport(date, results, { snapshotFilename, ccpcDown: true, ccpcRunStatus: ccpcResult.runStatus, ccpcDetail: ccpcResult.detail });
    console.log(`CCPC cross-check could not run: ${ccpcResult.runStatus} — ${ccpcResult.detail}`);
    process.exitCode = 1;
    return;
  }

  const ccpcEntries = ccpcResult.data.map((item) => ({
    lender: item.ProviderName,
    product: item.ProductName,
    rate: item.Rate,
    normLender: normalizeLender(item.ProviderName),
    matched: false,
  }));

  const results = [];

  for (const p of loans) {
    const currentRate = pct(p.rate);
    const candidates = ccpcEntries.filter((c) => lenderMatches(c.lender, p.lenderName));

    let ccpcMatch = null;
    if (candidates.length === 1) {
      // Only one CCPC product for this lender — unambiguous even if the
      // product-name text differs (e.g. "Personal Loan" vs "Standard
      // Personal Loan").
      ccpcMatch = candidates[0];
    } else if (candidates.length > 1) {
      const targetTokens = remainderTokens(p.name, p.lenderName);
      let best = null;
      let bestScore = { intersection: 0, extra: Infinity };
      for (const c of candidates) {
        const candidateTokens = remainderTokens(c.product, c.lender);
        const score = scoreCandidate(targetTokens, candidateTokens);
        if (score.intersection === 0) continue;
        if (score.intersection > bestScore.intersection || (score.intersection === bestScore.intersection && score.extra < bestScore.extra)) {
          best = c;
          bestScore = score;
        }
      }
      ccpcMatch = best;
    }

    const scraperRow = scraperById.get(p.slug);
    const scraperAvailable = scraperRow && (scraperRow.status === "OK" || scraperRow.status === "CHANGED") && scraperRow.scraped_rate;
    const scraperRate = scraperAvailable ? scraperRow.scraped_rate : null;

    if (ccpcMatch) ccpcMatch.matched = true;
    const ccpcRate = ccpcMatch ? String(ccpcMatch.rate) : null;
    const ccpcProduct = ccpcMatch ? `${ccpcMatch.lender} — ${ccpcMatch.product}` : null;

    let status;
    let detail = "";

    if (ccpcRate === null && scraperRate === null) {
      status = "SINGLE_SOURCE_ONLY";
      detail = "no independent source available (CCPC: no match" + (candidates.length > 1 ? ", ambiguous product name among " + candidates.length + " CCPC entries for this lender" : "") + "; lender-scraper: " + (scraperRow ? scraperRow.status : "no snapshot row") + ")";
    } else if (ccpcRate === null || scraperRate === null) {
      const have = ccpcRate !== null ? "CCPC" : "lender-scraper";
      status = "SINGLE_SOURCE_ONLY";
      detail = `only ${have} has data for this product this run`;
    } else if (ratesEqual(ccpcRate, scraperRate)) {
      status = ratesEqual(ccpcRate, currentRate) ? "CONFIRMED" : "CHANGE_CONFIRMED";
      if (status === "CHANGE_CONFIRMED") detail = `CCPC and lender-scraper both show ${ccpcRate}% — products.json still has ${currentRate ?? "—"}%`;
    } else {
      status = "SOURCES_CONFLICT";
      detail = `CCPC says ${ccpcRate}%, lender-scraper says ${scraperRate}% — needs manual review`;
    }

    results.push({
      slug: p.slug, lender: p.lenderName, product: p.name,
      currentRate, ccpcRate, ccpcProduct, scraperRate, status, detail,
    });
  }

  // Products.json entries were the driving loop above (per Task 2.2, we log
  // unmatched products.json rows there). Now the reverse: CCPC products that
  // exist for a lender we track but were never matched to any products.json
  // row — these are either a lender's other loan products (out of scope,
  // fine) or a sign our matching missed something worth checking.
  const unmatchedCcpc = ccpcEntries.filter((c) => !c.matched && loans.some((p) => lenderMatches(c.lender, p.lenderName)));
  for (const c of unmatchedCcpc) {
    results.push({
      slug: null, lender: c.lender, product: c.product,
      currentRate: null, ccpcRate: String(c.rate), ccpcProduct: null, scraperRate: null,
      status: "SINGLE_SOURCE_ONLY", detail: "CCPC lists this product but it has no products.json counterpart",
    });
  }

  writeReport(date, results, { snapshotFilename, ccpcDown: false });

  const counts = results.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
  console.log(`CCPC cross-check: ${results.length} rows — ` + Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", "));

  const needsAttention = results.filter((r) => r.status !== "CONFIRMED").length;
  if (needsAttention > 0) process.exitCode = 1;
}

function writeReport(date, results, { snapshotFilename, ccpcDown, ccpcRunStatus, ccpcDetail }) {
  const total = results.length;
  const flagged = results.filter((r) => r.status !== "CONFIRMED");
  let md = `# CCPC cross-check — ${date}\n\n`;
  md += `Secondary rate verification against CCPC's public loan comparison tool (compare.ccpc.ie), alongside the lender-scraper snapshot`;
  md += snapshotFilename ? ` (\`rates/${snapshotFilename}\`).\n\n` : ` (no lender-scraper snapshot found — CCPC-only comparison against products.json).\n\n`;

  if (ccpcDown) {
    md += `**CCPC endpoint check failed: \`${ccpcRunStatus}\`** — ${ccpcDetail}\n\n`;
    md += `This is an undocumented internal API (see docs/ccpc-endpoint-notes.md) — this may be a transient outage or a genuine schema/endpoint change. The lender-scraper's own results are unaffected by this failure.\n`;
    writeFileSync(new URL(`../rates/ccpc-check-${date}.md`, import.meta.url), md);
    return;
  }

  if (flagged.length === 0) {
    md += `All ${total} products confirmed against CCPC and lender data as of ${date}.\n`;
    writeFileSync(new URL(`../rates/ccpc-check-${date}.md`, import.meta.url), md);
    return;
  }

  md += `${flagged.length} of ${total} rows need attention.\n`;

  const byStatus = (status) => flagged.filter((r) => r.status === status);

  // Every table includes which CCPC product name a row was matched against
  // — the fuzzy lender/product matching is imperfect by design (see
  // scoreCandidate's doc comment), so a reviewer needs to be able to spot a
  // nonsensical pairing (e.g. matched to an unrelated product at the same
  // lender) at a glance rather than trusting the rate comparison blindly.
  const changeConfirmed = byStatus("CHANGE_CONFIRMED");
  if (changeConfirmed.length) {
    md += `\n## Change confirmed by two independent sources\n\nCCPC and the lender-scraper agree with each other but disagree with the currently published rate — strong evidence products.json is stale.\n\n`;
    md += `| Product | Published | CCPC | Matched CCPC product | Lender-scraper |\n|---|---|---|---|---|\n`;
    md += changeConfirmed.map((r) => `| ${r.lender} — ${r.product} | ${r.currentRate ?? "—"}% | ${r.ccpcRate}% | ${r.ccpcProduct ?? "—"} | ${r.scraperRate}% |`).join("\n") + "\n";
  }

  const conflict = byStatus("SOURCES_CONFLICT");
  if (conflict.length) {
    md += `\n## Sources conflict — needs manual review\n\nCCPC and the lender-scraper disagree with each other. Not auto-resolved — one source's parser may be wrong.\n\n`;
    md += `| Product | Published | CCPC | Matched CCPC product | Lender-scraper |\n|---|---|---|---|---|\n`;
    md += conflict.map((r) => `| ${r.lender} — ${r.product} | ${r.currentRate ?? "—"}% | ${r.ccpcRate}% | ${r.ccpcProduct ?? "—"} | ${r.scraperRate}% |`).join("\n") + "\n";
  }

  const singleSource = byStatus("SINGLE_SOURCE_ONLY");
  if (singleSource.length) {
    md += `\n## Single source only\n\n`;
    md += `| Product | Published | CCPC | Matched CCPC product | Lender-scraper | Detail |\n|---|---|---|---|---|---|\n`;
    md += singleSource.map((r) => `| ${r.lender} — ${r.product} | ${r.currentRate ?? "—"} | ${r.ccpcRate ?? "—"} | ${r.ccpcProduct ?? "—"} | ${r.scraperRate ?? "—"} | ${r.detail} |`).join("\n") + "\n";
  }

  const schemaIssues = byStatus("CCPC_SCHEMA_CHANGED_OR_UNAVAILABLE").concat(byStatus("UNREACHABLE"));
  if (schemaIssues.length) {
    md += `\n## CCPC unavailable\n\n| Product | Status | Detail |\n|---|---|---|\n`;
    md += schemaIssues.map((r) => `| ${r.lender} — ${r.product} | ${r.status} | ${r.detail} |`).join("\n") + "\n";
  }

  writeFileSync(new URL(`../rates/ccpc-check-${date}.md`, import.meta.url), md);
}

main().catch((e) => {
  console.error("check-rates-ccpc.mjs failed:", e && e.message ? e.message : e);
  process.exitCode = 1;
});
