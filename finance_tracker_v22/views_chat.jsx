/* ============================================================
   views_chat.jsx — AI assistant grounded in the user's finances
   ============================================================ */
function financeContext(state) {
  const cur = state.displayCurrency;
  const nw = Compute.netWorth(state);
  const tm = Compute.thisMonth();
  const inc = Compute.sum(state, "income", tm), exp = Compute.sum(state, "expense", tm);
  const series = Compute.monthlySeries(state, 3);
  const avgInc = Math.round(series.reduce((s,m)=>s+m.income,0)/3), avgExp = Math.round(series.reduce((s,m)=>s+m.expense,0)/3);
  const accs = state.accounts.map(a => {
    const t = FT.acctType(a.type);
    return `${a.name} [${t.name}] ${FT.fmt(Compute.aBal(a,state),cur)}${t.yields&&a.rate?` @${a.rate}%${a.maturityDate?` mat ${a.maturityDate}`:""}`:""}`;
  }).join("; ") || "none";
  const cards = state.cards.map(c => {
    const def = FT.cardDef(c.cardType);
    return `${c.name} (limit ${FT.fmt(Compute.conv(c.limit||0,c.currency||"INR",state),cur)}, outstanding ${FT.fmt(Compute.conv(c.balance||0,c.currency||"INR",state),cur)}, stmt day ${c.billingDay}, due day ${c.dueDay})`;
  }).join("; ") || "none";
  const loans = state.loans.map(l => `${l.name||l.type} ${FT.fmt(Compute.conv(l.outstanding||0,l.currency||"INR",state),cur)} @${l.rate||"?"}% EMI ${FT.fmt(Compute.conv(l.emi||0,l.currency||"INR",state),cur)}`).join("; ") || "none";
  const catSpend = Compute.categoryBreakdown(state, "expense", tm).slice(0,8).map(b => `${b.label} ${FT.fmt(b.value,cur)}`).join(", ") || "none";
  const passive = state.accounts.reduce((s,a)=>s+(FT.acctType(a.type).yields&&a.rate?Compute.conv((a.balance||0)*a.rate/100,a.currency||"INR",state):0),0);
  const p = state.profile;
  return `USER FINANCIAL SNAPSHOT (display currency ${cur}):
Profile: ${p.name||"User"}, age ${p.age||"?"}, ${p.maritalStatus}, ${p.dependents} dependents, ${p.risk} risk appetite. Goals: ${p.goalsText||"—"}.
Net worth ${FT.fmt(nw.net,cur)} (assets ${FT.fmt(nw.assets,cur)}, liabilities ${FT.fmt(nw.liabilities,cur)}). Passive income ≈ ${FT.fmt(passive,cur)}/yr.
Cash flow: avg monthly income ${FT.fmt(avgInc,cur)}, expenses ${FT.fmt(avgExp,cur)}; this month income ${FT.fmt(inc,cur)}, expenses ${FT.fmt(exp,cur)}.
Accounts & assets: ${accs}.
Credit cards: ${cards}.
Loans: ${loans}.
Top spending this month: ${catSpend}.`;
}

const CHAT_SUGGESTIONS = [
  "How am I doing financially this month?",
  "Where can I cut back on spending?",
  "Should I prepay my loan or invest instead?",
  "How can I use my FD to build more assets?",
  "Am I over-concentrated in any asset?",
];

