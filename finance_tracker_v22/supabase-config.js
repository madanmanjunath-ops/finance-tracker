/* ============================================================
   supabase-config.js — YOUR Supabase project credentials.

   These two values are SAFE to expose in the browser: the anon
   key only works together with Row-Level Security (which the
   setup SQL turns on), so each logged-in user can read/write
   ONLY their own row.

   Fill these in after creating your Supabase project
   (see SUPABASE-SETUP.md). Leave them blank to keep the app in
   local-only mode (no login, data stays in this browser).
   ============================================================ */
window.SUPABASE_URL = "";       // e.g. "https://abcd1234.supabase.co"
window.SUPABASE_ANON_KEY = "";  // the "anon public" key from Project Settings → API
