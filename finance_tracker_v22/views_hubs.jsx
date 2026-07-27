/* ============================================================
   views_hubs.jsx — consolidated tab "hub" views.
   These compose the existing, proven view components into the
   7-tab structure (Money / Accounts / Loans / Grow) without
   rewriting their internals.
   ============================================================ */

function HubSection({ title, sub, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 20 }}>
      <button onClick={() => setOpen(!open)} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "none", border: "none", padding: "0 0 10px", cursor: "pointer", textAlign: "left" }}>
        <Icon name={open ? "chevronDown" : "chevronRight"} size={15} style={{ color: "var(--text-3)" }} />
        <span style={{ fontWeight: 700, fontSize: 15 }}>{title}</span>
        {sub && <span style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 600 }}>{sub}</span>}
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

/* MONEY: transactions ledger + review inbox + import + analyze/pivot */
function MoneyHub({ state, actions }) {
  const pending = (state.pending || []).length;
  return (
    <div className="fade-in">
      {pending > 0 && (
        <HubSection title={"Review inbox · " + pending} sub="confirm auto-imported items">
          <ReviewInbox state={state} actions={actions} />
        </HubSection>
      )}
      <Transactions state={state} actions={actions} />
      <div style={{ height: 24 }} />
      <HubSection title="Analyze" sub="slice your spending" defaultOpen={false}>
        <PivotExplorer state={state} />
      </HubSection>
      <HubSection title="Import" sub="files, statements & email" defaultOpen={false}>
        <ImportView state={state} actions={actions} />
      </HubSection>
    </div>
  );
}

/* ACCOUNTS: bank/cash accounts + net worth (cards & loans have own tabs) */
function AccountsHub({ state, actions }) {
  return (
    <div className="fade-in">
      <NetWorth state={state} actions={actions} />
    </div>
  );
}

/* Add / edit / delete a single loan. Mirrors AccountModal. Saving routes to
   actions.addLoan / updateLoan / deleteLoan, which patch state.loans — and
   because net worth, debt metrics, the payoff plan and the AI contexts all read
   state.loans through selectors, they update automatically. */
function LoanModal({ state, onClose, onSave, editing }) {
  const TYPES = [["home", "🏠 Home"], ["car", "🚗 Car"], ["personal", "💵 Personal"], ["education", "🎓 Education"], ["other", "📦 Other"]];
  const [name, setName] = useState(editing ? editing.name : "");
  const [type, setType] = useState(editing ? editing.type : "home");
  const [outstanding, setOutstanding] = useState(editing && editing.outstanding != null ? String(editing.outstanding) : "");
  const [rate, setRate] = useState(editing && editing.rate != null ? String(editing.rate) : "");
  const [emi, setEmi] = useState(editing && editing.emi != null ? String(editing.emi) : "");
  const [emiDay, setEmiDay] = useState(editing && editing.emiDay != null ? String(editing.emiDay) : "5");
  const [currency, setCurrency] = useState(editing ? (editing.currency || "INR") : "INR");
  return (
    <Modal title={editing ? "Edit loan" : "Add loan"} onClose={onClose}
      foot={<>
        {editing && <button className="btn btn-ghost" style={{ color: "var(--neg)", marginRight: "auto" }} onClick={() => onSave(null, editing.id)}><Icon name="trash" size={15} />Delete</button>}
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => {
          if (!name.trim()) return;
          onSave({
            id: editing ? editing.id : "loan_" + FT.uid(),
            name: name.trim(), type,
            outstanding: +outstanding || 0,
            rate: +rate || 0,
            emi: +emi || 0,
            emiDay: Math.min(28, Math.max(1, +emiDay || 5)),
            currency,
          });
        }}><Icon name="check" size={16} />Save</button>
      </>}>
      <div className="modal-body">
        <div className="field"><label className="label">Loan name</label><input className="input" placeholder="e.g. SBI Home Loan" value={name} onChange={e => setName(e.target.value)} autoFocus /></div>
        <div className="field"><label className="label">Type</label>
          <div className="chips">{TYPES.map(([v, lbl]) => <button key={v} className={"chip" + (type === v ? " sel" : "")} onClick={() => setType(v)}>{lbl}</button>)}</div>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 2 }}><label className="label">Outstanding <span style={{ color: "var(--neg)", fontWeight: 600 }}>(owed)</span></label><input className="input num" type="number" placeholder="0" value={outstanding} onChange={e => setOutstanding(e.target.value)} /></div>
          <div className="field" style={{ flex: 1 }}><label className="label">Currency</label><select className="select" value={currency} onChange={e => setCurrency(e.target.value)}>{Object.keys(FT.CUR).map(c => <option key={c} value={c}>{FT.symOf(c)} {c}</option>)}</select></div>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 1 }}><label className="label">Interest rate (% p.a.)</label><input className="input num" type="number" step="0.1" placeholder="e.g. 8.5" value={rate} onChange={e => setRate(e.target.value)} /></div>
          <div className="field" style={{ flex: 1 }}><label className="label">Monthly EMI</label><input className="input num" type="number" placeholder="0" value={emi} onChange={e => setEmi(e.target.value)} /></div>
          <div className="field" style={{ flex: 0.7 }}><label className="label">EMI day</label><input className="input num" type="number" min="1" max="28" placeholder="5" value={emiDay} onChange={e => setEmiDay(e.target.value)} /></div>
        </div>
        {+outstanding > 0 && +rate > 0 && (
          <div className="pill" style={{ alignSelf: "flex-start" }}>Interest ≈ {FT.fmt((+outstanding) * (+rate) / 100 / 12, currency)}/mo</div>
        )}
      </div>
    </Modal>
  );
}

