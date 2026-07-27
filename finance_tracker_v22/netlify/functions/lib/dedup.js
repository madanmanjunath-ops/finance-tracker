/* ============================================================
   netlify/functions/lib/dedup.js
   The identity + dedup core for the new ingestion model.

   The whole redesign rests on ONE idea: give every transaction a
   stable `dedup_key`, and let the database enforce that a user
   can't have two rows with the same key. Duplicates then become
   impossible regardless of how many emails describe one payment.

   This module is pure (no I/O) so it's trivially testable. It's a
   library file in a subfolder, so Netlify does NOT expose it as a
   function endpoint — ingest.js will `require("./lib/dedup.js")`.
   ============================================================ */

// Merchants that are the SAME company and split one order across two emails
// under different names (a food receipt + a quick-commerce/bank alert). Kept as
// DATA, not code branches — extend this list, never the logic.
const BRAND_FAMILIES = [
  ["swiggy", "instamart"],   // Swiggy owns Instamart
  ["zomato", "blinkit"],     // Zomato owns Blinkit
];

// Normalize a merchant to a stable token: lowercase, strip punctuation, and
// collapse a brand family to its canonical name (so "Swiggy" and "Instamart"
// both become "swiggy"). This is what makes the synthetic key match the two
// halves of one order.
function normalizeMerchant(m) {
  const s = String(m || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  for (const fam of BRAND_FAMILIES) if (fam.some(k => s.includes(k))) return fam[0];
  return s;
}

// Pull the bank's OWN reference for a transaction (UPI RRN, UTR, txn id). This
// is the gold-standard dedup signal: two emails for one payment share it, and
// it's completely bank-agnostic. Returns a normalized string or null.
function extractBankRef(text) {
  const s = String(text || "");
  // A 12-digit UPI reference/RRN, tagged as UPI / Ref / RRN.
  let m = s.match(/\b(?:upi(?:\s*(?:ref(?:erence)?(?:\s*(?:no|number))?|rrn|txn|id))?)[\s:/#-]{0,4}(\d{12})\b/i);
  if (m) return "upi:" + m[1];
  // A labelled reference/UTR/txn id: 8–22 alphanumerics after an explicit label.
  m = s.match(/\b(?:rrn|utr|ref(?:erence)?(?:\s*(?:no|number))?|txn(?:\s*id)?|transaction\s*(?:id|ref(?:erence)?(?:\s*(?:no|number))?))[\s:/#-]{0,4}([A-Za-z0-9]{8,22})\b/i);
  if (m) return "ref:" + m[1].toLowerCase();
  // A bare "UPI/<ref>" or "UPI:<ref>".
  m = s.match(/\bUPI[\/:]([A-Za-z0-9]{8,22})\b/i);
  if (m) return "upi:" + m[1].toLowerCase();
  return null;
}

// The stable dedup key for a transaction. Prefers the bank's own reference
// (perfect, bank-agnostic). Falls back to a synthetic key from the transaction's
// intrinsic identity — date + direction + exact amount + normalized merchant.
// (Account is deliberately EXCLUDED from the synthetic key: the same order can be
// reported against different accounts by two emails, and we still want it to
// dedupe.)
function dedupKey(t) {
  const ref = t && t.bank_ref ? String(t.bank_ref).trim().toLowerCase() : "";
  if (ref) return "ref:" + ref;
  const date = String((t && (t.occurred_on || t.date)) || "");
  const dir = String((t && (t.direction || t.type)) || "");
  const paise = Math.round(Math.abs(+(t && t.amount) || 0) * 100);
  const merch = normalizeMerchant(t && t.merchant);
  return ["syn", date, dir, paise, merch].join("|");
}

module.exports = { BRAND_FAMILIES, normalizeMerchant, extractBankRef, dedupKey };
