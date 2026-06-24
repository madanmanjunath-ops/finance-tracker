/* ============================================================
   views_cards.jsx — credit cards: totals, AI advisor,
   points & opportunities, and the card table.
   ============================================================ */
function cardUtilization(card, state) {
  const ccy = card.currency || "INR";
  const limRaw = card.limit || 0;
  const availRaw = Compute.cardAvailable(card, state);   // anchor-aware + payment-aware (single source of truth)
  const usedRaw = Math.max(0, limRaw - availRaw);
  const limit = Compute.conv(limRaw, ccy, state);
  const avail = Compute.conv(availRaw, ccy, state);
  const used = Compute.conv(usedRaw, ccy, state);
  return { used, avail, limit, pct: limit ? Math.min(100, (used / limit) * 100) : 0 };
}

/* recommendation engine (deterministic category quick-pick) */
function recommendCards(state, rewCat) {
  return state.cards.map(c => {
    const def = FT.cardDef(c.cardType);
    const rate = FT.rewardRate(c, rewCat);
    const float = FT.floatDays(c);
    const util = cardUtilization(c, state);
    const dueIn = FT.nextDue(c).inDays;
    const nearLimit = util.pct >= 85;
    return { card: c, def, rate, float, util, dueIn, nearLimit };
  }).sort((a, b) => (b.rate - a.rate) || ((b.float || 0) - (a.float || 0)));
}

/* opportunities/hacks derived from the user's own state */
function buildOpportunities(state) {
  const out = [];
  (state.cards || []).forEach(c => {
    const util = cardUtilization(c, state);
    const due = FT.nextDue(c);
    const name = c.name || FT.cardDef(c.cardType).name;
    if (due.inDays != null && due.inDays >= 0 && due.inDays <= 5) {
      const amt = c.stmtAmount ? " (₹" + Math.round(c.stmtAmount).toLocaleString("en-IN") + ")" : "";
      out.push({ kind: "Due", tone: "neg", text: `${name} payment due in ${due.inDays} day${due.inDays !== 1 ? "s" : ""}${amt}.` });
    }
    if (util.limit && util.pct >= 85) out.push({ kind: "Limit", tone: "neg", text: `${name} is at ${Math.round(util.pct)}% of its limit — consider paying it down.` });
    const val = (c.points || 0) * FT.pointValue(c);
    if (val >= 5000) out.push({ kind: "Points", tone: "accent", text: `${name} has ${(c.points || 0).toLocaleString("en-IN")} points (≈ ₹${Math.round(val).toLocaleString("en-IN")}) sitting idle — redeem or transfer.` });
    if (!c.last4) out.push({ kind: "Setup", tone: "mut", text: `Add the last 4 digits to ${name} so email imports can attribute spends to it.` });
  });
  out.push({ kind: "Tip", tone: "mut", text: "Rent, utilities, fuel and insurance earn little on most cards — put those on your longest-float card instead." });
  return out;
}

