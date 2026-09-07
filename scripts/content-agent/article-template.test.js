import { test } from 'node:test';
import assert from 'node:assert/strict';
import { articleFilePath, renderArticle } from './article-template.js';

test('articleFilePath builds the expected news/ path', () => {
  assert.equal(articleFilePath('2026-09-08', 'ecb-rate-watch'), 'news/2026-09-08-ecb-rate-watch.html');
});

test('renderArticle embeds title, description, and body', () => {
  const html = renderArticle({
    title: 'ECB Rate Watch',
    metaDescription: "A roundup of this week's Irish financial news.",
    bodyHtml: '<h2>Test</h2><p>Body content.</p>',
    dateIso: '2026-09-08',
    slug: 'ecb-rate-watch',
  });

  assert.match(html, /<title>ECB Rate Watch \| BorrowClever<\/title>/);
  assert.match(html, /<meta name="description" content="A roundup of this week&#39;s Irish financial news\.">/);
  assert.match(html, /<h1>ECB Rate Watch<\/h1>/);
  assert.match(html, /<h2>Test<\/h2><p>Body content\.<\/p>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/borrowclever\.ie\/news\/2026-09-08-ecb-rate-watch\.html">/);
});

test('renderArticle escapes HTML-significant characters in title', () => {
  const html = renderArticle({
    title: 'Rates & "Terms" <Update>',
    metaDescription: 'desc',
    bodyHtml: '<p>body</p>',
    dateIso: '2026-09-08',
    slug: 'test',
  });

  assert.match(html, /<h1>Rates &amp; &quot;Terms&quot; &lt;Update&gt;<\/h1>/);
  assert.doesNotMatch(html, /<h1>Rates & "Terms" <Update><\/h1>/);
});

test('renderArticle includes valid JSON-LD', () => {
  const html = renderArticle({
    title: 'Test Article',
    metaDescription: 'desc',
    bodyHtml: '<p>body</p>',
    dateIso: '2026-09-08',
    slug: 'test-article',
  });

  const match = html.match(/<script type="application\/ld\+json">\n([\s\S]*?)\n<\/script>/);
  assert.ok(match, 'expected a JSON-LD script block');
  const jsonLd = JSON.parse(match[1]);
  assert.equal(jsonLd[1]['@type'], 'Article');
  assert.equal(jsonLd[1].headline, 'Test Article');
});

test('renderArticle rejects a non-kebab-case slug', () => {
  assert.throws(() => {
    renderArticle({
      title: 'Test',
      metaDescription: 'desc',
      bodyHtml: '<p>body</p>',
      dateIso: '2026-09-08',
      slug: '../evil',
    });
  }, /Invalid slug/);

  assert.throws(() => {
    renderArticle({
      title: 'Test',
      metaDescription: 'desc',
      bodyHtml: '<p>body</p>',
      dateIso: '2026-09-08',
      slug: 'Bad_Slug!',
    });
  }, /Invalid slug/);
});

test('articleFilePath rejects a non-kebab-case slug', () => {
  assert.throws(() => {
    articleFilePath('2026-09-08', '../evil');
  }, /Invalid slug/);

  assert.throws(() => {
    articleFilePath('2026-09-08', 'Bad_Slug!');
  }, /Invalid slug/);
});

test('renderArticle neutralizes </script> inside JSON-LD without breaking the JSON value', () => {
  const maliciousTitle = 'Rates</script><img src=x onerror=alert(1)>';
  const html = renderArticle({
    title: maliciousTitle,
    metaDescription: 'desc',
    bodyHtml: '<p>body</p>',
    dateIso: '2026-09-08',
    slug: 'test-article',
  });

  // The raw HTML must never contain the literal breakout sequence.
  assert.doesNotMatch(html, /<\/script><img/);

  const match = html.match(/<script type="application\/ld\+json">\n([\s\S]*?)\n<\/script>/);
  assert.ok(match, 'expected a JSON-LD script block');
  const jsonLd = JSON.parse(match[1]);
  assert.equal(jsonLd[1].headline, maliciousTitle);
});
