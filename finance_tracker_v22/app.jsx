/* ============================================================
   app.jsx — shell, routing, state, actions, + cloud sync
   ============================================================ */
const NAV = [
  { id: "dashboard", label: "Home", icon: "dashboard", title: "Home", sub: "Your money at a glance" },
  { id: "money", label: "Money", icon: "list", title: "Money", sub: "Transactions, review & analysis" },
  { id: "accounts", label: "Accounts", icon: "wallet", title: "Accounts", sub: "Bank, cash & net worth" },
  { id: "cards", label: "Cards", icon: "creditcard", title: "Credit Cards", sub: "Limits, float & rewards" },
  { id: "loans", label: "Loans", icon: "trending", title: "Loans", sub: "Debt, EMIs & payoff" },
  { id: "grow", label: "Grow", icon: "lightbulb", title: "Grow", sub: "Plan, leverage & where you stand" },
  { id: "settings", label: "Settings", icon: "settings", title: "Settings", sub: "Profile, rules, import, sync" },
];

const CLOUD_UID_KEY = "ft_cloud_uid";
const CLOUD_EVER_KEY = "ft_cloud_ever"; // set once a cloud account is used here; never removed

/* ---------------- Auth gate ---------------- */
function Root() {
  const cloudOn = typeof Cloud !== "undefined" && Cloud.enabled();
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(!cloudOn);

  useEffect(() => {
    if (!cloudOn) return;
    let unsub = () => {};
    (async () => {
      const u = await Cloud.getUser();
      setUser(u); setReady(true);
      unsub = Cloud.onAuthChange((nu) => setUser(nu));
    })();
    return () => unsub();
  }, []);

  if (!ready) {
    return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--bg)" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <div className="brand-mark" style={{ width: 42, height: 42 }}><Icon name="wallet" size={22} style={{ color: "#fff" }} /></div>
        <div style={{ fontSize: 13, color: "var(--text-3)", fontWeight: 700 }}>Loading…</div>
      </div>
    </div>;
  }
  if (cloudOn && !user) return <AuthScreen onAuthed={setUser} />;
  return <App cloudOn={cloudOn} user={user} />;
}

