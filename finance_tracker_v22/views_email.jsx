/* ============================================================
   views_email.jsx — AI email → transaction parser
   Single + Bulk modes, multi-currency aware
   ============================================================ */
const SAMPLE_EMAILS = [
  { id: "salary", subject: "Payroll deposit — Aperture Labs", from: "payroll@aperture.io", body: `Hi Aarav,\n\nYour salary has been deposited.\n\nNet pay: USD 8,500.00\nDeposited to: Wise USD account ••6171\nPay date: ${FT.todayISO()}\nRef: PAYROLL/APRT\n\nAperture Labs Payroll` },
  { id: "swiggy", subject: "Your Swiggy order is on the way! 🛵", from: "noreply@swiggy.in", body: `Hi! Your order from Toit has been confirmed.\n\nOrder total: ₹842\nPaid via: HDFC Credit Card\nDelivery: 30 mins\nOrder ID: #SWG88241\n\nThanks for ordering with Swiggy.` },
  { id: "debit", subject: "Transaction alert — Kotak Bank", from: "alerts@kotak.com", body: `Dear Customer,\n\nRs.3,499.00 has been debited from your Kotak account XX4521 on ${FT.daysAgo(1)} towards AMAZON.IN.\n\nIf this wasn't you, call us immediately.\n\nKotak Bank` },
  { id: "aws", subject: "Your AWS invoice is available", from: "billing@amazon.com", body: `Hello,\n\nYour AWS account was charged USD 214.30 for compute and storage on ${FT.daysAgo(2)}.\n\nThis is a business expense on your card ending 4242.\n\nAmazon Web Services` },
  { id: "rent", subject: "Rent received from tenant", from: "noreply@nobroker.in", body: `Payment received.\n\nAmount: ₹28,000\nFrom: Tenant (Apartment, Pune)\nCredited to: Kotak Savings\nDate: ${FT.daysAgo(3)}\n\nNoBroker` },
];

const BULK_SAMPLE = `Aug 02  SWIGGY BANGALORE          ₹742
Aug 03  UBER TRIP                 ₹318
Aug 04  AMAZON.IN ORDER           ₹3,499
Aug 05  GROWW SIP INDEX FUND      ₹30,000
Aug 06  AWS CLOUD (USD 214.30)    business
Aug 07  RENT RECEIVED FROM TENANT ₹28,000 credit
Aug 08  NETFLIX SUBSCRIPTION      ₹649`;

function resolveAcct(text, acctStr, type, state) {
  const last4 = (String(text).match(/(?:xx|••|ending|card no\.?|\*+)\s*(\d{4})\b/i) || [])[1];
  const want = String(acctStr || "").toLowerCase();
  const acc = (state.accounts || []).find(a => a.name && (want.includes(a.name.toLowerCase()) || a.name.toLowerCase().includes(want)));
  const card = (state.cards || []).find(c =>
    (last4 && c.last4 && String(c.last4) === last4) ||
    (c.name && want && (want.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(want)))
  );
  if (card && type === "expense") return "card:" + card.id;
  if (acc) return acc.id;
  return (state.accounts[0] && state.accounts[0].id) || "";
}

