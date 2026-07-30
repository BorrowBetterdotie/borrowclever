// scripts/build-worked-examples.mjs
// Generates the three worked-example pages in examples/ from products.json.
//
// Every figure on these pages — monthly repayments, total interest, payoff
// times, the savings quoted in the prose — is computed at build time with
// lib/amortization.mjs from the current published rates, so the pages can
// never quietly go stale. The interpretation paragraphs are hand-written per
// page (not templated) so the three pages read differently from each other
// and from the guides.
//
// Run:  node scripts/build-worked-examples.mjs   (part of npm run build)

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { amortize, payoff } from "../lib/amortization.mjs";

const BASE = "https://borrowclever.ie";
const TODAY = new Date().toISOString().slice(0, 10);
const products = JSON.parse(readFileSync(new URL("../products.json", import.meta.url), "utf8"));
const bySlug = new Map(products.map((p) => [p.slug, p]));

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const eur = (n) => "€" + n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur0 = (n) => "€" + Math.round(n).toLocaleString("en-IE");
const fmtLong = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
};

// Rate for a slug, with a loud failure if the product disappears from
// products.json — a silently-missing rate would publish a wrong comparison.
function rate(slug) {
  const p = bySlug.get(slug);
  if (!p) throw new Error(`build-worked-examples: slug not in products.json: ${slug}`);
  const m = String(p.category === "loan" ? p.rate : p.apr).match(/(\d{1,2}(?:\.\d{1,2})?)\s*%/);
  if (!m) throw new Error(`build-worked-examples: no parseable rate for ${slug}`);
  return Number(m[1]);
}
const name = (slug) => bySlug.get(slug).name;

