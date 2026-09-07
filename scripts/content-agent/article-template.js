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
