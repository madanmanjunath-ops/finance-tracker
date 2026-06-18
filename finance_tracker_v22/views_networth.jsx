/* ============================================================
   views_networth.jsx — net worth, accounts, allocation, goals
   ============================================================ */
function AccountModal({ state, onClose, onSave, editing }) {
  const [name, setName] = useState(editing ? editing.name : "");
  const [type, setType] = useState(editing ? editing.type : "bank");
  const [balance, setBalance] = useState(editing ? String(editing.balance) : "");
  const [currency, setCurrency] = useState(editing ? (editing.currency || "INR") : "INR");
  const [rate, setRate] = useState(editing && editing.rate ? String(editing.rate) : "");
  const [payout, setPayout] = useState(editing && editing.payout ? editing.payout : "cumulative");
  const [maturityDate, setMaturityDate] = useState(editing && editing.maturityDate ? editing.maturityDate : "");
  const palette = ["var(--c1)","var(--c2)","var(--c3)","var(--c4)","var(--c5)","var(--c6)","var(--c7)","var(--c8)","var(--c10)"];
  const [color, setColor] = useState(editing ? editing.color : palette[1]);
  const yields = FT.acctType(type).yields;
  return (
    <Modal title={editing ? "Edit account" : "Add account"} onClose={onClose}
      foot={<>
        {editing && <button className="btn btn-ghost" style={{ color: "var(--neg)", marginRight: "auto" }} onClick={() => onSave(null, editing.id)}><Icon name="trash" size={15} />Delete</button>}
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => { if (!name.trim()) return; onSave({ id: editing ? editing.id : "acc_" + FT.uid(), name: name.trim(), type, currency, balance: +balance || 0, color, rate: yields ? (+rate || 0) : undefined, payout: yields ? payout : undefined, maturityDate: (type === "fd" || type === "bond") ? (maturityDate || undefined) : undefined }); }}><Icon name="check" size={16} />Save</button>
      </>}>
      <div className="modal-body">
        <div className="field"><label className="label">Account name</label><input className="input" placeholder={type === "fd" ? "e.g. HDFC FD 7.1%" : "e.g. HDFC Savings"} value={name} onChange={e => setName(e.target.value)} autoFocus /></div>
        <div className="field"><label className="label">Type</label>
          <div className="chips">{FT.ACCOUNT_TYPES.map(a => <button key={a.id} className={"chip" + (type === a.id ? " sel" : "")} onClick={() => setType(a.id)}><span>{a.emoji}</span>{a.name}</button>)}</div>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 2 }}><label className="label">{type === "fd" ? "Principal / current value" : "Current balance"} {!FT.acctType(type).asset && <span style={{ color: "var(--neg)", fontWeight: 600 }}>(owed)</span>}</label><input className="input num" type="number" placeholder="0" value={balance} onChange={e => setBalance(e.target.value)} /></div>
          <div className="field" style={{ flex: 1 }}><label className="label">Currency</label><select className="select" value={currency} onChange={e => setCurrency(e.target.value)}>{Object.keys(FT.CUR).map(c => <option key={c} value={c}>{FT.symOf(c)} {c}</option>)}</select></div>
        </div>
        {yields && (
          <div className="row" style={{ gap: 12 }}>
            <div className="field" style={{ flex: 1 }}><label className="label">Interest rate (% p.a.)</label><input className="input num" type="number" step="0.05" placeholder="e.g. 7.1" value={rate} onChange={e => setRate(e.target.value)} /></div>
            <div className="field" style={{ flex: 1.4 }}><label className="label">Interest payout</label><select className="select" value={payout} onChange={e => setPayout(e.target.value)}>{FT.PAYOUTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          </div>
        )}
        {(type === "fd" || type === "bond") && (
          <div className="field"><label className="label">Maturity date</label><input className="input" type="date" value={maturityDate} onChange={e => setMaturityDate(e.target.value)} /></div>
        )}
        {yields && +rate > 0 && +balance > 0 && (
          <div className="pill pill-pos" style={{ alignSelf: "flex-start" }}>Yields ≈ {FT.fmt((+balance) * (+rate) / 100 / 12, currency)}/mo · {FT.fmt((+balance) * (+rate) / 100, currency)}/yr</div>
        )}
        <div className="field"><label className="label">Colour</label>
          <div style={{ display: "flex", gap: 8 }}>{palette.map(c => <button key={c} onClick={() => setColor(c)} style={{ width: 30, height: 30, borderRadius: 8, background: c, border: color === c ? "2px solid var(--text)" : "2px solid transparent", cursor: "pointer" }} />)}</div>
        </div>
      </div>
    </Modal>
  );
}