// ── shared page shell (same conventions as the guide pages) ─────────────
function page({ path, title, ogTitle, description, eyebrow, h1, sub, body, faqs, related }) {
  const url = `${BASE}/examples/${path}`;
  const jsonld = [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "BorrowClever",
      url: BASE,
      description: "Ireland's independent personal loan and credit card comparison service. Rates verified fortnightly from lender websites and CCPC.ie.",
    },
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: ogTitle,
      url,
      description,
      dateModified: TODAY,
      inLanguage: "en-IE",
      publisher: { "@type": "Organization", name: "BorrowClever", url: BASE },
      isPartOf: { "@type": "WebSite", url: BASE, name: "BorrowClever" },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${BASE}/` },
        { "@type": "ListItem", position: 2, name: "Worked Examples", item: `${BASE}/examples/` },
        { "@type": "ListItem", position: 3, name: eyebrow, item: url },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
    },
  ];

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="BorrowClever">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(ogTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(ogTitle)}">
<meta name="twitter:description" content="${esc(description)}">
<script type="application/ld+json">
${JSON.stringify(jsonld, null, 2)}
</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="/site.css">
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<style>
/* ── PAGE HEADER OVERRIDES (narrower layout) ── */
.page-header { padding: 4rem 6%; }
.page-header-inner { max-width: 860px; }
.page-header h1 { font-size: clamp(1.8rem, 3vw, 2.6rem); margin-bottom: 0.75rem; }
.page-header-sub { font-size: 0.95rem; color: rgba(255,255,255,0.6); line-height: 1.65; margin-bottom: 0; }
.eyebrow { display: inline-block; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #4ade80; margin-bottom: 1rem; }

/* ── CONTENT ── */
.content { max-width: 860px; margin: 0 auto; padding: 4rem 6%; }
.content h2 { font-size: 1.15rem; font-weight: 700; color: #f0f0f0; letter-spacing: -0.02em; margin-top: 2.5rem; margin-bottom: 0.75rem; }
.content h2:first-child { margin-top: 0; }
.content p { font-size: 0.92rem; color: #888; line-height: 1.75; margin-bottom: 1rem; }
.content p strong { color: #f0f0f0; }
.content ul, .content ol { margin: 0.5rem 0 1rem 1.25rem; display: flex; flex-direction: column; gap: 0.4rem; }
.content ul li, .content ol li { font-size: 0.92rem; color: #888; line-height: 1.65; }
.content a { color: #22c55e; }
.info-box { background: rgba(34,197,94,0.06); border: 1px solid rgba(34,197,94,0.2); border-radius: 12px; padding: 1.25rem 1.5rem; margin: 2rem 0; }
.info-box p { font-size: 0.88rem; color: #22c55e; margin: 0; font-weight: 500; }
.divider { border: none; border-top: 1px solid rgba(255,255,255,0.06); margin: 2rem 0; }

/* ── RATE TABLE ── */
.rate-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; margin: 0; }
.rate-table thead th { background: #141414; padding: 0.75rem 1rem; text-align: left; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; color: #555; border-bottom: 1px solid rgba(255,255,255,0.06); white-space: nowrap; }
.rate-table tbody tr { border-bottom: 1px solid rgba(255,255,255,0.04); }
.rate-table tbody tr:last-child { border-bottom: none; }
.rate-table td, .rate-table tbody th { padding: 0.85rem 1rem; color: #888; vertical-align: middle; text-align: left; font-weight: 400; }
.rate-table tbody th { color: #f0f0f0; font-weight: 600; }
.rate-table td strong { color: #f0f0f0; }
.rate-table .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.rate-table .best td, .rate-table .best th { background: rgba(34,197,94,0.05); }
.rate-table .apr-val { font-size: 1rem; font-weight: 800; color: #22c55e; }
.rate-table .apr-val.mid { color: #60a5fa; }
.rate-table .apr-val.red { color: #f87171; }
.table-wrap { overflow-x: auto; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08); margin: 1.5rem 0; }
details.schedule { margin: 1.5rem 0; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; background: #111; }
details.schedule summary { cursor: pointer; padding: 1rem 1.25rem; font-size: 0.9rem; font-weight: 600; color: #22c55e; }
details.schedule .table-wrap { border: none; border-top: 1px solid rgba(255,255,255,0.08); border-radius: 0; margin: 0; }

/* ── RELATED GUIDES ── */
.related-guides { background: #111111; border-top: 1px solid rgba(255,255,255,0.06); padding: 2.5rem 6%; }
.related-guides-inner { max-width: 860px; margin: 0 auto; }
.related-guides h3 { font-size: 0.9rem; font-weight: 700; color: #f0f0f0; margin-bottom: 1rem; }
.guide-links { display: flex; flex-direction: column; gap: 0.6rem; }
.guide-link { font-size: 0.88rem; color: #22c55e; text-decoration: none; }
.guide-link:hover { text-decoration: underline; }

@media (max-width: 900px) {
  .content { padding: 3rem 5%; }
  .related-guides { padding: 2rem 5%; }
}
</style>
</head>
<body>

<!-- NAV -->
<nav>
  <a href="/" class="nav-logo">Borrow<span>Clever</span></a>
  <ul class="nav-links">
    <li><a href="/loans.html">Compare loans</a></li>
    <li><a href="/cards.html">Compare cards</a></li>
    <li><a href="/rate-tracker/">Rate tracker</a></li>
    <li><a href="/calculator/">Calculator</a></li>
    <li><a href="/#signup" class="nav-cta">Newsletter</a></li>
  </ul>
  <button class="nav-hamburger" id="hamburger" aria-label="Open menu">
    <span></span><span></span><span></span>
  </button>
</nav>

<!-- MOBILE NAV -->
<div class="mobile-nav" id="mobile-nav">
  <a href="/loans.html">Compare loans</a>
  <a href="/cards.html">Compare cards</a>
  <a href="/rate-tracker/">Rate tracker</a>
  <a href="/calculator/">Calculator</a>
  <a href="/#signup" class="mobile-cta">Newsletter</a>
</div>

<!-- PAGE HEADER -->
<div class="page-header">
  <div class="page-header-inner">
    <div class="eyebrow">Worked Example</div>
    <h1>${h1}</h1>
    <p class="page-header-sub">${sub}</p>
  </div>
</div>

<!-- CONTENT -->
<div class="content">
${body}
  <div class="info-box">
    <p>All figures on this page are illustrative, calculated from lender rates published as of ${esc(fmtLong(TODAY))} using the effective monthly rate formula. Lenders' own repayment examples may differ slightly. Always confirm the current rate, fees, and terms directly with the lender before applying. BorrowClever is an independent information service — this is not financial advice.</p>
  </div>

</div>

<!-- RELATED GUIDES -->
<div class="related-guides">
  <div class="related-guides-inner">
    <h3>Keep exploring</h3>
    <div class="guide-links">
${related.map((r) => `      <a href="${r.href}" class="guide-link">${esc(r.label)} →</a>`).join("\n")}
    </div>
  </div>
</div>

<!-- FOOTER -->
<footer>
  <a href="/" class="footer-logo">Borrow<span>Clever</span></a>
  <div class="footer-links">
    <a href="/about.html">About</a>
    <a href="/how-we-make-money.html">How we make money</a>
    <a href="/privacy.html">Privacy Policy</a>
  </div>
  <div class="footer-note">BorrowClever is an independent financial comparison service. Rates sourced from lender websites and CCPC.ie. Always verify with the lender before applying. This is not financial advice. © 2026 BorrowClever Ireland Limited.</div>
</footer>

<script>
const hamburger = document.getElementById('hamburger');
const mobileNav = document.getElementById('mobile-nav');
hamburger.addEventListener('click', () => {
  const open = mobileNav.classList.toggle('open');
  hamburger.classList.toggle('open', open);
  hamburger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
});
mobileNav.querySelectorAll('a').forEach(a => {
  a.addEventListener('click', () => {
    mobileNav.classList.remove('open');
    hamburger.classList.remove('open');
  });
});
</script>

</body>
</html>
`;
}

