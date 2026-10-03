// scripts/stamp-verified.mjs
// Moves the "Rates verified" stamp on loans.html and cards.html to the
// fortnightly check date. Run by the rate-check workflow, whose output lands
// in a PR — merging that PR (after resolving any CHANGED / failed rows) is
// the human sign-off that the published rates were reviewed on this date.
//
// Updates, per page: meta.last_full_review in data/<page>.json, every
// LAST_VERIFIED marker, the JSON-LD dateModified, and the sitemap lastmod.
// Deliberately narrower than build.cjs, which also rewrites index, privacy
// and the whole sitemap on every run.
//
// Run:  node scripts/stamp-verified.mjs [YYYY-MM-DD]   (defaults to today)

import { readFileSync, writeFileSync } from "node:fs";

const PAGES = ["loans", "cards"];

const dateIso = process.argv[2] ?? new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
  console.error(`Invalid date "${dateIso}" — expected YYYY-MM-DD`);
  process.exit(1);
}

// "2026-06-25" → "25 June 2026" (same format as build.cjs)
function fmtDateLong(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric" });
}

const file = (p) => new URL(`../${p}`, import.meta.url);

// Replace every match of `re`, failing loudly if the pattern is missing so a
// template change can't silently leave a stale date on the live page.
function replaceAll(text, re, replacement, label) {
  if (!re.test(text)) throw new Error(`${label}: pattern ${re} not found`);
  return text.replace(re, replacement);
}

const dateLong = fmtDateLong(dateIso);
let sitemap = readFileSync(file("sitemap.xml"), "utf8");

for (const page of PAGES) {
  // Text edit rather than JSON round-trip, which would rewrite hand-formatted
  // numbers like "apr": 4.20 across the whole file.
  const dataPath = file(`data/${page}.json`);
  const json = replaceAll(readFileSync(dataPath, "utf8"), /("last_full_review": )"\d{4}-\d{2}-\d{2}"/g,
    `$1"${dateIso}"`, `data/${page}.json`);
  if (JSON.parse(json).meta.last_full_review !== dateIso) throw new Error(`data/${page}.json: meta.last_full_review not updated`);
  writeFileSync(dataPath, json);

  const htmlPath = file(`${page}.html`);
  let html = readFileSync(htmlPath, "utf8");
  html = replaceAll(html, /<!-- LAST_VERIFIED_START -->[\s\S]*?<!-- LAST_VERIFIED_END -->/g,
    `<!-- LAST_VERIFIED_START -->${dateLong}<!-- LAST_VERIFIED_END -->`, `${page}.html`);
  html = replaceAll(html, /"dateModified": "\d{4}-\d{2}-\d{2}"/g, `"dateModified": "${dateIso}"`, `${page}.html`);
  writeFileSync(htmlPath, html);

  sitemap = replaceAll(sitemap,
    new RegExp(`(<loc>https://borrowclever\\.ie/${page}\\.html</loc>\\s*<lastmod>)\\d{4}-\\d{2}-\\d{2}(</lastmod>)`, "g"),
    `$1${dateIso}$2`, "sitemap.xml");

  console.log(`[stamp] ${page}.html: rates verified "${dateLong}"`);
}

writeFileSync(file("sitemap.xml"), sitemap);
