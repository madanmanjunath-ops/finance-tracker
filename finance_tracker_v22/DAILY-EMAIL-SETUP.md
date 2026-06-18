# Daily snapshot email — setup (≈10 min)

Sends you a finance snapshot every morning at **7:15 AM IST**: net worth,
spend vs budget, **best card to use today**, upcoming bills/dues, and a
one-line AI tip.

It runs as a scheduled Netlify function that reads your data from Supabase
and emails it via **Resend** (free).

## You need
- Your app already deployed on Netlify **with Supabase cloud sync on**.
- A free **Resend** account → https://resend.com

## Step 1 — Get a Resend API key
1. Sign up at resend.com → **API Keys → Create API Key** → copy it
   (starts with `re_`).
2. (Optional) To send from your own domain, add it under **Domains**.
   While testing you can send from `onboarding@resend.dev` with no domain.

## Step 2 — Get your Supabase *service* key
1. Supabase → **Project Settings → API**.
2. Under *Project API keys* copy the **`service_role`** key.
   ⚠️ This is powerful and server-only — it lives in Netlify env vars,
   never in the app.

## Step 3 — Add env vars in Netlify
Netlify → your site → **Site configuration → Environment variables** →
add:

| Key | Value |
|---|---|
| `SUPABASE_URL` | your `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_KEY` | the **service_role** key from Step 2 |
| `RESEND_API_KEY` | your `re_...` key |
| `EMAIL_FROM` | `Finance Tracker <onboarding@resend.dev>` (or your domain sender) |

(`ANTHROPIC_API_KEY` is already set — it adds the AI tip.)
Then **redeploy** (Deploys → Trigger deploy) so the schedule registers.

## Step 4 — Turn it on in the app
1. Open your site → **Settings → Daily email & Gmail import**.
2. Enter the **email address** to send to, flip the toggle to **On**.
3. That's it. Each morning at 7:15 AM IST you'll get the snapshot.

> Want a different time? Edit the cron in `netlify.toml`
> (`schedule = "45 1 * * *"` is 01:45 UTC = 07:15 IST) and redeploy.
> Cron format is UTC; subtract 5h30m from your IST time.

## Test it now (without waiting for morning)
In Netlify → **Functions → daily-email → Run/Trigger**, or visit your
site's function logs. You should get the email within a minute (make sure
the toggle is On and the email is filled in the app first).

## Notes
- Sends to every signed-in account that has the toggle on — so just you,
  unless you invite others.
- Nothing about your data leaves your own services (Supabase + Resend +
  the AI proxy you control).
