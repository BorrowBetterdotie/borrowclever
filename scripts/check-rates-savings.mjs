// scripts/check-rates-savings.mjs
// Rate verification for deposit & savings accounts. Reads
// data/savings-lenders.csv, fetches each provider's published rate/product
// page, extracts the AER with a per-lender parser, and diffs it against the
// currently-published value in data/savings.json.
//
// Mirrors scripts/check-rates.mjs (the loans checker) deliberately — same
// CSV shape, same conservative "honest PARSE_FAILED beats a wrong guess"
// philosophy, same output format. The two differ only where savings
// products genuinely differ from loans:
//   - the comparison figure is AER, not APR — the context regex used to
//     accept a percentage match therefore looks for "aer" (savings pages
//     almost always say AER, rarely APR or bare "interest rate"), not apr.
//   - data/savings.json's `aer` field is a bare number (e.g. 3.5), not a
//     string like "8.95%", so there is no products.json-style `pct()`
//     string-extraction step — it's just `.toFixed(2)`.
//   - Prize Bonds have no fixed AER (aer: null in savings.json) by design —
//     that is not a data gap, so a page that discloses a prize-fund rate
//     for that row reports as INFO rather than CHANGED/PARSE_FAILED.
//
// Never writes to data/savings.json. Updating the live comparison table
// stays a manual, reviewed step — this script only detects and reports
// discrepancies.
//
// Run:  node scripts/check-rates-savings.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const USER_AGENT = "BorrowClever-RateChecker/1.0 (+https://borrowclever.ie)";
const REQUEST_DELAY_MS = 1500;
const FETCH_TIMEOUT_MS = 15000;

// ── tiny CSV parser (no deps) — handles quoted fields with embedded commas ──
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

function csvCell(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── rate-extraction helpers ─────────────────────────────────────────────
// Same deliberately-conservative design as check-rates.mjs: bank marketing
// pages are full of percentages that aren't the rate we want, and a
// wrong-but-plausible "CHANGED" value is worse than an honest
// PARSE_FAILED — the latter prompts a manual check, the former could get
// rubber-stamped by a reviewer who doesn't re-verify a number that looks
// reasonable. A match only counts if an AER/rate-context word appears close
// to the percentage itself, not just somewhere in a wide window.
//
// "aer" leads the alternation (not "apr") because that's what savings pages
// almost always print; "rate"/"interest" stay as fallbacks for pages that
// phrase it as "interest rate" without the AER abbreviation.
const RATE_CONTEXT_RE = /\b(aer|rate|interest)\b/i;
const CONTEXT_RADIUS = 45;

// Strip tags, collapse whitespace, then look for a percentage within
// `window` characters of a case-insensitive match of `keyword`, requiring
// an AER/rate word within CONTEXT_RADIUS characters of that percentage.
//
// Picks the CLOSEST qualifying percentage to the keyword, not the first one
// in document order. That distinction matters on a page that lists several
// products' rates close together (Raisin's marketplace page, statesavings.ie
// covering six products) — every percentage on a compact page can satisfy
// the context check, so "first in the slice" silently returns a sibling
// product's rate instead of PARSE_FAILED. Closest-to-keyword is a much
// better proxy for "the rate this heading/label is actually describing".
//
// Among equally-plausible candidates, a match AFTER the keyword beats one
// before it at the same or shorter raw distance: real copy overwhelmingly
// reads "<product name/heading> ... pays X% AER" rather than "X% AER ...
// <product name>", so a percentage trailing the previous, unrelated
// paragraph can sit fewer characters away than the one actually describing
// this product — plain nearest-distance would silently prefer that wrong,
// earlier number.
function pctNear(html, keyword, window = 350) {
  const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  const needle = String(keyword).toLowerCase();
  const haystack = text.toLowerCase();
  const pctRe = /(\d{1,2}(?:\.\d{1,2})?)\s*%/g;

  // Try every occurrence of the keyword, not just the first — the first hit
  // is very often the page <title> or nav, which has no rate anywhere near
  // it. Real content further down the page is what actually has the number.
  let from = 0;
  while (true) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) return null;
    const slice = text.slice(Math.max(0, idx - window), idx + window);
    const sliceOffset = Math.max(0, idx - window);

    let bestAfter = null;  // { value, distance } — percentage at/after the keyword
    let bestBefore = null; // { value, distance } — percentage before the keyword
    pctRe.lastIndex = 0;
    let m;
    while ((m = pctRe.exec(slice))) {
      const pctStartInText = sliceOffset + m.index;
      const contextStart = Math.max(0, pctStartInText - CONTEXT_RADIUS);
      const contextEnd = Math.min(text.length, pctStartInText + m[0].length + CONTEXT_RADIUS);
      if (!RATE_CONTEXT_RE.test(text.slice(contextStart, contextEnd))) continue;
      const distance = Math.abs(pctStartInText - idx);
      if (pctStartInText >= idx) {
        if (!bestAfter || distance < bestAfter.distance) bestAfter = { value: m[1], distance };
      } else {
        if (!bestBefore || distance < bestBefore.distance) bestBefore = { value: m[1], distance };
      }
    }
    if (bestAfter) return bestAfter.value;
    if (bestBefore) return bestBefore.value;
    from = idx + needle.length;
  }
}

