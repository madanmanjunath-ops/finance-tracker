# Finance Tracker — project guide

Personal finance + Indian credit-card optimiser. This file is the source of
truth for how the project is built, deployed, and maintained. Read it before
making changes.

## The big picture (for non-experts)

- The app is **plain static files** (HTML/CSS/JavaScript). There is **no build
  step** — the browser compiles the React code on the fly via Babel.
- A few small **serverless functions** on Netlify hold the secret API keys and
  do the AI/email work. Your financial data lives in your browser and syncs to
  **Supabase** (a hosted database) when you're logged in.
- **`main` is the live website.** Anything merged into `main` is auto-published
  by Netlify. Treat `main` as always-working.

## Repo layout

```
finance_tracker_v22/          the app (everything ships from here)
  index.html                  app shell + the ORDER scripts load in (matters!)
  store.js                    data model + helpers            → window.FT
  compute.jsx                 derived money math (selectors)  → window.Compute
  app.jsx                     app shell, routing, all state mutations (actions)
  lib.jsx                     icons, charts, Modal
  views_*.jsx / view_import.jsx   the screens
  cloud.js                    Supabase auth + sync            → window.Cloud
  ai.js                       makes window.claude.complete() call the proxy
  supabase-config.js          Supabase URL + anon key (safe to commit; see below)
  gmail-apps-script.gs        runs in the user's Google account; forwards emails
  netlify/functions/          claude proxy, gmail ingest, daily snapshot email
  netlify.toml                Netlify config, redirects, function schedule
  *.md                        setup guides (START-HERE, DEPLOY, SUPABASE-SETUP…)
CLAUDE.md / README.md / .gitignore   repo-level docs & guardrails
```

## Architecture conventions (follow these)

- **No bundler, no imports.** Every module attaches to `window` (`FT`, `Compute`,
  `Cloud`, `claude`) and is consumed as a global. `index.html` loads them in a
  fixed order — `store.js` → `ai.js` → cloud → React/Babel → `lib` → `compute`
  → views → `app.jsx`. **If you add a file, add its `<script>` tag in the right
  place**, and remember later files depend on globals from earlier ones
  (e.g. `views_critic.jsx` reads `window.buildAdvice` from `views_investments.jsx`).
- **State changes go through `actions` in `app.jsx`** — never mutate state
  elsewhere. Selectors that only *read* + convert currency live in `compute.jsx`.
- **Money is currency-aware.** Amounts are stored in a transaction's own currency
  and converted to the display currency via `Compute.conv`. Don't hardcode `₹`.
- **Card limits have one source of truth:** `Compute.cardAvailable` / `cardUsed`.
  Don't compute utilization any other way.
- **Two copies of `ingest.js`** exist (`finance_tracker_v22/ingest.js` and
  `finance_tracker_v22/netlify/functions/ingest.js`). Only the one under
  `netlify/functions/` is deployed; the root copy is legacy. **Keep them
  identical** if you edit either (or delete the root copy in a dedicated change).
- **Cache-busting:** static assets are referenced as `?v=NN` in `index.html`.
  On a release that changes the offline shell, bump that number **and** the
  `CACHE_VERSION` in `sw.js`.

## How it's deployed

Two independent targets — a change may touch one or both:

1. **The website + serverless functions** → Netlify, auto-deployed from `main`.
   Merging to `main` triggers a build. No manual step if the site is connected
   to GitHub. (Env vars are set in the Netlify dashboard, not in the repo.)
2. **The Gmail forwarder** (`gmail-apps-script.gs`) → runs in the user's own
   Google account at script.google.com. Editing the file here does NOT update
   it there; the user must re-paste it and keep their `WEBHOOK_URL` +
   `INGEST_TOKEN` at the top.

## Environment variables (set in Netlify, never in the repo)

- `ANTHROPIC_API_KEY` — required for all AI features.
- `CLAUDE_MODEL` — optional model override (see Known issues).
- `APP_SECRET` — optional gate for the AI proxy.
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` — server-side (ingest + daily email).
- `RESEND_API_KEY`, `EMAIL_FROM` — daily snapshot email.
- `EMAIL_TEST_SECRET` — manual snapshot trigger.

`supabase-config.js` intentionally contains the Supabase **URL + anon key**.
Those are safe in the browser because Row-Level Security limits each user to
their own row. The **service key** is NOT safe and must only ever live in
Netlify env vars.

## Working agreement (how we make changes)

- **Never publish to `main` (the live site) without the owner's explicit
  approval for that specific change.** This is a hard rule. Recommend
  preview-first for anything risky (app logic, money math, serverless
  functions) and direct-publish for trivial changes (docs, copy) — but ALWAYS
  ask before it goes live, every time.
- Make changes on a **branch**, not directly on `main`.
- **Preview before publishing** when the change is risky: the site is connected
  to GitHub, so Netlify builds a preview of the branch automatically. Confirm it
  works, then merge to `main` to go live. This protects the live app from a bad
  deploy.
- Write **descriptive commit messages** (what changed and why). The pre-existing
  "Add files via upload" commits are drag-and-drop uploads — don't emulate them.
- **Never commit secrets.** Keys go in Netlify env vars. `.gitignore` blocks the
  common leak paths.
- After changing serverless functions, sanity-check syntax (`node --check`).

## Known issues / quality backlog

Prioritised; not yet fixed. Confirm scope with the user before tackling.

1. ~~**Default model string is stale.**~~ **Fixed in v39.** Defaults are now
   current: `CLAUDE_MODEL` → `claude-sonnet-5` (reasoning), and a new
   `CLAUDE_MODEL_FAST` → `claude-haiku-4-5` (parsing/extraction). Both
   overridable in Netlify. High-volume parsing routes to the cheap tier via
   `tier:"fast"`; reasoning stays on the default. See CHANGELOG v39.
2. **Inconsistent "liquid / emergency fund" definition** across screens
   (`buildAdvice` counts bank+cash only; `Compute.liquidBreakdown` includes FDs).
3. **AI statement import forces `currency:"INR"`** — foreign-currency rows lose
   their currency (`aiExtractFromText` in `view_import.jsx`).
4. **`AddTxnModal` defaults income currency to USD** — can mis-tag INR income.
5. **No automated tests.** The serverless functions are the most testable part
   and the best place to start if we add a test setup.
6. **Two `ingest.js` copies** (see conventions) — candidate for cleanup.