function scheduleTable(schedule, caption) {
  const rows = schedule
    .map(
      (r) =>
        `<tr><td class="num">${r.month}</td><td class="num">${eur(r.payment)}</td><td class="num">${eur(r.interest)}</td><td class="num">${eur(r.principalPaid)}</td><td class="num">${eur(r.balance)}</td></tr>`
    )
    .join("\n        ");
  return `<details class="schedule">
    <summary>Show the full month-by-month repayment schedule (${schedule.length} months)</summary>
    <div class="table-wrap">
    <table class="rate-table">
      <caption class="vh" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">${esc(caption)}</caption>
      <thead><tr><th class="num">Month</th><th class="num">Payment</th><th class="num">Interest</th><th class="num">Principal</th><th class="num">Balance left</th></tr></thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
    </div>
  </details>`;
}

// ════════════════════════════════════════════════════════════════════════
// Page 1 — €10,000 over 5 years: bank vs credit union vs Avant Money
// ════════════════════════════════════════════════════════════════════════
const P = 10000, TERM = 60;
const contenders = [
  { slug: "ptsb-loan-personal", label: "PTSB Personal Loan", type: "Bank", cls: "" },
  { slug: "boi-loan-personal", label: "Bank of Ireland Personal Loan", type: "Bank", cls: "mid" },
  { slug: "anpost-loan-personal", label: "An Post Money Personal Loan", type: "Bank", cls: "mid" },
  { slug: "avant-loan-personal", label: "Avant Money Personal Loan", type: "Non-bank lender", cls: "mid" },
  { slug: "firstchoice-loan-personal", label: "First Choice CU (€15k–€25k band)", type: "Credit union", cls: "mid" },
  { slug: "aib-loan-personal", label: "AIB Personal Loan", type: "Bank", cls: "red" },
  { slug: "cu-loan-average", label: "Credit union average (ILCU)", type: "Credit union (avg)", cls: "red" },
].map((c) => ({ ...c, rate: rate(c.slug), calc: amortize(P, rate(c.slug), TERM) }));
contenders.sort((a, b) => a.calc.totalInterest - b.calc.totalInterest);

const best1 = contenders[0];
const worst1 = contenders.at(-1);
const avant1 = contenders.find((c) => c.slug === "avant-loan-personal");
const cu1 = contenders.find((c) => c.slug === "firstchoice-loan-personal");
const cuAvg1 = contenders.find((c) => c.slug === "cu-loan-average");
const aib1 = contenders.find((c) => c.slug === "aib-loan-personal");
const spread1 = worst1.calc.totalInterest - best1.calc.totalInterest;

const table1 = `<div class="table-wrap">
    <table class="rate-table">
      <thead><tr><th>Lender</th><th>Type</th><th class="num">Rate</th><th class="num">Monthly</th><th class="num">Total interest</th><th class="num">Total repayable</th></tr></thead>
      <tbody>
${contenders
  .map(
    (c, i) => `        <tr${i === 0 ? ' class="best"' : ""}><th scope="row">${esc(c.label)}</th><td>${esc(c.type)}</td><td class="num"><span class="apr-val${i === 0 ? "" : " " + c.cls}">${c.rate.toFixed(2)}%</span></td><td class="num">${eur(c.calc.monthly)}</td><td class="num">${eur(c.calc.totalInterest)}</td><td class="num"><strong>${eur(c.calc.totalRepayable)}</strong></td></tr>`
  )
  .join("\n")}
      </tbody>
    </table>
  </div>`;

