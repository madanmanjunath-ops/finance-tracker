/* ============================================================
   views_investments.jsx — quarterly plan engine + advisor
   ============================================================ */

/* The "playbook": curated Indian personal-finance knowledge injected into
   every plan/leverage generation. Edit freely — this is what trains the AI. */
const PLAYBOOK = `PLAYBOOK (Indian personal finance, debt-as-leverage school):
1. ORDER OF OPERATIONS: card balances carrying interest (36-42% APR) → emergency fund to 6 months expenses in sweep-in FD/liquid fund → debt above ~10% interest → tax-sheltered investing (EPF/PPF/NPS/ELSS) → index equity → satellites.
2. DEBT PAYOFF: compare avalanche (highest rate first — mathematically optimal) vs snowball (smallest balance first — behavioral momentum). Recommend avalanche when rate spread > 3% or balances are large; snowball when several small debts can be killed within 2 quarters. State which you chose and why. Never prepay sub-9% secured debt (home loan) while >12% debt exists.
3. GOOD vs BAD DEBT: debt is leverage when its after-tax cost is below the reliable return of what it funds (home loan with 24(b)/80C benefits, education). Car loans, personal loans, and revolving card debt are wealth-negative — kill or refinance. FD-backed overdraft (FD rate +1-2%) beats personal loans (14-18%) for liquidity needs without breaking compounding.
4. EMERGENCY FUND: 6 months of expenses (9 if single income + dependents) in sweep-in FD or liquid fund. Do not lock it in equity or long FDs.
5. INVESTING: core = low-cost broad index (Nifty 50 / Nifty Next 50, direct plans); equity % ≈ 110 − age, tuned by risk posture (±12). SIP over lumpsum for salary earners. Don't suggest specific small/mid-cap names; categories only. Long-run reference returns: broad equity ~11-12% CAGR (15yr+), PPF ~7.1% tax-free, FD ~7% taxable, liquid ~6-7%. Real estate concentration >60% of net worth is a flag.
6. TAX: 80C (1.5L: EPF/PPF/ELSS/principal), 80CCD(1B) (50k NPS), 24(b) (2L home-loan interest). Compare old vs new regime by actual deduction usage; recommend a regime check, never assert without data.
7. CARDS: utilization <30% per card protects score; pay statement balance in full always; harvest category rewards (route spend to the best card per category); statement-cycle float is free working capital — time big purchases just after statement date.
8. PROTECTION: term cover 10-15x annual income if dependents; health floater 10L+ separate from employer cover.
9. QUARTERLY CADENCE: 6-10 items max, each concrete (amount, account, deadline), highest-impact first. For carried-over items state why they still matter. If data is missing (loan rates, EMIs), the FIRST item must be to record it.
10. TONE: educational analysis, decisive numbers, no guarantees, recommend professional advice for tax filing and large moves.`;

/* Deterministic debt math — no AI involved. */
function debtMetrics(state) {
  const cur = state.displayCurrency;
  const conv = (v, c) => Compute.conv(v || 0, c || "INR", state);
  const loans = (state.loans || []).map(l => ({ ...l, out: conv(l.outstanding, l.currency), emiC: conv(l.emi, l.currency) }));
  const cardDebt = (state.cards || []).reduce((s, c) => s + conv(c.balance, c.currency), 0);
  const totalDebt = loans.reduce((s, l) => s + l.out, 0) + cardDebt;
  let monthlyInterest = 0, missing = 0, maxMonths = 0, projectable = loans.length > 0;
  loans.forEach(l => {
    if (l.rate && l.out) monthlyInterest += l.out * (l.rate / 100) / 12; else if (l.out) missing++;
    if (l.out > 0) {
      if (l.rate && l.emiC > 0) {
        const i = l.rate / 100 / 12;
        const denom = l.emiC - l.out * i;
        if (denom <= 0) { maxMonths = Infinity; } // EMI doesn't cover interest
        else maxMonths = Math.max(maxMonths, Math.log(l.emiC / denom) / Math.log(1 + i));
      } else projectable = false;
    }
  });
  let freeBy = null;
  if (projectable && isFinite(maxMonths) && maxMonths > 0) {
    const d = new Date(); d.setMonth(d.getMonth() + Math.ceil(maxMonths));
    freeBy = d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }
  return { totalDebt, monthlyInterest, freeBy, missing, loanCount: loans.length, cardDebt, cur };
}

