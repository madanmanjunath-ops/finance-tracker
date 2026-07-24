# Tests

Automated tests for Finance Tracker. **No build step, no dependencies** — just
Node 18+ (developed on Node 22) and its built-in test runner.

This folder lives at the **repo root**, deliberately outside
`finance_tracker_v22/` (Netlify's base directory), so it never affects the
deployed site.

## Run the offline tests

```bash
npm test          # from the repo root
# or:
node --test
```

25 tests covering:

- **`compute.test.js`** — the money math: currency conversion, the card
  used/available engine (the single source of truth), and net worth. Includes a
  **regression test for the "phantom Used" bug** (an email-verified anchor must
  be authoritative for its date so a same-day duplicate spend can't double-count).
- **`parser.test.js`** — the Gmail ingest parser's deterministic helpers:
  available-limit extraction (won't grab a card's last-4 or the amount), payee /
  UPI-name cleanup, strict card matching by number, and dedupe keys.
- **`security.test.js`** — ingest-token entropy (CSPRNG, unguessable, unique)
  and the injection-safe PostgREST lookup filter.

## Run the live security test

Cross-account isolation (RLS) and login can only be tested against a real
Supabase project. See the header of
[`integration/security-live.mjs`](integration/security-live.mjs) for the exact
command — you provide your project URL, anon key, and two throwaway test
accounts, and every check should print `PASS`.

## How the harness works

`compute.jsx` and `store.js` are browser files that attach their APIs to
`window`. `harness.js` runs them inside a Node `vm` sandbox that provides a fake
`window` (plus a real CSPRNG and a `localStorage` stub), then hands back
`window.FT` and `window.Compute`. The ingest function exposes its pure internals
via `module.exports.__test` for the parser/security suites.

## Adding a test when you fix a bug

The highest-value habit: whenever a bug is found and fixed, add a test that
reproduces it here so it can't silently come back. The parser and money-math
files are the right home for those.
