/* ============================================================
   test/parser.test.js — the Gmail ingest email parser's pure
   helpers: available-limit extraction (the phantom-Used guard),
   payee/merchant cleanup, strict card matching, and dedup keys.
   These are the deterministic parts of ingest.js that we CAN test
   without calling the AI model.
   ============================================================ */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadIngest } = require("./harness");

const I = loadIngest();

test("availFromText: pulls the stated available limit", () => {
  assert.equal(I.availFromText("Available limit Rs 1,17,000 on your card"), 117000);
  assert.equal(I.availFromText("Avl Bal: INR 39,950.50"), 39950.5);
  assert.equal(I.availFromText("available credit limit ₹5,000"), 5000);
});

test("REGRESSION (phantom Used): a card's last-4 is NOT read as the available figure", () => {
  // "...card ending 1234 is Rs 39,950" — the 1234 must not be captured; the
  // currency-marked 39,950 is the real available figure. Mis-reading the last-4
  // (or the amount) as available is exactly what corrupted card balances before.
  assert.equal(
    I.availFromText("available limit on card ending 1234 is Rs 39,950"),
    39950,
  );
});

test("availFromText: no currency marker → null (won't grab a bare number)", () => {
  assert.equal(I.availFromText("available limit 39950"), null);
  assert.equal(I.availFromText("you spent 4500 at Swiggy"), null);
});

test("statedAvail: prefers the AI's number, falls back to regex, rejects negatives", () => {
  assert.equal(I.statedAvail({ availableLimit: 12345 }, "irrelevant"), 12345);
  assert.equal(I.statedAvail({}, "Available limit Rs 500"), 500);
  assert.equal(I.statedAvail({ availableLimit: -5 }, "no figure here"), null);
  assert.equal(I.statedAvail({ availableLimit: null }, "nothing"), null);
});

test("cleanPayee: drops honorifics, de-shouts, strips a trailing amount", () => {
  assert.equal(I.cleanPayee("MR RAJESH SINGH"), "Rajesh Singh");
  assert.equal(I.cleanPayee("SANTHOSH KUMAR RAJA Rs 125"), "Santhosh Kumar Raja");
  assert.equal(I.cleanPayee("Swiggy"), "Swiggy");
});

test("extractUpiPayee: pulls the payee after the numeric UPI reference", () => {
  assert.equal(
    I.extractUpiPayee("UPI/P2A/939904858765/SANTHOSH KUMAR RAJA"),
    "Santhosh Kumar Raja",
  );
  assert.equal(I.extractUpiPayee("Info: UPI/DR/123456/Swiggy"), "Swiggy");
  assert.equal(I.extractUpiPayee("no upi string here"), null);
});

test("extractVPA: finds a UPI handle", () => {
  assert.equal(I.extractVPA("paid to rajesh@okhdfc"), "rajesh@okhdfc");
  assert.equal(I.extractVPA("no handle"), null);
});

test("matchCardStrict: matches a card only by its actual last-4 number", () => {
  const data = { cards: [{ id: "c1", last4: "3774" }, { id: "c2", last4: "0042" }] };
  assert.equal(I.matchCardStrict("spent on card ending 3774", data), "c1");
  assert.equal(I.matchCardStrict("XX0042 debited", data), "c2");
  // a card NAME without the number must NOT match (promo emails name cards)
  assert.equal(I.matchCardStrict("your Infinia card offer", data), null);
});

test("SYMOK / catOk: validate currency and category ids", () => {
  assert.equal(I.SYMOK("INR"), true);
  assert.equal(I.SYMOK("JPY"), false);
  assert.equal(I.catOk("dining"), true);
  assert.equal(I.catOk("salary"), true);
  assert.equal(I.catOk("not_a_category"), false);
});

test("txnKey: equal for the same payment, different for a different amount", () => {
  const a = { date: "2026-01-10", type: "expense", amount: 4500, merchant: "Swiggy" };
  const b = { date: "2026-01-10", type: "expense", amount: 4500, merchant: "SWIGGY!!" };
  const c = { date: "2026-01-10", type: "expense", amount: 9000, merchant: "Swiggy" };
  assert.equal(I.txnKey(a), I.txnKey(b)); // merchant normalized → dedupe works
  assert.notEqual(I.txnKey(a), I.txnKey(c));
});

test("REGRESSION (double entry): one order as two emails is caught below ₹1000 via same category", () => {
  // Real case: a ₹543 Swiggy Instamart order arrived as "Instamart" (Groceries)
  // AND "Swiggy" (Groceries). Different merchants + different accounts dodged the
  // exact guard, and ₹543 < ₹1000 dodged the old fuzzy floor. Same category now
  // catches it.
  const existing = { source: "gmail", date: "2026-07-24", type: "expense", amount: 543, category: "groceries", merchant: "Instamart" };
  const incoming = { source: "gmail", date: "2026-07-24", type: "expense", amount: 543, category: "groceries", merchant: "Swiggy" };
  assert.equal(I.isFuzzyDup(incoming, existing), true);
});

test("isFuzzyDup: large amounts match even without a matching category", () => {
  const existing = { source: "gmail", date: "2026-07-24", type: "expense", amount: 12000, category: "travel" };
  const incoming = { source: "gmail", date: "2026-07-24", type: "expense", amount: 12000, category: "misc" };
  assert.equal(I.isFuzzyDup(incoming, existing), true);
});

test("isFuzzyDup: does NOT merge small same-day buys of different categories", () => {
  const existing = { source: "gmail", date: "2026-07-24", type: "expense", amount: 543, category: "dining" };
  const incoming = { source: "gmail", date: "2026-07-24", type: "expense", amount: 543, category: "fuel" };
  assert.equal(I.isFuzzyDup(incoming, existing), false);
});

test("isFuzzyDup: does NOT merge different amounts, dates, or non-gmail rows", () => {
  const base = { source: "gmail", date: "2026-07-24", type: "expense", amount: 543, category: "groceries" };
  assert.equal(I.isFuzzyDup(base, { ...base, amount: 544 }), false);        // different amount
  assert.equal(I.isFuzzyDup(base, { ...base, date: "2026-07-25" }), false); // different day
  assert.equal(I.isFuzzyDup(base, { ...base, source: "manual" }), false);   // not a gmail row
});