/* Full financial snapshot as text — the AI's view of the user. */
function buildSnapshot(state) {
  const cur = state.displayCurrency;
  const p = state.profile || {};
  const a = buildAdvice(state);
  const dm = debtMetrics(state);
  const accts = (state.accounts || []).map(x => `${x.name} (${FT.acctType(x.type).name}${x.rate ? " @ " + x.rate + "%" : ""}) ${FT.fmt(Compute.aBal(x, state), cur)}`).join("; ") || "none";
  const loans = (state.loans || []).map(l => `${l.name || l.type}: ${FT.fmt(Compute.conv(l.outstanding || 0, l.currency || "INR", state), cur)} @ ${l.rate || "?"}% , EMI ${FT.fmt(Compute.conv(l.emi || 0, l.currency || "INR", state), cur)}`).join("; ") || "none";
  const cards = (state.cards || []).map(c => `${c.name}: limit ${FT.fmtShort(c.limit || 0, cur)}, outstanding ${FT.fmtShort(c.balance || 0, cur)}, statement day ${c.billingDay || "?"}`).join("; ") || "none";
  const posture = state.riskPosture === "auto" ? (p.risk || "Moderate") + " (auto from profile)" : state.riskPosture;
  return `Profile: age ${p.age || "?"}, ${p.maritalStatus || "?"}, ${p.dependents || 0} dependents. Risk posture: ${posture}.
Cash flow (6-mo avg): income ${FT.fmt(a.avgInc, cur)}/mo, expenses ${FT.fmt(a.avgExp, cur)}/mo, surplus ${FT.fmt(a.surplus, cur)}/mo, savings rate ${a.savRate.toFixed(0)}%.
Net worth: ${FT.fmt(a.nw.net, cur)} (assets ${FT.fmt(a.nw.assets, cur)}, liabilities ${FT.fmt(a.nw.liabilities, cur)}).
Liquid: ${FT.fmt(a.liquid, cur)} vs 6-month target ${FT.fmt(a.emFundTarget, cur)} (${a.emFundPct.toFixed(0)}%).
Total debt: ${FT.fmt(dm.totalDebt, cur)}, interest bleed ≈ ${FT.fmt(dm.monthlyInterest, cur)}/mo${dm.missing ? ` (${dm.missing} loan(s) missing rate)` : ""}.
Accounts: ${accts}.
Loans: ${loans}.
Cards: ${cards}.
Current investing: ${FT.fmtShort(a.invMonthly, cur)}/mo. User notes: ${p.currentInvestments || "—"}. Goals: ${p.goalsText || "—"}. Stated aim: become debt-free, then use debt only as leverage.`;
}
window.PLAYBOOK = PLAYBOOK; window.buildSnapshot = buildSnapshot; window.debtMetrics = debtMetrics;

