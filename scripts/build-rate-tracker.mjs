// scripts/build-rate-tracker.mjs
// Generates the public /rate-tracker/ page from rates/rate-history.json.
//
// Everything on the page is derived from data at build time — the summary
// sentences, the SVG charts, and the per-snapshot tables. Nothing is hardcoded,
// so the page stays current as the fortnightly workflow appends snapshots.
// Charts are hand-rolled SVG (no CDN dependency, crawlable, fast); each chart
// is paired with a plain table of the same data for accessibility and search.
//
// Run:  node scripts/build-rate-tracker.mjs   (part of npm run build; the
// fortnightly workflow runs it after append-rate-history.mjs)

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const BASE = "https://borrowclever.ie";
const history = JSON.parse(readFileSync(new URL("../rates/rate-history.json", import.meta.url), "utf8"));
const products = JSON.parse(readFileSync(new URL("../products.json", import.meta.url), "utf8"));

const snapshots = [...history.snapshots].sort((a, b) => a.date.localeCompare(b.date));
if (snapshots.length === 0) throw new Error("rate-history.json has no snapshots");
const firstDate = snapshots[0].date;
const lastDate = snapshots.at(-1).date;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtRate = (v) => `${v.toFixed(2)}%`;
// "2026-06-28" -> "28 Jun" (axis) / "28 June 2026" (prose)
const fmtShort = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IE", { day: "numeric", month: "short", timeZone: "UTC" });
};
const fmtLong = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
};

// ── group products into chart categories ────────────────────────────────
const bySlug = new Map(products.map((p) => [p.slug, p]));
const label = (p) => {
  let s = p.name || "";
  if (p.lenderName && s.startsWith(p.lenderName)) s = s.slice(p.lenderName.length).trim();
  return `${p.lenderName} · ${s || p.product}`;
};

const isCU = (p) => p.lender === "cu" || p.lender === "firstchoice";
const isGreen = (p) => /sbci|green/.test(p.product || "");
const loans = products.filter((p) => p.category === "loan");
const cards = products.filter((p) => p.category === "card");

const GROUPS = [
  {
    id: "standard-loans",
    heading: "Standard personal loans",
    intro: "Bank and fintech personal loans with no green or membership conditions — the products most borrowers compare first.",
    slugs: loans.filter((p) => !isCU(p) && !isGreen(p)).map((p) => p.slug),
  },
  {
    id: "green-loans",
    heading: "Green & SBCI energy loans",
    intro: "SEAI-conditional SBCI energy upgrade loans and green personal loans. Cheaper than any standard product, but only for qualifying energy works.",
    slugs: loans.filter((p) => isGreen(p)).map((p) => p.slug),
  },
  {
    id: "credit-union-loans",
    heading: "Credit union rates",
    intro: "The cheapest confirmed credit union band rate we track, alongside the ILCU national average for affiliated credit unions.",
    slugs: loans.filter((p) => isCU(p)).map((p) => p.slug),
  },
];

// ── series extraction ───────────────────────────────────────────────────
const PALETTE = ["#22c55e", "#60a5fa", "#f87171", "#fbbf24", "#a78bfa", "#34d399", "#f472b6", "#38bdf8", "#fb923c", "#e879f9"];

function seriesFor(slugs) {
  return slugs
    .map((slug, i) => {
      const p = bySlug.get(slug);
      const points = snapshots
        .filter((s) => s.rates[slug] !== undefined)
        .map((s) => ({ date: s.date, value: s.rates[slug] }));
      return p && points.length ? { slug, label: label(p), color: PALETTE[i % PALETTE.length], points } : null;
    })
    .filter(Boolean);
}

