#!/usr/bin/env node
/**
 * fetch-news.js
 *
 * Stage 1 of the content-agent pipeline: pulls RSS feeds covering the Irish
 * financial landscape, filters them for relevance to a personal finance /
 * credit comparison site, dedupes, and writes a clean JSON file for the next
 * stage (LLM drafting) to consume.
 *
 * Usage:
 *   node fetch-news.js
 *   node fetch-news.js --since 48   (only items from the last 48 hours)
 *
 * Requires: npm install rss-parser
 */

import Parser from 'rss-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Add/remove feeds here. Each needs a stable "source" label used downstream
// for attribution. If a feed changes URL or goes down, the script logs a
// warning and continues with the others rather than failing the whole run.
const FEEDS = [
  { source: 'RTE Business', url: 'https://www.rte.ie/feeds/rss/?index=/news/business' },
  { source: 'Irish Times Business', url: 'https://www.irishtimes.com/arc/outboundfeeds/rss/category/business/' },
  { source: 'Central Bank of Ireland', url: 'https://www.centralbank.ie/feeds/news-media-feed' },
  { source: 'RTE News', url: 'https://www.rte.ie/feeds/rss/?index=/news' },
];

// Keywords used to decide whether an item is relevant to the site's niche.
// Matched case-insensitively against title + summary/contentSnippet.
// Tune this list as you see what it lets through vs. misses.
const KEYWORDS = [
  'mortgage', 'credit union', 'personal loan', 'interest rate', 'ecb',
  'ccpc', 'buy now pay later', 'bnpl', 'cost of credit',
  'overdraft', 'credit card', 'savings rate', 'deposit rate', 'apr',
  'consumer credit', 'household finance', 'cost of living', 'inflation',
  'budget 2027', 'tax credit', 'kbc', 'permanent tsb', 'ptsb', 'aib',
  'bank of ireland', 'revolut', 'n26', 'financial regulator',
];

// Institution-name-only terms that are too generic to trust alone — e.g. "the
// Central Bank" turns up in unrelated stories (a coin launch, a staff award).
// These only count when paired with another KEYWORDS/WEAK_KEYWORDS hit.
const WEAK_KEYWORDS = [
  'central bank',
];

const OUTPUT_PATH = path.join(__dirname, 'data', 'news-items.json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true on any KEYWORDS hit. A WEAK_KEYWORDS hit alone isn't enough —
 * it needs a second weak hit alongside it. With only one weak term today,
 * that means a bare "central bank" mention no longer qualifies on its own;
 * the mechanism is here so more generic institution names can be moved into
 * WEAK_KEYWORDS later without redesigning the filter.
 */
function isRelevant(item) {
  const haystack = `${item.title || ''} ${item.contentSnippet || item.summary || ''}`.toLowerCase();
  if (KEYWORDS.some((kw) => haystack.includes(kw))) return true;
  const weakHits = WEAK_KEYWORDS.filter((kw) => haystack.includes(kw)).length;
  return weakHits >= 2;
}

/** Parses the --since <hours> CLI flag; defaults to no time filter (0). */
function getSinceHoursArg() {
  const idx = process.argv.indexOf('--since');
  if (idx === -1) return 0;
  const hours = Number(process.argv[idx + 1]);
  return Number.isFinite(hours) && hours > 0 ? hours : 0;
}

/** Normalizes a raw rss-parser item into the shape the next pipeline stage expects. */
function normalizeItem(item, source) {
  return {
    title: item.title?.trim() || '(untitled)',
    link: item.link,
    source,
    publishedAt: item.isoDate || item.pubDate || null,
    summary: (item.contentSnippet || item.summary || '').trim().slice(0, 500),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const parser = new Parser({ timeout: 15000 });
  const sinceHours = getSinceHoursArg();
  const cutoff = sinceHours ? Date.now() - sinceHours * 60 * 60 * 1000 : null;

  const results = await Promise.allSettled(
    FEEDS.map(async ({ source, url }) => {
      const feed = await parser.parseURL(url);
      return (feed.items || []).map((item) => normalizeItem(item, source));
    })
  );

  let allItems = [];
  results.forEach((result, i) => {
    const { source, url } = FEEDS[i];
    if (result.status === 'fulfilled') {
      console.log(`✓ ${source}: ${result.value.length} items`);
      allItems = allItems.concat(result.value);
    } else {
      console.warn(`✗ ${source} (${url}) failed: ${result.reason?.message || result.reason}`);
    }
  });

  // Time filter
  if (cutoff) {
    allItems = allItems.filter((item) => {
      if (!item.publishedAt) return true; // keep undated items rather than silently drop them
      return new Date(item.publishedAt).getTime() >= cutoff;
    });
  }

  // Relevance filter
  const relevant = allItems.filter(isRelevant);

  // Dedupe by link (different feeds occasionally carry the same wire story)
  const seen = new Set();
  const deduped = relevant.filter((item) => {
    if (!item.link || seen.has(item.link)) return false;
    seen.add(item.link);
    return true;
  });

  // Most recent first; undated items sort last
  deduped.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify({ generatedAt: new Date().toISOString(), count: deduped.length, items: deduped }, null, 2)
  );

  console.log(`\n${deduped.length} relevant items (of ${allItems.length} fetched) written to ${OUTPUT_PATH}`);
}

main()
  .then(() => process.exit(0)) // rss-parser leaves an open keep-alive socket that otherwise hangs the process
  .catch((err) => {
    console.error('Fatal error in fetch-news.js:', err);
    process.exit(1);
  });
