// worker/api-auth.js
// Auth + rate-limiting helpers for the /api/v1 and /admin routes.
// Keys are never stored in plaintext — only their SHA-256 hash.
// Pure functions only: no routing logic here (that lives in worker.js).

const KEY_PREFIX = "bc_live_";

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashApiKey(plaintextKey) {
  const data = new TextEncoder().encode(plaintextKey);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(digest);
}

export function generateApiKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const random = btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "").slice(0, 32);
  return { plaintext: KEY_PREFIX + random, keyPrefix: random.slice(0, 8) };
}

export function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

export function monthStartUTC() {
  return todayUTC().slice(0, 7) + "-01";
}

export function secondsUntilNextUTCMonth() {
  const now = new Date();
  const nextMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  return Math.ceil((nextMonth - now.getTime()) / 1000);
}

// Looks up a presented key. Returns { ok: true, keyHash, monthlyLimit } or
// { ok: false, status, body } ready to hand straight to Response.json().
export async function authenticateApiKey(request, env) {
  const auth = request.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(\S+)$/i);
  if (!match) {
    return {
      ok: false,
      status: 401,
      body: { error: { code: "unauthorized", message: "Missing API key. Send it as: Authorization: Bearer <key>" } },
    };
  }

  if (!/^bc_live_[A-Za-z0-9]{20,40}$/.test(match[1])) {
    return { ok: false, status: 401, body: { error: { code: "unauthorized", message: "Unknown API key." } } };
  }

  const keyHash = await hashApiKey(match[1]);
  const row = await env.DB.prepare(
    "SELECT key_hash, monthly_limit, status FROM api_keys WHERE key_hash = ?"
  ).bind(keyHash).first();

  if (!row) {
    return { ok: false, status: 401, body: { error: { code: "unauthorized", message: "Unknown API key." } } };
  }
  if (row.status === "revoked") {
    return { ok: false, status: 401, body: { error: { code: "revoked", message: "This API key has been revoked." } } };
  }

  return { ok: true, keyHash: row.key_hash, monthlyLimit: row.monthly_limit };
}

// Usage rows stay per-day (handy for spotting spikes); the limit is checked
// against the sum since the 1st of the current UTC month.
export async function getUsageThisMonth(env, keyHash) {
  const row = await env.DB.prepare(
    "SELECT COALESCE(SUM(count), 0) AS used FROM api_usage WHERE key_hash = ? AND day >= ?"
  ).bind(keyHash, monthStartUTC()).first();
  return row ? row.used : 0;
}

// Caller wraps this in ctx.waitUntil(...run()) — same fire-and-forget
// pattern as the existing `clicks` counter in worker.js.
export function usageIncrementStatement(env, keyHash) {
  return env.DB.prepare(
    "INSERT INTO api_usage (key_hash, day, count) VALUES (?, ?, 1) " +
    "ON CONFLICT(key_hash, day) DO UPDATE SET count = count + 1"
  ).bind(keyHash, todayUTC());
}
