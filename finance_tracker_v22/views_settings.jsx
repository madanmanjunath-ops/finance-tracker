/* ============================================================
   views_settings.jsx — settings, profile editor, export
   ============================================================ */
function ProfileModal({ profile, onClose, onSave }) {
  const [f, setF] = useState({ ...profile });
  const set = (k, v) => setF({ ...f, [k]: v });
  return (
    <Modal title="Your financial profile" onClose={onClose} wide
      foot={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => onSave(f)}><Icon name="check" size={16} />Save profile</button>
      </>}>
      <div className="modal-body">
        <div style={{ fontSize: 12.5, color: "var(--text-3)", fontWeight: 600 }}>These details personalise your investment suggestions. Everything stays on your device.</div>
        <div className="row" style={{ gap: 14 }}>
          <div className="field" style={{ flex: 2 }}><label className="label">Name</label><input className="input" value={f.name} onChange={e => set("name", e.target.value)} /></div>
          <div className="field" style={{ flex: 1 }}><label className="label">Age</label><input className="input num" type="number" value={f.age} onChange={e => set("age", +e.target.value)} /></div>
        </div>
        <div className="row" style={{ gap: 14 }}>
          <div className="field" style={{ flex: 1 }}><label className="label">Marital status</label>
            <select className="select" value={f.maritalStatus} onChange={e => set("maritalStatus", e.target.value)}>
              {["Single", "Married", "Divorced", "Widowed"].map(o => <option key={o}>{o}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}><label className="label">Dependents</label><input className="input num" type="number" min="0" value={f.dependents} onChange={e => set("dependents", +e.target.value)} /></div>
        </div>
        <div className="field"><label className="label">Risk appetite</label>
          <div className="seg" style={{ width: "100%" }}>
            {["Conservative", "Moderate", "Aggressive"].map(r => <button key={r} style={{ flex: 1 }} className={f.risk === r ? "on" : ""} onClick={() => set("risk", r)}>{r}</button>)}
          </div>
        </div>
        <div className="field"><label className="label">Approx. monthly income</label><input className="input num" type="number" value={f.monthlyIncome} onChange={e => set("monthlyIncome", +e.target.value)} /></div>
        <div className="field"><label className="label">Current investments</label><textarea className="textarea" style={{ minHeight: 70 }} value={f.currentInvestments} onChange={e => set("currentInvestments", e.target.value)} placeholder="e.g. Equity MFs ₹5L, stocks ₹6L, PPF ₹3L…" /></div>
        <div className="field"><label className="label">Financial goals</label><textarea className="textarea" style={{ minHeight: 70 }} value={f.goalsText} onChange={e => set("goalsText", e.target.value)} placeholder="e.g. Buy a house in 5 years, retire by 55…" /></div>
      </div>
    </Modal>
  );
}

