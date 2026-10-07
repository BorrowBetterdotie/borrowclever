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
// CCPC fallback: AIB and PTSB serve every request from a non-browser client an
// Akamai "Access Denied" (HTTP 403), and Revolut serves a Cloudflare challenge.
// That's deliberate bot protection, so this script does not try to get round
// it. When a lender page is unreachable or unparseable, the row is checked
// against the same product's figure on CCPC's comparison tool instead (mapped
// explicitly via lenders.csv's ccpc_product column) and marked source=ccpc.
// Every row's CCPC figure is also shown alongside the scraped one, so a
// misparsed lender page is easy to spot. See docs/ccpc-endpoint-notes.md.
//
// Run:  node scripts/check-rates.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fetchCcpcLoans, fetchCcpcCards, ccpcAttr } from "./lib/ccpc.mjs";

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

  // The page's loan calculator embeds the full rate table in a hidden input:
  // "min|max|rate|apr|…|Product####min|max|…" per tier, "@@@@" between
  // products. Read the APR for the tier covering the €15k–€25k band tracked.
  "First Choice CU": (html) => {
    const m = html.match(/id="VarCalcAIRRanges"[^>]*value="([^"]+)"/);
    if (!m) return null;
    for (const tier of m[1].split(/@@@@|####/)) {
      const [min, max, , apr, , , , name] = tier.split("|");
      if (name === "Personal Loan" && Number(min) <= 15001 && Number(max) >= 25000 && /^\d{1,2}(\.\d{1,2})?$/.test(apr)) return apr;
    }
    return null;
  },

  "Credit Union average": (html) =>
    pctNear(html, "average") || pctNear(html, "ILCU") || pctNear(html, "typical"),
};

function getParser(lenderName) {
  return PARSERS[lenderName] || defaultParser;
}

// ── CCPC fallback ──────────────────────────────────────────────────────
// lenders.csv ccpc_product is "loan|<ProviderName>|<ProductName>" or
// "card|…". Exact product-name match first (case-insensitive); otherwise a
// unique prefix match, for CCPC names that carry a rate range in them (e.g.
// "Revolut Personal Loan from 6.50% to 12.99%"). Ambiguous → no match.
// An optional 4th field "from" checks the "from X%" figure in that name
// instead of the Rate field — for products.json rows that publish the
// lender's advertised best-case rate rather than CCPC's €10k/5-year one.
function findCcpcEntry(ccpc, spec) {
  if (!spec) return { entry: null, detail: "no CCPC counterpart mapped in lenders.csv" };
  const [kind, provider, productName, field] = spec.split("|").map((x) => x.trim());
  const source = kind === "card" ? ccpc.cards : ccpc.loans;
  if (!source.ok) return { entry: null, detail: `CCPC ${kind} data unavailable: ${source.runStatus} — ${source.detail}` };
  const lc = (x) => String(x).toLowerCase();
  const sameLender = source.data.filter((c) => lc(c.ProviderName) === lc(provider));
  const exact = sameLender.filter((c) => lc(c.ProductName) === lc(productName));
  const prefix = sameLender.filter((c) => lc(c.ProductName).startsWith(lc(productName)));
  const hits = exact.length ? exact : prefix;
  if (hits.length !== 1) return { entry: null, detail: `CCPC: ${hits.length} matches for "${spec}"` };
  return { entry: hits[0], kind, field };
}

function ccpcRateFor(ccpc, spec) {
  const { entry, kind, field, detail } = findCcpcEntry(ccpc, spec);
  if (!entry) return { rate: null, detail };
  const raw = field === "from" ? entry.ProductName.match(/\bfrom\s+(\d{1,2}(?:\.\d{1,2})?)\s*%/i)?.[1]
    : kind === "card" ? ccpcAttr(entry, "APR:") : entry.Rate;
  const rate = raw === undefined || raw === null ? null : String(Number(raw));
  return { rate, product: `${entry.ProviderName} — ${entry.ProductName}`, detail: rate ? "" : "CCPC entry has no rate" };
}