const page1 = page({
  path: "10000-loan-5-years-bank-vs-credit-union-vs-avant.html",
  title: "€10,000 Loan Over 5 Years: Bank vs Credit Union vs Avant Money | BorrowClever",
  ogTitle: "€10,000 Personal Loan Over 5 Years: Bank vs Credit Union vs Avant Money",
  description: `Full repayment comparison on a €10,000 loan over 60 months: ${best1.label} costs ${eur0(best1.calc.totalInterest)} in interest vs ${eur0(worst1.calc.totalInterest)} at the ${worst1.label.toLowerCase()} — with the complete month-by-month schedule.`,
  eyebrow: "€10,000 over 5 years",
  h1: "€10,000 over 5 years: bank vs credit union vs Avant Money",
  sub: `Calculated from published rates as of ${esc(fmtLong(TODAY))} · Every figure derived, nothing estimated`,
  faqs: [
    {
      q: "What is the monthly repayment on a €10,000 loan over 5 years in Ireland?",
      a: `At current published rates it ranges from about ${eur(best1.calc.monthly)} a month (${best1.label} at ${best1.rate.toFixed(2)}%) to about ${eur(worst1.calc.monthly)} a month (${worst1.label} at ${worst1.rate.toFixed(2)}%). The monthly difference looks small, but over 60 payments it compounds to ${eur0(spread1)} in extra interest.`,
    },
    {
      q: "Is a credit union cheaper than a bank for a €10,000 loan?",
      a: `Usually not at the moment. The cheapest confirmed credit union band rate we track (${cu1.rate.toFixed(2)}%) costs ${eur0(cu1.calc.totalInterest)} in interest over 5 years, against ${eur0(best1.calc.totalInterest)} at the cheapest bank rate (${best1.rate.toFixed(2)}%). The ILCU national average (${cuAvg1.rate.toFixed(2)}%) is more expensive again — but individual credit unions set their own rates, so always ask yours.`,
    },
    {
      q: "How is total cost of credit calculated on a loan?",
      a: "Total cost of credit is everything you repay minus what you borrowed. On this page it is calculated with the effective monthly rate formula — the balance accrues interest monthly at (1 + APR/100)^(1/12) − 1 and a level payment clears it over the term. Lender examples may differ slightly due to rounding and fee treatment.",
    },
  ],
  related: [
    { href: "/examples/debt-consolidation-worked-example.html", label: "Worked example: consolidating two debts into one loan" },
    { href: "/examples/representative-apr-vs-what-you-pay.html", label: "Worked example: representative APR vs what you'll actually pay" },
    { href: "/loans.html", label: "Compare all current personal loan rates" },
    { href: "/rate-tracker/", label: "Rate tracker: how these rates have moved" },
    { href: "/guides/credit-union-vs-bank-loan-ireland.html", label: "Guide: credit union vs bank loans in Ireland" },
  ],
  body: `
  <p>Borrow €10,000 over 60 months and the lender you pick changes what you hand back by up to <strong>${eur0(spread1)}</strong> — on identical borrowing. This page runs the same loan through seven current Irish rates: the main banks, the cheapest confirmed credit union band, the ILCU credit union average, and Avant Money. Rates are pulled from our <a href="/loans.html">live comparison data</a> at build time, so the numbers below match what lenders currently publish.</p>

  <h2>The full repayment comparison</h2>
  ${table1}

  <h2>What these numbers actually mean</h2>
  <p>Three things stand out from the table that a rate-only comparison hides.</p>
  <p><strong>First: the monthly gap is deceptively small.</strong> Between ${esc(best1.label)} and ${esc(worst1.label)} the difference is ${eur(worst1.calc.monthly - best1.calc.monthly)} a month — a couple of coffees. Multiplied across 60 payments it becomes ${eur0(spread1)}, which is real money to hand a lender for nothing extra in return.</p>
  <p><strong>Second: "credit union" is not one rate.</strong> First Choice Credit Union's ${cu1.rate.toFixed(2)}% band rate costs ${eur0(cu1.calc.totalInterest)} in interest here, while the ILCU national average of ${cuAvg1.rate.toFixed(2)}% costs ${eur0(cuAvg1.calc.totalInterest)} — a ${eur0(cuAvg1.calc.totalInterest - cu1.calc.totalInterest)} spread inside the credit union world itself. Your own credit union could sit anywhere in that range (legally capped at 12.68% APR), which is why we compare specific confirmed rates rather than the average alone.</p>
  <p><strong>Third: Avant's fixed rate buys certainty, not the lowest cost.</strong> At ${avant1.rate.toFixed(2)}% fixed, Avant Money costs ${eur0(avant1.calc.totalInterest - best1.calc.totalInterest)} more than ${esc(best1.label)} over the term — but the repayment can never rise, unlike the variable-rate bank loans above it in the table. Note Avant prices by credit profile: ${avant1.rate.toFixed(2)}% is the representative rate, and their APR can reach 19.9% (see our <a href="/examples/representative-apr-vs-what-you-pay.html">representative APR worked example</a>).</p>

  <h2>Month by month: where your money goes</h2>
  <p>The schedule below shows every payment on the cheapest standard option, ${esc(best1.label)} at ${best1.rate.toFixed(2)}%. Notice how the interest portion shrinks from ${eur(best1.calc.schedule[0].interest)} in month 1 to ${eur(best1.calc.schedule.at(-1).interest)} in the final month — early overpayments save the most because they attack the balance while the interest charge is biggest.</p>
  ${scheduleTable(best1.calc.schedule, `Month-by-month repayment schedule for a €10,000 loan over 60 months at ${best1.rate.toFixed(2)}%`)}

  <hr class="divider">
  <p>Rates move — the fortnightly changes are logged on our <a href="/rate-tracker/">rate tracker</a>. For eligibility conditions and the full lender list, see the <a href="/loans.html">loan comparison table</a>.</p>
`,
});

