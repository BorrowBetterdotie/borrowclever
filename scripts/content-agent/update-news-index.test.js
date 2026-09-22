import { test } from 'node:test';
import assert from 'node:assert/strict';
import { insertNewsCard } from './update-news-index.js';

const FIXTURE = `<script type="application/ld+json">
[
  {
    "@type": "CollectionPage",
    "dateModified": "2026-09-08"
  }
]
</script>
<div class="news-list">
    <a href="/news/2026-09-08-old-article.html" class="news-card">
      <span class="news-card-date">8 September 2026</span>
      <span class="news-card-title">Old Article</span>
      <span class="news-card-desc">Old description.</span>
    </a>
</div>`;

test('insertNewsCard adds the new card before the existing ones', () => {
  const html = insertNewsCard(FIXTURE, {
    dateIso: '2026-09-14',
    title: 'New Article',
    slug: 'new-article',
    metaDescription: 'New description.',
  });

  const listOpen = html.indexOf('<div class="news-list">');
  const newCard = html.indexOf('New Article');
  const oldCard = html.indexOf('Old Article');

  assert.ok(listOpen < newCard, 'new card should come after the list opens');
  assert.ok(newCard < oldCard, 'new card should come before the old card');
  assert.match(html, /<a href="\/news\/2026-09-14-new-article\.html" class="news-card">/);
  assert.match(html, /<span class="news-card-date">14 September 2026<\/span>/);
});

test('insertNewsCard escapes HTML-significant characters', () => {
  const html = insertNewsCard(FIXTURE, {
    dateIso: '2026-09-14',
    title: 'Rates & "Terms" <Update>',
    slug: 'test',
    metaDescription: 'desc',
  });

  assert.match(html, /<span class="news-card-title">Rates &amp; &quot;Terms&quot; &lt;Update&gt;<\/span>/);
  assert.doesNotMatch(html, /<span class="news-card-title">Rates & "Terms" <Update><\/span>/);
});

test('insertNewsCard bumps the CollectionPage dateModified', () => {
  const html = insertNewsCard(FIXTURE, {
    dateIso: '2026-09-14',
    title: 'New Article',
    slug: 'new-article',
    metaDescription: 'desc',
  });

  assert.match(html, /"@type": "CollectionPage",\s*"dateModified": "2026-09-14"/);
});

test('insertNewsCard renders tag chips when tags are provided', () => {
  const html = insertNewsCard(FIXTURE, {
    dateIso: '2026-09-14',
    title: 'New Article',
    slug: 'new-article',
    metaDescription: 'desc',
    tags: ['ECB', 'Inflation'],
  });

  assert.match(html, /<span class="news-card-tags"><span class="tag-chip">ECB<\/span><span class="tag-chip">Inflation<\/span><\/span>/);
});

test('insertNewsCard omits the tags span when no tags are given', () => {
  const html = insertNewsCard(FIXTURE, {
    dateIso: '2026-09-14',
    title: 'New Article',
    slug: 'new-article',
    metaDescription: 'desc',
  });

  assert.doesNotMatch(html, /news-card-tags/);
});

test('insertNewsCard throws if the news-list marker is missing', () => {
  assert.throws(() => {
    insertNewsCard('<div>no list here</div>', {
      dateIso: '2026-09-14',
      title: 'New Article',
      slug: 'new-article',
      metaDescription: 'desc',
    });
  }, /Could not find/);
});