function GoalModal({ state, onClose, onSave, editing }) {
  const [name, setName] = useState(editing ? editing.name : "");
  const [target, setTarget] = useState(editing ? String(editing.target) : "");
  const [saved, setSaved] = useState(editing ? String(editing.saved) : "0");
  const [emoji, setEmoji] = useState(editing ? editing.emoji : "🎯");
  const emojis = ["🎯","🛟","🏖️","💻","🏠","🚗","💍","🎓","✈️","👶","📷","🪙"];
  return (
    <Modal title={editing ? "Edit goal" : "New savings goal"} onClose={onClose}
      foot={<>
        {editing && <button className="btn btn-ghost" style={{ color: "var(--neg)", marginRight: "auto" }} onClick={() => onSave(null, editing.id)}><Icon name="trash" size={15} />Delete</button>}
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => { if (!name.trim() || !+target) return; onSave({ id: editing ? editing.id : FT.uid(), name: name.trim(), target: +target, saved: +saved || 0, emoji, color: editing ? editing.color : "var(--c2)" }); }}><Icon name="check" size={16} />Save goal</button>
      </>}>
      <div className="modal-body">
        <div className="field"><label className="label">Goal name</label><input className="input" placeholder="e.g. Emergency Fund" value={name} onChange={e => setName(e.target.value)} autoFocus /></div>
        <div className="field"><label className="label">Icon</label><div className="chips">{emojis.map(e => <button key={e} className={"chip" + (emoji === e ? " sel" : "")} style={{ fontSize: 18, padding: "7px 11px" }} onClick={() => setEmoji(e)}>{e}</button>)}</div></div>
        <div className="row" style={{ gap: 14 }}>
          <div className="field" style={{ flex: 1 }}><label className="label">Target amount</label><input className="input num" type="number" placeholder="0" value={target} onChange={e => setTarget(e.target.value)} /></div>
          <div className="field" style={{ flex: 1 }}><label className="label">Saved so far</label><input className="input num" type="number" placeholder="0" value={saved} onChange={e => setSaved(e.target.value)} /></div>
        </div>
      </div>
    </Modal>
  );
}

