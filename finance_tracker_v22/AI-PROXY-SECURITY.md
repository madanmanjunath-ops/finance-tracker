# AI proxy security (per-user auth + rate limit)

The `/api/claude` proxy no longer uses a shared `APP_SECRET`. Instead, every
AI request must carry the **logged-in user's Supabase session token**, which the
function verifies server-side, and each user has a **daily request cap**.

## One-time setup

### 1. Create the usage table + increment function (Supabase → SQL Editor)

Paste and run this once:

```sql
-- Per-user, per-day AI request counter. Only the server (service role) writes it.
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null default (now() at time zone 'utc')::date,
  count   integer not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
-- No user-facing policies: the proxy uses the service role, which bypasses RLS.

-- Atomically bump today's count for a user and return the new value.
create or replace function public.increment_ai_usage(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count integer;
begin
  insert into public.ai_usage (user_id, day, count)
  values (p_user, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day)
  do update set count = ai_usage.count + 1
  returning count into new_count;
  return new_count;
end;
$$;
```

### 2. Environment variables (Netlify)

- `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` — already set (used by ingest + daily
  email). The proxy reuses them to verify tokens and count usage.
- `AI_DAILY_LIMIT` — optional; max AI requests per user per day. Defaults to
  **300** if unset.
- `APP_SECRET` — **no longer used** by the proxy. Safe to delete after this
  deploy is verified live.

## Behaviour notes

- **Auth fails closed:** a request without a valid session token gets `401`. Only
  signed-in users can spend the Anthropic budget.
- **Rate limit fails open:** if the `increment_ai_usage` RPC isn't installed yet
  or errors transiently, the request is still allowed (auth already gates
  access). So you can deploy first and run the SQL right after without breaking
  AI — the cap simply starts applying once the function exists.
- Over the cap → `429` and a friendly "try again tomorrow" message in the app.