/* LOANS: debt KPIs + an editable loan list (add / edit / delete) */
function LoansHub({ state, actions }) {
  const cur = state.displayCurrency;
  const dm = useMemo(() => window.debtMetrics ? window.debtMetrics(state) : null, [state]);
  const [add, setAdd] = useState(false);
  const [edit, setEdit] = useState(null);
  const loans = state.loans || [];
  const TYPE_EMOJI = { home: "🏠", car: "🚗", personal: "💵", education: "🎓", other: "📦" };
  return (
    <div className="fade-in grid" style={{ gap: 18 }}>
      {dm && (
        <div className="grid kpi-row" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 700 }}>Total debt</span>
            <span className="num" style={{ fontSize: 22, fontWeight: 700 }}>{FT.fmt(dm.totalDebt, cur)}</span>
            <span style={{ fontSize: 11.5, color: "var(--text-3)", fontWeight: 600 }}>{dm.loanCount} loan{dm.loanCount !== 1 ? "s" : ""}{dm.cardDebt > 0 ? " · " + FT.fmtShort(dm.cardDebt, cur) + " on cards" : ""}</span>
          </div>
          <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 700 }}>Interest bleed</span>
            <span className="num" style={{ fontSize: 22, fontWeight: 700, color: dm.monthlyInterest > 0 ? "var(--neg)" : "var(--text)" }}>{FT.fmt(dm.monthlyInterest, cur)}/mo</span>
            <span style={{ fontSize: 11.5, color: "var(--text-3)", fontWeight: 600 }}>{dm.missing ? dm.missing + " loan(s) missing a rate" : "what your debt costs you"}</span>
          </div>
          <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 700 }}>Debt-free by</span>
            <span className="num" style={{ fontSize: 22, fontWeight: 700 }}>{dm.totalDebt <= 0 ? "Debt-free ✓" : dm.freeBy || "—"}</span>
            <span style={{ fontSize: 11.5, color: "var(--text-3)", fontWeight: 600 }}>{dm.totalDebt <= 0 ? "use leverage wisely" : dm.freeBy ? "at current EMIs" : "add loan rates & EMIs"}</span>
          </div>
        </div>
      )}

      <div className="card card-pad">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Your loans</span>
          <button className="btn btn-sm btn-primary" onClick={() => setAdd(true)}><Icon name="plus" size={15} />Add loan</button>
        </div>
        {loans.length === 0 ? (
          <div className="empty" style={{ padding: "24px 0" }}>No loans yet. Add one to track it in your net worth and payoff plan.</div>
        ) : (
          <div>
            {loans.map((l, i) => {
              const out = Compute.conv(l.outstanding || 0, l.currency || "INR", state);
              return (
                <button key={l.id} onClick={() => setEdit(l)} title="Edit loan"
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, width: "100%", padding: "11px 4px", background: "none", border: "none", borderTop: i ? "1px solid var(--border)" : "none", cursor: "pointer", textAlign: "left" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <span style={{ fontSize: 18 }}>{TYPE_EMOJI[l.type] || "📦"}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.name || (l.type + " loan")}</div>
                      <div style={{ fontSize: 11.5, color: "var(--text-3)", fontWeight: 600 }}>{l.rate ? l.rate + "% · " : "no rate · "}{l.emi ? "EMI " + FT.fmtShort(Compute.conv(l.emi, l.currency || "INR", state), cur) + "/mo" : "no EMI set"}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="num" style={{ fontWeight: 700, fontSize: 14, color: "var(--neg)" }}>{FT.fmt(out, cur)}</span>
                    <Icon name="chevronRight" size={15} style={{ color: "var(--text-3)" }} />
                  </div>
                </button>
              );
            })}
          </div>
        )}
        <div style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 600, marginTop: 12 }}>Edits here update your net worth and payoff plan automatically. Your payoff strategy lives in Grow.</div>
      </div>

      {(add || edit) && <LoanModal state={state} editing={edit}
        onClose={() => { setAdd(false); setEdit(null); }}
        onSave={(l, delId) => { if (delId) actions.deleteLoan(delId); else if (edit) actions.updateLoan(l); else actions.addLoan(l); setAdd(false); setEdit(null); }} />}
    </div>
  );
}

/* GROW: quarterly plan + leverage + the financial critic */
function GrowHub({ state, actions, openProfile }) {
  return (
    <div className="fade-in grid" style={{ gap: 22 }}>
      <Investments state={state} actions={actions} openProfile={openProfile} />
      <HubSection title="Wealth without new money" sub="leverage what you have">
        <LeverageProgram state={state} actions={actions} />
      </HubSection>
    </div>
  );
}

Object.assign(window, { MoneyHub, AccountsHub, LoansHub, LoanModal, GrowHub, HubSection });
