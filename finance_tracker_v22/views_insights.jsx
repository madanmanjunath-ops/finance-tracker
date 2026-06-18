/* ============================================================
   views_insights.jsx — spending insights: rule-based flags + AI critique
   ============================================================ */
function buildFlags(state) {
  const cur = state.displayCurrency;
  const tm = Compute.thisMonth();
  const exp = state.transactions.filter(t => t.type === "expense");
  const expThis = exp.filter(t => Compute.inMonth(t.date, tm));
  const flags = [];

  // 1) biggest spends this month
  const top = [...expThis].sort((a, b) => Compute.tAmt(b, state) - Compute.tAmt(a, state)).slice(0, 5);

  // 2) over-budget categories
  (state.budgets || []).forEach(b => {
    const spent = expThis.filter(t => t.category === b.cat).reduce((s, t) => s + Compute.tAmt(t, state), 0);
    if (b.limit && spent > b.limit) flags.push({ sev: 1, icon: "arrowUpRight", color: "var(--neg)", title: `${FT.catOf(b.cat).name} over budget`, body: `Spent ${FT.fmt(spent, cur)} of your ${FT.fmt(b.limit, cur)} budget — ${Math.round((spent/b.limit-1)*100)}% over.` });
  });

  // 3) duplicate charges (same merchant + amount within 4 days)
  const seen = {};
  exp.slice(0, 200).forEach(t => {
    const key = (t.merchant || "").toLowerCase() + "|" + Math.round(t.amount) + "|" + (t.currency||"INR");
    if (seen[key]) {
      const prev = seen[key];
      const d = Math.abs((new Date(t.date) - new Date(prev.date)) / 86400000);
      if (d <= 4 && d >= 0) flags.push({ sev: 1, icon: "info", color: "var(--warn)", title: "Possible duplicate charge", body: `${t.merchant} · ${FT.fmt(Compute.tAmt(t, state), cur)} appears twice within ${Math.round(d)} day(s) (${FT.relDate(prev.date)} & ${FT.relDate(t.date)}). Check for a double charge.` });
    }
    seen[key] = t;
  });

  // 4) category spikes vs 3-month average
  const cats = {};
  expThis.forEach(t => { cats[t.category] = (cats[t.category] || 0) + Compute.tAmt(t, state); });
  Object.entries(cats).forEach(([cat, amt]) => {
    let total3 = 0;
    for (let m = 1; m <= 3; m++) {
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - m);
      const ym = d.toISOString().slice(0, 7);
      total3 += exp.filter(t => t.category === cat && Compute.inMonth(t.date, ym)).reduce((s, t) => s + Compute.tAmt(t, state), 0);
    }
    const avg = total3 / 3;
    if (avg > 0 && amt > avg * 1.4 && amt - avg > 2000) flags.push({ sev: 2, icon: "trending", color: "var(--c4)", title: `${FT.catOf(cat).name} spending spiked`, body: `${FT.fmt(amt, cur)} this month vs ${FT.fmt(avg, cur)} avg — up ${Math.round((amt/avg-1)*100)}%.` });
  });

  // 5) subscription creep
  const subTotal = expThis.filter(t => t.category === "subs").reduce((s, t) => s + Compute.tAmt(t, state), 0);
  const recCount = (state.recurring || []).length;
  if (subTotal > 0 || recCount > 0) flags.push({ sev: 3, icon: "repeat", color: "var(--c5)", title: "Subscriptions & recurring", body: `${FT.fmt(subTotal, cur)} on subscriptions this month across ${recCount} tracked recurring payment${recCount!==1?"s":""}. Review for anything unused.` });

  flags.sort((a, b) => a.sev - b.sev);
  return { top, flags };
}

