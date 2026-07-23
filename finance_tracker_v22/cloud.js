/* ============================================================
   cloud.js — Supabase auth + cloud sync layer.

   Exposes window.Cloud. When Supabase isn't configured (no
   URL/key, or the SDK didn't load), Cloud.enabled() is false and
   the app runs exactly as before: local-only, no login.

   Data model: one row per user in the `app_state` table:
     user_id (uuid, pk) · data (jsonb) · updated_at (timestamptz)
   The whole app state is stored as a single JSON blob — simple
   and a perfect match for the existing state object.
   ============================================================ */
(function () {
  "use strict";

  function lsGet(k) { try { return (localStorage.getItem(k) || "").trim(); } catch (e) { return ""; } }

  // Config comes from supabase-config.js if filled, OTHERWISE from
  // values saved via the in-app "Connect cloud sync" setup (localStorage).
  // The in-app route avoids hand-editing a file (and smart-quote bugs).
  var URL_ = (window.SUPABASE_URL || "").trim() || lsGet("ft_sb_url");
  var KEY_ = (window.SUPABASE_ANON_KEY || "").trim() || lsGet("ft_sb_key");
  var sb = null;

  function configured() { return !!(URL_ && KEY_); }
  function sdkReady() { return !!(window.supabase && window.supabase.createClient); }

  function client() {
    if (sb) return sb;
    if (!configured() || !sdkReady()) return null;
    sb = window.supabase.createClient(URL_, KEY_, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
    return sb;
  }

  var Cloud = {
    enabled: function () { return configured() && sdkReady(); },
    sdkReady: sdkReady,
    isConfigured: configured,

    // Save Supabase creds entered in-app, then the caller reloads the page.
    configure: function (url, key) {
      url = (url || "").trim(); key = (key || "").trim();
      try { localStorage.setItem("ft_sb_url", url); localStorage.setItem("ft_sb_key", key); } catch (e) {}
    },
    unconfigure: function () {
      try { localStorage.removeItem("ft_sb_url"); localStorage.removeItem("ft_sb_key"); } catch (e) {}
    },

    // ---- auth ----
    async getUser() {
      var c = client(); if (!c) return null;
      try { var { data } = await c.auth.getUser(); return data && data.user ? data.user : null; }
      catch (e) { return null; }
    },
    onAuthChange(cb) {
      var c = client(); if (!c) return function () {};
      var sub = c.auth.onAuthStateChange(function (_e, session) { cb(session ? session.user : null); });
      return function () { try { sub.data.subscription.unsubscribe(); } catch (e) {} };
    },
    async signIn(email, password) {
      var c = client(); if (!c) throw new Error("Cloud not configured.");
      var { data, error } = await c.auth.signInWithPassword({ email: email, password: password });
      if (error) throw new Error(error.message);
      return data.user;
    },
    async signUp(email, password) {
      var c = client(); if (!c) throw new Error("Cloud not configured.");
      var { data, error } = await c.auth.signUp({ email: email, password: password });
      if (error) throw new Error(error.message);
      return data.user;
    },
    // Google SSO: kicks off a full-page redirect to Google, then back to the
    // app. The client's detectSessionInUrl picks up the session on return and
    // onAuthChange fires — so there's nothing to await here beyond the redirect.
    // Requires the Google provider to be enabled in the Supabase dashboard.
    async signInWithGoogle() {
      var c = client(); if (!c) throw new Error("Cloud not configured.");
      var redirectTo = window.location.origin + window.location.pathname;
      var { data, error } = await c.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: redirectTo },
      });
      if (error) throw new Error(error.message);
      return data;
    },
    async signOut() {
      var c = client(); if (!c) return;
      try { await c.auth.signOut(); } catch (e) {}
    },

    // ---- data ----
    // returns { data, updated_at } or null if no row yet
    async loadState() {
      var c = client(); if (!c) return null;
      var user = await this.getUser(); if (!user) return null;
      var { data, error } = await c.from("app_state").select("data, updated_at").eq("user_id", user.id).maybeSingle();
      if (error) throw new Error(error.message);
      return data || null;
    },
    async saveState(state) {
      var c = client(); if (!c) return;
      var user = await this.getUser(); if (!user) return;
      var payload = { user_id: user.id, data: state, updated_at: new Date().toISOString() };
      var { error } = await c.from("app_state").upsert(payload, { onConflict: "user_id" });
      if (error) throw new Error(error.message);
    },
  };

  window.Cloud = Cloud;
})();