function RecurringModal({ state, onClose, onSave }) {
  const [items, setItems] = useState(state.recurring.map(r => ({ ...r })));
  const add = () => setItems([...items, { id: FT.uid(), name: "", amount: 0, cat: "subs", day: 1 }]);
  const upd = (i, k, v) => setItems(items.map((x, j) => j === i ? { ...x, [k]: v } : x));
  const del = (i) => setItems(items.filter((_, j) => j !== i));
  return (
    <Modal title="Recurring bills" onClose={onClose} wide
      foot={<>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => onSave(items.filter(i => i.name.trim() && i.amount > 0))}><Icon name="check" size={16} />Save</button>
      </>}>
      <div className="modal-body" style={{ gap: 10 }}>
        {items.map((r, i) => (
          <div key={r.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input className="input" style={{ flex: 2 }} placeholder="Name" value={r.name} onChange={e => upd(i, "name", e.target.value)} />
            <input className="input num" style={{ flex: 1 }} type="number" placeholder="Amount" value={r.amount || ""} onChange={e => upd(i, "amount", +e.target.value)} />
            <select className="select" style={{ flex: 1.3 }} value={r.cat} onChange={e => upd(i, "cat", e.target.value)}>{FT.EXPENSE_CATS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <input className="input num" style={{ width: 64 }} type="number" min="1" max="28" title="Day of month" value={r.day} onChange={e => upd(i, "day", +e.target.value)} />
            <button className="btn btn-icon btn-ghost" onClick={() => del(i)}><Icon name="trash" size={15} /></button>
          </div>
        ))}
        <button className="btn btn-sm" onClick={add} style={{ alignSelf: "flex-start" }}><Icon name="plus" size={15} />Add bill</button>
      </div>
    </Modal>
  );
}

function download(name, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Settings({ state, actions, cloud }) {
  const cur = state.displayCurrency;
  const [showRec, setShowRec] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const aiMode = (typeof window !== "undefined" && window.__AI_MODE) || "studio";
  const [aiKey, setAiKey] = useState(() => { try { return localStorage.getItem("ft_ai_access_key") || ""; } catch (e) { return ""; } });
  const [aiSaved, setAiSaved] = useState(false);
  const [aiTest, setAiTest] = useState(null);
  const [aiMsg, setAiMsg] = useState("");
  function saveAiKey() { try { localStorage.setItem("ft_ai_access_key", aiKey.trim()); } catch (e) {} setAiSaved(true); setTimeout(() => setAiSaved(false), 1800); }
  async function testAi() {
    saveAiKey(); setAiTest("testing"); setAiMsg("");
    try {
      const r = await window.claude.complete("Reply with exactly: OK");
      if (r && r.toUpperCase().includes("OK")) { setAiTest("ok"); setAiMsg("Connected — the AI features are live."); }
      else { setAiTest("ok"); setAiMsg("Connected. Response: " + String(r).slice(0, 60)); }
    } catch (e) { setAiTest("fail"); setAiMsg(e.message || "Connection failed."); }
  }

  function exportJSON() { download("finance-tracker-backup.json", JSON.stringify(state, null, 2), "application/json"); }
  function exportCSV() {
    const rows = [["Date", "Type", "Category", "Merchant", "Amount", "Currency", "Amount (" + cur + ")", "Account", "Source", "Note"]];
    state.transactions.forEach(t => rows.push([t.date, t.type, FT.catOf(t.category).name, t.merchant, t.amount, t.currency || "INR", Math.round(Compute.tAmt(t, state)), (state.accounts.find(a => a.id === t.account) || {}).name || "", t.source, (t.note || "").replace(/,/g, ";")]));
    download("transactions.csv", rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n"), "text/csv");
  }

  const Section = ({ title, sub, children }) => (
    <div className="card card-pad fade-in">
      <div className="card-h"><div><div className="card-title">{title}</div>{sub && <div className="card-sub">{sub}</div>}</div></div>
      {children}
    </div>
  );

  return (
    <div className="grid" style={{ gap: 18, maxWidth: 820 }}>
      {cloud && (
        <Section title="Account & sync" sub={cloud.on ? "Your data syncs securely across your devices" : "Cloud sync is not configured for this site"}>
          {cloud.on && cloud.user ? (
            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <div className="acct-avatar" style={{ width: 42, height: 42, fontSize: 17 }}>{(cloud.user.email || "?")[0].toUpperCase()}</div>
              <div style={{ flex: 1, minWidth: 160 }}>
                <div style={{ fontWeight: 700, fontSize: 14.5 }}>{cloud.user.email}</div>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: cloud.sync === "error" ? "var(--neg)" : "var(--pos)", marginTop: 2 }}>
                  {cloud.sync === "synced" ? "✓ All changes synced to the cloud" : cloud.sync === "saving" || cloud.sync === "loading" ? "Syncing…" : cloud.sync === "error" ? "Sync error — will retry automatically" : "Connected"}
                </div>
              </div>
              <button className="btn" onClick={cloud.signOut}><Icon name="arrowUpRight" size={15} />Sign out</button>
            </div>
          ) : (
            <CloudSetup />
          )}
        </Section>
      )}

      <Section title="Profile" sub="Drives your investment suggestions">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Field label="Name" v={state.profile.name} />
          <Field label="Age" v={state.profile.age + " years"} />
          <Field label="Marital status" v={state.profile.maritalStatus} />
          <Field label="Dependents" v={state.profile.dependents} />
          <Field label="Risk appetite" v={state.profile.risk} />
          <Field label="Monthly income" v={FT.fmt(state.profile.monthlyIncome, cur)} />
        </div>
        <button className="btn btn-sm" style={{ marginTop: 16 }} onClick={() => actions.openProfile()}><Icon name="edit" size={14} />Edit profile</button>
      </Section>

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <Section title="Display currency" sub="All totals & charts convert to this">
          <div className="chips">
            {[["INR", "₹ Rupee"], ["USD", "$ Dollar"], ["EUR", "€ Euro"], ["GBP", "£ Pound"]].map(([c, l]) => (
              <button key={c} className={"chip" + (cur === c ? " sel" : "")} onClick={() => actions.setCurrency(c)}>{l}</button>
            ))}
          </div>
        </Section>
        <Section title="Appearance">
          <div className="seg" style={{ width: "100%" }}>
            <button style={{ flex: 1 }} className={state.theme === "light" ? "on" : ""} onClick={() => actions.setTheme("light")}><Icon name="sun" size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />Light</button>
            <button style={{ flex: 1 }} className={state.theme === "dark" ? "on" : ""} onClick={() => actions.setTheme("dark")}><Icon name="moon" size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />Dark</button>
          </div>
        </Section>
      </div>

      <Section title="Exchange rates" sub={`Manual rates — value of 1 unit in ${cur}. Used to convert foreign accounts & income.`}>
        <div className="chips">
          {Object.keys(FT.CUR).filter(c => c !== cur).map(c => (
            <div key={c} style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 10, padding: "7px 11px" }}>
              <span style={{ fontWeight: 800, fontSize: 13 }}>1 {c} =</span>
              <input className="input num" style={{ width: 92, padding: "6px 8px", fontSize: 13 }} type="number" value={(state.fx[c] / state.fx[cur]).toFixed(2)} onChange={e => actions.setFx(c, +e.target.value)} />
              <span style={{ fontWeight: 700, fontSize: 13, color: "var(--text-2)" }}>{cur}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Daily email & Gmail import" sub="Morning snapshot + auto-capture transactions from email">
        <DailyAndGmail state={state} actions={actions} />
      </Section>

      <Section title="Friendly names" sub={`${(state.renameRules || []).length} rule${(state.renameRules || []).length !== 1 ? "s" : ""} — rename raw bank text into labels you recognize, on every future import`}>
        <RenameRules state={state} actions={actions} />
      </Section>

      <Section title="Recurring bills" sub={`${state.recurring.length} tracked — power your upcoming-bills feed`}>
        <div className="chips">
          {state.recurring.map(r => <span key={r.id} className="chip" style={{ cursor: "default" }}>{FT.catOf(r.cat).emoji} {r.name} · {FT.fmt(r.amount, cur)} · {r.day}{["th","st","nd","rd"][(r.day%10>3||[11,12,13].includes(r.day%100))?0:r.day%10]}</span>)}
        </div>
        <button className="btn btn-sm" style={{ marginTop: 14 }} onClick={() => setShowRec(true)}><Icon name="repeat" size={14} />Manage recurring</button>
      </Section>

      <Section title="AI service" sub="Powers email parsing, bulk import & the investment coach">
        {aiMode === "studio" ? (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13, color: "var(--text-2)", lineHeight: 1.6 }}>
            <span className="kpi-ico" style={{ background: "var(--accent-soft)", color: "var(--accent)", width: 30, height: 30, flexShrink: 0 }}><Icon name="sparkles" size={15} /></span>
            <div>Running inside the Claude design studio — AI features work out of the box here. Once you deploy to your own site, this section lets you connect your serverless AI proxy. See <b>DEPLOY.md</b> in the project for the full guide.</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.6 }}>
              Your hosted site talks to the AI through your serverless proxy. If you locked it with an <b>APP_SECRET</b>, paste the same value here so your account is the only one that can use it.
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div className="field" style={{ flex: "1 1 240px" }}>
                <label className="label">AI access key <span style={{ color: "var(--text-3)", fontWeight: 500 }}>(optional)</span></label>
                <input className="input" type="password" placeholder="Matches APP_SECRET on your host" value={aiKey} onChange={e => setAiKey(e.target.value)} />
              </div>
              <button className="btn" onClick={saveAiKey}>{aiSaved ? <><Icon name="check" size={15} />Saved</> : "Save key"}</button>
              <button className="btn btn-primary" onClick={testAi} disabled={aiTest === "testing"}>{aiTest === "testing" ? "Testing…" : <><Icon name="wand" size={15} />Test connection</>}</button>
            </div>
            {aiTest && aiTest !== "testing" && (
              <div style={{ fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 7, color: aiTest === "ok" ? "var(--pos)" : "var(--neg)" }}>
                <Icon name={aiTest === "ok" ? "check" : "info"} size={15} />{aiMsg}
              </div>
            )}
          </div>
        )}
      </Section>

      <Section title="Your data" sub={cloud && cloud.on ? "Synced to your account — and cached in this browser" : "Stored privately in this browser (localStorage) — not on a server"}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn" onClick={exportCSV}><Icon name="download" size={15} />Export transactions (CSV)</button>
          <button className="btn" onClick={exportJSON}><Icon name="download" size={15} />Backup all data (JSON)</button>
          {(() => {
            const seen = new Set(); const fseen = new Set(); let d = 0;
            state.transactions.forEach(t => {
              const k = FT.txnKey(t);
              if (seen.has(k)) { d++; return; } seen.add(k);
              const fk = [t.date, t.type, (+t.amount).toFixed(2)].join("|");
              if (t.source === "gmail" && +t.amount >= 1000 && fseen.has(fk)) { d++; return; }
              fseen.add(fk);
            });
            return d > 0 ? <button className="btn" style={{ color: "var(--warn)" }} onClick={() => actions.removeDuplicates()}><Icon name="repeat" size={15} />Remove {d} duplicate{d !== 1 ? "s" : ""}</button> : null;
          })()}
          {!confirmReset
            ? <button className="btn btn-ghost" style={{ color: "var(--neg)", marginLeft: "auto" }} onClick={() => setConfirmReset(true)}><Icon name="trash" size={15} />Reset to sample data</button>
            : <span style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}><span style={{ fontSize: 13, fontWeight: 700 }}>Sure?</span><button className="btn btn-sm" onClick={() => setConfirmReset(false)}>Cancel</button><button className="btn btn-sm" style={{ background: "var(--neg)", color: "#fff" }} onClick={() => actions.resetAll()}>Reset everything</button></span>}
        </div>
      </Section>

      <div style={{ fontSize: 11.5, color: "var(--text-3)", textAlign: "center", lineHeight: 1.6, padding: "4px 0 10px" }}>
        Finance Tracker · a private, offline personal tool · v1.0<br />
        Investment guidance is educational only and not a substitute for a registered financial advisor.
      </div>

      {showRec && <RecurringModal state={state} onClose={() => setShowRec(false)} onSave={(r) => { actions.setRecurring(r); setShowRec(false); }} />}
    </div>
  );
}