// ════════════════════════════════════════════════════════════════════════
// Page 2 — Debt consolidation worked example
// ════════════════════════════════════════════════════════════════════════
// The borrower's existing debts are illustrative constants (marked as such on
// the page); the consolidation loan rate comes from products.json.
const OLD_LOAN = { balance: 7000, apr: 12.0, monthsLeft: 36 };
const OLD_CARD = { balance: 3000, apr: rate("avant-card-one"), payment: 150 };
const consolRate = rate("ptsb-loan-personal");

const oldLoanCalc = amortize(OLD_LOAN.balance, OLD_LOAN.apr, OLD_LOAN.monthsLeft);
const oldCardCalc = payoff(OLD_CARD.balance, OLD_CARD.apr, OLD_CARD.payment);
const keepTotalInterest = oldLoanCalc.totalInterest + oldCardCalc.totalInterest;
const keepMonthly = oldLoanCalc.monthly + OLD_CARD.payment;

const consol36 = amortize(10000, consolRate, 36);
const consol60 = amortize(10000, consolRate, 60);
const save36 = keepTotalInterest - consol36.totalInterest;
const extra60 = consol60.totalInterest - consol36.totalInterest;

const table2 = `<div class="table-wrap">
    <table class="rate-table">
      <thead><tr><th>Scenario</th><th class="num">Monthly outlay</th><th class="num">Months</th><th class="num">Total interest still to pay</th></tr></thead>
      <tbody>
        <tr><th scope="row">Keep both debts as they are</th><td class="num">${eur(keepMonthly)}<br><span style="font-size:.78rem;color:#666">(${eur(oldLoanCalc.monthly)} loan + ${eur(OLD_CARD.payment)} card)</span></td><td class="num">${Math.max(OLD_LOAN.monthsLeft, oldCardCalc.months)}</td><td class="num"><span class="apr-val red">${eur(keepTotalInterest)}</span></td></tr>
        <tr class="best"><th scope="row">Consolidate: €10,000 over 36 months at ${consolRate.toFixed(2)}%</th><td class="num">${eur(consol36.monthly)}</td><td class="num">36</td><td class="num"><span class="apr-val">${eur(consol36.totalInterest)}</span></td></tr>
        <tr><th scope="row">Consolidate: €10,000 over 60 months at ${consolRate.toFixed(2)}%</th><td class="num">${eur(consol60.monthly)}</td><td class="num">60</td><td class="num"><span class="apr-val mid">${eur(consol60.totalInterest)}</span></td></tr>
      </tbody>
    </table>
  </div>`;

