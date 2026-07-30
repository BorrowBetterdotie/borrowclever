// scripts/append-rate-history.mjs
// Appends today's published rates to rates/rate-history.json — the append-only
// log behind the public /rate-tracker/ page.
//
// Snapshots the *published* values in products.json, not the raw scraped values
// from check-rates.mjs. That is deliberate: scraped rates are noisy (a bank page
// redesign can yield 0% or a cashback percentage), and check-rates.mjs itself
// never writes to products.json — corrections stay a manual, reviewed step. So
// the history records what the site actually published on each check date,
// which is the number a chart of "how rates moved" should show.
//
// Loans record the nominal rate (%); cards record the representative APR (%).
// One snapshot per date — re-running on the same day replaces that day's entry.
//
// Run:  node scripts/append-rate-history.mjs   (the fortnightly workflow runs
// this after the rate checks; safe to run locally too)

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const HISTORY_URL = new URL("../rates/rate-history.json", import.meta.url);

// Pull the leading percentage out of a value like "8.95%" or "8.95% Variable".
function pct(s) {
  const m = String(s ?? "").match(/(\d{1,2}(?:\.\d{1,2})?)\s*%/);
  return m ? Number(m[1]) : null;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

const products = JSON.parse(readFileSync(new URL("../products.json", import.meta.url), "utf8"));

const rates = {};
for (const p of products) {
  const value = p.category === "loan" ? pct(p.rate) : pct(p.apr);
  if (value !== null) rates[p.slug] = value;
}

const history = existsSync(HISTORY_URL)
  ? JSON.parse(readFileSync(HISTORY_URL, "utf8"))
  : {
      note:
        "Append-only history of published rates from products.json. Loans record the nominal rate (%); cards record the representative APR (%). Appended by scripts/append-rate-history.mjs on each fortnightly rate-check run.",
      snapshots: [],
    };

const date = today();
const snapshot = { date, source: "products.json (published rates at fortnightly check)", rates };

const prev = history.snapshots.filter((s) => s.date !== date).at(-1);
history.snapshots = history.snapshots.filter((s) => s.date !== date);
history.snapshots.push(snapshot);
history.snapshots.sort((a, b) => a.date.localeCompare(b.date));

writeFileSync(HISTORY_URL, JSON.stringify(history, null, 2) + "\n");

// Log what moved since the previous snapshot so the workflow output tells the story.
if (prev) {
  const moved = Object.keys(rates).filter((slug) => prev.rates[slug] !== undefined && prev.rates[slug] !== rates[slug]);
  if (moved.length) {
    console.log(`rate-history.json: appended ${date} — ${moved.length} rate(s) moved since ${prev.date}:`);
    for (const slug of moved) console.log(`  ${slug}: ${prev.rates[slug]}% -> ${rates[slug]}%`);
  } else {
    console.log(`rate-history.json: appended ${date} — no movement since ${prev.date} (${Object.keys(rates).length} products).`);
  }
} else {
  console.log(`rate-history.json: started history with ${Object.keys(rates).length} products on ${date}.`);
}
