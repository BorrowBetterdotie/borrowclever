#!/usr/bin/env node
// scripts/issue-api-key.mjs — issue or upgrade a BorrowClever API key.
//
// Issue a key (calls POST /admin/keys on the live Worker):
//   ADMIN_TOKEN=... node scripts/issue-api-key.mjs dev@example.com
//   ADMIN_TOKEN=... node scripts/issue-api-key.mjs dev@example.com --tier paid
//   ADMIN_TOKEN=... node scripts/issue-api-key.mjs dev@example.com --tier enterprise --limit 250000
//
// Upgrade an existing key by its prefix (the 8 chars after "bc_live_"), once paid:
//   node scripts/issue-api-key.mjs --upgrade AbCd1234 --tier paid
//   node scripts/issue-api-key.mjs --upgrade AbCd1234 --tier enterprise --limit 250000
//
// The plaintext key is shown once and never stored, so copy it into the reply.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const API_BASE = process.env.API_BASE || "https://borrowclever.ie";
const DB_NAME = "borrowclever-clicks";
// Which D1 copy --upgrade writes to. Override for testing, e.g. D1_TARGET="--local".
const D1_TARGET = (process.env.D1_TARGET || "--remote").split(" ");
const TIER_LIMITS = { free: 100, paid: 10000 };

function usage(msg) {
  if (msg) console.error(`Error: ${msg}\n`);
  console.error("Usage:\n  node scripts/issue-api-key.mjs <email> [--tier free|paid|enterprise] [--limit N]\n  node scripts/issue-api-key.mjs --upgrade <key_prefix> --tier paid|enterprise [--limit N]");
  process.exit(1);
}

function parseArgs(argv) {
  const args = { tier: "free" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--tier") args.tier = argv[++i];
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--upgrade") args.upgrade = argv[++i];
    else if (a.startsWith("--")) usage(`unknown option ${a}`);
    else args.email = a;
  }
  if (!["free", "paid", "enterprise"].includes(args.tier)) usage(`unknown tier "${args.tier}"`);
  if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit <= 0)) usage("--limit must be a positive integer");
  if (args.tier === "enterprise" && args.limit === undefined) usage("enterprise keys need --limit (requests per month)");
  return args;
}

function replyTemplate(key, tier, limit) {
  const terms = tier === "free"
    ? `Free tier: ${limit} requests per calendar month (UTC), for non-commercial use only. If you want to use the data in a commercial product, reply and we'll move you to the Paid plan (€29/month).`
    : `${tier === "paid" ? "Paid" : "Enterprise"} plan: ${limit.toLocaleString("en-IE")} requests per calendar month (UTC).`;
  return `Hi,

Thanks for your interest in the BorrowClever API. Here's your key:

  ${key}

Send it as a header on every request:

  Authorization: Bearer ${key}

${terms}

Docs: https://borrowclever.ie/api-docs.html

Please keep the key private. If it leaks, reply and we'll revoke it and issue a new one.

Thanks,
BorrowClever`;
}

async function issue({ email, tier, limit }) {
  if (!email) usage("email is required");
  const token = process.env.ADMIN_TOKEN;
  if (!token) usage("set ADMIN_TOKEN in the environment (same value as the Worker secret)");

  const body = { email, tier };
  if (limit !== undefined) body.monthly_limit = limit;

  const res = await fetch(`${API_BASE}/admin/keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Admin-Token": token },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`Issue failed (${res.status}): ${text}`);
    process.exit(1);
  }
  const out = JSON.parse(text);
  console.log(`Issued ${out.tier} key for ${email} (prefix ${out.key_prefix}, ${out.monthly_limit}/month).\n`);
  console.log("----- reply to send -----\n");
  console.log(replyTemplate(out.key, out.tier, out.monthly_limit));
}

function upgrade({ upgrade: prefix, tier, limit }) {
  if (!/^[A-Za-z0-9]{8}$/.test(prefix || "")) usage("--upgrade needs the 8-character key prefix");
  if (tier === "free") usage("--upgrade needs --tier paid or --tier enterprise");
  const monthlyLimit = limit ?? TIER_LIMITS[tier];

  // Values are validated above (prefix is alphanumeric, limit is an integer, tier is from a fixed list),
  // so interpolating them into the SQL is safe.
  const sql = `UPDATE api_keys SET tier = '${tier}', monthly_limit = ${monthlyLimit} WHERE key_prefix = '${prefix}'; ` +
    `SELECT key_prefix, email, tier, monthly_limit, status FROM api_keys WHERE key_prefix = '${prefix}';`;
  const workerDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "worker");
  let results;
  try {
    const out = execFileSync("npx", ["wrangler", "d1", "execute", DB_NAME, ...D1_TARGET, "--json", "--command", sql], {
      cwd: workerDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    results = JSON.parse(out);
  } catch (e) {
    console.error(`Upgrade failed: ${(e.stdout || e.message).trim()}`);
    process.exit(1);
  }
  const row = results[1]?.results?.[0];
  if (!row) {
    console.error(`No key found with prefix ${prefix}.`);
    process.exit(1);
  }
  console.log("Upgraded:", row);
}

const args = parseArgs(process.argv.slice(2));
if (args.upgrade) upgrade(args);
else await issue(args);
