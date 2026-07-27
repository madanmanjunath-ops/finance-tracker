# Ingestion redesign — a bank-agnostic, AI-driven model

**Goal:** one ingestion pipeline that works for **any user, any bank, any email
format**, reads and classifies each email accurately, books the correct
transaction, and makes **duplicates structurally impossible** — not patched
away with per-merchant heuristics.

This document is a design proposal for review. Nothing here is built yet. The
migration plan (§9) is deliberately staged so it's safe to roll out on the live
app.

---

## 1. Why the current model keeps breaking

Every recent bug (phantom "Used", silent drops, two flavours of duplicate,
wrong account) has the same three root causes:

1. **Loose extraction.** The parser asks the model for freeform JSON and leans
   on a `{"amount":0}` convention for "not a transaction". A single misread
   silently loses a real transaction, and we can't tell *why* after the fact.
2. **Heuristic dedup in app code.** We decide "is this a duplicate?" by
   comparing date + amount + merchant/category guesses. Every bank formats
   these differently, so we keep discovering new gaps (₹543 same-category, then
   ₹775 cross-category Swiggy/Instamart…). App-code checks can also be **raced**
   by two emails arriving together.
3. **One JSON blob per user.** All state is a single `app_state.data` row
   overwritten last-write-wins. There's no database-level guard against
   duplicates, no query surface, and concurrent writes can clobber each other.

None of these scale to hundreds of users on dozens of banks.

## 2. Design principles

- **The AI classifies; code never guesses the bank's format.** Bank-specific
  logic becomes *data* (normalization maps), never branches in code.
- **Use the transaction's own identity for dedup**, not a fingerprint we invent.
- **The database enforces uniqueness**, so duplicates can't exist even under
  retries, races, or multiple email sources.
- **Never drop silently.** Every email ends in a *visible, logged* outcome.
- **Cheap by default, smart on demand.** Cheap model first; escalate only when
  confidence is low.

## 3. The pipeline

```
 Gmail (any bank)
   │  forward (broad — let the server classify, not the mail filter)
   ▼
 /api/ingest
   1. Idempotency gate     — seen this exact email before? → no-op
   2. Cheap pre-filter     — regex "could this be financial?" → drop obvious noise free
   3. AI extract+classify  — strict schema, cheap model, returns confidence + bank_ref
   4. Escalate if unsure   — low confidence → re-run on the strong model
   5. Derive dedup_key     — bank_ref if present, else a normalized synthetic key
   6. Upsert transaction   — INSERT ... ON CONFLICT (user_id, dedup_key) DO NOTHING/ENRICH
   7. Route by confidence  — auto-book | Review inbox | non-transaction (logged)
   8. Log the outcome      — ingestion_events row, always
```

## 4. The three pillars

### Pillar A — Structured AI extraction (replaces loose parsing)

Use Claude **structured outputs** (a strict JSON schema) so the model *must*
return a complete, typed object. The schema forces an explicit classification
instead of the `amount:0` convention:

```jsonc
{
  "kind": "transaction" | "bill" | "transfer" | "non_transaction",
  "reason_if_non_txn": "promo" | "otp" | "balance_summary" | "declined" | "other" | null,
  "direction": "debit" | "credit" | null,
  "amount": 400.00,
  "currency": "INR",
  "merchant_raw": "SWIGGY INSTAMART",     // as seen
  "merchant": "Swiggy Instamart",         // normalized
  "instrument": { "kind": "account"|"card", "last4": "3774", "name_hint": "Axis" },
  "bank_ref": "UPI/512345678901",         // RRN / UTR / txn id — KEY for dedup
  "occurred_at": "2026-07-27T13:27:00+05:30",
  "category": "groceries",
  "confidence": 0..100
}
```

Because the schema is bank-agnostic, the *same* prompt handles HDFC, Axis, SBI,
Scapia, Amex — the model adapts to each format instead of us writing rules.

### Pillar B — Identity-based dedup (`bank_ref`)

Every real bank/UPI transaction carries a unique reference — a **UPI RRN**, a
**UTR**, or a **bank transaction id**. The two emails for one order almost
always share it. So:

- **Primary dedup key = the bank's own reference.** Two emails with the same
  `bank_ref` are the same transaction, full stop — no amount/merchant/category
  heuristics, works for every bank.
- **Fallback key** (when no ref is extractable) = a normalized synthetic:
  `date | direction | amount-in-paise | merchant_normalized | account_last4`.
  Merchant normalization (Swiggy/Instamart → one canonical name) lives in a
  **data table**, so adding a new alias never touches code.

This retires the brand-family / same-category patches: they become the *last*
resort, under a real identity key.

### Pillar C — Database-enforced uniqueness

Move transactions from the JSON blob into a real table:

```sql
create table public.transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  dedup_key   text not null,                 -- bank_ref or synthetic
  occurred_on date not null,
  amount      numeric(14,2) not null,
  currency    text not null default 'INR',
  direction   text not null,                 -- debit | credit
  type        text not null,                 -- expense | income | transfer
  merchant    text,
  category    text,
  account_ref text,                          -- resolved account/card id
  bank_ref    text,
  status      text not null default 'booked',-- booked | review | rejected
  confidence  int,
  source      text not null default 'gmail',
  raw         jsonb,                          -- full extraction for audit/enrich
  created_at  timestamptz not null default now(),
  unique (user_id, dedup_key)                -- ← duplicates are IMPOSSIBLE
);
alter table public.transactions enable row level security;
-- RLS: user can see/write only their own rows (same pattern as app_state)
```

