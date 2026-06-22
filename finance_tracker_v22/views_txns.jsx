/* ============================================================
   views_txns.jsx — transactions ledger + add/edit modal + budgets
   ============================================================ */
function FixUncategorized({ state, actions, onClose }) {
  const cur = state.displayCurrency;
  const uncats = state.transactions.filter(t => t.category === "uncat" && t.type === "expense");
  const [rows, setRows] = useState(uncats.map(t => ({ id: t.id, merchant: t.merchant, category: "", makeRule: false, raw: t.merchant, amount: t.amount, currency: t.currency, date: t.date })));
  const upd = (id, k, v) => setRows(rows.map(r => r.id === id ? { ...r, [k]: v } : r));
  function saveAll() {
    rows.forEach(r => {
      if (!r.category && r.merchant === r.raw) return; // untouched
      actions.categorizeTxn(r.id, { merchant: r.merchant, category: r.category || "misc", makeRule: r.makeRule, matchKey: r.makeRule ? r.raw : null });
    });
    onClose();
  }
  return (
    <Modal title={`Needs a label · ${uncats.length}`} onClose={onClose} wide
      foot={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={saveAll}><Icon name="check" size={15} />Save all</button></>}>
      <div className="modal-body" style={{ gap: 0 }}>
        <div style={{ fontSize: 12.5, color: "var(--text-2)", marginBottom: 10 }}>These are mostly UPI payments to shops and autos with no clear merchant. Name and categorize them; tick "rule" to auto-label the same payee forever.</div>
        <div style={{ display: "grid", gridTemplateColumns: "76px 1fr 1fr 110px 44px", gap: 8, padding: "5px 0", fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--text-3)", borderBottom: "1px solid var(--border-soft)" }}>
          <span>Date</span><span>Raw / VPA</span><span>Name it</span><span>Category</span><span title="Remember as a rule">Rule</span>
        </div>
        {rows.map(r => (
          <div key={r.id} style={{ display: "grid", gridTemplateColumns: "76px 1fr 1fr 110px 44px", gap: 8, alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--border-soft)" }}>
            <span className="lt-mut" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{new Date(r.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</span>
            <span style={{ fontSize: 12, color: "var(--text-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={r.raw}>{r.raw}</span>
            <input className="input" style={{ padding: "5px 8px", fontSize: 12.5 }} placeholder="e.g. Auto" value={r.merchant} onChange={e => upd(r.id, "merchant", e.target.value)} />
            <select className="select" style={{ padding: "5px 6px", fontSize: 12 }} value={r.category} onChange={e => upd(r.id, "category", e.target.value)}>
              <option value="">Pick…</option>
              {FT.EXPENSE_CATS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button onClick={() => upd(r.id, "makeRule", !r.makeRule)} title="Remember as a rule" style={{ width: 22, height: 22, justifySelf: "center", borderRadius: 5, border: "2px solid " + (r.makeRule ? "var(--accent)" : "var(--border)"), background: r.makeRule ? "var(--accent)" : "transparent", display: "grid", placeItems: "center" }}>{r.makeRule && <Icon name="check" size={11} style={{ color: "#fff" }} />}</button>
          </div>
        ))}
        {!uncats.length && <div className="empty" style={{ padding: 24 }}>Nothing to label — everything's categorized.</div>}
      </div>
    </Modal>
  );
}

function AddTxnModal({ state, onClose, onSave, editing, onDelete }) {
  const [confirmDel, setConfirmDel] = useState(false);
  const cur = state.displayCurrency;
  const [type, setType] = useState(editing ? editing.type : "expense");
  const [amount, setAmount] = useState(editing ? String(editing.amount) : "");
  const [merchant, setMerchant] = useState(editing ? editing.merchant : "");
  const [category, setCategory] = useState(editing ? editing.category : "food");
  const [account, setAccount] = useState(editing ? editing.account : (state.accounts[0] && state.accounts[0].id) || "");
  const [toAccount, setToAccount] = useState(editing ? (editing.toAccount || "") : ((state.accounts[1] && state.accounts[1].id) || ""));
  const [date, setDate] = useState(editing ? editing.date : FT.todayISO());
  const [note, setNote] = useState(editing ? editing.note : "");
  const [currency, setCurrency] = useState(editing ? (editing.currency || "INR") : "INR");
  const [split, setSplit] = useState(false);
  const [splitMode, setSplitMode] = useState("equal"); // equal | share
  const [people, setPeople] = useState(2);
  const [myShare, setMyShare] = useState("");
  const isXfer = type === "transfer";
  const changeType = (tp) => { setType(tp); if (tp !== "expense") setSplit(false); if (!editing && tp !== "transfer") setCurrency(tp === "income" ? "USD" : "INR"); };
  const cats = type === "income" ? FT.INCOME_CATS : FT.EXPENSE_CATS;
  const total = parseFloat(amount) || 0;
  const computedShare = split ? (splitMode === "equal" ? (people > 0 ? Math.round((total / people) * 100) / 100 : total) : (parseFloat(myShare) || 0)) : total;

  useEffect(() => { if (!isXfer && !cats.find(c => c.id === category)) setCategory(cats[0].id); }, [type]);

  function submit() {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return;
    if (split && type === "expense" && computedShare < amt) {
      onSave({
        __split: true,
        replaceId: editing ? editing.id : null,  // when editing, the original is replaced by the split
        total: Math.round(amt * 100) / 100,
        yourShare: Math.round(computedShare * 100) / 100,
        label: merchant.trim() || "Split expense",
        txn: { type: "expense", currency, merchant: merchant.trim() || "Split expense", category, account, date, note: note.trim(), source: editing ? editing.source : "manual" },
      });
      return;
    }
    onSave({
      id: editing ? editing.id : FT.uid(),
      type, amount: Math.round(amt * 100) / 100, currency,
      merchant: merchant.trim() || (isXfer ? "Transfer" : type === "income" ? "Income" : "Expense"),
      category: isXfer ? "transfer" : category,
      account, toAccount: isXfer ? toAccount : undefined,
      date, note: note.trim(),
      source: editing ? editing.source : "manual",
    });
  }

  return (
    <Modal title={editing ? "Edit transaction" : "Add transaction"} onClose={onClose}
      foot={<>
        {editing && onDelete && (
          <button className="btn btn-ghost" style={{ color: "var(--neg)", marginRight: "auto" }} onClick={() => { if (confirmDel) { onDelete(editing.id); } else setConfirmDel(true); }}>
            <Icon name="trash" size={15} />{confirmDel ? "Tap again to delete" : "Delete"}
          </button>
        )}
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={submit}><Icon name="check" size={16} />{editing ? "Save changes" : "Add transaction"}</button>
      </>}>
      <div className="modal-body">
        <div className="seg" style={{ width: "100%" }}>
          <button className={type === "expense" ? "on expense" : ""} style={{ flex: 1 }} onClick={() => changeType("expense")}>Expense</button>
          <button className={type === "income" ? "on income" : ""} style={{ flex: 1 }} onClick={() => changeType("income")}>Income</button>
          <button className={isXfer ? "on" : ""} style={{ flex: 1 }} onClick={() => changeType("transfer")}>Transfer</button>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div className="field" style={{ flex: 2 }}>
            <label className="label">Amount</label>
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--text-3)", fontWeight: 800, fontSize: 17 }}>{FT.symOf(currency)}</span>
              <input className="input num" style={{ paddingLeft: 32, fontSize: 20, fontWeight: 700, fontFamily: "var(--font-display)" }} type="number" inputMode="decimal" placeholder="0" value={amount} onChange={e => setAmount(e.target.value)} autoFocus />
            </div>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label className="label">Currency</label>
            <select className="select" value={currency} onChange={e => setCurrency(e.target.value)}>
              {Object.keys(FT.CUR).map(c => <option key={c} value={c}>{FT.symOf(c)} {c}</option>)}
            </select>
          </div>
        </div>
        {currency !== cur && amount > 0 && <div style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 600, marginTop: -6 }}>≈ {FT.fmt(Compute.conv(parseFloat(amount) || 0, currency, state), cur)} in {cur}</div>}
        {isXfer ? (
          <>
            <div className="row" style={{ gap: 14 }}>
              <div className="field" style={{ flex: 1 }}>
                <label className="label">From account</label>
                <select className="select" value={account} onChange={e => setAccount(e.target.value)}>
                  {state.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label className="label">To account / card</label>
                <select className="select" value={toAccount} onChange={e => setToAccount(e.target.value)}>
                  <option value="">— (external)</option>
                  <optgroup label="Accounts">{state.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>
                  {state.cards.length > 0 && <optgroup label="Credit cards">{FT.payTargets(state).filter(t => t.kind === "card").map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>}
                </select>
              </div>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 600, marginTop: -6 }}>Transfers move money between your own accounts — they don't count as income or expense.</div>
          </>
        ) : (
          <>
            <div className="field">
              <label className="label">{type === "income" ? "Source / payer" : "Merchant / payee"}</label>
              <input className="input" placeholder={type === "income" ? "e.g. Acme Corp Payroll" : "e.g. Swiggy"} value={merchant} onChange={e => setMerchant(e.target.value)} />
            </div>
            <div className="field">
              <label className="label">Category</label>
              <div className="chips">
                {cats.map(c => (
                  <button key={c.id} className={"chip" + (category === c.id ? " sel" : "")} onClick={() => setCategory(c.id)}>
                    <span className="cat-dot" style={{ background: c.color }}></span>{c.name}
                  </button>
                ))}
              </div>
            </div>
            {type === "expense" && (!editing || !editing.splitId) && (
              <div className="field">
                <label className="label" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={split} onChange={e => setSplit(e.target.checked)} style={{ width: 16, height: 16 }} />
                  Split this bill — you paid, friends owe you back
                </label>
                {split && (
                  <div style={{ background: "var(--bg-2)", borderRadius: "var(--radius-sm)", padding: 12, marginTop: 8, display: "flex", flexDirection: "column", gap: 10 }}>
                    <div className="seg" style={{ width: "100%" }}>
                      <button className={splitMode === "equal" ? "on" : ""} style={{ flex: 1 }} onClick={() => setSplitMode("equal")}>Split equally</button>
                      <button className={splitMode === "share" ? "on" : ""} style={{ flex: 1 }} onClick={() => setSplitMode("share")}>Enter my share</button>
                    </div>
                    {splitMode === "equal" ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 13, color: "var(--text-2)", fontWeight: 600 }}>Split between</span>
                        <input className="input num" style={{ width: 70, padding: "7px 9px" }} type="number" min="2" value={people} onChange={e => setPeople(Math.max(1, parseInt(e.target.value) || 1))} />
                        <span style={{ fontSize: 13, color: "var(--text-2)", fontWeight: 600 }}>people</span>
                      </div>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 13, color: "var(--text-2)", fontWeight: 600 }}>My share</span>
                        <input className="input num" style={{ width: 120, padding: "7px 9px" }} type="number" placeholder="0" value={myShare} onChange={e => setMyShare(e.target.value)} />
                      </div>
                    )}
                    <div style={{ fontSize: 12.5, color: "var(--text-3)", fontWeight: 600, lineHeight: 1.5 }}>
                      Your expense: <b style={{ color: "var(--text)" }}>{FT.fmt(computedShare, currency)}</b> · Owed back to you: <b style={{ color: "var(--pos)" }}>{FT.fmt(Math.max(0, total - computedShare), currency)}</b><br />
                      Full {FT.fmt(total, currency)} leaves your account now; repayments come back as you settle.
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
        <div className="row" style={{ gap: 14 }}>
          {!isXfer && (
            <div className="field" style={{ flex: 1 }}>
              <label className="label">{type === "income" ? "Deposited to" : "Paid from"}</label>
              <select className="select" value={account} onChange={e => setAccount(e.target.value)}>
                <optgroup label="Accounts">{state.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup>
                {state.cards.length > 0 && <optgroup label="Credit cards">{FT.payTargets(state).filter(t => t.kind === "card").map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>}
              </select>
            </div>
          )}
          <div className="field" style={{ flex: 1 }}>
            <label className="label">Date</label>
            <input className="input" type="date" value={date} max={FT.todayISO()} onChange={e => setDate(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label className="label">{isXfer ? "Note / description" : "Note"} <span style={{ color: "var(--text-3)", fontWeight: 500 }}>(optional)</span></label>
          <input className="input" placeholder={isXfer ? "e.g. Moved to ICICI savings" : "Add a note…"} value={isXfer ? merchant : note} onChange={e => isXfer ? setMerchant(e.target.value) : setNote(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

function BudgetModal({ state, onClose, onSave }) {
  const cur = state.displayCurrency;
  const [budgets, setBudgets] = useState(() => {
    const map = {}; state.budgets.forEach(b => map[b.cat] = b.limit); return map;
  });
  return (
    <Modal title="Monthly budgets" onClose={onClose}
      foot={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => onSave(Object.entries(budgets).filter(([, v]) => v > 0).map(([cat, limit]) => ({ cat, limit: +limit })))}><Icon name="check" size={16} />Save budgets</button>
      </>}>
      <div className="modal-body" style={{ gap: 12 }}>
        <div style={{ fontSize: 13, color: "var(--text-3)", fontWeight: 600 }}>Set a monthly spending cap per category. Leave at 0 to remove.</div>
        {FT.EXPENSE_CATS.map(c => (
          <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 150, fontWeight: 700, fontSize: 13.5, display: "flex", alignItems: "center", gap: 8 }}><span className="cat-dot" style={{ background: c.color }}></span>{c.name}</span>
            <input className="input num" type="number" placeholder="0" value={budgets[c.id] || ""} onChange={e => setBudgets({ ...budgets, [c.id]: e.target.value })} />
          </div>
        ))}
      </div>
    </Modal>
  );
}

function Transactions({ state, actions }) {
  const cur = state.displayCurrency;
  const [q, setQ] = useState("");
  const [typeF, setTypeF] = useState("all");
  const [catF, setCatF] = useState("all");
  const [monthF, setMonthF] = useState(() => {
    const cm = new Date().toISOString().slice(0, 7);
    return (state.transactions || []).some(t => t.date.slice(0, 7) === cm) ? cm : "all";
  });
  const [editing, setEditing] = useState(null);
  const [showBudget, setShowBudget] = useState(false);
  const [showFix, setShowFix] = useState(false);
  const uncatCount = state.transactions.filter(t => t.category === "uncat").length;

  const months = useMemo(() => {
    const set = new Set(state.transactions.map(t => t.date.slice(0, 7)));
    return [...set].sort().reverse();
  }, [state.transactions]);

  const filtered = state.transactions.filter(t => {
    if (typeF !== "all" && t.type !== typeF) return false;
    if (catF !== "all" && t.category !== catF) return false;
    if (monthF !== "all" && t.date.slice(0, 7) !== monthF) return false;
    if (q && !(t.merchant.toLowerCase().includes(q.toLowerCase()) || FT.catOf(t.category).name.toLowerCase().includes(q.toLowerCase()) || (t.note || "").toLowerCase().includes(q.toLowerCase()))) return false;
    return true;
  });
  const totalIn = filtered.filter(t => t.type === "income").reduce((s, t) => s + Compute.tAmt(t, state), 0);
  const totalOut = filtered.filter(t => t.type === "expense").reduce((s, t) => s + Compute.tAmt(t, state), 0);
  const allCats = [...FT.EXPENSE_CATS, ...FT.INCOME_CATS];
  const [dense, setDense] = useState(true);

  // group by month, newest first; rows already date-sorted desc
  const monthGroups = useMemo(() => {
    const map = new Map();
    filtered.forEach(t => {
      const m = t.date.slice(0, 7);
      if (!map.has(m)) map.set(m, []);
      map.get(m).push(t);
    });
    return [...map.entries()];
  }, [filtered]);
  const acctName = (id) => FT.payTargetName(id, state);
  const amt2 = (t) => FT.fmt(t.amount, t.currency || "INR", { decimals: true });

  return (
    <div className="grid" style={{ gap: 18 }}>
      {/* summary */}
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
        <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12.5, color: "var(--text-2)", fontWeight: 700 }}>Money in</span>
          <span className="num" style={{ fontSize: 22, fontWeight: 700, color: "var(--pos)" }}>{FT.fmt(totalIn, cur)}</span>
        </div>
        <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12.5, color: "var(--text-2)", fontWeight: 700 }}>Money out</span>
          <span className="num" style={{ fontSize: 22, fontWeight: 700 }}>{FT.fmt(totalOut, cur)}</span>
        </div>
        <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12.5, color: "var(--text-2)", fontWeight: 700 }}>Net · {filtered.length} records</span>
          <span className="num" style={{ fontSize: 22, fontWeight: 700, color: totalIn - totalOut >= 0 ? "var(--pos)" : "var(--neg)" }}>{FT.fmt(totalIn - totalOut, cur, { plus: true })}</span>
        </div>
      </div>

      {/* filters */}
      <div className="card card-pad" style={{ padding: 14 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ position: "relative", flex: "1 1 220px" }}>
            <Icon name="search" size={16} style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: "var(--text-3)" }} />
            <input className="input" style={{ paddingLeft: 38 }} placeholder="Search merchant, note…" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <div className="seg">
            {["all", "expense", "income", "transfer"].map(t => <button key={t} className={typeF === t ? "on" : ""} onClick={() => setTypeF(t)}>{t === "all" ? "All" : t[0].toUpperCase() + t.slice(1)}</button>)}
          </div>
          <select className="select" style={{ width: "auto" }} value={catF} onChange={e => setCatF(e.target.value)}>
            <option value="all">All categories</option>
            {allCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div style={{ display: "flex", alignItems: "center", gap: 0, border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
            <button className="btn btn-icon btn-ghost" style={{ width: 30, height: 32, borderRadius: 0 }} title="Previous month" disabled={monthF === "all"} onClick={() => {
              const idx = months.indexOf(monthF); if (idx >= 0 && idx < months.length - 1) setMonthF(months[idx + 1]);
            }}><Icon name="chevronLeft" size={15} /></button>
            <select className="select" style={{ width: "auto", border: "none", borderRadius: 0, minWidth: 130 }} value={monthF} onChange={e => setMonthF(e.target.value)}>
              <option value="all">All months</option>
              {months.map(m => <option key={m} value={m}>{new Date(m + "-01").toLocaleDateString("en-US", { month: "long", year: "numeric" })}</option>)}
            </select>
            <button className="btn btn-icon btn-ghost" style={{ width: 30, height: 32, borderRadius: 0 }} title="Next month" disabled={monthF === "all"} onClick={() => {
              const idx = months.indexOf(monthF); if (idx > 0) setMonthF(months[idx - 1]);
            }}><Icon name="chevronRight" size={15} /></button>
          </div>
          {uncatCount > 0 && <button className="btn btn-sm" onClick={() => setShowFix(true)} style={{ marginLeft: "auto", color: "var(--warn)" }}><Icon name="wand" size={15} />Fix {uncatCount} uncategorized</button>}
          <button className="btn btn-sm" onClick={() => setShowBudget(true)} style={{ marginLeft: uncatCount > 0 ? 0 : "auto" }}><Icon name="target" size={15} />Budgets</button>
        </div>
      </div>

      {/* ledger */}
      <div className="lt-wrap fade-in" style={{ background: "var(--surface)" }}>
        {monthGroups.length ? (
          <table className={"ltable" + (dense ? "" : " comfy")}>
            <thead>
              <tr>
                <th style={{ width: 76 }}>Date</th>
                <th>Description</th>
                <th style={{ width: 130 }}>Category</th>
                <th style={{ width: 130 }}>Account</th>
                <th style={{ width: 130, textAlign: "right" }}>Amount</th>
                <th style={{ width: 34 }}></th>
              </tr>
            </thead>
            <tbody>
              {monthGroups.map(([m, items]) => {
                const sub = items.filter(t => t.type === "income").reduce((s, t) => s + Compute.tAmt(t, state), 0)
                          - items.filter(t => t.type === "expense").reduce((s, t) => s + Compute.tAmt(t, state), 0);
                return (
                  <React.Fragment key={m}>
                    <tr className="lt-group">
                      <td colSpan={4}>{new Date(m + "-01").toLocaleDateString("en-US", { month: "long", year: "numeric" })}</td>
                      <td className="lt-amt">{FT.fmt(sub, cur, { plus: true })}</td>
                      <td></td>
                    </tr>
                    {items.map(t => {
                      const c = FT.catOf(t.category);
                      const isXfer = t.type === "transfer", isInc = t.type === "income";
                      return (
                        <tr key={t.id} className="txn-wrap" style={{ cursor: "pointer" }} onClick={() => setEditing(t)}>
                          <td className="lt-mut" style={{ whiteSpace: "nowrap" }}>{new Date(t.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</td>
                          <td style={{ maxWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            <span style={{ fontWeight: 650, color: isXfer ? "var(--text-2)" : "var(--text)" }}>{t.merchant}</span>
                            {t.source === "email" || t.source === "gmail" ? <span className="lt-mut" style={{ fontSize: 11, marginLeft: 6 }}>· email</span> : null}
                          </td>
                          <td className="lt-mut">{isXfer ? "Transfer" : <><span className="lt-dot" style={{ background: c.color }}></span>{c.name}</>}</td>
                          <td className="lt-mut" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 0 }}>{isXfer && t.toAccount ? acctName(t.account) + " → " + acctName(t.toAccount) : acctName(t.account)}</td>
                          <td className="lt-amt" style={{ color: isXfer ? "var(--text-3)" : isInc ? "var(--pos)" : "var(--text)", fontWeight: isInc ? 700 : 500 }}>
                            {isXfer ? "" : isInc ? "+" : "−"}{amt2(t)}
                          </td>
                          <td style={{ textAlign: "center" }}>
                            <button className="btn btn-icon btn-ghost del-btn" style={{ opacity: 0, width: 24, height: 24 }} onClick={(e) => { e.stopPropagation(); actions.deleteTxn(t.id); }}><Icon name="trash" size={13} /></button>
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        ) : <div className="empty" style={{ padding: 30 }}><Icon name="list" /><div style={{ fontWeight: 700, color: "var(--text-2)" }}>No transactions match</div><div style={{ fontSize: 13 }}>Try adjusting your filters.</div></div>}
        <div style={{ display: "flex", alignItems: "center", padding: "8px 12px", fontSize: 12, color: "var(--text-3)", fontWeight: 600 }}>
          <span>{filtered.length} of {state.transactions.length} transactions</span>
          <div className="seg" style={{ marginLeft: "auto", padding: 2 }}>
            <button className={dense ? "on" : ""} style={{ padding: "4px 12px", fontSize: 12 }} onClick={() => setDense(true)}>Compact</button>
            <button className={!dense ? "on" : ""} style={{ padding: "4px 12px", fontSize: 12 }} onClick={() => setDense(false)}>Comfortable</button>
          </div>
        </div>
      </div>

      {editing && <AddTxnModal state={state} editing={editing} onClose={() => setEditing(null)} onSave={(t) => { if (t && t.__split) actions.addSplitExpense(t); else actions.updateTxn(t); setEditing(null); }} onDelete={(id) => { actions.deleteTxn(id); setEditing(null); }} />}
      {showBudget && <BudgetModal state={state} onClose={() => setShowBudget(false)} onSave={(b) => { actions.setBudgets(b); setShowBudget(false); }} />}
      {showFix && <FixUncategorized state={state} actions={actions} onClose={() => setShowFix(false)} />}
    </div>
  );
}

Object.assign(window, { Transactions, AddTxnModal, BudgetModal });