function ratesEqual(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return Math.abs(parseFloat(a) - parseFloat(b)) < 0.005;
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

  // Two requests, one per category — each returns every lender's products.
  const ccpc = { loans: await fetchCcpcLoans(), cards: await fetchCcpcCards() };
  for (const [k, v] of Object.entries(ccpc)) if (!v.ok) console.log(`CCPC ${k} unavailable: ${v.runStatus} — ${v.detail}`);

  const results = [];
  const push = (r) => results.push(withCcpc(r));

  // Attach the CCPC figure to every row, and stand it in for the lender page
  // when that page couldn't be read.
  function withCcpc(r) {
    const c = ccpcRateFor(ccpc, r.ccpcSpec);
    r.ccpcRate = c.rate;
    r.source = "lender";
    if (r.scrapedRate) return r;
    if (!c.rate) {
      if (r.ccpcSpec) r.detail += ` · CCPC fallback unavailable: ${c.detail}`;
      return r;
    }
    const reason = r.status === "PARSE_FAILED" ? "unparseable" : `unreachable (${r.detail})`;
    r.scrapedRate = c.rate;
    r.source = "ccpc";
    r.status = ratesEqual(c.rate, r.currentRate) ? "OK" : "CHANGED";
    r.detail = `lender page ${reason} — rate taken from CCPC: ${c.product}`;
    return r;
  }

  for (const row of lenders) {
    const { lender, product, source_url: url, rate_type: rateType, products_json_id: id, ccpc_product: ccpcSpec } = row;
    const product_entry = productsById.get(id);
    const currentValue = product_entry
      ? (rateType === "apr" ? (product_entry.apr ?? product_entry.rate) : (product_entry.rate ?? product_entry.purchaseRate))
      : undefined;
    const currentRate = currentValue ? pct(currentValue) : null;

    if (!url) {
      push({ lender, product, id, rateType, ccpcSpec, currentRate, scrapedRate: null, status: "PARSE_FAILED", detail: "no source_url in lenders.csv" });
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
          push({ lender, product, id, rateType, ccpcSpec, currentRate, scrapedRate: null, status: "UNREACHABLE", detail: `HTTP ${res.status}` });
          continue;
        }
        html = await res.text();
        pageCache.set(url, html);
      }
    } catch (e) {
      pageCache.set(url, null);
      const reason = e && e.name === "TimeoutError" ? "timeout" : (e && e.message) || String(e);
      push({ lender, product, id, rateType, ccpcSpec, currentRate, scrapedRate: null, status: "UNREACHABLE", detail: reason });
      continue;
    }

    if (html === null) {
      // A previous row already found this URL unreachable this run.
      push({ lender, product, id, rateType, ccpcSpec, currentRate, scrapedRate: null, status: "UNREACHABLE", detail: "source page unreachable (see earlier row)" });
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
      push({ lender, product, id, rateType, ccpcSpec, currentRate, scrapedRate: null, status: "PARSE_FAILED", detail: "parser found no matching rate — raw HTML saved to rates/debug/" });
      continue;
    }

    const status = currentRate !== null && ratesEqual(scrapedRate, currentRate) ? "OK" : "CHANGED";
    push({ lender, product, id, rateType, ccpcSpec, currentRate, scrapedRate, status, detail: "" });
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
  // scraped_rate is the figure the status was decided on; source says where
  // it came from ("lender" page or the "ccpc" fallback). ccpc_rate is CCPC's
  // figure for the same product whenever one is mapped, for comparison.
  const header = "lender,product,products_json_id,rate_type,current_rate,scraped_rate,status,detail,source,ccpc_rate";
  const lines = results.map((r) =>
    [r.lender, r.product, r.id, r.rateType, r.currentRate ?? "", r.scrapedRate ?? "", r.status, r.detail, r.source, r.ccpcRate ?? ""]
      .map(csvCell)
      .join(",")
  );
  mkdirSync(new URL("../rates/", import.meta.url), { recursive: true });
  writeFileSync(new URL(`../rates/rates-${date}.csv`, import.meta.url), [header, ...lines].join("\n") + "\n");
}

function writeChangesReport(date, results) {
  const flagged = results.filter((r) => r.status !== "OK");
  const viaCcpc = results.filter((r) => r.status === "OK" && r.source === "ccpc");
  const pctCell = (v) => (v ? `${v}%` : "—");
  let md;
  if (flagged.length === 0) {
    md = `No changes detected — ${results.length} products checked, all current as of ${date}.\n`;
  } else {
    const changed = flagged.filter((r) => r.status === "CHANGED");
    const failed = flagged.filter((r) => r.status !== "CHANGED");
    md = `# Rate check — ${date}\n\n${flagged.length} of ${results.length} products need attention.\n`;
    if (changed.length) {
      md += `\n## Changed rates\n\nIf "Found" comes from the lender page and CCPC still matches "Published", the lender-page parser has most likely picked up the wrong figure (an intro offer or a different loan-size tier) — confirm before editing products.json.\n\n`;
      md += `| Lender | Product | Published | Found | Found via | CCPC | Source |\n|---|---|---|---|---|---|---|\n`;
      md += changed.map((r) => `| ${r.lender} | ${r.product} | ${pctCell(r.currentRate)} | ${r.scrapedRate}% | ${r.source} | ${pctCell(r.ccpcRate)} | \`${r.id}\` |`).join("\n") + "\n";
    }
    if (failed.length) {
      md += `\n## Needs attention (${failed.map((r) => r.status).filter((v, i, a) => a.indexOf(v) === i).join(" / ")})\n\n`;
      md += `| Lender | Product | Status | Detail |\n|---|---|---|---|\n`;
      md += failed.map((r) => `| ${r.lender} | ${r.product} | ${r.status} | ${r.detail} |`).join("\n") + "\n";
    }
  }
  if (viaCcpc.length) {
    md += `\n## Verified via CCPC fallback\n\nThe lender's own page couldn't be read (AIB, PTSB and Revolut block automated requests), so these were checked against CCPC's comparison tool only. They match the published rate.\n\n`;
    md += `| Lender | Product | Published | CCPC | Detail |\n|---|---|---|---|---|\n`;
    md += viaCcpc.map((r) => `| ${r.lender} | ${r.product} | ${pctCell(r.currentRate)} | ${r.scrapedRate}% | ${r.detail} |`).join("\n") + "\n";
  }
  writeFileSync(new URL(`../rates/CHANGES-${date}.md`, import.meta.url), md);
}

main().catch((e) => {
  console.error("check-rates.mjs failed:", e && e.message ? e.message : e);
  process.exitCode = 1;
});