// Generic default: anchor on the product name from savings-lenders.csv.
// Works when a provider's page mentions the product by roughly the name we
// track it under.
function defaultParser(html, row) {
  return pctNear(html, row.product) || pctNear(html, "AER") || null;
}

// ── per-lender parsers ───────────────────────────────────────────────────
// Isolated per lender so a page redesign only breaks one function, and a fix
// for one lender can't accidentally break another. Each parser returns a
// rate string (e.g. "3.50") or null — null means PARSE_FAILED, never a
// guess.
const PARSERS = {
  "AIB": (html, row) => {
    const id = row.savings_json_id;
    if (id === "aib-demand-deposit") return pctNear(html, "demand deposit") || pctNear(html, "personal demand");
    if (id === "aib-online-saver") return pctNear(html, "online saver") || pctNear(html, "regular saver");
    if (id === "aib-online-notice-7") return pctNear(html, "notice 7") || pctNear(html, "online notice") || pctNear(html, "7 day");
    if (id === "aib-fixed-term-1yr") return pctNear(html, "1 year") || pctNear(html, "12 month") || pctNear(html, "fixed term deposit");
    return defaultParser(html, row);
  },

  "Bank of Ireland": (html, row) => {
    const id = row.savings_json_id;
    if (id === "boi-super-saver") return pctNear(html, "super saver");
    if (id === "boi-31-day-notice") return pctNear(html, "31 day") || pctNear(html, "31-day");
    if (id === "boi-advantage-fixed-term") return pctNear(html, "advantage") || pctNear(html, "12 month") || pctNear(html, "fixed term");
    return defaultParser(html, row);
  },

  "PTSB": (html, row) => {
    const id = row.savings_json_id;
    if (id === "ptsb-instant-access") return pctNear(html, "instant access");
    if (id === "ptsb-online-regular-saver") return pctNear(html, "regular saver");
    if (id === "ptsb-32-day-notice") return pctNear(html, "32 day") || pctNear(html, "32-day");
    if (id === "ptsb-fixed-term-1yr") return pctNear(html, "1 year") || pctNear(html, "12 month") || pctNear(html, "fixed term deposit");
    return defaultParser(html, row);
  },

  "EBS": defaultParser,

  "Trade Republic": (html, row) => pctNear(html, "AER") || defaultParser(html, row),

  // The Raisin marketplace page lists many partner banks and terms on one
  // page — anchoring on our specific product name is a long shot (it may
  // list the best rate by amount/term rather than by our product label), so
  // PARSE_FAILED is a realistic and acceptable outcome here, not a bug.
  "Raisin (marketplace)": (html, row) => {
    const id = row.savings_json_id;
    if (id === "raisin-fixed-1yr") return pctNear(html, "1 year") || pctNear(html, "1-year");
    if (id === "raisin-fixed-10yr") return pctNear(html, "10 year") || pctNear(html, "10-year");
    return defaultParser(html, row);
  },

  "Revolut": (html) => pctNear(html, "instant access savings") || pctNear(html, "AER"),

  "MoCo": defaultParser,

  "N26": defaultParser,

  // A single statesavings.ie page covers all State Savings products, so
  // each row anchors on its own product name to pull the right figure out
  // of a page that lists several rates. Prize Bonds has no fixed AER by
  // design (see the INFO status handling in main()) — a scraped percentage
  // there is the prize-fund rate, not a savings rate, so it is reported for
  // information only rather than diffed as CHANGED.
  "An Post / State Savings (NTMA)": (html, row) => {
    const id = row.savings_json_id;
    if (id === "state-savings-posb-deposit") return pctNear(html, "POSB") || pctNear(html, "deposit account");
    if (id === "state-savings-solidarity-bond-10yr") return pctNear(html, "national solidarity bond") || pctNear(html, "10 year");
    if (id === "state-savings-certificate-5yr") return pctNear(html, "savings certificate") || pctNear(html, "5 year");
    if (id === "state-savings-instalment-6yr") return pctNear(html, "instalment savings");
    if (id === "state-savings-bond-3yr") return pctNear(html, "savings bond") || pctNear(html, "3 year");
    if (id === "state-savings-prize-bonds") return pctNear(html, "prize bond") || pctNear(html, "prize fund");
    return defaultParser(html, row);
  },

  "Credit unions (ILCU-affiliated, average)": (html) =>
    pctNear(html, "average") || pctNear(html, "dividend") || pctNear(html, "typical"),
};

