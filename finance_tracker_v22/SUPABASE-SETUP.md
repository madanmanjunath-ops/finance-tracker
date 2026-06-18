# Cloud sync & login with Supabase (15 minutes)

This turns Finance Tracker into a true multi-device app: you log in,
and your data is stored privately in the cloud and synced to every
device you sign in on. It works alongside the Netlify hosting and the
AI proxy you already set up.

**Until you complete this, the app keeps working in local-only mode**
(no login, data stays in the browser). Nothing breaks while the keys
are blank.

---

## What you need
- A free **Supabase** account → https://supabase.com
- Your project already deployed on Netlify (or running locally).

---

## Step 1 — Create a Supabase project
1. Sign in to Supabase → **New project**.
2. Name it (e.g. *finance-tracker*), set a database password (save it),
   pick a region near you → **Create**. Wait ~2 minutes for it to spin up.

## Step 2 — Create the data table + security
1. In your project, open **SQL Editor → New query**.
2. Paste the SQL below and click **Run**. It creates one table and
   turns on Row-Level Security so each user can only ever touch their
   own row.

```sql
-- One row of app state per user.
create table if not exists public.app_state (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Lock the table down…
alter table public.app_state enable row level security;

-- …then allow each signed-in user to read/write ONLY their own row.
create policy "own row - select" on public.app_state
  for select using (auth.uid() = user_id);
create policy "own row - insert" on public.app_state
  for insert with check (auth.uid() = user_id);
create policy "own row - update" on public.app_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

## Step 3 — Get your keys
1. Open **Project Settings → API**.
2. Copy two values:
   - **Project URL** (looks like `https://abcd1234.supabase.co`)
   - **anon public** key (a long string under *Project API keys*)

> These two are safe in the browser — the SQL above means they only
> ever expose a user's own row, and only after they log in.

## Step 4 — Put the keys in the app
Open **`supabase-config.js`** and fill in the two values:
```js
window.SUPABASE_URL = "https://abcd1234.supabase.co";
window.SUPABASE_ANON_KEY = "eyJhbGciOi...your-anon-key...";
```
Save, then redeploy to Netlify (drag the folder again, or push to GitHub).

## Step 5 — Sign up & sync
1. Open your live site. You'll now see a **login screen**.
2. Click **Create an account**, enter an email + password (6+ chars).
3. You're in — your data now lives in the cloud. The sidebar shows your
   email and a **"All changes synced"** status.
4. Open the site on your **phone**, sign in with the same account →
   the same data appears. 🎉

---

## Email confirmation (optional but recommended)
By default Supabase may require email confirmation on sign-up. To make
first sign-up instant while testing:
- **Authentication → Providers → Email** → toggle *Confirm email* off
  (turn it back on later for security), **or**
- just click the confirmation link Supabase emails you, then sign in.

## How syncing behaves
- Every change saves to the cloud within a second (debounced), and is
  also cached in your browser so the app is instant offline.
- When you switch back to a tab/device, it pulls the latest version, so
  edits made elsewhere show up. It's **last-write-wins** — fine for one
  person on a few devices; it isn't built for two people editing the
  exact same second.

## Privacy & cost
- Row-Level Security means no user can read anyone else's data — not
  even with the anon key.
- Supabase's free tier is generous; a personal tracker won't get near
  the limits.
- Your AI proxy (Netlify) and your database (Supabase) are separate
  services — only the text you choose to parse ever goes to the AI.

## Inviting family (optional)
Anyone who creates an account gets their **own** private data. If you
want a shared household view (one dataset, multiple logins), that's a
small extension — ask and I'll add a shared "household" mode.

## Troubleshooting
- **Login screen doesn't appear:** keys aren't loaded — check
  `supabase-config.js` has both values and you redeployed.
- **"new row violates row-level security":** re-run the policy SQL in
  Step 2.
- **Sign-up says "check your inbox":** email confirmation is on — see
  the section above.
