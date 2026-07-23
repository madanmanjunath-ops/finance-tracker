# Changelog

## v38 — Secure the AI proxy (per-user auth + rate limit)

- The `/api/claude` proxy no longer relies on a shared `APP_SECRET` that every
  browser held. Each AI request now carries the **logged-in user's Supabase
  session token** (`Authorization: Bearer`), which the function verifies against
  Supabase before calling Anthropic. Requests without a valid session get `401`.
- **Per-user daily rate cap** via a Postgres `increment_ai_usage` RPC + an
  `ai_usage` table (see `AI-PROXY-SECURITY.md` for the one-time SQL). Configurable
  with `AI_DAILY_LIMIT` (default 300). Over the cap returns `429`. The cap fails
  **open** on infra errors so a DB blip never blocks AI; auth fails **closed**.
- `ai.js` sends the session token (via new `Cloud.getAccessToken()`) instead of
  the shared secret; Settings → AI service drops the manual key box ("secured by
  your login") and keeps Test connection.
- `APP_SECRET` env var is now unused and can be removed after deploy.
- Cache-bust `v=38`; service-worker cache `ft-v38`.

## v37 — Sign in with Google (SSO)

- Added a **"Continue with Google"** button to the auth screen, wired to
  Supabase's native Google OAuth provider (`Cloud.signInWithGoogle`). Email +
  password sign-in is unchanged and still available.
- Requires one-time dashboard setup: a Google Cloud OAuth client (redirect URI
  = the Supabase auth callback) and enabling the Google provider in Supabase,
  plus the app URL(s) in Supabase's redirect allowlist. Basic scopes only
  (email/profile) — no restricted-scope security assessment needed.
- Cache-bust `v=37`; service-worker cache `ft-v37`.

## v36 — Card limits: stop phantom "Used" growth + email-verified available

### Root-cause fix (Used inflating on its own)
- Email parsers sometimes captured a card's **available balance** (the big
  number in an alert) as the transaction **amount**, booking a huge phantom
  expense that ballooned "Used". All three AI parsers (Gmail ingest, in-app
  single/bulk, statement-file) now get an explicit **amount rule**: `amount`
  is the value of THIS transaction only — never the available balance/limit,
  outstanding, statement total, or points.

### Available is now verified from emails
- Card transaction emails carry the remaining available credit. The Gmail
  ingest prompt now returns it as a dedicated `availableLimit` field, and the
  regex fallback matches many phrasings ("available limit/credit/balance",
  "Avl Bal", "avl lmt"). Every card email **re-anchors** that card's available
  to the bank's own figure (authoritative as of the email date). Used is then
  simply `Limit − Available`.

### Manual override in the card editor
- The card editor now has an **"Available now"** field (replacing the
  ignored "Outstanding" box). Enter your true available limit and Used is
  computed; saving writes an authoritative anchor as of today — which also
  clears any wrong accumulated history for that card.

### Stronger payee names
- The strong merchant/UPI-payee extraction (bank-name + generic-label
  guards, UPI `.../PAYEE` parsing, VPA fallback) is now shared via
  `FT.bestMerchant` and used by the in-app parsers too, not just Gmail ingest.

### Consistency
- Net worth now derives card debt from `Compute.cardUsed` (the single source
  of truth) instead of the stored balance, so it tracks spends correctly.
- Cache-bust bumped to `v=36`; service-worker cache `ft-v36`.

## v35.1 — Email parsing fixes (UPI payee, self-transfers)
- **UPI merchant capture fixed.** When the model returned a generic label
  ("Transaction") or a bank name instead of the payee, the real name was
  ignored. The payee parsed from the UPI string (e.g. `.../Mr RAJESH SINGH`
  → "Rajesh Singh") is now preferred; honorifics are dropped and ALL-CAPS
  names are de-shouted.
- **Available-limit parser hardened** so a card's last-4 sitting between
  "limit" and the amount isn't mistaken for the figure (now requires a Rs/₹).
- **Self-transfer double-count fixed.** The second leg of a self-transfer is
  now skipped even when the credit email itself reads as a transfer.
- **Gmail forwarder** now matches credit-limit emails by subject
  ("credit limit", "available limit", "limit increase/enhancement/update"),
  so limit notices forward even from unrecognised senders.
- **Number-verified state changes.** Re-anchoring a card's available limit and
  writing a statement due date now require the email to contain the card's
  last-4 (the actual number), not just its name — so a promotional email that
  names a card and quotes an "available limit" can no longer corrupt the real one.
- **UPI payee extractor hardened** so a trailing amount on the same line
  (e.g. "...SINGH Rs 125") can't bleed into the captured name.

## v35 — Cards: unified limit logic + advisor, points & opportunities

### Credit-limit logic (now a single source of truth)
- `Compute.cardAvailable` is the one engine for used/available. The card
  table, totals strip, alerts and best-card picker all read it, so they
  can no longer disagree.
- Spends reduce available; **payments now restore it** (a transfer into the
  card via `toAccount` frees the limit). The table reflects payments — it
  previously never did.
- An emailed/manually-reconciled available limit is treated as
  **authoritative for its date** (no same-day double-counting).

### Email pipeline
- Available-limit re-anchoring runs even when the email is not a
  transaction (pure statement / limit-summary emails now update the card).
- A credit-card **statement email writes the amount due and the real due
  date onto the card** (`stmtAmount` / `stmtDueDate`), not just the bills list.
- Emailed card-bill **payments are tagged to the card** so the limit frees up.
- More tolerant available-limit parsing ("Rs." / "INR" / commas).

### Cards view
- New **totals strip**: total limit, available, utilization, reward points.
- New **AI advisor**: ask in plain words ("which card for a ₹95k flight?");
  also keeps an offline category quick-pick.
- New **points & opportunities** section: balances, ₹ value, transfer
  partners, and state-derived nudges (due soon, near limit, idle points, setup).
- Card table columns: Used, **Available** (new), Limit, Statement,
  **Due date** (prefers the statement date), Due in, Float.

### Editing
- Card editor now exposes **points balance, value per point, statement
  amount due, statement due date, and transfer partners** — all editable.

### Ops
- Cache-bust bumped to `v=35`; service-worker cache `ft-v35`.
