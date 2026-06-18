/* ============================================================
   views_auth.jsx — login / signup gate (shown only when
   Supabase is configured and the user is signed out).
   ============================================================ */
function AuthScreen({ onAuthed }) {
  const [mode, setMode] = useState("signin"); // signin | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");

  async function submit(e) {
    e && e.preventDefault();
    setErr(""); setNote("");
    if (!email.trim() || !password) { setErr("Enter your email and password."); return; }
    if (mode === "signup" && password.length < 6) { setErr("Use a password of at least 6 characters."); return; }
    setBusy(true);
    try {
      if (mode === "signin") {
        const u = await Cloud.signIn(email.trim(), password);
        onAuthed(u);
      } else {
        const u = await Cloud.signUp(email.trim(), password);
        if (u && !u.email_confirmed_at && !u.confirmed_at) {
          // email confirmation may be on — try an immediate sign-in anyway
          try { const u2 = await Cloud.signIn(email.trim(), password); onAuthed(u2); }
          catch (e2) { setNote("Account created. Check your inbox to confirm your email, then sign in."); setMode("signin"); }
        } else { onAuthed(u); }
      }
    } catch (e2) {
      setErr(e2.message || "Something went wrong.");
    }
    setBusy(false);
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24,
      background: "radial-gradient(1100px 560px at 50% -10%, var(--accent-soft), transparent 60%), var(--bg)" }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "center", marginBottom: 26 }}>
          <div className="brand-mark" style={{ width: 40, height: 40 }}><Icon name="wallet" size={22} style={{ color: "#fff" }} /></div>
          <div className="display" style={{ fontSize: 22, fontWeight: 600 }}>Finance Tracker</div>
        </div>

        <div className="card card-pad" style={{ padding: 28 }}>
          <div style={{ textAlign: "center", marginBottom: 22 }}>
            <div className="display" style={{ fontSize: 20, fontWeight: 600 }}>{mode === "signin" ? "Welcome back" : "Create your account"}</div>
            <div style={{ fontSize: 13.5, color: "var(--text-3)", fontWeight: 600, marginTop: 4 }}>{mode === "signin" ? "Sign in to sync across your devices" : "Your data will sync securely to the cloud"}</div>
          </div>

          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="field">
              <label className="label">Email</label>
              <input className="input" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} autoFocus />
            </div>
            <div className="field">
              <label className="label">Password</label>
              <input className="input" type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} placeholder={mode === "signup" ? "At least 6 characters" : "••••••••"} value={password} onChange={e => setPassword(e.target.value)} />
            </div>
            {err && <div style={{ fontSize: 13, color: "var(--neg)", fontWeight: 700, display: "flex", alignItems: "center", gap: 7 }}><Icon name="info" size={15} />{err}</div>}
            {note && <div style={{ fontSize: 13, color: "var(--accent)", fontWeight: 700, display: "flex", alignItems: "center", gap: 7 }}><Icon name="check" size={15} />{note}</div>}
            <button type="submit" className="btn btn-primary" style={{ justifyContent: "center", padding: "12px 16px", marginTop: 2 }} disabled={busy}>
              {busy ? "Please wait…" : (mode === "signin" ? "Sign in" : "Create account")}
            </button>
          </form>

          <div style={{ textAlign: "center", marginTop: 18, fontSize: 13, color: "var(--text-2)", fontWeight: 600 }}>
            {mode === "signin" ? "New here? " : "Already have an account? "}
            <button onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setErr(""); setNote(""); }}
              style={{ color: "var(--accent)", fontWeight: 800, whiteSpace: "nowrap" }}>
              {mode === "signin" ? "Create an account" : "Sign in"}
            </button>
          </div>
        </div>

        <div style={{ textAlign: "center", marginTop: 16, fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.6 }}>
          Your financial data is stored privately under your account and synced across your devices.
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { AuthScreen });
