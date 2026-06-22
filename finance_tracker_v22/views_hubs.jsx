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

/* LOANS: debt tracker + loan list (pulled from the investments debt view) */
function LoansHub({ state, actions }) {
  const cur = state.displayCurrency;
  const dm = useMemo(() => window.debtMetrics ? window.debtMetrics(state) : null, [state]);
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
      <div style={{ fontSize: 13, color: "var(--text-3)", fontWeight: 600, textAlign: "center", padding: "8px 0" }}>
        Manage individual loans in the Accounts tab (added as liability accounts). Your payoff plan lives in Grow.
      </div>
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

Object.assign(window, { MoneyHub, AccountsHub, LoansHub, GrowHub, HubSection });
