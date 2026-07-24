/* ============================================================
   test/compute.test.js — money math (the app's most bug-prone,
   highest-value logic). Covers currency conversion, the card
   used/available engine (single source of truth), and net worth.
   ============================================================ */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadBrowserGlobals } = require("./harness");

const { Compute } = loadBrowserGlobals();

// A display currency of INR with USD pegged at 83.
const baseState = () => ({
  displayCurrency: "INR",
  fx: { INR: 1, USD: 83 },
  accounts: [],
  cards: [],
  loans: [],
  transactions: [],
  receivables: [],
});

test("conv converts foreign currency into the display currency", () => {
  const s = baseState();
  assert.equal(Compute.conv(100, "USD", s), 8300);   // 100 USD → ₹8,300
  assert.equal(Compute.conv(8300, "INR", s), 8300);  // already INR
  // switch display currency to USD
  s.displayCurrency = "USD";
  assert.equal(Compute.conv(8300, "INR", s), 100);   // ₹8,300 → $100
});

test("cardAvailable: no anchor, no spend → available equals limit", () => {
  const s = baseState();
  const card = { id: "c1", limit: 100000, balance: 0, currency: "INR" };
  s.cards = [card];
  assert.equal(Compute.cardAvailable(card, s), 100000);
  assert.equal(Compute.cardUsed(card, s), 0);
});

test("cardUsed: a swipe reduces available and increases used", () => {
  const s = baseState();
  const card = { id: "c1", limit: 100000, balance: 0, currency: "INR" };
  s.cards = [card];
  s.transactions = [
    { account: "card:c1", type: "expense", amount: 5000, date: "2026-01-10" },
  ];
  assert.equal(Compute.cardAvailable(card, s), 95000);
  assert.equal(Compute.cardUsed(card, s), 5000);
});

test("REGRESSION (phantom Used): an email-verified anchor is authoritative for its date", () => {
  // This is the class of bug that inflated 'Used' with no real spend: a same-day
  // duplicate/mis-read spend must NOT be double-counted against an exact anchor.
  const s = baseState();
  const card = {
    id: "c1", limit: 100000, currency: "INR",
    availAnchor: 40000, availAnchorDate: "2026-01-15", availAnchorExact: true,
  };
  s.cards = [card];
  s.transactions = [
    { account: "card:c1", type: "expense", amount: 5000, date: "2026-01-15" }, // same day as anchor → ignored
  ];
  assert.equal(Compute.cardAvailable(card, s), 40000);
  assert.equal(Compute.cardUsed(card, s), 60000);
});

test("cardAvailable: a spend AFTER an exact anchor still counts", () => {
  const s = baseState();
  const card = {
    id: "c1", limit: 100000, currency: "INR",
    availAnchor: 40000, availAnchorDate: "2026-01-15", availAnchorExact: true,
  };
  s.cards = [card];
  s.transactions = [
    { account: "card:c1", type: "expense", amount: 5000, date: "2026-01-20" },
  ];
  assert.equal(Compute.cardAvailable(card, s), 35000);
});

test("cardAvailable: a payment INTO the card frees up limit", () => {
  const s = baseState();
  const card = { id: "c1", limit: 100000, balance: 30000, currency: "INR" }; // anchor = 70000
  s.cards = [card];
  s.transactions = [
    { account: "bank1", type: "transfer", amount: 10000, toAccount: "card:c1", date: "2026-02-01" },
  ];
  assert.equal(Compute.cardAvailable(card, s), 80000);
  assert.equal(Compute.cardUsed(card, s), 20000);
});

test("cardAvailable is clamped to [0, limit]", () => {
  const s = baseState();
  const card = { id: "c1", limit: 100000, balance: 0, currency: "INR" };
  s.cards = [card];
  s.transactions = [
    { account: "card:c1", type: "expense", amount: 200000, date: "2026-03-01" }, // over-limit
  ];
  assert.equal(Compute.cardAvailable(card, s), 0);
  assert.equal(Compute.cardUsed(card, s), 100000); // never exceeds the limit
});

test("netWorth = assets − liabilities, with card debt = cardUsed", () => {
  const s = baseState();
  s.accounts = [{ id: "bank1", type: "bank", balance: 50000, currency: "INR" }];
  s.cards = [{ id: "c1", limit: 100000, balance: 0, currency: "INR" }];
  s.transactions = [
    { account: "card:c1", type: "expense", amount: 5000, date: "2026-01-10" },
  ];
  const nw = Compute.netWorth(s);
  assert.equal(nw.assets, 50000);
  assert.equal(nw.liabilities, 5000); // the card's used amount, not its stale balance
  assert.equal(nw.net, 45000);
});

test("netWorth reflects a currency-converted foreign account", () => {
  const s = baseState();
  s.accounts = [{ id: "usd1", type: "bank", balance: 1000, currency: "USD" }]; // $1,000
  const nw = Compute.netWorth(s);
  assert.equal(nw.assets, 83000); // → ₹83,000
  assert.equal(nw.net, 83000);
});
