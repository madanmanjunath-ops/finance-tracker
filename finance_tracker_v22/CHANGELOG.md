# Changelog

## v35.1 — Email parsing fixes (UPI payee, self-transfers)
- **UPI merchant capture fixed.** When the model returned a generic label
  ("Transaction") or a bank name instead of the payee, the real name was
  ignored. The payee parsed from the UPI string (e.g. `.../Mr RAJESH SINGH`
  → "Rajesh Singh") is now preferred; honorifics are dropped and ALL-CAPS
  names are de-shouted.
- **Available-limit parser hardened** so a card's last-4 sitting between
  "limit" and the amount isn't mistaken for the figure (now requires a Rs/₹).
- **Self-transfer double-count fixed.** The second leg of a self-transfer is
  now skipped even when the credit email itself reads as a transfer.
- **Gmail forwarder** now matches credit-limit emails by subject
  ("credit limit", "available limit", "limit increase/enhancement/update"),
  so limit notices forward even from unrecognised senders.
- **Number-verified state changes.** Re-anchoring a card's available limit and
  writing a statement due date now require the email to contain the card's
  last-4 (the actual number), not just its name — so a promotional email that
  names a card and quotes an "available limit" can no longer corrupt the real one.
- **UPI payee extractor hardened** so a trailing amount on the same line
  (e.g. "...SINGH Rs 125") can't bleed into the captured name.

## v35 — Cards: unified limit logic + advisor, points & opportunities

### Credit-limit logic (now a single source of truth)
- `Compute.cardAvailable` is the one engine for used/available. The card
  table, totals strip, alerts and best-card picker all read it, so they
  can no longer disagree.
- Spends reduce available; **payments now restore it** (a transfer into the
  card via `toAccount` frees the limit). The table reflects payments — it
  previously never did.
- An emailed/manually-reconciled available limit is treated as
  **authoritative for its date** (no same-day double-counting).

### Email pipeline
- Available-limit re-anchoring runs even when the email is not a
  transaction (pure statement / limit-summary emails now update the card).
- A credit-card **statement email writes the amount due and the real due
  date onto the card** (`stmtAmount` / `stmtDueDate`), not just the bills list.
- Emailed card-bill **payments are tagged to the card** so the limit frees up.
- More tolerant available-limit parsing ("Rs." / "INR" / commas).

### Cards view
- New **totals strip**: total limit, available, utilization, reward points.
- New **AI advisor**: ask in plain words ("which card for a ₹95k flight?");
  also keeps an offline category quick-pick.
- New **points & opportunities** section: balances, ₹ value, transfer
  partners, and state-derived nudges (due soon, near limit, idle points, setup).
- Card table columns: Used, **Available** (new), Limit, Statement,
  **Due date** (prefers the statement date), Due in, Float.

### Editing
- Card editor now exposes **points balance, value per point, statement
  amount due, statement due date, and transfer partners** — all editable.

### Ops
- Cache-bust bumped to `v=35`; service-worker cache `ft-v35`.
