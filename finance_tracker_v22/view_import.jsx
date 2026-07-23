/* ============================================================
   views_import.jsx — import history: Excel/CSV, Money Manager,
   PDF statements (pdf.js + AI), and the email parser tab.
   v1
   ============================================================ */
if (window.pdfjsLib) { try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js"; } catch (e) {} }

/* map free-text category → our category id */
function matchCategory(text, type) {
  const s = (text || "").toLowerCase();
  const list = type === "income" ? FT.INCOME_CATS : FT.EXPENSE_CATS;
  const exact = list.find(c => c.name.toLowerCase() === s || c.id === s);
  if (exact) return exact.id;
  const kw = type === "income"
    ? [["salary","salary"],["consult","freelance"],["freelance","freelance"],["business","business_inc"],["rent","rental_inc"],["interest","interest"],["dividend","dividend"],["refund","refund"]]
    : [["food","dining"],["dining","dining"],["restaurant","dining"],["grocery","groceries"],["groceries","groceries"],["fuel","fuel"],["petrol","fuel"],["transport","transport"],["cab","transport"],["uber","transport"],["shop","online"],["amazon","online"],["online","online"],["entertain","entertainment"],["movie","entertainment"],["bill","bills"],["util","bills"],["electric","bills"],["travel","travel"],["flight","travel"],["hotel","travel"],["health","health"],["medic","health"],["pharma","health"],["staff","staff"],["salary","staff"],["rent","rent"],["emi","emi"],["loan","emi"],["subscri","subs"],["card","cardpay"],["invest","invest"],["sip","invest"]];
  for (const [k, id] of kw) if (s.includes(k)) return id;
  return type === "income" ? "other_inc" : "misc";
}

function normalizeDate(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  if (typeof v === "number") { // excel serial
    if (v < 20000 || v > 80000) return null; // out of plausible date range → treat as amount, not date
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return isNaN(d) ? null : d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (!s) return null;
  const MON = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  let m;
  // ISO: 2023-08-05 or 2023/8/5
  m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;
  // 05-Aug-2023 / 5 Aug 23 / 05/Aug/2023  (day month-name year)
  m = s.match(/^(\d{1,2})[ \-/]([A-Za-z]{3,})[ \-/](\d{2,4})/);
  if (m && MON[m[2].slice(0,3).toLowerCase()]) {
    let y = m[3].length === 2 ? "20" + m[3] : m[3];
    return `${y}-${String(MON[m[2].slice(0,3).toLowerCase()]).padStart(2,"0")}-${m[1].padStart(2,"0")}`;
  }
  // Aug 05, 2023 / Aug 5 2023  (month-name day year)
  m = s.match(/^([A-Za-z]{3,})[ \-/](\d{1,2}),?[ \-/](\d{2,4})/);
  if (m && MON[m[1].slice(0,3).toLowerCase()]) {
    let y = m[3].length === 2 ? "20" + m[3] : m[3];
    return `${y}-${String(MON[m[1].slice(0,3).toLowerCase()]).padStart(2,"0")}-${m[2].padStart(2,"0")}`;
  }
  // DD-MM-YYYY / DD/MM/YY  (day-first — the Indian default)
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    let y = m[3].length === 2 ? "20" + m[3] : m[3];
    let d1 = +m[1], d2 = +m[2];
    // if the first number can't be a day but the second can, it's MM-DD
    if (d1 > 12 && d2 <= 12) return `${y}-${String(d2).padStart(2,"0")}-${String(d1).padStart(2,"0")}`;
    return `${y}-${String(d2).padStart(2,"0")}-${String(d1).padStart(2,"0")}`; // day-first
  }
  return null;
}
function isDateStr(v) {
  if (v instanceof Date) return true;
  const s = String(v == null ? "" : v).trim();
  if (!s || /^\d+(\.\d+)?$/.test(s)) return false; // pure number is NOT a date string
  return normalizeDate(s) != null;
}
// Parse a money value out of any cell. Returns a number (sign preserved) or null.
function parseAmount(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  let s = String(v).trim();
  if (!s || !/\d/.test(s)) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }            // (1,234) → -1234
  // strip currency words / dr-cr suffixes so we can check for stray letters
  let t = s.replace(/\b(inr|rs|usd|eur|gbp|dr|cr|debit|credit)\b/gi, "").replace(/[₹$€£,\s]/g, "");
  if (/dr\b|debit/i.test(s)) neg = true;
  // anything left that contains a letter is a code/word (e.g. "REF1", "UPI/123"), not a money value
  if (/[a-z/]/i.test(t)) return null;
  const cleaned = t.replace(/[^0-9.\-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === "." || !/\d/.test(cleaned)) return null;
  let n = parseFloat(cleaned);
  if (!isFinite(n)) return null;
  if (neg) n = -Math.abs(n);
  return n;
}
function detectCurrency(rowCells) {
  const s = rowCells.map(c => String(c == null ? "" : c)).join(" ");
  if (/[$]|USD/i.test(s)) return "USD";
  if (/€|EUR/i.test(s)) return "EUR";
  if (/£|GBP/i.test(s)) return "GBP";
  return "INR";
}

/* ---------------- self-identifying statement analyzer ----------------
   Finds the header row (if any) and classifies each column by its CONTENT
   — date / numeric-amount / running-balance / debit+credit pair / dr-cr
   flag / description — so it works on ANY bank layout without a fixed
   column map. Falls back to AI only when it can't locate date + amount. */
function analyzeSheet(aoa, state, defAcct) {
  if (!aoa || aoa.length < 2) return { ok: false, rows: [] };
  const scan = Math.min(aoa.length, 14);

  // 1) Find the header row: the early row with the most short text cells
  //    that is followed by rows containing dates/numbers.
  let hi = -1, bestScore = 1;
  for (let i = 0; i < scan; i++) {
    const row = aoa[i] || [];
    let textCells = 0;
    row.forEach(c => {
      const s = String(c == null ? "" : c).trim();
      if (s && s.length <= 30 && !/^\d+(\.\d+)?$/.test(s) && !isDateStr(s) && parseAmount(s) == null) textCells++;
    });
    // data present below?
    let dataBelow = 0;
    for (let k = i + 1; k < Math.min(aoa.length, i + 6); k++) {
      (aoa[k] || []).forEach(c => { if (isDateStr(c) || parseAmount(c) != null) dataBelow++; });
    }
    if (textCells > bestScore && dataBelow >= 2) { bestScore = textCells; hi = i; }
  }
  const headers = hi >= 0 ? (aoa[hi] || []).map(c => String(c == null ? "" : c).toLowerCase().trim()) : [];
  const dataRows = aoa.slice(hi + 1).filter(r => r && r.some(x => x !== "" && x != null));
  if (!dataRows.length) return { ok: false, rows: [] };

  const nCols = Math.max(...dataRows.map(r => r.length), headers.length);
  const sample = dataRows.slice(0, 60);
  const col = [];
  for (let j = 0; j < nCols; j++) {
    let num = 0, dateS = 0, filled = 0, textLen = 0, textN = 0, flag = 0;
    sample.forEach(r => {
      const cell = r[j];
      const s = String(cell == null ? "" : cell).trim();
      if (s) filled++;
      if (isDateStr(cell)) dateS++;
      else if (parseAmount(cell) != null) num++;
      else if (s) { textLen += s.length; textN++; }
      if (/^(dr|cr|debit|credit|income|expense|transfer|withdrawal|deposit)$/i.test(s)) flag++;
    });
    col.push({ j, header: headers[j] || "", num, dateS, filled,
      fill: filled / sample.length, avgText: textN ? textLen / textN : 0, flag });
  }
  const hsome = (j, ...kw) => kw.some(k => (col[j].header || "").includes(k));

  // 2) date column
  let dateCol = -1, dBest = 0;
  col.forEach(c => { const score = c.dateS + (hsome(c.j, "date") ? sample.length : 0); if (c.dateS >= sample.length * 0.4 && score > dBest) { dBest = score; dateCol = c.j; } });
  if (dateCol < 0) return { ok: false, rows: [] };

  // 3) flag column (Dr/Cr / type)
  let flagCol = -1;
  col.forEach(c => { if (c.j !== dateCol && c.flag >= sample.length * 0.4) flagCol = c.j; });

  // 4) amount columns. HEADER-HINT FIRST so a sparse debit/credit pair is still
  //    recognised by name; fall back to pure CONTENT analysis when unlabelled.
  const balKW = (h) => /balance|\bbal\b|closing|available|running/.test(h);
  const debitKW = (h) => /debit|withdraw|paid ?out|spent|\bdr\b|\bout\b/.test(h);
  const creditKW = (h) => /credit|deposit|paid ?in|received|\bcr\b|\bin\b/.test(h);
  const amtKW = (h) => /amount|\bamt\b|\bvalue\b/.test(h);

  const cand = col.filter(c => c.j !== dateCol && c.j !== flagCol && c.num > 0 && !balKW(c.header));
  let mode, debitCol = -1, creditCol = -1, amtCol = -1;
  const hdrDebit = cand.filter(c => debitKW(c.header) && !creditKW(c.header));
  const hdrCredit = cand.filter(c => creditKW(c.header) && !debitKW(c.header));
  const hdrAmt = cand.filter(c => amtKW(c.header) && !debitKW(c.header) && !creditKW(c.header));

  if (hdrDebit.length && hdrCredit.length) { debitCol = hdrDebit[0].j; creditCol = hdrCredit[0].j; mode = "dc"; }
  else if (hdrAmt.length) { amtCol = hdrAmt[0].j; mode = "single"; }
  else if (hdrDebit.length) { amtCol = hdrDebit[0].j; mode = "single-debit"; }
  else if (hdrCredit.length) { amtCol = hdrCredit[0].j; mode = "single-credit"; }
  else {
    // content fallback: numeric columns that aren't a ref code or running balance
    let numCols = cand.filter(c => c.num >= c.filled * 0.6 && c.filled >= sample.length * 0.3);
    if (numCols.length > 1) { // a near-full column among sparser ones is the running balance
      const maxFill = Math.max(...numCols.map(c => c.fill));
      if (numCols.some(c => c.fill < maxFill - 0.15)) numCols = numCols.filter(c => c.fill < maxFill - 0.15);
    }
    if (numCols.length >= 2) { numCols.sort((a, b) => a.j - b.j); debitCol = numCols[0].j; creditCol = numCols[1].j; mode = "dc"; }
    else if (numCols.length === 1) { amtCol = numCols[0].j; mode = "single"; }
    else return { ok: false, rows: [] };
  }
  // is a single amount column signed (contains negatives)? then sign decides type
  let signed = false;
  if (amtCol >= 0) sample.forEach(r => { const a = parseAmount(r[amtCol]); if (a != null && a < 0) signed = true; });

  // 5) description column: longest average free text, not a flag/amount/date col
  let descCol = -1, dlen = 0;
  col.forEach(c => { if ([dateCol, flagCol, debitCol, creditCol, amtCol].indexOf(c.j) < 0 && c.avgText > dlen) { dlen = c.avgText; descCol = c.j; } });

  // 6) build transactions
  const rows = [];
  dataRows.forEach(r => {
    const date = normalizeDate(r[dateCol]); if (!date) return;
    let type, amount;
    if (mode === "dc") {
      const dv = Math.abs(parseAmount(r[debitCol]) || 0), cv = Math.abs(parseAmount(r[creditCol]) || 0);
      if (cv > 0) { type = "income"; amount = cv; }
      else if (dv > 0) { type = "expense"; amount = dv; }
      else return;
    } else {
      const a = parseAmount(r[amtCol]); if (a == null || a === 0) return;
      const flagTxt = flagCol >= 0 ? String(r[flagCol] || "").toLowerCase() : "";
      if (mode === "single-credit") type = "income";
      else if (mode === "single-debit") type = "expense";
      else if (/\b(cr|credit|income|deposit)\b/.test(flagTxt)) type = "income";
      else if (/\b(dr|debit|expense|withdraw)\b/.test(flagTxt)) type = "expense";
      else if (signed) type = a < 0 ? "expense" : "income";
      else type = "expense";
      amount = Math.abs(a);
    }
    let merchant = (descCol >= 0 ? String(r[descCol] || "").trim() : "") || "Transaction";
    const ren = FT.applyRenames(merchant, state); merchant = ren.name;
    const rowText = r.map(c => String(c == null ? "" : c)).join(" ");
    const flagTxt = flagCol >= 0 ? String(r[flagCol] || "").toLowerCase() : "";
    if (flagTxt === "transfer" || FT.looksLikeTransfer(rowText, state)) type = "transfer";
    rows.push({ id: FT.uid(), include: true, type, amount, currency: detectCurrency(r),
      merchant: merchant.slice(0, 80), category: type === "transfer" ? "transfer" : (ren.category && FT.CAT_MAP[ren.category] ? ren.category : matchCategory(merchant, type)),
      date, account: defAcct(), source: "excel" });
  });
  return { ok: rows.length > 0, rows };
}

function ImportView({ state, actions }) {
  const [tab, setTab] = useState("files");
  return (
    <div className="grid" style={{ gap: 18 }}>
      <div className="seg" style={{ alignSelf: "flex-start" }}>
        <button className={tab === "files" ? "on" : ""} onClick={() => setTab("files")}>Statements & files</button>
        <button className={tab === "email" ? "on" : ""} onClick={() => setTab("email")}>Email parser</button>
        {state.pending && state.pending.length > 0 && <button className={tab === "review" ? "on" : ""} onClick={() => setTab("review")}>Review inbox ({state.pending.length})</button>}
      </div>
      {tab === "files" && <FileImport state={state} actions={actions} />}
      {tab === "email" && <EmailImport state={state} actions={actions} />}
      {tab === "review" && <ReviewInbox state={state} actions={actions} />}
    </div>
  );
}

function FileImport({ state, actions }) {
  const cur = state.displayCurrency;
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [err, setErr] = useState("");
  const [fileName, setFileName] = useState("");
  const [done, setDone] = useState(0);
  const [dupes, setDupes] = useState(0);
  const [aiMode, setAiMode] = useState(false);
  const fileRef = useRef(null);

  async function onFile(e) {
    const f = e.target.files[0]; if (!f) return;
    setErr(""); setRows(null); setBusy(true); setFileName(f.name);
    try {
      if (/\.pdf$/i.test(f.name)) await handlePdf(f);
      else await handleSheet(f);
    } catch (ex) { setErr(ex.message || "Couldn't read that file."); }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleSheet(f) {
    setStatus("Reading spreadsheet…");
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheetAoa = (name) => XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: "" })
      .filter(r => r && r.some(x => x !== "" && x != null));

    // Self-identifying path: analyze each sheet by column CONTENT, keep the best.
    if (!aiMode) {
      let best = { ok: false, rows: [] };
      for (const name of wb.SheetNames) {
        const aoa = sheetAoa(name);
        if (aoa.length < 2) continue;
        const res = analyzeSheet(aoa, state, defAcct);
        if (res.ok && res.rows.length > best.rows.length) best = res;
      }
      if (best.ok) { setRows(best.rows.sort((a, b) => b.date.localeCompare(a.date))); return; }
      // couldn't confidently identify columns → fall through to AI
    }

    // Fallback: hand raw rows to the AI (handles headerless / heavily merged layouts)
    setStatus("AI is reading your statement…");
    const text = wb.SheetNames.map(name => sheetAoa(name).map(r => r.map(c => (c == null ? "" : String(c))).join(" | ")).join("\n")).join("\n");
    const out = await aiExtractFromText(text, "excel");
    if (!out.length) throw new Error("Couldn't extract transactions from this sheet. Try another sheet/tab, or split the file.");
    setRows(out.sort((a, b) => b.date.localeCompare(a.date)));
  }

  function defAcct() { return (state.accounts[0] && state.accounts[0].id) || ""; }

  // shared AI extractor — works on ANY text (sheet rows or PDF text), any bank layout
  async function aiExtractFromText(text, source) {
    const out = [];
    const chunks = text.match(/[\s\S]{1,3000}/g) || [];
    const N = Math.min(chunks.length, 60); // up to ~180k chars — covers multi-year statements
    const hints = FT.ownAccountHints(state);
    const ownLine = hints.length
      ? `\nThe user's OWN accounts/cards are: ${hints.join(", ")}. If money simply moves between two of the user's own accounts, or is a credit-card bill payment from the user's own bank, set "type":"transfer" (NOT income/expense) and "category":"transfer".`
      : `\nIf a row is clearly a movement between the user's own accounts or a credit-card bill payment, set "type":"transfer" and "category":"transfer".`;
    for (let ci = 0; ci < N; ci++) {
      setStatus(`AI reading… part ${ci + 1} of ${N}`);
      const prompt = `You are importing a bank or credit-card statement that may be in ANY layout — any columns, any order, extra header/footer/summary rows, merged cells. Extract EVERY real transaction. Respond ONLY a JSON array, no prose:
[{"type":"income"|"expense"|"transfer","amount":<number>,"merchant":"<payee / description>","date":"YYYY-MM-DD","category":"<one of: ${FT.EXPENSE_CATS.map(c=>c.id).join("/")}/${FT.INCOME_CATS.map(c=>c.id).join("/")}/transfer>"}]
CRITICAL: merchant is the OTHER party (who you paid or who paid you), NOT the bank/app that sent the alert. Ignore the sender/From line; look in the body for "paid to", "to VPA", "at <merchant>", "received from", or the UPI handle. "merchant" must be a SHORT, human-friendly label a person instantly recognizes — the brand, payee, or purpose. NEVER raw bank names, reference numbers, or codes. Examples: "Swiggy", "House rent", "Skoda car EMI", "Salary". For a credit-card bill payment, name it "<card name> bill" using the user's card list. Rules: money IN (credit/deposit/refund/salary/cashback/interest) = income; money OUT (debit/purchase/payment/withdrawal/EMI) = expense. amount is a positive number with no symbols/commas — the value of that single transaction ONLY, never a running/available balance, credit limit, or statement total. Infer the date format from context; only use the current year if no year is present anywhere. IGNORE opening/closing balance, totals, and header rows. Pick the closest category id.${ownLine}

Rows:
"""${chunks[ci]}"""`;
      try {
        let raw = (await window.claude.complete(prompt, { tier: "fast" }) || "").trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
        const m = raw.match(/\[[\s\S]*\]/); const arr = JSON.parse(m ? m[0] : raw);
        arr.forEach(o => {
          const amt = Math.abs(+String(o.amount).replace(/[^0-9.]/g, "")) || 0; if (!amt) return;
          const date = /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : null; if (!date) return;
          let type = o.type === "income" ? "income" : o.type === "transfer" ? "transfer" : "expense";
          if (type !== "transfer" && FT.looksLikeTransfer(o.merchant, state)) type = "transfer";
          const ren = FT.applyRenames(FT.bestMerchant(o.merchant, (o.merchant || "") + " " + (o.account || "")), state);
          if (ren.category && FT.CAT_MAP[ren.category] && o.category !== "transfer") o.category = ren.category;
          out.push({ id: FT.uid(), include: true, type, amount: amt, currency: "INR",
            merchant: ren.name.slice(0, 80),
            category: type === "transfer" ? "transfer" : (FT.CAT_MAP[o.category] && o.category !== "transfer" ? o.category : matchCategory(o.merchant, type)),
            date, account: defAcct(), source });
        });
      } catch (e) { /* skip unparseable chunk */ }
    }
    return out;
  }

  async function handlePdf(f) {
    setStatus("Opening PDF…");
    const data = new Uint8Array(await f.arrayBuffer());
    let pdf, password = null;
    while (true) {
      try { pdf = await window.pdfjsLib.getDocument({ data, password }).promise; break; }
      catch (ex) {
        if (ex && ex.name === "PasswordException") { password = prompt("This PDF is password-protected. Enter the password (often your PAN or date of birth):"); if (password == null) throw new Error("Password needed to open this statement."); }
        else throw new Error("Couldn't open the PDF.");
      }
    }
    setStatus("Extracting text…");
    let text = "";
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const c = await page.getTextContent();
      text += c.items.map(it => it.str).join(" ") + "\n";
    }
    if (text.trim().length < 40) throw new Error("This looks like a scanned image PDF — text couldn't be extracted. Try the bank's Excel/CSV export instead.");
    setStatus("AI is reading the statement…");
    const out = await aiExtractFromText(text, "pdf");
    if (!out.length) throw new Error("Couldn't extract transactions from this PDF. Try the Excel/CSV export.");
    setRows(out.sort((a, b) => b.date.localeCompare(a.date)));
  }

  function importAll() {
    const existing = new Set((state.transactions || []).map(t => FT.txnKey(t)));
    const seen = new Set();
    const sel = []; let dupes = 0;
    rows.filter(r => r.include).forEach(r => {
      const key = FT.txnKey(r);
      if (existing.has(key) || seen.has(key)) { dupes++; return; }
      seen.add(key);
      sel.push({ id: FT.uid(), type: r.type, amount: r.amount, currency: r.currency, merchant: r.merchant, category: r.category, account: r.account, toAccount: r.toAccount, date: r.date, note: "Imported", source: r.source, status: "confirmed", tags: [] });
    });
    sel.forEach(t => actions.addTxn(t));
    setDone(sel.length); setDupes(dupes); setRows(null); setFileName("");
  }
  const selCount = rows ? rows.filter(r => r.include).length : 0;

  if (rows) return <ReviewTable rows={rows} setRows={setRows} state={state} onImport={importAll} onCancel={() => setRows(null)} title={`${rows.length} transactions from ${fileName}`} />;

  return (
    <div className="grid" style={{ gridTemplateColumns: "1.1fr 1fr" }}>
      <div className="card card-pad fade-in">
        <div className="card-h"><div className="card-title">Upload a statement or export</div>{done > 0 && <span className="pill pill-pos"><Icon name="check" size={13} />{done} imported{dupes > 0 ? ` · ${dupes} duplicate${dupes !== 1 ? "s" : ""} skipped` : ""}</span>}</div>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.pdf" onChange={onFile} style={{ display: "none" }} />
        <button onClick={() => fileRef.current && fileRef.current.click()} disabled={busy}
          style={{ width: "100%", border: "2px dashed var(--border)", borderRadius: 16, padding: "38px 20px", background: "var(--surface-2)", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, cursor: "pointer" }}>
          <span className="kpi-ico" style={{ background: "var(--accent-soft)", color: "var(--accent)", width: 46, height: 46 }}><Icon name="download" size={22} style={{ transform: "rotate(180deg)" }} /></span>
          <span style={{ fontWeight: 800, fontSize: 15 }}>{busy ? status || "Working…" : "Choose a file"}</span>
          <span style={{ fontSize: 12.5, color: "var(--text-3)" }}>Excel (.xlsx), CSV, or PDF statement</span>
        </button>
        {busy && <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>{[88,72,80].map((w,i)=><div key={i} className="skel" style={{ height: 12, width: w+"%" }} />)}</div>}
        {err && <div style={{ marginTop: 12, fontSize: 13, color: "var(--warn)", fontWeight: 600 }}>{err}</div>}
        <label style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 14, cursor: "pointer", fontSize: 13, fontWeight: 700, color: "var(--text-2)" }}>
          <button onClick={() => setAiMode(!aiMode)} style={{ width: 38, height: 22, borderRadius: 99, background: aiMode ? "var(--accent)" : "var(--surface-3)", position: "relative", transition: "background .15s", flexShrink: 0 }}>
            <span style={{ position: "absolute", top: 2, left: aiMode ? 18 : 2, width: 18, height: 18, borderRadius: 99, background: "#fff", transition: "left .15s", boxShadow: "0 1px 3px rgba(0,0,0,.3)" }}></span>
          </button>
          <span>Always read with AI <span style={{ color: "var(--text-3)", fontWeight: 500 }}>— for any bank's layout, even with no headers</span></span>
        </label>
      </div>
      <div className="card card-pad fade-in">
        <div className="card-h"><div className="card-title">What you can import</div></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: 13.5, color: "var(--text-2)", lineHeight: 1.55 }}>
          <Row icon="sparkles" t="Any bank, any layout" d="Columns are identified by their content, not fixed header names — single amount columns, separate Debit/Credit columns, or a Dr/Cr flag all work. Running-balance columns are ignored automatically." />
          <Row icon="repeat" t="Transfers aren't double-counted" d="Money moved between your own accounts (and credit-card bill payments) is tagged as a Transfer, so it never inflates income or expenses." />
          <Row icon="check" t="Duplicates skipped" d="Re-importing an overlapping statement won't create copies — matching date + amount + payee are detected and skipped." />
          <Row icon="mail" t="PDF statements" d="Text-based PDFs are read by AI; password-protected ones prompt for the password. Scanned/photo PDFs won't work — use the Excel/CSV export." />
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.5, marginTop: 14, borderTop: "1px solid var(--border-soft)", paddingTop: 12 }}>
          <Icon name="info" size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
          Everything lands in a review table first — nothing is saved until you confirm. For 5 years of history, export one statement per account from net-banking (a year at a time is fine) and drop them in here. Toggle "Always read with AI" only if a file's columns aren't detected.
        </div>
      </div>
    </div>
  );
}
function Row({ icon, t, d }) {
  return <div style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
    <span className="kpi-ico" style={{ background: "var(--surface-3)", color: "var(--text-2)", width: 30, height: 30, flexShrink: 0 }}><Icon name={icon} size={15} /></span>
    <div><b style={{ color: "var(--text)" }}>{t}</b><div style={{ fontSize: 12.5 }}>{d}</div></div>
  </div>;
}

