/**
 * borrowclever.ie — "Check Rate" click tracker + lender redirect (per-product)
 *
 * The product list is NOT in this file. It is generated from products.json:
 *     edit products.json  ->  node build-products.mjs  ->  wrangler deploy
 * so adding a provider/card never means editing this Worker by hand.
 *
 * Routes:
 *   /go/{slug}  -> counts a real click (background) and 302-redirects to the product page
 *   /stats      -> token-protected dashboard (HTML, or ?format=json)
 *
 * Data model: one row per (slug, day), with lender/category/product columns so
 * you can slice in SQL (one product, one lender, loans-vs-cards, etc.).
 * Privacy: aggregate counts only — no IPs, cookies, or per-user trail.
 */

import { PRODUCTS } from "./products.generated.js";

const BOT_RE = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|pinterest|whatsapp|telegram|discord|slackbot|twitterbot|linkedinbot|headless|lighthouse|gtmetrix|pingdom|uptimerobot|monitor|curl|wget|python-requests|node-fetch|go-http-client|okhttp|axios/i;

function isNonHuman(request) {
  const ua = request.headers.get("user-agent") || "";
  if (!ua) return true;
  if (BOT_RE.test(ua)) return true;
  const purpose = request.headers.get("sec-purpose") || request.headers.get("purpose") || "";
  if (/prefetch|prerender/i.test(purpose)) return true;
  return false;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

async function handleStats(request, env) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key") || "";
  if (!env.STATS_TOKEN || key !== env.STATS_TOKEN) {
    return new Response("Unauthorized", { status: 401 });
  }

  const rows = await env.DB.prepare(
    "SELECT slug, lender, category, product, " +
    "SUM(CASE WHEN day >= date('now','start of month') THEN count ELSE 0 END) AS this_month, " +
    "SUM(CASE WHEN day >= date('now','-30 days')        THEN count ELSE 0 END) AS last_30d, " +
    "SUM(count) AS all_time " +
    "FROM clicks GROUP BY slug, lender, category, product " +
    "ORDER BY lender, category, product"
  ).all();

  const byMonth = await env.DB.prepare(
    "SELECT substr(day,1,7) AS month, category, SUM(count) AS clicks " +
    "FROM clicks GROUP BY month, category ORDER BY month DESC, category"
  ).all();

  if (url.searchParams.get("format") === "json") {
    return Response.json({ generated: new Date().toISOString(), per_product: rows.results, by_month: byMonth.results });
  }

  const productRows = (rows.results || []).map((r) => {
    const meta = PRODUCTS[r.slug];
    const label = meta ? meta.name : r.slug;
    return `<tr>
      <td>${esc(label)}</td>
      <td>${esc(r.lender)}</td>
      <td>${esc(r.category)}</td>
      <td class="n">${r.this_month}</td>
      <td class="n">${r.last_30d}</td>
      <td class="n">${r.all_time}</td>
    </tr>`;
  }).join("");

  const monthRows = (byMonth.results || []).map((r) =>
    `<tr><td>${esc(r.month)}</td><td>${esc(r.category)}</td><td class="n">${r.clicks}</td></tr>`
  ).join("");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>borrowclever — click stats</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 2rem auto; max-width: 860px; padding: 0 1rem; color: #1a1a1a; }
  h1 { font-size: 1.25rem; } h2 { font-size: 1rem; margin-top: 2rem; }
  table { border-collapse: collapse; width: 100%; margin-top: .5rem; }
  th, td { text-align: left; padding: .45rem .6rem; border-bottom: 1px solid #e5e5e5; }
  th { font-size: .78rem; text-transform: uppercase; letter-spacing: .04em; color: #666; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
  .muted { color: #888; font-size: .85rem; }
</style></head>
<body>
  <h1>"Check Rate" clicks — by product</h1>
  <p class="muted">Real clicks only (bots &amp; prefetch filtered). Generated ${esc(new Date().toUTCString())}.</p>
  <table>
    <thead><tr><th>Product</th><th>Lender</th><th>Type</th><th class="n">This month</th><th class="n">Last 30 days</th><th class="n">All time</th></tr></thead>
    <tbody>${productRows || '<tr><td colspan="6" class="muted">No clicks recorded yet.</td></tr>'}</tbody>
  </table>
  <h2>Monthly totals (loans vs cards)</h2>
  <table>
    <thead><tr><th>Month</th><th>Type</th><th class="n">Clicks</th></tr></thead>
    <tbody>${monthRows || '<tr><td colspan="3" class="muted">No data yet.</td></tr>'}</tbody>
  </table>
</body></html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/stats" || url.pathname === "/stats/") {
      return handleStats(request, env);
    }

    const match = url.pathname.match(/^\/go\/([a-z0-9-]+)\/?$/i);
    if (!match) return Response.redirect(url.origin, 302);

    const slug = match[1].toLowerCase();
    const meta = PRODUCTS[slug];
    if (!meta) return Response.redirect(url.origin, 302); // unknown slug -> home, no count

    const redirect = new Response(null, {
      status: 302,
      headers: { "Location": meta.url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
    });

    if (!isNonHuman(request)) {
      const day = new Date().toISOString().slice(0, 10);
      ctx.waitUntil(
        env.DB.prepare(
          "INSERT INTO clicks (slug, lender, category, product, day, count) VALUES (?, ?, ?, ?, ?, 1) " +
          "ON CONFLICT(slug, day) DO UPDATE SET count = count + 1"
        ).bind(slug, meta.lender, meta.category, meta.product, day).run()
          .catch((e) => console.error("click count failed:", e))
      );
    }

    return redirect;
  },
};
