#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');

// ── amortisation ──────────────────────────────────────────────────────────────
// Uses the effective monthly rate: i = (1 + apr/100)^(1/12) - 1
// Returns total interest rounded to nearest integer.
function calcInterest(apr, principal = 10_000, months = 60) {
  const i      = Math.pow(1 + apr / 100, 1 / 12) - 1;
  const pow    = Math.pow(1 + i, months);
  const monthly = principal * i * pow / (pow - 1);
  return Math.round(monthly * months - principal);
}

// ── marker injection ──────────────────────────────────────────────────────────
// Replaces everything between <!-- TAG_START --> and <!-- TAG_END --> (inclusive).
function inject(html, tag, content) {
  const re = new RegExp(`<!-- ${tag}_START -->[\\s\\S]*?<!-- ${tag}_END -->`, 'g');
  if (!re.test(html)) {
    console.warn(`[build] WARNING: marker ${tag} not found in file`);
    return html;
  }
  return html.replace(
    new RegExp(`<!-- ${tag}_START -->[\\s\\S]*?<!-- ${tag}_END -->`, 'g'),
    `<!-- ${tag}_START -->${content}<!-- ${tag}_END -->`
  );
}

// ── format helpers ────────────────────────────────────────────────────────────
function fmtNum(n) {
  return n.toLocaleString('en-IE');
}

// ── load data ─────────────────────────────────────────────────────────────────
const loans = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data/loans.json'), 'utf8')
);

// ── homepage hero ─────────────────────────────────────────────────────────────
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
  const maxInterest  = calcInterest(featured[featured.length - 1].apr);

  // Build lender rows for the mini comparison card
  const rows = featured.map((loan, idx) => {
    const interest = calcInterest(loan.apr);
    const isFirst  = idx === 0;
    const isLast   = idx === featured.length - 1;
    const barPct   = Math.round(interest / maxInterest * 100);
    const barColor = isFirst ? '#1a6e42' : isLast ? '#fca5a5' : '#93c5fd';
    const aprCls   = isFirst ? 'green' : isLast ? 'red' : 'mid';
    const rowCls   = isFirst ? ' best-row' : '';
    const typeStr  = loan.typeNote ? `${loan.rateType} · ${loan.typeNote}` : loan.rateType;

    return [
      `        <div class="lender-row${rowCls}">`,
      `          <div class="l-icon ${loan.iconCls}">${loan.icon}</div>`,
      `          <div class="l-info">`,
      `            <div class="l-name">${loan.lender}</div>`,
      `            <div class="l-type">${typeStr}</div>`,
      `            <div class="l-bar-wrap"><div class="l-bar" style="width:${barPct}%;background:${barColor};"></div></div>`,
      `          </div>`,
      `          <div class="l-right">`,
      `            <div class="l-apr ${aprCls}">${loan.apr.toFixed(2)}%</div>`,
      `            <div class="l-cost">€${fmtNum(interest)} total interest</div>`,
      isFirst ? `            <div class="l-pill">Cheapest</div>` : '',
      `          </div>`,
      `        </div>`,
    ].filter(Boolean).join('\n');
  }).join('\n');

  const saving = calcInterest(aib.apr) - calcInterest(bestFeatured.apr);

  // Read, inject, write
  const indexPath = path.join(__dirname, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');

  html = inject(html, 'HOMEPAGE_LOANS', `\n        <!-- generated from /data/loans.json by build.js — do not edit by hand -->\n${rows}\n        `);
  html = inject(html, 'HERO_SAVING', String(saving));

  fs.writeFileSync(indexPath, html, 'utf8');

  console.log(`[build] homepage: ${featured.length} featured loans | best ${bestFeatured.apr.toFixed(2)}% (${bestFeatured.lender}) | saving €${saving} vs ${aib.lender}`);
  featured.forEach(l => {
    console.log(`  ${l.lender.padEnd(20)} ${l.apr.toFixed(2)}%  →  €${fmtNum(calcInterest(l.apr))} interest`);
  });
})();
