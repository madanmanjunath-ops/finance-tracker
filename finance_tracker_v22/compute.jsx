/* ============================================================
   compute.jsx — derived data selectors (currency-aware)
   All monetary outputs are converted to state.displayCurrency.
   ============================================================ */
const Compute = (function () {
  function inMonth(iso, ym) { return iso.slice(0, 7) === ym; }
  function thisMonth() { return new Date().toISOString().slice(0, 7); }
  function prevMonth() { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); }

  // ---- currency conversion ----
  function rate(cur, state) { return (state.fx && state.fx[cur]) || 1; }
  function conv(amount, fromCur, state) {
    const dc = state.displayCurrency || "INR";
    return amount * rate(fromCur || "INR", state) / rate(dc, state);
  }
  function tAmt(t, state) { return conv(t.amount, t.currency, state); }       // txn → display ccy
  function aBal(a, state) { return conv(a.balance, a.currency, state); }      // account → stored balance (display ccy)

  // Derived "live" balance: anchor + all transactions on this account since the
  // anchor date. Money LEAVES on expenses and outbound transfers; ARRIVES on
  // income and inbound transfers (toAccount). Keeps balances correct as Gmail
  // transactions flow in, without any bank API.
  function liveBal(a, state) {
    const anchor = a.balanceAnchor != null ? a.balanceAnchor : (a.balance || 0);
    const since = a.anchorDate || "0000-00-00";
    let bal = anchor;
    (state.transactions || []).forEach(t => {
      if (t.date < since) return;
      const amt = t.amount || 0;
      if (t.account === a.id) {
        if (t.type === "income") bal += amt;
        else if (t.type === "expense") bal -= amt;
        else if (t.type === "transfer") bal -= amt; // money out of source
      }
      if (t.type === "transfer" && t.toAccount === a.id) bal += amt; // money into destination
    });
    return conv(bal, a.currency, state);
  }
  function totalLiveBal(state) {
    return (state.accounts || []).filter(a => FT.acctType(a.type).asset !== false && a.type !== "loan")
      .reduce((s, a) => s + liveBal(a, state), 0);
  }
  function owedToYou(state) {
    return (state.receivables || []).filter(r => !r.settled).reduce((s, r) => s + (r.owed || 0), 0);
  }

  function sum(state, type, ym) {
    return state.transactions.filter(t => t.type === type && (!ym || inMonth(t.date, ym)))
      .reduce((s, t) => s + tAmt(t, state), 0);
  }

  function categoryBreakdown(state, type, ym) {
    const map = {};
    state.transactions.filter(t => t.type === type && (!ym || inMonth(t.date, ym)))
      .forEach(t => { map[t.category] = (map[t.category] || 0) + tAmt(t, state); });
    return Object.entries(map).map(([cat, value]) => {
      const c = FT.catOf(cat);
      return { cat, label: c.name, value, color: c.color, emoji: c.emoji };
    }).sort((a, b) => b.value - a.value);
  }

  function monthlySeries(state, n) {
    const out = []; const now = new Date(); now.setDate(1);
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(now); d.setMonth(d.getMonth() - i);
      const ym = d.toISOString().slice(0, 7);
      out.push({ ym, label: FT.monthLabel(ym), income: sum(state, "income", ym), expense: sum(state, "expense", ym),
        get net() { return this.income - this.expense; } });
    }
    return out;
  }

  function netWorth(state) {
    let assets = 0, liabilities = 0;
    state.accounts.forEach(a => { const t = FT.acctType(a.type); const v = liveBal(a, state); if (t.asset) assets += v; else liabilities += Math.abs(v); });
    (state.cards || []).forEach(c => { liabilities += conv(c.balance || 0, c.currency || "INR", state); });
    (state.loans || []).forEach(l => { liabilities += conv(l.outstanding || 0, l.currency || "INR", state); });
    assets += owedToYou(state); // money friends owe you is a real asset
    return { assets, liabilities, net: assets - liabilities };
  }

  // synthesised smooth upward trend ending at live net worth
  function netWorthSeries(state) {
    const cur = netWorth(state).net; const months = 12; const vals = [cur]; let v = cur;
    for (let i = 1; i < months; i++) {
      const wobble = 0.021 + 0.011 * Math.sin(i * 1.7) + 0.004 * Math.cos(i * 0.9);
      v = v / (1 + wobble); vals.unshift(Math.round(v / 100) * 100);
    }
    const now = new Date(); now.setDate(1);
    return vals.map((value, idx) => {
      const d = new Date(now); d.setMonth(d.getMonth() - (months - 1 - idx));
      const ym = d.toISOString().slice(0, 7);
      return { ym, label: FT.monthLabel(ym), value };
    });
  }

  function pctChange(c, p) { if (!p) return c ? 100 : 0; return ((c - p) / Math.abs(p)) * 100; }
  function groupByDate(txns) { const g = {}; txns.forEach(t => { (g[t.date] = g[t.date] || []).push(t); }); return Object.entries(g).sort((a, b) => b[0].localeCompare(a[0])); }
  function savingsRate(income, expense) { if (!income) return 0; return ((income - expense) / income) * 100; }

  return { inMonth, thisMonth, prevMonth, rate, conv, tAmt, aBal, liveBal, totalLiveBal, owedToYou, sum, categoryBreakdown, monthlySeries, netWorth, netWorthSeries, pctChange, groupByDate, savingsRate };
})();

window.Compute = Compute;