function ChatView({ state, actions }) {
  const KEYC = "ft_chat_" + ((function(){ try { return localStorage.getItem("ft_cloud_uid"); } catch (e) { return ""; } })() || state.profile.name || "u");
  const [msgs, setMsgs] = useState(() => { try { return JSON.parse(localStorage.getItem(KEYC) || "[]"); } catch (e) { return []; } });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef(null);
  useEffect(() => { try { localStorage.setItem(KEYC, JSON.stringify(msgs.slice(-40))); } catch (e) {} if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }, [msgs, busy]);

  async function send(text) {
    const q = (text != null ? text : input).trim(); if (!q || busy) return;
    setInput(""); setBusy(true);
    const next = [...msgs, { role: "user", text: q }];
    setMsgs(next);
    const history = next.slice(-8).map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`).join("\n");
    const prompt = `You are this person's personal finance assistant inside their tracker app. Answer using ONLY the snapshot below plus general financial knowledge. Be specific, reference their actual numbers, and use ${state.displayCurrency} and Indian context (FDs, PPF, ELSS, index funds, NPS, etc.). Keep answers tight (under 180 words) and practical. If asked about leverage/loans-against-assets, include the risk. You are educational, not a SEBI-registered advisor.

${financeContext(state)}

Conversation so far:
${history}

Answer the user's last message.`;
    try { const r = await window.claude.complete(prompt); setMsgs(m => [...m, { role: "assistant", text: r || "—" }]); }
    catch (e) { setMsgs(m => [...m, { role: "assistant", text: "I couldn't reach the AI just now. Make sure the AI service is connected (Settings → AI service), then try again.", err: true }]); }
    setBusy(false);
  }

  return (
    <div className="card fade-in" style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 150px)", overflow: "hidden" }}>
      <div ref={scroller} style={{ flex: 1, overflowY: "auto", padding: "22px 22px 8px" }}>
        {!msgs.length && (
          <div style={{ maxWidth: 560, margin: "30px auto", textAlign: "center" }}>
            <span className="kpi-ico" style={{ background: "var(--accent-soft)", color: "var(--accent)", width: 48, height: 48, margin: "0 auto" }}><Icon name="wand" size={24} /></span>
            <div className="display" style={{ fontSize: 22, fontWeight: 600, marginTop: 14 }}>Ask anything about your money</div>
            <div style={{ fontSize: 13.5, color: "var(--text-2)", marginTop: 8, lineHeight: 1.6 }}>I can see your net worth, accounts, cards, loans, FDs and spending — ask away.</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 20 }}>
              {CHAT_SUGGESTIONS.map(s => <button key={s} className="chip" onClick={() => send(s)}>{s}</button>)}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} style={{ display: "flex", gap: 11, marginBottom: 16, flexDirection: m.role === "user" ? "row-reverse" : "row" }}>
            <div className="acct-avatar" style={{ width: 30, height: 30, fontSize: 13, flexShrink: 0, background: m.role === "user" ? "var(--surface-3)" : "linear-gradient(150deg,var(--accent),var(--accent-deep))", color: m.role === "user" ? "var(--text)" : "#fff" }}>{m.role === "user" ? (state.profile.name||"U")[0].toUpperCase() : <Icon name="wand" size={15} />}</div>
            <div style={{ maxWidth: "76%", background: m.role === "user" ? "var(--accent)" : "var(--surface-2)", color: m.role === "user" ? "#04140d" : (m.err ? "var(--warn)" : "var(--text)"), padding: "11px 15px", borderRadius: 14, fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap", fontWeight: m.role === "user" ? 600 : 400 }}>{m.role === "assistant" ? <Rich text={m.text} /> : m.text}</div>
          </div>
        ))}
        {busy && <div style={{ display: "flex", gap: 11, marginBottom: 16 }}>
          <div className="acct-avatar" style={{ width: 30, height: 30, background: "linear-gradient(150deg,var(--accent),var(--accent-deep))", color: "#fff" }}><Icon name="wand" size={15} /></div>
          <div style={{ background: "var(--surface-2)", padding: "13px 16px", borderRadius: 14, display: "flex", gap: 5 }}>
            {[0,1,2].map(i => <span key={i} style={{ width: 7, height: 7, borderRadius: 99, background: "var(--text-3)", animation: `blink 1s ${i*0.2}s infinite` }}></span>)}
          </div>
        </div>}
      </div>
      <div style={{ borderTop: "1px solid var(--border-soft)", padding: 14, display: "flex", gap: 10 }}>
        <input className="input" placeholder="Ask about your finances…" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} />
        <button className="btn btn-primary" onClick={() => send()} disabled={busy || !input.trim()}><Icon name="send" size={16} /></button>
        {msgs.length > 0 && <button className="btn btn-ghost btn-icon" title="Clear chat" onClick={() => { setMsgs([]); try { localStorage.removeItem(KEYC); } catch(e){} }}><Icon name="trash" size={16} /></button>}
      </div>
    </div>
  );
}

function Rich({ text }) {
  // render **bold** and bullet lines as light markdown
  const lines = String(text).split("\n");
  return lines.map((ln, i) => {
    const bullet = /^\s*[•\-\*]\s+/.test(ln);
    const body = ln.replace(/^\s*[•\-\*]\s+/, "");
    const parts = body.split(/(\*\*[^*]+\*\*)/g).map((seg, j) =>
      /^\*\*[^*]+\*\*$/.test(seg) ? <strong key={j}>{seg.slice(2, -2)}</strong> : seg);
    return <div key={i} style={bullet ? { display: "flex", gap: 7, paddingLeft: 2 } : (ln.trim() === "" ? { height: 7 } : null)}>
      {bullet && <span style={{ color: "var(--accent)", flexShrink: 0 }}>•</span>}<span>{parts}</span>
    </div>;
  });
}

Object.assign(window, { ChatView, financeContext, Rich });