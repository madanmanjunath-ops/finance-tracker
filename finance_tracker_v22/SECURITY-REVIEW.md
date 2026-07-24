# Security review — Finance Tracker

Scope: multi-tenant data isolation, authentication, the shared AI proxy, the
Gmail ingest webhook, secrets handling, and injection/XSS. Focus was the
question that matters most for going multi-user: **can one account ever see or
corrupt another account's data?**

Date: 2026-07. Reviewer: automated code review of the repo as deployed.

---

## Summary

No cross-account data-leak path was found in the application code. The two
things worth fixing were in the **Gmail ingest token**; both are addressed in
this change. The remaining items are hardening recommendations, the most useful
being **HTTP security headers** (needs a careful, tested change).

**The single most important thing to verify** is that the Row-Level Security
(RLS) SQL from `SUPABASE-SETUP.md` was actually run in your Supabase project —
all client-side isolation depends on it. The included live test proves it in 30
seconds (see `test/integration/security-live.mjs`).

---

## Fixed in this change

### S1 — Ingest token used `Math.random()` (Medium)
The Gmail ingest webhook token authorizes **writing transactions into a user's
account**. It was generated with `Math.random().toString(36)` — not a
cryptographically secure generator, and lower entropy than it looks. A
determined attacker who could predict or brute-force a token could inject bogus
transactions into a victim's ledger (a data-integrity problem; it does **not**
expose the victim's data, since the endpoint returns none).

**Fix:** token generation moved to `FT.ingestToken()` using the platform CSPRNG
(`crypto.randomUUID` / `crypto.getRandomValues`, ~256 bits). Verified by
`test/security.test.js` (format, uniqueness across 5000 draws, and a guard
against regressing to the weak base-36 alphabet).

### S2 — Ingest user-lookup filter was inline & untested (Low / defense-in-depth)
The webhook finds the user by interpolating their token into a PostgREST filter.
It was already wrapped in `encodeURIComponent`, so it was **not** exploitable —
but the logic was inline and had no test guarding it.

**Fix:** extracted to `tokenFilter()` with a regression test proving that a
crafted token containing `&`/`=` cannot break out of the `eq.<token>` filter to
append a second condition and match another user's row.

---

## Verified good (no action needed)

### The shared AI key does NOT leak data between accounts ✅
This was a specific concern, so it got specific attention:
- The Anthropic API key is **server-side only** (since v38) — browsers never
  receive it.
- Every `/api/claude` request must carry the **caller's own Supabase session
  token**, which the function verifies against Supabase before doing anything.
- Requests are **independent**: each is a fresh call to Anthropic with only that
  user's prompt. There is no shared conversation state, so one user's data can't
  surface in another user's response.
- A **per-user daily cap** bounds abuse (`AI_DAILY_LIMIT`, default 300).

### Multi-tenant data isolation (app_state) ✅ — depends on RLS being enabled
- **Client path:** the browser talks to Supabase with the public **anon key**
  under **Row-Level Security** (`auth.uid() = user_id` for select/insert/update).
  This is the correct pattern — each signed-in user can touch only their own row,
  and the anon key alone exposes nothing.
- **Server path:** the serverless functions use the **service key** (which
  bypasses RLS by design) but every write is attributed to a single resolved
  `user_id` — ingest resolves it from the token; the daily email iterates users
  and sends each their own snapshot to their own stored address. No code path
  mixes users.
- **Caveat:** client isolation is only as good as the RLS policies in your
  Supabase project. If that SQL was never run, the anon key would expose every
  row. **Run the live test to confirm.**

### No XSS / stored-script injection ✅
All user- and AI-derived text (payee names, notes, AI output) is rendered
through React JSX, which auto-escapes. There is **no** `dangerouslySetInnerHTML`
or `innerHTML` anywhere in the app. A malicious merchant name in a forwarded
email cannot execute script.

### Authentication ✅
Login is delegated to Supabase GoTrue. A wrong password returns an error;
Supabase enforces its own auth rate-limiting. Confirmed by the live test.

### Secrets ✅
No secrets are committed. `supabase-config.js` holds only the **anon (public)**
key — safe by design under RLS. `.gitignore` blocks `.env`, `*.key`, `*.pem`,
etc. The service key, Anthropic key, and Resend key live only in Netlify env
vars. The manual snapshot trigger is gated by `EMAIL_TEST_SECRET` and fails
closed when it's unset.

---

## Recommendations (not done yet — need your input or a careful change)

| # | Sev | Recommendation |
|---|-----|----------------|
| R1 | Medium | **Add HTTP security headers** in `netlify.toml`: `X-Frame-Options: DENY` (anti-clickjacking), `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Strict-Transport-Security`, and a `Content-Security-Policy`. Note: the app loads React/Babel/Supabase/xlsx/pdf.js from unpkg — React & Babel have SRI integrity hashes, but supabase/xlsx/pdf.js do **not**. A CSP + adding SRI (or self-hosting those three libs) closes a CDN-tampering vector. **A wrong CSP can break the app** (Babel-in-browser needs `unsafe-eval`), so this should be done on a preview and tested — happy to do it as its own change. |
| R2 | Low | **Confirm "Confirm email" is ON** in Supabase Auth for production. The setup guide suggests turning it off *while testing*; leaving it off lets someone sign up with an email they don't own. |
| R3 | Low | Consider a **per-IP sign-up / unauthenticated burst cap** in front of the functions as you scale (the per-user AI cap already exists). |
| R4 | Info | `send-snapshot-now` compares the secret with `!==` (not constant-time). Negligible risk for this use; note only. |
| R5 | Info | `daily-email.js` builds HTML from the user's own data without escaping. Self-only (their data → their own inbox), not a cross-account issue. Escape if you ever add shared/household emails. |
| R6 | Process | Run `test/integration/security-live.mjs` after any Supabase change, and run the unit tests on every PR (a GitHub Actions workflow would automate this). |

---

## How to re-verify

- **Offline (logic + token security):** `npm test` from the repo root — 25 tests.
- **Live (RLS isolation + login):** `node test/integration/security-live.mjs`
  with the env vars documented in that file. Every line must print `PASS`.