/* ---------- Friendly names: rule manager + AI suggestions ---------- */
function RenameRules({ state, actions }) {
  const rules = state.renameRules || [];
  const [match, setMatch] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [props_, setProps] = useState(null); // AI proposals under review
  const cardpayCount = state.transactions.filter(t => t.type === "expense" && t.category === "cardpay").length;

  function addRule() {
    if (!match.trim() || !name.trim()) return;
    actions.setRenameRules([...rules, { id: FT.uid(), match: match.trim(), name: name.trim() }]);
    setMatch(""); setName("");
  }

  async function suggest() {
    setBusy(true); setErr(""); setProps(null);
    // distinct raw-looking merchant strings (codes, ALL CAPS, bank-speak)
    const seen = new Set(); const raw = [];
    state.transactions.forEach(t => {
      const m = (t.merchant || "").trim();
      if (!m || seen.has(m.toLowerCase())) return;
      seen.add(m.toLowerCase());
      const rawLooking = /[A-Z]{4,}|[0-9]{4,}|\bbank\b|\bltd\b|\bfinancial\b|\bpvt\b|\/|-{2,}/i.test(m) || m.length > 26;
      if (rawLooking) raw.push(m);
    });
    if (!raw.length) { setErr("Nothing looks like raw bank text — your descriptions already seem clean."); setBusy(false); return; }
    const cards = (state.cards || []).map(c => c.name).filter(Boolean).join(", ");
    const accts = (state.accounts || []).map(a => a.name).filter(Boolean).join(", ");
    const prompt = `These are raw transaction descriptions from an Indian user's bank feeds. Suggest a SHORT human-friendly name for each — the brand, payee or purpose a person would instantly recognize. Use the user's own card/account names where relevant (cards: ${cards || "none"}; accounts: ${accts || "none"}). For credit-card bill payments use "<card name> bill". If a description is already clear, omit it. Respond ONLY a JSON array: [{"raw":"<exact original>","name":"<friendly>"}]

Descriptions:
${raw.slice(0, 40).map(m => "- " + m).join("\n")}`;
    try {
      let out = (await window.claude.complete(prompt) || "").trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
      const m = out.match(/\[[\s\S]*\]/);
      const arr = JSON.parse(m ? m[0] : out).filter(p => p.raw && p.name && p.raw !== p.name);
      if (!arr.length) { setErr("No improvements suggested."); setBusy(false); return; }
      setProps(arr.map(p => ({ ...p, id: FT.uid(), include: true })));
    } catch (e) { setErr("Couldn't get AI suggestions right now. You can still add rules manually below."); }
    setBusy(false);
  }

  function applyProposals() {
    const sel = props_.filter(p => p.include && p.name.trim());
    actions.addRulesAndApply(sel.map(p => ({ id: p.id, match: p.raw, name: p.name.trim() })));
    setProps(null);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {rules.length > 0 && (
        <table className="ltable">
          <thead><tr><th>When description contains</th><th>Rename to</th><th style={{ width: 40 }}></th></tr></thead>
          <tbody>
            {rules.map(r => (
              <tr key={r.id}>
                <td className="lt-mut">{r.match}</td>
                <td style={{ fontWeight: 650 }}>{r.name}</td>
                <td style={{ textAlign: "center" }}><button className="btn btn-icon btn-ghost" style={{ width: 24, height: 24 }} onClick={() => actions.setRenameRules(rules.filter(x => x.id !== r.id))}><Icon name="x" size={13} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input className="input" style={{ flex: "1 1 180px", padding: "8px 11px", fontSize: 13 }} placeholder="When description contains… e.g. Federal Bank / Scapia" value={match} onChange={e => setMatch(e.target.value)} />
        <Icon name="arrowRight" size={14} style={{ color: "var(--text-3)" }} />
        <input className="input" style={{ flex: "1 1 150px", padding: "8px 11px", fontSize: 13 }} placeholder="Rename to… e.g. Scapia card bill" value={name} onChange={e => setName(e.target.value)} />
        <button className="btn btn-sm" onClick={addRule} disabled={!match.trim() || !name.trim()}><Icon name="plus" size={14} />Add rule</button>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn btn-sm" onClick={suggest} disabled={busy}><Icon name="sparkles" size={14} />{busy ? "Scanning…" : "Suggest with AI"}</button>
        {rules.length > 0 && <button className="btn btn-sm" onClick={() => actions.applyRulesToExisting()}><Icon name="check" size={14} />Apply rules to existing</button>}
        {cardpayCount > 0 && <button className="btn btn-sm" style={{ color: "var(--warn)" }} onClick={() => actions.convertCardpayToTransfers()}><Icon name="repeat" size={14} />Convert {cardpayCount} card bill{cardpayCount !== 1 ? "s" : ""} to transfers</button>}
      </div>
      {err && <div style={{ fontSize: 12.5, color: "var(--warn)", fontWeight: 600 }}>{err}</div>}
      {props_ && (
        <Modal title={`AI suggestions · ${props_.filter(p => p.include).length} selected`} onClose={() => setProps(null)}
          foot={<>
            <button className="btn btn-ghost" onClick={() => setProps(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={applyProposals} disabled={!props_.some(p => p.include)}><Icon name="check" size={15} />Create rules & rename existing</button>
          </>}>
          <div className="modal-body" style={{ gap: 0, overflowY: "auto", flex: 1, minHeight: 0 }}>
            <div style={{ fontSize: 12.5, color: "var(--text-2)", marginBottom: 10 }}>Untick anything wrong; edit names freely. These become rules, so future imports are renamed automatically.</div>
            <div>
              {props_.map(p => (
                <div key={p.id} style={{ display: "grid", gridTemplateColumns: "20px 1fr 1fr", gap: 8, alignItems: "center", padding: "5px 0", borderBottom: "1px solid var(--border-soft)", opacity: p.include ? 1 : .4 }}>
                  <button onClick={() => setProps(props_.map(x => x.id === p.id ? { ...x, include: !x.include } : x))} style={{ width: 17, height: 17, borderRadius: 5, border: "2px solid " + (p.include ? "var(--accent)" : "var(--border)"), background: p.include ? "var(--accent)" : "transparent", display: "grid", placeItems: "center" }}>{p.include && <Icon name="check" size={10} style={{ color: "#fff" }} />}</button>
                  <span style={{ fontSize: 11.5, color: "var(--text-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={p.raw}>{p.raw}</span>
                  <input className="input" style={{ padding: "4px 8px", fontSize: 12, minHeight: 0, height: 28, borderRadius: 6 }} value={p.name} onChange={e => setProps(props_.map(x => x.id === p.id ? { ...x, name: e.target.value } : x))} />
                </div>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Field({ label, v }) {
  return <div><div style={{ fontSize: 11.5, color: "var(--text-3)", fontWeight: 700, marginBottom: 3 }}>{label}</div><div style={{ fontWeight: 700, fontSize: 14.5 }}>{v}</div></div>;
}

function DailyAndGmail({ state, actions }) {
  const n = state.notify || {};
  const g = state.gmail || {};
  const origin = (typeof window !== "undefined" && window.location && window.location.origin) || "https://YOUR-SITE.netlify.app";
  const webhook = origin + "/api/ingest";
  const [copied, setCopied] = useState("");
  const copy = (txt, what) => { try { navigator.clipboard.writeText(txt); setCopied(what); setTimeout(() => setCopied(""), 1500); } catch (e) {} };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      {/* daily email */}
      <div>
        <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}><Icon name="mail" size={16} style={{ color: "var(--accent)" }} />Daily snapshot email</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="field" style={{ flex: "1 1 240px" }}><label className="label">Send to</label><input className="input" type="email" placeholder="you@example.com" value={n.email || ""} onChange={e => actions.setNotify({ email: e.target.value })} /></div>
          <div className="field" style={{ width: 110 }}><label className="label">Time</label><input className="input" type="time" value={n.time || "07:15"} onChange={e => actions.setNotify({ time: e.target.value })} /></div>
          <button className="btn" onClick={() => actions.setNotify({ enabled: !n.enabled })} style={n.enabled ? { background: "var(--accent)", color: "#04140d", borderColor: "transparent" } : null}><Icon name={n.enabled ? "check" : "bell"} size={15} />{n.enabled ? "On" : "Off"}</button>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 8, lineHeight: 1.5 }}>Net worth, spend vs budget, best card today, upcoming dues and an AI tip — every morning. <b>Time is fixed to 7:15 AM IST by the server schedule</b> (changing it here is cosmetic until you adjust the schedule in <code>netlify.toml</code>). Requires the Resend setup in DAILY-EMAIL-SETUP.md.</div>
      </div>

      {/* gmail import */}
      <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 18 }}>
        <div style={{ fontWeight: 800, fontSize: 13.5, marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}><Icon name="download" size={16} style={{ color: "var(--accent)" }} />Gmail auto-import</div>
        <div style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.6, marginBottom: 12 }}>A Google Apps Script (runs in your own account) forwards bank emails here. Generate your token, paste it + the webhook URL into the script. Full steps in <b>GMAIL-SETUP.md</b>.</div>
        {!g.token ? (
          <button className="btn btn-primary btn-sm" onClick={actions.genIngestToken}><Icon name="sparkles" size={15} />Generate my ingest token</button>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <CopyRow label="Webhook URL" value={webhook} onCopy={() => copy(webhook, "url")} copied={copied === "url"} />
            <CopyRow label="Ingest token" value={g.token} onCopy={() => copy(g.token, "tok")} copied={copied === "tok"} secret />
            <div className="field"><label className="label">Auto-book when AI confidence ≥ {g.autoThreshold != null ? g.autoThreshold : 85}%</label>
              <input type="range" min="50" max="100" step="5" value={g.autoThreshold != null ? g.autoThreshold : 85} onChange={e => actions.setGmail({ autoThreshold: +e.target.value })} style={{ width: "100%", accentColor: "var(--accent)" }} />
              <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>Higher-confidence emails post straight to your ledger (tagged "auto"); the rest wait in your <b>Review inbox</b>. Set to 100% to review everything.</div>
            </div>
            <button className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start", color: "var(--neg)" }} onClick={actions.genIngestToken}><Icon name="repeat" size={14} />Regenerate token</button>
          </div>
        )}
      </div>
    </div>
  );
}

function CopyRow({ label, value, onCopy, copied, secret }) {
  return (
    <div className="field">
      <label className="label">{label}</label>
      <div style={{ display: "flex", gap: 8 }}>
        <input className="input num" readOnly value={value} type={secret ? "password" : "text"} style={{ fontFamily: "ui-monospace, monospace", fontSize: 12.5 }} onFocus={e => e.target.select()} />
        <button className="btn" onClick={onCopy}>{copied ? <><Icon name="check" size={15} />Copied</> : "Copy"}</button>
      </div>
    </div>
  );
}

/* In-app Supabase setup — paste URL + anon key, no file editing needed */
function CloudSetup() {
  const sdkOk = typeof Cloud !== "undefined" && Cloud.sdkReady && Cloud.sdkReady();
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function connect() {
    setErr("");
    const u = url.trim(), k = key.trim();
    if (!/^https:\/\/.+\.supabase\.co/.test(u)) { setErr("That doesn't look like a Project URL. It should look like https://abcd1234.supabase.co"); return; }
    if (k.length < 30) { setErr("That anon key looks too short — copy the full 'anon public' key from Supabase → Project Settings → API."); return; }
    setBusy(true);
    // quick reachability check before committing
    try {
      const test = window.supabase.createClient(u, k);
      await test.auth.getSession(); // resolves if URL/key are well-formed
    } catch (e) {
      setBusy(false); setErr("Could not connect with those values. Double-check the URL and anon key.");
      return;
    }
    Cloud.configure(u, k);
    setErr(""); 
    // reload so the app boots into cloud mode and shows the login screen
    setTimeout(() => window.location.reload(), 200);
  }

  if (!sdkOk) {
    return <div style={{ fontSize: 13, color: "var(--warn)", fontWeight: 600 }}>The Supabase library didn't load. Check your internet connection and refresh.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13, color: "var(--text-2)", lineHeight: 1.6 }}>
        <span className="kpi-ico" style={{ background: "var(--accent-soft)", color: "var(--accent)", width: 30, height: 30, flexShrink: 0 }}><Icon name="wallet" size={15} /></span>
        <div>You're in <b>local-only</b> mode. To turn on login + multi-device sync, paste your two Supabase values below — no file editing needed. (From Supabase → <b>Project Settings → API</b>.) Full walkthrough in <b>SUPABASE-SETUP.md</b>.</div>
      </div>
      <div className="field">
        <label className="label">Project URL</label>
        <input className="input" placeholder="https://abcd1234.supabase.co" value={url} onChange={e => setUrl(e.target.value)} spellCheck={false} autoCapitalize="none" />
      </div>
      <div className="field">
        <label className="label">anon public key</label>
        <input className="input" placeholder="eyJhbGciOi… (the long 'anon public' key)" value={key} onChange={e => setKey(e.target.value)} spellCheck={false} autoCapitalize="none" />
      </div>
      {err && <div style={{ fontSize: 13, color: "var(--neg)", fontWeight: 700, display: "flex", alignItems: "center", gap: 7 }}><Icon name="info" size={15} />{err}</div>}
      <div>
        <button className="btn btn-primary" onClick={connect} disabled={busy}>{busy ? "Connecting…" : <><Icon name="wallet" size={16} />Connect cloud sync</>}</button>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.5 }}>
        <Icon name="info" size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
        These two values are safe to use in the browser — your data is protected by the security rules you ran in Supabase, so each account only ever sees its own data.
      </div>
    </div>
  );
}

Object.assign(window, { Settings, ProfileModal, RecurringModal });
