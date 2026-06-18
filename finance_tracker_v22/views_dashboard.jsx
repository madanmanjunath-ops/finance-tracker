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
  const today = new Date(); const todayISO = FT.todayISO();

  // 1) best card to use — highest reward on everyday spend, tie-broken by float
  if ((state.cards || []).length) {
    let best = null;
    state.cards.forEach(c => {
      const def = FT.cardDef(c.cardType) || {};
      const rate = Math.max(FT.rewardRate(c, "online"), FT.rewardRate(c, "dining"), (c.base != null ? c.base : def.base) || 1);
      const float = FT.floatDays(c) || 0;
      const score = rate * 100 + float; // reward dominates, float breaks ties
      if (!best || score > best.score) best = { c, def, rate, float, score };
    });
    if (best) items.push({ icon: "creditCard", tone: "pos", title: `Use ${best.c.name || best.def.name} today`,
      detail: `${best.rate}% on everyday spend${best.float ? ` · ~${best.float} days interest-free float left` : ""}` });
  }

  // 2) statement-tomorrow / float alerts
  (state.cards || []).forEach(c => {
    const toStmt = FT.daysUntil(c.billingDay);
    if (toStmt === 1) items.push({ icon: "alarm", tone: "warn", title: `${c.name || "A card"} statement generates tomorrow`,
      detail: "Pause spends on it today to get the full interest-free period; use another card." });
  });

  // 3) bills due today / soon
  (state.upcomingBills || []).forEach(b => {
    const d = Math.ceil((new Date(b.dueDate) - today) / 86400000);
    if (d <= 3) items.push({ icon: "receipt", tone: d < 0 ? "neg" : "warn",
      title: `${b.merchant} — ${FT.fmt(b.amount, b.currency || cur)} ${d < 0 ? "overdue" : d === 0 ? "due today" : "due in " + d + "d"}`,
      detail: "From your inbox", billId: b.id });
  });

  // 4) unusual spend today vs 30-day daily average
  const last30 = state.transactions.filter(t => t.type === "expense" && t.date >= FT.daysAgo(30));
  const avgDaily = last30.reduce((s, t) => s + Compute.tAmt(t, state), 0) / 30;
  const todaySpend = state.transactions.filter(t => t.type === "expense" && t.date === todayISO).reduce((s, t) => s + Compute.tAmt(t, state), 0);
  if (avgDaily > 0 && todaySpend > avgDaily * 3 && todaySpend > 2000)
    items.push({ icon: "trendingUp", tone: "warn", title: `High spend today: ${FT.fmt(todaySpend, cur)}`, detail: `About ${(todaySpend / avgDaily).toFixed(1)}× your ${FT.fmt(avgDaily, cur)} daily average.` });

  // 5) idle cash
  (state.accounts || []).forEach(a => {
    if (a.type === "bank") {
      const bal = Compute.liveBal(a, state);
      if (bal > 300000 && (!a.rate || a.rate < 5))
        items.push({ icon: "piggyBank", tone: "muted", title: `${FT.fmtShort(bal, cur)} idle in ${a.name}`,
          detail: `Earning ${a.rate || 3}% — a sweep-in FD would earn ~${FT.fmtShort(bal * 0.04, cur)}/yr more with the same liquidity.` });
    }
  });

  // 6) reward milestone (if a card defines one)
  // 7) debt-free nudge handled in Investments; one-line here if heavy interest
  const dm = (window.debtMetrics ? window.debtMetrics(state) : null);
  if (dm && dm.monthlyInterest > 5000)
    items.push({ icon: "target", tone: "muted", title: `Debt is costing ${FT.fmt(dm.monthlyInterest, cur)}/mo in interest`, detail: "See your quarterly plan in Investments for the fastest payoff path." });

  // urgent money first: overdue/due-today bills lead, then the rest in build order
  const rank = (it) => {
    if (it.icon === "receipt" && it.tone === "neg") return 0; // overdue
    if (it.icon === "receipt" && /due today/.test(it.title)) return 1;
    return 2;
  };
  return items.map((it, i) => ({ it, i })).sort((a, b) => rank(a.it) - rank(b.it) || a.i - b.i).map(x => x.it);
}

