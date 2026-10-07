// scripts/lib/ccpc.mjs
// Shared client for the CCPC (Competition and Consumer Protection Commission)
// comparison tool backend at compare.ccpc.ie. Used by check-rates-ccpc.mjs
// (loan cross-check) and check-rates.mjs (fallback for lender pages that block
// automated requests — AIB and PTSB sit behind Akamai bot protection, Revolut
// behind a Cloudflare challenge).
//
// These are CCPC's own internal endpoints, NOT a published or supported API —
// see docs/ccpc-endpoint-notes.md before treating failures as urgent.
//
// Each fetch returns { ok: true, data } or
// { ok: false, runStatus: "UNREACHABLE" | "CCPC_SCHEMA_CHANGED_OR_UNAVAILABLE", detail }.

const USER_AGENT = "BorrowClever-CrossCheck/1.0 (+https://borrowclever.ie)";
const FETCH_TIMEOUT_MS = 8000;

export const CCPC_LOANS_URL = "https://compare.ccpc.ie/loan/get-loans";
export const CCPC_CARDS_URL = "https://compare.ccpc.ie/credit-card/get-credit-cards";

// Matches the site's own published methodology (see loans.html): all figures
// are quoted on €10,000 borrowed over 60 months (5 years). CCPC's `Amount`
// tiers rates for several lenders (confirmed in docs/ccpc-endpoint-notes.md),
// so this must match exactly, not just be "a reasonable loan size".
export const CCPC_AMOUNT = 10000;
export const CCPC_TERM_YEARS = 5;
const CCPC_LOAN_TYPE_ID = 5; // personal loans — confirmed by content in docs/ccpc-endpoint-notes.md
const CCPC_CARD_TYPE_ID = 3; // credit cards (4 = student cards, not tracked)

async function postJsonArray(url, body) {
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    const reason = e && e.name === "TimeoutError" ? "timeout" : (e && e.message) || String(e);
    return { ok: false, runStatus: "UNREACHABLE", detail: reason };
  }

  if (!res.ok) {
    return { ok: false, runStatus: "UNREACHABLE", detail: `HTTP ${res.status}` };
  }

  // A wrong/moved endpoint returns HTTP 200 with the Angular app's HTML
  // shell, not JSON — confirmed in docs/ccpc-endpoint-notes.md. Status alone
  // is not enough to trust the response.
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return { ok: false, runStatus: "CCPC_SCHEMA_CHANGED_OR_UNAVAILABLE", detail: `unexpected content-type: ${contentType || "(none)"}` };
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    return { ok: false, runStatus: "CCPC_SCHEMA_CHANGED_OR_UNAVAILABLE", detail: "response was not valid JSON" };
  }

  if (!Array.isArray(data)) {
    return { ok: false, runStatus: "CCPC_SCHEMA_CHANGED_OR_UNAVAILABLE", detail: "response was not a JSON array" };
  }
  if (data.length === 0) {
    return { ok: false, runStatus: "CCPC_SCHEMA_CHANGED_OR_UNAVAILABLE", detail: `response array was empty — expected products at TypeId ${body.TypeId}` };
  }
  return { ok: true, data };
}

export async function fetchCcpcLoans() {
  const result = await postJsonArray(CCPC_LOANS_URL, { Amount: CCPC_AMOUNT, Term: CCPC_TERM_YEARS, TypeId: CCPC_LOAN_TYPE_ID });
  if (!result.ok) return result;
  const missing = result.data.filter(
    (item) => typeof item.ProviderName !== "string" || typeof item.ProductName !== "string" || typeof item.Rate !== "number"
  );
  if (missing.length > 0) {
    return { ok: false, runStatus: "CCPC_SCHEMA_CHANGED_OR_UNAVAILABLE", detail: `${missing.length} of ${result.data.length} entries missing expected fields (ProviderName/ProductName/Rate) — CCPC's response shape may have changed, see docs/ccpc-endpoint-notes.md` };
  }
  return result;
}

// Card entries carry their figures as numeric-keyed attribute objects
// ({ Name: "APR:", Value: "22.9" }), not top-level fields — the keys are
// CCPC-internal ids, so attributes are looked up by Name.
export function ccpcAttr(item, name) {
  for (const v of Object.values(item)) {
    if (v && typeof v === "object" && v.Name === name) return v.Value;
  }
  return undefined;
}

export async function fetchCcpcCards() {
  const result = await postJsonArray(CCPC_CARDS_URL, { TypeId: CCPC_CARD_TYPE_ID });
  if (!result.ok) return result;
  const missing = result.data.filter(
    (item) => typeof item.ProviderName !== "string" || typeof item.ProductName !== "string" || !/^\d+(\.\d+)?$/.test(String(ccpcAttr(item, "APR:") ?? ""))
  );
  if (missing.length > 0) {
    return { ok: false, runStatus: "CCPC_SCHEMA_CHANGED_OR_UNAVAILABLE", detail: `${missing.length} of ${result.data.length} card entries missing ProviderName/ProductName/"APR:" — CCPC's response shape may have changed, see docs/ccpc-endpoint-notes.md` };
  }
  return result;
}
