# Content-agent Stage 2 (LLM drafting) — Design Spec

**Date:** 2026-09-07
**Status:** Draft, pending user review
**Author:** Claude (with Luke Watters)

## 1. Overview

Stage 2 of the content-agent pipeline. Stage 1 (`scripts/content-agent/fetch-news.js`, already merged) fetches and filters Irish financial RSS news into `scripts/content-agent/data/news-items.json`. Stage 2 takes that file, asks the Claude API to draft a single roundup-style article synthesizing the relevant items, renders it into a publish-ready HTML page matching the site's existing content conventions, and opens a PR for human review. Nothing in this pipeline auto-publishes — the PR is the review gate, same as `rate-check.yml`'s pattern.

## 2. Goals

- One drafted article per workflow run, synthesizing whatever relevant items stage 1 found (not one article per item).
- Output is a real, publish-ready `news/*.html` page using the site's existing head/nav/footer boilerplate — never hand-authored by the LLM, only filled in with LLM-supplied content.
- Hard guardrails against the two failure modes that matter most for a financial site: fabricated/stale rate figures, and editorializing about a named lender's stability.
- Runs in the same CI job as stage 1 (required — `news-items.json` is gitignored and only exists on that runner's local disk for the job's lifetime).
- Testable locally without spending API credits on every iteration.

## 3. Non-goals (this stage)

- No auto-publish, no auto-merge, no nav/index wiring — a human decides if/when a draft goes live and how it's linked from the site.
- No per-item articles, no article backlog/queue across runs — if a run has 0 relevant items, it produces no draft and no PR.
- No image generation, no social-card assets.
- No retry/backoff logic for the Claude API call — a transient failure fails the job (visible in Actions), matching stage 1's philosophy of failing loudly rather than silently degrading.
- No self-serve tuning of the prompt via config file — the prompt lives in the script, same as `KEYWORDS` in stage 1.

## 4. Architecture

```
scripts/content-agent/data/news-items.json   (written by stage 1, same job)
        │
        ▼
scripts/content-agent/draft-article.js
  1. Read news-items.json.
     - Missing or { count: 0 } → log "nothing to draft", exit 0. No API call, no PR.
  2. Call the Claude API (see §5) with all items, forcing a structured tool-call
     response: { title, slug, metaDescription, bodyHtml }.
  3. Run the regex safety-net check on bodyHtml (see §6). Fail the job (exit 1)
     if it trips — better a failed CI run than a bad draft slipping into a PR.
  4. Render via scripts/content-agent/article-template.js into
     news/<YYYY-MM-DD>-<slug>.html
        │
        ▼
Same job, appended to content-agent.yml's existing steps:
  git checkout -b automated/content-<timestamp>
  git add news/
  git commit
  git push
  gh pr create --base main
```