function DailyBrief({ state, actions, go }) {
  const items = useMemo(() => buildBriefItems(state), [state]);
  const briefDay = new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10);
  const aiNote = state.brief && state.brief.day === briefDay ? state.brief.aiNote : null;

  // refresh the interpretive AI note once per "brief day" (boundary at 7am).
  useEffect(() => {
    const now = new Date();
    const briefDay = new Date(now.getTime() - 7 * 3600000).toISOString().slice(0, 10); // day starts at 07:00 local
    if (state.brief && state.brief.day === briefDay) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = window.buildSnapshot ? window.buildSnapshot(state) : "";
        const prompt = `Based on this user's finances, write ONE short, specific, non-obvious observation for today (max 22 words) — a nudge they'd act on. No greeting, no preamble, plain text only.\n\n${snap}`;
        const note = (await window.claude.complete(prompt) || "").trim().replace(/^["']|["']$/g, "").slice(0, 160);
        if (!cancelled) actions.saveBrief({ day: briefDay, date: FT.todayISO(), aiNote: note });
      } catch (e) { if (!cancelled) actions.saveBrief({ day: briefDay, date: FT.todayISO(), aiNote: "" }); }
    })();
    return () => { cancelled = true; };
  }, []);

  const TONE = { pos: ["var(--pos)", "var(--pos-soft)"], warn: ["var(--warn)", "var(--warn-soft, var(--surface-3))"], neg: ["var(--neg)", "var(--neg-soft)"], muted: ["var(--text-2)", "var(--surface-2)"] };
  const total = items.length + (aiNote ? 1 : 0);

  return (
    <div className="lt-wrap fade-in" style={{ background: "var(--surface)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 16px", borderBottom: total ? "1px solid var(--border-soft)" : "none" }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>Today</span>
        <span style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 600 }}>{new Date().toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" })}</span>
        <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--text-3)" }}>{total ? total + " worth your attention" : "All clear"}</span>
      </div>
      {aiNote && (
        <div style={{ display: "flex", gap: 11, padding: "11px 16px", borderBottom: "1px solid var(--border-soft)" }}>
          <span className="brief-ico" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}><Icon name="sparkles" size={15} /></span>
          <div style={{ fontSize: 13.5, fontWeight: 600, alignSelf: "center" }}>{aiNote}</div>
        </div>
      )}
      {items.map((it, i) => {
        const [fg, bg] = TONE[it.tone] || TONE.muted;
        return (
          <div key={i} style={{ display: "flex", gap: 11, padding: "11px 16px", borderBottom: i < items.length - 1 ? "1px solid var(--border-soft)" : "none", alignItems: "center" }}>
            <span className="brief-ico" style={{ background: bg, color: fg }}><Icon name={it.icon} size={15} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 650 }}>{it.title}</div>
              <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2, lineHeight: 1.45 }}>{it.detail}</div>
            </div>
            {it.billId && <button className="btn btn-sm btn-primary" style={{ flexShrink: 0 }} onClick={() => actions.payBill(it.billId)}>Pay</button>}
          </div>
        );
      })}
      {!total && <div style={{ padding: "16px", fontSize: 13, color: "var(--text-3)", textAlign: "center" }}>Nothing needs your attention today.</div>}
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
  const owed = Compute.owedToYou(state);
  const owedCount = (state.receivables || []).filter(r => !r.settled).length;
  const [showOwed, setShowOwed] = useState(false);

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

      {/* balanced numbers: live cash, spend, owed, net worth */}
      <div className="grid kpi-row" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
          <span style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 700 }}>Bank balance · live</span>
          <span className="num" style={{ fontSize: 22, fontWeight: 700, whiteSpace: "nowrap" }}>{FT.fmt(liveCash, cur)}</span>
          <span style={{ fontSize: 11.5, color: "var(--text-3)", fontWeight: 600 }}>across {state.accounts.filter(a => FT.acctType(a.type).asset !== false && a.type !== "loan").length} accounts</span>
        </div>
        <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
          <span style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 700 }}>Spent · this month</span>
          <span className="num" style={{ fontSize: 22, fontWeight: 700, whiteSpace: "nowrap" }}>{FT.fmt(expThis, cur)}</span>
          <span style={{ fontSize: 11.5, color: expDelta <= 0 ? "var(--pos)" : "var(--neg)", fontWeight: 600 }}>{expDelta <= 0 ? "▼" : "▲"} {Math.abs(expDelta).toFixed(0)}% vs last month</span>
        </div>
        <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, cursor: owed > 0 ? "pointer" : "default" }} onClick={() => owed > 0 && setShowOwed(true)}>
          <span style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 700 }}>Owed to you</span>
          <span className="num" style={{ fontSize: 22, fontWeight: 700, color: owed > 0 ? "var(--pos)" : "var(--text)", whiteSpace: "nowrap" }}>{FT.fmt(owed, cur)}</span>
          <span style={{ fontSize: 11.5, color: "var(--text-3)", fontWeight: 600 }}>{owedCount ? owedCount + " open · tap to settle" : "all settled"}</span>
        </div>
        <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
          <span style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 700 }}>Net worth</span>
          <span className="num" style={{ fontSize: 22, fontWeight: 700, whiteSpace: "nowrap" }}>{FT.fmt(nw.net, cur)}</span>
          <span style={{ fontSize: 11.5, color: nwDelta >= 0 ? "var(--pos)" : "var(--neg)", fontWeight: 600 }}>{nwDelta >= 0 ? "▲" : "▼"} {Math.abs(nwDelta).toFixed(1)}% this month</span>
        </div>
      </div>
      {showOwed && <OwedModal state={state} actions={actions} onClose={() => setShowOwed(false)} />}

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
            <button className="btn btn-ghost btn-sm" onClick={() => go("transactions")}>View all <Icon name="chevronRight" size={15} /></button>
          </div>
          <div>
            {recent.map(t => <TxnRow key={t.id} t={t} cur={cur} />)}
          </div>
        </div>
        <div className="grid" style={{ gap: 18, alignContent: "start" }}>
          <div className="card card-pad fade-in">
            <div className="card-h"><div className="card-title">Budgets</div><button className="btn btn-ghost btn-sm" onClick={() => go("transactions")}>Manage</button></div>
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
