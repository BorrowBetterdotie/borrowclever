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
const FORBIDDEN_MARKUP = /<\s*(script|iframe|style|object|embed|link|meta)\b|\son\w+\s*=|javascript:/i;

export function checkGuardrails(bodyHtml) {
  if (RATE_PATTERN.test(bodyHtml)) {
    return {
      ok: false,
      reason: 'Draft contains a rate/percentage figure (e.g. "7.2%"), which is not allowed — only the rate-check pipeline is a source of truth for specific rates.',
    };
  }
  if (FORBIDDEN_MARKUP.test(bodyHtml)) {
    return {
      ok: false,
      reason: 'Draft contains disallowed markup (a forbidden tag, an inline event handler, or a javascript: URL) — bodyHtml must only use h2/h3/p/ul/li/a/strong/em.',
    };
  }
  return { ok: true };
}