/* ---------------- Main app ---------------- */
function App({ cloudOn, user }) {
  const [state, setState] = useState(() => cloudOn ? FT.defaultState() : FT.load());
  const [route, setRoute] = useState("dashboard");
  const [showAdd, setShowAdd] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [editOnboard, setEditOnboard] = useState(false);
  const [sync, setSync] = useState(cloudOn ? "loading" : "local"); // loading|saving|synced|error|local
  const mainRef = useRef(null);
  const cloudReady = useRef(false);     // becomes true once initial cloud load done
  const lastStamp = useRef(null);       // updated_at we last adopted
  const saveTimer = useRef(null);

  // ---- initial cloud load (per user) ----
  useEffect(() => {
    if (!cloudOn || !user) return;
    cloudReady.current = false;
    setSync("loading");
    (async () => {
      try {
        const row = await Cloud.loadState();
        let cachedUid = "";
        try { cachedUid = localStorage.getItem(CLOUD_UID_KEY) || ""; } catch (e) {}
        let cloudEver = false;
        try { cloudEver = localStorage.getItem(CLOUD_EVER_KEY) === "1"; } catch (e) {}
        // If the local cache belongs to a DIFFERENT user, drop it so it can't leak.
        if (cachedUid && cachedUid !== user.id) { try { localStorage.removeItem(FT.KEY); } catch (e) {} }
        if (row && row.data) {
          applyState(FT_migrate(row.data));
          lastStamp.current = row.updated_at || null;
        } else {
          // No cloud row yet for this user. ONLY migrate local-only data when this
          // browser has truly never hosted a cloud account (first-ever sign-in);
          // otherwise a brand-new account must start empty — never inherit another's data.
          const firstEver = !cloudEver && cachedUid === "";
          const seed = firstEver ? FT.load() : FT.defaultState();
          applyState(seed);
          await Cloud.saveState(seed);
          lastStamp.current = new Date().toISOString();
        }
        try { localStorage.setItem(CLOUD_UID_KEY, user.id); localStorage.setItem(CLOUD_EVER_KEY, "1"); } catch (e) {}
        cloudReady.current = true;
        setSync("synced");
      } catch (e) {
        cloudReady.current = true; // allow local use even if cloud read failed
        setSync("error");
      }
    })();
  }, [cloudOn, user && user.id]);

  // ---- persist: local cache always; cloud debounced ----
  useEffect(() => {
    FT.save(state);
    document.body.className = state.theme === "light" ? "light" : "";
    if (!cloudOn) return;
    if (!cloudReady.current) return;
    setSync("saving");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await Cloud.saveState(state);
        lastStamp.current = new Date().toISOString();
        setSync("synced");
      } catch (e) { setSync("error"); }
    }, 800);
  }, [state]);

  // ---- re-pull on focus (pick up edits from another device) ----
  useEffect(() => {
    if (!cloudOn || !user) return;
    const onFocus = async () => {
      if (!cloudReady.current) return;
      try {
        const row = await Cloud.loadState();
        if (row && row.updated_at && row.updated_at !== lastStamp.current) {
          // adopt newer remote state
          applyState(FT_migrate(row.data));
          lastStamp.current = row.updated_at;
          setSync("synced");
        }
      } catch (e) {}
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => { window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onFocus); };
  }, [cloudOn, user && user.id]);

  useEffect(() => { if (mainRef.current) mainRef.current.scrollTop = 0; }, [route]);

  function applyState(next) { setState(next); }
  // run store.js migrate defensively on cloud payloads
  function FT_migrate(s) { return FT.migrate(s); }

  const patch = (fn) => setState(s => { const n = typeof fn === "function" ? fn(s) : fn; return { ...s, ...n }; });

  const actions = useMemo(() => ({
    addTxn: (t) => patch(s => ({ transactions: [t, ...s.transactions].sort((a, b) => b.date.localeCompare(a.date)) })),
    updateTxn: (t) => patch(s => ({ transactions: s.transactions.map(x => x.id === t.id ? t : x).sort((a, b) => b.date.localeCompare(a.date)) })),
    deleteTxn: (id) => patch(s => {
      const t = s.transactions.find(x => x.id === id);
      let receivables = s.receivables || [];
      if (t) {
        // deleting a split expense removes its receivable; deleting a settlement
        // re-opens the amount it had settled
        if (t.splitId) receivables = receivables.filter(r => r.id !== t.splitId);
        if (t.source === "settle" && t.note === "Split settlement") {
          // best-effort: re-open the most recent matching settlement
          receivables = receivables.map(r => {
            const m = (r.settlements || []).find(x => Math.round(x.amount) === Math.round(t.amount));
            if (!m) return r;
            return { ...r, owed: r.owed + t.amount, settled: false, settlements: r.settlements.filter(x => x !== m) };
          });
        }
      }
      return { transactions: s.transactions.filter(x => x.id !== id), receivables };
    }),
    removeDuplicates: () => patch(s => {
      // exact duplicates: same date + type + amount + merchant (first kept)
      const seen = new Set(); const keep = [];
      s.transactions.forEach(t => { const k = FT.txnKey(t); if (seen.has(k)) return; seen.add(k); keep.push(t); });
      // fuzzy gmail duplicates: same date + type + exact amount ≥ 1000 (bank alert vs biller receipt)
      const fseen = new Set(); const out = [];
      keep.forEach(t => {
        const fk = [t.date, t.type, (+t.amount).toFixed(2)].join("|");
        if (t.source === "gmail" && +t.amount >= 1000 && fseen.has(fk)) return;
        fseen.add(fk); out.push(t);
      });
      return { transactions: out };
    }),
    addAccount: (a) => patch(s => ({ accounts: [...s.accounts, a] })),
    updateAccount: (a) => patch(s => ({ accounts: s.accounts.map(x => x.id === a.id ? a : x) })),
    deleteAccount: (id) => patch(s => ({ accounts: s.accounts.filter(x => x.id !== id) })),
    addGoal: (g) => patch(s => ({ goals: [...s.goals, g] })),
    updateGoal: (g) => patch(s => ({ goals: s.goals.map(x => x.id === g.id ? g : x) })),
    deleteGoal: (id) => patch(s => ({ goals: s.goals.filter(x => x.id !== id) })),
    setBudgets: (b) => patch({ budgets: b }),
    setRecurring: (r) => patch({ recurring: r }),
    setCurrency: (c) => patch({ displayCurrency: c }),
    setFx: (code, displayVal) => patch(s => ({ fx: { ...s.fx, [code]: (+displayVal || 0) * (s.fx[s.displayCurrency] || 1) } })),
    setTheme: (t) => patch({ theme: t }),
    saveProfile: (p) => patch({ profile: p }),
    openProfile: () => setShowProfile(true),
    // cards
    addCard: (c) => patch(s => ({ cards: [...s.cards, c] })),
    updateCard: (c) => patch(s => ({ cards: s.cards.map(x => x.id === c.id ? c : x) })),
    deleteCard: (id) => patch(s => ({ cards: s.cards.filter(x => x.id !== id) })),
    // loans
    addLoan: (l) => patch(s => ({ loans: [...s.loans, l] })),
    updateLoan: (l) => patch(s => ({ loans: s.loans.map(x => x.id === l.id ? l : x) })),
    deleteLoan: (id) => patch(s => ({ loans: s.loans.filter(x => x.id !== id) })),
    // review inbox (pending)
    addPending: (items) => patch(s => ({ pending: [...(s.pending || []), ...items] })),
    approvePending: (ids) => patch(s => {
      const ap = s.pending.filter(p => ids.includes(p.id));
      const rest = s.pending.filter(p => !ids.includes(p.id));
      const tx = ap.map(p => ({ ...p, status: "confirmed" }));
      return { pending: rest, transactions: [...tx, ...s.transactions].sort((a, b) => b.date.localeCompare(a.date)) };
    }),
    rejectPending: (ids) => patch(s => ({ pending: s.pending.filter(p => !ids.includes(p.id)) })),
    updatePending: (p) => patch(s => ({ pending: s.pending.map(x => x.id === p.id ? p : x) })),
    // upcoming bills (detected from emails)
    payBill: (id) => patch(s => {
      const b = (s.upcomingBills || []).find(x => x.id === id); if (!b) return {};
      const isCardPay = b.category === "cardpay"; // paying your own card = transfer, not a new expense
      const txn = {
        id: FT.uid(), type: isCardPay ? "transfer" : "expense", amount: b.amount,
        currency: b.currency || "INR", merchant: b.merchant,
        category: isCardPay ? "transfer" : (b.category || "bills"),
        account: (s.accounts[0] && s.accounts[0].id) || "",
        date: FT.todayISO(), note: "Bill payment", source: "bill", status: "confirmed", tags: [],
      };
      return {
        upcomingBills: s.upcomingBills.filter(x => x.id !== id),
        transactions: [txn, ...s.transactions].sort((a, b2) => b2.date.localeCompare(a.date)),
      };
    }),
    dismissBill: (id) => patch(s => ({ upcomingBills: (s.upcomingBills || []).filter(x => x.id !== id) })),
    addBill: (b) => patch(s => {
      const k = (x) => (x.merchant || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 14);
      const list = s.upcomingBills || [];
      if (list.some(x => k(x) === k(b) && (x.dueDate === b.dueDate || Math.round(x.amount) === Math.round(b.amount)))) return {};
      return { upcomingBills: [b, ...list].slice(0, 30) };
    }),
    // friendly-name rules
    setRenameRules: (rules) => patch({ renameRules: rules }),
    applyRulesToExisting: () => patch(s => ({
      transactions: s.transactions.map(t => {
        const ren = FT.applyRenames(t.merchant, s);
        if (ren.name === t.merchant && !ren.category) return t;
        return { ...t, merchant: ren.name, category: t.type === "transfer" ? t.category : (ren.category && FT.CAT_MAP[ren.category] ? ren.category : t.category) };
      }),
    })),
    addRulesAndApply: (newRules) => patch(s => {
      const rules = [...(s.renameRules || []), ...newRules];
      const tmp = { ...s, renameRules: rules };
      return {
        renameRules: rules,
        transactions: s.transactions.map(t => {
          const ren = FT.applyRenames(t.merchant, tmp);
          if (ren.name === t.merchant && !ren.category) return t;
          return { ...t, merchant: ren.name, category: t.type === "transfer" ? t.category : (ren.category && FT.CAT_MAP[ren.category] ? ren.category : t.category) };
        }),
      };
    }),
    convertCardpayToTransfers: () => patch(s => ({
      transactions: s.transactions.map(t => t.type === "expense" && t.category === "cardpay" ? { ...t, type: "transfer", category: "transfer" } : t),
    })),
    // quarterly investment plans + leverage program
    setRiskPosture: (v) => patch({ riskPosture: v }),
    savePlan: (plan) => patch(s => ({ plans: [{ ...plan, status: "active" }, ...(s.plans || []).map(p => ({ ...p, status: "archived" }))] })),
    togglePlanItem: (planId, itemId) => patch(s => ({
      plans: (s.plans || []).map(p => p.id !== planId ? p : { ...p, items: p.items.map(it => it.id !== itemId ? it : { ...it, done: !it.done, doneAt: !it.done ? FT.todayISO() : null }) }),
    })),
    saveLeverage: (lev) => patch(s => {
      // preserve done state for steps that survive a rebuild (matched by title)
      const prev = (s.leverage && s.leverage.steps) || [];
      const steps = lev.steps.map(st => {
        const old = prev.find(o => o.title.toLowerCase() === st.title.toLowerCase());
        return old && old.done ? { ...st, done: true, doneAt: old.doneAt } : st;
      });
      return { leverage: { ...lev, steps } };
    }),
    toggleLeverageStep: (id) => patch(s => ({
      leverage: s.leverage ? { ...s.leverage, steps: s.leverage.steps.map(st => st.id !== id ? st : { ...st, done: !st.done, doneAt: !st.done ? FT.todayISO() : null }) } : s.leverage,
    })),
    // ---- split & settle ----
    addSplitExpense: ({ txn, total, yourShare, label, replaceId }) => patch(s => {
      const owed = Math.max(0, total - yourShare);
      const recId = FT.uid();
      const t = { ...txn, id: FT.uid(), amount: yourShare, note: (txn.note || "") + ` · split (you paid ${FT.fmt(total, txn.currency || "INR")})`, splitId: recId };
      const rec = owed > 0 ? [{ id: recId, label: label || txn.merchant, total, yourShare, owed, settled: false, date: txn.date, txnId: t.id, account: txn.account, currency: txn.currency || "INR", settlements: [] }] : [];
      // when splitting an existing (e.g. Gmail-imported) txn, drop the original
      const base = replaceId ? s.transactions.filter(x => x.id !== replaceId) : s.transactions;
      return { transactions: [t, ...base].sort((a, b) => b.date.localeCompare(a.date)), receivables: [...rec, ...(s.receivables || [])] };
    }),
    settleReceivable: (id, amount) => patch(s => {
      const r = (s.receivables || []).find(x => x.id === id); if (!r) return {};
      const pay = amount != null ? Math.min(amount, r.owed) : r.owed;
      const newOwed = Math.round((r.owed - pay) * 100) / 100;
      // reconciliation: cash returns to the account as a transfer (no P&L impact)
      const recon = { id: FT.uid(), type: "transfer", amount: pay, currency: r.currency || "INR", merchant: "Repaid: " + r.label, category: "transfer", account: "", toAccount: r.account || (s.accounts[0] && s.accounts[0].id) || "", date: FT.todayISO(), note: "Split settlement", source: "settle", status: "confirmed", tags: [] };
      return {
        transactions: [recon, ...s.transactions].sort((a, b) => b.date.localeCompare(a.date)),
        receivables: (s.receivables || []).map(x => x.id !== id ? x : { ...x, owed: newOwed, settled: newOwed <= 0.5, settlements: [...(x.settlements || []), { date: FT.todayISO(), amount: pay }] }),
      };
    }),
    deleteReceivable: (id) => patch(s => ({ receivables: (s.receivables || []).filter(x => x.id !== id) })),
    // ---- categorize / relabel a transaction, optionally as a permanent rule ----
    categorizeTxn: (id, { merchant, category, makeRule, matchKey }) => patch(s => {
      const txns = s.transactions.map(t => t.id !== id ? t : { ...t, merchant: merchant != null ? merchant : t.merchant, category: category != null ? category : t.category });
      let rules = s.renameRules || [];
      if (makeRule && matchKey) {
        const nr = { id: FT.uid(), match: matchKey, name: merchant, category: category || null };
        rules = [...rules, nr];
        // apply to all other matching transactions too
        const low = String(matchKey).toLowerCase();
        return { renameRules: rules, transactions: txns.map(t => {
          if (t.id === id) return t;
          const hay = ((t.merchant || "") + " " + (t.note || "")).toLowerCase();
          if (hay.includes(low)) return { ...t, merchant: merchant || t.merchant, category: t.type === "transfer" ? t.category : (category || t.category) };
          return t;
        }) };
      }
      return { transactions: txns };
    }),
    saveBrief: (brief) => patch({ brief }),
    // fixed expenses + income assets
    setFixedExpenses: (list) => patch({ fixedExpenses: list }),
    setIncomeAssets: (list) => patch({ incomeAssets: list }),
    setCriticView: (v) => patch({ criticView: v }),
    // reconcile a bank account: user enters the true balance; re-anchor so drift resets
    reconcileAccount: (id, trueBalance) => patch(s => ({
      accounts: s.accounts.map(a => a.id !== id ? a : { ...a, balance: trueBalance, balanceAnchor: trueBalance, anchorDate: FT.todayISO() }),
    })),
    // reconcile a card's available limit from an email figure (or manual)
    reconcileCard: (id, availLimit) => patch(s => ({
      cards: s.cards.map(c => c.id !== id ? c : { ...c, availAnchor: availLimit, availAnchorDate: FT.todayISO() }),
    })),
    // auto-suggest recurring expenses from history (same merchant+~amount ≥3 months)
    suggestFixedFromHistory: (s) => {
      const byKey = {};
      (s.transactions || []).filter(t => t.type === "expense").forEach(t => {
        const k = (t.merchant || "").toLowerCase().trim() + "|" + Math.round((t.amount || 0) / 500) * 500;
        (byKey[k] = byKey[k] || []).push(t);
      });
      const existing = new Set((s.fixedExpenses || []).map(f => (f.label || "").toLowerCase()));
      const suggestions = [];
      Object.values(byKey).forEach(group => {
        const months = new Set(group.map(t => t.date.slice(0, 7)));
        if (months.size >= 3 && !existing.has((group[0].merchant || "").toLowerCase())) {
          const amt = Math.round(group.reduce((a, t) => a + t.amount, 0) / group.length);
          suggestions.push({ id: FT.uid(), label: group[0].merchant, amount: amt, currency: group[0].currency || "INR", dueDay: +group[0].date.slice(8, 10) || 1, category: group[0].category });
        }
      });
      return suggestions;
    },
    addFixedExpenses: (items) => patch(s => ({ fixedExpenses: [...(s.fixedExpenses || []), ...items] })),
    setNotify: (n) => patch(s => ({ notify: { ...s.notify, ...n } })),
    setGmail: (g) => patch(s => ({ gmail: { ...s.gmail, ...g } })),
    genIngestToken: () => patch(s => ({ gmail: { ...s.gmail, token: "ft_" + FT.uid() + FT.uid() } })),
    // onboarding
    commitOnboarding: ({ profile, accounts, cards, loans }) => patch({ profile, accounts, cards, loans, onboarded: true }),
    wipeAll: () => patch(() => { const d = FT.defaultState(); return { ...d, onboarded: false }; }),
    relaunchOnboarding: () => setEditOnboard(true),
    resetAll: () => { const s = FT.defaultState(); FT.save(s); setState(s); setRoute("dashboard"); },
    signOut: async () => {
      // Hard reset so no trace of this account's data remains for the next login.
      try {
        localStorage.removeItem(CLOUD_UID_KEY);
        localStorage.removeItem(FT.KEY);
        Object.keys(localStorage).filter(k => k.indexOf("ft_chat_") === 0).forEach(k => localStorage.removeItem(k));
      } catch (e) {}
      await Cloud.signOut();
      try { window.location.reload(); } catch (e) {}
    },
  }), []);

  const meta = NAV.find(n => n.id === route) || NAV[0];

  // onboarding gate
  if (!state.onboarded) {
    return <Onboarding state={state} actions={actions} onDone={() => setRoute("dashboard")} />;
  }
  if (editOnboard) {
    return <Onboarding state={state} actions={actions} editMode onDone={() => setEditOnboard(false)} />;
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Icon name="wallet" size={19} style={{ color: "#fff" }} /></div>
          <div className="brand-text"><div className="brand-name">Finance Tracker</div><div className="brand-sub">{state.profile.name}</div></div>
        </div>
        <div className="nav-label">Menu</div>
        {NAV.map(n => (
          <button key={n.id} className={"nav-item" + (route === n.id ? " active" : "")} onClick={() => setRoute(n.id)}><Icon name={n.icon} />{n.label}</button>
        ))}
        <div className="nav-spacer"></div>
        <button className="nav-item" onClick={() => setShowAdd(true)} style={{ background: "var(--accent-soft)", color: "var(--accent)" }}><Icon name="plus" />Add transaction</button>
        {cloudOn && user && (
          <div className="acct-foot">
            <div className="acct-foot-row">
              <div className="acct-avatar">{(user.email || "?")[0].toUpperCase()}</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user.email}</div>
                <SyncLabel sync={sync} />
              </div>
              <button className="btn btn-icon btn-ghost" title="Sign out" onClick={actions.signOut}><Icon name="arrowUpRight" size={16} /></button>
            </div>
          </div>
        )}
      </aside>

      <main className="main" ref={mainRef}>
        <div className="topbar">
          <div>
            <div className="page-title">{meta.title}</div>
            <div className="page-sub">{meta.sub}</div>
          </div>
          <div className="topbar-actions">
            {cloudOn && <SyncPill sync={sync} />}
            <button className="btn btn-icon" onClick={() => actions.setTheme(state.theme === "light" ? "dark" : "light")} title="Toggle theme">
              <Icon name={state.theme === "light" ? "moon" : "sun"} size={18} />
            </button>
            <button className="btn btn-primary" onClick={() => setShowAdd(true)}><Icon name="plus" size={16} />Add transaction</button>
          </div>
        </div>
        <div className="content">
          {route === "dashboard" && <Dashboard state={state} actions={actions} go={setRoute} openAdd={() => setShowAdd(true)} />}
          {route === "money" && <MoneyHub state={state} actions={actions} />}
          {route === "accounts" && <AccountsHub state={state} actions={actions} />}
          {route === "cards" && <CardsView state={state} actions={actions} />}
          {route === "loans" && <LoansHub state={state} actions={actions} />}
          {route === "grow" && <GrowHub state={state} actions={actions} openProfile={() => setShowProfile(true)} />}
          {route === "settings" && <Settings state={state} actions={actions} cloud={{ on: cloudOn, user, sync, signOut: actions.signOut }} />}
        </div>
      </main>

      <nav className="mobile-nav">
        {NAV.map(n => (
          <button key={n.id} className={route === n.id ? "active" : ""} onClick={() => setRoute(n.id)}>
            <Icon name={n.icon} />{n.label.split(" ")[0]}
          </button>
        ))}
      </nav>

      {showAdd && <AddTxnModal state={state} onClose={() => setShowAdd(false)} onSave={(t) => { if (t && t.__split) actions.addSplitExpense(t); else actions.addTxn(t); setShowAdd(false); }} />}
      {showProfile && <ProfileModal profile={state.profile} onClose={() => setShowProfile(false)} onSave={(p) => { actions.saveProfile(p); setShowProfile(false); }} />}
    </div>
  );
}

