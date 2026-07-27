/* ============================================================
   netlify/functions/ingest.js
   Webhook that receives a forwarded bank email (from your Gmail
   Apps Script), uses AI to extract the transaction, and appends
   it to the matching user's Review inbox (or auto-books it).

   The caller must include the user's personal ingest token
   (header "x-ingest-token" or JSON {token}). Each user generates
   this in-app (Settings → Gmail import).

   Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY,
             optional CLAUDE_MODEL
   ============================================================ */
const crypto = require("crypto");
const { dedupKey, extractBankRef } = require("./lib/dedup.js");

const EXP_CATS = ["dining","groceries","fuel","transport","online","entertainment","bills","travel","health","staff","business","rent","emi","subs","cardpay","invest","misc"];
const INC_CATS = ["salary","freelance","business_inc","rental_inc","interest","dividend","refund","other_inc"];

function json(code, obj) { return { statusCode: code, headers: { "content-type": "application/json" }, body: JSON.stringify(obj) }; }
function uid() { return Math.random().toString(36).slice(2, 10); }
const todayISO = () => new Date().toISOString().slice(0, 10);

async function sbGet(path) {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: process.env.SUPABASE_SERVICE_KEY, authorization: "Bearer " + process.env.SUPABASE_SERVICE_KEY } });
  return r.json();
}
async function sbPatch(userId, data) {
  return fetch(`${process.env.SUPABASE_URL}/rest/v1/app_state?user_id=eq.${userId}`, {
    method: "PATCH", headers: { apikey: process.env.SUPABASE_SERVICE_KEY, authorization: "Bearer " + process.env.SUPABASE_SERVICE_KEY, "content-type": "application/json", prefer: "return=minimal" },
    body: JSON.stringify({ data, updated_at: new Date().toISOString() }),
  });
}

// A short, stable fingerprint of an email — used to log each email once.
function emailHash(text) { return crypto.createHash("sha256").update(String(text || "")).digest("hex").slice(0, 32); }

// Claim a transaction's identity in the transactions table (the new dedup
// authority). Uses INSERT ... ON CONFLICT (user_id, dedup_key) DO NOTHING via
// PostgREST's ignore-duplicates. Returns:
//   { inserted: true, id }  — a NEW transaction,
//   { inserted: false }     — the dedup_key already exists (a duplicate),
//   { error: true }         — table unreachable → caller FAILS OPEN (books anyway).
async function sbClaimTxn(userId, txn, key, bankRef, status) {
  const row = {
    user_id: userId, dedup_key: key, occurred_on: txn.date,
    amount: Math.abs(+txn.amount || 0), currency: txn.currency || "INR",
    direction: txn.type === "income" ? "credit" : "debit",
    type: txn.type, merchant: txn.merchant, category: txn.category,
    account_ref: txn.account || null, bank_ref: bankRef || null,
    status: status, confidence: txn.confidence || 0, source: "gmail", raw: txn,
  };
  try {
    const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/transactions?on_conflict=user_id,dedup_key`, {
      method: "POST",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        authorization: "Bearer " + process.env.SUPABASE_SERVICE_KEY,
        "content-type": "application/json",
        prefer: "return=representation,resolution=ignore-duplicates",
      },
      body: JSON.stringify(row),
    });
    if (!r.ok) return { error: true };
    const arr = await r.json().catch(() => []);
    return { inserted: Array.isArray(arr) && arr.length > 0, id: (arr[0] && arr[0].id) || null };
  } catch (e) { return { error: true }; }
}

// Best-effort audit log — one row per email, whatever the outcome. Never blocks
// or fails ingestion. (unique(user_id, email_hash) makes a re-log a no-op.)
async function sbLogEvent(userId, ehash, outcome, txnId) {
  try {
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/ingestion_events?on_conflict=user_id,email_hash`, {
      method: "POST",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        authorization: "Bearer " + process.env.SUPABASE_SERVICE_KEY,
        "content-type": "application/json",
        prefer: "resolution=ignore-duplicates",
      },
      body: JSON.stringify({ user_id: userId, email_hash: ehash, outcome: outcome, transaction_id: txnId || null }),
    });
  } catch (e) { /* audit is best-effort */ }
}

