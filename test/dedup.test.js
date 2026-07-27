/* ============================================================
   test/dedup.test.js — the identity + dedup core of the new
   ingestion model (netlify/functions/lib/dedup.js). Pure logic,
   so we can prove the dedup key behaves before wiring it into
   the live ingest path.
   ============================================================ */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const D = require(path.join(__dirname, "..", "finance_tracker_v22", "netlify", "functions", "lib", "dedup.js"));
const { loadBrowserGlobals } = require("./harness");
const { FT } = loadBrowserGlobals();

test("extractBankRef: pulls a UPI reference / RRN / UTR", () => {
  assert.equal(D.extractBankRef("Paid via UPI Ref No 512345678901 to Swiggy"), "upi:512345678901");
  assert.equal(D.extractBankRef("UPI/512345678901/Swiggy"), "upi:512345678901");
  assert.equal(D.extractBankRef("NEFT UTR: SBIN0AB12345 credited"), "ref:sbin0ab12345");
  assert.equal(D.extractBankRef("Txn ID ABC123XYZ done"), "ref:abc123xyz");
  assert.equal(D.extractBankRef("no reference here at all"), null);
});

test("normalizeMerchant: collapses a brand family to one token", () => {
  assert.equal(D.normalizeMerchant("Swiggy"), "swiggy");
  assert.equal(D.normalizeMerchant("SWIGGY INSTAMART"), "swiggy");
  assert.equal(D.normalizeMerchant("Instamart"), "swiggy");   // same company
  assert.equal(D.normalizeMerchant("Blinkit"), "zomato");     // Zomato owns Blinkit
  assert.equal(D.normalizeMerchant("Blue Tokai Coffee"), "blue tokai coffee");
});

test("dedupKey: identical when two emails share the bank reference", () => {
  const a = { bank_ref: "upi:512345678901", occurred_on: "2026-07-27", amount: 775, direction: "debit", merchant: "Swiggy" };
  const b = { bank_ref: "upi:512345678901", occurred_on: "2026-07-27", amount: 775, direction: "debit", merchant: "Instamart" };
  assert.equal(D.dedupKey(a), D.dedupKey(b)); // same reference → same transaction
  assert.equal(D.dedupKey(a), "ref:upi:512345678901");
});

test("REGRESSION: Swiggy + Instamart dedupe via the synthetic key (no bank ref)", () => {
  // The exact recurring duplicate: one ₹775 order, two emails, different
  // merchant AND different category, no shared reference. The synthetic key
  // still collapses them because the brand family normalizes to one merchant
  // and account is excluded from the key.
  const instamart = { occurred_on: "2026-07-27", amount: 775, direction: "debit", merchant: "Instamart", account_ref: "kotak1" };
  const swiggy    = { occurred_on: "2026-07-27", amount: 775, direction: "debit", merchant: "Swiggy",    account_ref: "scapia1" };
  assert.equal(D.dedupKey(instamart), D.dedupKey(swiggy));
});

test("dedupKey: genuinely different transactions get different keys", () => {
  const base = { occurred_on: "2026-07-27", amount: 775, direction: "debit", merchant: "Swiggy" };
  assert.notEqual(D.dedupKey(base), D.dedupKey({ ...base, amount: 776 }));           // amount
  assert.notEqual(D.dedupKey(base), D.dedupKey({ ...base, occurred_on: "2026-07-28" })); // date
  assert.notEqual(D.dedupKey(base), D.dedupKey({ ...base, direction: "credit" }));   // direction
  assert.notEqual(D.dedupKey(base), D.dedupKey({ ...base, merchant: "Uber" }));      // merchant
});

test("dedupKey: a real bank reference always wins over the synthetic fallback", () => {
  const withRef = { bank_ref: "upi:999888777666", occurred_on: "2026-07-27", amount: 775, direction: "debit", merchant: "Swiggy" };
  assert.ok(D.dedupKey(withRef).startsWith("ref:"));
  const noRef = { occurred_on: "2026-07-27", amount: 775, direction: "debit", merchant: "Swiggy" };
  assert.ok(D.dedupKey(noRef).startsWith("syn|"));
});

test("SYNC: browser FT.dedupKey matches the server dedupKey for identical inputs", () => {
  // If this fails, store.js and lib/dedup.js have drifted — the on-screen
  // ledger and the DB dedup would disagree. Keep the two copies identical.
  const samples = [
    { date: "2026-07-27", type: "expense", amount: 775, merchant: "Swiggy" },
    { date: "2026-07-27", type: "expense", amount: 775, merchant: "Instamart" },
    { date: "2026-01-10", type: "income", amount: 5000, merchant: "ACME Corp" },
    { bank_ref: "upi:123456789012", date: "2026-01-10", type: "expense", amount: 100, merchant: "X" },
    { date: "2026-02-02", type: "transfer", amount: 12000.5, merchant: "Self" },
  ];
  for (const s of samples) assert.equal(FT.dedupKey(s), D.dedupKey(s));
});

test("FT.dedupeTxns removes same-key duplicates and keeps the first", () => {
  const list = [
    { id: "a", date: "2026-07-27", type: "expense", amount: 775, merchant: "Instamart" },
    { id: "b", date: "2026-07-27", type: "expense", amount: 775, merchant: "Swiggy" }, // dup of a
    { id: "c", date: "2026-07-27", type: "expense", amount: 200, merchant: "Uber" },
  ];
  const out = FT.dedupeTxns(list);
  assert.equal(out.length, 2);
  assert.equal(out[0].id, "a");
  assert.equal(out[1].id, "c");
});