/* shared review table for mapped/parsed rows */
function ReviewTable({ rows, setRows, state, onImport, onCancel, title }) {
  const upd = (id, k, v) => setRows(rows.map(r => r.id === id ? { ...r, [k]: v } : r));
  const sel = rows.filter(r => r.include).length;
  const shown = rows.slice(0, 200);
  return (
    <div className="card card-pad fade-in">
      <div className="card-h">
        <div><div className="card-title">{title}</div><div className="card-sub">{sel} selected{rows.length > 200 ? " · showing first 200" : ""}</div></div>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}><Icon name="x" size={14} />Cancel</button>
      </div>
      <div style={{ maxHeight: 460, overflowY: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "24px 96px 1.3fr 96px 84px 130px", gap: 9, padding: "6px 4px", borderBottom: "1px solid var(--border-soft)", background: "var(--bg-2)", fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--text-3)", position: "sticky", top: 0, zIndex: 1 }}>
          <span></span><span>Date</span><span>Description</span><span style={{ textAlign: "right" }}>Amount</span><span>Type</span><span>Category</span>
        </div>
        {shown.map(r => {
          const isX = r.type === "transfer";
          const cats = r.type === "income" ? FT.INCOME_CATS : FT.EXPENSE_CATS;
          const changeType = (tp) => setRows(rows.map(x => x.id === r.id ? { ...x, type: tp, category: tp === "transfer" ? "transfer" : (FT[tp === "income" ? "INCOME_CATS" : "EXPENSE_CATS"].find(c => c.id === x.category) ? x.category : (tp === "income" ? "other_inc" : "misc")) } : x));
          return (
            <div key={r.id} style={{ display: "grid", gridTemplateColumns: "24px 96px 1.3fr 96px 84px 130px", gap: 9, alignItems: "center", padding: "7px 4px", borderBottom: "1px solid var(--border-soft)", opacity: r.include ? 1 : .4 }}>
              <button onClick={() => upd(r.id, "include", !r.include)} style={{ width: 19, height: 19, borderRadius: 6, border: "2px solid " + (r.include ? "var(--accent)" : "var(--border)"), background: r.include ? "var(--accent)" : "transparent", display: "grid", placeItems: "center" }}>{r.include && <Icon name="check" size={11} style={{ color: "#fff" }} />}</button>
              <input className="input" style={{ padding: "6px 8px", fontSize: 12 }} type="date" value={r.date} onChange={e => upd(r.id, "date", e.target.value)} />
              <input className="input" style={{ padding: "6px 9px", fontSize: 12.5 }} value={r.merchant} onChange={e => upd(r.id, "merchant", e.target.value)} />
              <input className="input num" style={{ padding: "6px 8px", fontSize: 12.5, color: isX ? "var(--text-2)" : r.type === "income" ? "var(--pos)" : "var(--text)" }} type="number" value={r.amount} onChange={e => upd(r.id, "amount", +e.target.value)} />
              <select className="select" style={{ padding: "6px 6px", fontSize: 11.5 }} value={r.type} onChange={e => changeType(e.target.value)}><option value="expense">Exp</option><option value="income">Inc</option><option value="transfer">Xfer</option></select>
              {isX
                ? <span className="tag" style={{ background: "var(--surface-3)", color: "var(--text-2)", justifySelf: "start" }}>⇄ Transfer</span>
                : <select className="select" style={{ padding: "6px 6px", fontSize: 11.5 }} value={r.category} onChange={e => upd(r.id, "category", e.target.value)}>{cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 14, justifyContent: "flex-end" }}>
        <button className="btn btn-ghost" onClick={() => setRows(rows.map(r => ({ ...r, include: sel < rows.length })))}>{sel < rows.length ? "Select all" : "Deselect all"}</button>
        <button className="btn btn-primary" onClick={onImport} disabled={!sel}><Icon name="check" size={16} />Import {sel} transaction{sel !== 1 ? "s" : ""}</button>
      </div>
    </div>
  );
}

/* review inbox — pending items from gmail/auto ingestion */
function ReviewInbox({ state, actions }) {
  const cur = state.displayCurrency;
  const pending = state.pending || [];
  const [sel, setSel] = useState(() => new Set(pending.map(p => p.id)));
  const toggle = (id) => { const n = new Set(sel); n.has(id) ? n.delete(id) : n.add(id); setSel(n); };
  if (!pending.length) return <div className="card card-pad empty" style={{ padding: "50px 20px" }}><Icon name="check" /><div style={{ fontWeight: 700, color: "var(--text-2)" }}>Review inbox is empty</div><div style={{ fontSize: 13 }}>Auto-imported items needing approval will appear here.</div></div>;
  return (
    <div className="card card-pad fade-in">
      <div className="card-h"><div><div className="card-title">Review inbox · {pending.length}</div><div className="card-sub">Approve to add to your ledger</div></div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => actions.rejectPending([...sel])}>Reject</button>
          <button className="btn btn-primary btn-sm" onClick={() => { actions.approvePending([...sel]); setSel(new Set()); }} disabled={!sel.size}><Icon name="check" size={14} />Approve {sel.size}</button>
        </div>
      </div>
      <div>
        {pending.map(p => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 4px", borderBottom: "1px solid var(--border-soft)" }}>
            <button onClick={() => toggle(p.id)} style={{ width: 20, height: 20, borderRadius: 6, border: "2px solid " + (sel.has(p.id) ? "var(--accent)" : "var(--border)"), background: sel.has(p.id) ? "var(--accent)" : "transparent", display: "grid", placeItems: "center", flexShrink: 0 }}>{sel.has(p.id) && <Icon name="check" size={12} style={{ color: "#fff" }} />}</button>
            <div style={{ flex: 1 }}><TxnRow t={p} cur={cur} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { ImportView, ReviewTable, ReviewInbox, matchCategory });
