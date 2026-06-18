/* ============================================================
   views_onboarding.jsx — first-run setup wizard.
   Shown when state.onboarded !== true. Writes profile, accounts,
   cards, loans. Re-launchable from Settings ("Edit my setup").
   ============================================================ */
function Onboarding({ state, actions, onDone, editMode }) {
  const startStep = editMode ? 1 : 0;
  const [step, setStep] = useState(startStep);
  const [hadData] = useState(() => (state.transactions.length + state.accounts.length) > 0 && !state.onboarded);

  // working copies
  const [profile, setProfile] = useState(() => ({ ...state.profile }));
  const [accounts, setAccounts] = useState(() => state.accounts.filter(a => a.type === "bank" || a.type === "cash"));
  const [assets, setAssets] = useState(() => state.accounts.filter(a => ["invest","realestate","crypto","retire","other"].includes(a.type)));
  const [cards, setCards] = useState(() => [...state.cards]);
  const [loans, setLoans] = useState(() => [...state.loans]);

  const cur = state.displayCurrency;
  const STEPS = ["Welcome", "About you", "Bank accounts", "Credit cards", "Investments & assets", "Loans", "Done"];

  function finish() {
    actions.commitOnboarding({
      profile,
      accounts: [...accounts, ...assets],
      cards, loans,
    });
    onDone && onDone();
  }
  function startFresh() {
    actions.wipeAll();
    setProfile({ ...FT.defaultState().profile });
    setAccounts([]); setAssets([]); setCards([]); setLoans([]);
    setStep(1);
  }

  const next = () => setStep(s => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep(s => Math.max(s - 1, editMode ? 1 : 0));

  return (
    <div style={{ height: "100vh", maxHeight: "100vh", overflow: "hidden", background: "radial-gradient(1100px 540px at 50% -10%, var(--accent-soft), transparent 60%), var(--bg)", display: "flex", flexDirection: "column" }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "20px 26px", maxWidth: 760, margin: "0 auto", width: "100%" }}>
        <div className="brand-mark" style={{ width: 34, height: 34 }}><Icon name="wallet" size={18} style={{ color: "#fff" }} /></div>
        <div className="brand-name" style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 16 }}>Finance Tracker</div>
        {editMode && <button className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }} onClick={onDone}><Icon name="x" size={15} />Close</button>}
      </div>

      {/* progress */}
      {step > 0 && (
        <div style={{ maxWidth: 760, margin: "0 auto 6px", width: "100%", padding: "0 26px" }}>
          <div style={{ display: "flex", gap: 6 }}>
            {STEPS.slice(1, -1).map((s, i) => (
              <div key={i} style={{ flex: 1, height: 5, borderRadius: 99, background: i + 1 <= step ? "var(--accent)" : "var(--surface-3)", transition: "background .3s" }}></div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 700, marginTop: 8 }}>Step {step} of {STEPS.length - 2} · {STEPS[step]}</div>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 26px 40px" }}>
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          {step === 0 && <WelcomeStep hadData={hadData} onFresh={startFresh} onKeep={() => setStep(1)} />}
          {step === 1 && <ProfileStep profile={profile} setProfile={setProfile} cur={cur} />}
          {step === 2 && <AccountsStep items={accounts} setItems={setAccounts} kind="bank" cur={cur} />}
          {step === 3 && <CardsStep cards={cards} setCards={setCards} cur={cur} />}
          {step === 4 && <AccountsStep items={assets} setItems={setAssets} kind="asset" cur={cur} />}
          {step === 5 && <LoansStep loans={loans} setLoans={setLoans} cur={cur} />}
          {step === 6 && <DoneStep counts={{ accounts: accounts.length, assets: assets.length, cards: cards.length, loans: loans.length }} />}
        </div>
      </div>

      {/* footer nav */}
      {step > 0 && (
        <div style={{ borderTop: "1px solid var(--border-soft)", background: "var(--surface)", flexShrink: 0 }}>
          <div style={{ maxWidth: 760, margin: "0 auto", width: "100%", padding: "14px 26px", display: "flex", gap: 10, justifyContent: "space-between" }}>
            <button className="btn btn-ghost" onClick={back} disabled={step <= (editMode ? 1 : 1)} style={{ visibility: step > 1 ? "visible" : "hidden" }}><Icon name="chevronRight" size={16} style={{ transform: "rotate(180deg)" }} />Back</button>
            {step < STEPS.length - 1
              ? <button className="btn btn-primary" onClick={next}>{editMode && step === 5 ? "Review" : "Continue"}<Icon name="chevronRight" size={16} /></button>
              : <button className="btn btn-primary" onClick={finish}><Icon name="check" size={16} />{editMode ? "Save changes" : "Finish setup"}</button>}
          </div>
        </div>
      )}
    </div>
  );
}

function StepHead({ emoji, title, sub }) {
  return <div style={{ marginBottom: 22 }}>
    <div style={{ fontSize: 30, marginBottom: 8 }}>{emoji}</div>
    <div className="display" style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-.02em" }}>{title}</div>
    {sub && <div style={{ fontSize: 14, color: "var(--text-2)", marginTop: 6, lineHeight: 1.5 }}>{sub}</div>}
  </div>;
}

function WelcomeStep({ hadData, onFresh, onKeep }) {
  return (
    <div style={{ textAlign: "center", paddingTop: 30 }}>
      <div style={{ fontSize: 46, marginBottom: 14 }}>👋</div>
      <div className="display" style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-.02em" }}>Let's set up your finances</div>
      <div style={{ fontSize: 15, color: "var(--text-2)", marginTop: 12, lineHeight: 1.6, maxWidth: 480, margin: "12px auto 0" }}>
        A few quick steps to capture your accounts, credit cards, investments and loans. You can edit any of it later, and import your history once you're in.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 340, margin: "30px auto 0" }}>
        {hadData ? <>
          <button className="btn btn-primary" style={{ justifyContent: "center", padding: "13px" }} onClick={onFresh}><Icon name="sparkles" size={16} />Start fresh (clear sample data)</button>
          <button className="btn" style={{ justifyContent: "center", padding: "13px" }} onClick={onKeep}>Keep current data & just review</button>
          <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>Your account currently has sample data — clearing is recommended.</div>
        </> : (
          <button className="btn btn-primary" style={{ justifyContent: "center", padding: "13px" }} onClick={onKeep}>Get started<Icon name="chevronRight" size={16} /></button>
        )}
      </div>
    </div>
  );
}

function ProfileStep({ profile, setProfile, cur }) {
  const set = (k, v) => setProfile({ ...profile, [k]: v });
  return (
    <div>
      <StepHead emoji="🧑" title="About you" sub="This personalises your investment guidance and insights." />
      <div className="grid" style={{ gap: 16 }}>
        <div className="row" style={{ gap: 14 }}>
          <div className="field" style={{ flex: 2 }}><label className="label">Your name</label><input className="input" value={profile.name || ""} onChange={e => set("name", e.target.value)} placeholder="e.g. Aarav Sharma" autoFocus /></div>
          <div className="field" style={{ flex: 1 }}><label className="label">Age</label><input className="input num" type="number" value={profile.age || ""} onChange={e => set("age", +e.target.value || null)} placeholder="32" /></div>
        </div>
        <div className="row" style={{ gap: 14 }}>
          <div className="field" style={{ flex: 1 }}><label className="label">Marital status</label>
            <select className="select" value={profile.maritalStatus} onChange={e => set("maritalStatus", e.target.value)}>{["Single","Married","Divorced","Widowed"].map(o => <option key={o}>{o}</option>)}</select></div>
          <div className="field" style={{ flex: 1 }}><label className="label">Dependents</label><input className="input num" type="number" min="0" value={profile.dependents || 0} onChange={e => set("dependents", +e.target.value)} /></div>
        </div>
        <div className="field"><label className="label">Risk appetite</label>
          <div className="seg" style={{ width: "100%" }}>{["Conservative","Moderate","Aggressive"].map(r => <button key={r} style={{ flex: 1 }} className={profile.risk === r ? "on" : ""} onClick={() => set("risk", r)}>{r}</button>)}</div></div>
        <div className="field"><label className="label">Approx. monthly income ({cur})</label><input className="input num" type="number" value={profile.monthlyIncome || ""} onChange={e => set("monthlyIncome", +e.target.value || null)} placeholder="e.g. 700000" /></div>
        <div className="field"><label className="label">Financial goals <span style={{ color: "var(--text-3)", fontWeight: 500 }}>(optional)</span></label><textarea className="textarea" value={profile.goalsText || ""} onChange={e => set("goalsText", e.target.value)} placeholder="e.g. Buy a house in 5 years, diversify out of real estate, retire by 45…" /></div>
      </div>
    </div>
  );
}

function AccountsStep({ items, setItems, kind, cur }) {
  const types = kind === "bank" ? FT.ACCOUNT_TYPES.filter(t => ["bank","cash"].includes(t.id)) : FT.ACCOUNT_TYPES.filter(t => ["invest","realestate","crypto","retire","other"].includes(t.id));
  const palette = ["var(--c1)","var(--c2)","var(--c3)","var(--c4)","var(--c5)","var(--c6)","var(--c7)","var(--c10)"];
  const add = () => setItems([...items, { id: "acc_" + FT.uid(), name: "", type: types[0].id, currency: "INR", balance: 0, color: palette[items.length % palette.length] }]);
  const upd = (i, k, v) => setItems(items.map((x, j) => j === i ? { ...x, [k]: v } : x));
  const del = (i) => setItems(items.filter((_, j) => j !== i));
  return (
    <div>
      <StepHead emoji={kind === "bank" ? "🏦" : "📈"} title={kind === "bank" ? "Bank accounts" : "Investments & assets"}
        sub={kind === "bank" ? "Add your savings/current accounts and cash. Balances optional now — import fills history later." : "Stocks, mutual funds, crypto, real estate, EPF/PPF — anything you own."} />
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {items.map((a, i) => (
          <div key={a.id} className="card card-pad" style={{ padding: 14, display: "grid", gridTemplateColumns: "1.4fr 1fr 1.1fr 84px 36px", gap: 10, alignItems: "center" }}>
            <input className="input" style={{ padding: "9px 11px" }} placeholder={kind === "bank" ? "e.g. HDFC Savings" : "e.g. Zerodha Stocks"} value={a.name} onChange={e => upd(i, "name", e.target.value)} />
            <select className="select" style={{ padding: "9px 11px" }} value={a.type} onChange={e => upd(i, "type", e.target.value)}>{types.map(t => <option key={t.id} value={t.id}>{t.emoji} {t.name}</option>)}</select>
            <input className="input num" style={{ padding: "9px 11px" }} type="number" placeholder="Balance" value={a.balance || ""} onChange={e => upd(i, "balance", +e.target.value)} />
            <select className="select" style={{ padding: "9px 8px" }} value={a.currency} onChange={e => upd(i, "currency", e.target.value)}>{Object.keys(FT.CUR).map(c => <option key={c} value={c}>{c}</option>)}</select>
            <button className="btn btn-icon btn-ghost" onClick={() => del(i)}><Icon name="trash" size={15} /></button>
          </div>
        ))}
        <button className="btn" style={{ alignSelf: "flex-start" }} onClick={add}><Icon name="plus" size={16} />Add {kind === "bank" ? "account" : "asset"}</button>
        {!items.length && <div className="empty" style={{ padding: "20px 0" }}>None added yet — add one above, or skip and add later.</div>}
      </div>
    </div>
  );
}

function CardsStep({ cards, setCards, cur }) {
  const add = () => setCards([...cards, { id: "card_" + FT.uid(), name: "", cardType: "amzicici", network: "Visa", last4: "", limit: 0, billingDay: 1, dueDay: 18, graceDays: 20, balance: 0, currency: "INR" }]);
  const upd = (i, k, v) => setCards(cards.map((x, j) => j === i ? { ...x, [k]: v } : x));
  const del = (i) => setCards(cards.filter((_, j) => j !== i));
  return (
    <div>
      <StepHead emoji="💳" title="Credit cards" sub="Pick your card to auto-load its reward rules, then set the limit and billing/due dates — that's what powers the 'best card today' suggestions." />
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {cards.map((c, i) => {
          const def = FT.cardDef(c.cardType);
          return (
            <div key={c.id} className="card card-pad" style={{ padding: 16 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
                <select className="select" style={{ flex: 1, fontWeight: 700 }} value={c.cardType} onChange={e => { const d = FT.cardDef(e.target.value); upd(i, "cardType", e.target.value); if (!c.name) upd(i, "name", d.name); }}>
                  {FT.CARD_DB.map(cd => <option key={cd.id} value={cd.id}>{cd.name}</option>)}
                </select>
                <button className="btn btn-icon btn-ghost" onClick={() => del(i)}><Icon name="trash" size={15} /></button>
              </div>
              <div style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.5, marginBottom: 12 }}>{def.notes}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <div className="field"><label className="label">Nickname</label><input className="input" style={{ padding: "9px 11px" }} value={c.name} onChange={e => upd(i, "name", e.target.value)} placeholder={def.name} /></div>
                <div className="field"><label className="label">Last 4 digits</label><input className="input num" style={{ padding: "9px 11px" }} maxLength="4" value={c.last4} onChange={e => upd(i, "last4", e.target.value.replace(/\D/g,""))} placeholder="1234" /></div>
                <div className="field"><label className="label">Credit limit</label><input className="input num" style={{ padding: "9px 11px" }} type="number" value={c.limit || ""} onChange={e => upd(i, "limit", +e.target.value)} placeholder="e.g. 300000" /></div>
                <div className="field"><label className="label">Statement day</label><input className="input num" style={{ padding: "9px 11px" }} type="number" min="1" max="28" value={c.billingDay} onChange={e => upd(i, "billingDay", +e.target.value)} /></div>
                <div className="field"><label className="label">Payment due day</label><input className="input num" style={{ padding: "9px 11px" }} type="number" min="1" max="28" value={c.dueDay} onChange={e => upd(i, "dueDay", +e.target.value)} /></div>
                <div className="field"><label className="label">Outstanding</label><input className="input num" style={{ padding: "9px 11px" }} type="number" value={c.balance || ""} onChange={e => upd(i, "balance", +e.target.value)} placeholder="0" /></div>
              </div>
            </div>
          );
        })}
        <button className="btn" style={{ alignSelf: "flex-start" }} onClick={add}><Icon name="plus" size={16} />Add credit card</button>
        {!cards.length && <div className="empty" style={{ padding: "20px 0" }}>No cards yet — add one to unlock the "best card to use today" engine.</div>}
      </div>
    </div>
  );
}

function LoansStep({ loans, setLoans, cur }) {
  const TYPES = [["home","🏠 Home"],["car","🚗 Car"],["personal","💵 Personal"],["education","🎓 Education"],["other","📦 Other"]];
  const add = () => setLoans([...loans, { id: "loan_" + FT.uid(), name: "", type: "home", outstanding: 0, rate: 8.5, emi: 0, emiDay: 5, currency: "INR" }]);
  const upd = (i, k, v) => setLoans(loans.map((x, j) => j === i ? { ...x, [k]: v } : x));
  const del = (i) => setLoans(loans.filter((_, j) => j !== i));
  return (
    <div>
      <StepHead emoji="📉" title="Loans" sub="Home, car, personal or education loans — so your net worth and EMIs are tracked. Skip if none." />
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {loans.map((l, i) => (
          <div key={l.id} className="card card-pad" style={{ padding: 14, display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr 0.8fr 64px 36px", gap: 10, alignItems: "center" }}>
            <input className="input" style={{ padding: "9px 11px" }} placeholder="e.g. SBI Home Loan" value={l.name} onChange={e => upd(i, "name", e.target.value)} />
            <select className="select" style={{ padding: "9px 8px" }} value={l.type} onChange={e => upd(i, "type", e.target.value)}>{TYPES.map(([v, lbl]) => <option key={v} value={v}>{lbl}</option>)}</select>
            <input className="input num" style={{ padding: "9px 11px" }} type="number" placeholder="Outstanding" value={l.outstanding || ""} onChange={e => upd(i, "outstanding", +e.target.value)} />
            <input className="input num" style={{ padding: "9px 8px" }} type="number" step="0.1" placeholder="Rate %" value={l.rate || ""} onChange={e => upd(i, "rate", +e.target.value)} />
            <input className="input num" style={{ padding: "9px 8px" }} type="number" placeholder="EMI" value={l.emi || ""} onChange={e => upd(i, "emi", +e.target.value)} />
            <button className="btn btn-icon btn-ghost" onClick={() => del(i)}><Icon name="trash" size={15} /></button>
          </div>
        ))}
        <button className="btn" style={{ alignSelf: "flex-start" }} onClick={add}><Icon name="plus" size={16} />Add loan</button>
        {!loans.length && <div className="empty" style={{ padding: "20px 0" }}>No loans — nice. Skip ahead.</div>}
      </div>
    </div>
  );
}

function DoneStep({ counts }) {
  return (
    <div style={{ textAlign: "center", paddingTop: 24 }}>
      <div style={{ fontSize: 46, marginBottom: 14 }}>🎉</div>
      <div className="display" style={{ fontSize: 28, fontWeight: 600 }}>You're all set</div>
      <div style={{ fontSize: 14.5, color: "var(--text-2)", marginTop: 10, lineHeight: 1.6, maxWidth: 460, margin: "10px auto 0" }}>
        Captured {counts.accounts} account{counts.accounts!==1?"s":""}, {counts.cards} card{counts.cards!==1?"s":""}, {counts.assets} asset{counts.assets!==1?"s":""} and {counts.loans} loan{counts.loans!==1?"s":""}. Next, head to <b>Import</b> to upload your statements and history — then the dashboard, insights and card tips come alive.
      </div>
    </div>
  );
}

Object.assign(window, { Onboarding });
