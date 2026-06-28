// build-table.mjs
// Single source of truth -> static comparison table HTML (build-time, crawlable).
// Reads products.json and:
//   1. writes table.css (style it / replace to match your site),
//   2. writes table-preview.html (open in a browser to see it),
//   3. if a target page (default ./index.html) contains the marker pairs
//      <!-- bc:loans:start --> … <!-- bc:loans:end --> and the cards equivalents,
//      replaces the rows between them in place (keeps your surrounding design).
//
// Run after editing products.json:  node build-table.mjs  [path/to/index.html]
// Pairs with build-products.mjs (the Worker map) — one data file drives both.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const products = JSON.parse(readFileSync(new URL("./products.json", import.meta.url)));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const val = (s) => (s === undefined || s === null || s === "" ? "—" : esc(s));
const productLabel = (p) => {
  let s = p.name || "";
  if (p.lenderName && s.startsWith(p.lenderName)) s = s.slice(p.lenderName.length).trim();
  return esc(s || p.name || p.slug);
};
const cta = (p) =>
  `<a class="bc-cta" href="/go/${esc(p.slug)}" target="_blank" rel="noopener noreferrer" ` +
  `aria-label="Check rate for ${esc(p.name)} on their official site">Check rate</a>`;
const meta = (p) => {
  const bits = [];
  if (p.badge) bits.push(`<span class="bc-badge${/cheapest|lowest/i.test(p.badge) ? " bc-badge--best" : ""}">${esc(p.badge)}</span>`);
  if (p.balanceTransfer) bits.push(`<span class="bc-note">${esc(p.balanceTransfer)}</span>`);
  if (p.notes) bits.push(`<span class="bc-note">${esc(p.notes)}</span>`);
  return bits.length ? `<div class="bc-meta">${bits.join("")}</div>` : "";
};

const loans = products.filter((p) => p.category === "loan");
const cards = products.filter((p) => p.category === "card");

const loanRows = loans.map((p) => `      <tr${p.badge && /cheapest/i.test(p.badge) ? ' class="bc-row--featured"' : ""}>
        <th scope="row" data-label="Lender">${esc(p.lenderName)}</th>
        <td data-label="Product"><span class="bc-product">${productLabel(p)}</span>${meta(p)}</td>
        <td data-label="Rate" class="bc-num bc-rate">${val(p.rate)}</td>
        <td data-label="Type">${val(p.rateType)}</td>
        <td data-label="Monthly" class="bc-num">${val(p.monthly)}</td>
        <td data-label="Cost of credit" class="bc-num">${val(p.costOfCredit)}</td>
        <td data-label="Total repayable" class="bc-num">${val(p.totalRepayable)}</td>
        <td data-label="" class="bc-act">${cta(p)}</td>
      </tr>`).join("\n");

const cardRows = cards.map((p) => `      <tr${p.badge && /lowest/i.test(p.badge) ? ' class="bc-row--featured"' : ""}>
        <th scope="row" data-label="Lender">${esc(p.lenderName)}</th>
        <td data-label="Card"><span class="bc-product">${productLabel(p)}</span>${meta(p)}</td>
        <td data-label="Network">${val(p.network)}</td>
        <td data-label="Purchase rate" class="bc-num">${val(p.purchaseRate)}</td>
        <td data-label="APR" class="bc-num bc-rate">${val(p.apr)}</td>
        <td data-label="Annual fee" class="bc-num">${val(p.annualFee)}</td>
        <td data-label="" class="bc-act">${cta(p)}</td>
      </tr>`).join("\n");

const loansTable = `<div class="bc-scroll">
  <table class="bc-table">
    <caption class="bc-caption">Personal loans — €10,000 over 60 months, ranked by total cost of credit</caption>
    <thead>
      <tr>
        <th scope="col">Lender</th><th scope="col">Product</th>
        <th scope="col" class="bc-num">Rate</th><th scope="col">Type</th>
        <th scope="col" class="bc-num">Monthly</th><th scope="col" class="bc-num">Cost of credit</th>
        <th scope="col" class="bc-num">Total repayable</th><th scope="col"><span class="bc-vh">Action</span></th>
      </tr>
    </thead>
    <tbody>
${loanRows}
    </tbody>
  </table>
</div>`;

const cardsTable = `<div class="bc-scroll">
  <table class="bc-table">
    <caption class="bc-caption">Credit cards — representative purchase rate and APR</caption>
    <thead>
      <tr>
        <th scope="col">Lender</th><th scope="col">Card</th><th scope="col">Network</th>
        <th scope="col" class="bc-num">Purchase rate</th><th scope="col" class="bc-num">APR</th>
        <th scope="col" class="bc-num">Annual fee</th><th scope="col"><span class="bc-vh">Action</span></th>
      </tr>
    </thead>
    <tbody>
${cardRows}
    </tbody>
  </table>
</div>`;

// 1) stylesheet
writeFileSync(new URL("./table.css", import.meta.url), CSS());

// 2) standalone preview
writeFileSync(new URL("./table-preview.html", import.meta.url), `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>borrowclever — comparison table preview</title>
<link rel="stylesheet" href="table.css">
</head><body class="bc-body">
  <main class="bc-wrap">
    <h1 class="bc-h">Compare personal loans</h1>
    <!-- bc:loans:start -->
${loansTable}
    <!-- bc:loans:end -->
    <h1 class="bc-h">Compare credit cards</h1>
    <!-- bc:cards:start -->
${cardsTable}
    <!-- bc:cards:end -->
    <p class="bc-disclaimer">Information only — borrowclever.ie is an independent comparison site and does not arrange credit. Rates shown are indicative; confirm current terms on the provider's website. APR is the figure to compare.</p>
  </main>
</body></html>
`);

