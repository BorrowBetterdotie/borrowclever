// scripts/check-rates.mjs
// Fortnightly rate verification. Reads lenders.csv, fetches each lender's
// published rate/product page, extracts the rate with a per-lender parser,
// and diffs it against the currently-published value in products.json.
//
// This is a deterministic scraper on purpose — no LLM call. Reliability and
// cost matter more than flexibility for a figure feeding a public table.
//
// Never writes to products.json. Updating the live comparison table stays a
// manual, reviewed step — this script only detects and reports discrepancies.
//
// Run:  node scripts/check-rates.mjs

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

// Pull the leading percentage out of a products.json value like "8.95%".
function pct(s) {
  const m = String(s).match(/(\d{1,2}(?:\.\d{1,2})?)\s*%/);
  return m ? m[1] : null;
}

// ── rate-extraction helpers ─────────────────────────────────────────────
// Deliberately conservative: bank marketing pages are full of percentages
// that aren't the rate we want (LTV, cashback %, "up to X% off", etc.), and
// a wrong-but-plausible "CHANGED" value is worse than an honest
// PARSE_FAILED — the latter prompts a manual check, the former could get
// rubber-stamped by a reviewer who doesn't re-verify a number that looks
// reasonable. So a match only counts if an APR/rate-context word appears
// close to the percentage itself, not just somewhere in a wide window.
const RATE_CONTEXT_RE = /\b(apr|rate|interest)\b/i;
const CONTEXT_RADIUS = 45;

// Strip tags, collapse whitespace, then look for a percentage within
// `window` characters of a case-insensitive match of `keyword`, requiring
// an APR/rate word within CONTEXT_RADIUS characters of that percentage.
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

    pctRe.lastIndex = 0;
    let m;
    while ((m = pctRe.exec(slice))) {
      const pctStartInText = sliceOffset + m.index;
      const contextStart = Math.max(0, pctStartInText - CONTEXT_RADIUS);
      const contextEnd = Math.min(text.length, pctStartInText + m[0].length + CONTEXT_RADIUS);
      if (RATE_CONTEXT_RE.test(text.slice(contextStart, contextEnd))) {
        return m[1];
      }
    }
    from = idx + needle.length;
  }
}

// Generic default: anchor on the product name from lenders.csv. Works when a
// lender's page mentions the product by roughly the name we track it under.
function defaultParser(html, row) {
  return pctNear(html, row.product) || null;
}

