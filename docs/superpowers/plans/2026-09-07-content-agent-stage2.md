# Content-agent Stage 2 (LLM Drafting) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Claude API drafting stage to the content-agent pipeline: read `scripts/content-agent/data/news-items.json`, draft one synthesized roundup article via the Claude API, render it into a publish-ready HTML page under `news/`, and wire the workflow to commit it to a branch and open a PR for human review.

**Architecture:** Two new pure/testable modules (`article-template.js` for HTML rendering, `guardrails.js` for the rate-figure safety-net check) consumed by one orchestrating script (`draft-article.js`, ESM, mirrors `fetch-news.js`'s conventions). `content-agent.yml` gets new steps appended to its existing single job, replacing the stage-2 TODO comment.

**Tech Stack:** Node.js 20 (ESM), `@anthropic-ai/sdk` (new dependency), Node's built-in `node:test` runner (no new test dependency), GitHub Actions.

## Global Constraints

- Model: `claude-sonnet-5`, `max_tokens: 2048`, non-streaming, forced tool call (`tool_choice: { type: "tool", name: "submit_draft" }`) — never free-text JSON parsing.
- One draft per run, synthesizing all relevant items — never one draft per item.
- `news-items.json` missing or 0 items → exit 0, no API call, no file written, no PR.
- Guardrails: no specific rate/APR/fee figures in the draft; no commentary on a named lender's financial stability; body must end with a not-financial-advice disclaimer paragraph. Enforced via the system prompt AND a regex safety-net in code (`/\d+(\.\d+)?\s*%/` against `bodyHtml` — reject, don't strip, on a match).
- Output path: `news/<YYYY-MM-DD>-<slug>.html`, repo root sibling to `guides/`.
- The LLM only ever supplies `{ title, slug, metaDescription, bodyHtml }` — full HTML boilerplate (head/nav/footer/JSONLD) lives entirely in `article-template.js`, never LLM-generated.
- Secret: `ANTHROPIC_API_KEY`, referenced as `${{ secrets.ANTHROPIC_API_KEY }}` — must be added in GitHub UI by the user; this plan cannot and does not add it.
- Workflow needs `permissions: contents: write` / `pull-requests: write` at the top level (currently absent — stage 1 needed neither).
- Commit/PR pattern matches `rate-check.yml` exactly: `git checkout -b automated/content-$(date +%Y%m%d%H%M%S)`, commit, push, `gh pr create --base main`; a no-op run (nothing staged) skips branch/PR creation silently.
- All new script files are ESM (`import`/`export`), matching `fetch-news.js` and the rest of `scripts/`.

---

### Task 1: Add `@anthropic-ai/sdk` dependency

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `@anthropic-ai/sdk` importable as `import Anthropic from '@anthropic-ai/sdk'` in later tasks.

- [ ] **Step 1: Install the dependency**

Run: `npm install @anthropic-ai/sdk`

- [ ] **Step 2: Confirm package.json and lockfile updated**

Run: `git diff package.json`
Expected: a new line under `"dependencies"` for `"@anthropic-ai/sdk": "^<version>"` (alongside the existing `"rss-parser"` entry), and `package-lock.json` shows as modified in `git status --short`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "Add @anthropic-ai/sdk dependency for content-agent stage 2"
```

---

### Task 2: Build `article-template.js` (HTML rendering) with unit tests

**Files:**
- Create: `scripts/content-agent/article-template.js`
- Test: `scripts/content-agent/article-template.test.js`
- Modify: `package.json` (add a `test` script)

**Interfaces:**
- Consumes: nothing (pure module, no I/O)
- Produces:
  - `articleFilePath(dateIso: string, slug: string): string` — returns e.g. `"news/2026-09-08-ecb-rate-watch.html"` (repo-root-relative, no leading slash)
  - `renderArticle({ title: string, metaDescription: string, bodyHtml: string, dateIso: string, slug: string }): string` — returns a complete HTML document string

- [ ] **Step 1: Write the failing tests**

Create `scripts/content-agent/article-template.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/content-agent/article-template.test.js`
Expected: FAIL — `Cannot find module './article-template.js'`

- [ ] **Step 3: Write the implementation**

Create `scripts/content-agent/article-template.js`:

```js
/**
 * article-template.js
 *
 * Owns all HTML boilerplate for news/ articles — head meta tags, JSON-LD,
 * nav, footer. The LLM in draft-article.js only ever supplies
 * { title, slug, metaDescription, bodyHtml }; this module is the only place
 * that boilerplate gets generated, so it's never at the mercy of the model
 * getting site structure subtly wrong.
 */

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Repo-root-relative output path for a given article date and slug. */
export function articleFilePath(dateIso, slug) {
  return `news/${dateIso}-${slug}.html`;
}

