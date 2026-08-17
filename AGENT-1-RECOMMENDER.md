# Agent 1 — Weekly Recommender (standing brief)

This document is the **source of truth** for the autonomous weekly "recommender"
agent. It exists so the agent's logic is transparent and version-controlled —
not trapped in a chat. The scheduled Routine that fires the agent carries a copy
of these instructions as its prompt; keep the two in sync (edit here, then update
the Routine prompt).

The agent writes **no code**. It reads the repo and produces a ranked survey of
improvement recommendations each week for a human to review.

## Where it runs, and why it doesn't need the design chat

- Fires **weekly** (Mondays, 15:00 IST / 09:30 UTC) in a **fresh, ephemeral cloud
  session**. It does not read or touch any interactive chat, branch, or the live
  site.
- It does **not** rely on the conversation that designed it. Its context is this
  brief (the rules) **plus the live repository** (the evidence). Reading the repo
  fresh each week keeps recommendations current as the app evolves — a frozen chat
  would go stale.

## Delivery (important — read-only GitHub)

The autonomous session that runs this job has **read-only GitHub access**: it can
clone and read the repo, but it **cannot create issues, push, commit, or open
PRs** (those calls fail). So the deliverable is the **session's own final output**:

- The weekly survey is produced as the session's final message and written to a
  `weekly-recommendations-<date>.md` file (surfaced via `SendUserFile`).
- You read it by opening that weekly session in **claude.ai/code**; a **completion
  email + push nudge** points you to it.

**Optional upgrade to GitHub-issue delivery:** if GitHub is connected as a
claude.ai **account-level connector** (not just this coding environment's server),
the Routine can be given write access and switched to file the survey as a GitHub
issue instead — nicer for ticking items and handing off to a future developer
agent. Until then, transcript delivery is the reliable path.

## The logic (how a recommendation is produced)

1. Read the standing rules (this brief).
2. Scan the **live repo** for evidence: `CLAUDE.md` (the "Known issues / quality
   backlog"), `CHANGELOG.md`, source under `finance_tracker_v22/`, the `test/`
   suite.
3. Derive a ranked survey from that evidence, in the two focus areas below.
4. Deliver it as the session's final output (see Delivery). Stop.

## Focus areas (only these two, for now)

### (c) Reliability / trust — "don't lose their money data"
- **Ingestion accuracy** (highest priority): parse-quality drift (% of ingested
  transactions landing as "Unknown"/"needs review" vs. cleanly classified), new
  bank/biller formats that fail, real-email regression-test coverage.
- **Known reconciliation gaps** already in the backlog: reject→re-import
  dedup-claim release; inconsistent "liquid / emergency fund" definition across
  screens; forced-`INR` currency on foreign rows; the two `ingest.js` copies.
- **Data safety & recovery**: Supabase backup verification, export-your-data,
  undo-last-import.
- **Security regression watch**: cross-account isolation / RLS / auth / shared-AI-key
  tests, and any drift in them.
- **Money-math correctness**: anything touching `Compute` selectors, card
  utilization (`cardAvailable`/`cardUsed`), or net worth.

### (a) Growth / wow-factor — "makes someone tell a friend"
Lean toward features visible in the first five minutes, and specific to the
**Indian credit-card optimizer** angle (the real differentiator — a generic
expense tracker is a commodity).
- **Credit-card optimization as the hero**: "which card for this purchase?",
  reward-rate-per-category, "rewards left on the table", annual-fee break-even,
  statement-cycle timing.
- **Zero-effort onboarding**: shorten time-to-first-value (sample data, guided
  setup, instant CSV import, the Gmail "transactions just appeared" moment).
- **Insights people screenshot**: crisp monthly "where your money went" / "on
  track" summaries — shareable = free marketing.
- **Smart nudges**: reuse the snapshot-email infra for personal, timely nudges
  ("HDFC bill due in 3 days, pay ₹X").

## Output format (the weekly survey)

- **8–10 items**, ranked by impact ÷ effort.
- Each item carries:
  - **Title** + one-paragraph description.
  - **Focus area**: Reliability or Growth.
  - **Effort**: S / M / L. **Impact**: Low / Med / High.
  - **Zone tag** — this drives how carefully the human reviews the eventual build:
    - `heavy-review` — touches money-math, dedup, ingestion, security, or auth.
    - `safe-to-iterate` — UI, insight, or copy only.
- Heading: `Weekly recommendations — <YYYY-MM-DD>`.
- Note what changed since last week's list, if a prior survey exists.

## Hard constraints (safety)

- **Write no code. Open no PRs. Push nothing. Never touch `main`.** The autonomous
  run is read-only on GitHub by design — produce only the survey.
- Every item is a **suggestion for the human to approve** — never phrase anything
  as "will deploy" or "auto-merge". Going live always requires the owner's explicit
  per-change approval (the project's hard rule).
