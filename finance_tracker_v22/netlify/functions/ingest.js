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

async function parseEmail(text, data) {
  const hints = ownHints(data || {});
  const ownLine = hints.length
    ? `\nThe user's OWN accounts/cards: ${hints.join(", ")}. If money simply moves between the user's own accounts, or it's a credit-card bill payment from the user's own bank, set "type":"transfer" and "category":"transfer" (NOT income/expense).`
    : "";
  const prompt = `Read this email and classify it. Respond ONLY JSON, no prose.

If it confirms a transaction that ALREADY HAPPENED (debited/credited/spent/received):
{"kind":"transaction","type":"income"|"expense"|"transfer","amount":<number>,"currency":"INR"|"USD"|"EUR"|"GBP","merchant":"<string>","account":"<string|null>","date":"YYYY-MM-DD","category":"<id or 'transfer'>","confidence":<0-100>}

"merchant" must be a SHORT, human-friendly label a person instantly recognizes — the brand, payee, or purpose. CRITICAL: this is the OTHER party in the transaction (who you paid, or who paid you), NOT the bank or service that SENT the email. Ignore the email's sender/From line entirely — a debit alert from "HDFC Bank" about a payment to "Swiggy" has merchant "Swiggy", not "HDFC". Look inside the body for "paid to", "to VPA", "at <merchant>", "towards", "received from", the UPI handle, or the payee name. NEVER use raw bank names, reference numbers, or codes. Examples: "Swiggy", "House rent", "Skoda car EMI", "Salary". For a credit-card bill payment, name it "<card name> bill" using the user's card list (e.g. "Kotak Solitaire bill"). "account" is which of the user's accounts/cards the money moved on — if the email mentions a card (by name or last-4 digits), put that card's name and include its last 4 digits in "account" (e.g. "HDFC Infinia 0042"); copied from the user's list below if identifiable, else null.

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
  if (!amt) return json(200, { ok: false, reason: "not_a_transaction" });

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
    // drop stale bills (past due by > 30 days) while we're here
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    next.upcomingBills = [bill, ...next.upcomingBills.filter(b => b.dueDate >= cutoff)].slice(0, 30);
    await sbPatch(user_id, next);
    return json(200, { ok: true, booked: "upcoming_bill", merchant: bill.merchant, amount: amt, dueDate: due });
  }

  const type = o.type === "income" ? "income" : o.type === "transfer" ? "transfer" : "expense";

  // friendly name: user's rename rules override the AI's label
  let merchant = ((o.merchant && o.merchant.toLowerCase() !== "unknown") ? o.merchant : (extractVPA(text) || "Transaction")).slice(0, 80);
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
  const last4 = (String(text).match(/(?:xx|••|ending|card no\.?|\*+)\s*(\d{4})\b/i) || [])[1];
  if (o.account || last4) {
    const want = String(o.account || "").toLowerCase();
    const acc = (data.accounts || []).find(a => a.name && (want.includes(a.name.toLowerCase()) || a.name.toLowerCase().includes(want)));
    const card = (data.cards || []).find(c =>
      (last4 && c.last4 && String(c.last4) === last4) ||
      (c.name && want && (want.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(want)))
    );
    // a card spend (expense on a card) should sit on the card; a payment FROM a
    // bank stays on the bank account
    if (card && type === "expense") { accountId = "card:" + card.id; note = "Gmail import"; }
    else if (acc) accountId = acc.id;
    else if (card) note = "Gmail import · " + card.name;
  }

  const txn = {
    id: uid(), type, amount: amt,
    currency: SYMOK(o.currency) ? o.currency : "INR",
    merchant,
    category: type === "transfer" ? "transfer" : (catOverride && catOk(catOverride) ? catOverride : (catOk(o.category) ? o.category : "uncat")),
    account: accountId,
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
    // a) this is a transfer and a plain income/expense twin already exists → drop the twin by not adding a second record (we keep the transfer; if the twin is already booked, leave it but don't add another)
    // b) this is income/expense but a transfer twin already exists → skip this one
    if (!thisIsTransferish && existing.some(t => t.type === "transfer" && sameDayAmt(t))) {
      return json(200, { ok: true, booked: "skipped_transfer_twin", merchant: txn.merchant, amount: amt });
    }
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
  // credit-limit anchoring: if the email states an available limit, re-anchor the card
  const availMatch = String(text).match(/available\s+(?:credit\s+)?limit[^0-9₹]*₹?\s*([\d,]+)/i);
  if (availMatch && accountId.startsWith("card:")) {
    const cid = accountId.slice(5);
    const availVal = +availMatch[1].replace(/,/g, "");
    if (availVal > 0) next.cards = (next.cards || []).map(c => c.id === cid ? { ...c, availAnchor: availVal, availAnchorDate: txn.date } : c);
  }
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
