// build-products.mjs
// Single source of truth -> Worker map.
// Reads products.json and writes products.generated.js (imported by worker.js).
// Run after editing products.json:  node build-products.mjs
//
// Add a provider/card = add one object to products.json, run this, then deploy.
// The Worker is never edited by hand.

import { readFileSync, writeFileSync } from "node:fs";

const products = JSON.parse(readFileSync(new URL("./products.json", import.meta.url)));

const seen = new Set();
const map = {};
for (const p of products) {
  if (p.active === false) continue;                 // optional: hide a row
  if (!p.slug || !p.url) { console.warn("skipping (missing slug/url):", p.name); continue; }
  if (seen.has(p.slug)) throw new Error(`Duplicate slug: ${p.slug}`);
  seen.add(p.slug);
  map[p.slug] = { lender: p.lender, category: p.category, product: p.product, name: p.name, url: p.url };
}

const out =
  "// AUTO-GENERATED from products.json by build-products.mjs — DO NOT EDIT BY HAND.\n" +
  "export const PRODUCTS = " + JSON.stringify(map, null, 2) + ";\n";

writeFileSync(new URL("./worker/products.generated.js", import.meta.url), out);

const todo = products.filter((p) => p.todo).map((p) => p.slug);
console.log(`Generated products.generated.js with ${Object.keys(map).length} products.`);
if (todo.length) console.log(`Still using a landing-page fallback (replace url when you have the deep-link): ${todo.length}\n  ` + todo.join("\n  "));