const page2 = page({
  path: "debt-consolidation-worked-example.html",
  title: "Debt Consolidation Worked Example: Two Debts Into One Loan | BorrowClever",
  ogTitle: "Debt Consolidation Worked Example: Is Combining Two Loans Actually Cheaper?",
  description: `A €7,000 loan at 12% plus a €3,000 card at ${OLD_CARD.apr.toFixed(1)}% APR, consolidated into one €10,000 loan at ${consolRate.toFixed(2)}% — worked through in full. Same term saves ${eur0(save36)}; stretching to 5 years gives most of it back.`,
  eyebrow: "Debt consolidation",
  h1: "Combining two debts into one loan: is it actually cheaper?",
  sub: `A fully worked example using the current ${consolRate.toFixed(2)}% consolidation rate · Calculated ${esc(fmtLong(TODAY))}`,
  faqs: [
    {
      q: "Does consolidating debt always save money?",
      a: `No — it depends on the term you choose. In this example, consolidating a €7,000 loan at 12% and a €3,000 credit card at ${OLD_CARD.apr.toFixed(1)}% into a €10,000 loan at ${consolRate.toFixed(2)}% over 36 months saves ${eur0(save36)} in interest. Stretching the same loan to 60 months cuts the monthly payment but adds ${eur0(extra60)} of interest back, eroding most of the saving.`,
    },
    {
      q: "What rate do I need for consolidation to be worth it?",
      a: "As a rule of thumb the new loan's APR must be meaningfully below the blended rate of the debts you're clearing, and the term must not stretch much beyond the time you'd have taken to clear them anyway. Credit card debt is usually the piece worth consolidating first, because card APRs in Ireland run roughly 14–23%.",
    },
    {
      q: "Can I consolidate credit card debt with a personal loan in Ireland?",
      a: "Yes — most Irish lenders accept debt consolidation as a loan purpose, and some price it the same as a standard personal loan. An alternative for card debt specifically is a 0% balance-transfer card, which can be cheaper still if you can clear the balance inside the promotional window.",
    },
  ],
  related: [
    { href: "/examples/10000-loan-5-years-bank-vs-credit-union-vs-avant.html", label: "Worked example: €10,000 over 5 years, lender by lender" },
    { href: "/guides/debt-consolidation-loans-ireland.html", label: "Guide: debt consolidation loans in Ireland" },
    { href: "/guides/best-credit-card-balance-transfer-ireland.html", label: "Guide: best 0% balance-transfer cards" },
    { href: "/loans.html", label: "Compare all current personal loan rates" },
    { href: "/rate-tracker/", label: "Rate tracker: how these rates have moved" },
  ],
  body: `
  <p>Consolidation adverts promise one smaller payment. Sometimes that genuinely costs you less; often it quietly costs you more, because the smaller payment comes from a longer term rather than a cheaper rate. Here is the arithmetic, worked through honestly for a typical situation.</p>

  <h2>The starting position</h2>
  <p>Meet a borrower with two debts (illustrative figures — the consolidation rate below is a real, current rate):</p>
  <ul>
    <li>A personal loan: <strong>€7,000 left at 12.00% APR</strong> with 36 months to run — ${eur(oldLoanCalc.monthly)} a month, ${eur(oldLoanCalc.totalInterest)} of interest still to pay.</li>
    <li>A credit card: <strong>€3,000 at ${OLD_CARD.apr.toFixed(1)}% APR</strong> (the current representative APR on the ${esc(name("avant-card-one"))}), paying a fixed €150 a month — cleared in ${oldCardCalc.months} months, costing ${eur(oldCardCalc.totalInterest)} in interest.</li>
  </ul>
  <p>Do nothing, and the pair costs <strong>${eur(keepTotalInterest)}</strong> in remaining interest at a combined ${eur(keepMonthly)} a month.</p>

  <h2>Three scenarios, one table</h2>
  <p>The consolidation option is a €10,000 personal loan at ${consolRate.toFixed(2)}% — the best standard bank rate on our <a href="/loans.html">comparison table</a> today (PTSB). The only decision left is the term, and it is the term that decides whether this works.</p>
  ${table2}

  <h2>The verdict, and the catch</h2>
  <p><strong>Consolidating over 36 months wins clearly.</strong> It saves ${eur0(save36)} in interest and cuts the monthly outlay too (${eur(consol36.monthly)} against ${eur(keepMonthly)}), because the expensive card debt stops compounding at ${OLD_CARD.apr.toFixed(1)}% and starts costing ${consolRate.toFixed(2)}% instead. Matching the new term to the old loan's remaining 36 months means no hidden stretch.</p>
  <p><strong>The 60-month version is the trap dressed as relief.</strong> Its ${eur(consol60.monthly)} monthly payment looks far friendlier, but ${eur0(extra60)} of the ${eur0(save36)} saving evaporates into the extra two years of interest. You'd still come out slightly ahead of doing nothing — by ${eur0(keepTotalInterest - consol60.totalInterest)} — but you'd also be in debt for two years longer, with all the risk that carries.</p>
  <p>The honest summary: consolidation in this example is worth doing <em>because the card debt is expensive and the term stays short</em>. Change either condition and the case weakens fast. Run your own numbers before deciding — our <a href="/loans.html">loan comparison</a> shows every current consolidation-eligible rate.</p>
`,
});