/* ---------------- quarterly plan engine ---------------- */
function PlanEngine({ state, actions }) {
  const cur = state.displayCurrency;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showHist, setShowHist] = useState(false);
  const plans = state.plans || [];
  const active = plans.find(p => p.status === "active");
  const q = FT.currentQuarter();
  const stale = active && active.quarter !== q;

  async function generate() {
    setBusy(true); setErr("");
    const prevCtx = active
      ? `\nPREVIOUS PLAN (${active.quarter}) — decide each unfinished item's fate (carry / revise / drop) and mark carried items:\n` +
        active.items.map(it => `- [${it.done ? "DONE" : "NOT DONE"}] ${it.title}`).join("\n")
      : "";
    const prompt = `${PLAYBOOK}

You are generating this user's ${q} financial action plan. Use their REAL numbers. 6-10 items, highest impact first, each concrete enough to execute (amounts, account names, deadlines). Respond ONLY JSON:
{"summary":"<2 sentences: the quarter's focus>","items":[{"title":"<imperative action with amount>","detail":"<1-2 sentences: why, from their data>","impact":"<short estimate e.g. 'saves ₹62,400' or 'long-term'>","tag":"debt"|"invest"|"protect"|"tax"|"optimize","carried":true|false}]}

SNAPSHOT:
${buildSnapshot(state)}${prevCtx}`;
    try {
      const raw = await window.claude.complete(prompt);
      const o = FT.parseAIJson(raw);
      if (!o.items || !o.items.length) throw new Error("The AI returned no plan items");
      actions.savePlan({
        id: FT.uid(), quarter: q, createdAt: FT.todayISO(), summary: o.summary || "",
        items: o.items.slice(0, 10).map(it => ({ id: FT.uid(), title: String(it.title || "").slice(0, 140), detail: String(it.detail || "").slice(0, 260), impact: String(it.impact || "").slice(0, 40), tag: ["debt","invest","protect","tax","optimize"].includes(it.tag) ? it.tag : "optimize", carried: !!it.carried, done: false, doneAt: null })),
      });
    } catch (e) { console.error("plan generation failed:", e); setErr("Couldn't generate the plan: " + (e.message || e) + " — try again, or check Settings → AI service."); }
    setBusy(false);
  }

  const TAGC = { debt: "var(--c8)", invest: "var(--c1)", protect: "var(--c2)", tax: "var(--c5)", optimize: "var(--c4)" };
  const doneCount = active ? active.items.filter(i => i.done).length : 0;

  return (
    <div className="lt-wrap fade-in" style={{ background: "var(--surface)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: "1px solid var(--border-soft)", flexWrap: "wrap" }}>
        <span style={{ fontWeight: 700, fontSize: 14.5 }}>{active ? active.quarter + " plan" : "Quarterly plan"}</span>
        {active && <span style={{ fontSize: 11.5, color: "var(--text-3)", fontWeight: 600 }}>generated {FT.relDate(active.createdAt)} · {doneCount} of {active.items.length} done</span>}
        {stale && <span className="tag" style={{ background: "var(--warn)", color: "#1a1408", fontWeight: 700 }}>New quarter — generate {q}</span>}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {plans.filter(p => p.status === "archived").length > 0 && <button className="btn btn-sm" onClick={() => setShowHist(true)}>History</button>}
          <button className="btn btn-primary btn-sm" onClick={generate} disabled={busy}>{busy ? "Planning…" : <><Icon name="sparkles" size={14} />{active ? "Generate " + q + " plan" : "Generate my plan"}</>}</button>
        </div>
      </div>
      {busy && <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>{[90, 75, 85, 60].map((w, i) => <div key={i} className="skel" style={{ height: 13, width: w + "%" }} />)}</div>}
      {err && <div style={{ padding: "12px 16px", fontSize: 13, color: "var(--warn)", fontWeight: 600 }}>{err}</div>}
      {!active && !busy && (
        <div className="empty" style={{ padding: "36px 20px" }}>
          <Icon name="target" />
          <div style={{ fontWeight: 700, color: "var(--text-2)" }}>No plan yet</div>
          <div style={{ fontSize: 13, maxWidth: 420 }}>One tap reads your accounts, loans, cards and cash flow, then builds a checklist for the quarter — debt first, then growth.</div>
        </div>
      )}
      {active && !busy && (
        <div>
          {active.summary && <div style={{ padding: "11px 16px", fontSize: 13, color: "var(--text-2)", lineHeight: 1.55, borderBottom: "1px solid var(--border-soft)", background: "var(--bg-2)" }}>{active.summary}</div>}
          {active.items.map(it => (
            <div key={it.id} style={{ display: "flex", gap: 12, padding: "10px 16px", borderBottom: "1px solid var(--border-soft)", opacity: it.done ? .55 : 1, cursor: "pointer" }} onClick={() => actions.togglePlanItem(active.id, it.id)}>
              <span style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0, marginTop: 1, border: "2px solid " + (it.done ? "var(--pos)" : "var(--border)"), background: it.done ? "var(--pos)" : "transparent", display: "grid", placeItems: "center" }}>{it.done && <Icon name="check" size={11} style={{ color: "#fff" }} />}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 650, fontSize: 13.5, textDecoration: it.done ? "line-through" : "none" }}>{it.title}</div>
                <div style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.5, marginTop: 2 }}>{it.done && it.doneAt ? "Done " + FT.relDate(it.doneAt) + " · " : ""}{it.detail}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                <span className="num" style={{ fontSize: 12, fontWeight: 700, color: "var(--pos)", whiteSpace: "nowrap" }}>{it.impact}</span>
                <span style={{ display: "flex", gap: 4 }}>
                  <span className="tag" style={{ background: "color-mix(in srgb," + TAGC[it.tag] + " 14%, transparent)", color: TAGC[it.tag], fontSize: 10.5 }}>{it.tag}</span>
                  {it.carried && <span className="tag" style={{ background: "var(--surface-3)", color: "var(--text-2)", fontSize: 10.5 }}>carried</span>}
                </span>
              </div>
            </div>
          ))}
          <div style={{ padding: "9px 16px", fontSize: 11.5, color: "var(--text-3)", fontWeight: 600 }}>Educational analysis, not financial advice · ticked items are kept forever, including in archived quarters</div>
        </div>
      )}
      {showHist && (
        <Modal title="Plan history" onClose={() => setShowHist(false)} foot={<button className="btn btn-ghost" onClick={() => setShowHist(false)}>Close</button>}>
          <div className="modal-body" style={{ gap: 14 }}>
            {plans.filter(p => p.status === "archived").map(p => (
              <div key={p.id}>
                <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 6 }}>{p.quarter} <span style={{ color: "var(--text-3)", fontWeight: 600, fontSize: 12 }}>· {p.items.filter(i => i.done).length}/{p.items.length} completed</span></div>
                {p.items.map(it => (
                  <div key={it.id} style={{ display: "flex", gap: 8, fontSize: 12.5, padding: "3px 0", color: it.done ? "var(--text-3)" : "var(--text-2)" }}>
                    <Icon name={it.done ? "check" : "x"} size={13} style={{ color: it.done ? "var(--pos)" : "var(--text-3)", flexShrink: 0, marginTop: 2 }} />
                    <span style={{ textDecoration: it.done ? "line-through" : "none" }}>{it.title}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

function buildAdvice(state) {
  const p = state.profile || {};
  const cur = state.displayCurrency;
  const age = p.age || 30;
  const risk = p.risk || "Moderate";
  const series = Compute.monthlySeries(state, 6);
  const avgInc = Math.round(series.reduce((s, m) => s + m.income, 0) / series.length) || p.monthlyIncome || 0;
  const avgExp = Math.round(series.reduce((s, m) => s + m.expense, 0) / series.length);
  const surplus = avgInc - avgExp;
  const savRate = avgInc ? (surplus / avgInc) * 100 : 0;
  const nw = Compute.netWorth(state);

  // liquid = bank + cash
  const liquid = state.accounts.filter(a => ["bank", "cash"].includes(a.type)).reduce((s, a) => s + Compute.aBal(a, state), 0);
  const emFundTarget = avgExp * 6;
  const emFundPct = emFundTarget ? Math.min(100, (liquid / emFundTarget) * 100) : 0;

  // allocation: rule of thumb equity = 110 - age, tuned by risk
  const riskAdj = { Conservative: -12, Moderate: 0, Aggressive: 12 }[risk] ?? 0;
  let equity = Math.max(25, Math.min(85, (110 - age) + riskAdj));
  let gold = risk === "Aggressive" ? 5 : 10;
  let debt = 100 - equity - gold;
  const alloc = [
    { label: "Equity (Stocks + MF)", value: equity, color: "var(--c1)" },
    { label: "Debt (FD, Bonds, PPF)", value: debt, color: "var(--c2)" },
    { label: "Gold / Alternatives", value: gold, color: "var(--c4)" },
  ];

  const invMonthly = state.transactions.filter(t => t.category === "invest" && t.type === "expense" && Compute.inMonth(t.date, Compute.thisMonth())).reduce((s, t) => s + Compute.tAmt(t, state), 0);

  // suggestions
  const sug = [];
  if (emFundPct < 100) {
    sug.push({ p: 1, icon: "shield", color: "var(--c2)", title: "Top up your emergency fund first",
      body: `Aim for 6 months of expenses (${FT.fmtShort(emFundTarget, cur)}). You're at ${emFundPct.toFixed(0)}% — park the gap in a liquid fund or sweep-in FD before locking money into equity.`,
      stat: FT.fmt(Math.max(0, emFundTarget - liquid), cur) + " to go" });
  } else {
    sug.push({ p: 3, icon: "check", color: "var(--c1)", title: "Emergency fund is fully funded",
      body: `You have over 6 months of expenses in liquid accounts. You can comfortably direct surplus toward long-term growth.`, stat: "✓ 6+ months covered" });
  }
  if (p.dependents > 0) {
    sug.push({ p: 1, icon: "shield", color: "var(--c8)", title: "Lock in term + health insurance",
      body: `With ${p.dependents} dependent${p.dependents>1?"s":""}, a term cover of ~10–15× annual income and a ₹10L+ family floater protect your plan from derailment. Pure term is cheap at ${p.age}.`,
      stat: "Cover ≈ " + FT.fmtShort(avgInc * 12 * 12, cur) });
  }
  if (surplus > 0) {
    const suggestSip = Math.round(surplus * 0.6 / 1000) * 1000;
    sug.push({ p: 2, icon: "trending", color: "var(--c1)", title: "Automate a bigger SIP",
      body: `Your average monthly surplus is ${FT.fmt(surplus, cur)} and you're investing ${FT.fmtShort(invMonthly, cur)}/mo. Channel ~60% of surplus into low-cost index + flexi-cap funds via SIP to ride rupee-cost averaging.`,
      stat: "Target SIP ≈ " + FT.fmt(suggestSip, cur) + "/mo" });
  } else {
    sug.push({ p: 1, icon: "arrowDownRight", color: "var(--c8)", title: "Spending exceeds income",
      body: `Your 6-month average shows expenses above income. Trim your top discretionary categories before adding new investments.`, stat: FT.fmt(Math.abs(surplus), cur) + "/mo gap" });
  }
  sug.push({ p: 2, icon: "briefcase", color: "var(--c5)", title: "Use your 80C / tax-saving headroom",
    body: `ELSS funds (3-yr lock-in) and your EPF/PPF can shelter up to ₹1.5L under 80C while compounding. Aggressive savers should prioritise ELSS for the equity tilt.`, stat: "Up to ₹1.5L deductible" });
  if (equity >= 60) {
    sug.push({ p: 3, icon: "sparkles", color: "var(--c10)", title: "You can afford an equity tilt",
      body: `At ${p.age} with a ${risk.toLowerCase()} profile, a ${equity}% equity allocation suits your long horizon. Favour broad index funds (Nifty 50 / Nifty Next 50) as the core and satellite into flexi-cap.`, stat: equity + "% equity recommended" });
  }
  if (p.maritalStatus === "Married") {
    sug.push({ p: 3, icon: "target", color: "var(--c3)", title: "Plan joint goals together",
      body: `As a married household, map shared goals (home, child, retirement) to separate buckets so risk and timelines don't collide. Keep retirement in equity, near-term goals in debt.`, stat: "Bucket by timeline" });
  }
  sug.sort((a, b) => a.p - b.p);

  return { avgInc, avgExp, surplus, savRate, liquid, emFundTarget, emFundPct, alloc, equity, debt, gold, invMonthly, sug, nw };
}

function Investments({ state, actions, openProfile }) {
  const cur = state.displayCurrency;
  const p = state.profile;
  const a = useMemo(() => buildAdvice(state), [state]);
  const dm = useMemo(() => debtMetrics(state), [state]);
  return (
    <div className="grid" style={{ gap: 18 }}>
      {/* debt freedom tracker + risk posture */}
      <div className="grid kpi-row" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 700 }}>Total debt</span>
          <span className="num" style={{ fontSize: 22, fontWeight: 700 }}>{FT.fmt(dm.totalDebt, cur)}</span>
          <span style={{ fontSize: 11.5, color: "var(--text-3)", fontWeight: 600 }}>{dm.loanCount} loan{dm.loanCount !== 1 ? "s" : ""}{dm.cardDebt > 0 ? " · " + FT.fmtShort(dm.cardDebt, cur) + " on cards" : ""}</span>
        </div>
        <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 700 }}>Interest bleed</span>
          <span className="num" style={{ fontSize: 22, fontWeight: 700, color: dm.monthlyInterest > 0 ? "var(--neg)" : "var(--text)" }}>{FT.fmt(dm.monthlyInterest, cur)}/mo</span>
          <span style={{ fontSize: 11.5, color: "var(--text-3)", fontWeight: 600 }}>{dm.missing ? dm.missing + " loan(s) missing a rate — add in Net worth" : "what your debt costs you"}</span>
        </div>
        <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 700 }}>Debt-free by</span>
          <span className="num" style={{ fontSize: 22, fontWeight: 700 }}>{dm.totalDebt <= 0 ? "Debt-free ✓" : dm.freeBy || "—"}</span>
          <span style={{ fontSize: 11.5, color: "var(--text-3)", fontWeight: 600 }}>{dm.totalDebt <= 0 ? "use leverage wisely" : dm.freeBy ? "at current EMIs" : "add loan rates & EMIs to project"}</span>
        </div>
        <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 700 }}>Risk posture</span>
          <select className="select" style={{ marginTop: 2 }} value={state.riskPosture || "auto"} onChange={e => actions.setRiskPosture(e.target.value)}>
            <option value="auto">Auto (from profile)</option>
            <option value="Conservative">Conservative</option>
            <option value="Balanced">Balanced</option>
            <option value="Aggressive">Aggressive</option>
          </select>
          <span style={{ fontSize: 11.5, color: "var(--text-3)", fontWeight: 600 }}>{state.riskPosture === "auto" || !state.riskPosture ? "currently reads: " + (p.risk || "Moderate") : "applies to the next plan"}</span>
        </div>
      </div>

      <PlanEngine state={state} actions={actions} />

      {/* profile snapshot */}
      <div className="card card-pad fade-in" style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
        <div style={{ width: 52, height: 52, borderRadius: 14, background: "var(--accent-soft)", color: "var(--accent)", display: "grid", placeItems: "center", fontSize: 20, fontWeight: 800 }}>{p.name.split(" ").map(s=>s[0]).slice(0,2).join("")}</div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>{p.name}</div>
          <div style={{ fontSize: 13, color: "var(--text-3)", fontWeight: 600 }}>{p.age} yrs · {p.maritalStatus} · {p.dependents} dependent{p.dependents !== 1 ? "s" : ""} · {p.risk} risk</div>
        </div>
        <div style={{ display: "flex", gap: 22 }}>
          <Stat label="Avg income" v={FT.fmtShort(a.avgInc, cur)} c="var(--pos)" />
          <Stat label="Avg expense" v={FT.fmtShort(a.avgExp, cur)} c="var(--neg)" />
          <Stat label="Surplus / mo" v={FT.fmtShort(a.surplus, cur)} c="var(--accent)" />
          <Stat label="Savings rate" v={a.savRate.toFixed(0) + "%"} c="var(--text)" />
        </div>
        <button className="btn btn-sm" onClick={openProfile}><Icon name="edit" size={14} />Edit profile</button>
      </div>

      {/* allocation + suggestions */}
      <div className="grid" style={{ gridTemplateColumns: "1fr 1.7fr" }}>
        <div className="card card-pad fade-in" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div><div className="card-title">Suggested allocation</div><div className="card-sub">For a {(p.risk || "Moderate").toLowerCase()} investor, age {p.age}</div></div>
          <div style={{ display: "grid", placeItems: "center" }}>
            <Donut data={a.alloc} size={170} thickness={24} center={<div><div style={{ fontSize: 10.5, color: "var(--text-3)", fontWeight: 700 }}>Equity</div><div className="display" style={{ fontSize: 22, fontWeight: 600 }}>{a.equity}%</div></div>} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {a.alloc.map(x => (
              <div key={x.label} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13 }}>
                <span className="cat-dot" style={{ background: x.color }}></span>
                <span style={{ fontWeight: 700, flex: 1 }}>{x.label}</span>
                <span className="num" style={{ fontWeight: 800 }}>{x.value}%</span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.5, borderTop: "1px solid var(--border-soft)", paddingTop: 12 }}>
            Of your <b style={{ color: "var(--text-2)" }}>{FT.fmt(a.surplus > 0 ? a.surplus : 0, cur)}</b> monthly surplus, a rough split would be {FT.fmtShort(a.surplus*a.equity/100,cur)} equity · {FT.fmtShort(a.surplus*a.debt/100,cur)} debt · {FT.fmtShort(a.surplus*a.gold/100,cur)} gold.
          </div>
        </div>

        <div className="grid" style={{ gap: 14, alignContent: "start" }}>
          {/* emergency fund meter */}
          <div className="card card-pad fade-in">
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}><Icon name="shield" size={17} style={{ color: "var(--c2)" }} /><span className="card-title">Emergency fund</span></div>
              <span className="num" style={{ fontWeight: 700, color: a.emFundPct >= 100 ? "var(--pos)" : "var(--text-2)" }}>{FT.fmtShort(a.liquid, cur)} / {FT.fmtShort(a.emFundTarget, cur)}</span>
            </div>
            <div className="bar-track" style={{ height: 10 }}><div className="bar-fill" style={{ width: a.emFundPct + "%", background: a.emFundPct >= 100 ? "var(--pos)" : "var(--c2)" }}></div></div>
            <div style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 600, marginTop: 8 }}>{a.emFundPct >= 100 ? "Fully funded — you have 6+ months of expenses covered." : `${a.emFundPct.toFixed(0)}% of a 6-month safety net.`}</div>
          </div>

          {a.sug.map((s, i) => (
            <div key={i} className="card card-pad fade-in" style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
              <span className="kpi-ico" style={{ background: "color-mix(in srgb," + s.color + " 16%, transparent)", color: s.color, width: 38, height: 38, flexShrink: 0 }}><Icon name={s.icon} /></span>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                  <span style={{ fontWeight: 800, fontSize: 14.5 }}>{s.title}</span>
                  {s.p === 1 && <span className="tag" style={{ background: "var(--neg-soft)", color: "var(--neg)" }}>Priority</span>}
                </div>
                <div style={{ fontSize: 13.5, color: "var(--text-2)", lineHeight: 1.6, marginTop: 5 }}>{s.body}</div>
                <div className="pill pill-pos" style={{ marginTop: 9 }}>{s.stat}</div>
              </div>
            </div>
          ))}
          <div style={{ fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.5, padding: "0 4px" }}>
            <Icon name="info" size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
            Educational guidance only — not SEBI-registered financial advice. Consult a certified advisor before investing.
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, v, c }) {
  return <div><div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 700, whiteSpace: "nowrap" }}>{label}</div><div className="num display" style={{ fontSize: 18, fontWeight: 600, color: c }}>{v}</div></div>;
}

Object.assign(window, { Investments, buildAdvice });
