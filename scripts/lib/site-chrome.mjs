// scripts/lib/site-chrome.mjs
// Single source of truth for the markup every page shares: top nav, mobile
// nav, social-share meta tags and the Cloudflare Web Analytics beacon.
//
// Used two ways:
//   1. Page generators (build-rate-tracker.mjs, build-worked-examples.mjs,
//      content-agent/article-template.js) call navLinks() / mobileNavLinks() /
//      socialImageMeta() / analyticsBeacon() directly in their templates.
//   2. scripts/apply-site-chrome.mjs (last step of `npm run build`) runs
//      applySiteChrome() over every hand-maintained HTML page, so editing a
//      value here and rebuilding updates the whole site.

export const BASE = "https://borrowclever.ie";

// Cloudflare dashboard → Analytics & Logs → Web Analytics → borrowclever.ie →
// copy the `token` value from the JS snippet. Change it here only, then run
// `npm run build`.
export const CF_WEB_ANALYTICS_TOKEN = "REPLACE_WITH_CF_WEB_ANALYTICS_TOKEN";

export const OG_IMAGE = {
  url: `${BASE}/og-image.png`,
  width: 1200,
  height: 630,
  alt: "BorrowClever — Compare Irish loans by what they really cost",
};

export const COPYRIGHT = "© 2026 BorrowClever.";

// Top-nav order. `key` matches the section returned by sectionFor().
const NAV = [
  { key: "loans", href: "/loans.html", label: "Compare loans" },
  { key: "cards", href: "/cards.html", label: "Compare cards" },
  { key: "savings", href: "/savings.html", label: "Compare savings" },
  // Homepage-only anchor, inserted after "Compare savings" on index.html.
  { key: "how", href: "#features", label: "How it works", homeOnly: true },
  { key: "rate-tracker", href: "/rate-tracker/", label: "Rate tracker" },
  { key: "calculator", href: "/calculator/", label: "Calculator" },
  { key: "guides", href: "/guides/", label: "Guides" },
  { key: "news", href: "/news/", label: "News" },
];

/** Which nav item to highlight for a root-relative page path like "/guides/foo.html". */
export function sectionFor(pagePath) {
  const p = "/" + String(pagePath).replace(/^\.?\/+/, "");
  if (p === "/loans.html") return "loans";
  if (p === "/cards.html") return "cards";
  if (p === "/savings.html") return "savings";
  if (p.startsWith("/rate-tracker/")) return "rate-tracker";
  if (p.startsWith("/calculator/")) return "calculator";
  if (p.startsWith("/guides/")) return "guides";
  if (p.startsWith("/news/")) return "news";
  return null;
}

const isHome = (pagePath) => /^\/?(index\.html)?$/.test(String(pagePath).replace(/^\.\//, ""));

function items(pagePath) {
  const home = isHome(pagePath);
  const active = sectionFor(pagePath);
  const list = NAV.filter((n) => !n.homeOnly || home).map((n) => ({ ...n, active: n.key === active }));
  list.push({ key: "signup", href: home ? "#signup" : "/#signup", label: "Newsletter", cta: true });
  return list;
}

/** Inner <li> lines for <ul class="nav-links">. */
export function navLinks(pagePath, indent = "    ") {
  return items(pagePath)
    .map((n) => {
      const cls = n.cta ? ' class="nav-cta"' : n.active ? ' class="active"' : "";
      return `${indent}<li><a href="${n.href}"${cls}>${n.label}</a></li>`;
    })
    .join("\n");
}

/** Inner <a> lines for <div class="mobile-nav">. */
export function mobileNavLinks(pagePath, indent = "  ") {
  return items(pagePath)
    .map((n) => {
      const cls = n.cta ? ' class="mobile-cta"' : n.active ? ' class="active"' : "";
      return `${indent}<a href="${n.href}"${cls}>${n.label}</a>`;
    })
    .join("\n");
}

/** og:image + twitter:image tags (twitter:card itself lives with the other twitter tags). */
export function socialImageMeta() {
  return [
    `<meta property="og:image" content="${OG_IMAGE.url}">`,
    `<meta property="og:image:width" content="${OG_IMAGE.width}">`,
    `<meta property="og:image:height" content="${OG_IMAGE.height}">`,
    `<meta property="og:image:alt" content="${OG_IMAGE.alt}">`,
    `<meta name="twitter:image" content="${OG_IMAGE.url}">`,
  ].join("\n");
}

/** Cloudflare Web Analytics beacon, wrapped in markers so builds can refresh it. */
export function analyticsBeacon() {
  return `<!-- bc:analytics:start -->
<!-- Cloudflare Web Analytics — token is set in scripts/lib/site-chrome.mjs -->
<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${CF_WEB_ANALYTICS_TOKEN}"}'></script>
<!-- bc:analytics:end -->`;
}

const escAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const decode = (s) => String(s).replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/**
 * Normalises an existing page's shared chrome in place:
 * nav + mobile nav, og/twitter meta (image, large card, missing og:title/
 * description/url), and the analytics beacon before </body>.
 * Idempotent — running it twice gives the same result.
 */
export function applySiteChrome(html, pagePath) {
  // Nav
  html = html.replace(/(<ul class="nav-links">)[\s\S]*?(\n\s*<\/ul>)/, `$1\n${navLinks(pagePath)}$2`);
  html = html.replace(/(<div class="mobile-nav" id="mobile-nav">)[\s\S]*?(\n<\/div>)/, `$1\n${mobileNavLinks(pagePath)}$2`);

  // Missing og:title / og:description / og:url
  const meta = (re) => (html.match(re) || [])[1];
  const title = meta(/<title>([^<]*)<\/title>/);
  const desc = meta(/<meta name="description" content="([^"]*)"/);
  const canonical = meta(/<link rel="canonical" href="([^"]*)"/);
  const missing = [];
  if (!/property="og:url"/.test(html) && canonical) missing.push(`<meta property="og:url" content="${canonical}">`);
  if (!/property="og:title"/.test(html) && title) missing.push(`<meta property="og:title" content="${escAttr(decode(title).replace(/\s*\|\s*BorrowClever$/, ""))}">`);
  if (!/property="og:description"/.test(html) && desc) missing.push(`<meta property="og:description" content="${desc}">`);
  if (missing.length) html = html.replace(/(<meta name="twitter:card"|<\/head>)/, `${missing.join("\n")}\n$1`);

  // Social image + large card
  html = html.replace(/\n<meta (?:property="og:image(?::[a-z]+)?"|name="twitter:image")[^>]*>/g, "");
  html = html.replace(/<meta name="twitter:card" content="[^"]*">/, '<meta name="twitter:card" content="summary_large_image">');
  if (!/name="twitter:card"/.test(html)) html = html.replace(/<\/head>/, '<meta name="twitter:card" content="summary_large_image">\n</head>');
  html = html.replace(/(<meta name="twitter:card"[^>]*>)/, `${socialImageMeta()}\n$1`);

  // Analytics beacon: drop any old copy (marked or the legacy cards.html block), then add before </body>
  html = html.replace(/\n*<!-- bc:analytics:start -->[\s\S]*?<!-- bc:analytics:end -->\n*/g, "\n\n");
  html = html.replace(/\n*<!-- Cloudflare Web Analytics -->[\s\S]*?<!-- End Cloudflare Web Analytics -->\n*/g, "\n\n");
  html = html.replace(/\n*<\/body>/, `\n\n${analyticsBeacon()}\n</body>`);

  return html;
}
