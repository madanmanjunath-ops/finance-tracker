# Deploying Finance Tracker (with working AI)

This turns your app into a real website where the AI features
(email parsing, bulk import, the investment coach) work live.

The app is plain static files **plus one small serverless function**
that safely holds your AI API key. We'll use **Netlify** (free tier is
plenty). Total time: ~20 minutes. No coding required beyond copy‑paste.

---

## What you need
1. A free **Netlify** account → https://netlify.com
2. An **Anthropic API key** → https://console.anthropic.com → *API Keys* →
   *Create Key*. (Add a little credit; personal use costs cents.)
3. This project's files (download them from the studio).

---

## Step 1 — Get the files
Download the whole project folder (use the download card in the chat, or
the project's export option). It already contains everything, ready to go:
```
index.html                ← the app (opens automatically at your root URL)
styles.css, *.jsx, *.js   ← app code
ai.js                     ← makes AI work on your site
netlify.toml              ← tells Netlify about the function
netlify/functions/claude.js  ← the secure AI proxy
```

> Already set up for you: the main file is named `index.html`, so your
> site opens straight to the app — no renaming needed.

## Step 2 — Deploy to Netlify
**Option A — drag & drop (simplest)**
1. Go to https://app.netlify.com/drop
2. Drag the **whole folder** onto the page.
3. Wait ~30 seconds → you get a live URL like
   `https://your-name-123.netlify.app`.

**Option B — from GitHub (better for updates)**
Push the folder to a GitHub repo, then in Netlify: *Add new site → Import
an existing project → pick the repo*. Every push redeploys.

## Step 3 — Add your secret keys (env vars)
In Netlify: **Site configuration → Environment variables → Add a variable.**
Add these:

| Key | Value | Required |
|---|---|---|
| `ANTHROPIC_API_KEY` | your key from console.anthropic.com | ✅ yes |
| `APP_SECRET` | any password you make up (e.g. a long random string) | recommended |
| `CLAUDE_MODEL` | a model id, if you want to override the default | optional |

Then **redeploy** (Deploys → Trigger deploy → Deploy site) so the
function picks up the variables.

## Step 4 — Unlock the AI in the app
1. Open your live site.
2. Go to **Settings → AI service**.
3. If you set `APP_SECRET`, paste the same value into **AI access key**
   and click **Save key**.
4. Click **Test connection**. You should see *"Connected — the AI
   features are live."*
5. Try **Email Import → Parse with AI**. Done. 🎉

---

## Why the `APP_SECRET`?
Your proxy URL is public. Without a secret, anyone who found it could
spend your API credits. With `APP_SECRET` set, the function rejects every
request that doesn't send the matching key — and only you have it (it's
saved in your browser, never in the page source).

## Hosting somewhere else?
- **Vercel:** move `netlify/functions/claude.js` to `api/claude.js`,
  delete `netlify.toml`, and set the same env vars. The `/api/claude`
  path already matches.
- **Cloudflare Pages:** use a Pages Function at
  `functions/api/claude.js` with the same logic.
- Self-hosting the static files on a different domain than the function?
  You'll need to add CORS headers to the function and set
  `window.AI_PROXY_URL` to the function's full URL before `ai.js` loads.

## Cost & privacy notes
- **Your financial data never goes to a server** — it stays in your
  browser (localStorage). Only the *text you choose to parse* and your
  *profile numbers* are sent to the AI when you click an AI button.
- Anthropic bills per request; parsing an email or asking the coach is a
  fraction of a cent. Set a spending cap in the Anthropic console if you
  like.
- Back up anytime via **Settings → Backup all data (JSON)**.

## Multi-device sync (later)
Because data lives in the browser, your phone and laptop won't share it
automatically. If you want that, the next step is adding a login + a
small database (e.g. Supabase). Ask and I'll scope it.