function CardsView({ state, actions }) {
  const cur = state.displayCurrency;
  const [rewCat, setRewCat] = useState("dining");
  const [edit, setEdit] = useState(null);
  const [adding, setAdding] = useState(false);
  const [advQ, setAdvQ] = useState("");
  const [advAns, setAdvAns] = useState(null);
  const [advBusy, setAdvBusy] = useState(false);
  const [advErr, setAdvErr] = useState("");

  async function askAdvisor() {
    if (!advQ.trim()) return;
    setAdvBusy(true); setAdvErr(""); setAdvAns(null);
    const cards = state.cards.map(c => {
      const def = FT.cardDef(c.cardType);
      const rates = { ...(def.rates || {}), ...(c.rates || {}) };
      const blob = (def.perks || "") + " " + (def.notes || "");
      return {
        name: c.name || def.name,
        type: def.type,
        generalPct: c.base != null ? c.base : def.base,
        categoryPct: rates,
        forex: /0%\s*forex|zero\s*forex|no\s*forex|forex.?free/i.test(blob) ? "0% markup" : "~3.5% markup",
        interestFreeDays: FT.floatDays(c),
        points: c.points || 0,
        transferPartners: FT.cardPartners(c),
      };
    });
    const prompt = `You are a credit-card rewards advisor for an Indian user. Here are their cards with effective % value-back per category, forex markup, interest-free float days, points balance and transfer partners:
${JSON.stringify(cards)}

User's question: "${advQ}"

Pick the single best card for this and explain briefly. Weigh: the category reward %, forex markup if the spend is in a foreign currency, interest-free float if they want time to pay, and points/transfer value. Respond ONLY as JSON, no prose:
{"card":"<exact card name from the list>","reason":"<=40 words why>","alt":"<optional: another card and when it would be better, else empty string>"}`;
    try {
      let raw = (await window.claude.complete(prompt) || "").trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
      const m = raw.match(/\{[\s\S]*\}/); const o = JSON.parse(m ? m[0] : raw);
      if (!o || !o.card) throw new Error("no card");
      setAdvAns(o);
    } catch (e) { setAdvErr("Couldn't reach the advisor. Try the category quick-pick below, or set your AI key in Settings → AI service."); }
    setAdvBusy(false);
  }

  if (!state.cards.length) {
    return (
      <div className="card card-pad fade-in empty" style={{ padding: "60px 20px" }}>
        <Icon name="wallet" />
        <div style={{ fontWeight: 800, color: "var(--text-2)", fontSize: 16 }}>No credit cards yet</div>
        <div style={{ fontSize: 13.5, marginBottom: 18 }}>Add your cards to unlock reward-maximising "best card" tips.</div>
        <button className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} />Add a credit card</button>
        {adding && <CardModal state={state} onClose={() => setAdding(false)} onSave={(c) => { actions.addCard(c); setAdding(false); }} />}
      </div>
    );
  }

  const cs = Compute.creditSummary(state);
  const ps = Compute.pointsSummary(state);
  const utilPct = cs.limit ? Math.round((cs.used / cs.limit) * 100) : 0;
  const recs = recommendCards(state, rewCat);
  const best = recs.filter(r => !r.nearLimit)[0] || recs[0];
  const opps = buildOpportunities(state);
  const pointCards = state.cards.filter(c => { const d = FT.cardDef(c.cardType); return d.type === "points" || d.type === "miles" || (c.points || 0) > 0; });
  const toneColor = (t) => t === "neg" ? "var(--neg)" : t === "accent" ? "var(--accent)" : "var(--text-3)";
  const toneBg = (t) => t === "neg" ? "var(--neg-soft, var(--surface-2))" : t === "accent" ? "var(--accent-soft)" : "var(--surface-2)";

  return (
    <div className="grid" style={{ gap: 18 }}>

      {/* ---- totals strip ---- */}
      <div className="card card-pad fade-in">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
          <StatTile label="Total limit" v={FT.fmtShort(cs.limit, cur)} />
          <StatTile label="Available" v={FT.fmtShort(cs.avail, cur)} c="var(--pos)" />
          <StatTile label="Utilization" v={cs.limit ? utilPct + "%" : "—"} c={utilPct >= 85 ? "var(--neg)" : utilPct >= 50 ? "var(--warn)" : "var(--pos)"} />
          <StatTile label="Reward points" v={ps.points ? ps.points.toLocaleString("en-IN") : "—"} sub={ps.value ? "≈ " + FT.fmtShort(ps.value, cur) : ""} />
        </div>
      </div>

      {/* ---- AI advisor (free-form) + category quick-pick ---- */}
      <div className="card card-pad fade-in">
        <div className="card-h">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="kpi-ico" style={{ background: "var(--accent-soft)", color: "var(--accent)", width: 34, height: 34 }}><Icon name="sparkles" /></span>
            <div><div className="card-title">Which card should I use?</div><div className="card-sub">Ask in plain words, or quick-pick a category</div></div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <input className="input" style={{ flex: 1 }} placeholder="e.g. Booking a ₹95,000 international flight on MakeMyTrip"
            value={advQ} onChange={e => setAdvQ(e.target.value)} onKeyDown={e => { if (e.key === "Enter") askAdvisor(); }} />
          <button className="btn btn-primary" onClick={askAdvisor} disabled={advBusy || !advQ.trim()}>{advBusy ? "Thinking…" : <><Icon name="wand" size={15} />Ask</>}</button>
        </div>
        {advErr && <div style={{ fontSize: 12.5, color: "var(--neg)", fontWeight: 600, marginTop: 8 }}>{advErr}</div>}
        {advAns && (
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 16, marginTop: 12 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: "var(--accent)", letterSpacing: ".06em", textTransform: "uppercase" }}>Recommended</div>
              <div className="display" style={{ fontSize: 20, fontWeight: 600 }}>{advAns.card}</div>
            </div>
            <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 8, lineHeight: 1.55 }}>{advAns.reason}</div>
            {advAns.alt && <div style={{ fontSize: 12.5, color: "var(--text-3)", marginTop: 8, lineHeight: 1.5 }}><b>Alternative:</b> {advAns.alt}</div>}
          </div>
        )}

        {/* category quick-pick (offline, deterministic) */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, color: "var(--text-3)", fontWeight: 700 }}>Or quick-pick by category</span>
          <select className="select" style={{ width: "auto" }} value={rewCat} onChange={e => setRewCat(e.target.value)}>
            {FT.REW_CATS.map(rc => <option key={rc.id} value={rc.id}>{rc.name}</option>)}
          </select>
          {best && (
            <span style={{ fontSize: 13, color: "var(--text-2)" }}>
              → <b style={{ fontWeight: 700 }}>{best.card.name}</b>
              {best.rate ? <span style={{ color: "var(--pos)", fontWeight: 700 }}> · {best.rate}% back</span> : null}
              {best.float != null ? <span className="lt-mut"> · {best.float}d float</span> : null}
            </span>
          )}
        </div>

        {/* alerts */}
        {recs.some(r => r.nearLimit || (r.dueIn != null && r.dueIn <= 5 && r.dueIn >= 0)) && (
          <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 14 }}>
            {recs.filter(r => r.nearLimit).map(r => (
              <div key={"nl" + r.card.id} className="pill pill-neg" style={{ alignSelf: "flex-start" }}><Icon name="info" size={13} />{r.card.name} is at {r.util.pct.toFixed(0)}% of its limit</div>
            ))}
            {recs.filter(r => r.dueIn != null && r.dueIn <= 5 && r.dueIn >= 0).map(r => (
              <div key={"du" + r.card.id} className="pill" style={{ alignSelf: "flex-start", background: "var(--accent-soft)", color: "var(--accent)" }}><Icon name="calendar" size={13} />{r.card.name} payment due in {r.dueIn} day{r.dueIn !== 1 ? "s" : ""}</div>
            ))}
          </div>
        )}
      </div>

      {/* ---- points & opportunities ---- */}
      <div className="card card-pad fade-in">
        <div className="card-h"><div className="card-title">Points &amp; opportunities</div></div>

        {pointCards.length > 0 && (
          <table className="ltable" style={{ marginBottom: 6 }}>
            <thead>
              <tr>
                <th>Card</th>
                <th style={{ width: 90, textAlign: "right" }}>Balance</th>
                <th style={{ width: 96, textAlign: "right" }}>Value</th>
                <th style={{ width: 230, textAlign: "right" }}>Transfer partners</th>
              </tr>
            </thead>
            <tbody>
              {pointCards.map(c => {
                const pts = c.points || 0;
                const val = pts * FT.pointValue(c);
                const partners = FT.cardPartners(c);
                return (
                  <tr key={c.id} style={{ cursor: "pointer" }} onClick={() => setEdit(c)}>
                    <td style={{ fontWeight: 650 }}>{c.name || FT.cardDef(c.cardType).name}</td>
                    <td className="lt-amt">{pts ? pts.toLocaleString("en-IN") : <span className="lt-mut">add</span>}</td>
                    <td className="lt-amt lt-mut">{pts ? "≈ " + FT.fmtShort(val, cur) : "—"}</td>
                    <td style={{ textAlign: "right" }}>
                      {partners.length ? partners.map((p, i) => (
                        <span key={i} className="tag" style={{ background: "var(--surface-2)", color: "var(--text-2)", fontSize: 11, marginLeft: 4 }}>{p}</span>
                      )) : <span className="lt-mut">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: pointCards.length ? 12 : 2 }}>
          {opps.map((o, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 12, background: toneBg(o.tone), borderRadius: "var(--radius)", padding: "10px 12px" }}>
              <span style={{ flexShrink: 0, width: 60, fontSize: 10.5, fontWeight: 800, letterSpacing: ".04em", textTransform: "uppercase", color: toneColor(o.tone), marginTop: 1 }}>{o.kind}</span>
              <span style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.5 }}>{o.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ---- card list ---- */}
      <div className="card card-pad fade-in">
        <div className="card-h">
          <div className="card-title">Your cards · {state.cards.length} <span className="lt-mut" style={{ fontSize: 12, fontWeight: 500 }}>· tap a card to edit</span></div>
          <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}><Icon name="plus" size={15} />Add card</button>
        </div>
        <table className="ltable">
          <thead>
            <tr>
              <th>Card</th>
              <th style={{ width: 90, textAlign: "right" }}>Used</th>
              <th style={{ width: 96, textAlign: "right" }}>Available</th>
              <th style={{ width: 90, textAlign: "right" }}>Limit</th>
              <th style={{ width: 78, textAlign: "right" }}>Statement</th>
              <th style={{ width: 80, textAlign: "right" }}>Due date</th>
              <th style={{ width: 62, textAlign: "right" }}>Due in</th>
              <th style={{ width: 56, textAlign: "right" }}>Float</th>
            </tr>
          </thead>
          <tbody>
            {state.cards.map(c => {
              const def = FT.cardDef(c.cardType);
              const util = cardUtilization(c, state);
              const float = FT.floatDays(c);
              const due = FT.nextDue(c);
              const dueIn = due.inDays;
              const dueSoon = dueIn != null && dueIn <= 5 && dueIn >= 0;
              return (
                <tr key={c.id} style={{ cursor: "pointer" }} onClick={() => setEdit(c)}>
                  <td style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 0 }}>
                    <span style={{ fontWeight: 650 }}>{c.name || def.name}</span>
                    <span className="lt-mut" style={{ fontSize: 11.5, marginLeft: 7 }}>{def.bank || ""} · {c.network}{c.last4 ? " ••" + c.last4 : ""}</span>
                    {!c.last4 && <span className="tag" style={{ background: "var(--warn-soft, var(--surface-3))", color: "var(--warn)", fontSize: 10, marginLeft: 7 }} title="Add the last 4 digits so email imports can attribute spends to this card">add last 4</span>}
                  </td>
                  <td className="lt-amt">{util.limit ? FT.fmtShort(util.used, cur) : "—"}</td>
                  <td className="lt-amt" style={{ color: util.pct >= 85 ? "var(--neg)" : "var(--pos)", fontWeight: 600 }}>{util.limit ? FT.fmtShort(util.avail, cur) : "—"}</td>
                  <td className="lt-amt lt-mut">{util.limit ? FT.fmtShort(util.limit, cur) : "—"}</td>
                  <td className="lt-amt lt-mut">{c.billingDay ? FT.ordinal(c.billingDay) : "—"}</td>
                  <td className="lt-amt lt-mut" title={due.exact ? "From your latest statement email" : "Recurring due day"}>{due.label}{due.exact ? " *" : ""}</td>
                  <td className="lt-amt" style={{ color: dueSoon ? "var(--neg)" : "var(--text-2)", fontWeight: dueSoon ? 700 : 500 }}>{dueIn != null ? dueIn + "d" : "—"}</td>
                  <td className="lt-amt lt-mut">{float != null ? float + "d" : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {(adding || edit) && <CardModal state={state} editing={edit} onClose={() => { setAdding(false); setEdit(null); }}
        onSave={(c, delId) => { if (delId) actions.deleteCard(delId); else if (edit) actions.updateCard(c); else actions.addCard(c); setAdding(false); setEdit(null); }} />}
    </div>
  );
}

function StatTile({ label, v, c, sub }) {
  return (
    <div style={{ background: "var(--surface)", borderRadius: "var(--radius)", padding: "12px 14px" }}>
      <div style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 700 }}>{label}</div>
      <div className="num" style={{ fontSize: 22, fontWeight: 700, fontFamily: "var(--font-display)", color: c || "var(--text)", marginTop: 2 }}>{v}</div>
      {sub ? <div className="lt-mut" style={{ fontSize: 11.5, marginTop: 1 }}>{sub}</div> : null}
    </div>
  );
}

function Mini({ label, v, c, small }) {
  return <div><div style={{ fontSize: small ? 10.5 : 11, color: "var(--text-3)", fontWeight: 700 }}>{label}</div><div className="num" style={{ fontSize: small ? 14 : 17, fontWeight: 700, fontFamily: "var(--font-display)", color: c || "var(--text)" }}>{v}</div></div>;
}

function CardModal({ state, editing, onClose, onSave }) {
  const cur = state.displayCurrency;
  const blank = { id: "card_" + FT.uid(), name: "", cardType: "amzicici", network: "Visa", last4: "", limit: 0, billingDay: 1, dueDay: 18, graceDays: 20, balance: 0, currency: "INR", rates: null, points: 0, ptValue: null, stmtAmount: 0, stmtDueDate: "", partners: null };
  const [c, setC] = useState(editing ? { ...editing } : blank);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState("");
  const def = FT.cardDef(c.cardType);
  const set = (k, v) => setC({ ...c, [k]: v });
  const effRates = c.rates || def.rates || {};
  const partnersStr = (c.partners != null ? c.partners : FT.cardPartners(c)).join(", ");

  async function aiFillRewards() {
    setAiBusy(true); setAiMsg("");
    const name = c.name || def.name;
    const prompt = `For the Indian credit card "${name}", give its current reward/cashback structure as ONLY a JSON object, no prose:
{"base": <percent value back on general spends>, "rates": {"dining": <pct>, "groceries": <pct>, "fuel": <pct>, "online": <pct>, "travel": <pct>, "utilities": <pct>}, "notes": "<one line summary>"}
Use effective % value-back per ₹100 (e.g. 5 for 5%). Omit a category from rates if it has no special rate. Be realistic for 2026 post-devaluation.`;
    try {
      let raw = (await window.claude.complete(prompt) || "").trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
      const m = raw.match(/\{[\s\S]*\}/); const o = JSON.parse(m ? m[0] : raw);
      setC(prev => ({ ...prev, base: o.base != null ? o.base : prev.base, rates: o.rates || prev.rates, aiNotes: o.notes || "" }));
      setAiMsg("Filled — review the rates below.");
    } catch (e) { setAiMsg("Couldn't fetch automatically. Enter rates manually."); }
    setAiBusy(false);
  }

  return (
    <Modal title={editing ? "Edit card" : "Add credit card"} onClose={onClose} wide
      foot={<>
        {editing && <button className="btn btn-ghost" style={{ color: "var(--neg)", marginRight: "auto" }} onClick={() => onSave(null, editing.id)}><Icon name="trash" size={15} />Delete</button>}
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => onSave(c)}><Icon name="check" size={16} />Save card</button>
      </>}>
      <div className="modal-body">
        <div className="field"><label className="label">Card</label>
          <select className="select" value={c.cardType} onChange={e => { const d = FT.cardDef(e.target.value); setC({ ...c, cardType: e.target.value, name: c.name || d.name, network: d.network.split("/")[0], rates: null, partners: null }); }}>
            {FT.CARD_DB.map(cd => <option key={cd.id} value={cd.id}>{cd.name}</option>)}
          </select>
          <div style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.5 }}>{def.notes}</div>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 2 }}><label className="label">Nickname</label><input className="input" value={c.name} onChange={e => set("name", e.target.value)} placeholder={def.name} /></div>
          <div className="field" style={{ flex: 1 }}><label className="label">Network</label><select className="select" value={c.network} onChange={e => set("network", e.target.value)}>{FT.NETWORKS.map(n => <option key={n}>{n}</option>)}</select></div>
          <div className="field" style={{ flex: 1 }}><label className="label">Last 4</label><input className="input num" maxLength="4" value={c.last4} onChange={e => set("last4", e.target.value.replace(/\D/g,""))} /></div>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1 }}><label className="label">Credit limit</label><input className="input num" type="number" value={c.limit || ""} onChange={e => set("limit", +e.target.value)} /></div>
          <div className="field" style={{ flex: 1 }}><label className="label">Outstanding</label><input className="input num" type="number" value={c.balance || ""} onChange={e => set("balance", +e.target.value)} /></div>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1 }}><label className="label">Statement day</label><input className="input num" type="number" min="1" max="28" value={c.billingDay} onChange={e => set("billingDay", +e.target.value)} /></div>
          <div className="field" style={{ flex: 1 }}><label className="label">Payment due day</label><input className="input num" type="number" min="1" max="28" value={c.dueDay} onChange={e => set("dueDay", +e.target.value)} /></div>
          <div className="field" style={{ flex: 1 }}><label className="label">Grace days</label><input className="input num" type="number" value={c.graceDays} onChange={e => set("graceDays", +e.target.value)} /></div>
        </div>

        {/* current statement (amount due + real due date) — auto-filled by email, editable here */}
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1 }}><label className="label">Statement amount due</label><input className="input num" type="number" value={c.stmtAmount || ""} placeholder="0" onChange={e => set("stmtAmount", +e.target.value)} /></div>
          <div className="field" style={{ flex: 1 }}><label className="label">Statement due date</label><input className="input" type="date" value={c.stmtDueDate || ""} onChange={e => set("stmtDueDate", e.target.value)} /></div>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: -4, marginBottom: 4 }}>Leave the due date blank to use the recurring due day. A statement email overrides both automatically.</div>

        {/* rewards / points */}
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1 }}><label className="label">Points / miles balance</label><input className="input num" type="number" value={c.points || ""} placeholder="0" onChange={e => set("points", +e.target.value)} /></div>
          <div className="field" style={{ flex: 1 }}><label className="label">Value per point (₹)</label><input className="input num" type="number" step="0.1" value={c.ptValue != null ? c.ptValue : ""} placeholder={String(FT.pointValue(c))} onChange={e => set("ptValue", e.target.value === "" ? null : +e.target.value)} /></div>
        </div>
        <div className="field"><label className="label">Transfer partners</label>
          <input className="input" value={partnersStr} placeholder="e.g. Air India, Marriott, Qatar" onChange={e => set("partners", e.target.value.split(",").map(s => s.trim()).filter(Boolean))} />
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>Comma-separated. These change over time — edit to keep them accurate.</div>
        </div>

        {/* reward rates editor */}
        <div className="field">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <label className="label">Reward rates (% back)</label>
            <button className="btn btn-sm" onClick={aiFillRewards} disabled={aiBusy}>{aiBusy ? "Looking up…" : <><Icon name="wand" size={14} />Ask AI to fill</>}</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 4 }}>
            <RateInput label="General" v={c.base != null ? c.base : def.base} onChange={v => set("base", v)} />
            {FT.REW_CATS.filter(r => r.id !== "general").map(rc => (
              <RateInput key={rc.id} label={rc.name} v={effRates[rc.id]} placeholder={c.base != null ? c.base : def.base}
                onChange={v => setC(prev => ({ ...prev, rates: { ...(prev.rates || def.rates || {}), [rc.id]: v } }))} />
            ))}
          </div>
          {aiMsg && <div style={{ fontSize: 12.5, color: "var(--accent)", fontWeight: 700, marginTop: 8 }}>{aiMsg}</div>}
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6 }}>Tip: leave a category blank to use the general rate. Verify against your card's latest terms.</div>
        </div>
      </div>
    </Modal>
  );
}
function RateInput({ label, v, onChange, placeholder }) {
  return <div className="field"><label className="label" style={{ fontSize: 11.5 }}>{label}</label>
    <input className="input num" style={{ padding: "8px 10px" }} type="number" step="0.5" value={v == null ? "" : v} placeholder={placeholder != null ? String(placeholder) : "0"} onChange={e => onChange(e.target.value === "" ? null : +e.target.value)} /></div>;
}

Object.assign(window, { CardsView, recommendCards });