function NetWorth({ state, actions }) {
  const cur = state.displayCurrency;
  const nw = Compute.netWorth(state);
  const series = Compute.netWorthSeries(state);
  const [editAcc, setEditAcc] = useState(null);
  const [addAcc, setAddAcc] = useState(false);
  const [editGoal, setEditGoal] = useState(null);
  const [addGoal, setAddGoal] = useState(false);

  const assets = state.accounts.filter(a => FT.acctType(a.type).asset && a.balance > 0);
  const liabilities = state.accounts.filter(a => !FT.acctType(a.type).asset && a.balance > 0);
  const alloc = assets.map(a => ({ label: a.name, value: Compute.aBal(a, state), color: a.color })).sort((x, y) => y.value - x.value);

  function AcctList({ items }) {
    const total = items.reduce((s, a) => s + Compute.aBal(a, state), 0) || 1;
    return (
      <table className="ltable">
        <thead><tr><th>Account</th><th style={{ width: 110 }}>Type</th><th style={{ width: 140 }}>Share</th><th style={{ width: 130, textAlign: "right" }}>Balance</th></tr></thead>
        <tbody>
          {items.map(a => {
            const t = FT.acctType(a.type);
            const matDays = FT.fdMaturityDays(a);
            const share = Math.round(Compute.aBal(a, state) / total * 100);
            return (
              <tr key={a.id} style={{ cursor: "pointer" }} onClick={() => setEditAcc(a)}>
                <td style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 0 }}>
                  <span className="lt-dot" style={{ background: a.color }}></span>
                  <span style={{ fontWeight: 650 }}>{a.name}</span>
                  {a.currency && a.currency !== cur && <span className="lt-mut" style={{ fontSize: 11, marginLeft: 6 }}>{a.currency}</span>}
                </td>
                <td className="lt-mut" style={{ whiteSpace: "nowrap" }}>{t.name}{t.yields && a.rate ? " · " + a.rate + "%" : ""}{matDays != null ? (matDays > 0 ? " · " + (matDays > 60 ? Math.round(matDays / 30) + "mo" : matDays + "d") : " · matured") : ""}</td>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <div style={{ flex: 1, height: 8, background: "var(--surface-2)", borderRadius: 3 }}><div style={{ width: share + "%", height: 8, background: "var(--accent)", borderRadius: 3, opacity: .75 }}></div></div>
                    <span className="lt-mut num" style={{ fontSize: 11, width: 30, textAlign: "right" }}>{share}%</span>
                  </div>
                </td>
                <td className="lt-amt" style={{ fontWeight: 650, color: t.asset ? "var(--text)" : "var(--neg)" }}>{t.asset ? "" : "−"}{FT.fmt(a.balance, a.currency || "INR", { decimals: true })}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  // passive income from yielding assets (FD/bond/real-estate) + rental income txns
  const annualYield = state.accounts.reduce((s, a) => s + (FT.acctType(a.type).yields && a.rate ? Compute.conv((a.balance||0)*a.rate/100, a.currency||"INR", state) : 0), 0);

  return (
    <div className="grid" style={{ gap: 18 }}>
      {/* hero */}
      <div className="grid" style={{ gridTemplateColumns: "1.6fr 1fr" }}>
        <div className="card card-pad fade-in">
          <div className="card-h">
            <div><div className="card-title" style={{ whiteSpace: "nowrap" }}>Net worth trend</div><div className="card-sub">Last 12 months</div></div>
            <div className="display num" style={{ fontSize: 24, flexShrink: 0 }}>{FT.fmt(nw.net, cur)}</div>
          </div>
          <LineChart points={series} currency={cur} height={240} color="var(--accent)"
            fmtX={(p) => p.label} fmtY={(v) => FT.fmtShort(v, cur)} />
        </div>
        <div className="grid" style={{ gap: 18, alignContent: "start" }}>
          <div className="card card-pad fade-in" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="card-title">Composition</div>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <Donut data={alloc} size={130} thickness={18} center={<div><div style={{ fontSize: 10.5, color: "var(--text-3)", fontWeight: 700 }}>Assets</div><div className="display" style={{ fontSize: 15, fontWeight: 600 }}>{FT.fmtShort(nw.assets, cur)}</div></div>} />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>
                {alloc.slice(0, 6).map(a => (
                  <div key={a.label} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12 }}>
                    <span className="cat-dot" style={{ background: a.color }}></span>
                    <span style={{ fontWeight: 700, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.label}</span>
                    <span className="num" style={{ color: "var(--text-3)", fontWeight: 700 }}>{Math.round(a.value / nw.assets * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1, background: "var(--pos-soft)", borderRadius: 12, padding: "11px 13px" }}><div style={{ fontSize: 11.5, color: "var(--text-2)", fontWeight: 700 }}>Assets</div><div className="num display" style={{ fontSize: 17, color: "var(--pos)" }}>{FT.fmtShort(nw.assets, cur)}</div></div>
              <div style={{ flex: 1, background: "var(--neg-soft)", borderRadius: 12, padding: "11px 13px" }}><div style={{ fontSize: 11.5, color: "var(--text-2)", fontWeight: 700 }}>Liabilities</div><div className="num display" style={{ fontSize: 17, color: "var(--neg)" }}>{FT.fmtShort(nw.liabilities, cur)}</div></div>
            </div>
          </div>
        </div>
      </div>

      {/* accounts + goals */}
      <div className="grid" style={{ gridTemplateColumns: "1.4fr 1fr" }}>
        <div className="card card-pad fade-in">
          <div className="card-h"><div className="card-title">Accounts</div>{annualYield > 0 && <span className="pill pill-pos" style={{ marginLeft: "auto", marginRight: 8 }}>+{FT.fmtShort(annualYield, cur)}/yr passive</span>}<button className="btn btn-sm btn-primary" onClick={() => setAddAcc(true)}><Icon name="plus" size={15} />Add account</button></div>
          {assets.length > 0 && <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text-3)", letterSpacing: ".08em", textTransform: "uppercase", margin: "4px 0" }}>Assets</div>}
          <AcctList items={assets} />
          {liabilities.length > 0 && <>
            <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text-3)", letterSpacing: ".08em", textTransform: "uppercase", margin: "14px 0 4px" }}>Liabilities</div>
            <AcctList items={liabilities} />
          </>}
        </div>
        <div className="card card-pad fade-in">
          <div className="card-h"><div className="card-title">Savings goals</div><button className="btn btn-sm" onClick={() => setAddGoal(true)}><Icon name="plus" size={15} />New goal</button></div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {state.goals.map(g => {
              const pct = Math.min(100, (g.saved / g.target) * 100);
              return (
                <div key={g.id} style={{ cursor: "pointer" }} onClick={() => setEditGoal(g)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 7 }}>
                    <span style={{ fontSize: 18 }}>{g.emoji}</span>
                    <span style={{ fontWeight: 700, fontSize: 13.5, flex: 1 }}>{g.name}</span>
                    <span className="num" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-2)" }}>{FT.fmtShort(g.saved, cur)} / {FT.fmtShort(g.target, cur)}</span>
                  </div>
                  <div className="bar-track"><div className="bar-fill" style={{ width: pct + "%", background: pct >= 100 ? "var(--pos)" : g.color }}></div></div>
                </div>
              );
            })}
            {!state.goals.length && <div className="empty" style={{ padding: "20px 0" }}>No goals yet</div>}
          </div>
        </div>
      </div>

      {(addAcc || editAcc) && <AccountModal state={state} editing={editAcc} onClose={() => { setAddAcc(false); setEditAcc(null); }} onSave={(a, delId) => { if (delId) actions.deleteAccount(delId); else if (editAcc) actions.updateAccount(a); else actions.addAccount(a); setAddAcc(false); setEditAcc(null); }} />}
      {(addGoal || editGoal) && <GoalModal state={state} editing={editGoal} onClose={() => { setAddGoal(false); setEditGoal(null); }} onSave={(g, delId) => { if (delId) actions.deleteGoal(delId); else if (editGoal) actions.updateGoal(g); else actions.addGoal(g); setAddGoal(false); setEditGoal(null); }} />}
    </div>
  );
}

Object.assign(window, { NetWorth, AccountModal, GoalModal });
