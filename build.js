#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');

// ── helpers ───────────────────────────────────────────────────────────────────

function calcInterest(apr, principal = 10_000, months = 60) {
  const i      = Math.pow(1 + apr / 100, 1 / 12) - 1;
  const pow    = Math.pow(1 + i, months);
  const monthly = principal * i * pow / (pow - 1);
  return Math.round(monthly * months - principal);
}

// Inject content between <!-- TAG_START --> and <!-- TAG_END --> (all occurrences)
function inject(html, tag, content) {
  const re = new RegExp(`<!-- ${tag}_START -->[\\s\\S]*?<!-- ${tag}_END -->`, 'g');
  const before = html;
  html = html.replace(re, `<!-- ${tag}_START -->${content}<!-- ${tag}_END -->`);
  if (html === before) console.warn(`[build] WARNING: marker ${tag} not found`);
  return html;
}

function fmtNum(n) {
  return n.toLocaleString('en-IE');
}

// "2026-06-25" → "25 June 2026"
function fmtDateLong(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IE', { day: 'numeric', month: 'long', year: 'numeric' });
}

function today() {
  return new Date().toISOString().split('T')[0];
}

// ── load data ──────────────────────────────────────────────────────────────────
const loansData = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/loans.json'), 'utf8'));
const cardsData = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/cards.json'), 'utf8'));
const loans = loansData.loans;
const loansMeta = loansData.meta;
const cardsMeta = cardsData.meta;

// ── FAQ content (mirrors on-page footnote text exactly) ───────────────────────
const LOANS_FAQ = [
  {
    q: 'What are green loan rates and how do I qualify?',
    a: 'SBCI green loan rates are exclusively available to homeowners with an approved SEAI home energy grant. At least 75% of the loan must be used for SEAI-qualifying energy upgrade works. Apply through Bank of Ireland, AIB or PTSB after your SEAI grant is confirmed.',
  },
  {
    q: 'How do credit union loan rates work in Ireland?',
    a: 'Credit union rates vary significantly by institution, loan amount, and individual member circumstances. The ILCU average is based on a survey of affiliated credit unions conducted in July/August 2025. The maximum legal rate for Irish credit unions is 12.68% APR.',
  },
  {
    q: 'How are the loan cost figures calculated?',
    a: 'All figures are calculated on €10,000 borrowed over 60 months (5 years) using the standard compound interest formula. Monthly repayments and total interest are rounded to the nearest cent. Results are for comparison purposes only — your actual rate may differ. Monthly repayments are derived from each lender\'s nominal interest rate; the APR column is the all-in comparison figure, so monthly cost may not track APR exactly.',
  },
];

const CARDS_FAQ = [
  {
    q: 'What does representative APR mean for Irish credit cards?',
    a: 'Every Irish credit card issuer is legally required by the CCPC to publish a representative APR. It assumes a €1,500 balance repaid over 12 months including the mandatory €30 government stamp duty. It is the only standardised total-cost metric available for credit cards — because a card has no fixed term or balance, a "total cost of credit" figure like the loans page uses is not meaningful here.',
  },
  {
    q: 'How do balance-transfer offers work?',
    a: 'An introductory balance-transfer offer lets you move debt from another card at a lower rate for a set period. Offers vary widely: some are 0% (Revolut: up to 6 months; PTSB Ice: 6 months; BOI Classic/Platinum Advantage/Aer: 7 months; Avant One Card: 9 months) while others are a reduced rate rather than 0% (AIB Platinum: 3.83% variable for 12 months; BOI Affinity: 2.9% fixed for 12 months). Several BOI offers are new-customer-only and an either/or choice with a 0% purchase offer. Some require the transfer within a deadline (Avant: 90 days from opening). Some have a balance cap (AIB Platinum: €5,000). All terms change frequently — always confirm directly with the issuer before applying.',
  },
  {
    q: 'What annual fees do Irish credit cards charge?',
    a: 'All Irish credit cards carry the government stamp duty of €30 per year — this applies to every card on this page. Most cards have no additional annual card fee beyond the stamp duty. Exceptions: Bank of Ireland Platinum Advantage charges approximately €76.18/year, and the BOI Aer Credit Card charges approximately €78/year. Confirm current fee amounts with Bank of Ireland directly.',
  },
  {
    q: 'What is the cheapest way to use a credit card?',
    a: 'If you clear your full balance every month, you pay zero interest — regardless of the APR on the card. The representative APR only matters if you carry a balance. This is why a card with strong rewards can beat a low-APR card for disciplined payers, while the APR ranking is the correct metric for anyone who expects to carry a balance.',
  },
  {
    q: 'Which credit card providers are included in this comparison?',
    a: 'This table covers all issuers with live credit cards in the Irish market: AIB, Bank of Ireland, PTSB, An Post Money, Avant Money, and Revolut. Monzo and N26 operate in Ireland but do not currently offer a credit card here. KBC and Ulster Bank have exited the Irish market — any older comparison that includes them is out of date.',
  },
  {
    q: 'What is the government stamp duty on Irish credit cards?',
    a: 'A €30 government stamp duty applies to all Irish credit cards each year. It is charged once per card per year — not per transaction — and is collected by your card issuer on behalf of Revenue. The €30 is built into the representative APR calculation for each card shown here, so the APR figures already account for it.',
  },
];

