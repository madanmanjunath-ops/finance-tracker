/* ============================================================
   views_cards.jsx — credit cards + "best card to use today"
   ============================================================ */
function cardUtilization(card, state) {
  const lim = card.limit || 0;
  const stored = Compute.conv(card.balance || 0, card.currency || "INR", state);
  // add expenses booked directly on this card that haven't been paid off
  const onCard = (state.transactions || [])
    .filter(t => t.account === "card:" + card.id && t.type === "expense")
    .reduce((s, t) => s + Compute.tAmt(t, state), 0);
  const bal = stored + onCard;
  const limConv = Compute.conv(lim, card.currency || "INR", state);
  return { used: bal, limit: limConv, pct: limConv ? Math.min(100, (bal / limConv) * 100) : 0 };
}

/* recommendation engine */
function recommendCards(state, rewCat) {
  return state.cards.map(c => {
    const def = FT.cardDef(c.cardType);
    const rate = FT.rewardRate(c, rewCat);
    const float = FT.floatDays(c);
    const util = cardUtilization(c, state);
    const dueIn = FT.daysUntil(c.dueDay);
    const nearLimit = util.pct >= 85;
    return { card: c, def, rate, float, util, dueIn, nearLimit };
  }).sort((a, b) => (b.rate - a.rate) || ((b.float || 0) - (a.float || 0)));
}

