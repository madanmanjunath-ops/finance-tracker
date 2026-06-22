/* ============================================================
   views_dashboard.jsx — overview dashboard
   ============================================================ */
function KpiCard({ icon, iconBg, iconColor, label, value, delta, deltaDir, sub }) {
  return (
    <div className="card card-pad kpi fade-in" style={{ minWidth: 0 }}>
      <div className="kpi-label">
        <span className="kpi-ico" style={{ background: iconBg, color: iconColor }}><Icon name={icon} /></span>
        {label}
      </div>
      <div className="kpi-val num" style={{ fontSize: "clamp(22px, 2.6vw, 30px)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
      {delta != null ? (
        <div className={"kpi-delta " + (deltaDir === "up" ? "up" : deltaDir === "down" ? "down" : "")}>
          {deltaDir && <Icon name={deltaDir === "up" ? "arrowUpRight" : "arrowDownRight"} size={14} />}
          {delta} <span style={{ color: "var(--text-3)", fontWeight: 600 }}>{sub}</span>
        </div>
      ) : sub ? <div style={{ fontSize: 12.5, color: "var(--text-3)", fontWeight: 600 }}>{sub}</div> : null}
    </div>
  );
}

function FixedExpensesCard({ state, actions }) {
  const cur = state.displayCurrency;
  const items = state.fixedExpenses || [];
  const [editing, setEditing] = useState(false);
  const total = Compute.fixedMonthly(state);
  return (
    <div className="lt-wrap" style={{ background: "var(--surface)" }}>
      <div style={{ display: "flex", alignItems: "center", padding: "9px 14px", borderBottom: "1px solid var(--border-soft)" }}>
        <span style={{ fontWeight: 700, fontSize: 13.5 }}>Fixed monthly</span>
        <span className="num" style={{ marginLeft: 8, fontSize: 12, color: "var(--text-3)", fontWeight: 700 }}>{FT.fmt(total, cur)}/mo</span>
        <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => setEditing(true)}><Icon name="settings" size={13} />Manage</button>
      </div>
      {items.length ? (
        <table className="ltable" style={{ fontSize: 12.5 }}>
          <tbody>
            {items.map(f => (
              <tr key={f.id}>
                <td style={{ whiteSpace: "nowrap" }}><span className="lt-dot" style={{ background: FT.catOf(f.category).color }}></span>{f.label}</td>
                <td className="lt-mut" style={{ width: 50, textAlign: "right" }}>{f.dueDay ? f.dueDay + "th" : ""}</td>
                <td className="lt-amt" style={{ width: 90 }}>{FT.fmt(f.amount, f.currency || cur)}</td>
              </tr>
            ))}
            <tr className="lt-group"><td>Total</td><td></td><td className="lt-amt">{FT.fmt(total, cur)}</td></tr>
          </tbody>
        </table>
      ) : <div className="empty" style={{ padding: "20px" }}><div style={{ fontSize: 12.5 }}>No fixed expenses yet. Tap Manage to add rent, EMIs, subscriptions.</div></div>}
      {editing && <FixedExpenseEditor state={state} actions={actions} onClose={() => setEditing(false)} />}
    </div>
  );
}

function FixedExpenseEditor({ state, actions, onClose }) {
  const cur = state.displayCurrency;
  const [rows, setRows] = useState((state.fixedExpenses || []).map(f => ({ ...f })));
  const [suggested, setSuggested] = useState(null);
  const upd = (id, k, v) => setRows(rows.map(r => r.id === id ? { ...r, [k]: v } : r));
  const add = () => setRows([...rows, { id: FT.uid(), label: "", amount: 0, currency: "INR", dueDay: 1, category: "bills" }]);
  const del = (id) => setRows(rows.filter(r => r.id !== id));
  function save() { actions.setFixedExpenses(rows.filter(r => r.label.trim() && r.amount > 0)); onClose(); }
  function loadSuggestions() {
    const s = actions.suggestFixedFromHistory(state);
    setSuggested(s.filter(x => !rows.some(r => r.label.toLowerCase() === x.label.toLowerCase())));
  }
  return (
    <Modal title="Fixed monthly expenses" wide onClose={onClose}
      foot={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save}><Icon name="check" size={15} />Save</button></>}>
      <div className="modal-body" style={{ gap: 10, overflowY: "auto", flex: 1, minHeight: 0 }}>
        {rows.map(r => (
          <div key={r.id} style={{ display: "flex", gap: 7, alignItems: "center" }}>
            <input className="input" style={{ flex: 1.4, padding: "6px 9px", fontSize: 12.5 }} placeholder="Label" value={r.label} onChange={e => upd(r.id, "label", e.target.value)} />
            <input className="input num" style={{ flex: 1, padding: "6px 9px", fontSize: 12.5 }} type="number" placeholder="Amount" value={r.amount || ""} onChange={e => upd(r.id, "amount", +e.target.value)} />
            <select className="select" style={{ width: 78, padding: "6px 4px", fontSize: 12 }} value={r.dueDay} onChange={e => upd(r.id, "dueDay", +e.target.value)}>
              {Array.from({ length: 28 }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <select className="select" style={{ width: 100, padding: "6px 4px", fontSize: 12 }} value={r.category} onChange={e => upd(r.id, "category", e.target.value)}>
              {FT.EXPENSE_CATS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button className="btn btn-icon btn-ghost" style={{ width: 26, height: 26, color: "var(--neg)" }} onClick={() => del(r.id)}><Icon name="x" size={13} /></button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-sm" onClick={add}><Icon name="plus" size={13} />Add row</button>
          <button className="btn btn-sm" onClick={loadSuggestions}><Icon name="sparkles" size={13} />Suggest from history</button>
          <span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600, alignSelf: "center" }}>Due-day items also feed your bills & brief.</span>
        </div>
        {suggested && suggested.length > 0 && (
          <div style={{ background: "var(--bg-2)", borderRadius: "var(--radius-sm)", padding: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Found {suggested.length} recurring — tap to add:</div>
            {suggested.map(s => (
              <button key={s.id} className="btn btn-sm" style={{ margin: 3 }} onClick={() => { setRows([...rows, s]); setSuggested(suggested.filter(x => x.id !== s.id)); }}>
                + {s.label} {FT.fmtShort(s.amount, cur)}
              </button>
            ))}
          </div>
        )}
        {suggested && suggested.length === 0 && <div style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 600 }}>No new recurring patterns found.</div>}
      </div>
    </Modal>
  );
}

function IncomeAssetsCard({ state, actions }) {
  const cur = state.displayCurrency;
  const items = state.incomeAssets || [];
  const [editing, setEditing] = useState(false);
  // include FD-type accounts with a rate, computed
  const fromAccts = (state.accounts || []).filter(a => ["fd", "rd", "liquid"].includes((a.type || "").toLowerCase()) && a.rate).map(a => ({
    id: "acct:" + a.id, label: a.name, principal: Compute.liveBal(a, state), rate: a.rate, currency: a.currency || "INR", fromAcct: true,
  }));
  const all = [...fromAccts, ...items];
  const monthlyOf = (a) => Compute.conv((a.principal || 0) * (a.rate || 0) / 100 / 12, a.currency || "INR", state);
  const total = all.reduce((s, a) => s + monthlyOf(a), 0);
  return (
    <div className="lt-wrap" style={{ background: "var(--surface)" }}>
      <div style={{ display: "flex", alignItems: "center", padding: "9px 14px", borderBottom: "1px solid var(--border-soft)" }}>
        <span style={{ fontWeight: 700, fontSize: 13.5 }}>Income assets</span>
        <span className="num" style={{ marginLeft: 8, fontSize: 12, color: "var(--pos)", fontWeight: 700 }}>{FT.fmt(total, cur)}/mo</span>
        <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => setEditing(true)}><Icon name="settings" size={13} />Manage</button>
      </div>
      {all.length ? (
        <table className="ltable" style={{ fontSize: 12.5 }}>
          <thead><tr><th>Asset</th><th style={{ width: 50, textAlign: "right" }}>Rate</th><th style={{ width: 80, textAlign: "right" }}>₹/mo</th></tr></thead>
          <tbody>
            {all.map(a => (
              <tr key={a.id}>
                <td style={{ whiteSpace: "nowrap" }}>{a.label}{a.fromAcct && <span className="lt-mut" style={{ fontSize: 10.5, marginLeft: 5 }}>acct</span>}</td>
                <td className="lt-mut" style={{ textAlign: "right" }}>{a.rate}%</td>
                <td className="lt-amt" style={{ color: "var(--pos)" }}>{FT.fmt(monthlyOf(a), cur)}</td>
              </tr>
            ))}
            <tr className="lt-group"><td>Passive total</td><td></td><td className="lt-amt" style={{ color: "var(--pos)" }}>{FT.fmt(total, cur)}</td></tr>
          </tbody>
        </table>
      ) : <div className="empty" style={{ padding: "20px" }}><div style={{ fontSize: 12.5 }}>No income assets yet. Tap Manage to add FDs, deposits with their rate.</div></div>}
      {editing && <IncomeAssetEditor state={state} actions={actions} onClose={() => setEditing(false)} />}
    </div>
  );
}

function IncomeAssetEditor({ state, actions, onClose }) {
  const [rows, setRows] = useState((state.incomeAssets || []).map(a => ({ ...a })));
  const upd = (id, k, v) => setRows(rows.map(r => r.id === id ? { ...r, [k]: v } : r));
  const add = () => setRows([...rows, { id: FT.uid(), label: "", principal: 0, rate: 7, currency: "INR" }]);
  const del = (id) => setRows(rows.filter(r => r.id !== id));
  function save() { actions.setIncomeAssets(rows.filter(r => r.label.trim() && r.principal > 0)); onClose(); }
  return (
    <Modal title="Income-producing assets" wide onClose={onClose}
      foot={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save}><Icon name="check" size={15} />Save</button></>}>
      <div className="modal-body" style={{ gap: 10, overflowY: "auto", flex: 1, minHeight: 0 }}>
        <div style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 600 }}>FDs already in your Accounts (with a rate) show automatically. Add anything else here.</div>
        {rows.map(r => (
          <div key={r.id} style={{ display: "flex", gap: 7, alignItems: "center" }}>
            <input className="input" style={{ flex: 1.4, padding: "6px 9px", fontSize: 12.5 }} placeholder="e.g. SBI FD" value={r.label} onChange={e => upd(r.id, "label", e.target.value)} />
            <input className="input num" style={{ flex: 1, padding: "6px 9px", fontSize: 12.5 }} type="number" placeholder="Principal" value={r.principal || ""} onChange={e => upd(r.id, "principal", +e.target.value)} />
            <input className="input num" style={{ width: 64, padding: "6px 9px", fontSize: 12.5 }} type="number" step="0.1" placeholder="%" value={r.rate || ""} onChange={e => upd(r.id, "rate", +e.target.value)} />
            <button className="btn btn-icon btn-ghost" style={{ width: 26, height: 26, color: "var(--neg)" }} onClick={() => del(r.id)}><Icon name="x" size={13} /></button>
          </div>
        ))}
        <button className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={add}><Icon name="plus" size={13} />Add asset</button>
      </div>
    </Modal>
  );
}