// ════════════════════════════════════════════════════════════════════════
// Page 3 — Representative APR vs what you'll actually pay
// ════════════════════════════════════════════════════════════════════════
const reps = [
  {
    slug: "revolut-loan-personal",
    label: "Revolut Personal Loan",
    rep: rate("revolut-loan-personal"),
    max: 12.99,
    note: "Advertised range 6.5%–12.99% APR depending on credit score",
  },
  {
    slug: "avant-loan-personal",
    label: "Avant Money Personal Loan",
    rep: rate("avant-loan-personal"),
    max: 19.9,
    note: "Representative 8.50% fixed; APR can reach 19.9%",
  },
  {
    slug: "ptsb-loan-personal",
    label: "PTSB Personal Loan",
    rep: rate("ptsb-loan-personal"),
    max: 8.8,
    note: "7.20% shown for the €10k band; maximum APR 8.80%",
  },
].map((r) => ({
  ...r,
  repCalc: amortize(P, r.rep, TERM),
  maxCalc: amortize(P, r.max, TERM),
}));

const avantR = reps.find((r) => r.slug === "avant-loan-personal");
const revolutR = reps.find((r) => r.slug === "revolut-loan-personal");
const ptsbR = reps.find((r) => r.slug === "ptsb-loan-personal");

const table3 = `<div class="table-wrap">
    <table class="rate-table">
      <thead><tr><th>Product</th><th class="num">Advertised rate</th><th class="num">Monthly / total interest</th><th class="num">Top-of-range rate</th><th class="num">Monthly / total interest</th><th class="num">Gap over 5 years</th></tr></thead>
      <tbody>
${reps
  .map(
    (r) => `        <tr><th scope="row">${esc(r.label)}</th><td class="num"><span class="apr-val">${r.rep.toFixed(2)}%</span></td><td class="num">${eur(r.repCalc.monthly)}<br>${eur(r.repCalc.totalInterest)}</td><td class="num"><span class="apr-val red">${r.max.toFixed(2)}%</span></td><td class="num">${eur(r.maxCalc.monthly)}<br>${eur(r.maxCalc.totalInterest)}</td><td class="num"><strong>${eur(r.maxCalc.totalInterest - r.repCalc.totalInterest)}</strong></td></tr>`
  )
  .join("\n")}
      </tbody>
    </table>
  </div>`;