function getParser(lenderName) {
  return PARSERS[lenderName] || defaultParser;
}

// ── main ───────────────────────────────────────────────────────────────
async function fetchWithTimeout(url) {
  return fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

async function main() {
  const date = today();
  const providers = parseCsv(readFileSync(new URL("../data/savings-lenders.csv", import.meta.url), "utf8"));
  const savingsData = JSON.parse(readFileSync(new URL("../data/savings.json", import.meta.url), "utf8"));
  const savingsById = new Map(savingsData.savings.map((s) => [s.id, s]));

  // Cache fetches by URL — several products share one provider page (all
  // six State Savings rows, all three Raisin rows), and re-fetching the
  // same page per product would multiply load for nothing.
  const pageCache = new Map();

  const results = [];

  for (const row of providers) {
    const { lender, product, source_url: url, savings_json_id: id } = row;
    const entry = savingsById.get(id);
    const isPrizeBonds = id === "state-savings-prize-bonds";
    const currentRate = entry && entry.aer != null ? entry.aer.toFixed(2) : null;

    if (!entry) {
      results.push({ lender, product, id, currentRate: null, scrapedRate: null, status: "PARSE_FAILED", detail: "no matching id in data/savings.json" });
      continue;
    }

    if (!url) {
      results.push({ lender, product, id, currentRate, scrapedRate: null, status: "PARSE_FAILED", detail: "no source_url in data/savings-lenders.csv" });
      continue;
    }

    let html;
    const cacheHit = pageCache.has(url);
    try {
      if (cacheHit) {
        html = pageCache.get(url);
      } else {
        if (pageCache.size > 0) await sleep(REQUEST_DELAY_MS); // be polite between distinct requests
        const res = await fetchWithTimeout(url);
        if (!res.ok) {
          pageCache.set(url, null);
          results.push({ lender, product, id, currentRate, scrapedRate: null, status: "UNREACHABLE", detail: `HTTP ${res.status}` });
          continue;
        }
        html = await res.text();
        pageCache.set(url, html);
      }
    } catch (e) {
      pageCache.set(url, null);
      const reason = e && e.name === "TimeoutError" ? "timeout" : (e && e.message) || String(e);
      results.push({ lender, product, id, currentRate, scrapedRate: null, status: "UNREACHABLE", detail: reason });
      continue;
    }

    if (html === null) {
      // A previous row already found this URL unreachable this run.
      results.push({ lender, product, id, currentRate, scrapedRate: null, status: "UNREACHABLE", detail: "source page unreachable (see earlier row)" });
      continue;
    }

    const parser = getParser(lender);
    let scrapedRate;
    try {
      scrapedRate = parser(html, row);
    } catch (e) {
      scrapedRate = null;
    }

    if (!scrapedRate) {
      // Include the product id, not just the lender, in the debug filename —
      // one provider page can fail for several products in the same run
      // (e.g. all six State Savings rows share statesavings.ie), and a
      // lender-only filename would silently overwrite earlier failures
      // instead of keeping all of them.
      mkdirSync(new URL("../rates/debug/", import.meta.url), { recursive: true });
      const debugFile = new URL(`../rates/debug/savings-${slugify(lender)}-${id}-${date}.html`, import.meta.url);
      writeFileSync(debugFile, html);
      results.push({ lender, product, id, currentRate, scrapedRate: null, status: isPrizeBonds ? "INFO" : "PARSE_FAILED", detail: isPrizeBonds ? "no prize-fund rate found on page" : "parser found no matching rate — raw HTML saved to rates/debug/" });
      continue;
    }

    if (isPrizeBonds) {
      // Prize Bonds carries aer: null by design — a scraped figure here is
      // the prize-fund rate, not a savings AER, so it's informational, not
      // a CHANGED/OK diff against a number that intentionally doesn't exist.
      results.push({ lender, product, id, currentRate, scrapedRate, status: "INFO", detail: "prize-fund rate (not a fixed AER) — informational only" });
      continue;
    }

    const status = currentRate !== null && scrapedRate === currentRate ? "OK" : "CHANGED";
    results.push({ lender, product, id, currentRate, scrapedRate, status, detail: "" });
  }

  writeSnapshot(date, results);
  writeChangesReport(date, results);

  const failCount = results.filter((r) => r.status === "PARSE_FAILED" || r.status === "UNREACHABLE").length;
  const changedCount = results.filter((r) => r.status === "CHANGED").length;
  const infoCount = results.filter((r) => r.status === "INFO").length;
  console.log(`Checked ${results.length} savings products: ${results.length - failCount - changedCount - infoCount} OK, ${changedCount} changed, ${infoCount} informational, ${failCount} need attention.`);

  if (failCount > 0) process.exitCode = 1;
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function writeSnapshot(date, results) {
  const header = "lender,product,savings_json_id,current_aer,scraped_aer,status,detail";
  const lines = results.map((r) =>
    [r.lender, r.product, r.id, r.currentRate ?? "", r.scrapedRate ?? "", r.status, r.detail]
      .map(csvCell)
      .join(",")
  );
  mkdirSync(new URL("../rates/", import.meta.url), { recursive: true });
  writeFileSync(new URL(`../rates/savings-rates-${date}.csv`, import.meta.url), [header, ...lines].join("\n") + "\n");
}

function writeChangesReport(date, results) {
  const flagged = results.filter((r) => r.status !== "OK");
  let md;
  if (flagged.length === 0) {
    md = `No changes detected — ${results.length} savings products checked, all current as of ${date}.\n`;
  } else {
    const changed = flagged.filter((r) => r.status === "CHANGED");
    const info = flagged.filter((r) => r.status === "INFO");
    const failed = flagged.filter((r) => r.status !== "CHANGED" && r.status !== "INFO");
    md = `# Savings rate check — ${date}\n\n${flagged.length} of ${results.length} savings products need attention.\n`;
    if (changed.length) {
      md += `\n## Changed rates\n\n| Lender | Product | Published AER | Scraped AER | Source |\n|---|---|---|---|---|\n`;
      md += changed.map((r) => `| ${r.lender} | ${r.product} | ${r.currentRate ?? "—"}% | ${r.scrapedRate}% | \`${r.id}\` |`).join("\n") + "\n";
    }
    if (info.length) {
      md += `\n## Informational (no diff — see detail)\n\n| Lender | Product | Detail |\n|---|---|---|\n`;
      md += info.map((r) => `| ${r.lender} | ${r.product} | ${r.detail} |`).join("\n") + "\n";
    }
    if (failed.length) {
      md += `\n## Needs attention (${failed.map((r) => r.status).filter((v, i, a) => a.indexOf(v) === i).join(" / ")})\n\n`;
      md += `| Lender | Product | Status | Detail |\n|---|---|---|---|\n`;
      md += failed.map((r) => `| ${r.lender} | ${r.product} | ${r.status} | ${r.detail} |`).join("\n") + "\n";
    }
  }
  writeFileSync(new URL(`../rates/SAVINGS-CHANGES-${date}.md`, import.meta.url), md);
}

main().catch((e) => {
  console.error("check-rates-savings.mjs failed:", e && e.message ? e.message : e);
  process.exitCode = 1;
});
