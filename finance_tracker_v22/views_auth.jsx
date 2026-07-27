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

  async function google() {
    setErr(""); setNote(""); setBusy(true);
    // On success the browser redirects to Google, so we don't clear `busy` here.
    try { await Cloud.signInWithGoogle(); }
    catch (e2) { setErr(e2.message || "Couldn't start Google sign-in."); setBusy(false); }
  }

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

          <button type="button" onClick={google} disabled={busy}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "11px 16px", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontWeight: 700, fontSize: 14, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}>
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62z" />
              <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.83.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
              <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
              <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
            </svg>
            Continue with Google
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "16px 0" }}>
            <div style={{ flex: 1, height: 1, background: "var(--border)" }}></div>
            <span style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 700 }}>or</span>
            <div style={{ flex: 1, height: 1, background: "var(--border)" }}></div>
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

        <div style={{ textAlign: "center", marginTop: 16, fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.7 }}>
          Your financial data is stored privately under your account and synced across your devices.
          <br />
          {mode === "signup" ? "By creating an account, you agree to our " : "By using the app, you agree to our "}
          <a href="terms.html" target="_blank" rel="noopener" style={{ color: "var(--text-2)", textDecoration: "underline" }}>Terms</a>
          {" & "}
          <a href="privacy.html" target="_blank" rel="noopener" style={{ color: "var(--text-2)", textDecoration: "underline" }}>Privacy Policy</a>.
          <br />
          <span style={{ opacity: 0.85 }}>Informational tool — not financial advice.</span>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { AuthScreen });
