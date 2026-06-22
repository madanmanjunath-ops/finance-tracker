/* ============================================================
   views_critic.jsx — "Where you stand" financial critic.
   Every number is computed by the app from benchmarks baked into
   store.js (BENCHMARKS / wealthTarget). The AI only phrases the
   verdict in an encouraging-but-truthful tone; it never invents
   the percentiles or thresholds.
   ============================================================ */

function FinancialCritic({ state, actions }) {
  const cur = state.displayCurrency;
  const view = state.criticView || "itr";
  const [note, setNote] = useState(null);
  const [busy, setBusy] = useState(false);

  const m = useMemo(() => {
    const p = state.profile || {};
    let a = null;
    try { a = window.buildAdvice ? window.buildAdvice(state) : null; } catch (e) { a = null; }
    // robust monthly expense: use 3-mo avg, but fall back to all-time avg if thin
    let monthlyExp = a ? a.avgExp : 0;
    if (!monthlyExp || monthlyExp < 1) {
      const exps = (state.transactions || []).filter(t => t.type === "expense");
      if (exps.length) {
        const months = new Set(exps.map(t => t.date.slice(0, 7)));
        const totalExp = exps.reduce((s, t) => s + Compute.tAmt(t, state), 0);
        monthlyExp = totalExp / Math.max(1, months.size);
      }
    }
    let dm = null;
    try { dm = window.debtMetrics ? window.debtMetrics(state) : null; } catch (e) { dm = null; }
    const annualIncome = a ? a.avgInc * 12 : 0;
    const pct = FT.incomePercentile(annualIncome, view);
    const nw = Compute.netWorth(state);
    const liquid = Compute.liquidBreakdown(state);
    const monthsRunway = monthlyExp > 0 ? liquid.total / monthlyExp : 0;
    const wealthMult = p.age ? FT.wealthTarget(p.age) : null;
    const targetNW = wealthMult && annualIncome ? wealthMult * annualIncome : null;
    const dti = annualIncome > 0 && dm ? (dm.totalDebt / annualIncome) : null;
    const savRate = a ? a.savRate : 0;
    return { annualIncome, pct, nw, liquid, monthsRunway, wealthMult, targetNW, dti, savRate, avgExp: monthlyExp, dm };
  }, [state, view]);

  async function generate() {
    setBusy(true);
    const p = state.profile || {};
    const facts = `Income ${FT.fmt(m.annualIncome, cur)}/yr (top ${m.pct.topPct || ">50"}% of ${m.pct.label}). Savings rate ${m.savRate.toFixed(0)}%. Liquid ${FT.fmt(m.liquid.total, cur)} = ${m.monthsRunway.toFixed(1)} months runway. Net worth ${FT.fmt(m.nw.net, cur)}${m.targetNW ? ` vs age-${p.age} target ${FT.fmt(m.targetNW, cur)} (${m.wealthMult}× income)` : ""}. ${m.dm ? `Debt ${FT.fmt(m.dm.totalDebt, cur)}, interest ${FT.fmt(m.dm.monthlyInterest, cur)}/mo.` : ""} Debt-to-income ${m.dti != null ? m.dti.toFixed(1) + "×" : "n/a"}.`;
    const prompt = `You are a financial critic. Tone: ENCOURAGING BUT TRUTHFUL — lead with genuine strengths, then name real gaps honestly without being harsh. 3-4 sentences, second person, specific to these numbers. Don't restate every number; interpret. End with the single most useful next move.\n\nThe user is age ${p.age || "?"}, ${p.maritalStatus || "?"}, ${p.dependents || 0} dependents, in India.\n\nFACTS (all pre-computed, accurate — do not contradict):\n${facts}`;
    try {
      const raw = await window.claude.complete(prompt);
      setNote(String(raw || "").trim());
    } catch (e) { setNote("Couldn't generate the read right now — your numbers below are still accurate."); }
    setBusy(false);
  }

  const zone = m.monthsRunway >= 6 ? { label: "Safe zone", color: "var(--pos)" } : m.monthsRunway >= 3 ? { label: "Cushioned", color: "var(--warn)" } : { label: "Thin runway", color: "var(--neg)" };

  return (
    <div className="lt-wrap" style={{ background: "var(--surface)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--border-soft)", flexWrap: "wrap" }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>Where you stand</span>
        <span className="tag" style={{ background: "color-mix(in srgb," + zone.color + " 15%, transparent)", color: zone.color, fontWeight: 700 }}>{zone.label}</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 11.5, color: "var(--text-3)", fontWeight: 600 }}>Compare vs</span>
          <select className="select" style={{ width: "auto", padding: "5px 26px 5px 9px", fontSize: 12 }} value={view} onChange={e => actions.setCriticView(e.target.value)}>
            <option value="itr">Indian tax filers</option>
            <option value="allindia">All Indians</option>
            <option value="global">Global</option>
          </select>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 1, background: "var(--border-soft)" }}>
        <Stat label="Income percentile" big={m.pct.topPct ? "Top " + m.pct.topPct + "%" : "—"} sub={m.pct.label} />
        <Stat label="Emergency runway" big={m.monthsRunway.toFixed(1) + " mo"} sub={"of " + FT.fmtShort(m.avgExp, cur) + "/mo expenses"} color={zone.color} />
        <Stat label="Savings rate" big={m.savRate.toFixed(0) + "%"} sub={m.savRate >= 30 ? "excellent" : m.savRate >= 15 ? "solid" : "room to grow"} />
        <Stat label="Net worth vs age" big={m.targetNW ? (m.nw.net / m.targetNW * 100).toFixed(0) + "%" : "—"} sub={m.targetNW ? "of " + m.wealthMult + "× target" : "add age in profile"} />
      </div>

      <div style={{ padding: "14px 16px", borderTop: "1px solid var(--border-soft)" }}>
        {note ? (
          <div style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--text)" }}>{note}</div>
        ) : (
          <div style={{ fontSize: 13, color: "var(--text-3)", fontWeight: 600 }}>Get an honest read on your position — strengths and gaps, grounded in your real numbers and 2025-26 benchmark data.</div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
          <button className="btn btn-sm btn-primary" onClick={generate} disabled={busy}>{busy ? "Reading…" : <><Icon name="sparkles" size={14} />{note ? "Refresh read" : "Get my read"}</>}</button>
          <span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600 }}>{m.pct.note} · educational, not advice</span>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, big, sub, color }) {
  return (
    <div style={{ background: "var(--surface)", padding: "12px 14px" }}>
      <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em" }}>{label}</div>
      <div className="num" style={{ fontSize: 20, fontWeight: 700, marginTop: 3, color: color || "var(--text)" }}>{big}</div>
      <div style={{ fontSize: 11.5, color: "var(--text-3)", fontWeight: 600, marginTop: 1 }}>{sub}</div>
    </div>
  );
}

Object.assign(window, { FinancialCritic });