// ── SVG line chart ──────────────────────────────────────────────────────
function chartSvg(series, headingId) {
  const W = 720, H = 320, L = 52, R = 16, T = 16, B = 34;
  const dates = snapshots.map((s) => s.date);
  const t0 = Date.parse(dates[0]);
  const t1 = Date.parse(dates.at(-1));
  const x = (date) => (t1 === t0 ? L + (W - L - R) / 2 : L + ((Date.parse(date) - t0) / (t1 - t0)) * (W - L - R));

  const values = series.flatMap((s) => s.points.map((pt) => pt.value));
  let lo = Math.min(...values), hi = Math.max(...values);
  const pad = Math.max((hi - lo) * 0.15, 0.25);
  lo = Math.max(0, lo - pad);
  hi = hi + pad;
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);

  // ~5 horizontal gridlines at tidy intervals
  const step = niceStep((hi - lo) / 5);
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(Number(v.toFixed(2)));

  const grid = ticks
    .map((v) =>
      `<line x1="${L}" y1="${y(v).toFixed(1)}" x2="${W - R}" y2="${y(v).toFixed(1)}" stroke="rgba(255,255,255,0.07)"/>` +
      `<text x="${L - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" class="tick">${v}%</text>`
    )
    .join("\n    ");

  const xLabels = dates
    .map((d) => `<text x="${x(d).toFixed(1)}" y="${H - 10}" text-anchor="middle" class="tick">${fmtShort(d)}</text>`)
    .join("\n    ");

  const lines = series
    .map((s) => {
      const pts = s.points.map((pt) => `${x(pt.date).toFixed(1)},${y(pt.value).toFixed(1)}`).join(" ");
      const dots = s.points
        .map(
          (pt) =>
            `<circle cx="${x(pt.date).toFixed(1)}" cy="${y(pt.value).toFixed(1)}" r="3.5" fill="${s.color}"><title>${esc(s.label)} — ${fmtRate(pt.value)} (${fmtLong(pt.date)})</title></circle>`
        )
        .join("");
      return `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${dots}`;
    })
    .join("\n    ");

  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-labelledby="${headingId}" preserveAspectRatio="xMidYMid meet">
    ${grid}
    ${xLabels}
    ${lines}
  </svg>`;
}

function niceStep(raw) {
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * mag) return m * mag;
  return 10 * mag;
}

function legend(series) {
  return `<ul class="legend">${series
    .map((s) => `<li><span class="swatch" style="background:${s.color}"></span>${esc(s.label)}</li>`)
    .join("")}</ul>`;
}

// One accessible/crawlable table per group: products × snapshot dates.
function historyTable(series, caption) {
  const head = snapshots.map((s) => `<th scope="col">${fmtShort(s.date)} ${s.date.slice(0, 4)}</th>`).join("");
  const rows = series
    .map((s) => {
      const byDate = new Map(s.points.map((pt) => [pt.date, pt.value]));
      const cells = snapshots
        .map((snap) => {
          const v = byDate.get(snap.date);
          return `<td>${v === undefined ? "—" : fmtRate(v)}</td>`;
        })
        .join("");
      return `<tr><th scope="row">${esc(s.label)}</th>${cells}</tr>`;
    })
    .join("\n        ");
  return `<div class="table-wrap">
    <table class="rate-table">
      <caption class="vh">${esc(caption)}</caption>
      <thead><tr><th scope="col">Lender / product</th>${head}</tr></thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </div>`;
}

// ── auto-generated plain-language summary ───────────────────────────────
function movementSummary(series) {
  const movers = [];
  let tracked = 0;
  for (const s of series) {
    tracked++;
    const first = s.points[0], last = s.points.at(-1);
    if (first.value !== last.value) {
      movers.push({
        label: s.label,
        from: first.value,
        to: last.value,
        since: first.date,
        dir: last.value < first.value ? "fallen" : "risen",
      });
    }
  }
  return { movers, tracked };
}

const loanSeries = seriesFor(loans.map((p) => p.slug));
const { movers, tracked } = movementSummary(loanSeries);
movers.sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from));

let summary;
if (movers.length === 0) {
  summary = `We have been tracking published loan rates since ${fmtLong(firstDate)}. As of ${fmtLong(lastDate)}, none of the ${tracked} loan rates we track has moved.`;
} else {
  const parts = movers
    .slice(0, 5)
    .map((m) => `${m.label} has ${m.dir} from ${fmtRate(m.from)} to ${fmtRate(m.to)}`);
  summary =
    `Since ${fmtLong(firstDate)}, ${movers.length} of the ${tracked} loan rates we track ${movers.length === 1 ? "has" : "have"} moved. ` +
    parts.join("; ") +
    `.${movers.length > 5 ? ` A further ${movers.length - 5} smaller move${movers.length - 5 === 1 ? "" : "s"} appear in the tables below.` : ""} Rates last verified ${fmtLong(lastDate)}.`;
}

// Card APRs get a history table (no chart — card APRs move rarely).
const cardSeries = seriesFor(cards.map((p) => p.slug));
const cardMoves = movementSummary(cardSeries).movers;
const cardSummary = cardMoves.length
  ? `Credit card APRs move less often, but they do move: ${cardMoves
      .map((m) => `${m.label} has ${m.dir} from ${fmtRate(m.from)} to ${fmtRate(m.to)}`)
      .join("; ")}.`
  : `Credit card representative APRs have been stable since ${fmtLong(firstDate)}.`;

// ── page sections ───────────────────────────────────────────────────────
const groupSections = GROUPS.map((g) => {
  const series = seriesFor(g.slugs);
  if (!series.length) return "";
  const headingId = `chart-${g.id}`;
  return `
  <h2 id="${headingId}">${esc(g.heading)}</h2>
  <p>${esc(g.intro)}</p>
  ${chartSvg(series, headingId)}
  ${legend(series)}
  ${historyTable(series, `${g.heading} — published rate at each verification date`)}
