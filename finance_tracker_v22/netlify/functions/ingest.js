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
  const m = String(text || "").match(/available\s+(?:credit\s+)?limit\b[\s\S]{0,60}?(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d+)?)/i);
  return m ? +m[1].replace(/,/g, "") : null;
}

async function parseEmail(text, data) {
  const hints = ownHints(data || {});
  const ownLine = hints.length
    ? `\nThe user's OWN accounts/cards: ${hints.join(", ")}. If money simply moves between the user's own accounts, or it's a credit-card bill payment from the user's own bank, set "type":"transfer" and "category":"transfer" (NOT income/expense).`
    : "";
  const prompt = `Read this email and classify it. Respond ONLY JSON, no prose.

If it confirms a transaction that ALREADY HAPPENED (debited/credited/spent/received):
{"kind":"transaction","type":"income"|"expense"|"transfer","amount":<number>,"currency":"INR"|"USD"|"EUR"|"GBP","merchant":"<string>","account":"<string|null>","date":"YYYY-MM-DD","category":"<id or 'transfer'>","confidence":<0-100>}

"merchant" must be a SHORT, human-friendly label a person instantly recognizes — the brand, payee, or purpose. CRITICAL: this is the OTHER party in the transaction (who you paid, or who paid you), NOT the bank or service that SENT the email. Ignore the email's sender/From line entirely — a debit alert from "HDFC Bank" about a payment to "Swiggy" has merchant "Swiggy", not "HDFC". Look inside the body for "paid to", "to VPA", "at <merchant>", "towards", "received from", the UPI handle, or the payee name. NEVER use raw bank names, reference numbers, or codes. If the only name you can find is a bank/card issuer (HDFC, ICICI, Axis, Kotak, SBI, Scapia, Federal, Amazon Pay, Amex, IDFC, Yes Bank, RBL, AU, IndusInd, etc.), that is the SENDER, not the merchant — do NOT use it; instead look harder in the body for the real payee, or use the UPI VPA, or return merchant "Unknown" so the app can fall back. Examples: "Swiggy", "House rent", "Skoda car EMI", "Salary". For a credit-card bill payment, name it "<card name> bill" using the user's card list (e.g. "Kotak Solitaire bill"). "account" is which of the user's accounts/cards the money moved on — if the email mentions a card (by name or last-4 digits), put that card's name and include its last 4 digits in "account" (e.g. "HDFC Infinia 0042"); copied from the user's list below if identifiable, else null.

If it announces a bill or payment that is DUE IN THE FUTURE (bill generated, statement ready with amount due, premium/EMI/recharge reminder, "pay by <date>"):
{"kind":"bill","amount":<number, the amount due>,"currency":"INR"|"USD"|"EUR"|"GBP","merchant":"<biller name>","dueDate":"YYYY-MM-DD","category":"<id>","confidence":<0-100>}
For a credit-card statement use the TOTAL amount due and category "cardpay". For utilities/phone/internet use "bills", insurance "health" or "bills", rent "rent", loan EMI "emi", subscriptions "subs".

Expense ids: ${EXP_CATS.join("/")}. Income ids: ${INC_CATS.join("/")}. Credits/salary/refund/interest=income; debits/purchases=expense.${ownLine} If no clear date use ${todayISO()}. If it's neither (promotions, OTPs, balance summaries), return {"amount":0}.
Email:
"""${String(text).slice(0, 2500)}"""`;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: process.env.CLAUDE_MODEL || "claude-sonnet-4-6", max_tokens: 400, messages: [{ role: "user", content: prompt }] }),
  });
  const j = await r.json();
  let raw = ((j.content || []).map(b => b.text || "").join("")).trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  const m = raw.match(/\{[\s\S]*\}/); return JSON.parse(m ? m[0] : raw);
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
  const rows = await sbGet(`app_state?select=user_id,data&data->gmail->>token=eq.${encodeURIComponent(token)}`);
  if (!rows || !rows.length) return json(403, { error: "Unknown ingest token" });
  const { user_id, data } = rows[0];

  let o; try { o = await parseEmail(text, data); } catch (e) { return json(200, { ok: false, reason: "parse_failed" }); }
  const amt = Math.abs(+String(o.amount).replace(/[^0-9.]/g, "")) || 0;

  // ---- card-side updates that can ride on ANY email, transaction or not ----
  // (1) a stated available limit re-anchors the card; (2) a statement due date
  // (handled in the bill branch) updates the card's next-due fields.
  const cardUpdates = {}; // cid -> partial card patch
  const mCid = matchCardStrict(text, data); // number-verified: no last-4 → no limit/statement change
  const mAvail = availFromText(text);
  if (mCid && mAvail != null && mAvail >= 0) cardUpdates[mCid] = { ...(cardUpdates[mCid] || {}), availAnchor: mAvail, availAnchorDate: todayISO(), availAnchorExact: true };
  const applyCardUpdates = (next) => {
    const ids = Object.keys(cardUpdates);
    if (ids.length) next.cards = (next.cards || []).map(c => cardUpdates[c.id] ? { ...c, ...cardUpdates[c.id] } : c);
    return next;
  };

  if (!amt) {
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
  // Fuzzy guard: bank alert and biller receipt for the SAME payment often use
  // different merchant text. If a gmail-sourced txn with the same date, type,
  // and exact amount (≥ ₹1000, where coincidences are unlikely) already
  // exists, treat this as the same payment.
  if (amt >= 1000 && existing.some(t => t.source === "gmail" && t.date === txn.date && t.type === txn.type && Math.abs((+t.amount || 0) - amt) < 0.01)) {
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

  const threshold = (data.gmail && data.gmail.autoThreshold) != null ? data.gmail.autoThreshold : 70;
  const autoBook = (o.confidence || 0) >= threshold;
  const next = JSON.parse(JSON.stringify(data));
  // apply any available-limit re-anchor / statement-due updates gathered above
  applyCardUpdates(next);
  if (autoBook) { txn.status = "auto"; next.transactions = [txn, ...(next.transactions || [])].sort((a, b) => b.date.localeCompare(a.date)); }
  else { txn.status = "pending"; next.pending = [txn, ...(next.pending || [])]; }
  await sbPatch(user_id, next);
  return json(200, { ok: true, booked: autoBook ? "auto" : "pending", merchant: txn.merchant, amount: amt });
};

function SYMOK(c) { return ["INR", "USD", "EUR", "GBP"].includes(c); }
function catOk(c) { return EXP_CATS.includes(c) || INC_CATS.includes(c); }
function txnKey(t) {
  const merch = String(t.merchant || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 14);
  return [t.date, t.type, Math.round(Math.abs(+t.amount) || 0), merch].join("|");
}
