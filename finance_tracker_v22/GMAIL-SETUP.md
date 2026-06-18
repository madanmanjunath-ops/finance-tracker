# Gmail auto-import — setup (≈10 min)

Automatically pulls transactions from your bank/card emails into the app.
A tiny **Google Apps Script** runs in *your own* Google account on a timer,
finds bank emails, and forwards their text to your app's secure webhook.
No Gmail API verification, no password sharing — it runs as you.

High-confidence transactions auto-book (tagged **auto**); the rest wait in
your **Review inbox** to approve at night. You set the threshold in-app.

## You need
- Your app deployed on Netlify **with cloud sync on** and signed in.
- The env vars from DAILY-EMAIL-SETUP.md Step 3 (`SUPABASE_URL`,
  `SUPABASE_SERVICE_KEY`) — the ingest webhook uses the same ones.
  `ANTHROPIC_API_KEY` is already set.

## Step 1 — Get your token + webhook from the app
1. Open your site → **Settings → Daily email & Gmail import**.
2. Under *Gmail auto-import*, click **Generate my ingest token**.
3. You'll see a **Webhook URL** (your-site/api/ingest) and an **Ingest
   token**. Keep this tab open — you'll copy both next.

## Step 2 — Create the Apps Script
1. Go to **https://script.google.com** → **New project**.
2. Delete the sample code. Open **`gmail-apps-script.gs`** from your
   project folder, copy ALL of it, paste into the editor.
3. At the top, set the two values:
   ```js
   var WEBHOOK_URL  = "https://YOUR-SITE.netlify.app/api/ingest"; // from the app
   var INGEST_TOKEN = "ft_xxxxxxxx...";                           // from the app
   ```
4. **Save** (💾).

## Step 3 — Authorise & test
1. In the toolbar function dropdown, pick **testOnce** → **Run**.
2. Google shows a permissions prompt → **Review permissions** → pick your
   account → *Advanced* → *Go to project (unsafe)* → **Allow**.
   (It's "unsafe" only because it's your own unverified script — it just
   reads Gmail and calls your site.)
3. Check **Executions / Logs** — you should see your recent bank emails
   posting `200 {ok:true...}`. Open the app's **Import → Review inbox** to
   see them.

## Step 4 — Put it on a timer
1. Pick **createTrigger** in the function dropdown → **Run**.
2. Done — it now checks Gmail every 15 minutes, forever, in the
   background. New bank emails flow into the app automatically.

## Step 5 — Import your history (one-time backfill)
The routine check only looks at the **last 3 days** (so it stays fast).
To pull in OLD emails:
1. In the script, find `var BACKFILL_DAYS = 365;` near the top. Leave it
   at 365 for the past year, or set `1825` for a full 5 years.
2. Pick **backfill** in the function dropdown → **Run**.
3. It forwards up to 60 emails per run (so it can't time out). Check the
   **Logs** — if it says "forwarded 60", **Run backfill again** to
   continue. Repeat until it logs **"forwarded 0"**.
4. Open the app's **Import → Review inbox** to approve them.

> 💡 Getting 0 the first time? Almost always the **time window** or the
> **sender filter**. Your old emails are older than 3 days, so use
> **backfill** (above), not testOnce. If backfill is also 0, your banks'
> emails don't match `MATCH_FILTER` — open one of their alert emails, note
> the **From** address, and add that word to the `from:(...)` list.

## Tuning
- **What counts as a bank email:** edit `MATCH_FILTER` in the script to
  match your banks' sender addresses/subjects.
- **Nothing imported?** The routine check only looks back 3 days — run
  **backfill** (Step 5) for old emails. If that's also empty, your banks
  aren't in `MATCH_FILTER` — add their From-address keyword.
- **Auto-book vs review:** the slider in Settings (default 85%). Set to
  100% to review every single one.
- **Re-import recent emails:** run `resetSeen` once, then `testOnce` (or
  `backfill`).
- **Stop it:** in Apps Script → **Triggers** (clock icon) → delete the
  trigger.

## Privacy
- The script only reads emails matching your query and only sends their
  text to **your** webhook. Google never grants the app standing access —
  the script runs as you and you can revoke it anytime at
  https://myaccount.google.com/permissions.
- The webhook accepts data only with your secret token; regenerate it in
  Settings if it ever leaks.
