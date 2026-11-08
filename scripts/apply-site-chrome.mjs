// scripts/apply-site-chrome.mjs
// Last step of `npm run build`: applies the shared nav, social-share meta and
// analytics beacon from scripts/lib/site-chrome.mjs to every published HTML
// page, so hand-maintained pages (index, loans, guides, news, …) can't drift
// from the generated ones.
//
// Skips docs/, node_modules/, build previews and redirect stubs (pages with a
// meta refresh, e.g. guides/credit-union-vs-bank-loans-ireland.html).
//
// Run:  node scripts/apply-site-chrome.mjs [--check]
//   --check  exit 1 if any page would change (no files written)

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { applySiteChrome } from "./lib/site-chrome.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SKIP_DIRS = new Set(["docs", "node_modules", "worker", "research", "rates", "scripts", ".git", ".github"]);
const SKIP_FILES = new Set(["table-preview.html"]);
const check = process.argv.includes("--check");

function* htmlFiles(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(name) && !name.startsWith(".")) yield* htmlFiles(full);
    } else if (name.endsWith(".html") && !SKIP_FILES.has(name)) {
      yield full;
    }
  }
}

let changed = 0, total = 0;
for (const file of htmlFiles(ROOT)) {
  const html = readFileSync(file, "utf8");
  if (/http-equiv="refresh"/i.test(html)) continue; // redirect stub
  const pagePath = "/" + relative(ROOT, file).split(sep).join("/");
  const out = applySiteChrome(html, pagePath);
  total++;
  if (out !== html) {
    changed++;
    if (check) console.log(`would change: ${pagePath}`);
    else writeFileSync(file, out);
  }
}
console.log(`site chrome: ${changed} of ${total} pages ${check ? "out of date" : "updated"}.`);
if (check && changed) process.exit(1);
