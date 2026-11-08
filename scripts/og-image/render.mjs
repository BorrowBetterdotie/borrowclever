// scripts/og-image/render.mjs
// Renders og-image.html (logo.svg + site colours) to /og-image.png at 1200×630.
// Not part of `npm run build` — run by hand after changing the design:
//   node scripts/og-image/render.mjs     (needs Playwright + Chromium)
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";

const src = new URL("./og-image.html", import.meta.url).href;
const out = fileURLToPath(new URL("../../og-image.png", import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.goto(src, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: out });
await browser.close();
console.log(`wrote ${out}`);