// ── per-lender parsers ───────────────────────────────────────────────────
// Isolated per lender so a page redesign only breaks one function, and a fix
// for one lender can't accidentally break another. Each parser returns a
// rate string (e.g. "8.95") or null — null means PARSE_FAILED, never a guess.
const PARSERS = {
  "AIB": (html, row) => {
    const id = row.products_json_id;
    if (id.includes("sbci-energy")) return pctNear(html, "SBCI") || pctNear(html, "energy upgrade");
    if (id.includes("loan-green")) return pctNear(html, "green personal loan") || pctNear(html, "green loan");
    if (id.includes("loan-home")) return pctNear(html, "home improvement");
    if (id === "aib-card-click") return pctNear(html, "click visa") || pctNear(html, "click card");
    if (id === "aib-card-platinum") return pctNear(html, "platinum visa") || pctNear(html, "platinum card");
    if (id === "aib-card-be") return pctNear(html, "'be'") || pctNear(html, "be visa") || pctNear(html, ">be<");
    return pctNear(html, "personal loan") || pctNear(html, "representative apr");
  },

  "Bank of Ireland": (html, row) => {
    const id = row.products_json_id;
    if (id.includes("sbci-energy")) return pctNear(html, "SBCI") || pctNear(html, "energy upgrade");
    if (id.includes("loan-green")) return pctNear(html, "green car") || pctNear(html, "home improvement loan");
    if (id === "boi-card-platinum") return pctNear(html, "platinum advantage");
    if (id === "boi-card-affinity") return pctNear(html, "affinity");
    if (id === "boi-card-classic") return pctNear(html, "classic credit card") || pctNear(html, "classic card");
    if (id === "boi-card-aer") return pctNear(html, "aer credit card") || pctNear(html, "aer club");
    return pctNear(html, "personal loan") || pctNear(html, "representative apr");
  },

  "PTSB": (html, row) => {
    const id = row.products_json_id;
    if (id.includes("sbci-energy")) return pctNear(html, "SBCI") || pctNear(html, "HEULS") || pctNear(html, "energy upgrade");
    if (id === "ptsb-card-ice") return pctNear(html, "ice visa") || pctNear(html, "ice card");
    return pctNear(html, "personal loan") || pctNear(html, "representative apr");
  },

  "An Post Money": (html, row) => {
    const id = row.products_json_id;
    if (id === "anpost-card-classic") return pctNear(html, "classic");
    if (id === "anpost-card-flex") return pctNear(html, "flex");
    return pctNear(html, "personal loan") || pctNear(html, "fixed rate loan");
  },

  "Revolut": (html, row) => {
    if (row.products_json_id === "revolut-card") return pctNear(html, "credit card") || pctNear(html, "representative apr");
    return pctNear(html, "personal loan") || pctNear(html, "representative apr");
  },

  "Avant Money": (html, row) => {
    if (row.products_json_id === "avant-card-one") return pctNear(html, "one card") || pctNear(html, "representative apr");
    return pctNear(html, "personal loan") || pctNear(html, "representative apr");
  },

  "First Choice CU": defaultParser,

  "Credit Union average": (html) =>
    pctNear(html, "average") || pctNear(html, "ILCU") || pctNear(html, "typical"),
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
  const lenders = parseCsv(readFileSync(new URL("../lenders.csv", import.meta.url), "utf8"));
  const products = JSON.parse(readFileSync(new URL("../products.json", import.meta.url), "utf8"));
  const productsById = new Map(products.map((p) => [p.slug, p]));

  // Cache fetches by URL — several products share one lender page, and
  // re-fetching the same page per product would multiply load for nothing.
  const pageCache = new Map();

  const results = [];

  for (const row of lenders) {
    const { lender, product, source_url: url, rate_type: rateType, products_json_id: id } = row;
    const product_entry = productsById.get(id);
    const currentValue = product_entry
      ? (rateType === "apr" ? (product_entry.apr ?? product_entry.rate) : (product_entry.rate ?? product_entry.purchaseRate))
      : undefined;
    const currentRate = currentValue ? pct(currentValue) : null;

    if (!url) {
      results.push({ lender, product, id, rateType, currentRate, scrapedRate: null, status: "PARSE_FAILED", detail: "no source_url in lenders.csv" });
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
          results.push({ lender, product, id, rateType, currentRate, scrapedRate: null, status: "UNREACHABLE", detail: `HTTP ${res.status}` });
          continue;
        }
        html = await res.text();
        pageCache.set(url, html);
      }
    } catch (e) {
      pageCache.set(url, null);
      const reason = e && e.name === "TimeoutError" ? "timeout" : (e && e.message) || String(e);
      results.push({ lender, product, id, rateType, currentRate, scrapedRate: null, status: "UNREACHABLE", detail: reason });
      continue;
    }

    if (html === null) {
      // A previous row already found this URL unreachable this run.
      results.push({ lender, product, id, rateType, currentRate, scrapedRate: null, status: "UNREACHABLE", detail: "source page unreachable (see earlier row)" });
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
      // one lender page can fail for several products in the same run (e.g.
      // AIB's rate page serving 3 loan products), and a lender-only filename
      // would silently overwrite earlier failures instead of keeping all of them.
      mkdirSync(new URL("../rates/debug/", import.meta.url), { recursive: true });
      const debugFile = new URL(`../rates/debug/${slugify(lender)}-${id}-${date}.html`, import.meta.url);
      writeFileSync(debugFile, html);
      results.push({ lender, product, id, rateType, currentRate, scrapedRate: null, status: "PARSE_FAILED", detail: "parser found no matching rate — raw HTML saved to rates/debug/" });
      continue;
    }

    const status = currentRate !== null && scrapedRate === currentRate ? "OK" : "CHANGED";
    results.push({ lender, product, id, rateType, currentRate, scrapedRate, status, detail: "" });
  }

  writeSnapshot(date, results);
  writeChangesReport(date, results);

  const failCount = results.filter((r) => r.status === "PARSE_FAILED" || r.status === "UNREACHABLE").length;
  const changedCount = results.filter((r) => r.status === "CHANGED").length;
  console.log(`Checked ${results.length} products: ${results.length - failCount - changedCount} OK, ${changedCount} changed, ${failCount} need attention.`);

  if (failCount > 0) process.exitCode = 1;
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function writeSnapshot(date, results) {
  const header = "lender,product,products_json_id,rate_type,current_rate,scraped_rate,status,detail";
  const lines = results.map((r) =>
    [r.lender, r.product, r.id, r.rateType, r.currentRate ?? "", r.scrapedRate ?? "", r.status, r.detail]
      .map(csvCell)
      .join(",")
  );
  mkdirSync(new URL("../rates/", import.meta.url), { recursive: true });
  writeFileSync(new URL(`../rates/rates-${date}.csv`, import.meta.url), [header, ...lines].join("\n") + "\n");
}

function writeChangesReport(date, results) {
  const flagged = results.filter((r) => r.status !== "OK");
  let md;
  if (flagged.length === 0) {
    md = `No changes detected — ${results.length} products checked, all current as of ${date}.\n`;
  } else {
    const changed = flagged.filter((r) => r.status === "CHANGED");
    const failed = flagged.filter((r) => r.status !== "CHANGED");
    md = `# Rate check — ${date}\n\n${flagged.length} of ${results.length} products need attention.\n`;
    if (changed.length) {
      md += `\n## Changed rates\n\n| Lender | Product | Published | Scraped | Source |\n|---|---|---|---|---|\n`;
      md += changed.map((r) => `| ${r.lender} | ${r.product} | ${r.currentRate ?? "—"}% | ${r.scrapedRate}% | \`${r.id}\` |`).join("\n") + "\n";
    }
    if (failed.length) {
      md += `\n## Needs attention (${failed.map((r) => r.status).filter((v, i, a) => a.indexOf(v) === i).join(" / ")})\n\n`;
      md += `| Lender | Product | Status | Detail |\n|---|---|---|---|\n`;
      md += failed.map((r) => `| ${r.lender} | ${r.product} | ${r.status} | ${r.detail} |`).join("\n") + "\n";
    }
  }
  writeFileSync(new URL(`../rates/CHANGES-${date}.md`, import.meta.url), md);
}

main().catch((e) => {
  console.error("check-rates.mjs failed:", e && e.message ? e.message : e);
  process.exitCode = 1;
});