function extractVPA(t){const m=String(t||"").match(/\b[a-z0-9._-]{2,}@[a-z]{2,}\b/i);return m?m[0]:null;}
// Tidy a payee name: collapse spaces, drop a leading honorific, strip a
// trailing amount/currency remnant, de-shout ALL CAPS.
function cleanPayee(name) {
  let n = String(name || "").trim().replace(/\s+/g, " ");
  n = n.replace(/^(mr|mrs|ms|m\/s|dr|shri|smt)\.?\s+/i, "");
  n = n.replace(/\s+(rs\.?|inr|₹)\s*\d*\.?\d*\s*$/i, "");   // drop a trailing "Rs 125" / "INR"
  if (n && /[A-Z]/.test(n) && n === n.toUpperCase()) n = n.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  return n.trim();
}
// Extract payee from UPI "Transaction Info" strings like:
//   UPI/P2A/939904858765/SANTHOSH KUMAR RAJA
//   UPI/DR/123456/Swiggy   |   UPI/P2M/ref/Mr RAJESH SINGH
// The payee is the segment after the numeric reference. Names hold no digits,
// so the capture excludes them — that stops a trailing amount bleeding in.
function extractUpiPayee(text) {
  const s = String(text || "");
  let m = s.match(/UPI\/[A-Z0-9]+\/\d+\/([A-Za-z][A-Za-z .&'-]{1,60})/i);
  if (m) return cleanPayee(m[1]);
  m = s.match(/UPI\/[^\n]*?\/([A-Za-z][A-Za-z .&'-]{2,40})\s*$/m);
  if (m) return cleanPayee(m[1]);
  return null;
}
function looksLikeTransfer(text, data) {
  const low = String(text || "").toLowerCase();
  if (/\b(neft|imps|rtgs|upi transfer|fund transfer|self|own account|a\/c transfer|transferred to your)\b/.test(low)) {
    // only when it references one of the user's own accounts/cards
    const hints = ownHints(data || {});
    return hints.some(h => low.includes(h));
  }
  return false;
}
function ownHints(data) {
  const out = new Set();
  const push = (v) => { v = String(v || "").toLowerCase().trim(); if (v.length >= 3) out.add(v); };
  (data.accounts || []).forEach(a => push(a.name));
  (data.cards || []).forEach(c => { push(c.name); if (c.last4) { out.add("••" + c.last4); out.add(String(c.last4)); } });
  return [...out];
}

// Resolve which CARD an email is about by its NUMBER (last-4) only. Used to
// gate state changes (limit re-anchor, statement due) — a name match is too
// weak (promotional emails name cards too), so we demand the actual number.
function matchCardStrict(text, data) {
  const low = String(text || "").toLowerCase();
  const last4 = (low.match(/(?:xx|••|ending|account number|a\/c|acct|card no\.?|\*+)\s*[:.]?\s*x*(\d{4})\b/) || [])[1];
  if (!last4) return null;
  const c = (data.cards || []).find(c => c.last4 && String(c.last4) === last4);
  return c ? c.id : null;
}
// Pull a stated available-limit figure. Require a currency marker (Rs/INR/₹)
// right before the number so a card's last-4 between "limit" and the amount
// (e.g. "available limit on card ending 1234 is Rs 39,950") isn't grabbed.
function availFromText(text) {
  // Match many phrasings: available limit / available credit limit / available
  // credit / available balance / avl bal / avl lmt / avbl bal. Still require a
  // currency marker right before the number so a last-4 isn't mistaken for it.
  const m = String(text || "").match(/(?:available|avl|avbl)\.?\s*(?:credit\s*)?(?:limit|lmt|balance|bal|cr\.?\s*limit)\b[\s\S]{0,40}?(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d+)?)/i);
  return m ? +m[1].replace(/,/g, "") : null;
}
// The available figure stated in an email: prefer the AI's parsed number,
// fall back to the regex. Returns a non-negative number or null.
function statedAvail(o, text) {
  if (o && typeof o.availableLimit === "number" && isFinite(o.availableLimit) && o.availableLimit >= 0) return o.availableLimit;
  const r = availFromText(text);
  return r != null && r >= 0 ? r : null;
}

// Deterministic fallback: recover the TRANSACTION amount from an email when the
// AI misses it (returns amount 0). We collect every currency figure, DROP any
// that reads as an available-limit / balance / outstanding / due figure (the
// same class of number that inflated "Used"), then pick the one closest to a
// debit/credit/spent verb — and only if it's genuinely near one. Returns a
// positive number or null.
function txnAmountFromText(text) {
  const s = String(text || "");
  const verbRe = /\b(debited|credited|spent|withdrawn|purchased|paid|payment|received)\b/ig;
  const amtRe = /(?:rs\.?|inr|₹|usd|\$|eur|€|gbp|£)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/ig;
  const verbs = [];
  let vm; while ((vm = verbRe.exec(s))) verbs.push(vm.index);
  if (!verbs.length) return null;
  let best = null, bestDist = Infinity, am;
  while ((am = amtRe.exec(s))) {
    const pre = s.slice(Math.max(0, am.index - 16), am.index).toLowerCase();
    if (/(avail|avl|avbl|balance|\bbal\b|limit|lmt|outstanding|due)/.test(pre)) continue; // not the txn amount
    const n = +String(am[1]).replace(/,/g, "");
    if (!isFinite(n) || n <= 0) continue;
    const d = Math.min.apply(null, verbs.map(v => Math.abs(v - am.index)));
    if (d < bestDist) { bestDist = d; best = n; }
  }
  return bestDist <= 40 ? best : null; // must sit near a transaction verb
}
// Rough income/expense guess for a fallback stub (the user confirms in Review).
function guessTxnType(text) {
  const s = String(text || "").toLowerCase();
  if (/\b(credited|received|refund)\b/.test(s) && !/\b(debited|spent|withdrawn)\b/.test(s)) return "income";
  return "expense";
}
// Best account for a review stub: match the last-4 in the email ("A/c no.
// XX3774" → the account/card ending 3774) so it isn't blindly tagged to the
// first account. Falls back to the first account only when nothing matches.
// (Requires the account/card to have its last-4 saved in the app.)
function stubAccount(text, data) {
  const last4 = (String(text).match(/(?:xx|••|ending|account number|a\/c|acct|card no\.?|\*+)\s*[:.]?\s*x*(\d{4})\b/i) || [])[1];
  if (last4) {
    const acc = (data.accounts || []).find(a => a.last4 && String(a.last4) === last4);
    if (acc) return acc.id;
    const card = (data.cards || []).find(c => c.last4 && String(c.last4) === last4);
    if (card) return "card:" + card.id;
  }
  return (data.accounts && data.accounts[0] && data.accounts[0].id) || "";
}

// Build the PostgREST filter that finds the user by their ingest token.
// encodeURIComponent neutralises PostgREST metacharacters (& = , ( ) . etc.) so
// a crafted token can never break out of the eq.<token> filter to read or match
// other users' rows. All lookups MUST go through this helper.
function tokenFilter(token) { return `data->gmail->>token=eq.${encodeURIComponent(token)}`; }

async function parseEmail(text, data, opts) {
  const hints = ownHints(data || {});
  const ownLine = hints.length
    ? `\nThe user's OWN accounts/cards: ${hints.join(", ")}. If money simply moves between the user's own accounts, or it's a credit-card bill payment from the user's own bank, set "type":"transfer" and "category":"transfer" (NOT income/expense).`
    : "";
  const prompt = `Read this email and classify it. Respond ONLY JSON, no prose.

If it confirms a transaction that ALREADY HAPPENED (debited/credited/spent/received):
{"kind":"transaction","type":"income"|"expense"|"transfer","amount":<number>,"currency":"INR"|"USD"|"EUR"|"GBP","merchant":"<string>","account":"<string|null>","date":"YYYY-MM-DD","category":"<id or 'transfer'>","availableLimit":<number or null>,"confidence":<0-100>}

CRITICAL — "amount" is the value of THIS transaction ONLY: the exact money that moved (spent/debited/credited/received). It is NEVER the available balance, available credit limit, outstanding balance, total amount due, or reward points — those are different, usually larger, numbers that also appear in the email. For a credit-card spend, put the remaining available credit/limit/balance the email states (e.g. "Available limit Rs 1,17,000", "Avl Bal 39,950") into "availableLimit" as a plain number, and the amount actually spent into "amount". If no available figure is stated, set "availableLimit":null.

"merchant" must be a SHORT, human-friendly label a person instantly recognizes — the brand, payee, or purpose. CRITICAL: this is the OTHER party in the transaction (who you paid, or who paid you), NOT the bank or service that SENT the email. Ignore the email's sender/From line entirely — a debit alert from "HDFC Bank" about a payment to "Swiggy" has merchant "Swiggy", not "HDFC". Look inside the body for "paid to", "to VPA", "at <merchant>", "towards", "received from", the UPI handle, or the payee name. NEVER use raw bank names, reference numbers, or codes. If the only name you can find is a bank/card issuer (HDFC, ICICI, Axis, Kotak, SBI, Scapia, Federal, Amazon Pay, Amex, IDFC, Yes Bank, RBL, AU, IndusInd, etc.), that is the SENDER, not the merchant — do NOT use it; instead look harder in the body for the real payee, or use the UPI VPA, or return merchant "Unknown" so the app can fall back. Examples: "Swiggy", "House rent", "Skoda car EMI", "Salary". For a credit-card bill payment, name it "<card name> bill" using the user's card list (e.g. "Kotak Solitaire bill"). "account" is which of the user's accounts/cards the money moved on — if the email mentions a card (by name or last-4 digits), put that card's name and include its last 4 digits in "account" (e.g. "HDFC Infinia 0042"); copied from the user's list below if identifiable, else null.

If it announces a bill or payment that is DUE IN THE FUTURE (bill generated, statement ready with amount due, premium/EMI/recharge reminder, "pay by <date>"):
{"kind":"bill","amount":<number, the amount due>,"currency":"INR"|"USD"|"EUR"|"GBP","merchant":"<biller name>","dueDate":"YYYY-MM-DD","category":"<id>","confidence":<0-100>}
For a credit-card statement use the TOTAL amount due and category "cardpay". For utilities/phone/internet use "bills", insurance "health" or "bills", rent "rent", loan EMI "emi", subscriptions "subs".

Expense ids: ${EXP_CATS.join("/")}. Income ids: ${INC_CATS.join("/")}. Credits/salary/refund/interest=income; debits/purchases=expense.${ownLine} If no clear date use ${todayISO()}. If it's neither a real completed transaction nor a due bill — i.e. a promotion, OTP, pure balance/limit summary, or a DECLINED/FAILED/reversed transaction — return {"amount":0} (you may still include "availableLimit" if the email states one).
Email:
"""${String(text).slice(0, 2500)}"""`;
  // Cheap model by default; escalation (opts.strong) uses the stronger one to
  // recover a transaction the cheap pass misread.
  const model = (opts && opts.strong)
    ? (process.env.CLAUDE_MODEL || "claude-sonnet-5")
    : (process.env.CLAUDE_MODEL_FAST || "claude-haiku-4-5");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: model, max_tokens: 400, messages: [{ role: "user", content: prompt }] }),
  });
  // Upstream unreachable/erroring (bad key, exhausted credit, retired model,
  // rate limit, 5xx) is TRANSIENT — flag it so the caller returns parse_failed
  // and the Gmail forwarder retries later instead of losing the email.
  if (!r.ok) { const e = new Error("anthropic_http_" + r.status); e.transient = true; throw e; }
  const j = await r.json();
  if (j && j.type === "error") { const e = new Error("anthropic_error"); e.transient = true; throw e; }
  let raw = ((j.content || []).map(b => b.text || "").join("")).trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  const m = raw.match(/\{[\s\S]*\}/);
  // The model replied but we couldn't parse JSON out of it — NOT transient.
  return JSON.parse(m ? m[0] : raw);
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY || !process.env.ANTHROPIC_API_KEY) return json(500, { error: "Server missing env vars." });
  let body; try { body = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Bad JSON" }); }
  const token = event.headers["x-ingest-token"] || body.token || "";
  const text = body.text || body.body || "";
  if (!token) return json(401, { error: "Missing ingest token" });
  if (!text.trim()) return json(400, { error: "Missing email text" });

  // find the user whose data.gmail.token matches
  const rows = await sbGet(`app_state?select=user_id,data&${tokenFilter(token)}`);
  if (!rows || !rows.length) return json(403, { error: "Unknown ingest token" });
  const { user_id, data } = rows[0];

  let o;
  try {
    o = await parseEmail(text, data);
  } catch (e) {
    // Transient upstream failure (outage / billing / rate limit): tell the
    // forwarder to retry later — book nothing, so the email is neither lost
    // nor later duplicated when the retry succeeds.
    if (e && e.transient) return json(200, { ok: false, reason: "parse_failed" });
    // The model responded but its output couldn't be parsed. Rather than drop
    // the email silently, surface it in the Review inbox as a stub the user can
    // see, edit and confirm — and mark it handled so the forwarder won't retry.
    const stub = {
      id: uid(), type: "expense", amount: 0,
      currency: "INR", merchant: "Unparsed bank email — needs review",
      category: "uncat", account: stubAccount(text, data),
      date: todayISO(), note: String(text || "").slice(0, 400),
      source: "gmail", status: "pending", confidence: 0, tags: ["parse-failed"],
    };
    const next = JSON.parse(JSON.stringify(data));
    next.pending = [stub, ...(next.pending || [])];
    try { await sbPatch(user_id, next); } catch (e2) { return json(200, { ok: false, reason: "parse_failed" }); }
    return json(200, { ok: true, booked: "pending_unparsed" });
  }
  let amt = Math.abs(+String(o.amount).replace(/[^0-9.]/g, "")) || 0;

  // Escalate-on-miss: the cheap model returned no amount, but the email clearly
  // states a transaction amount next to a debit/credit/spent verb. Re-parse this
  // ONE email on the stronger model to recover the FULL details (payee, account,
  // category) — not just a bare amount. Fires rarely (only on a real miss), so
  // it keeps the cost savings while restoring accuracy where it matters.
  if (!amt && txnAmountFromText(text) != null) {
    try {
      const o2 = await parseEmail(text, data, { strong: true });
      const amt2 = Math.abs(+String(o2.amount).replace(/[^0-9.]/g, "")) || 0;
      if (amt2) { o = o2; amt = amt2; }
    } catch (e) { /* keep the cheap result; the deterministic fallback below still applies */ }
  }

  // ---- card-side updates that can ride on ANY email, transaction or not ----
  // (1) a stated available limit re-anchors the card; (2) a statement due date
  // (handled in the bill branch) updates the card's next-due fields.
  const cardUpdates = {}; // cid -> partial card patch
  const mCid = matchCardStrict(text, data); // number-verified: no last-4 → no limit/statement change
  const mAvail = statedAvail(o, text);
  if (mCid && mAvail != null) {
    const card0 = (data.cards || []).find(c => c.id === mCid);
    const lim0 = card0 && card0.limit ? card0.limit : 0;
    cardUpdates[mCid] = { ...(cardUpdates[mCid] || {}), availAnchor: mAvail, availAnchorDate: todayISO(), availAnchorExact: true };
    if (lim0 > 0) cardUpdates[mCid].balance = Math.max(0, lim0 - mAvail);
  }
  const applyCardUpdates = (next) => {
    const ids = Object.keys(cardUpdates);
    if (ids.length) next.cards = (next.cards || []).map(c => cardUpdates[c.id] ? { ...c, ...cardUpdates[c.id] } : c);
    return next;
  };

  if (!amt) {
    // The model returned no amount. Before giving up, try to RECOVER a real
    // transaction it misread: if the email states an amount next to a
    // debit/credit/spent verb, surface it in the Review inbox as a stub the
    // user can confirm or fix — never drop a genuine transaction silently.
    const fbAmt = txnAmountFromText(text);
    if (fbAmt != null) {
      const stub = {
        id: uid(), type: guessTxnType(text), amount: fbAmt, currency: "INR",
        merchant: (extractUpiPayee(text) || extractVPA(text) || "Bank transaction — needs review").slice(0, 80),
        category: "uncat",
        account: stubAccount(text, data),
        date: todayISO(), note: String(text || "").slice(0, 400),
        source: "gmail", status: "pending", confidence: 0, tags: ["ai-missed"],
      };
      // don't stack stubs if this same email is re-forwarded
      const existing0 = [...(data.transactions || []), ...(data.pending || [])];
      if (existing0.some(t => txnKey(t) === txnKey(stub))) {
        return json(200, { ok: true, booked: "duplicate_skipped", merchant: stub.merchant, amount: fbAmt });
      }
      const next = applyCardUpdates(JSON.parse(JSON.stringify(data)));
      next.pending = [stub, ...(next.pending || [])];
      await sbPatch(user_id, next);
      return json(200, { ok: true, booked: "pending_fallback", merchant: stub.merchant, amount: fbAmt });
    }
    if (Object.keys(cardUpdates).length) {
      const next = applyCardUpdates(JSON.parse(JSON.stringify(data)));
      await sbPatch(user_id, next);
      return json(200, { ok: true, booked: "card_limit_updated" });
    }
    return json(200, { ok: false, reason: "not_a_transaction" });
  }

  // ---- upcoming bill (due in the future) → upcomingBills, not the ledger ----
  if (o.kind === "bill") {
    const due = /^\d{4}-\d{2}-\d{2}$/.test(o.dueDate) ? o.dueDate : null;
    if (!due) return json(200, { ok: false, reason: "bill_without_due_date" });
    const bill = {
      id: uid(), merchant: (o.merchant || "Bill").slice(0, 80), amount: amt,
      currency: SYMOK(o.currency) ? o.currency : "INR",
      dueDate: due, category: catOk(o.category) ? o.category : "bills",
      source: "gmail", detectedAt: todayISO(),
    };
    const next = JSON.parse(JSON.stringify(data));
    next.upcomingBills = next.upcomingBills || [];
    // dedupe: same biller + same due date (reminder emails repeat), or same biller+amount
    const k = (b) => (b.merchant || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 14);
    const dup = next.upcomingBills.some(b => k(b) === k(bill) && (b.dueDate === bill.dueDate || Math.round(b.amount) === Math.round(bill.amount)));
    if (dup) return json(200, { ok: true, booked: "bill_duplicate", merchant: bill.merchant, amount: amt });
    // A credit-card statement: also stamp the due amount + real due DATE onto
    // the matching card so the Cards table shows the actual statement due date.
    if (bill.category === "cardpay" && mCid) {
      cardUpdates[mCid] = { ...(cardUpdates[mCid] || {}), stmtAmount: amt, stmtDueDate: due };
    }
    // drop stale bills (past due by > 30 days) while we're here
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    next.upcomingBills = [bill, ...next.upcomingBills.filter(b => b.dueDate >= cutoff)].slice(0, 30);
    applyCardUpdates(next);
    await sbPatch(user_id, next);
    return json(200, { ok: true, booked: "upcoming_bill", merchant: bill.merchant, amount: amt, dueDate: due });
  }

  const type = o.type === "income" ? "income" : o.type === "transfer" ? "transfer" : "expense";

  // friendly name: user's rename rules override the AI's label
  const BANKISH = /^(hdfc|icici|axis|kotak|sbi|state bank|scapia|federal|amazon pay|amex|american express|idfc|yes bank|rbl|au small|au bank|indusind|citi|hsbc|standard chartered|pnb|canara|bob|bank of baroda|union bank)\b/i;
  // generic non-name labels a model sometimes returns instead of the real payee
  const GENERIC = /^(transaction|upi(\s*(payment|transaction|transfer))?|payment|transfer|fund transfer|debit|credit|spent|purchase|unknown)\.?$/i;
  const upiPayee = extractUpiPayee(text);
  const vpa = extractVPA(text);
  const llmM = String(o.merchant || "").trim();
  // Trust the model's merchant only when it's a real, specific name. If it's
  // blank, generic ("Transaction"), or a bank/issuer name, fall back to the
  // payee parsed straight from the UPI string (authoritative), then the VPA.
  let merchant = ((llmM && !GENERIC.test(llmM) && !BANKISH.test(llmM)) ? llmM : (upiPayee || vpa || llmM || "Transaction")).slice(0, 80);
  // final guard: a bank name with a known UPI payee → use the payee
  if (BANKISH.test(merchant) && upiPayee) merchant = upiPayee.slice(0, 80);
  let catOverride = null;
  const lowM = merchant.toLowerCase();
  for (const r of (data.renameRules || [])) {
    if (r.match && lowM.includes(String(r.match).toLowerCase())) { merchant = (r.name || merchant).slice(0, 80); catOverride = r.category || null; break; }
  }

  // account/card attribution: match the AI's "account" string (and any ••last4
  // in the email) to one of the user's accounts or CARDS. Card spends are
  // booked onto the card itself (account = "card:<id>").
  let accountId = (data.accounts && data.accounts[0] && data.accounts[0].id) || "";
  let note = "Gmail import";
  let payToCardId = null; // set when this is a payment TOWARDS one of the user's cards
  // last-4 from formats like "XX3774", "xx 3774", "ending 3774", "A/c ...3774", "••3774", "****3774"
  const last4 = (String(text).match(/(?:xx|••|ending|account number|a\/c|acct|card no\.?|\*+)\s*[:.]?\s*x*(\d{4})\b/i) || [])[1];
  if (o.account || last4) {
    const want = String(o.account || "").toLowerCase();
    // match a bank account by name OR by last-4 (if the account has one stored)
    const acc = (data.accounts || []).find(a =>
      (last4 && a.last4 && String(a.last4) === last4) ||
      (a.name && want && (want.includes(a.name.toLowerCase()) || a.name.toLowerCase().includes(want)))
    );
    const card = (data.cards || []).find(c =>
      (last4 && c.last4 && String(c.last4) === last4) ||
      (c.name && want && (want.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(want)))
    );
    // a card spend (expense on a card) should sit on the card; a payment FROM a
    // bank stays on the bank account. Prefer an exact last-4 account match.
    if (card && type === "expense" && (!acc || (last4 && String(card.last4) === last4))) { accountId = "card:" + card.id; note = "Gmail import"; }
    else if (acc) accountId = acc.id;
    else if (card && type === "expense") { accountId = "card:" + card.id; }
    // a transfer that pays a card bill: keep the money leaving the bank, but
    // credit the CARD via toAccount so its available limit is restored.
    if (card && type === "transfer") payToCardId = "card:" + card.id;
  }

  const txn = {
    id: uid(), type, amount: amt,
    currency: SYMOK(o.currency) ? o.currency : "INR",
    merchant,
    category: type === "transfer" ? "transfer" : (catOverride && catOk(catOverride) ? catOverride : (catOk(o.category) ? o.category : "uncat")),
    account: accountId,
    ...(payToCardId ? { toAccount: payToCardId } : {}),
    date: /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : todayISO(),
    note, source: "gmail", confidence: o.confidence || 0, tags: [],
  };

  // Duplicate guard: banks send several emails for one transaction (debit
  // alert + receipt, bank + biller). Skip if an equivalent txn already exists
  // in the ledger or the review inbox — same date, type, amount, and merchant.
  const existing = [...(data.transactions || []), ...(data.pending || [])];
  if (existing.some(t => txnKey(t) === txnKey(txn))) {
    return json(200, { ok: true, booked: "duplicate_skipped", merchant: txn.merchant, amount: amt });
  }
  // Fuzzy guard: one purchase often arrives as TWO gmail emails with different
  // merchant text — e.g. a Swiggy Instamart order that sends both an "Instamart"
  // receipt and a bank/card alert reading "Swiggy". The exact-merchant guard
  // above can't catch those, so match on date + type + exact amount instead.
  if (existing.some(t => isFuzzyDup(txn, t))) {
    return json(200, { ok: true, booked: "duplicate_skipped_fuzzy", merchant: txn.merchant, amount: amt });
  }
  // Self-transfer guard: moving money between your OWN accounts produces TWO
  // emails — a debit on the source and a credit on the destination — which the
  // parsers may classify as different types (transfer + income). If this looks
  // like a transfer, or an income/expense that pairs with an existing transfer
  // of the same amount & day, treat the two as one transfer and skip the twin.
  if (amt >= 500) {
    const sameDayAmt = (t) => t.source === "gmail" && t.date === txn.date && Math.abs((+t.amount || 0) - amt) < 0.01;
    const thisIsTransferish = txn.type === "transfer" || looksLikeTransfer(text, data);
    // a) a transfer with the same day + amount already exists → this email is the
    //    partner leg of that self-transfer (the credit side, or a mis-typed twin).
    //    Skip it whether it's typed income/expense OR also looks transfer-ish, so a
    //    single self-transfer never books twice.
    if (existing.some(t => t.type === "transfer" && sameDayAmt(t))) {
      return json(200, { ok: true, booked: "skipped_transfer_twin", merchant: txn.merchant, amount: amt });
    }
    // b) this looks like a transfer but an income/expense twin was booked first →
    //    promote this to the transfer and drop the mis-booked twin.
    if (thisIsTransferish && existing.some(t => (t.type === "income" || t.type === "expense") && sameDayAmt(t))) {
      // promote: remove the mis-booked twin, keep this as the transfer
      const next = JSON.parse(JSON.stringify(data));
      next.transactions = (next.transactions || []).filter(t => !((t.type === "income" || t.type === "expense") && t.source === "gmail" && t.date === txn.date && Math.abs((+t.amount || 0) - amt) < 0.01));
      txn.type = "transfer"; txn.category = "transfer"; txn.status = "auto";
      next.transactions = [txn, ...next.transactions].sort((a, b) => b.date.localeCompare(a.date));
      await sbPatch(user_id, next);
      return json(200, { ok: true, booked: "transfer_merged", merchant: txn.merchant, amount: amt });
    }
  }

  // Email-verified available: anchor the card this spend sits on to the stated
  // available figure (ground truth) as of the txn date. The spend still books
  // for analytics; the exact anchor keeps available trusted from the bank, not
  // just derived — so a mis-read amount can't quietly corrupt the limit.
  if (mAvail != null) {
    let cid = mCid;
    if (!cid && String(accountId).indexOf("card:") === 0) cid = String(accountId).slice(5);
    if (cid) {
      const card = (data.cards || []).find(c => c.id === cid);
      const lim = card && card.limit ? card.limit : 0;
      cardUpdates[cid] = { ...(cardUpdates[cid] || {}), availAnchor: mAvail, availAnchorDate: txn.date, availAnchorExact: true };
      if (lim > 0) cardUpdates[cid].balance = Math.max(0, lim - mAvail);
    }
  }

  const threshold = (data.gmail && data.gmail.autoThreshold) != null ? data.gmail.autoThreshold : 70;
  const autoBook = (o.confidence || 0) >= threshold;

  // ---- DB-enforced dedup (the new authority) ----
  // Claim this transaction's identity in the transactions table. If the
  // dedup_key already exists, the database rejects it and we stop — a duplicate
  // never reaches the ledger, no matter how the two emails were worded. If the
  // table is unreachable we FAIL OPEN (book anyway; the legacy heuristics above
  // already ran), so a DB hiccup can never lose a real transaction.
  const ehash = emailHash(text);
  const bankRef = extractBankRef(text);
  // Phase 1 dedupes on the SYNTHETIC key (date + direction + amount + normalized
  // merchant). The two emails for one purchase — a bank alert and a merchant
  // receipt — usually DON'T share a reference, so keying on bank_ref would split
  // them. We still STORE bank_ref for a future exact-match layer (Phase 2).
  const key = dedupKey({ date: txn.date, type: txn.type, amount: txn.amount, merchant: txn.merchant });
  const claim = await sbClaimTxn(user_id, txn, key, bankRef, autoBook ? "booked" : "review");
  if (claim && claim.inserted === false && !claim.error) {
    await sbLogEvent(user_id, ehash, "duplicate", null);
    return json(200, { ok: true, booked: "duplicate_db", merchant: txn.merchant, amount: amt });
  }

  const next = JSON.parse(JSON.stringify(data));
  // apply any available-limit re-anchor / statement-due updates gathered above
  applyCardUpdates(next);
  if (autoBook) { txn.status = "auto"; next.transactions = [txn, ...(next.transactions || [])].sort((a, b) => b.date.localeCompare(a.date)); }
  else { txn.status = "pending"; next.pending = [txn, ...(next.pending || [])]; }
  await sbPatch(user_id, next);
  await sbLogEvent(user_id, ehash, autoBook ? "booked" : "review", claim && claim.id);
  return json(200, { ok: true, booked: autoBook ? "auto" : "pending", merchant: txn.merchant, amount: amt });
};

function SYMOK(c) { return ["INR", "USD", "EUR", "GBP"].includes(c); }
function catOk(c) { return EXP_CATS.includes(c) || INC_CATS.includes(c); }
function txnKey(t) {
  const merch = String(t.merchant || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 14);
  return [t.date, t.type, Math.round(Math.abs(+t.amount) || 0), merch].join("|");
}
// True if existing gmail txn `t` is the SAME payment as `txn`: same day, same
// type, same amount to the paisa. Since one order can arrive as two emails with
// different merchant text, we can't compare merchants — so we require an extra
// signal to avoid merging two genuinely different buys: EITHER the amount is
// large (≥ ₹1000, where an exact same-day coincidence is very unlikely) OR the
// category is identical (both "groceries" for the two halves of one order).
// Merchants that are the SAME company and routinely send two emails for one
// order under different names (a food receipt + a bank/quick-commerce alert),
// so the two halves often carry different merchant text AND different category.
// Grouping them lets the fuzzy guard merge e.g. "Swiggy" + "Instamart".
const BRAND_FAMILIES = [
  ["swiggy", "instamart"],   // Swiggy owns Instamart
  ["zomato", "blinkit"],     // Zomato owns Blinkit
];
function brandFamily(merchant) {
  const m = String(merchant || "").toLowerCase();
  for (const fam of BRAND_FAMILIES) if (fam.some(k => m.includes(k))) return fam[0];
  return null;
}
function sameBrandFamily(m1, m2) {
  const f = brandFamily(m1);
  return !!f && f === brandFamily(m2);
}
function isFuzzyDup(txn, t) {
  if (!t || t.source !== "gmail") return false;
  if (t.date !== txn.date || t.type !== txn.type) return false;
  const a = +txn.amount || 0;
  if (Math.abs((+t.amount || 0) - a) >= 0.01) return false;
  // Same day + type + exact amount, and one of: a large amount (coincidence
  // unlikely), the SAME category, or two merchants from the same brand family
  // (Swiggy/Instamart) — the last catches an order split across two emails with
  // different names AND categories.
  return a >= 1000
    || (!!t.category && !!txn.category && t.category === txn.category)
    || sameBrandFamily(t.merchant, txn.merchant);
}

// Test-only: expose pure internals for the offline unit-test suite. Netlify's
// function runtime only ever calls exports.handler, so this has no runtime effect.
module.exports.__test = {
  tokenFilter, cleanPayee, extractVPA, extractUpiPayee, looksLikeTransfer,
  matchCardStrict, availFromText, statedAvail, txnAmountFromText, guessTxnType,
  stubAccount, txnKey, isFuzzyDup, brandFamily, sameBrandFamily, SYMOK, catOk,
};
