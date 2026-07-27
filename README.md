# Finance Tracker

[![tests](https://github.com/madanmanjunath-ops/finance-tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/madanmanjunath-ops/finance-tracker/actions/workflows/ci.yml)

A personal finance + Indian credit-card optimiser. It tracks spending, net
worth, credit-card limits and rewards, imports transactions from bank emails
and statements, and includes optional AI features (email parsing, an investment
coach, a daily snapshot email).

It's a **no-build static web app** (React compiled in the browser) with a few
Netlify serverless functions and Supabase for login + cloud sync.

## Where things are

The application lives in [`finance_tracker_v22/`](finance_tracker_v22/).

| I want to… | Read |
|---|---|
| Set it up from scratch (non-technical) | [`finance_tracker_v22/START-HERE.md`](finance_tracker_v22/START-HERE.md) |
| Deploy / host it | [`finance_tracker_v22/DEPLOY.md`](finance_tracker_v22/DEPLOY.md) |
| Turn on login & sync | [`finance_tracker_v22/SUPABASE-SETUP.md`](finance_tracker_v22/SUPABASE-SETUP.md) |
| Import bank emails automatically | [`finance_tracker_v22/GMAIL-SETUP.md`](finance_tracker_v22/GMAIL-SETUP.md) |
| Understand the code / conventions | [`CLAUDE.md`](CLAUDE.md) |
| See what changed recently | [`finance_tracker_v22/CHANGELOG.md`](finance_tracker_v22/CHANGELOG.md) |

## How changes go live

`main` is the live site — Netlify auto-publishes whatever is merged into it.
Make changes on a branch, preview them, then merge to `main`. See the
**Working agreement** in [`CLAUDE.md`](CLAUDE.md).

## Run locally

No build step. Serve the folder over http (the service worker needs http, not
`file://`):

```
cd finance_tracker_v22
npx serve .
```

AI features call `/api/claude`, which only exists once deployed to Netlify
(or when running `netlify dev` with the environment variables set).
