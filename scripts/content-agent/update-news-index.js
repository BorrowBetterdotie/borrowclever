/**
 * update-news-index.js
 *
 * Keeps news/index.html in sync with the articles draft-article.js writes.
 * Inserts a card for the new article at the top of the news-list and bumps
 * the CollectionPage JSON-LD dateModified. Without this, a published
 * article is reachable by direct URL but never linked from the listing
 * page that's supposed to surface it.
 */

import fs from 'fs';
import path from 'path';

const NEWS_LIST_OPEN = '<div class="news-list">';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(dateIso) {
  const date = new Date(`${dateIso}T00:00:00Z`);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function renderCard({ dateIso, title, slug, metaDescription, tags = [] }) {
  const href = `/news/${dateIso}-${slug}.html`;
  const tagList = tags.length
    ? `\n      <span class="news-card-tags">${tags.map((t) => `<span class="tag-chip">${escapeHtml(t)}</span>`).join('')}</span>`
    : '';
  return `    <a href="${href}" class="news-card">
      <span class="news-card-date">${formatDate(dateIso)}</span>
      <span class="news-card-title">${escapeHtml(title)}</span>
      <span class="news-card-desc">${escapeHtml(metaDescription)}</span>${tagList}
    </a>`;
}

/** Returns news/index.html's HTML with a new card inserted at the top of the news-list. */
export function insertNewsCard(indexHtml, article) {
  const marker = indexHtml.indexOf(NEWS_LIST_OPEN);
  if (marker === -1) {
    throw new Error('Could not find <div class="news-list"> in news/index.html');
  }
  const insertAt = marker + NEWS_LIST_OPEN.length;
  const card = renderCard(article);
  const updated = indexHtml.slice(0, insertAt) + '\n' + card + indexHtml.slice(insertAt);

  return updated.replace(
    /("@type":\s*"CollectionPage"[\s\S]*?"dateModified":\s*)"[\d-]+"/,
    `$1"${article.dateIso}"`
  );
}

/** Reads, updates, and rewrites news/index.html for a newly drafted article. */
export function updateNewsIndex(repoRoot, article) {
  const indexPath = path.join(repoRoot, 'news', 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
  fs.writeFileSync(indexPath, insertNewsCard(html, article));
}