// ── JSON-LD builders ──────────────────────────────────────────────────────────

const BASE = 'https://borrowclever.ie';

function org() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'BorrowClever',
    legalName: 'BorrowClever Ireland Limited',
    url: BASE,
    logo: `${BASE}/logo.svg`,
    description: "Ireland's independent personal loan and credit card comparison service. Rates verified fortnightly from lender websites and CCPC.ie.",
  };
}

function webpage(url, name, description, dateModified) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    url,
    name,
    description,
    dateModified,
    inLanguage: 'en-IE',
    isPartOf: { '@type': 'WebSite', url: BASE, name: 'BorrowClever' },
  };
}

function breadcrumb(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

function faqPage(faqs) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

function dataset(name, description, url, dateModified) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name,
    description,
    url,
    dateModified,
    creator: { '@type': 'Organization', name: 'BorrowClever', url: BASE },
    spatialCoverage: { '@type': 'Place', name: 'Ireland' },
    inLanguage: 'en-IE',
  };
}

function ldScript(blocks) {
  return `\n<script type="application/ld+json">\n${JSON.stringify(
    Array.isArray(blocks) ? blocks : [blocks],
    null, 2
  )}\n</script>\n`;
}

// ── Step 1: sitemap.xml ───────────────────────────────────────────────────────
(function buildSitemap() {
  const buildDate = today();
  const pages = [
    { loc: '/',             lastmod: buildDate,                    changefreq: 'weekly',  priority: '1.0' },
    { loc: '/loans.html',   lastmod: loansMeta.last_full_review,   changefreq: 'weekly',  priority: '0.9' },
    { loc: '/cards.html',   lastmod: cardsMeta.last_full_review,   changefreq: 'weekly',  priority: '0.9' },
    { loc: '/about.html',   lastmod: buildDate,                    changefreq: 'monthly', priority: '0.4' },
    { loc: '/how-we-make-money.html', lastmod: buildDate,          changefreq: 'monthly', priority: '0.4' },
    { loc: '/privacy.html', lastmod: buildDate,                    changefreq: 'monthly', priority: '0.2' },
  ];

  // Auto-pick up any guide pages, so new guides don't need a manual sitemap edit.
  const guidesDir = path.join(__dirname, 'guides');
  if (fs.existsSync(guidesDir)) {
    for (const file of fs.readdirSync(guidesDir).sort()) {
      if (!file.endsWith('.html')) continue;
      pages.push({ loc: `/guides/${file}`, lastmod: buildDate, changefreq: 'monthly', priority: '0.7' });
    }
  }

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    pages.map(p =>
      `  <url>\n` +
      `    <loc>${BASE}${p.loc}</loc>\n` +
      `    <lastmod>${p.lastmod}</lastmod>\n` +
      `    <changefreq>${p.changefreq}</changefreq>\n` +
      `    <priority>${p.priority}</priority>\n` +
      `  </url>`
    ).join('\n') +
    `\n</urlset>\n`;

  fs.writeFileSync(path.join(__dirname, 'sitemap.xml'), xml, 'utf8');
  console.log(`[build] sitemap.xml: ${pages.length} pages | loans ${loansMeta.last_full_review} | cards ${cardsMeta.last_full_review}`);
})();