// 3) optional in-place injection into the real page
const target = process.argv[2] || new URL("./index.html", import.meta.url).pathname;
if (existsSync(target)) {
  let html = readFileSync(target, "utf8");
  const inject = (html, name, block) => {
    const re = new RegExp(`(<!--\\s*bc:${name}:start\\s*-->)([\\s\\S]*?)(<!--\\s*bc:${name}:end\\s*-->)`, "i");
    return re.test(html) ? html.replace(re, `$1\n${block}\n$3`) : (console.warn(`No bc:${name} markers in ${target} — skipped.`), html);
  };
  html = inject(html, "loans", loansTable);
  html = inject(html, "cards", cardsTable);
  writeFileSync(target, html);
  console.log(`Injected loans + cards into ${target}.`);
} else {
  console.log(`No target page at ${target} — wrote table-preview.html only. Add the marker pairs to your page and re-run with: node build-table.mjs path/to/index.html`);
}

console.log(`Rendered ${loans.length} loans + ${cards.length} cards from products.json.`);

function CSS() {
  return `/* table.css — generated style for the borrowclever comparison tables.
   Neutral on purpose: restyle freely to match your site, or map these classes
   onto your existing styles. Figures use tabular numerals; APR/Rate is the
   most prominent number per CCPC advertising rules. */
:root{
  --bc-ink:#14233b; --bc-muted:#5d6b7e; --bc-line:#e6e9ee; --bc-surface:#ffffff;
  --bc-accent:#0f766e; --bc-accent-ink:#0b5b54; --bc-featured:#f3faf8; --bc-badge:#eef2f7;
}
.bc-body{background:#f7f8fa;color:var(--bc-ink);font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;margin:0}
.bc-wrap{max-width:1080px;margin:0 auto;padding:2.5rem 1rem}
.bc-h{font-size:1.4rem;letter-spacing:-.01em;margin:2rem 0 .25rem}
.bc-scroll{overflow-x:auto;border:1px solid var(--bc-line);border-radius:14px;background:var(--bc-surface)}
.bc-table{width:100%;border-collapse:collapse;min-width:780px}
.bc-caption{caption-side:top;text-align:left;color:var(--bc-muted);font-size:.85rem;padding:.9rem 1rem .2rem}
.bc-table thead th{font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;color:var(--bc-muted);font-weight:600;text-align:left;padding:.7rem 1rem;border-bottom:1px solid var(--bc-line)}
.bc-table tbody th,.bc-table td{padding:.85rem 1rem;border-bottom:1px solid var(--bc-line);vertical-align:top;text-align:left}
.bc-table tbody tr:last-child th,.bc-table tbody tr:last-child td{border-bottom:0}
.bc-table tbody th{font-weight:700}
.bc-num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.bc-rate{font-size:1.05rem;font-weight:700;color:var(--bc-ink)}
.bc-product{font-weight:600}
.bc-meta{margin-top:.35rem;display:flex;flex-direction:column;gap:.3rem}
.bc-badge{align-self:flex-start;font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--bc-muted);background:var(--bc-badge);border-radius:999px;padding:.15rem .55rem}
.bc-badge--best{color:#fff;background:var(--bc-accent)}
.bc-note{font-size:.82rem;color:var(--bc-muted);line-height:1.4}
.bc-row--featured{background:var(--bc-featured);box-shadow:inset 3px 0 0 var(--bc-accent)}
.bc-act{text-align:right;white-space:nowrap}
.bc-cta{display:inline-block;font-weight:600;font-size:.9rem;color:#fff;background:var(--bc-accent);border-radius:9px;padding:.5rem .9rem;text-decoration:none;transition:background .15s ease}
.bc-cta:hover{background:var(--bc-accent-ink)}
.bc-cta:focus-visible{outline:3px solid #99f6e4;outline-offset:2px}
.bc-vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.bc-disclaimer{margin-top:1.5rem;font-size:.8rem;color:var(--bc-muted)}
@media (prefers-reduced-motion:reduce){.bc-cta{transition:none}}
/* Stacked card layout on small screens */
@media (max-width:680px){
  .bc-scroll{overflow:visible;border:0;background:transparent}
  .bc-table{min-width:0}
  .bc-table thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
  .bc-table tbody tr{display:block;background:var(--bc-surface);border:1px solid var(--bc-line);border-radius:14px;margin-bottom:.9rem;padding:.4rem .2rem}
  .bc-table tbody th,.bc-table td{display:flex;justify-content:space-between;gap:1rem;border:0;padding:.45rem 1rem;text-align:right}
  .bc-table tbody th{text-align:left}
  .bc-table td::before{content:attr(data-label);font-size:.72rem;text-transform:uppercase;letter-spacing:.04em;color:var(--bc-muted);font-weight:600;text-align:left}
  .bc-table td.bc-act::before,.bc-table td[data-label=""]::before{content:none}
  .bc-meta{align-items:flex-end}
  .bc-act{justify-content:flex-end}
}
`;
}