### New files
- `scripts/content-agent/draft-article.js` — stage 2 script, ESM, same conventions as `fetch-news.js` (CLI flags, `--dry-run`, clean `process.exit`)
- `scripts/content-agent/article-template.js` — exports one function, `renderArticle({ title, metaDescription, bodyHtml, dateIso, slug }) → htmlString`. Owns 100% of the boilerplate (meta tags, JSONLD `Article` block matching `guides/*.html`'s pattern, nav, footer). The LLM never sees or produces this.
- `news/` — new top-level directory, sibling to `guides/`. First file will be something like `news/2026-09-08-ecb-rate-watch-and-ptsb-takeover.html`.

### Dependency
`@anthropic-ai/sdk` (official Node SDK), added the same way `rss-parser` was added in stage 1 — `npm install`, committed `package.json`/`package-lock.json` diff.

## 5. Claude API call

- **Model:** `claude-sonnet-5`
- **Call shape:** single, non-streaming `messages.create`, with a forced tool call (`tool_choice: { type: "tool", name: "submit_draft" }`) rather than asking for free-text JSON — removes an entire class of "the model wrapped it in prose" parsing failures.
- **Tool schema:**
  ```json
  {
    "name": "submit_draft",
    "input_schema": {
      "type": "object",
      "required": ["title", "slug", "metaDescription", "bodyHtml"],
      "properties": {
        "title": { "type": "string" },
        "slug": { "type": "string", "description": "kebab-case, no date prefix, e.g. ecb-rate-watch-and-ptsb-takeover" },
        "metaDescription": { "type": "string", "description": "150-160 chars, for <meta name=description> and og:description" },
        "bodyHtml": { "type": "string", "description": "Semantic HTML fragment: h2/h3, p, ul/li, a, strong/em only. No head/nav/full-page markup." }
      }
    }
  }
  ```
- **System prompt** carries:
  - Site voice: independent, factual, no bias — matching `how-we-make-money.html`'s framing.
  - **Guardrail 1:** never state a specific interest rate, APR, or fee figure — those are only accurate as of the rate-check pipeline's last run, not this draft's. Refer to rate movements qualitatively ("the ECB is expected to raise rates") if the source items mention numbers.
  - **Guardrail 2:** never assess a named lender's financial stability, safety, or creditworthiness — report what the source item said, don't editorialize about the institution.
  - **Guardrail 3:** body must end with a not-financial-advice disclaimer paragraph, in the style of the disclaimer blocks already on `loans.html`/`cards.html`.
  - Must synthesize across all provided items into one coherent piece (not a bulleted list of unrelated blurbs), and should link out to original source articles (the `link` field) as citations where natural.
- **User message:** the full `news-items.json` items array, serialized as JSON.
- **max_tokens:** 2048 (a roundup piece, not a long-form guide).

## 6. Guardrail safety-net (defense in depth)

Prompt instructions are not a guarantee. After getting `bodyHtml` back, `draft-article.js` runs one regex check before rendering:

```js
const RATE_PATTERN = /\d+(\.\d+)?\s*%/;
if (RATE_PATTERN.test(bodyHtml)) {
  console.error('Draft rejected: contains a rate/percentage figure.');
  process.exit(1);
}
```

If this trips, the job fails loudly (no PR opened) rather than silently stripping the offending text and publishing something the LLM didn't actually write. A human re-runs or adjusts the prompt.

## 7. Workflow changes (`content-agent.yml`)

- Add `permissions: contents: write` / `pull-requests: write` at the workflow level (absent today since stage 1 needed neither — mirrors `rate-check.yml`).
- Replace the stage-2 TODO comment with real steps, appended after the existing `Fetch news (stage 1)` and `Show fetched items` steps, in the same `fetch-news` job:
  ```yaml
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
- `draft-article.js` exiting 0 with no file written (the "nothing to draft" or dry-run case) means `git diff --staged --quiet` is true, so no branch/PR gets created — same "no-op is silent success" pattern `rate-check.yml` already uses.

## 8. Secret

`ANTHROPIC_API_KEY` must be added under **Settings → Secrets and variables → Actions** before this stage can run in CI. This is not something Claude Code can do — it requires you to add it directly in GitHub. I'll flag this again at implementation time and the workflow will simply fail clearly on the API call if it's missing (no silent fallback).

## 9. Local testing without API cost

`draft-article.js --dry-run` skips the real API call and substitutes a fixed placeholder `{ title, slug, metaDescription, bodyHtml }`, so the template-rendering, filename, and git/PR plumbing can all be verified locally without a real key or spending credits. A real local run (no `--dry-run`) still needs `ANTHROPIC_API_KEY` set in your shell — that's on you to supply when you want to test the actual drafting quality.

## 10. Error handling summary

| Condition | Behavior |
|---|---|
| `news-items.json` missing or 0 items | Log, exit 0, no API call, no PR |
| Claude API error (network, auth, rate limit) | Exit 1, job fails visibly |
| Tool-call response missing a required field | Exit 1, job fails visibly |
| `bodyHtml` trips the rate-figure regex | Exit 1, job fails visibly, no file written |
| Everything succeeds | File written, committed to a fresh `automated/content-*` branch, PR opened |

## 11. Open questions (deliberately deferred, not blocking)

- Whether `news/` articles ever get linked from the site nav/index — left for a human decision once a few real drafts have been reviewed.
- Whether to tune `KEYWORDS`/stage 1 further based on stage 2 draft quality — feedback loop, not a stage 2 blocker.
