/* ============================================================
   netlify/functions/backfill-transactions.js
   One-time (idempotent) migration: copy each user's existing blob
   transactions (app_state.data.transactions) into the new
   public.transactions table, with the SAME dedup_key the live
   ingest path computes. Safe to re-run — inserts use ON CONFLICT
   DO NOTHING, so nothing is ever duplicated or overwritten.

   This changes NOTHING in the app — it only populates the table so
   the DB dedup also knows about your history (and later phases can
   read from it). The Review inbox (data.pending) is intentionally
   left in the blob for now.

   Protected. Trigger once:
     /api/backfill-transactions?key=<EMAIL_TEST_SECRET>
   ============================================================ */
const { dedupKey } = require("./lib/dedup.js");

function resp(code, obj) { return { statusCode: code, headers: { "content-type": "application/json" }, body: JSON.stringify(obj) }; }

async function fetchAllStates() {
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/app_state?select=user_id,data`, {
    headers: { apikey: process.env.SUPABASE_SERVICE_KEY, authorization: "Bearer " + process.env.SUPABASE_SERVICE_KEY },
  });
  if (!r.ok) throw new Error("load app_state " + r.status);
  return r.json();
}

// Map a blob transaction to a transactions-table row. Returns null if it lacks
// a usable date (occurred_on is NOT NULL). The dedup_key is computed EXACTLY as
// the live ingest path computes it, so a future email duplicate of a backfilled
// transaction conflicts correctly.
function rowFor(userId, t) {
  const date = String(t.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const type = t.type === "income" ? "income" : t.type === "transfer" ? "transfer" : "expense";
  return {
    user_id: userId,
    dedup_key: dedupKey({ date: date, type: t.type, amount: t.amount, merchant: t.merchant }),
    occurred_on: date,
    amount: Math.abs(+t.amount || 0),
    currency: ["INR", "USD", "EUR", "GBP"].includes(t.currency) ? t.currency : "INR",
    direction: type === "income" ? "credit" : "debit",
    type: type,
    merchant: t.merchant || null,
    category: t.category || null,
    account_ref: t.account || null,
    bank_ref: null,
    status: "booked",
    confidence: t.confidence != null ? t.confidence : null,
    source: t.source || "backfill",
    raw: t,
  };
}

async function insertChunk(rows) {
  if (!rows.length) return 0;
  const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/transactions?on_conflict=user_id,dedup_key`, {
    method: "POST",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_KEY,
      authorization: "Bearer " + process.env.SUPABASE_SERVICE_KEY,
      "content-type": "application/json",
      prefer: "return=representation,resolution=ignore-duplicates",
    },
    body: JSON.stringify(rows),
  });
  if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error("insert " + r.status + " " + t.slice(0, 200)); }
  const arr = await r.json().catch(() => []);
  return Array.isArray(arr) ? arr.length : 0; // representation returns ONLY newly-inserted rows
}

exports.handler = async (event) => {
  const key = (event.queryStringParameters && event.queryStringParameters.key) || "";
  const secret = process.env.EMAIL_TEST_SECRET || "";
  if (!secret) return resp(500, { error: "Set EMAIL_TEST_SECRET in Netlify env to run the backfill." });
  if (key !== secret) return resp(401, { error: "Bad or missing ?key= secret." });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return resp(500, { error: "Missing Supabase env vars." });

  let states;
  try { states = await fetchAllStates(); } catch (e) { return resp(500, { error: "Load failed: " + String(e && e.message || e) }); }

  let users = 0, blobTxns = 0, inserted = 0, invalidDate = 0;
  try {
    for (const row of states || []) {
      const data = row.data || {};
      const txns = Array.isArray(data.transactions) ? data.transactions : [];
      if (!txns.length) continue;
      users++;
      const rows = [];
      for (const t of txns) {
        blobTxns++;
        const built = rowFor(row.user_id, t);
        if (built) rows.push(built); else invalidDate++;
      }
      for (let i = 0; i < rows.length; i += 200) {
        inserted += await insertChunk(rows.slice(i, i + 200));
      }
    }
  } catch (e) {
    return resp(500, { error: "Backfill failed partway: " + String(e && e.message || e), partial: { users, blobTxns, inserted } });
  }

  return resp(200, {
    ok: true,
    users,
    blobTxns,
    inserted,
    skippedAsDuplicate: blobTxns - invalidDate - inserted, // already in the table, or a duplicate within the blob
    invalidDate,
    note: "Idempotent — re-running inserts only what's missing. skippedAsDuplicate includes pre-existing blob duplicates that collapse to one row.",
  });
};
