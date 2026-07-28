# Changelog

## v52 — Fix the REAL "Unknown" cause: whitespace-bloat truncation

The actual root cause behind the recurring "Unknown" payees (Lakshman, Chetana…):
HTML bank emails flatten to plain text as **hundreds of blank, deeply-indented
lines**, pushing the real transaction details (payee / UPI reference) **past the
truncation limits** — the Gmail script sends `slice(0, 4000)` and the parser
reads `slice(0, 2500)`. The amount squeaked in; the payee was cut off before any
regex or model (cheap or strong) ever saw it. The earlier regex fixes never had
a chance because the text never reached them.

- **`gmail-apps-script.gs` (the essential fix):** collapse the body's whitespace
  runs and blank lines **before** the length cap, so the content survives.
  **Users must re-paste the updated script.**
- **`ingest.js` (defense-in-depth):** `normalizeText()` collapses whitespace on
  the received text before any parsing/slicing, so a bloated body can't hide the
  payee server-side either.
- Regression test reproduces a ~4,800-char whitespace-bloated body and proves the
  payee lands back within the parse window. Server change: no cache bump.

## v51 — Format-independent payee recovery (stop "Unknown" whack-a-mole)

- The strong-model safety net for a weak/"Unknown" merchant previously only
  fired when the email matched a hard-coded keyword list (upi/vpa/paid to/…) — so
  a bank narration format we hadn't anticipated (NEFT, IMPS, "transfer to X",
  etc.) still slipped through to "Unknown."
- **Fix:** ingest now escalates to the stronger model for **any** transaction
  where the amount parsed but the merchant is still "Unknown" and the
  deterministic UPI/VPA extractors found no name — regardless of narration
  format. If the email genuinely has no payee, the strong model also returns
  Unknown and we fall through unchanged; the only cost is one extra call on a
  real miss. Server-only change (`ingest.js`, both copies); no cache bump.

## v50 — Fix "Unknown" payee on UPI transactions (wrapped-name bug)

- **Root cause:** in plain-text bank emails the payee name often **wraps onto the
  line after** the `UPI/<type>/<ref>/` reference. `extractUpiPayee` required the
  name immediately after the final slash, so a wrapped name (e.g. `LAKSHMAN J`)
  returned null — and the model's placeholder "Unknown" survived. Reproduced and
  fixed.
- **Fix:** the UPI extractor now allows whitespace/line-breaks after the final
  slash and broadens the type/ref patterns, so the payee is recovered whether it
  sits on the same line or the next. (Deterministic — works for any bank's UPI
  format.)
- **Safety net:** when the amount is fine but the merchant is still weak
  ("Unknown") and the deterministic extractors can't find a payee **but the email
  clearly references one**, ingest now escalates that single email to the
  stronger model to recover the name — instead of showing "Unknown".
- Regression tests added (`test/parser.test.js`), including the exact ₹100
  Lakshman case and wrapped/CRLF variants. Server-only change (`ingest.js`, both
  copies); no cache bump.

## v49 — Loans: add / edit / delete from the Loans tab

- **Bug:** loans captured during onboarding (`state.loans`) had no editor. The
  Loans tab only showed debt KPIs and pointed to the Accounts tab — which edits
  `state.accounts`, a different list — so loans were effectively read-only.
- **Fix:** the Loans tab now has an editable **loan list** and a **Add loan**
  button, plus a `LoanModal` (name, type, outstanding, rate, monthly EMI, EMI
  day, currency) for adding, editing, and deleting — wired to the existing
  `addLoan` / `updateLoan` / `deleteLoan` actions.
- Because net worth, the debt KPIs, the payoff plan, and the AI contexts all
  read `state.loans` through selectors, any change here **updates those areas
  automatically** (and syncs to the cloud + daily email).
- Cache-bust `v=49`; service-worker cache `ft-v49` (Loans view changed).

## v48 — Legal pages (Privacy, Terms, disclaimer)

- New `privacy.html` and `terms.html` — self-contained, theme-aware static pages
  written to match how the app actually handles data (Supabase + RLS storage,
  Anthropic for AI, Google SSO, the optional Gmail forwarder, Resend email).
- Terms includes a prominent **"Not financial advice"** disclaimer covering AI
  output and imported-transaction accuracy.
