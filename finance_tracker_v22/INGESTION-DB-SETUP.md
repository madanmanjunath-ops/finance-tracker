# Ingestion DB setup — transactions table + dedup (Phase 0)

This is the one-time Supabase setup for the new ingestion model (see
`INGESTION-REDESIGN.md`). It creates two tables and turns on the safety rules.
Running it changes **nothing** in the app yet — it just prepares the ground.

Paste each block into **Supabase → SQL Editor → New query** and click **Run**.

---

## 1. The transactions table

One row per transaction, with a **unique `dedup_key` per user** — this is the
rule that makes duplicates impossible.

```sql
create table if not exists public.transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  dedup_key   text not null,                  -- bank reference, or a synthetic key
  occurred_on date not null,
  amount      numeric(14,2) not null,
  currency    text not null default 'INR',
  direction   text not null,                  -- 'debit' | 'credit'
  type        text not null,                  -- 'expense' | 'income' | 'transfer'
  merchant    text,
  category    text,
  account_ref text,                           -- resolved account/card id
  bank_ref    text,                           -- the bank's own reference, if any
  status      text not null default 'booked', -- 'booked' | 'review' | 'rejected'
  confidence  int,
  source      text not null default 'gmail',
  raw         jsonb,                           -- full extraction, for audit/enrich
  created_at  timestamptz not null default now(),

  -- THE rule: a user can never have two rows with the same dedup_key.
  unique (user_id, dedup_key)
);

create index if not exists transactions_user_date_idx
  on public.transactions (user_id, occurred_on desc);
```

## 2. Row-Level Security (same pattern as `app_state`)

Each user can read/write only their own rows. The ingest function uses the
service key, which bypasses RLS to write on a user's behalf.

```sql
alter table public.transactions enable row level security;

create policy "own txns - select" on public.transactions
  for select using (auth.uid() = user_id);
create policy "own txns - insert" on public.transactions
  for insert with check (auth.uid() = user_id);
create policy "own txns - update" on public.transactions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own txns - delete" on public.transactions
  for delete using (auth.uid() = user_id);
```

## 3. The ingestion audit log

Every email that arrives gets one row here, whatever the outcome — so "why
didn't this transaction show up?" is answerable in one query, and the same
email forwarded twice is a guaranteed no-op (`unique (user_id, email_hash)`).

```sql
create table if not exists public.ingestion_events (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  email_hash     text not null,               -- idempotency: same email twice = no-op
  received_at    timestamptz not null default now(),
  model_used     text,
  confidence     int,
  outcome        text,                          -- booked | review | duplicate | non_txn | error
  transaction_id uuid references public.transactions(id) on delete set null,
  notes          text,
  unique (user_id, email_hash)
);
alter table public.ingestion_events enable row level security;
create policy "own events - select" on public.ingestion_events
  for select using (auth.uid() = user_id);
-- writes are server-side (service role) only; no user insert/update policy needed.
```

---

## What happens after this

Nothing changes for you yet. With the tables in place, the next phase wires the
ingest function to:

1. compute the `dedup_key` for each parsed transaction (see
   `netlify/functions/lib/dedup.js`),
2. `insert ... on conflict (user_id, dedup_key) do nothing` — so a duplicate is
   silently rejected by the database, not by app-code guesswork,
3. record the outcome in `ingestion_events`.

We'll roll that in behind the usual preview → approve → publish flow, and
backfill your existing transactions into the table so nothing is lost.