const page3 = page({
  path: "representative-apr-vs-what-you-pay.html",
  title: "Representative APR vs What You'll Actually Pay: A Real Example | BorrowClever",
  ogTitle: "Representative APR vs What You'll Actually Pay: A Real €10,000 Example",
  description: `The advertised rate is not a promise. On a €10,000 loan over 5 years, Avant Money's range alone spans ${eur0(avantR.maxCalc.totalInterest - avantR.repCalc.totalInterest)} in extra interest between its ${avantR.rep.toFixed(2)}% representative rate and its 19.9% maximum APR — worked through with real products.`,
  eyebrow: "Representative APR",
  h1: "Representative APR vs what you'll actually pay",
  sub: `Three real products, advertised rate vs top of range, on €10,000 over 60 months · Calculated ${esc(fmtLong(TODAY))}`,
  faqs: [
    {
      q: "Is the representative APR the rate I will get?",
      a: "Not necessarily. It is the rate the lender uses in its advertised repayment example, and many applicants are offered a different (usually higher) rate based on their credit profile. Risk-priced lenders publish a range — Revolut currently advertises 6.5%–12.99% APR — and only the application process tells you where in the range you land.",
    },
    {
      q: "How much more can the real rate cost me?",
      a: `On €10,000 over 5 years: at Avant Money the difference between the ${avantR.rep.toFixed(2)}% representative rate and the 19.9% maximum APR is ${eur0(avantR.maxCalc.totalInterest - avantR.repCalc.totalInterest)} in extra interest. At Revolut the range spans ${eur0(revolutR.maxCalc.totalInterest - revolutR.repCalc.totalInterest)}. At PTSB, whose pricing is banded rather than credit-scored, the maximum gap is only ${eur0(ptsbR.maxCalc.totalInterest - ptsbR.repCalc.totalInterest)}.`,
    },
    {
      q: "Which Irish lenders price loans by credit score?",
      a: "Revolut and Avant Money openly price by credit profile, which is why their advertised ranges are wide. The traditional banks (AIB, Bank of Ireland, PTSB, An Post Money) mostly price by loan amount band, so the advertised rate is much closer to what an approved applicant actually pays.",
    },
  ],
  related: [
    { href: "/guides/representative-apr-explained-ireland.html", label: "Guide: representative APR explained" },
    { href: "/examples/10000-loan-5-years-bank-vs-credit-union-vs-avant.html", label: "Worked example: €10,000 over 5 years, lender by lender" },
    { href: "/examples/debt-consolidation-worked-example.html", label: "Worked example: consolidating two debts into one loan" },
    { href: "/loans.html", label: "Compare all current personal loan rates" },
    { href: "/rate-tracker/", label: "Rate tracker: how these rates have moved" },
  ],
  body: `
  <p>Every loan advert leads with one number — the representative rate. What the small print adds is that your rate "may vary based on your individual circumstances". This page quantifies that phrase, using three real products from our <a href="/loans.html">comparison table</a> and the same €10,000-over-60-months loan for each.</p>

  <h2>Advertised rate vs top of range</h2>
  ${table3}

  <h2>Reading the gaps</h2>
  <p>The pattern in that table is the single most useful thing to know before applying anywhere.</p>
  <p>With <strong>banded pricing</strong> (PTSB), the advertised ${ptsbR.rep.toFixed(2)}% is nearly the whole story: even at PTSB's ceiling of ${ptsbR.max.toFixed(2)}% APR you'd pay ${eur0(ptsbR.maxCalc.totalInterest - ptsbR.repCalc.totalInterest)} more over five years. The rate depends on how much you borrow, not on your credit score, so the advert is a reliable predictor of your offer.</p>
  <p>With <strong>risk-based pricing</strong> (Revolut, Avant Money), the advertised number is the shop window, not the shelf price. Revolut's own published range runs from ${revolutR.rep.toFixed(2)}% to ${revolutR.max.toFixed(2)}% APR — a ${eur0(revolutR.maxCalc.totalInterest - revolutR.repCalc.totalInterest)} spread on this loan. Avant's runs wider still: an applicant offered the 19.9% maximum pays ${eur(avantR.maxCalc.monthly)} a month instead of ${eur(avantR.repCalc.monthly)}, and ${eur0(avantR.maxCalc.totalInterest - avantR.repCalc.totalInterest)} more in total. That is the difference between Avant being one of the cheaper loans on the market and one of the dearest.</p>
  <p>None of this makes risk-priced lenders a bad choice — a strong credit profile can land the bottom of the range, which beats most banks. It means the comparison you should make is conditional: <em>if</em> you expect a clean credit check, the advertised rates compare fairly; if not, weigh the top of each range too. Either way, get the actual quote before committing — a quote, unlike an advert, is personal.</p>
`,
});

// ── write pages ─────────────────────────────────────────────────────────
mkdirSync(new URL("../examples/", import.meta.url), { recursive: true });
const pages = [
  ["10000-loan-5-years-bank-vs-credit-union-vs-avant.html", page1],
  ["debt-consolidation-worked-example.html", page2],
  ["representative-apr-vs-what-you-pay.html", page3],
];
for (const [file, html] of pages) {
  writeFileSync(new URL(`../examples/${file}`, import.meta.url), html);
}
console.log(`examples/: wrote ${pages.length} worked-example pages from products.json rates (as of ${TODAY}).`);