function SyncPill({ sync }) {
  const map = {
    loading: { t: "Syncing…", c: "var(--text-2)", dot: "var(--warn)" },
    saving:  { t: "Saving…",  c: "var(--text-2)", dot: "var(--warn)" },
    synced:  { t: "Synced",   c: "var(--pos)",    dot: "var(--pos)" },
    error:   { t: "Sync error", c: "var(--neg)",  dot: "var(--neg)" },
    local:   { t: "Local",    c: "var(--text-3)", dot: "var(--text-3)" },
  };
  const m = map[sync] || map.local;
  return <span className="pill" style={{ color: m.c }}><span style={{ width: 7, height: 7, borderRadius: 99, background: m.dot, display: "inline-block" }}></span>{m.t}</span>;
}
function SyncLabel({ sync }) {
  const txt = { loading: "Syncing…", saving: "Saving…", synced: "All changes synced", error: "Sync error — retrying", local: "Local only" }[sync] || "";
  const col = sync === "error" ? "var(--neg)" : sync === "synced" ? "var(--pos)" : "var(--text-3)";
  return <div style={{ fontSize: 11, fontWeight: 700, color: col }}>{txt}</div>;
}

Object.assign(window, { Root, App });
ReactDOM.createRoot(document.getElementById("root")).render(<Root />);
