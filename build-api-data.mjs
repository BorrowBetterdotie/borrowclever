// build-api-data.mjs
// Bundles data/loans.json and data/cards.json into worker/api-data.generated.js
// for the /api/v1/{loans,cards} routes. Run after editing either file:
//   node build-api-data.mjs
// The Worker never reads these JSON files directly — it imports this generated map.

import { readFileSync, writeFileSync } from "node:fs";

const loans = JSON.parse(readFileSync(new URL("./data/loans.json", import.meta.url)));
const cards = JSON.parse(readFileSync(new URL("./data/cards.json", import.meta.url)));

function stripPresentationFields(items) {
  return items.map(({ icon, iconCls, homepage, ...rest }) => rest);
}

const map = {
  generated_at: new Date().toISOString(),
  loans: { last_full_review: loans.meta.last_full_review, items: stripPresentationFields(loans.loans) },
  cards: { last_full_review: cards.meta.last_full_review, items: stripPresentationFields(cards.cards) },
};

const out =
  "// AUTO-GENERATED from data/loans.json and data/cards.json by build-api-data.mjs — DO NOT EDIT BY HAND.\n" +
  "export const API_DATA = " + JSON.stringify(map, null, 2) + ";\n";

writeFileSync(new URL("./worker/api-data.generated.js", import.meta.url), out);

console.log(`[build-api-data] worker/api-data.generated.js: ${map.loans.items.length} loans, ${map.cards.items.length} cards.`);