`;
}).join("\n  <hr class=\"divider\">\n");

const description =
  "How Irish personal loan and credit union rates have moved over time — a fortnightly-updated tracker of published APRs from every major lender, with full rate history tables. No other Irish comparison site publishes this.";

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
    "@type": "WebPage",
    url: `${BASE}/rate-tracker/`,
    name: "Irish Loan Rate Tracker | BorrowClever",
    description,
    dateModified: lastDate,
    inLanguage: "en-IE",
    isPartOf: { "@type": "WebSite", url: BASE, name: "BorrowClever" },
  },
  {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${BASE}/` },
      { "@type": "ListItem", position: 2, name: "Rate Tracker", item: `${BASE}/rate-tracker/` },
    ],
  },
  {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: "Irish Personal Loan & Credit Card Rate History",
    description:
      "Fortnightly snapshots of published personal loan rates and credit card representative APRs from all major Irish lenders, recorded since June 2026.",
    url: `${BASE}/rate-tracker/`,
    temporalCoverage: `${firstDate}/${lastDate}`,
    dateModified: lastDate,
    creator: { "@type": "Organization", name: "BorrowClever", url: BASE },
    spatialCoverage: { "@type": "Place", name: "Ireland" },
    inLanguage: "en-IE",
  },
];

// ── full page ───────────────────────────────────────────────────────────
const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Irish Loan Rate Tracker — How Rates Have Moved | BorrowClever</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${BASE}/rate-tracker/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="BorrowClever">
<meta property="og:url" content="${BASE}/rate-tracker/">
<meta property="og:title" content="Irish Loan Rate Tracker — How Rates Have Moved">
<meta property="og:description" content="${esc(description)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="Irish Loan Rate Tracker — How Rates Have Moved">
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
.page-header { padding: 4rem 6%; background: #0c0c0c; }
.page-header-inner { max-width: 860px; }
.page-header h1 { font-size: clamp(1.8rem, 3vw, 2.6rem); margin-bottom: 0.75rem; }
.page-header-sub { font-size: 0.95rem; color: rgba(255,255,255,0.6); line-height: 1.65; margin-bottom: 0; }
.eyebrow { display: inline-block; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #4ade80; margin-bottom: 1rem; }

/* ── CONTENT ── */
.content { max-width: 860px; margin: 0 auto; padding: 4rem 6%; }
.content h2 { font-size: 1.15rem; font-weight: 700; color: #f0f0f0; letter-spacing: -0.02em; margin-top: 2.5rem; margin-bottom: 0.75rem; }
.content h2:first-of-type { margin-top: 0; }
.content p { font-size: 0.92rem; color: #888; line-height: 1.75; margin-bottom: 1rem; }
.content p strong { color: #f0f0f0; }
.content a { color: #22c55e; }
.info-box { background: rgba(34,197,94,0.06); border: 1px solid rgba(34,197,94,0.2); border-radius: 12px; padding: 1.25rem 1.5rem; margin: 2rem 0; }
.info-box p { font-size: 0.88rem; color: #f0f0f0; margin: 0; font-weight: 500; }
.divider { border: none; border-top: 1px solid rgba(255,255,255,0.06); margin: 2rem 0; }
.summary-box { background: #141414; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 1.25rem 1.5rem; margin: 0 0 2rem; }
.summary-box p { margin: 0; color: #ccc; font-size: 0.95rem; line-height: 1.7; }

/* ── CHART ── */
.chart { width: 100%; height: auto; background: #141414; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; margin: 1rem 0 0.75rem; }
.chart .tick { font: 11px 'Plus Jakarta Sans', sans-serif; fill: #666; }
.legend { list-style: none; display: flex; flex-wrap: wrap; gap: 0.4rem 1.25rem; margin: 0 0 1rem; padding: 0; }
.legend li { font-size: 0.78rem; color: #999; display: flex; align-items: center; gap: 0.45rem; }
.swatch { display: inline-block; width: 10px; height: 10px; border-radius: 3px; flex: none; }

/* ── RATE TABLE ── */
.rate-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; margin: 0; }
.rate-table thead th { background: #141414; padding: 0.75rem 1rem; text-align: left; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; color: #555; border-bottom: 1px solid rgba(255,255,255,0.06); white-space: nowrap; }
.rate-table tbody tr { border-bottom: 1px solid rgba(255,255,255,0.04); }
.rate-table tbody tr:last-child { border-bottom: none; }
.rate-table td, .rate-table tbody th { padding: 0.85rem 1rem; color: #888; vertical-align: middle; text-align: left; font-weight: 400; }
.rate-table tbody th { color: #f0f0f0; font-weight: 600; white-space: nowrap; }
.rate-table td { font-variant-numeric: tabular-nums; white-space: nowrap; }
.table-wrap { overflow-x: auto; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08); margin: 0 0 1.5rem; }
.vh { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }

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
    <li><a href="/rate-tracker/" class="active">Rate tracker</a></li>
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
  <a href="/rate-tracker/" class="active">Rate tracker</a>
  <a href="/calculator/">Calculator</a>
  <a href="/#signup" class="mobile-cta">Newsletter</a>
</div>

<!-- PAGE HEADER -->
<div class="page-header">
  <div class="page-header-inner">
    <div class="eyebrow">Rate Tracker</div>
    <h1>How Irish loan rates have moved</h1>
    <p class="page-header-sub">Published rates from every lender we compare, recorded at each fortnightly verification since ${esc(fmtLong(firstDate))} · Last updated ${esc(fmtLong(lastDate))}</p>
  </div>
</div>

<!-- CONTENT -->
<div class="content">

  <div class="summary-box">
    <p>${esc(summary)}</p>
  </div>

  <p>Every fortnight we verify the rate each lender actually publishes and record it here. Most comparison sites show you today's rate; this page shows you the direction of travel — whether a lender has been cutting, holding, or quietly raising its rates. Current rates and full product details are on the <a href="/loans.html">loan comparison</a> and <a href="/cards.html">credit card comparison</a> pages.</p>

  <hr class="divider">
${groupSections}
  <hr class="divider">

  <h2>Credit card representative APRs</h2>
  <p>${esc(cardSummary)}</p>
  ${historyTable(cardSeries, "Credit card representative APRs — published APR at each verification date")}

  <hr class="divider">

  <h2>How this data is collected</h2>
  <p>A scheduled job checks each lender's published rate page (cross-checked against CCPC.ie) on the 1st and 15th of every month. Any discrepancy is reviewed by a person before the published figure changes — nothing on this site is updated by a bot unsupervised. The history above records the verified, published rate on each check date. Loans show the nominal advertised rate; credit cards show the representative APR.</p>

  <div class="info-box">
    <p>BorrowClever is an independent information service. This is not financial advice. Historical rates are shown for context only — always confirm the current rate, fees, and terms directly with the lender before applying.</p>
  </div>

</div>

<!-- RELATED GUIDES -->
<div class="related-guides">
  <div class="related-guides-inner">
    <h3>Keep exploring</h3>
    <div class="guide-links">
      <a href="/loans.html" class="guide-link">Compare all current personal loan rates →</a>
      <a href="/cards.html" class="guide-link">Compare all current credit card APRs →</a>
      <a href="/examples/10000-loan-5-years-bank-vs-credit-union-vs-avant.html" class="guide-link">Worked example: €10,000 over 5 years, lender by lender →</a>
      <a href="/guides/credit-union-vs-bank-loan-ireland.html" class="guide-link">Credit Union vs Bank Loan in Ireland: Which Is Cheaper? →</a>
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

mkdirSync(new URL("../rate-tracker/", import.meta.url), { recursive: true });
writeFileSync(new URL("../rate-tracker/index.html", import.meta.url), html);
console.log(
  `rate-tracker/index.html: ${snapshots.length} snapshots (${firstDate} → ${lastDate}), ${loanSeries.length} loan series, ${cardSeries.length} card series, ${movers.length} loan rate move(s).`
);