function OwedModal({ state, actions, onClose }) {
  const cur = state.displayCurrency;
  const open = (state.receivables || []).filter(r => !r.settled);
  const [partial, setPartial] = useState({});
  return (
    <Modal title="Owed to you" onClose={onClose} foot={<button className="btn btn-ghost" onClick={onClose}>Close</button>}>
      <div className="modal-body" style={{ gap: 0 }}>
        {open.length ? open.map(r => (
          <div key={r.id} style={{ display: "flex", gap: 11, padding: "11px 0", borderBottom: "1px solid var(--border-soft)", alignItems: "center" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 650, fontSize: 13.5 }}>{r.label}</div>
              <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>{FT.relDate(r.date)} · you paid {FT.fmt(r.total, r.currency)}, your share {FT.fmt(r.yourShare, r.currency)}{(r.settlements || []).length ? " · partially settled" : ""}</div>
            </div>
            <span className="num" style={{ fontWeight: 700, color: "var(--pos)", whiteSpace: "nowrap" }}>{FT.fmt(r.owed, r.currency)}</span>
            <button className="btn btn-sm btn-primary" onClick={() => actions.settleReceivable(r.id)} title="Mark fully repaid">Settle</button>
          </div>
        )) : <div className="empty" style={{ padding: 24 }}>Nothing outstanding — all settled.</div>}
        {open.length > 0 && <div style={{ fontSize: 11.5, color: "var(--text-3)", fontWeight: 600, marginTop: 12 }}>Settling returns the cash to your account as a reconciliation — it doesn't count as income.</div>}
      </div>
    </Modal>
  );
}

/* ---------------- Daily brief: quiet unless something's actionable ----------------
   Mechanical items computed instantly; one cached AI note per day (7am refresh). */
function buildBriefItems(state) {
  const cur = state.displayCurrency;
  const items = [];
  const today = new Date();

  // 1) credit-card payment due TODAY or TOMORROW only (no other timeframe)
  (state.cards || []).forEach(c => {
    const d = FT.daysUntil(c.dueDay);
    if (d === 0 || d === 1) {
      const amt = c.balance ? FT.fmt(c.balance, c.currency || cur) : null;
      items.push({ icon: "creditCard", tone: d === 0 ? "neg" : "warn",
        title: `${c.name || "Card"} payment ${d === 0 ? "due today" : "due tomorrow"}`,
        detail: amt ? `${amt} outstanding` : "Pay to avoid interest & late fees" });
    }
  });
  // also card bills that arrived in the inbox, due today/tomorrow only
  (state.upcomingBills || []).forEach(b => {
    const d = Math.ceil((new Date(b.dueDate) - today) / 86400000);
    if (d === 0 || d === 1) items.push({ icon: "receipt", tone: d === 0 ? "neg" : "warn",
      title: `${b.merchant} — ${FT.fmt(b.amount, b.currency || cur)} ${d === 0 ? "due today" : "due tomorrow"}`,
      detail: "From your inbox", billId: b.id });
  });

  // 2) best card to use today
  if ((state.cards || []).length) {
    let best = null;
    state.cards.forEach(c => {
      const def = FT.cardDef(c.cardType) || {};
      const rate = Math.max(FT.rewardRate(c, "online"), FT.rewardRate(c, "dining"), (c.base != null ? c.base : def.base) || 1);
      const float = FT.floatDays(c) || 0;
      const score = rate * 100 + float;
      if (!best || score > best.score) best = { c, def, rate, float, score };
    });
    if (best) items.push({ icon: "creditCard", tone: "pos", title: `Use ${best.c.name || best.def.name} today`,
      detail: `${best.rate}% on everyday spend${best.float ? ` · ~${best.float}d float left` : ""}` });
  }

  // 3) one useful dynamic nudge: a card whose statement generates tomorrow
  //    (stop spending on it to keep the full interest-free window)
  (state.cards || []).forEach(c => {
    if (FT.daysUntil(c.billingDay) === 1) items.push({ icon: "alarm", tone: "warn",
      title: `${c.name || "A card"} statement generates tomorrow`,
      detail: "Pause spends on it today; use another card for the longer float." });
  });

  return items;
}

function DailyBrief({ state, actions, go }) {
  const items = useMemo(() => buildBriefItems(state), [state]);

  const TONE = { pos: ["var(--pos)", "var(--pos-soft)"], warn: ["var(--warn)", "var(--warn-soft, var(--surface-3))"], neg: ["var(--neg)", "var(--neg-soft)"], muted: ["var(--text-2)", "var(--surface-2)"] };
  const total = items.length;
  const [open, setOpen] = useState(true);

  return (
    <div className="lt-wrap fade-in" style={{ background: "var(--surface)" }}>
      <button onClick={() => setOpen(!open)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 14px", width: "100%", background: "none", border: "none", cursor: "pointer", textAlign: "left", borderBottom: open && total ? "1px solid var(--border-soft)" : "none" }}>
        <Icon name={open ? "chevronDown" : "chevronRight"} size={14} style={{ color: "var(--text-3)" }} />
        <span style={{ fontWeight: 700, fontSize: 13 }}>Today</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: total ? "var(--accent)" : "var(--text-3)", fontWeight: 600 }}>{total ? total + " to note" : "All clear"}</span>
      </button>
      {open && items.map((it, i) => {
        const [fg, bg] = TONE[it.tone] || TONE.muted;
        return (
          <div key={i} style={{ display: "flex", gap: 9, padding: "8px 14px", borderBottom: i < items.length - 1 ? "1px solid var(--border-soft)" : "none", alignItems: "center" }}>
            <span className="brief-ico" style={{ background: bg, color: fg, width: 26, height: 26 }}><Icon name={it.icon} size={13} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 650 }}>{it.title}</div>
              <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1, lineHeight: 1.35 }}>{it.detail}</div>
            </div>
            {it.billId && <button className="btn btn-sm btn-primary" style={{ flexShrink: 0, padding: "3px 10px" }} onClick={() => actions.payBill(it.billId)}>Pay</button>}
          </div>
        );
      })}
    </div>
  );
}

