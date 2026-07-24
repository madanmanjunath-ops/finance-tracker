/* ============================================================
   store.js — data model, persistence, helpers
   v3: empty onboarding state, cards+rewards DB, loans, richer
   profile, transaction tagging (source/status/confidence/tags)
   ============================================================ */
(function () {
  "use strict";

  const KEY = "fintrack_v2";          // keep key so cloud sync continues
  const SCHEMA = 3;

  /* ---------------- Expense / income categories ----------------
     Each expense category maps to a `rew` (reward category) so the
     card recommender knows which card earns best on it. */
  const EXPENSE_CATS = [
    { id: "dining",     name: "Food & Dining",     color: "var(--c1)",  emoji: "🍽️", rew: "dining" },
    { id: "groceries",  name: "Groceries",         color: "var(--c7)",  emoji: "🛒", rew: "groceries" },
    { id: "fuel",       name: "Fuel",              color: "var(--c4)",  emoji: "⛽", rew: "fuel" },
    { id: "transport",  name: "Transport & Cabs",  color: "var(--c2)",  emoji: "🚕", rew: "general" },
    { id: "online",     name: "Online Shopping",   color: "var(--c3)",  emoji: "🛍️", rew: "online" },
    { id: "entertainment",name:"Entertainment",    color: "var(--c5)",  emoji: "🎬", rew: "general" },
    { id: "bills",      name: "Bills & Utilities", color: "var(--c12)", emoji: "💡", rew: "utilities" },
    { id: "travel",     name: "Travel",            color: "var(--c11)", emoji: "✈️", rew: "travel" },
    { id: "health",     name: "Health",            color: "var(--c8)",  emoji: "💊", rew: "general" },
    { id: "staff",      name: "Staff Salary",      color: "var(--c9)",  emoji: "🧹", rew: "general" },
    { id: "business",   name: "Business Expense",  color: "var(--c10)", emoji: "💼", rew: "general" },
    { id: "rent",       name: "Rent",              color: "var(--c6)",  emoji: "🏠", rew: "none" },
    { id: "emi",        name: "Loan EMI",          color: "var(--c8)",  emoji: "📉", rew: "none" },
    { id: "subs",       name: "Subscriptions",     color: "var(--c5)",  emoji: "🔁", rew: "online" },
    { id: "cardpay",    name: "Card payment",       color:"var(--c2)",  emoji: "💳", rew: "none" },
    { id: "invest",     name: "Investments",       color: "var(--c1)",  emoji: "📈", rew: "none" },
    { id: "misc",       name: "Miscellaneous",     color: "var(--text-3)",emoji:"✦", rew: "general" },
  ];
  const INCOME_CATS = [
    { id: "salary",      name: "Salary",          color: "var(--c1)",  emoji: "💼" },
    { id: "freelance",   name: "Consulting",      color: "var(--c2)",  emoji: "💻" },
    { id: "business_inc",name: "Business Income", color: "var(--c10)", emoji: "🏢" },
    { id: "rental_inc",  name: "Rental Income",   color: "var(--c4)",  emoji: "🏠" },
    { id: "interest",    name: "Interest",        color: "var(--c7)",  emoji: "🏦" },
    { id: "dividend",    name: "Dividends",       color: "var(--c5)",  emoji: "📊" },
    { id: "refund",      name: "Refund",          color: "var(--c6)",  emoji: "↩️" },
    { id: "other_inc",   name: "Other Income",    color: "var(--text-3)",emoji:"➕" },
  ];
  // Synthetic category used only by `transfer` transactions (money moved
  // between the user's OWN accounts). Never shown in expense/income pickers
  // or budgets, but registered so catOf("transfer") renders correctly.
  const TRANSFER_CAT = { id: "transfer", name: "Transfer", color: "var(--text-3)", emoji: "⇄", rew: "none" };
  const UNCAT = { id: "uncat", name: "Uncategorized", color: "var(--text-3)", emoji: "❓", rew: "none" };

  const CAT_MAP = {};
  [...EXPENSE_CATS, ...INCOME_CATS, TRANSFER_CAT, UNCAT].forEach(c => { CAT_MAP[c.id] = c; });

  const REW_CATS = [
    { id: "dining", name: "Dining" }, { id: "groceries", name: "Groceries" },
    { id: "fuel", name: "Fuel" }, { id: "online", name: "Online Shopping" },
    { id: "travel", name: "Travel" }, { id: "utilities", name: "Utilities/Bills" },
    { id: "general", name: "Everything else" },
  ];

  const ACCOUNT_TYPES = [
    { id: "bank",       name: "Bank Account",  emoji: "🏦", asset: true },
    { id: "cash",       name: "Cash / Wallet", emoji: "👛", asset: true },
    { id: "fd",         name: "Fixed Deposit", emoji: "🏛️", asset: true, yields: true },
    { id: "invest",     name: "Stocks / Mutual Funds", emoji: "📈", asset: true },
    { id: "gold",       name: "Gold",          emoji: "🥇", asset: true },
    { id: "bond",       name: "Bonds / Debt",  emoji: "📜", asset: true, yields: true },
    { id: "realestate", name: "Real Estate",   emoji: "🏡", asset: true, yields: true },
    { id: "retire",     name: "Retirement (EPF/PPF/NPS)", emoji: "🛡️", asset: true },
    { id: "crypto",     name: "Crypto",        emoji: "🪙", asset: true },
    { id: "other",      name: "Other Asset",   emoji: "📦", asset: true },
  ];
  const PAYOUTS = [["cumulative","Cumulative (at maturity)"],["monthly","Monthly"],["quarterly","Quarterly"],["annually","Annually"]];

  const NETWORKS = ["Visa", "Mastercard", "RuPay", "Amex", "Diners Club"];

  /* ---------------- Indian credit-card reward database ----------------
     Effective % return per category (rupee value back per ₹100).
     A curated, EDITABLE snapshot reflecting post-2026 devaluations —
     users should verify against their card's current MITC.
     cat rates omitted → fall back to `base`. */
  const CARD_DB = [
    { id: "amzicici", name: "Amazon Pay ICICI", bank: "ICICI", network: "Visa", fee: 0, feeWaiver: 0, type: "cashback",
      base: 1, rates: { online: 5, utilities: 2, dining: 2 }, notes: "5% on Amazon (Prime), 2% on partner merchants & bill pay, 1% else. Lifetime free.", perks: "No annual fee" },
    { id: "sbicashback", name: "SBI Cashback", bank: "SBI", network: "Visa", fee: 999, feeWaiver: 200000, type: "cashback",
      base: 1, rates: { online: 5, dining: 5, groceries: 5, travel: 5 }, cap: "5% online capped ₹5,000/cycle. No reward on rent/wallet/fuel.", notes: "Flat 5% on all online spends, 1% offline.", perks: "Fee waived at ₹2L/yr" },
    { id: "hdfcmillennia", name: "HDFC Millennia", bank: "HDFC", network: "Visa/MC", fee: 1000, feeWaiver: 100000, type: "cashback",
      base: 1, rates: { online: 5, dining: 5 }, cap: "5% capped via CashPoints; monthly caps apply.", notes: "5% on Amazon/Flipkart/Swiggy/Myntra/Zomato etc, 1% else.", perks: "Fee waived at ₹1L/yr · quarterly lounge" },
    { id: "flipkartaxis", name: "Flipkart Axis", bank: "Axis", network: "Visa", fee: 500, feeWaiver: 350000, type: "cashback",
      base: 1, rates: { online: 5, dining: 4, travel: 4, groceries: 2 }, notes: "5% Flipkart/Myntra/Cleartrip, 4% preferred (Swiggy/PVR/Uber), 1.5% else.", perks: "Fee waived at ₹3.5L/yr" },
    { id: "axisace", name: "Axis ACE", bank: "Axis", network: "Visa", fee: 499, feeWaiver: 200000, type: "cashback",
      base: 1.5, rates: { utilities: 5, dining: 4 }, notes: "5% on bills via Google Pay, 4% Swiggy/Zomato/Ola, 1.5% else.", perks: "Fee waived at ₹2L · 4 lounges/yr" },
    { id: "hdfcinfinia", name: "HDFC Infinia (Metal)", bank: "HDFC", network: "Visa/Diners", fee: 12500, feeWaiver: 1000000, type: "points",
      base: 3.3, rates: { travel: 16, online: 16 }, cap: "SmartBuy/Gyftr boosts to ~16.5% (capped). Invite-only.", notes: "5 RP/₹150 (₹1/pt) base, big multipliers on SmartBuy.", perks: "Unlimited lounge · concierge" },
    { id: "hdfcdiners", name: "HDFC Diners Black (Metal)", bank: "HDFC", network: "Diners Club", fee: 10000, feeWaiver: 800000, type: "points",
      base: 3.3, rates: { travel: 16, online: 16, dining: 10 }, notes: "Same 3.3% base as Infinia; 10X on SmartBuy; free Swiggy One/Amazon Prime.", perks: "Unlimited lounge" },
    { id: "hdfcregaliagold", name: "HDFC Regalia Gold", bank: "HDFC", network: "Visa/MC", fee: 2500, feeWaiver: 400000, type: "points",
      base: 1.3, rates: { online: 6.5, dining: 3.5, travel: 3.5 }, notes: "4 RP/₹150; 5X on Myntra/Reliance/Nykaa/Marks&Spencer.", perks: "12 lounges/yr · ₹2,500 voucher" },
    { id: "axisatlas", name: "Axis Atlas", bank: "Axis", network: "Visa", fee: 5000, feeWaiver: 0, type: "miles",
      base: 2, rates: { travel: 5 }, notes: "5 EDGE Miles/₹100 on travel, 2/₹100 else; tiered. Transfer to airlines/hotels.", perks: "Unlimited lounge (tiered)" },
    { id: "axismagnus", name: "Axis Magnus / Burgundy", bank: "Axis", network: "Mastercard", fee: 12500, feeWaiver: 0, type: "points",
      base: 2.4, rates: { travel: 12, online: 12 }, cap: "12 EDGE/₹200 base (₹0.20/pt); milestone bonuses.", notes: "Best for ₹3L+/month spenders.", perks: "Unlimited lounge · Burgundy benefits" },
    { id: "hpclicici", name: "ICICI HPCL Super Saver", bank: "ICICI", network: "Visa", fee: 500, feeWaiver: 150000, type: "cashback",
      base: 1, rates: { fuel: 5, utilities: 5 }, notes: "5% cashback on HPCL fuel (via HP Pay), 5% on utilities (capped).", perks: "Fuel surcharge waiver" },
    { id: "bpclsbioctane", name: "BPCL SBI Octane", bank: "SBI", network: "Visa", fee: 1499, feeWaiver: 0, type: "points",
      base: 1, rates: { fuel: 7.25, dining: 2.5, groceries: 2.5 }, notes: "7.25% value at BPCL fuel; 25X reward points on fuel.", perks: "Fuel surcharge waiver · 4 lounges/yr" },
    { id: "idfcwealth", name: "IDFC FIRST Wealth", bank: "IDFC FIRST", network: "Visa/RuPay", fee: 0, feeWaiver: 0, type: "points",
      base: 1, rates: { dining: 2.5, online: 2.5 }, notes: "Up to 10X on >₹20k spends; never-expiring points. Lifetime free.", perks: "Complimentary lounge (domestic+intl) · railway lounge" },
    { id: "amexmrcc", name: "Amex Membership Rewards (MRCC)", bank: "American Express", network: "Amex", fee: 1500, feeWaiver: 90000, type: "points",
      base: 1, rates: { online: 5 }, notes: "1 MR pt/₹50; milestone bonuses (1,000–5,000 pts). 18% via Gold Collection.", perks: "Strong milestone & voucher value" },
    { id: "amexplatinumtravel", name: "Amex Platinum Travel", bank: "American Express", network: "Amex", fee: 5000, feeWaiver: 0, type: "points",
      base: 1.3, rates: { travel: 4 }, notes: "Milestone-driven: big bonus vouchers at ₹1.9L & ₹4L annual spend.", perks: "Lounge · Taj vouchers" },
    { id: "bobeterna", name: "BoB Eterna", bank: "Bank of Baroda", network: "Visa", fee: 2499, feeWaiver: 200000, type: "points",
      base: 1, rates: { travel: 3.75, dining: 3.75, online: 3.75 }, notes: "15 RP/₹100 on travel/dining/online/intl (capped); 3 RP/₹100 else.", perks: "Unlimited lounge" },
    { id: "scapia", name: "Scapia Federal", bank: "Federal Bank", network: "Visa", fee: 0, feeWaiver: 0, type: "points",
      base: 2, rates: { travel: 20 }, notes: "20% back as Scapia coins on travel via app; 10% else. ZERO forex markup.", perks: "Unlimited lounge · 0% forex · lifetime free" },
    { id: "swiggyhdfc", name: "Swiggy HDFC", bank: "HDFC", network: "Mastercard", fee: 500, feeWaiver: 200000, type: "cashback",
      base: 1, rates: { dining: 10, online: 5, utilities: 5 }, notes: "10% on Swiggy, 5% on online shopping, 1% else.", perks: "Free Swiggy One" },
    { id: "tataneuhdfc", name: "Tata Neu Infinity HDFC", bank: "HDFC", network: "Visa/RuPay", fee: 1499, feeWaiver: 0, type: "points",
      base: 1.5, rates: { online: 5, groceries: 5 }, notes: "5% NeuCoins on Tata brands (BigBasket/Croma/Tata Neu), 1.5% else. UPI-linked (RuPay).", perks: "Lounge access" },
    { id: "sbiprime", name: "SBI Prime", bank: "SBI", network: "Visa/MC/Amex", fee: 2999, feeWaiver: 300000, type: "points",
      base: 0.5, rates: { dining: 5, groceries: 5, entertainment: 5, utilities: 5 }, notes: "10X points (≈5%) on dining, groceries, departmental stores, movies; 2 RP/₹100 (≈0.5%) else.", perks: "Free Vistara/Trident membership · 8 lounges/yr · fee waived at ₹3L/yr" },
    { id: "kotaksolitaire", name: "Kotak Solitaire", bank: "Kotak Mahindra", network: "Visa", fee: 3500, feeWaiver: 375000, type: "points",
      base: 1.25, rates: { online: 1.25, dining: 1.25 }, notes: "5 Solitaire points per ₹150 (≈1.25%) on retail; quarterly milestone vouchers (Apple/Vistara/Marriott) on ₹1.25L spend; redeem ₹1/point on travel.", perks: "Unlimited lounge (domestic+intl) · BookMyShow & milestone vouchers · fee waived at ₹3.75L/yr" },
    { id: "other", name: "Other / Custom card", bank: "", network: "Visa", fee: 0, feeWaiver: 0, type: "cashback",
      base: 1, rates: {}, notes: "Enter your own reward rates.", perks: "" },
  ];
  const CARD_MAP = {};
  CARD_DB.forEach(c => { CARD_MAP[c.id] = c; });

  /* ---------------- currency ---------------- */
  const CUR = {
    INR: { sym: "₹", locale: "en-IN" }, USD: { sym: "$", locale: "en-US" },
    EUR: { sym: "€", locale: "de-DE" }, GBP: { sym: "£", locale: "en-GB" },
  };
  const DEFAULT_FX = { INR: 1, USD: 84, EUR: 91, GBP: 107 };

  /* ---------------- helpers ---------------- */
  const uid = () => Math.random().toString(36).slice(2, 10);
  // A high-entropy, unguessable token for the Gmail ingest webhook. This token
  // authorizes writing transactions into a user's account, so it MUST come from
  // the platform CSPRNG (crypto) — never Math.random(), whose output is
  // predictable and could let an attacker forge a valid token. ~256 bits.
  function ingestToken() {
    try {
      const c = (typeof crypto !== "undefined") ? crypto : null;
      if (c && c.randomUUID) return "ft_" + c.randomUUID().replace(/-/g, "") + c.randomUUID().replace(/-/g, "");
      if (c && c.getRandomValues) {
        const a = new Uint8Array(32); c.getRandomValues(a);
        return "ft_" + Array.from(a, b => b.toString(16).padStart(2, "0")).join("");
      }
    } catch (e) { /* fall through */ }
    // Last-resort fallback (should never run in a modern browser).
    return "ft_" + uid() + uid() + uid() + uid();
  }
  const todayISO = () => new Date().toISOString().slice(0, 10);
  function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }
  function monthsAgo(n) { const d = new Date(); d.setMonth(d.getMonth() - n); d.setDate(1); return d.toISOString().slice(0, 7); }

  /* ---------------- EMPTY default state (onboarding) ---------------- */
  function defaultState() {
    return {
      schema: SCHEMA,
      onboarded: false,
      displayCurrency: "INR",
      fx: { ...DEFAULT_FX },
      theme: "light",
      accounts: [],
      cards: [],
      loans: [],
      transactions: [],
      pending: [],            // review-inbox items awaiting approval
      budgets: [],
      goals: [],
      recurring: [],
      upcomingBills: [],      // one-off bills detected from emails (due, not yet paid)
      renameRules: [],        // friendly-name rules: rename raw bank text to readable labels
      plans: [],              // quarterly investment plans (active + archived, never deleted)
      leverage: null,         // "wealth without new money" program {generatedAt, steps:[...]}
      riskPosture: "auto",    // auto | Conservative | Balanced | Aggressive
      receivables: [],        // money owed to you from split bills [{id, label, total, yourShare, owed, settled, date, txnId, settlements:[]}]
      brief: null,            // cached daily brief {date, items:[...], aiNote}
      fixedExpenses: [],      // [{id,label,amount,currency,dueDay,category}] recurring commitments
      incomeAssets: [],       // [{id,label,principal,rate,currency}] FDs/deposits yielding interest
      criticView: "itr",      // critic income benchmark: allindia|itr|global
      notify: { email: "", time: "07:15", tz: "Asia/Kolkata", enabled: false },
      gmail: { connected: false, autoThreshold: 85 }, // auto-book if confidence >=
      profile: {
        name: "", age: null, maritalStatus: "Single", dependents: 0,
        risk: "Moderate", monthlyIncome: null,
        currentInvestments: "", goalsText: "",
      },
    };
  }

  /* ---------------- persistence ---------------- */
  function load() {
    try { const raw = localStorage.getItem(KEY); if (raw) return migrate(JSON.parse(raw)); } catch (e) {}
    const s = defaultState(); save(s); return s;
  }
  function migrate(s) {
    if (!s.fx) s.fx = { ...DEFAULT_FX };
    if (!s.displayCurrency) s.displayCurrency = s.currency || "INR";
    if (!s.cards) s.cards = [];
    if (!s.loans) s.loans = [];
    if (!s.pending) s.pending = [];
    if (!s.upcomingBills) s.upcomingBills = []; // bills detected from emails, not yet paid
    if (!s.renameRules) s.renameRules = [];     // [{id, match, name, category?}] friendly-name rules
    if (!s.plans) s.plans = [];
    if (s.leverage === undefined) s.leverage = null;
    if (!s.riskPosture) s.riskPosture = "auto";
    if (!s.receivables) s.receivables = [];
    if (s.brief === undefined) s.brief = null;
    if (!s.fixedExpenses) s.fixedExpenses = [];
    if (!s.incomeAssets) s.incomeAssets = [];
    if (!s.criticView) s.criticView = "itr";
    // credit-limit anchoring: each card tracks an available-limit anchor that
    // bank emails refresh; between emails the app derives from spends since.
    (s.cards || []).forEach(c => {
      if (c.availAnchor === undefined && c.limit) { c.availAnchor = c.limit - (c.balance || 0); c.availAnchorDate = c.availAnchorDate || FT.todayISO(); }
    });
    // one-time: record a balance anchor so derived balances have a baseline
    (s.accounts || []).forEach(a => { if (a.balanceAnchor === undefined) { a.balanceAnchor = a.balance || 0; a.anchorDate = a.anchorDate || FT.todayISO(); } });
    if (!s.notify) s.notify = { email: "", time: "07:15", tz: "Asia/Kolkata", enabled: false };
    if (!s.gmail) s.gmail = { connected: false, autoThreshold: 85 };
    if (s.onboarded === undefined) s.onboarded = false; // old sample data → offer onboarding
    (s.accounts || []).forEach(a => { if (!a.currency) a.currency = "INR"; });
    (s.transactions || []).forEach(t => {
      if (!t.currency) t.currency = "INR";
      if (!t.source) t.source = "manual";
      if (!t.status) t.status = "confirmed";
      if (!t.tags) t.tags = [];
    });
    return s;
  }
  function save(state) { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  function reset() { localStorage.removeItem(KEY); }

  /* ---------------- formatting ---------------- */
  function fmt(amount, currency, opts) {
    const c = CUR[currency] || CUR.INR; const o = opts || {};
    const n = Math.abs(amount);
    const str = new Intl.NumberFormat(c.locale, { maximumFractionDigits: o.decimals ? 2 : 0, minimumFractionDigits: o.decimals ? 2 : 0 }).format(n);
    const sign = amount < 0 ? "-" : (o.plus ? "+" : "");
    return `${sign}${c.sym}${str}`;
  }
  function fmtShort(amount, currency) {
    const c = CUR[currency] || CUR.INR; const n = Math.abs(amount); let out;
    if (currency === "INR") {
      if (n >= 1e7) out = (n / 1e7).toFixed(2).replace(/\.?0+$/, "") + "Cr";
      else if (n >= 1e5) out = (n / 1e5).toFixed(2).replace(/\.?0+$/, "") + "L";
      else if (n >= 1e3) out = (n / 1e3).toFixed(1).replace(/\.?0+$/, "") + "k";
      else out = String(Math.round(n));
    } else {
      if (n >= 1e6) out = (n / 1e6).toFixed(2).replace(/\.?0+$/, "") + "M";
      else if (n >= 1e3) out = (n / 1e3).toFixed(1).replace(/\.?0+$/, "") + "k";
      else out = String(Math.round(n));
    }
    return (amount < 0 ? "-" : "") + c.sym + out;
  }
  function relDate(iso) {
    const d = new Date(iso + "T00:00:00"); const now = new Date(); now.setHours(0,0,0,0);
    const diff = Math.round((now - d) / 86400000);
    if (diff === 0) return "Today"; if (diff === 1) return "Yesterday"; if (diff > 1 && diff < 7) return diff + " days ago";
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  }
  function monthLabel(ym) { const [y, m] = ym.split("-"); return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short" }); }

  /* ---------------- credit-card date helpers ---------------- */
  // days until next statement/billing date (the float window resets after billing)
  function daysUntil(dayOfMonth) {
    if (!dayOfMonth) return null;
    const now = new Date(); const d = new Date(now.getFullYear(), now.getMonth(), dayOfMonth);
    if (d <= now) d.setMonth(d.getMonth() + 1);
    return Math.ceil((d - now) / 86400000);
  }
  // interest-free float days for a purchase TODAY: days to next statement + grace (~20)
  function floatDays(card) {
    const toStmt = daysUntil(card.billingDay);
    if (toStmt == null) return null;
    return toStmt + (card.graceDays || 20);
  }
  function rewardRate(card, rewCat) {
    const def = CARD_MAP[card.cardType] || {};
    const rates = card.rates || def.rates || {};
    const base = (card.base != null ? card.base : def.base) || 1;
    if (!rewCat || rewCat === "none") return 0;
    return rates[rewCat] != null ? rates[rewCat] : base;
  }
  function ordinal(n) { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  // Next payment due: prefer the real due DATE captured from a statement email
  // (card.stmtDueDate, "YYYY-MM-DD"); otherwise fall back to the recurring dueDay.
  function nextDue(card) {
    if (card && card.stmtDueDate && /^\d{4}-\d{2}-\d{2}$/.test(card.stmtDueDate)) {
      const d = new Date(card.stmtDueDate + "T00:00:00");
      const now = new Date(); now.setHours(0, 0, 0, 0);
      const inDays = Math.round((d - now) / 86400000);
      if (inDays >= -3) return { label: ordinal(d.getDate()), inDays, exact: true }; // keep a couple days post-due
    }
    if (card && card.dueDay) return { label: ordinal(card.dueDay), inDays: daysUntil(card.dueDay), exact: false };
    return { label: "—", inDays: null, exact: false };
  }

  /* ---------------- transfer-partner defaults (editable per card) ----------------
     Seed values for points/miles cards. A user can override per card via
     card.partners. These change over time — treat as a starting point, not gospel. */
  const CARD_PARTNERS = {
    kotaksolitaire: ["Air India", "Marriott", "Qatar"],
    axisatlas: ["Air India", "British Airways", "Finnair", "Vietnam"],
    axismagnus: ["Air India", "British Airways", "Marriott"],
    hdfcinfinia: ["Air India", "Singapore Airlines", "Marriott"],
    hdfcdiners: ["Air India", "Singapore Airlines", "Marriott"],
    hdfcregaliagold: ["Air India", "Marriott"],
    amexmrcc: ["Marriott", "Air India", "Singapore Airlines"],
    amexplatinumtravel: ["Marriott", "Air India"],
    bobeterna: ["Air India", "Marriott"],
    idfcwealth: ["Air India"],
    scapia: ["In-app travel"],
  };
  // partners for a card: explicit override → DB default → []
  function cardPartners(card) {
    if (card && Array.isArray(card.partners)) return card.partners;
    return CARD_PARTNERS[card && card.cardType] || [];
  }
  // ₹ value per point (editable via card.ptValue; defaults to ₹1 for points/miles, else 0)
  function pointValue(card) {
    if (card && card.ptValue != null) return card.ptValue;
    const def = CARD_MAP[card && card.cardType] || {};
    return (def.type === "points" || def.type === "miles") ? 1 : 1;
  }

  /* ---------------- transfer detection (own-account movements) ----------------
     A "transfer" moves money between the user's OWN accounts/cards. It must NOT
     count as income or expense. We feed these hints to the AI parsers and use
     them in the deterministic file importer. */
  function ownAccountHints(state) {
    const out = new Set();
    const push = (v) => { v = String(v || "").toLowerCase().trim(); if (v.length >= 3) out.add(v); };
    (state.accounts || []).forEach(a => { push(a.name); });
    (state.cards || []).forEach(c => {
      push(c.name);
      const def = CARD_MAP[c.cardType]; if (def && def.bank) push(def.bank);
      if (c.last4) { out.add("••" + c.last4); out.add("xx" + c.last4); out.add(String(c.last4)); }
    });
    return [...out];
  }
  // Conservative heuristic: only flags clear self-transfers / card bill payments.
  // The AI parsers are the primary path; this backs up the no-AI file importer.
  function looksLikeTransfer(text, state) {
    const s = " " + String(text || "").toLowerCase() + " ";
    // explicit self / own-account / internal movement
    if (/\b(self[\s-]?transfer|own account|to self|between your (own )?accounts?|internal transfer|transfer to your own)\b/.test(s)) return true;
    // credit-card bill payments (the spend already counted as an expense)
    if (/\b(credit ?card (bill )?payment|payment (received )?(towards|to|for) (your )?(credit ?)?card|card bill payment|cc (bill )?payment|autopay.*card|nach.*card)\b/.test(s)) return true;
    // a money-movement verb PLUS a match to one of the user's own accounts/banks
    const moved = /\b(neft|imps|rtgs|upi|fund transfer|transferred|transfer of|sent to|moved to|a2a|account to account)\b/.test(s);
    if (moved) {
      const hints = ownAccountHints(state);
      for (let i = 0; i < hints.length; i++) { if (s.indexOf(hints[i]) >= 0) return true; }
    }
    return false;
  }
  // Stable signature for de-duplicating imported transactions against existing ones.
  function txnKey(t) {
    const merch = String(t.merchant || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 14);
    return [t.date, t.type, Math.round(Math.abs(+t.amount) || 0), merch].join("|");
  }
  // ── Financial critic benchmarks (annual income, INR) ──────────────────
  // Sourced 2025-26: ITR-filer thresholds from CBDT FY2025-26 (8.22cr filers);
  // all-India from PLFS/World Inequality Lab; global from WID PPP estimates.
  // These are reference anchors the app computes against — not the AI's guesses.
  const BENCHMARKS = {
    itr:      { label: "Indian tax filers", note: "8.22cr ITR filers (CBDT FY25-26)", p: [[1, 7150000], [5, 4200000], [10, 3100000], [20, 1000000], [50, 600000]] },
    allindia: { label: "All Indians", note: "PLFS / World Inequality Lab", p: [[1, 2200000], [5, 1400000], [10, 960000], [20, 500000], [50, 250000]] },
    global:   { label: "Global", note: "WID PPP-adjusted", p: [[1, 5300000], [5, 3000000], [10, 1700000], [20, 900000], [50, 400000]] },
  };
  // Age-based wealth multiples (× annual income unless noted) — from common
  // planning frameworks aggregated in 2025 sources.
  const WEALTH_MULT = [[25, 1], [30, 2.5], [35, 4.5], [40, 7], [45, 10], [50, 13], [55, 18], [60, 22], [70, 27]];

  function incomePercentile(annualIncome, view) {
    const b = BENCHMARKS[view] || BENCHMARKS.itr;
    // find the best (lowest) top-X% the income clears
    let best = null;
    for (const [pct, thresh] of b.p) { if (annualIncome >= thresh) { best = pct; break; } }
    return { topPct: best, label: b.label, note: b.note, table: b.p };
  }
  function wealthTarget(age) {
    let lo = WEALTH_MULT[0], hi = WEALTH_MULT[WEALTH_MULT.length - 1];
    for (let i = 0; i < WEALTH_MULT.length - 1; i++) {
      if (age >= WEALTH_MULT[i][0] && age <= WEALTH_MULT[i + 1][0]) { lo = WEALTH_MULT[i]; hi = WEALTH_MULT[i + 1]; break; }
    }
    const t = hi[0] === lo[0] ? lo[1] : lo[1] + (hi[1] - lo[1]) * (age - lo[0]) / (hi[0] - lo[0]);
    return Math.round(t * 10) / 10;
  }

  function currentQuarter(d) {
    const dt = d ? new Date(d) : new Date();
    return "Q" + (Math.floor(dt.getMonth() / 3) + 1) + " " + dt.getFullYear();
  }
  // Unified list of places money can move on: bank/other accounts + credit cards.
  // Cards get id "card:<cardId>" so they're distinguishable from accounts.
  function payTargets(state) {
    const accts = (state.accounts || []).map(a => ({ id: a.id, name: a.name, kind: "account" }));
    const cards = (state.cards || []).map(c => {
      const def = CARD_MAP[c.cardType];
      const bank = def && def.bank ? def.bank + " " : "";
      const label = (c.name || (bank + (def ? def.name : "Card"))) + (c.last4 ? " ••" + c.last4 : "");
      return { id: "card:" + c.id, name: label, kind: "card" };
    });
    return [...accts, ...cards];
  }
  function payTargetName(id, state) {
    const t = payTargets(state).find(x => x.id === id);
    return t ? t.name : "—";
  }
  // Pull a UPI VPA / handle out of raw text (e.g. "q4837@ybl", "name@okhdfc").
  function extractVPA(text) {
    const m = String(text || "").match(/\b[a-z0-9._-]{2,}@[a-z]{2,}\b/i);
    return m ? m[0] : null;
  }
  // Tidy a payee name: collapse spaces, drop a leading honorific, strip a
  // trailing amount/currency remnant, de-shout ALL CAPS.
  function cleanPayee(name) {
    let n = String(name || "").trim().replace(/\s+/g, " ");
    n = n.replace(/^(mr|mrs|ms|m\/s|dr|shri|smt)\.?\s+/i, "");
    n = n.replace(/\s+(rs\.?|inr|₹)\s*\d*\.?\d*\s*$/i, "");
    if (n && /[A-Z]/.test(n) && n === n.toUpperCase()) n = n.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    return n.trim();
  }
  // Payee out of a UPI "Transaction Info" string, e.g. UPI/P2A/939904/SANTHOSH KUMAR.
  function extractUpiPayee(text) {
    const s = String(text || "");
    let m = s.match(/UPI\/[A-Z0-9]+\/\d+\/([A-Za-z][A-Za-z .&'-]{1,60})/i);
    if (m) return cleanPayee(m[1]);
    m = s.match(/UPI\/[^\n]*?\/([A-Za-z][A-Za-z .&'-]{2,40})\s*$/m);
    if (m) return cleanPayee(m[1]);
    return null;
  }
  // bank/issuer names that are the email SENDER, never the payee
  const BANKISH_RE = /^(hdfc|icici|axis|kotak|sbi|state bank|scapia|federal|amazon pay|amex|american express|idfc|yes bank|rbl|au small|au bank|indusind|citi|hsbc|standard chartered|pnb|canara|bob|bank of baroda|union bank)\b/i;
  // generic non-name labels a model sometimes returns instead of the real payee
  const GENERIC_RE = /^(transaction|upi(\s*(payment|transaction|transfer))?|payment|transfer|fund transfer|debit|credit|spent|purchase|unknown)\.?$/i;
  // Best merchant label: trust a specific AI name, else fall back to the UPI
  // payee parsed from the text, then the VPA. Mirrors the Gmail ingest logic so
  // the in-app parsers name payees just as well.
  function bestMerchant(aiName, text) {
    const llmM = String(aiName || "").trim();
    const upi = extractUpiPayee(text);
    const vpa = extractVPA(text);
    let merchant = (llmM && !GENERIC_RE.test(llmM) && !BANKISH_RE.test(llmM)) ? llmM : (upi || vpa || llmM || "Transaction");
    if (BANKISH_RE.test(merchant) && upi) merchant = upi;
    return String(merchant).slice(0, 80);
  }
  // Robust parser for AI JSON responses: strips code fences and preamble,
  // extracts the first balanced {...} block, and tolerates trailing commas.
  function parseAIJson(raw) {
    let s = String(raw || "").trim().replace(/```(json)?/gi, "").trim();
    const start = s.indexOf("{");
    if (start >= 0) {
      let depth = 0, inStr = false, esc = false, end = -1;
      for (let i = start; i < s.length; i++) {
        const ch = s[i];
        if (esc) { esc = false; continue; }
        if (ch === "\\") { esc = true; continue; }
        if (ch === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (ch === "{") depth++;
        if (ch === "}") { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end > start) s = s.slice(start, end + 1);
      else s = s.slice(start); // truncated — try after repairs below
    }
    s = s.replace(/,\s*([}\]])/g, "$1"); // trailing commas
    try { return JSON.parse(s); } catch (e) {}
    // last resort for truncated output: close the open string, then close
    // brackets in correct nesting order via a stack
    let fix = s;
    let inStr2 = false, esc2 = false; const stack = [];
    for (let i = 0; i < fix.length; i++) {
      const ch = fix[i];
      if (esc2) { esc2 = false; continue; }
      if (ch === "\\") { esc2 = true; continue; }
      if (ch === '"') { inStr2 = !inStr2; continue; }
      if (inStr2) continue;
      if (ch === "{" || ch === "[") stack.push(ch);
      if (ch === "}" || ch === "]") stack.pop();
    }
    if (inStr2) fix += '"';
    fix = fix.replace(/,\s*$/, "");
    while (stack.length) fix += stack.pop() === "{" ? "}" : "]";
    return JSON.parse(fix.replace(/,\s*([}\]])/g, "$1"));
  }

  // Apply the user's rename rules to a raw merchant string. First matching rule
  // wins. Returns {name, category} (category only when the rule sets one).
  function applyRenames(merchant, state) {
    const raw = String(merchant || "");
    const low = raw.toLowerCase();
    for (const r of (state.renameRules || [])) {
      if (r.match && low.includes(String(r.match).toLowerCase())) {
        return { name: r.name || raw, category: r.category || null };
      }
    }
    return { name: raw, category: null };
  }

  window.FT = {
    KEY, SCHEMA, EXPENSE_CATS, INCOME_CATS, CAT_MAP, REW_CATS, ACCOUNT_TYPES, NETWORKS, PAYOUTS,
    CARD_DB, CARD_MAP, CUR, DEFAULT_FX,
    uid, ingestToken, todayISO, daysAgo, monthsAgo, load, save, reset, defaultState, migrate,
    fmt, fmtShort, relDate, monthLabel, daysUntil, floatDays, rewardRate, ordinal, nextDue, cardPartners, pointValue,
    ownAccountHints, looksLikeTransfer, txnKey, TRANSFER_CAT, applyRenames, currentQuarter, parseAIJson, payTargets, payTargetName, extractVPA, extractUpiPayee, bestMerchant, incomePercentile, wealthTarget, BENCHMARKS,
    annualYield: (a) => (a.rate ? (a.balance || 0) * a.rate / 100 : 0),
    fdMaturityDays: (a) => a.maturityDate ? Math.round((new Date(a.maturityDate) - new Date()) / 86400000) : null,
    catOf: (id) => CAT_MAP[id] || { name: "Other", color: "var(--text-3)", emoji: "✦", rew: "general" },
    acctType: (id) => ACCOUNT_TYPES.find(a => a.id === id) || ACCOUNT_TYPES[ACCOUNT_TYPES.length - 1],
    cardDef: (id) => CARD_MAP[id] || CARD_MAP.other,
    symOf: (cur) => (CUR[cur] || CUR.INR).sym,
  };
})();