function EmailImport({ state, actions }) {
  const cur = state.displayCurrency;
  const [mode, setMode] = useState("single");
  return (
    <div className="grid" style={{ gap: 18 }}>
      <div className="card card-pad fade-in" style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        <span className="kpi-ico" style={{ background: "var(--accent-soft)", color: "var(--accent)", width: 38, height: 38, flexShrink: 0 }}><Icon name="mail" /></span>
        <div style={{ fontSize: 13.5, color: "var(--text-2)", lineHeight: 1.65 }}>
          <b style={{ color: "var(--text)" }}>Paste or forward bank alerts, receipts and salary emails</b> — the AI reads them, extracts amount, currency, merchant, date and category, and lets you confirm before anything is saved.
          <span style={{ color: "var(--text-3)" }}> Use <b>Bulk</b> to drop in a whole statement or several emails at once. (A private offline app can't silently auto-sync Gmail — this paste/forward flow is the secure equivalent; nothing leaves your browser except the parse request.)</span>
        </div>
      </div>

      <div className="seg" style={{ alignSelf: "flex-start" }}>
        <button className={mode === "single" ? "on" : ""} onClick={() => setMode("single")}>Single email</button>
        <button className={mode === "bulk" ? "on" : ""} onClick={() => setMode("bulk")}>Bulk import</button>
      </div>

      {mode === "single" ? <SingleParse state={state} actions={actions} /> : <BulkParse state={state} actions={actions} />}
    </div>
  );
}

/* ---------------- single ---------------- */
function SingleParse({ state, actions }) {
  const cur = state.displayCurrency;
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [parsed, setParsed] = useState(null);
  const [err, setErr] = useState("");
  const [added, setAdded] = useState(0);
  const catList = [...FT.EXPENSE_CATS.map(c => `${c.id} (expense: ${c.name})`), ...FT.INCOME_CATS.map(c => `${c.id} (income: ${c.name})`)].join(", ");

  async function parse() {
    if (!text.trim()) return;
    setLoading(true); setErr(""); setParsed(null);
    const hints = FT.ownAccountHints(state);
    const ownLine = hints.length ? ` The user's own accounts/cards: ${hints.join(", ")}.` : "";
    const prompt = `Read this email. Respond with ONLY a JSON object, no prose, no code fences.

If it confirms a transaction that ALREADY HAPPENED (debited/credited/spent/received):
{"kind":"transaction","type":"income"|"expense"|"transfer","amount":<number, no symbol/commas>,"currency":"INR"|"USD"|"EUR"|"GBP","merchant":"<who paid / payer>","account":"<bank/card the money moved on + last4 if present, else null>","date":"YYYY-MM-DD","category":"<one id from list, or 'transfer'>","confidence":"high"|"medium"|"low"}

If it announces a bill or payment DUE IN THE FUTURE (bill generated, statement with amount due, premium/EMI/recharge reminder):
{"kind":"bill","amount":<the amount due>,"currency":"INR"|"USD"|"EUR"|"GBP","merchant":"<biller name>","dueDate":"YYYY-MM-DD","category":"<one id>","confidence":"high"|"medium"|"low"}
For a credit-card statement use the TOTAL amount due and category "cardpay"; utilities/phone/internet "bills"; insurance "health" or "bills"; rent "rent"; loan EMI "emi"; subscriptions "subs".

CRITICAL: merchant is the OTHER party (who you paid or who paid you), NOT the bank/app that sent the alert. Ignore the sender/From line; look in the body for "paid to", "to VPA", "at <merchant>", "received from", or the UPI handle. "merchant" must be a SHORT, human-friendly label a person instantly recognizes — the brand, payee, or purpose. NEVER raw bank names, reference numbers, or codes. Examples: "Swiggy", "House rent", "Skoda car EMI", "Salary". For a credit-card bill payment, name it "<card name> bill" using the user's card list.

Valid category ids: ${catList}

AMOUNT RULE: "amount" is the value of THIS transaction only — the exact money that moved. NEVER use the available balance, available/credit limit, outstanding, total amount due, or reward points (those are different, usually larger numbers in the same email).
Rules: detect the currency from symbols/codes (₹/Rs/INR, $/USD, €, £). Salary/credit/dividend/refund/interest/rent-received = income; purchases/bills-paid/debits = expense. If the money simply moves between the user's OWN accounts, or it's a credit-card bill payment from the user's own bank, set "type":"transfer" and "category":"transfer" (it must NOT count as income or expense).${ownLine} If no clear date use ${FT.todayISO()}.

Email:
"""${text.slice(0, 2500)}"""`;
    try {
      let raw = (await window.claude.complete(prompt) || "").trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
      const m = raw.match(/\{[\s\S]*\}/);
      const o = JSON.parse(m ? m[0] : raw);
      if (o.kind === "bill") {
        setParsed({
          kind: "bill",
          amount: Math.abs(+String(o.amount).replace(/[^0-9.]/g, "")) || 0,
          currency: FT.CUR[o.currency] ? o.currency : "INR",
          merchant: o.merchant || "Bill",
          dueDate: /^\d{4}-\d{2}-\d{2}$/.test(o.dueDate) ? o.dueDate : FT.todayISO(),
          category: FT.CAT_MAP[o.category] && o.category !== "transfer" ? o.category : "bills",
          confidence: o.confidence || "medium",
        });
      } else {
        let type = o.type === "income" ? "income" : o.type === "transfer" ? "transfer" : "expense";
        if (type !== "transfer" && FT.looksLikeTransfer(text, state)) type = "transfer";
        let rawName = FT.bestMerchant(o.merchant, text);
        const ren = FT.applyRenames(rawName, state);
        if (ren.category && FT.CAT_MAP[ren.category]) o.category = ren.category;
        setParsed({
          kind: "transaction", type,
          amount: Math.abs(+String(o.amount).replace(/[^0-9.]/g, "")) || 0,
          currency: FT.CUR[o.currency] ? o.currency : "INR",
          merchant: ren.name,
          date: /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : FT.todayISO(),
          category: type === "transfer" ? "transfer" : (FT.CAT_MAP[o.category] && o.category !== "transfer" ? o.category : "uncat"),
          account: resolveAcct(text, o.account, type, state), confidence: o.confidence || "medium", note: "Imported from email",
        });
      }
    } catch (e) { setErr("Couldn't parse that automatically. Try a clearer email, or add it manually."); }
    setLoading(false);
  }
  function confirm() {
    if (parsed.kind === "bill") {
      actions.addBill({ id: FT.uid(), merchant: parsed.merchant, amount: parsed.amount, currency: parsed.currency, dueDate: parsed.dueDate, category: parsed.category, source: "email", detectedAt: FT.todayISO() });
    } else {
      const { kind, ...t } = parsed;
      actions.addTxn({ id: FT.uid(), ...t, source: "email" });
    }
    setParsed(null); setText(""); setAdded(added + 1);
  }
  const cats = parsed ? (parsed.type === "income" ? FT.INCOME_CATS : FT.EXPENSE_CATS) : [];

  return (
    <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
      <div className="card card-pad fade-in">
        <div className="card-h"><div className="card-title">Paste email content</div>{added > 0 && <span className="pill pill-pos"><Icon name="check" size={13} />{added} imported</span>}</div>
        <textarea className="textarea" style={{ minHeight: 220, fontFamily: "var(--font)" }} placeholder="Paste the full text of a transaction email here…" value={text} onChange={e => setText(e.target.value)} />
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={parse} disabled={loading || !text.trim()}>{loading ? "Reading email…" : <><Icon name="wand" size={16} />Parse with AI</>}</button>
          {text && <button className="btn btn-ghost" onClick={() => { setText(""); setParsed(null); setErr(""); }}>Clear</button>}
        </div>
        {err && <div style={{ marginTop: 12, fontSize: 13, color: "var(--warn)", fontWeight: 600 }}>{err}</div>}
        {loading && <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>{[90,70,80].map((w,i)=><div key={i} className="skel" style={{ height: 12, width: w+"%" }} />)}</div>}

        {parsed && parsed.kind === "bill" && (
          <div className="fade-in" style={{ marginTop: 16, border: "1px solid var(--border)", borderRadius: 14, padding: 16, background: "var(--bg-2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <span style={{ fontWeight: 800, fontSize: 13.5, display: "flex", alignItems: "center", gap: 7 }}><Icon name="repeat" size={15} style={{ color: "var(--accent)" }} />Upcoming bill detected</span>
              <span className="tag" style={{ background: parsed.confidence === "high" ? "var(--pos-soft)" : "var(--surface-3)", color: parsed.confidence === "high" ? "var(--pos)" : "var(--text-2)" }}>{parsed.confidence} confidence</span>
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              <div className="field"><label className="label">Biller</label><input className="input" value={parsed.merchant} onChange={e => setParsed({ ...parsed, merchant: e.target.value })} /></div>
              <div className="row" style={{ gap: 10 }}>
                <div className="field" style={{ flex: 2 }}><label className="label">Amount due</label><input className="input num" type="number" value={parsed.amount} onChange={e => setParsed({ ...parsed, amount: +e.target.value })} /></div>
                <div className="field" style={{ flex: 1 }}><label className="label">Currency</label><select className="select" value={parsed.currency} onChange={e => setParsed({ ...parsed, currency: e.target.value })}>{Object.keys(FT.CUR).map(c => <option key={c} value={c}>{c}</option>)}</select></div>
              </div>
              <div className="row" style={{ gap: 10 }}>
                <div className="field" style={{ flex: 1 }}><label className="label">Due date</label><input className="input" type="date" value={parsed.dueDate} onChange={e => setParsed({ ...parsed, dueDate: e.target.value })} /></div>
                <div className="field" style={{ flex: 1 }}><label className="label">Category</label><select className="select" value={parsed.category} onChange={e => setParsed({ ...parsed, category: e.target.value })}>{FT.EXPENSE_CATS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              </div>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 600, marginTop: 10 }}>This goes to Upcoming bills on your dashboard — nothing is counted as an expense until you mark it paid.</div>
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <button className="btn btn-ghost" onClick={() => setParsed(null)}>Discard</button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={confirm}><Icon name="check" size={16} />Save upcoming bill</button>
            </div>
          </div>
        )}
        {parsed && parsed.kind !== "bill" && (
          <div className="fade-in" style={{ marginTop: 16, border: "1px solid var(--border)", borderRadius: 14, padding: 16, background: "var(--bg-2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <span style={{ fontWeight: 800, fontSize: 13.5, display: "flex", alignItems: "center", gap: 7 }}><Icon name="sparkles" size={15} style={{ color: "var(--accent)" }} />Detected transaction</span>
              <span className="tag" style={{ background: parsed.confidence === "high" ? "var(--pos-soft)" : "var(--surface-3)", color: parsed.confidence === "high" ? "var(--pos)" : "var(--text-2)" }}>{parsed.confidence} confidence</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
              <div className="seg">
                <button className={parsed.type === "expense" ? "on expense" : ""} onClick={() => setParsed({ ...parsed, type: "expense", category: FT.EXPENSE_CATS.find(c=>c.id===parsed.category)?parsed.category:"misc" })}>Expense</button>
                <button className={parsed.type === "income" ? "on income" : ""} onClick={() => setParsed({ ...parsed, type: "income", category: FT.INCOME_CATS.find(c=>c.id===parsed.category)?parsed.category:"other_inc" })}>Income</button>
                <button className={parsed.type === "transfer" ? "on" : ""} onClick={() => setParsed({ ...parsed, type: "transfer", category: "transfer" })}>Transfer</button>
              </div>
              <div className="num display" style={{ fontSize: 22, fontWeight: 600, marginLeft: "auto", color: parsed.type === "income" ? "var(--pos)" : parsed.type === "transfer" ? "var(--text-2)" : "var(--text)" }}>{parsed.type === "income" ? "+" : parsed.type === "transfer" ? "⇄ " : "−"}{FT.fmt(parsed.amount, parsed.currency)}</div>
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              <div className="field"><label className="label">Merchant / source</label><input className="input" value={parsed.merchant} onChange={e => setParsed({ ...parsed, merchant: e.target.value })} /></div>
              <div className="row" style={{ gap: 10 }}>
                <div className="field" style={{ flex: 2 }}><label className="label">Amount</label><input className="input num" type="number" value={parsed.amount} onChange={e => setParsed({ ...parsed, amount: +e.target.value })} /></div>
                <div className="field" style={{ flex: 1 }}><label className="label">Currency</label><select className="select" value={parsed.currency} onChange={e => setParsed({ ...parsed, currency: e.target.value })}>{Object.keys(FT.CUR).map(c => <option key={c} value={c}>{c}</option>)}</select></div>
              </div>
              <div className="row" style={{ gap: 10 }}>
                <div className="field" style={{ flex: 1 }}><label className="label">Date</label><input className="input" type="date" value={parsed.date} onChange={e => setParsed({ ...parsed, date: e.target.value })} /></div>
                <div className="field" style={{ flex: 1 }}><label className="label">Category</label>{parsed.type === "transfer" ? <div className="input" style={{ display: "flex", alignItems: "center", color: "var(--text-2)" }}>⇄ Transfer</div> : <select className="select" value={parsed.category} onChange={e => setParsed({ ...parsed, category: e.target.value })}>{cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}</div>
              </div>
              <div className="field"><label className="label">Account</label><select className="select" value={parsed.account} onChange={e => setParsed({ ...parsed, account: e.target.value })}>{state.accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}</select></div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <button className="btn btn-ghost" onClick={() => setParsed(null)}>Discard</button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={confirm}><Icon name="check" size={16} />Add to ledger</button>
            </div>
          </div>
        )}
      </div>

      <div className="card card-pad fade-in">
        <div className="card-h"><div><div className="card-title">Try a sample email</div><div className="card-sub">Tap one to load it on the left</div></div></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {SAMPLE_EMAILS.map(s => (
            <button key={s.id} onClick={() => { setText(s.body); setParsed(null); setErr(""); }} className="sample-btn"
              style={{ textAlign: "left", border: "1px solid var(--border-soft)", background: "var(--surface-2)", borderRadius: 12, padding: "12px 14px", display: "flex", gap: 12, alignItems: "center" }}>
              <span className="txn-ico" style={{ width: 36, height: 36, background: "var(--surface-3)", fontSize: 15 }}><Icon name="mail" size={16} /></span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.subject}</div>
                <div style={{ fontSize: 11.5, color: "var(--text-3)", fontWeight: 600 }}>{s.from}</div>
              </div>
              <Icon name="chevronRight" size={16} style={{ color: "var(--text-3)" }} />
            </button>
          ))}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.55, marginTop: 14, borderTop: "1px solid var(--border-soft)", paddingTop: 12 }}>
          <Icon name="info" size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
          In Gmail, open an email → ⋮ → <b>Forward</b>, or just copy-paste the text here. The AI only sees what you paste — never your inbox.
        </div>
      </div>
    </div>
  );
}

/* ---------------- bulk ---------------- */
function BulkParse({ state, actions }) {
  const cur = state.displayCurrency;
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(0);
  const catList = [...FT.EXPENSE_CATS.map(c => `${c.id}`), ...FT.INCOME_CATS.map(c => `${c.id}`)].join(", ");

  async function parse() {
    if (!text.trim()) return;
    setLoading(true); setErr(""); setRows(null);
    const hints = FT.ownAccountHints(state);
    const ownLine = hints.length ? ` The user's own accounts/cards: ${hints.join(", ")}.` : "";
    const prompt = `Extract ALL financial transactions from this text (a bank statement or several pasted emails). Respond with ONLY a JSON array, no prose, no code fences.

Each item: {"type":"income"|"expense"|"transfer","amount":<number>,"currency":"INR"|"USD"|"EUR"|"GBP","merchant":"<string>","account":"<bank/card + last4 if present, else null>","date":"YYYY-MM-DD","category":"<id or 'transfer'>"}
"merchant" must be a SHORT, human-friendly label a person instantly recognizes — the brand, payee, or purpose. NEVER raw bank names, reference numbers, or codes. Examples: "Swiggy", "House rent", "Skoda car EMI", "Salary". For a credit-card bill payment, name it "<card name> bill" using the user's card list.
Valid category ids: ${catList}
AMOUNT RULE: each "amount" is the value of that single transaction only — never the available/credit limit, available balance, outstanding, or total due.
Detect currency from symbols (₹/Rs/INR, $/USD, €, £); default INR. Credits/salary/rent-received/refunds/dividends = income; the rest = expense. If money moves between the user's OWN accounts, or it's a credit-card bill payment from the user's own bank, set "type":"transfer" and "category":"transfer" (must NOT count as income/expense).${ownLine} If a year is missing, assume the current year. If a date is missing entirely, use ${FT.todayISO()}.

Text:
"""${text.slice(0, 3500)}"""`;
    try {
      let raw = (await window.claude.complete(prompt) || "").trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
      const m = raw.match(/\[[\s\S]*\]/);
      const arr = JSON.parse(m ? m[0] : raw);
      setRows(arr.map(o => {
        let type = o.type === "income" ? "income" : o.type === "transfer" ? "transfer" : "expense";
        if (type !== "transfer" && FT.looksLikeTransfer(o.merchant, state)) type = "transfer";
        const rawName = FT.bestMerchant(o.merchant, (o.merchant || "") + " " + (o.account || ""));
        const ren = FT.applyRenames(rawName, state);
        if (ren.category && FT.CAT_MAP[ren.category]) o.category = ren.category;
        return {
          id: FT.uid(), include: true, type,
          amount: Math.abs(+String(o.amount).replace(/[^0-9.]/g, "")) || 0,
          currency: FT.CUR[o.currency] ? o.currency : "INR",
          merchant: ren.name,
          date: /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : FT.todayISO(),
          category: type === "transfer" ? "transfer" : (FT.CAT_MAP[o.category] && o.category !== "transfer" ? o.category : "uncat"),
          account: resolveAcct((o.merchant || "") + " " + (o.account || ""), o.account, type, state),
        };
      }).filter(r => r.amount > 0));
    } catch (e) { setErr("Couldn't read that. Make sure each line has an amount, then try again."); }
    setLoading(false);
  }
  function importAll() {
    const existing = new Set((state.transactions || []).map(t => FT.txnKey(t)));
    const seen = new Set();
    const sel = []; let dupes = 0;
    rows.filter(r => r.include).forEach(r => {
      const key = FT.txnKey(r);
      if (existing.has(key) || seen.has(key)) { dupes++; return; }
      seen.add(key);
      sel.push(r);
    });
    sel.forEach(r => actions.addTxn({ id: FT.uid(), type: r.type, amount: r.amount, currency: r.currency, merchant: r.merchant, category: r.category, account: r.account, date: r.date, note: "Bulk import", source: "email" }));
    setRows(null); setText(""); setDone(sel.length);
  }
  const upd = (id, k, v) => setRows(rows.map(r => r.id === id ? { ...r, [k]: v } : r));
  const selCount = rows ? rows.filter(r => r.include).length : 0;

  return (
    <div className="grid" style={{ gap: 18 }}>
      <div className="grid" style={{ gridTemplateColumns: rows ? "1fr" : "1.1fr 1fr" }}>
        {!rows && <>
          <div className="card card-pad fade-in">
            <div className="card-h"><div className="card-title">Paste a statement or many emails</div>{done > 0 && <span className="pill pill-pos"><Icon name="check" size={13} />{done} imported</span>}</div>
            <textarea className="textarea" style={{ minHeight: 260, fontFamily: "var(--font)" }} placeholder="Paste several transactions — a bank statement, card summary, or a batch of forwarded emails…" value={text} onChange={e => setText(e.target.value)} />
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={parse} disabled={loading || !text.trim()}>{loading ? "Reading all rows…" : <><Icon name="wand" size={16} />Extract all transactions</>}</button>
              {text && <button className="btn btn-ghost" onClick={() => setText("")}>Clear</button>}
            </div>
            {err && <div style={{ marginTop: 12, fontSize: 13, color: "var(--warn)", fontWeight: 600 }}>{err}</div>}
            {loading && <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>{[95,80,88,72,90].map((w,i)=><div key={i} className="skel" style={{ height: 12, width: w+"%" }} />)}</div>}
          </div>
          <div className="card card-pad fade-in">
            <div className="card-h"><div><div className="card-title">How it works</div><div className="card-sub">One paste → many transactions</div></div></div>
            <ol style={{ fontSize: 13.5, color: "var(--text-2)", lineHeight: 1.7, paddingLeft: 18, margin: 0 }}>
              <li>Copy your card/bank statement rows, or forward a batch of emails and paste the text.</li>
              <li>The AI splits it into individual transactions and guesses type, currency and category.</li>
              <li>Review the table, untick anything you don't want, fix categories, and import in one click.</li>
            </ol>
            <button className="btn btn-sm" style={{ marginTop: 16 }} onClick={() => setText(BULK_SAMPLE)}><Icon name="sparkles" size={14} />Load a sample statement</button>
          </div>
        </>}

        {rows && (
          <div className="card card-pad fade-in">
            <div className="card-h">
              <div><div className="card-title">{rows.length} transactions found</div><div className="card-sub">{selCount} selected to import</div></div>
              <button className="btn btn-ghost btn-sm" onClick={() => setRows(null)}><Icon name="x" size={14} />Back</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {rows.map(r => {
                const cats = r.type === "income" ? FT.INCOME_CATS : FT.EXPENSE_CATS;
                return (
                  <div key={r.id} style={{ display: "grid", gridTemplateColumns: "26px 1.4fr 110px 96px 130px 110px", gap: 10, alignItems: "center", padding: "9px 6px", borderBottom: "1px solid var(--border-soft)", opacity: r.include ? 1 : .45 }}>
                    <button onClick={() => upd(r.id, "include", !r.include)} style={{ width: 20, height: 20, borderRadius: 6, border: "2px solid " + (r.include ? "var(--accent)" : "var(--border)"), background: r.include ? "var(--accent)" : "transparent", display: "grid", placeItems: "center" }}>{r.include && <Icon name="check" size={12} style={{ color: "#fff" }} />}</button>
                    <input className="input" style={{ padding: "7px 10px", fontSize: 13 }} value={r.merchant} onChange={e => upd(r.id, "merchant", e.target.value)} />
                    <div style={{ display: "flex", gap: 4 }}>
                      <input className="input num" style={{ padding: "7px 8px", fontSize: 13 }} type="number" value={r.amount} onChange={e => upd(r.id, "amount", +e.target.value)} />
                    </div>
                    <select className="select" style={{ padding: "7px 8px", fontSize: 12.5 }} value={r.currency} onChange={e => upd(r.id, "currency", e.target.value)}>{Object.keys(FT.CUR).map(c => <option key={c} value={c}>{c}</option>)}</select>
                    <select className="select" style={{ padding: "7px 8px", fontSize: 12.5 }} value={r.category} onChange={e => { const v = e.target.value; const t = v === "transfer" ? "transfer" : FT.INCOME_CATS.find(c=>c.id===v) ? "income" : "expense"; setRows(rows.map(x => x.id===r.id?{...x,category:v,type:t}:x)); }}>
                      <optgroup label="Expense">{FT.EXPENSE_CATS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>
                      <optgroup label="Income">{FT.INCOME_CATS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>
                      <optgroup label="Other"><option value="transfer">⇄ Transfer</option></optgroup>
                    </select>
                    <input className="input" style={{ padding: "7px 8px", fontSize: 12.5 }} type="date" value={r.date} onChange={e => upd(r.id, "date", e.target.value)} />
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={() => setRows(rows.map(r => ({ ...r, include: selCount < rows.length })))}>{selCount < rows.length ? "Select all" : "Deselect all"}</button>
              <button className="btn btn-primary" onClick={importAll} disabled={!selCount}><Icon name="check" size={16} />Import {selCount} transaction{selCount !== 1 ? "s" : ""}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { EmailImport });
