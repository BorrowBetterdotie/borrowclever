// scripts/build-calculator.mjs
// Injects current loan products and the shared amortization library into
// calculator/index.html, in place, between marker comments — the same pattern
// build-table.mjs uses for the comparison tables.
//
//   bc:calc-products — BC_PRODUCTS (slug/label/rate from products.json, loans
//                      only, cheapest first) and BC_RATES_ASOF (build date)
//   bc:calc-lib      — the source of lib/amortization.mjs with `export `
//                      stripped, so the page runs the exact same maths as the
//                      worked-example pages
//
// The page's UI code is hand-written and never touched by this script.
//
// Run:  node scripts/build-calculator.mjs   (part of npm run build)

import { readFileSync, writeFileSync } from "node:fs";

const TARGET = new URL("../calculator/index.html", import.meta.url);
const products = JSON.parse(readFileSync(new URL("../products.json", import.meta.url), "utf8"));

const fmtLong = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
};

const loans = products
  .filter((p) => p.category === "loan")
  .map((p) => {
    const m = String(p.rate).match(/(\d{1,2}(?:\.\d{1,2})?)\s*%/);
    return m ? { slug: p.slug, label: p.name, rate: Number(m[1]) } : null;
  })
  .filter(Boolean)
  .sort((a, b) => a.rate - b.rate);

const productsBlock =
  `const BC_PRODUCTS = ${JSON.stringify(loans, null, 2)};\n` +
  `const BC_RATES_ASOF = ${JSON.stringify("rates as of " + fmtLong(new Date().toISOString().slice(0, 10)))};`;

// Strip module syntax so the library runs as an inline classic script.
const libBlock = readFileSync(new URL("../lib/amortization.mjs", import.meta.url), "utf8").replace(/^export /gm, "");

let html = readFileSync(TARGET, "utf8");
const inject = (name, block) => {
  const re = new RegExp(`(<!--\\s*bc:${name}:start\\s*-->)([\\s\\S]*?)(<!--\\s*bc:${name}:end\\s*-->)`);
  if (!re.test(html)) throw new Error(`build-calculator: no bc:${name} markers in calculator/index.html`);
  html = html.replace(re, `$1\n${block}\n$3`);
};
inject("calc-products", productsBlock);
inject("calc-lib", libBlock);
writeFileSync(TARGET, html);
console.log(`calculator/index.html: injected ${loans.length} loan rates and lib/amortization.mjs.`);