function Dashboard({ state, actions, go, openAdd }) {
  const cur = state.displayCurrency;
  const tm = Compute.thisMonth(), pm = Compute.prevMonth();
  const incThis = Compute.sum(state, "income", tm);
  const expThis = Compute.sum(state, "expense", tm);
  const incPrev = Compute.sum(state, "income", pm);
  const expPrev = Compute.sum(state, "expense", pm);
  const nw = Compute.netWorth(state);
  const nwSeries = Compute.netWorthSeries(state);
  const nwPrev = nwSeries.length > 1 ? nwSeries[nwSeries.length - 2].value : nw.net;
  const series = Compute.monthlySeries(state, 6);
  const breakdown = Compute.categoryBreakdown(state, "expense", tm).slice(0, 6);
  const savRate = Compute.savingsRate(incThis, expThis);

  const expDelta = Compute.pctChange(expThis, expPrev);
  const incDelta = Compute.pctChange(incThis, incPrev);
  const nwDelta = Compute.pctChange(nw.net, nwPrev);

  const recent = state.transactions.slice(0, 6);
  const liveCash = Compute.totalLiveBal(state);
  const liq = Compute.liquidBreakdown(state);
  const credit = Compute.creditSummary(state);
  const owed = Compute.owedToYou(state);
  const owedCount = (state.receivables || []).filter(r => !r.settled).length;
  const [showOwed, setShowOwed] = useState(false);
  const pendingCount = (state.pending || []).length;
  const uncatCount = state.transactions.filter(t => t.category === "uncat").length;

  // upcoming: manual recurring (next 16 days) + bills detected from emails
  const today = new Date();
  const recUpcoming = (state.recurring || []).map(r => {
    const d = new Date(today.getFullYear(), today.getMonth(), r.day);
    if (d < today) d.setMonth(d.getMonth() + 1);
    const days = Math.ceil((d - today) / 86400000);
    return { ...r, days, kind: "recurring" };
  }).filter(r => r.days <= 16);
  const billUpcoming = (state.upcomingBills || []).map(b => {
    const days = Math.ceil((new Date(b.dueDate) - today) / 86400000);
    return { ...b, name: b.merchant, cat: b.category || "bills", days, kind: "bill" };
  }).filter(b => b.days <= 30); // keep overdue visible too
  const upcoming = [...billUpcoming, ...recUpcoming].sort((a, b) => a.days - b.days).slice(0, 6);

  return (
    <div className="grid" style={{ gap: 18 }}>
      <DailyBrief state={state} actions={actions} go={go} />

      {/* top stat strip: net worth · live cash (cash+FD) · spent · available credit */}
      <div className="grid kpi-row" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
          <span style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 700 }}>Net worth</span>
          <span className="num" style={{ fontSize: 22, fontWeight: 700, whiteSpace: "nowrap" }}>{FT.fmt(nw.net, cur)}</span>
          <span style={{ fontSize: 11.5, color: nwDelta >= 0 ? "var(--pos)" : "var(--neg)", fontWeight: 600 }}>{nwDelta >= 0 ? "▲" : "▼"} {Math.abs(nwDelta).toFixed(1)}% this month</span>
        </div>
        <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
          <span style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 700 }}>Live cash · liquid</span>
          <span className="num" style={{ fontSize: 22, fontWeight: 700, whiteSpace: "nowrap" }}>{FT.fmt(liq.total, cur)}</span>
          <span style={{ fontSize: 11.5, color: "var(--text-3)", fontWeight: 600 }}>{FT.fmtShort(liq.cash, cur)} cash + {FT.fmtShort(liq.fd, cur)} FD · <span style={{ color: "var(--accent)", cursor: "pointer" }} onClick={() => go("accounts")}>reconcile</span></span>
        </div>
        <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
          <span style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 700 }}>Spent · this month</span>
          <span className="num" style={{ fontSize: 22, fontWeight: 700, whiteSpace: "nowrap" }}>{FT.fmt(expThis, cur)}</span>
          <span style={{ fontSize: 11.5, color: expDelta <= 0 ? "var(--pos)" : "var(--neg)", fontWeight: 600 }}>{expDelta <= 0 ? "▼" : "▲"} {Math.abs(expDelta).toFixed(0)}% vs last</span>
        </div>
        <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
          <span style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 700 }}>Available credit</span>
          <span className="num" style={{ fontSize: 22, fontWeight: 700, whiteSpace: "nowrap" }}>{FT.fmtShort(credit.avail, cur)}</span>
          <span style={{ fontSize: 11.5, color: "var(--text-3)", fontWeight: 600 }}>of {FT.fmtShort(credit.limit, cur)} across {state.cards.length} card{state.cards.length !== 1 ? "s" : ""}</span>
        </div>
      </div>

      {/* fixed expenses + income assets tables */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
        <FixedExpensesCard state={state} actions={actions} />
        <IncomeAssetsCard state={state} actions={actions} />
      </div>
      {showOwed && <OwedModal state={state} actions={actions} onClose={() => setShowOwed(false)} />}

      <FinancialCritic state={state} actions={actions} />

      {/* charts */}
      <div className="grid" style={{ gridTemplateColumns: "1.5fr 1fr" }}>
        <div className="card card-pad fade-in">
          <div className="card-h">
            <div><div className="card-title">Cash flow</div><div className="card-sub">Income vs expenses · last 6 months</div></div>
            <div style={{ display: "flex", gap: 14, fontSize: 12, fontWeight: 700 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span className="cat-dot" style={{ background: "var(--pos)" }}></span>Income</span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span className="cat-dot" style={{ background: "var(--neg)" }}></span>Expense</span>
            </div>
          </div>
          <BarsChart data={series} currency={cur} height={230} />
        </div>
        <div className="card card-pad fade-in">
          <div className="card-h"><div><div className="card-title">Spending mix</div><div className="card-sub">This month by category</div></div></div>
          {breakdown.length ? (
            <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
              <Donut data={breakdown} size={150} thickness={20}
                center={<div><div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 700 }}>Spent</div><div className="display" style={{ fontSize: 17, fontWeight: 600 }}>{FT.fmtShort(expThis, cur)}</div></div>} />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 9 }}>
                {breakdown.slice(0, 5).map(b => (
                  <div key={b.cat} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                    <span className="cat-dot" style={{ background: b.color }}></span>
                    <span style={{ fontWeight: 700, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.label}</span>
                    <span className="num" style={{ color: "var(--text-2)", fontWeight: 700 }}>{FT.fmtShort(b.value, cur)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : <div className="empty">No spending yet this month</div>}
        </div>
      </div>

      {/* recent + side column */}
      <div className="grid" style={{ gridTemplateColumns: "1.5fr 1fr" }}>
        <div className="card card-pad fade-in">
          <div className="card-h">
            <div className="card-title">Recent activity</div>
            <button className="btn btn-ghost btn-sm" onClick={() => go("money")}>View all <Icon name="chevronRight" size={15} /></button>
          </div>
          <div>
            {recent.map(t => <TxnRow key={t.id} t={t} cur={cur} />)}
          </div>
        </div>
        <div className="grid" style={{ gap: 18, alignContent: "start" }}>
          {(pendingCount > 0 || uncatCount > 0) && (
            <div className="card card-pad fade-in" style={{ borderColor: "color-mix(in srgb, var(--warn) 30%, var(--border))" }}>
              <div className="card-h"><div className="card-title">Needs your review</div></div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {pendingCount > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span className="brief-ico" style={{ background: "var(--warn-soft)", color: "var(--warn)" }}><Icon name="download" size={15} /></span>
                    <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 650 }}>{pendingCount} imported · confirm</div><div style={{ fontSize: 11.5, color: "var(--text-3)", fontWeight: 600 }}>low-confidence auto-imports</div></div>
                    <button className="btn btn-sm btn-primary" onClick={() => go("money")}>Review</button>
                  </div>
                )}
                {uncatCount > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span className="brief-ico" style={{ background: "var(--surface-2)", color: "var(--text-2)" }}><Icon name="wand" size={15} /></span>
                    <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 650 }}>{uncatCount} need a label</div><div style={{ fontSize: 11.5, color: "var(--text-3)", fontWeight: 600 }}>mostly UPI to shops & autos</div></div>
                    <button className="btn btn-sm" onClick={() => go("money")}>Fix</button>
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="card card-pad fade-in">
            <div className="card-h"><div className="card-title">Budgets</div><button className="btn btn-ghost btn-sm" onClick={() => go("money")}>Manage</button></div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {state.budgets.slice(0, 4).map(b => {
                const c = FT.catOf(b.cat);
                const spent = state.transactions.filter(t => t.type === "expense" && t.category === b.cat && Compute.inMonth(t.date, tm)).reduce((s, t) => s + Compute.tAmt(t, state), 0);
                const pct = Math.min(100, (spent / b.limit) * 100);
                const over = spent > b.limit;
                return (
                  <div key={b.cat}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 7 }}><span className="cat-dot" style={{ background: c.color }}></span>{c.name}</span>
                      <span className="num" style={{ color: over ? "var(--neg)" : "var(--text-2)" }}>{FT.fmtShort(spent, cur)} / {FT.fmtShort(b.limit, cur)}</span>
                    </div>
                    <div className="bar-track"><div className="bar-fill" style={{ width: pct + "%", background: over ? "var(--neg)" : c.color }}></div></div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="card card-pad fade-in">
            <div className="card-h"><div className="card-title">Upcoming bills</div><span className="pill"><Icon name="repeat" size={13} /> {upcoming.length}</span></div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {upcoming.length ? upcoming.map(r => {
                const c = FT.catOf(r.cat);
                const overdue = r.days < 0;
                const dueTxt = overdue ? `Overdue ${-r.days}d` : r.days === 0 ? "Due today" : r.days === 1 ? "Tomorrow" : "In " + r.days + " days";
                return (
                  <div key={r.kind + r.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 0" }}>
                    <span className="txn-ico"><span style={{ width: 8, height: 8, borderRadius: "50%", background: c.color }}></span></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</div>
                      <div style={{ fontSize: 11.5, color: overdue || r.days <= 1 ? "var(--warn)" : "var(--text-3)", fontWeight: 600 }}>{dueTxt}{r.kind === "bill" && <span style={{ color: "var(--text-3)" }}> · from email</span>}</div>
                    </div>
                    <div className="num" style={{ fontWeight: 700, fontSize: 13.5 }}>{FT.fmt(r.amount, r.currency || cur)}</div>
                    {r.kind === "bill" && actions && (
                      <div style={{ display: "flex", gap: 4 }}>
                        <button className="btn btn-sm btn-primary" style={{ padding: "4px 10px", fontSize: 11.5 }} onClick={() => actions.payBill(r.id)} title="Mark paid — books the transaction">Paid</button>
                        <button className="btn btn-sm btn-ghost" style={{ padding: "4px 7px" }} onClick={() => actions.dismissBill(r.id)} title="Dismiss"><Icon name="x" size={12} /></button>
                      </div>
                    )}
                  </div>
                );
              }) : <div className="empty" style={{ padding: "20px 0" }}>Nothing due soon</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* tiny sparkline */
function Sparkline({ points, color, w = 100, h = 40 }) {
  const min = Math.min(...points), max = Math.max(...points), range = max - min || 1;
  const X = i => (i / (points.length - 1 || 1)) * w;
  const Y = v => h - ((v - min) / range) * h;
  const d = points.map((p, i) => `${i ? "L" : "M"}${X(i)},${Y(p)}`).join(" ");
  return (
    <svg width={w} height={h} style={{ overflow: "visible" }}>
      <path d={`${d} L${w},${h} L0,${h} Z`} fill={color} opacity="0.12" />
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={X(points.length - 1)} cy={Y(points[points.length - 1])} r="3" fill={color} />
    </svg>
  );
}

/* shared transaction row — amount shown in its native currency */
function TxnRow({ t, cur, onClick }) {
  const c = FT.catOf(t.category);
  const isInc = t.type === "income";
  const isXfer = t.type === "transfer";
  const native = t.currency || "INR";
  return (
    <div className="txn" onClick={onClick} style={onClick ? { cursor: "pointer" } : null}>
      <div className="txn-ico"><span style={{ width: 8, height: 8, borderRadius: "50%", background: isXfer ? "var(--text-3)" : c.color }}></span></div>
      <div style={{ minWidth: 0 }}>
        <div className="txn-name" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.merchant}</div>
        <div className="txn-meta">
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span className="cat-dot" style={{ background: c.color }}></span>{c.name}</span>
          <span>·</span><span>{FT.relDate(t.date)}</span>
          {native !== (cur || "INR") && <span className="tag" style={{ background: "var(--surface-3)", color: "var(--text-2)" }}>{native}</span>}
          {t.source === "email" && <span className="tag" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>email</span>}
          {isXfer && <span className="tag" style={{ background: "var(--surface-3)", color: "var(--text-2)" }}>transfer</span>}
        </div>
      </div>
      <div className="txn-amt num" style={{ color: isXfer ? "var(--text-2)" : isInc ? "var(--pos)" : "var(--text)" }}>
        {isXfer ? "⇄ " : isInc ? "+" : "−"}{FT.fmt(t.amount, native)}
      </div>
    </div>
  );
}

Object.assign(window, { Dashboard, Sparkline, TxnRow, KpiCard });