/* ---------------- Analyze: pivot explorer (slice & dice) ---------------- */
function PivotExplorer({ state }) {
  const cur = state.displayCurrency;
  const [rowsBy, setRowsBy] = useState("category");
  const [colsBy, setColsBy] = useState("month");
  const [show, setShow] = useState("spend");
  const [period, setPeriod] = useState("6m");
  const [open, setOpen] = useState(null);

  const acctName = (id) => { const a = state.accounts.find(x => x.id === id); return a ? a.name : "—"; };

  const txns = useMemo(() => {
    let from = null; const today = new Date();
    if (period === "6m") from = new Date(today.getFullYear(), today.getMonth() - 5, 1).toISOString().slice(0, 10);
    else if (period === "ytd") from = today.getFullYear() + "-01-01";
    else if (period === "12m") from = new Date(today.getFullYear() - 1, today.getMonth() + 1, 1).toISOString().slice(0, 10);
    return state.transactions.filter(t => t.type !== "transfer" && (!from || t.date >= from));
  }, [state.transactions, period]);

  const rowKeyOf = (t) => rowsBy === "category" ? t.category : rowsBy === "account" ? (t.account || "—") : rowsBy === "merchant" ? (t.merchant || "—").trim() : t.type;
  const rowLabelOf = (k) => rowsBy === "category" ? FT.catOf(k).name : rowsBy === "account" ? acctName(k) : rowsBy === "type" ? k[0].toUpperCase() + k.slice(1) : k;
  const colKeyOf = (t) => colsBy === "month" ? t.date.slice(0, 7) : colsBy === "quarter" ? t.date.slice(0, 4) + "·Q" + (Math.floor((+t.date.slice(5, 7) - 1) / 3) + 1) : colsBy === "year" ? t.date.slice(0, 4) : "all";
  const colLabel = (k) => colsBy === "month" ? new Date(k + "-01").toLocaleDateString("en-US", { month: "short", year: "2-digit" }) : colsBy === "quarter" ? k.replace("·", " ") : colsBy === "year" ? k : "Total";
  const valOf = (t) => {
    const a = Compute.tAmt(t, state);
    if (show === "spend") return t.type === "expense" ? a : 0;
    if (show === "income") return t.type === "income" ? a : 0;
    if (show === "net") return t.type === "income" ? a : -a;
    return 1; // count
  };
  const inRow = (t) => show === "spend" ? t.type === "expense" : show === "income" ? t.type === "income" : true;

  const pivot = useMemo(() => {
    const rows = new Map(); const colSet = new Set();
    txns.forEach(t => {
      if (!inRow(t)) return;
      const rk = rowKeyOf(t), ck = colKeyOf(t), v = valOf(t);
      colSet.add(ck);
      if (!rows.has(rk)) rows.set(rk, { cells: new Map(), total: 0 });
      const r = rows.get(rk);
      r.cells.set(ck, (r.cells.get(ck) || 0) + v);
      r.total += v;
    });
    const cols = [...colSet].sort();
    let entries = [...rows.entries()].sort((a, b) => Math.abs(b[1].total) - Math.abs(a[1].total));
    if (entries.length > 14) {
      const keep = entries.slice(0, 13), rest = entries.slice(13);
      const other = { cells: new Map(), total: 0, isOther: true };
      rest.forEach(([, r]) => { r.cells.forEach((v, k) => other.cells.set(k, (other.cells.get(k) || 0) + v)); other.total += r.total; });
      entries = [...keep, ["__other__", other]];
    }
    const colTotals = new Map(); let grand = 0;
    entries.forEach(([, r]) => { r.cells.forEach((v, k) => colTotals.set(k, (colTotals.get(k) || 0) + v)); grand += r.total; });
    return { cols, entries, colTotals, grand };
  }, [txns, rowsBy, colsBy, show]);

  const num = (n) => show === "count" ? String(Math.round(n)) : new Intl.NumberFormat("en-IN").format(Math.round(n));
  const drill = (rk) => txns.filter(t => inRow(t) && rowKeyOf(t) === rk).sort((a, b) => Compute.tAmt(b, state) - Compute.tAmt(a, state));

  function exportCSV() {
    const head = [rowsBy, ...pivot.cols.map(colLabel), "Total"];
    const lines = [head.join(",")];
    pivot.entries.forEach(([k, r]) => lines.push([JSON.stringify(k === "__other__" ? "Other" : rowLabelOf(k)), ...pivot.cols.map(c => Math.round(r.cells.get(c) || 0)), Math.round(r.total)].join(",")));
    lines.push(["Total", ...pivot.cols.map(c => Math.round(pivot.colTotals.get(c) || 0)), Math.round(pivot.grand)].join(","));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = `analyze_${rowsBy}_by_${colsBy}.csv`; a.click();
  }

  const Sel = ({ v, set, opts }) => (
    <select className="select" style={{ width: "auto", padding: "6px 28px 6px 10px", fontSize: 12.5 }} value={v} onChange={e => { set(e.target.value); setOpen(null); }}>
      {opts.map(([val, lab]) => <option key={val} value={val}>{lab}</option>)}
    </select>
  );

  return (
    <div className="lt-wrap fade-in" style={{ background: "var(--surface)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 14px", borderBottom: "1px solid var(--border-soft)", flexWrap: "wrap" }}>
        <span style={{ fontWeight: 700, fontSize: 14, marginRight: 6 }}>Analyze</span>
        <span style={{ fontSize: 11.5, color: "var(--text-3)", fontWeight: 600 }}>Rows</span>
        <Sel v={rowsBy} set={setRowsBy} opts={[["category","Category"],["account","Account"],["merchant","Merchant"],["type","Type"]]} />
        <span style={{ fontSize: 11.5, color: "var(--text-3)", fontWeight: 600 }}>Columns</span>
        <Sel v={colsBy} set={setColsBy} opts={[["month","Month"],["quarter","Quarter"],["year","Year"],["none","None"]]} />
        <span style={{ fontSize: 11.5, color: "var(--text-3)", fontWeight: 600 }}>Show</span>
        <Sel v={show} set={setShow} opts={[["spend","Spend"],["income","Income"],["net","Net"],["count","Count"]]} />
        <div style={{ marginLeft: "auto" }}>
          <Sel v={period} set={setPeriod} opts={[["6m","Last 6 months"],["12m","Last 12 months"],["ytd","This year"],["all","All time"]]} />
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="ltable" style={{ minWidth: pivot.cols.length > 7 ? 760 : 0 }}>
          <thead>
            <tr>
              <th style={{ minWidth: 140 }}>{rowsBy[0].toUpperCase() + rowsBy.slice(1)}</th>
              {colsBy !== "none" && pivot.cols.map(c => <th key={c} style={{ textAlign: "right" }}>{colLabel(c)}</th>)}
              <th style={{ textAlign: "right", minWidth: 90 }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {pivot.entries.length ? pivot.entries.map(([k, r]) => {
              const c = rowsBy === "category" && k !== "__other__" ? FT.catOf(k) : null;
              const isOpen = open === k;
              return (
                <React.Fragment key={k}>
                  <tr style={{ cursor: k === "__other__" ? "default" : "pointer", background: isOpen ? "var(--surface-2)" : "" }} onClick={() => k !== "__other__" && setOpen(isOpen ? null : k)}>
                    <td style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 180 }}>
                      {c && <span className="lt-dot" style={{ background: c.color }}></span>}
                      <span style={{ fontWeight: 650 }}>{k === "__other__" ? "Other" : rowLabelOf(k)}</span>
                      {k !== "__other__" && <Icon name={isOpen ? "chevronUp" : "chevronDown"} size={12} style={{ marginLeft: 6, color: "var(--text-3)", verticalAlign: "-1px" }} />}
                    </td>
                    {colsBy !== "none" && pivot.cols.map(cc => <td key={cc} className="lt-amt lt-mut">{r.cells.has(cc) ? num(r.cells.get(cc)) : "·"}</td>)}
                    <td className="lt-amt" style={{ fontWeight: 700 }}>{num(r.total)}</td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={(colsBy !== "none" ? pivot.cols.length : 0) + 2} style={{ background: "var(--bg-2)", padding: "4px 10px 10px" }}>
                        <table className="ltable" style={{ fontSize: 12 }}>
                          <tbody>
                            {drill(k).slice(0, 8).map(t => (
                              <tr key={t.id}>
                                <td className="lt-mut" style={{ width: 70, whiteSpace: "nowrap" }}>{new Date(t.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</td>
                                <td style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 0 }}>{t.merchant}</td>
                                <td className="lt-mut" style={{ width: 110 }}>{FT.catOf(t.category).name}</td>
                                <td className="lt-amt" style={{ width: 110 }}>{FT.fmt(Compute.tAmt(t, state), cur, { decimals: true })}</td>
                              </tr>
                            ))}
                            {drill(k).length > 8 && <tr><td colSpan={4} className="lt-mut" style={{ fontSize: 11.5 }}>+ {drill(k).length - 8} more — see Transactions for the full list</td></tr>}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            }) : <tr><td colSpan={(colsBy !== "none" ? pivot.cols.length : 0) + 2} className="lt-mut" style={{ padding: 20, textAlign: "center" }}>No data in this period</td></tr>}
            {pivot.entries.length > 0 && (
              <tr className="lt-group">
                <td>Total</td>
                {colsBy !== "none" && pivot.cols.map(c => <td key={c} className="lt-amt">{num(pivot.colTotals.get(c) || 0)}</td>)}
                <td className="lt-amt">{num(pivot.grand)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", alignItems: "center", padding: "8px 14px", fontSize: 11.5, color: "var(--text-3)", fontWeight: 600 }}>
        <span>{show === "count" ? "Transaction counts" : "Amounts in " + cur} · transfers excluded · click a row to expand</span>
        <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={exportCSV}><Icon name="download" size={13} />Export CSV</button>
      </div>
    </div>
  );
}

function Insights({ state, actions }) {
  const cur = state.displayCurrency;
  const { top, flags } = useMemo(() => buildFlags(state), [state]);
  const [ai, setAi] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");

  async function critique() {
    setBusy(true); setErr(""); setAi("");
    const tm = Compute.thisMonth();
    const expThis = state.transactions.filter(t => t.type === "expense" && Compute.inMonth(t.date, tm));
    const lines = expThis.slice(0, 60).map(t => `${t.date} ${t.merchant} ${FT.catOf(t.category).name} ${FT.fmt(Compute.tAmt(t, state), cur)}`).join("\n");
    const totalExp = Compute.sum(state, "expense", tm), totalInc = Compute.sum(state, "income", tm);
    const prompt = `You are a sharp, honest Indian personal-finance coach reviewing this month's spending. Be candid but kind. In under 230 words and 4-6 bullet points (each starting "• "), call out: the biggest or most avoidable spends, any "unwanted"/impulse/lifestyle-creep patterns, duplicate or subscription waste, and 2 concrete ways to save money next month with rough ${cur} amounts. Don't just summarise — critique.

This month: income ${FT.fmt(totalInc, cur)}, expenses ${FT.fmt(totalExp, cur)}, savings rate ${totalInc?Math.round((1-totalExp/totalInc)*100):0}%.
Transactions:
${lines}`;
    try { setAi(await window.claude.complete(prompt) || "No response."); }
    catch (e) { setErr("Couldn't reach the AI right now. The flags below are always available."); }
    setBusy(false);
  }

  const noData = !state.transactions.some(t => t.type === "expense");

  return (
    <div className="grid" style={{ gap: 18 }}>
      <PivotExplorer state={state} />

      <div className="card card-pad fade-in">
        <div className="card-h">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="kpi-ico" style={{ background: "var(--accent-soft)", color: "var(--accent)", width: 34, height: 34 }}><Icon name="wand" /></span>
            <div><div className="card-title">AI spending critique</div><div className="card-sub">Honest review of where your money went</div></div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={critique} disabled={busy || noData}>{busy ? "Reviewing…" : <><Icon name="sparkles" size={15} />Critique my spending</>}</button>
        </div>
        {noData && <div style={{ fontSize: 13.5, color: "var(--text-2)" }}>Import or add some transactions first, then I'll review them.</div>}
        {busy && <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{[88,95,72,90,80].map((w,i)=><div key={i} className="skel" style={{ height: 13, width: w+"%" }} />)}</div>}
        {err && <div style={{ fontSize: 13.5, color: "var(--warn)", fontWeight: 600 }}>{err}</div>}
        {ai && <div style={{ fontSize: 14, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{ai}</div>}
        {!ai && !busy && !err && !noData && <div style={{ fontSize: 13.5, color: "var(--text-2)", lineHeight: 1.6 }}>Tap <b>Critique my spending</b> for a candid take on high spends, impulse buys and subscription waste — with concrete ways to cut back.</div>}
      </div>

      <LeverageProgram state={state} actions={actions} />

      <div className="grid" style={{ gridTemplateColumns: "1.5fr 1fr" }}>
        {/* flags */}
        <div className="card card-pad fade-in">
          <div className="card-h"><div className="card-title">Flags & alerts</div><span className="pill">{flags.length}</span></div>
          {flags.length ? <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {flags.map((f, i) => (
              <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <span className="kpi-ico" style={{ background: "color-mix(in srgb," + f.color + " 16%, transparent)", color: f.color, width: 34, height: 34, flexShrink: 0 }}><Icon name={f.icon} size={16} /></span>
                <div><div style={{ fontWeight: 800, fontSize: 13.5 }}>{f.title}</div><div style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.55, marginTop: 2 }}>{f.body}</div></div>
              </div>
            ))}
          </div> : <div className="empty" style={{ padding: "30px 0" }}><Icon name="check" /><div style={{ fontWeight: 700, color: "var(--text-2)" }}>Nothing to flag</div><div style={{ fontSize: 13 }}>No budget overruns, duplicates or spikes detected.</div></div>}
        </div>

        {/* biggest spends */}
        <div className="card card-pad fade-in">
          <div className="card-h"><div className="card-title">Biggest spends</div><div className="card-sub">This month</div></div>
          {top.length ? top.map(t => <TxnRow key={t.id} t={t} cur={cur} />) : <div className="empty" style={{ padding: "30px 0" }}>No spends yet this month</div>}
        </div>
      </div>
    </div>
  );
}

function Rich2({ text }) {
  return String(text).split("\n").map((ln, i) => {
    const bullet = /^\s*[•\-\*]\s+/.test(ln);
    const body = ln.replace(/^\s*[•\-\*]\s+/, "");
    const parts = body.split(/(\*\*[^*]+\*\*)/g).map((seg, j) => /^\*\*[^*]+\*\*$/.test(seg) ? <strong key={j}>{seg.slice(2,-2)}</strong> : seg);
    return <div key={i} style={bullet ? { display: "flex", gap: 7 } : (ln.trim() === "" ? { height: 6 } : null)}>{bullet && <span style={{ color: "var(--accent)", flexShrink: 0 }}>•</span>}<span>{parts}</span></div>;
  });
}

/* rule-based wealth hacks from the user's actual balance sheet */
function buildHacks(state) {
  const cur = state.displayCurrency;
  const hacks = [];
  const fds = state.accounts.filter(a => a.type === "fd");
  const fdTotal = fds.reduce((s, a) => s + Compute.aBal(a, state), 0);
  const idleBank = state.accounts.filter(a => a.type === "bank").reduce((s, a) => s + Compute.aBal(a, state), 0);
  const invest = state.accounts.filter(a => ["invest"].includes(a.type)).reduce((s, a) => s + Compute.aBal(a, state), 0);
  const loans = state.loans || [];
  const highLoan = loans.find(l => (l.rate || 0) >= 10);
  const avgFdRate = fds.length ? fds.reduce((s, a) => s + (a.rate || 0), 0) / fds.length : 0;

  if (fdTotal > 100000) hacks.push({ icon: "shield", color: "var(--c2)", title: "FD-backed Overdraft instead of breaking the FD",
    body: `You hold ${FT.fmtShort(fdTotal, cur)} in FDs. Banks lend an OD/loan against FD up to ~90% (≈${FT.fmtShort(fdTotal*0.9, cur)}) at roughly 1–2% above your FD rate — your FD keeps earning ${avgFdRate?avgFdRate.toFixed(1)+"%":"interest"} while you deploy the cash (e.g., a plot or a dip-buy).`,
    risk: "You pay OD interest (~"+((avgFdRate||7)+1.5).toFixed(1)+"%). It only builds wealth if the new asset returns MORE than that spread. The FD is liened until repaid." });
  if (invest > 100000) hacks.push({ icon: "trending", color: "var(--c1)", title: "Loan Against Securities (LAS) for liquidity",
    body: `Your ${FT.fmtShort(invest, cur)} in stocks/MFs can back a loan (~50% of value) at ~9–10%, so you don't sell and trigger capital-gains tax or exit a compounding position.`,
    risk: "Markets can fall → margin call / forced sell. Borrow conservatively (well under the limit) and only against stable holdings." });
  if (idleBank > 200000) hacks.push({ icon: "wallet", color: "var(--c7)", title: "Sweep-in FD on idle savings",
    body: `~${FT.fmtShort(idleBank, cur)} is sitting in savings (~3%). A sweep-in/flexi FD auto-parks the excess at ~7% while staying instantly withdrawable — roughly ${FT.fmtShort(idleBank*0.04, cur)}/yr of "free" extra interest.`,
    risk: "Minimal. Keep ~1 month of expenses in plain savings for instant UPI/auto-debits." });
  if (highLoan && avgFdRate && highLoan.rate > avgFdRate + 1) hacks.push({ icon: "arrowDownRight", color: "var(--c8)", title: "Interest arbitrage: prepay vs. hold",
    body: `Your ${highLoan.name || "loan"} costs ${highLoan.rate}% but your FDs earn only ${avgFdRate.toFixed(1)}%. Part-prepaying the loan is a guaranteed, tax-free "return" of ${highLoan.rate}% — better than the FD after tax.`,
    risk: "Keep your emergency fund intact first; don't prepay with money you'll need within 6–12 months." });
  hacks.push({ icon: "sparkles", color: "var(--c5)", title: "Sovereign Gold Bonds beat physical gold",
    body: `SGBs pay 2.5% interest p.a. on top of gold price appreciation, with no making charges or storage risk, and capital-gains-tax-free if held to maturity — strictly better than jewellery or coins for investment.`,
    risk: "8-year tenure (exit window from year 5). Less liquid than gold ETFs." });
  return hacks;
}

function LeverageProgram({ state, actions }) {
  const cur = state.displayCurrency;
  const lev = state.leverage;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function gen() {
    setBusy(true); setErr("");
    const prompt = `${window.PLAYBOOK}

You are designing this user's "wealth without new money" program: a SEQUENCED set of 4-7 steps that build wealth using only what they already have — restructuring, leverage, float, rewards, rates, tax — no new income required. Order matters: each step should fund or unlock the next where possible. Their stated aim: become debt-free, then use debt purely as leverage. Be honest about risk in the detail line. Respond ONLY JSON:
{"steps":[{"title":"<imperative move with amounts from their data>","detail":"<2 sentences: mechanism + the catch/risk>","impact":"<short estimate e.g. '+₹14,200/yr' or 'saves ₹1.08L'>"}]}

SNAPSHOT:
${window.buildSnapshot(state)}`;
    try {
      const raw = await window.claude.complete(prompt);
      const o = FT.parseAIJson(raw);
      if (!o.steps || !o.steps.length) throw new Error("The AI returned no steps");
      actions.saveLeverage({
        generatedAt: FT.todayISO(),
        steps: o.steps.slice(0, 7).map((st, i) => ({ id: FT.uid(), order: i + 1, title: String(st.title || "").slice(0, 140), detail: String(st.detail || "").slice(0, 280), impact: String(st.impact || "").slice(0, 40), done: false, doneAt: null })),
      });
    } catch (e) { console.error("leverage build failed:", e); setErr("Couldn't build the program: " + (e.message || e) + " — try again, or check Settings → AI service."); }
    setBusy(false);
  }

  return (
    <div className="lt-wrap fade-in" style={{ background: "var(--surface)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: "1px solid var(--border-soft)" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14.5 }}>Wealth without new money</div>
          <div style={{ fontSize: 11.5, color: "var(--text-3)", fontWeight: 600 }}>Leverage what you already have — sequenced, each step funds the next{lev ? " · built " + FT.relDate(lev.generatedAt) : ""}</div>
        </div>
        <button className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={gen} disabled={busy}>{busy ? "Building…" : <><Icon name="repeat" size={14} />{lev ? "Rebuild from my data" : "Build from my data"}</>}</button>
      </div>
      {busy && <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>{[85, 70, 90].map((w, i) => <div key={i} className="skel" style={{ height: 13, width: w + "%" }} />)}</div>}
      {err && <div style={{ padding: "12px 16px", fontSize: 13, color: "var(--warn)", fontWeight: 600 }}>{err}</div>}
      {!lev && !busy && (
        <div className="empty" style={{ padding: "30px 20px" }}>
          <Icon name="sparkles" />
          <div style={{ fontWeight: 700, color: "var(--text-2)" }}>No program yet</div>
          <div style={{ fontSize: 13, maxWidth: 420 }}>One tap finds money already inside your system — float, rates, rewards, restructuring — and sequences it into steps.</div>
        </div>
      )}
      {lev && !busy && lev.steps.map(st => (
        <div key={st.id} style={{ display: "flex", gap: 12, padding: "11px 16px", borderBottom: "1px solid var(--border-soft)", opacity: st.done ? .55 : 1, cursor: "pointer" }} onClick={() => actions.toggleLeverageStep(st.id)}>
          <span style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, background: st.done ? "var(--pos-soft)" : "var(--surface-2)", color: st.done ? "var(--pos)" : "var(--text-2)", display: "grid", placeItems: "center", fontSize: 11.5, fontWeight: 700 }}>{st.done ? <Icon name="check" size={12} /> : st.order}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 650, fontSize: 13.5, textDecoration: st.done ? "line-through" : "none" }}>{st.title}</div>
            <div style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.5, marginTop: 2 }}>{st.done && st.doneAt ? "Done " + FT.relDate(st.doneAt) + " · " : ""}{st.detail}</div>
          </div>
          <span className="num" style={{ fontSize: 12, fontWeight: 700, color: "var(--pos)", whiteSpace: "nowrap", flexShrink: 0 }}>{st.impact}</span>
        </div>
      ))}
      {lev && !busy && <div style={{ padding: "9px 16px", fontSize: 11.5, color: "var(--text-3)", fontWeight: 600 }}>Educational analysis, not financial advice · rebuilding keeps your ticked steps where titles match</div>}
    </div>
  );
}

Object.assign(window, { Insights, LeverageProgram, buildHacks, PivotExplorer });