function CardsView({ state, actions }) {
  const cur = state.displayCurrency;
  const [rewCat, setRewCat] = useState("dining");
  const [edit, setEdit] = useState(null);
  const [adding, setAdding] = useState(false);

  if (!state.cards.length) {
    return (
      <div className="card card-pad fade-in empty" style={{ padding: "60px 20px" }}>
        <Icon name="wallet" />
        <div style={{ fontWeight: 800, color: "var(--text-2)", fontSize: 16 }}>No credit cards yet</div>
        <div style={{ fontSize: 13.5, marginBottom: 18 }}>Add your cards to unlock reward-maximising "best card today" tips.</div>
        <button className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} />Add a credit card</button>
        {adding && <CardModal state={state} onClose={() => setAdding(false)} onSave={(c) => { actions.addCard(c); setAdding(false); }} />}
      </div>
    );
  }

  const recs = recommendCards(state, rewCat);
  const best = recs.filter(r => !r.nearLimit)[0] || recs[0];
  const floatPick = [...recs].sort((a, b) => (b.float || 0) - (a.float || 0)).filter(r => !r.nearLimit)[0];

  return (
    <div className="grid" style={{ gap: 18 }}>
      {/* best card today */}
      <div className="card card-pad fade-in" style={{}}>
        <div className="card-h">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="kpi-ico" style={{ background: "var(--accent-soft)", color: "var(--accent)", width: 34, height: 34 }}><Icon name="sparkles" /></span>
            <div><div className="card-title">Best card to use today</div><div className="card-sub">Pick what you're buying</div></div>
          </div>
          <select className="select" style={{ width: "auto" }} value={rewCat} onChange={e => setRewCat(e.target.value)}>
            {FT.REW_CATS.map(rc => <option key={rc.id} value={rc.id}>{rc.name}</option>)}
          </select>
        </div>
        {best && (
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "stretch" }}>
            <div style={{ flex: "1 1 280px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 16 }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: "var(--accent)", letterSpacing: ".06em", textTransform: "uppercase" }}>Top pick · rewards</div>
              <div className="display" style={{ fontSize: 22, fontWeight: 600, marginTop: 6 }}>{best.card.name}</div>
              <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
                <Mini label={FT.REW_CATS.find(r=>r.id===rewCat).name + " reward"} v={best.rate ? best.rate + "%" : "—"} c="var(--pos)" />
                <Mini label="Interest-free" v={best.float != null ? best.float + " days" : "—"} />
                <Mini label="Used" v={best.util.limit ? best.util.pct.toFixed(0) + "%" : "—"} c={best.nearLimit ? "var(--neg)" : "var(--text)"} />
              </div>
              {best.def.notes && <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 12, lineHeight: 1.5 }}>{best.def.notes}</div>}
            </div>
            {floatPick && floatPick.card.id !== best.card.id && (
              <div style={{ flex: "1 1 220px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 16 }}>
                <div style={{ fontSize: 11.5, fontWeight: 800, color: "var(--c2)", letterSpacing: ".06em", textTransform: "uppercase" }}>Longest float</div>
                <div className="display" style={{ fontSize: 20, fontWeight: 600, marginTop: 6 }}>{floatPick.card.name}</div>
                <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 10 }}><b className="num">{floatPick.float}</b> interest-free days — best when you want maximum time to pay.</div>
              </div>
            )}
          </div>
        )}
        {/* alerts */}
        {recs.some(r => r.nearLimit || (r.dueIn != null && r.dueIn <= 5)) && (
          <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 14 }}>
            {recs.filter(r => r.nearLimit).map(r => (
              <div key={r.card.id} className="pill pill-neg" style={{ alignSelf: "flex-start" }}><Icon name="info" size={13} />{r.card.name} is at {r.util.pct.toFixed(0)}% of its limit</div>
            ))}
            {recs.filter(r => r.dueIn != null && r.dueIn <= 5).map(r => (
              <div key={r.card.id} className="pill" style={{ alignSelf: "flex-start", background: "var(--accent-soft)", color: "var(--accent)" }}><Icon name="calendar" size={13} />{r.card.name} payment due in {r.dueIn} day{r.dueIn!==1?"s":""}</div>
            ))}
          </div>
        )}
      </div>

      {/* card list */}
      <div className="card card-pad fade-in">
        <div className="card-h"><div className="card-title">Your cards · {state.cards.length}</div><button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}><Icon name="plus" size={15} />Add card</button></div>
        <table className="ltable">
          <thead>
            <tr>
              <th>Card</th>
              <th style={{ width: 150 }}>Utilization</th>
              <th style={{ width: 100, textAlign: "right" }}>Used</th>
              <th style={{ width: 100, textAlign: "right" }}>Limit</th>
              <th style={{ width: 86, textAlign: "right" }}>Statement</th>
              <th style={{ width: 70, textAlign: "right" }}>Due in</th>
              <th style={{ width: 60, textAlign: "right" }}>Float</th>
            </tr>
          </thead>
          <tbody>
            {state.cards.map(c => {
              const def = FT.cardDef(c.cardType);
              const util = cardUtilization(c, state);
              const float = FT.floatDays(c);
              const dueIn = FT.daysUntil(c.dueDay);
              return (
                <tr key={c.id} style={{ cursor: "pointer" }} onClick={() => setEdit(c)}>
                  <td style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 0 }}>
                    <span style={{ fontWeight: 650 }}>{c.name || def.name}</span>
                    <span className="lt-mut" style={{ fontSize: 11.5, marginLeft: 7 }}>{def.bank || ""} · {c.network}{c.last4 ? " ••" + c.last4 : ""}</span>
                    {!c.last4 && <span className="tag" style={{ background: "var(--warn-soft, var(--surface-3))", color: "var(--warn)", fontSize: 10, marginLeft: 7 }} title="Add the last 4 digits so email imports can attribute spends to this card">add last 4</span>}
                  </td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <div style={{ flex: 1, height: 8, background: "var(--surface-2)", borderRadius: 3 }}>
                        <div style={{ width: Math.min(util.pct, 100) + "%", height: 8, borderRadius: 3, background: util.pct >= 85 ? "var(--neg)" : util.pct >= 50 ? "var(--warn)" : "var(--accent)", opacity: .8 }}></div>
                      </div>
                      <span className="lt-mut num" style={{ fontSize: 11, width: 32, textAlign: "right" }}>{util.limit ? Math.round(util.pct) + "%" : "—"}</span>
                    </div>
                  </td>
                  <td className="lt-amt">{util.limit ? FT.fmtShort(util.used, cur) : "—"}</td>
                  <td className="lt-amt lt-mut">{util.limit ? FT.fmtShort(util.limit, cur) : "—"}</td>
                  <td className="lt-amt lt-mut">{c.billingDay ? "Day " + c.billingDay : "—"}</td>
                  <td className="lt-amt" style={{ color: dueIn != null && dueIn <= 5 ? "var(--neg)" : "var(--text-2)", fontWeight: dueIn != null && dueIn <= 5 ? 700 : 500 }}>{dueIn != null ? dueIn + "d" : "—"}</td>
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

function Mini({ label, v, c, small }) {
  return <div><div style={{ fontSize: small ? 10.5 : 11, color: "var(--text-3)", fontWeight: 700 }}>{label}</div><div className="num" style={{ fontSize: small ? 14 : 17, fontWeight: 700, fontFamily: "var(--font-display)", color: c || "var(--text)" }}>{v}</div></div>;
}

function CardModal({ state, editing, onClose, onSave }) {
  const cur = state.displayCurrency;
  const blank = { id: "card_" + FT.uid(), name: "", cardType: "amzicici", network: "Visa", last4: "", limit: 0, billingDay: 1, dueDay: 18, graceDays: 20, balance: 0, currency: "INR", rates: null };
  const [c, setC] = useState(editing ? { ...editing } : blank);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState("");
  const def = FT.cardDef(c.cardType);
  const set = (k, v) => setC({ ...c, [k]: v });
  const effRates = c.rates || def.rates || {};

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
          <select className="select" value={c.cardType} onChange={e => { const d = FT.cardDef(e.target.value); setC({ ...c, cardType: e.target.value, name: c.name || d.name, network: d.network.split("/")[0], rates: null }); }}>
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