Ingestion becomes an idempotent upsert:

```sql
insert into transactions (...) values (...)
on conflict (user_id, dedup_key) do nothing;   -- or DO UPDATE to enrich a stub
```

Now duplicates can't exist regardless of how many emails describe one
transaction, or how many times the forwarder retries. The heuristics move from
"prevent double-booking" (load-bearing) to "pick a good synthetic key"
(best-effort) — a much smaller job.

Plus an **audit log** so nothing is ever a mystery again:

```sql
create table public.ingestion_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  email_hash text not null,          -- idempotency: same email twice = no-op
  received_at timestamptz default now(),
  model_used text, confidence int,
  outcome text,                      -- booked | review | duplicate | non_txn | error
  transaction_id uuid, notes text,
  unique (user_id, email_hash)
);
```

## 5. Never-drop guarantee & confidence routing

Every email deterministically ends in one recorded outcome:

| Model result | Confidence | Outcome |
|---|---|---|
| clear transaction | high | **auto-booked** |
| transaction | medium | **Review inbox** (confirm) |
| transaction | low → escalate → still low | **Review inbox** |
| bill / future due | any | **Upcoming bills** |
| non-transaction (promo/OTP) | high | **logged, not booked** |
| extraction/API error | — | **retry** (transient) then Review |

Because every outcome is written to `ingestion_events`, "why didn't this show
up?" is answerable in one query instead of digging through Apps Script logs.

## 6. Capture — stop missing emails

You're right that both forwarding filters and direct-read filters can miss
emails. The fix is to **move the filtering off the fragile mail query and onto
the AI classifier**:

- The Gmail forwarder forwards **broadly** (all likely-financial senders, or all
  mail from a user-defined set). The **server** decides what's a transaction.
- A cheap server-side pre-filter (regex + the ₹/verb heuristics we already have)
  discards obvious non-financial mail *before* any AI call, so cost stays low.
- Longer term: a **per-user ingest alias** (`u_<id>@ingest.yourapp`) that users
  auto-forward bank mail to with a single Gmail filter — bank-agnostic, and the
  server owns classification end-to-end.

Net: a missed transaction requires the email to never reach the server at all,
rather than being silently filtered by a brittle query.

## 7. Cost at scale (rough, order-of-magnitude)

- Cheap tier (Haiku) does ~all extraction; escalation (strong model) fires only
  on low-confidence misses — a small fraction.
- Pre-filter drops promos/OTPs before they cost anything.
- Ballpark: a user getting ~300 financial emails/month, ~90% handled by the
  cheap tier, is a few cents/month in AI. 100 users ≈ single-digit dollars/month.
- Per-user daily caps (already built) bound abuse.

## 8. What stays the same

- Supabase + Netlify functions + the no-build front end.
- RLS-per-user security model (extended to the new tables).
- The existing card/available-limit engine and selectors — they read
  transactions; they don't care where transactions are stored.

## 9. Migration plan (staged — safe on the live app)

Each phase ships independently behind the preview→approve flow; nothing is
big-bang.

- **Phase 0 — Groundwork (no user-visible change).** Create `transactions` +
  `ingestion_events` tables and RLS. Write a dual-write shim: ingestion keeps
  writing the JSON blob *and* mirrors into the table. Backfill existing blob
  transactions into the table. Verify counts match.
- **Phase 1 — DB-enforced dedup + audit.** Turn on the `unique(user_id,
  dedup_key)` upsert and the `email_hash` idempotency gate. This alone kills
  duplicates and gives observability, with the current parser unchanged.
- **Phase 2 — Structured extraction.** Replace loose parsing with the strict
  schema + confidence + `bank_ref`. Switch dedup to ref-first. Retire the
  brand-family/category patches to fallback-only.
- **Phase 3 — Reads move to the table.** Point selectors/UI at the
  `transactions` table (currency engine, net worth, cards read it). Blob becomes
  legacy for transactions; keep it for settings/config.
- **Phase 4 — Capture + normalization.** Broaden forwarding + server classify;
  move merchant/account normalization into data tables; optional per-user alias.

Rollback at any phase = stop reading the new table; the blob is still intact
until Phase 3.

## 10. Open decisions for you

1. **Storage scope:** move *only transactions* to a table now (recommended), or
   the whole data model? Transactions-first is the high-ROI, low-risk cut.
2. **Capture:** keep the Apps Script (broadened) for now, or invest in the
   per-user ingest alias sooner? Alias is cleaner but more infra.
3. **Auto-book threshold:** how confident before we book without review? (Today
   it's a single number; the new model can tune per-outcome.)
4. **Backfill:** migrate all historical blob transactions into the table, or
   start fresh from a cutoff date?

## 11. Recommended first step

**Phase 0 + Phase 1** together: the transactions table, dual-write, backfill,
and the DB-enforced dedup + audit log. That's the change that permanently ends
the duplicate whack-a-mole and gives us eyes on every email — *without* touching
the parser yet, so it's low-risk. Structured extraction (Phase 2) then lands on
a foundation that already can't double-book.