- The auth screen now shows a consent line linking both pages ("By creating an
  account, you agree to…") plus a short "informational tool — not financial
  advice" note.
- **Templates:** a few bracketed fields (`[YOUR NAME OR ENTITY]`, `[CONTACT
  EMAIL]`, `[CITY, COUNTRY]`, `[COUNTRY / STATE]`) must be filled in, and a
  lawyer should review before onboarding real users.
- Cache-bust `v=48`; service-worker cache `ft-v48` (auth screen changed).

## v47 — Ingestion redesign Phase 3b: de-duplicate the ledger view

- The transaction list is now **de-duplicated on load** using the exact same
  dedup key as the server (`FT.dedupKey`, mirrored from
  `netlify/functions/lib/dedup.js`). Historical duplicates already in the ledger
  — like the Swiggy/Instamart pairs — disappear from view, and the on-screen
  numbers finally match the de-duplicated `transactions` table.
- Deliberately chosen over "read transactions from the table" for now: reading
  from the table before manual writes also move there (a later phase) would make
  in-app edits/deletes show ghosts. This client-side collapse achieves the
  visible goal with zero edit/delete risk.
- A unit test cross-checks that the browser and server dedup keys are identical,
  so the two copies can't silently drift.
- Cache-bust `v=47`; service-worker cache `ft-v47` (store.js changed).

## v46 — Ingestion redesign Phase 3a: transactions backfill

- New secret-protected endpoint `/api/backfill-transactions?key=<EMAIL_TEST_SECRET>`
  that copies each user's existing blob transactions into the `transactions`
  table, computing the **same `dedup_key`** the live ingest path uses. Idempotent
  (`insert … on conflict do nothing`), safe to re-run.
- Changes nothing in the app — it only populates the table so the DB dedup also
  knows about history (and closes the "re-forward of an old email" gap). The
  Review inbox stays in the blob for now.
- Returns a JSON summary: users processed, blob transaction count, rows inserted,
  and how many were skipped as duplicates (pre-existing blob duplicates collapse
  to one row).
- Server-only change (new function + a `netlify.toml` redirect); no cache bump.

## v45 — Ingestion redesign Phase 2: schema-enforced AI extraction

The Gmail parser no longer asks the model for freeform JSON and hopes it parses.
It now uses **forced tool-use with a strict schema**, so every extraction is
well-formed and typed — eliminating the malformed-output failure mode.

- `parseEmail` calls a `record_email` tool whose `input_schema` defines every
  field (kind, type, amount, currency, merchant, account, date, category,
  availableLimit, dueDate, **bank_ref**, confidence) with `tool_choice` forcing
  it. The result is the tool's validated input, not scraped text.
- Adds a dedicated **`bank_ref`** field (UPI RRN / UTR / txn id). It's stored on
  the transaction (preferred over the regex fallback) for the upcoming
  reference-based exact-match dedup layer.
- The escalate-on-miss path uses the same schema on the stronger model.
- Behaviour for the rest of the handler is unchanged (same field names), so
  card/available-limit anchoring, bills, transfers and dedup all keep working.
- Server-only change (`ingest.js`, both copies); no cache bump.

## v44 — Ingestion redesign Phase 1: database-enforced dedup

The Gmail ingest function now claims each transaction's identity in the new
`transactions` table before booking it. A duplicate is rejected by the
**database** (`unique (user_id, dedup_key)`), not by app-code heuristics — so a
duplicate can't reach the ledger no matter how the two emails are worded.

- On the main booking path, ingest computes the synthetic `dedup_key` (date +
  direction + amount + normalized merchant) and does an
  `insert … on conflict do nothing`. Key already present → returns
  `duplicate_db`, nothing booked. New → books as before.
- **Fails open:** if the table is unreachable, it books anyway (the legacy
  heuristics still ran), so a DB hiccup can never lose a real transaction.
- Records every outcome in `ingestion_events` (best-effort audit log).
- The bank reference (UPI RRN / UTR) is extracted and stored now, for a future
  exact-match dedup layer (Phase 2).
- Requires the one-time SQL in `INGESTION-DB-SETUP.md`. Server-only change
  (`ingest.js` + `lib/dedup.js`); no cache bump.
- Not yet covered: backfilling pre-existing transactions into the table (so a
  re-forward of an *old* email is caught) — a small follow-up.

## v43 — Dedupe Swiggy/Instamart orders split across two emails

- **Gap in the v41 fix:** a single ₹775 Swiggy Instamart order still double-booked
  because the two emails were categorised differently — "Instamart" as Groceries
  and "Swiggy" as Food & Dining — so the sub-₹1000 same-category dedupe didn't
  match.
- **Fix:** the fuzzy duplicate guard now also merges a same-day, same-type,
  same-amount pair when the two merchants belong to the same **brand family**
  (Swiggy owns Instamart, Zomato owns Blinkit) — the merchants that routinely
  send one order as two differently-labelled emails. The large-amount (≥ ₹1000)
  and same-category paths still apply; two unrelated merchants of the same small
  amount are still left as separate transactions.
- Server-only change (`ingest.js`, both copies); regression tests in
  `test/parser.test.js`. No cache bump.

## v42 — Ingest: escalate-on-miss + correct account on recovered stubs

Follow-up to v41. When the cheap parser misreads an email, the recovered entry
was low-quality: a generic "needs review" payee and the wrong account (defaulted
to the first account). Both fixed.

- **Escalate-on-miss.** When the cheap model returns no amount but the email
  clearly states one (a figure next to a debit/credit/spent verb), ingest now
  re-parses that **one** email on the stronger model (`CLAUDE_MODEL`) to recover
  the full details — payee, account, category — not just a bare amount. It fires
  only on a real miss, so the v39 cost savings are preserved.
- **Correct account on stubs.** Both review stubs (AI-missed and unparsed) now
  match the account/card by the **last-4 in the email** (`A/c XX3774` → the Axis
  account ending 3774) instead of defaulting to the first account. Requires the
  account/card to have its last-4 saved in the app.
- Server-only change (`ingest.js`, both copies); regression tests in
  `test/parser.test.js`. No cache bump.

## v41 — Ingest reliability: stop double-bookings and silent drops

Two Gmail-ingest fixes, both server-only (`ingest.js`, both copies) with
regression tests in `test/parser.test.js`. No cache bump.

### Duplicate transactions from one order's two emails
- **Root cause:** a single purchase often generates two Gmail emails with
  different merchant text (e.g. a ₹543 Swiggy Instamart order arriving as both
  an "Instamart" receipt and a "Swiggy" card alert). The exact-merchant dedupe
  couldn't match them, and the fuzzy dedupe only ran for amounts **≥ ₹1000** —
  so sub-₹1000 orders got booked twice, on different accounts.
- **Fix:** the fuzzy duplicate guard (`isFuzzyDup`) now also catches payments
  under ₹1000 when a strong extra signal agrees — the **same category** — while
  still merging any same-day, same-amount pair ≥ ₹1000. Two genuinely different
  same-day buys of different categories are left alone.

### Real transactions silently dropped when the AI misreads them
- **Root cause:** when the parser returned no amount (e.g. the cheaper model
  misclassifying a promo-heavy debit alert as "not a transaction"), the email
  was marked handled and **dropped with no trace** — not in the ledger, not in
  Review.
- **Fix:** a deterministic amount fallback (`txnAmountFromText`) now recovers the
  figure stated next to a debit/credit/spent verb (ignoring available-limit /
  balance numbers), and anything that looks like a real transaction is routed to
  the **Review inbox** as a stub the user can confirm or fix — never dropped.

## v40 — Automated tests + security hardening

### Security hardening
- **Ingest token is now CSPRNG-generated.** The Gmail webhook token authorizes
  writing transactions into a user's account; it was built from `Math.random()`
  (predictable, low entropy). It now comes from the platform crypto RNG
  (`FT.ingestToken()`, ~256-bit). **Existing users should regenerate their token**
  (Settings → Gmail import) to get a strong one.
- **Ingest user-lookup hardened.** The token→user PostgREST filter was extracted
  to a single `tokenFilter()` helper (still `encodeURIComponent`-guarded) with a
  regression test proving a crafted token can't break out to match another row.

### Automated tests (first suite)
- New **zero-dependency test suite** at the repo root (`test/`), run with
  `npm test` (Node's built-in runner — no build step). 24 unit tests covering
  the money math (currency conversion, the card used/available engine, net
  worth — including a **regression test for the "phantom Used" bug**), the Gmail
  parser's deterministic helpers, and ingest-token/injection security.
- New **live security test** (`test/integration/security-live.mjs`) that verifies
  cross-account isolation (RLS), unauthenticated reads, and password login
  against your real Supabase project.
- Full findings written up in **`SECURITY-REVIEW.md`** (no cross-account leak
  found; the shared AI key does not leak data between accounts).
- None of this ships to the site — the `test/` folder lives outside Netlify's
  base directory.
- Cache-bust `v=40`; service-worker cache `ft-v40` (store.js/app.jsx changed).

## v39 — AI cost cut (cheap model for parsing, strong model for reasoning)

- The `/api/claude` proxy now supports **two model tiers**. High-volume
  parsing/extraction runs on the cheap model (`claude-haiku-4-5`, ~$1/$5 per 1M);
  reasoning features (coach, plans, critique, chat, card advisor) stay on the
  stronger default (`claude-sonnet-5`). A request opts into the cheap tier with
  `tier:"fast"` in the body; anything else uses the default.
- **Fixed the stale model default.** All server functions previously defaulted
  `CLAUDE_MODEL` to `"claude-sonnet-4-6"`, which could fail if unset in Netlify.
  Defaults are now current: `CLAUDE_MODEL` → `claude-sonnet-5`,
  `CLAUDE_MODEL_FAST` → `claude-haiku-4-5`. Both remain overridable via Netlify
  env vars (new: `CLAUDE_MODEL_FAST`).
- **Fast tier** wired to: Gmail ingest (`ingest.js`, both copies), daily-email
  tip, in-app single/bulk email parse, statement-file import, description
  cleanup (rename), card rewards auto-fill, and the Settings test call.
- **Default (reasoning) tier** kept for: financial coach/critic, chat, insights,
  investment advice, and the card "best card for this spend" advisor.
- `ai.js` `complete(prompt, opts)` now forwards `opts.tier`; the proxy health
  check (GET) reports both `model` and `modelFast`.
- Cache-bust `v=39`; service-worker cache `ft-v39`.

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
