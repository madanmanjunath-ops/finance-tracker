# Finance Tracker

A personal finance + credit-card optimiser for Indian cards. Plain static
front-end (React via in-browser Babel) with a few Netlify serverless
functions for the AI proxy, Gmail ingestion and the daily snapshot email.
Data and login are handled by Supabase.

> New here and not technical? Open **START-HERE.md** — it walks you from
> nothing to a working app in ~30 minutes with no coding.

## What's in this release (v35)
The Cards screen got a unified credit-limit engine (spends reduce the
available limit, payments restore it, statement/limit emails update the
card), plus an AI "which card should I use?" advisor, a totals strip, and a
points & transfer-partner section. See **CHANGELOG.md** for the full list.

## Deploy from GitHub (continuous deploy via Netlify)
The app needs Netlify because of the serverless functions — GitHub Pages
alone won't run them.

1. **Push this folder to a GitHub repo** (these files at the repo root).
2. In Netlify: **Add new site → Import an existing project → GitHub**, then
   pick the repo. No build command is needed; `netlify.toml` already sets
   `publish = "."` and the functions directory.
3. **Set environment variables** (Site configuration → Environment variables):
   - `ANTHROPIC_API_KEY` — from https://console.anthropic.com
   - `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` — from your Supabase project
   - `CLAUDE_MODEL` — optional (defaults to a current Claude model)
   - plus any extras noted in **DEPLOY.md** (e.g. the AI access secret)
4. Add your Supabase project URL + anon key in `supabase-config.js`
   (see **SUPABASE-SETUP.md**).
5. **Deploy.** Every push to the default branch redeploys automatically.

Prefer drag-and-drop instead of GitHub? **DEPLOY.md** covers that path.

## Optional features
- **Gmail import** (auto-book transactions from bank emails): **GMAIL-SETUP.md**
- **Daily snapshot email**: **DAILY-EMAIL-SETUP.md**

## Project layout
```
index.html              app shell + script load order
store.js                state, schema, card database, helpers (FT.*)
compute.jsx             derived selectors (Compute.*) incl. card limit engine
views_*.jsx             screens (views_cards.jsx = the Cards screen)
app.jsx                 app root + actions
ai.js                   makes window.claude.complete() work in production
netlify/functions/      claude proxy, gmail ingest, daily email
netlify.toml            Netlify config + redirects + function schedule
```

## Local preview
No build step. Serve the folder over http (a service worker needs http, not
file://):
```
npx serve .
```
AI features call `/api/claude`, which only exists once deployed to Netlify
(or run `netlify dev` with the env vars set).