// ── Step 2: homepage (index.html) ─────────────────────────────────────────────
(function buildHomepage() {
  const featured = loans
    .filter(l => l.homepage === true)
    .sort((a, b) => a.apr - b.apr);

  if (featured.length === 0) {
    console.error('[build] ERROR: no loans have homepage:true — homepage hero unchanged');
    return;
  }

  const aib = loans.find(l => l.id === 'aib-personal');
  if (!aib) {
    console.error('[build] ERROR: aib-personal not found in loans.json — homepage hero unchanged');
    return;
  }

  const bestFeatured = featured[0];
  const saving = calcInterest(aib.apr) - calcInterest(bestFeatured.apr);

  // JSON-LD for homepage
  const buildDate = today();
  const jsonld = ldScript([
    org(),
    { '@context': 'https://schema.org', '@type': 'WebSite', url: BASE, name: 'BorrowClever',
      description: "Ireland's independent personal loan and credit card comparison service." },
    webpage(`${BASE}/`, 'Compare Loans & Credit Cards Ireland | BorrowClever',
      "Compare every Irish personal loan and credit card by total cost of credit. Independent rankings, no commission influence. Rates verified fortnightly.",
      buildDate),
  ]);

  const indexPath = path.join(__dirname, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');

  html = inject(html, 'HERO_SAVING', String(saving));
  html = inject(html, 'JSONLD', jsonld);

  fs.writeFileSync(indexPath, html, 'utf8');
  console.log(`[build] index.html: best ${bestFeatured.apr.toFixed(2)}% | saving €${saving}`);
})();

// ── Step 3: loans.html ────────────────────────────────────────────────────────
(function buildLoans() {
  const dateIso  = loansMeta.last_full_review;
  const dateLong = fmtDateLong(dateIso);

  const jsonld = ldScript([
    org(),
    webpage(`${BASE}/loans.html`,
      'Personal Loan Comparison Ireland 2026 | BorrowClever',
      'Compare personal loans from every Irish lender — banks and credit unions — ranked by total cost of credit on a €10,000 loan. Independently verified.',
      dateIso),
    breadcrumb([
      { name: 'Home', url: `${BASE}/` },
      { name: 'Personal Loans', url: `${BASE}/loans.html` },
    ]),
    faqPage(LOANS_FAQ),
    dataset(
      'Irish Personal Loan Rates 2026',
      'Personal loan APRs from all major Irish lenders including banks and credit unions, ranked by total cost of credit on €10,000 over 5 years. Verified fortnightly.',
      `${BASE}/loans.html`,
      dateIso
    ),
  ]);

  const loansPath = path.join(__dirname, 'loans.html');
  let html = fs.readFileSync(loansPath, 'utf8');

  html = inject(html, 'JSONLD', jsonld);
  html = inject(html, 'LAST_VERIFIED', dateLong);

  fs.writeFileSync(loansPath, html, 'utf8');
  console.log(`[build] loans.html: dateModified ${dateIso} | last verified "${dateLong}"`);
})();

// ── Step 4: cards.html ────────────────────────────────────────────────────────
(function buildCards() {
  const dateIso  = cardsMeta.last_full_review;
  const dateLong = fmtDateLong(dateIso);

  const jsonld = ldScript([
    org(),
    webpage(`${BASE}/cards.html`,
      'Credit Card Comparison Ireland 2026 | BorrowClever',
      'Compare Irish credit cards by representative APR with balance-transfer intro offers. Banks and fintechs, ranked independently. Verified fortnightly.',
      dateIso),
    breadcrumb([
      { name: 'Home', url: `${BASE}/` },
      { name: 'Credit Cards', url: `${BASE}/cards.html` },
    ]),
    faqPage(CARDS_FAQ),
    dataset(
      'Irish Credit Card Rates 2026',
      'Representative APRs and balance-transfer offers for all Irish credit cards, ranked by total cost of credit. Verified fortnightly from CCPC.ie and issuer websites.',
      `${BASE}/cards.html`,
      dateIso
    ),
  ]);

  const cardsPath = path.join(__dirname, 'cards.html');
  let html = fs.readFileSync(cardsPath, 'utf8');

  html = inject(html, 'JSONLD', jsonld);
  html = inject(html, 'LAST_VERIFIED', dateLong);

  fs.writeFileSync(cardsPath, html, 'utf8');
  console.log(`[build] cards.html: dateModified ${dateIso} | last verified "${dateLong}"`);
})();

// ── Step 5: privacy.html ──────────────────────────────────────────────────────
(function buildPrivacy() {
  const buildDate = today();

  const jsonld = ldScript([
    org(),
    webpage(`${BASE}/privacy.html`,
      'Privacy Policy | BorrowClever',
      'BorrowClever privacy policy. How we collect, use and store your personal data including email addresses.',
      buildDate),
    breadcrumb([
      { name: 'Home', url: `${BASE}/` },
      { name: 'Privacy Policy', url: `${BASE}/privacy.html` },
    ]),
  ]);

  const privacyPath = path.join(__dirname, 'privacy.html');
  let html = fs.readFileSync(privacyPath, 'utf8');

  html = inject(html, 'JSONLD', jsonld);

  fs.writeFileSync(privacyPath, html, 'utf8');
  console.log(`[build] privacy.html: dateModified ${buildDate}`);
})();