/** Renders a complete HTML document for one news/ article. */
export function renderArticle({ title, metaDescription, bodyHtml, dateIso, slug }) {
  const url = `https://borrowclever.ie/news/${dateIso}-${slug}.html`;
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(metaDescription);

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'BorrowClever',
      url: 'https://borrowclever.ie',
      description: "Ireland's independent personal loan and credit card comparison service. Rates verified fortnightly from lender websites and CCPC.ie.",
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: title,
      url,
      description: metaDescription,
      datePublished: dateIso,
      dateModified: dateIso,
      inLanguage: 'en-IE',
      publisher: { '@type': 'Organization', name: 'BorrowClever', url: 'https://borrowclever.ie' },
      isPartOf: { '@type': 'WebSite', url: 'https://borrowclever.ie', name: 'BorrowClever' },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://borrowclever.ie/' },
        { '@type': 'ListItem', position: 2, name: 'News', item: 'https://borrowclever.ie/news/' },
        { '@type': 'ListItem', position: 3, name: title, item: url },
      ],
    },
  ];

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${safeTitle} | BorrowClever</title>
<meta name="description" content="${safeDescription}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="BorrowClever">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${safeTitle}">
<meta property="og:description" content="${safeDescription}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${safeTitle}">
<meta name="twitter:description" content="${safeDescription}">
<script type="application/ld+json">
${JSON.stringify(jsonLd, null, 2)}
</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="/site.css">
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<style>
.page-header { padding: 4rem 6%; }
.page-header-inner { max-width: 860px; }
.page-header h1 { font-size: clamp(1.8rem, 3vw, 2.6rem); margin-bottom: 0.75rem; }
.eyebrow { display: inline-block; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #4ade80; margin-bottom: 1rem; }
.content { max-width: 860px; margin: 0 auto; padding: 4rem 6%; }
.content h2 { font-size: 1.15rem; font-weight: 700; color: #f0f0f0; letter-spacing: -0.02em; margin-top: 2.5rem; margin-bottom: 0.75rem; }
.content h2:first-child { margin-top: 0; }
.content h3 { font-size: 0.95rem; font-weight: 700; color: #f0f0f0; margin-top: 1.75rem; margin-bottom: 0.5rem; }
.content p { font-size: 0.92rem; color: #888; line-height: 1.75; margin-bottom: 1rem; }
.content p strong { color: #f0f0f0; }
.content ul, .content ol { margin: 0.5rem 0 1rem 1.25rem; display: flex; flex-direction: column; gap: 0.4rem; }
.content ul li, .content ol li { font-size: 0.92rem; color: #888; line-height: 1.65; }
.content a { color: #22c55e; }
@media (max-width: 900px) { .content { padding: 3rem 5%; } }
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
    <div class="eyebrow">News</div>
    <h1>${safeTitle}</h1>
  </div>
</div>

<!-- CONTENT -->
<div class="content">
${bodyHtml}
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
```

- [ ] **Step 4: Add a `test` script to package.json**

In `package.json`, add under `"scripts"`:

```json
"test": "node --test scripts/content-agent/"
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 4 tests, 0 failures

- [ ] **Step 6: Commit**

```bash
git add scripts/content-agent/article-template.js scripts/content-agent/article-template.test.js package.json
git commit -m "Add article-template.js for content-agent stage 2 HTML rendering"
```

---

### Task 3: Build `guardrails.js` (rate-figure safety-net) with unit tests

**Files:**
- Create: `scripts/content-agent/guardrails.js`
- Test: `scripts/content-agent/guardrails.test.js`

**Interfaces:**
- Consumes: nothing (pure module)
- Produces: `checkGuardrails(bodyHtml: string): { ok: boolean, reason?: string }`

- [ ] **Step 1: Write the failing tests**

Create `scripts/content-agent/guardrails.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkGuardrails } from './guardrails.js';

test('accepts body with no rate figures', () => {
  const result = checkGuardrails('<p>The ECB is expected to raise rates this week.</p>');
  assert.equal(result.ok, true);
});

test('rejects body containing a decimal percentage figure', () => {
  const result = checkGuardrails('<p>PTSB now offers loans at 7.2% APR.</p>');
  assert.equal(result.ok, false);
  assert.match(result.reason, /rate\/percentage figure/);
});

test('rejects body containing a whole-number percentage figure', () => {
  const result = checkGuardrails('<p>Inflation hit 5% last month.</p>');
  assert.equal(result.ok, false);
});

test('does not false-positive on unrelated numbers', () => {
  const result = checkGuardrails('<p>Budget 2027 introduces new tax credit changes.</p>');
  assert.equal(result.ok, true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scripts/content-agent/guardrails.test.js`
Expected: FAIL — `Cannot find module './guardrails.js'`

- [ ] **Step 3: Write the implementation**

Create `scripts/content-agent/guardrails.js`:

```js
/**
 * guardrails.js
 *
 * Defense-in-depth check on drafted article bodies. The system prompt in
 * draft-article.js already instructs the model never to state a specific
 * rate/APR/fee figure — this is the code-level backstop for when prompt
 * instructions alone aren't a hard enough guarantee on a financial site.
 * Intentionally coarse: any digit immediately followed by "%" trips it,
 * including non-rate percentages (e.g. "100% of respondents"). A false
 * positive just fails the CI job for a human to look at — it never lets
 * a bad figure through silently, which is the trade-off this stage wants.
 */

const RATE_PATTERN = /\d+(\.\d+)?\s*%/;

export function checkGuardrails(bodyHtml) {
  if (RATE_PATTERN.test(bodyHtml)) {
    return {
      ok: false,
      reason: 'Draft contains a rate/percentage figure (e.g. "7.2%"), which is not allowed — only the rate-check pipeline is a source of truth for specific rates.',
    };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scripts/content-agent/guardrails.test.js`
Expected: PASS — 4 tests, 0 failures

- [ ] **Step 5: Commit**

```bash
git add scripts/content-agent/guardrails.js scripts/content-agent/guardrails.test.js
git commit -m "Add guardrails.js rate-figure safety-net for content-agent stage 2"
```

---

### Task 4: Build `draft-article.js` (orchestrator: Claude API call, dry-run, empty-items handling)

**Files:**
- Create: `scripts/content-agent/draft-article.js`

**Interfaces:**
- Consumes:
  - `articleFilePath`, `renderArticle` from `./article-template.js` (Task 2)
  - `checkGuardrails` from `./guardrails.js` (Task 3)
  - reads `scripts/content-agent/data/news-items.json` (same shape `fetch-news.js` writes: `{ generatedAt, count, items: [{ title, link, source, publishedAt, summary }] }`)
- Produces: writes `news/<dateIso>-<slug>.html` on success; writes nothing on the empty-items or guardrail-rejection paths.

- [ ] **Step 1: Write the implementation**

This task is integration glue (file I/O, an external API call, process exit codes) rather than pure logic, so it's verified by running it directly against real and synthetic inputs (Steps 2-5) rather than `node:test` unit tests — consistent with how `fetch-news.js` itself was verified in stage 1.

Create `scripts/content-agent/draft-article.js`:

```js
#!/usr/bin/env node
/**
 * draft-article.js
 *
 * Stage 2 of the content-agent pipeline: reads news-items.json (written by
 * fetch-news.js earlier in the same CI job), asks the Claude API to draft
 * one roundup article synthesizing the relevant items, and writes a
 * publish-ready HTML page to news/. Writes nothing if there's nothing
 * relevant to draft, or if the draft fails the guardrail check.
 *
 * Usage:
 *   node draft-article.js              (calls the real Claude API — needs ANTHROPIC_API_KEY)
 *   node draft-article.js --dry-run    (skips the API call, writes a fixed placeholder draft)
 *
 * Requires: npm install @anthropic-ai/sdk
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { checkGuardrails } from './guardrails.js';
import { articleFilePath, renderArticle } from './article-template.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NEWS_ITEMS_PATH = path.join(__dirname, 'data', 'news-items.json');
const REPO_ROOT = path.join(__dirname, '..', '..');

const SYSTEM_PROMPT = `You are the editorial voice of BorrowClever, an independent Irish personal loan and credit card comparison site. Write a short roundup article (300-500 words) synthesizing the news items you're given into one coherent piece — not a bulleted list of unrelated blurbs.

Rules you must follow:
- Never state a specific interest rate, APR, or fee figure (e.g. "7.2%"), even if a source item mentions one. Refer to rate moves qualitatively instead (e.g. "the ECB is expected to raise rates").
- Never assess a named lender's financial stability, safety, or creditworthiness. Report what the source said; don't editorialize about the institution.
- End the body with a short paragraph making clear this is not financial advice, in the spirit of: "This is general commentary, not financial advice. Always confirm current rates and terms directly with a lender before applying."
- Link out to original source articles where natural, using the "link" field from the provided items.
- Body must be a semantic HTML fragment using only these tags: h2, h3, p, ul, li, a, strong, em. No head/nav/full-page markup, no inline styles, no html/body tags.

Call the submit_draft tool with your finished draft. Do not respond with plain text.`;

const DRAFT_TOOL = {
  name: 'submit_draft',
  description: 'Submit the finished article draft.',
  input_schema: {
    type: 'object',
    required: ['title', 'slug', 'metaDescription', 'bodyHtml'],
    properties: {
      title: { type: 'string', description: 'Article headline, no site name suffix.' },
      slug: { type: 'string', description: 'kebab-case, no date prefix, e.g. ecb-rate-watch-and-ptsb-takeover' },
      metaDescription: { type: 'string', description: '150-160 characters, for meta description and og:description.' },
      bodyHtml: { type: 'string', description: 'Semantic HTML fragment: h2/h3, p, ul/li, a, strong/em only. No head/nav/full-page markup.' },
    },
  },
};

function isDryRun() {
  return process.argv.includes('--dry-run');
}

function readNewsItems() {
  if (!fs.existsSync(NEWS_ITEMS_PATH)) return [];
  const data = JSON.parse(fs.readFileSync(NEWS_ITEMS_PATH, 'utf8'));
  return data.items || [];
}

function dryRunDraft() {
  return {
    title: 'Dry Run: Sample Article Title',
    slug: 'dry-run-sample-article',
    metaDescription: 'Placeholder meta description from --dry-run, for testing template and file-writing plumbing without calling the Claude API.',
    bodyHtml: '<h2>Dry run</h2>\n<p>This is placeholder body content generated by --dry-run mode. No API call was made.</p>\n<p>This is general commentary, not financial advice. Always confirm current rates and terms directly with a lender before applying.</p>',
  };
}

async function draftFromClaude(items) {
  const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from env
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    tools: [DRAFT_TOOL],
    tool_choice: { type: 'tool', name: 'submit_draft' },
    messages: [{ role: 'user', content: JSON.stringify(items, null, 2) }],
  });

  const toolUse = message.content.find((block) => block.type === 'tool_use');
  if (!toolUse) {
    throw new Error('Claude response did not include a submit_draft tool call.');
  }
  return toolUse.input;
}

async function main() {
  const items = readNewsItems();
  if (items.length === 0) {
    console.log('No relevant news items — nothing to draft.');
    return;
  }

  const draft = isDryRun() ? dryRunDraft() : await draftFromClaude(items);

  for (const field of ['title', 'slug', 'metaDescription', 'bodyHtml']) {
    if (!draft[field] || typeof draft[field] !== 'string') {
      throw new Error(`Draft is missing required field: ${field}`);
    }
  }

  const guardrailResult = checkGuardrails(draft.bodyHtml);
  if (!guardrailResult.ok) {
    console.error(`Draft rejected: ${guardrailResult.reason}`);
    process.exit(1);
  }

  const dateIso = new Date().toISOString().slice(0, 10);
  const relativePath = articleFilePath(dateIso, draft.slug);
  const outputPath = path.join(REPO_ROOT, relativePath);
  const html = renderArticle({ ...draft, dateIso });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html);

  console.log(`Draft written to ${relativePath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal error in draft-article.js:', err);
    process.exit(1);
  });
```

- [ ] **Step 2: Verify the empty-items path**

Run: `mv scripts/content-agent/data/news-items.json /tmp/news-items-backup.json 2>/dev/null; node scripts/content-agent/draft-article.js`
Expected: prints `No relevant news items — nothing to draft.`, exits 0, no file written under `news/`.

Run: `ls news/ 2>&1`
Expected: `ls: news/: No such file or directory` (nothing was created).

- [ ] **Step 3: Verify the `--dry-run` path**

Run: `node scripts/content-agent/draft-article.js --dry-run`
Expected: prints `Draft written to news/<today's-date>-dry-run-sample-article.html`, exits 0.

Run: `cat news/*-dry-run-sample-article.html`
Expected: a full HTML document containing `<title>Dry Run: Sample Article Title | BorrowClever</title>`, the placeholder body, and the standard nav/footer.

- [ ] **Step 4: Verify the guardrail-rejection path**

Temporarily test the guardrail wiring by checking `checkGuardrails` is actually called with real output — this is exercised indirectly: since `dryRunDraft()`'s placeholder body has no percentage figures, it won't trip the guardrail in Step 3. To confirm the wiring itself is correct (not just that the pure function works, which Task 3 already covered), read the `main()` code and confirm `checkGuardrails(draft.bodyHtml)` runs before the `fs.writeFileSync` call. No separate run needed — this is a code-review check, not an execution check, because deliberately forcing a bad dry-run draft would mean adding test-only branching to production code, which isn't worth it for something already covered by Task 3's unit tests plus this visual confirmation.

- [ ] **Step 5: Clean up the dry-run test file**

Run: `rm -rf news/`

This was a local test artifact, not a real draft — don't commit it. Restore the backed-up news-items.json if Step 2 moved it:

Run: `mv /tmp/news-items-backup.json scripts/content-agent/data/news-items.json 2>/dev/null; echo done`

- [ ] **Step 6: Commit**

```bash
git add scripts/content-agent/draft-article.js
git commit -m "Add draft-article.js: Claude API drafting for content-agent stage 2"
```

---

### Task 5: Wire the workflow (`content-agent.yml`)

**Files:**
- Modify: `.github/workflows/content-agent.yml`

**Interfaces:**
- Consumes: `scripts/content-agent/draft-article.js` (Task 4), secret `ANTHROPIC_API_KEY` (must be added by the user in GitHub UI — not something this task can do)
- Produces: on success, a branch `automated/content-<timestamp>` and a PR against `main`, matching `rate-check.yml`'s pattern

- [ ] **Step 1: Replace the file**

Replace the full contents of `.github/workflows/content-agent.yml` with:

```yaml
name: Content agent

on:
  schedule:
    - cron: '0 7 * * *'
  workflow_dispatch: {}

permissions:
  contents: write
  pull-requests: write

jobs:
  fetch-news:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm install

      - name: Fetch news (stage 1)
        run: node scripts/content-agent/fetch-news.js --since 24

      - name: Show fetched items
        run: cat scripts/content-agent/data/news-items.json

      - name: Draft article (stage 2)
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: node scripts/content-agent/draft-article.js

      - name: Commit draft and open PR
        id: commit
        run: |
          git config user.name "borrowclever-bot"
          git config user.email "actions@users.noreply.github.com"
          git add news/
          if git diff --staged --quiet; then
            echo "changed=false" >> "$GITHUB_OUTPUT"
          else
            branch="automated/content-$(date +%Y%m%d%H%M%S)"
            git checkout -b "$branch"
            git commit -m "Content agent: draft $(date +%Y-%m-%d)"
            git push -u origin "$branch"
            echo "changed=true" >> "$GITHUB_OUTPUT"
            echo "branch=$branch" >> "$GITHUB_OUTPUT"
          fi

      - name: Open pull request with draft
        if: steps.commit.outputs.changed == 'true'
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          gh pr create \
            --base main \
            --head "${{ steps.commit.outputs.branch }}" \
            --title "Content agent draft: $(date +%Y-%m-%d)" \
            --body "Automated draft from the content-agent pipeline. Review for accuracy, tone, and whether it should be linked from the site before merging."
```

- [ ] **Step 2: Validate YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/content-agent.yml')); print('YAML OK')"`
Expected: `YAML OK`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/content-agent.yml
git commit -m "Wire content-agent.yml to run stage 2 drafting and open a PR"
```

---

### Task 6: End-to-end local dry-run of the full pipeline

**Files:** none (verification only)

**Interfaces:**
- Consumes: `scripts/content-agent/fetch-news.js` (stage 1, already merged) + everything from Tasks 1-5

- [ ] **Step 1: Run stage 1 then stage 2 back-to-back, exactly as the workflow will**

Run: `node scripts/content-agent/fetch-news.js --since 24 && node scripts/content-agent/draft-article.js --dry-run`
Expected: stage 1 logs feed results and item count as it did in stage 1 testing, then stage 2 logs `Draft written to news/<today>-dry-run-sample-article.html` (or `No relevant news items — nothing to draft.` if stage 1 found zero relevant items that run — both are correct behavior, not a failure).

- [ ] **Step 2: If a file was written, inspect it**

Run: `ls news/ 2>&1 && cat news/*.html 2>/dev/null | head -60`
Expected: valid HTML matching the structure verified in Task 4 Step 3.

- [ ] **Step 3: Clean up**

Run: `rm -rf news/ scripts/content-agent/data/`

Both are test artifacts (`news/` from `--dry-run`, `scripts/content-agent/data/` gitignored stage-1 output) — neither should be committed.

- [ ] **Step 4: Confirm working tree is clean of test artifacts**

Run: `git status --short`
Expected: no `news/` or `scripts/content-agent/data/` entries (the latter is gitignored anyway; this just confirms nothing slipped through).

No commit for this task — it's a verification checkpoint, not a code change.

---

## After implementation

- `ANTHROPIC_API_KEY` still needs to be added under GitHub → Settings → Secrets and variables → Actions before a real (non-dry-run) run will work in CI — flag this to the user again once this plan is executed.
- Once the secret is added, the same `gh workflow run content-agent.yml --ref <branch>` pattern used to verify stage 1 in CI can verify stage 2 — but that first real run will actually call the Claude API and, if it opens a PR, will need genuine human review of the drafted content before merging.
