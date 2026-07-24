/* ============================================================
   test/integration/security-live.mjs
   LIVE security checks against your real Supabase project. These
   verify the properties that can only be tested end-to-end:

     1. Cross-account isolation (RLS): signed in as user B, you
        CANNOT read user A's row — even by asking for it by id.
     2. Unauthenticated reads return nothing (the anon key alone
        exposes no data).
     3. A wrong password is rejected.
     4. A correct password logs in and sees ONLY the user's own row.

   Zero dependencies — uses Node 22's built-in fetch. It only READS
   data; it never writes or deletes.

   ---- HOW TO RUN --------------------------------------------------
   Create TWO throwaway accounts in your app first (e.g. a@test.com
   and b@test.com), each having logged in at least once so a row
   exists. Then:

     SB_URL="https://xxxx.supabase.co" \
     SB_ANON_KEY="eyJ...anon..." \
     A_EMAIL="a@test.com" A_PASS="......" \
     B_EMAIL="b@test.com" B_PASS="......" \
     node test/integration/security-live.mjs

   Every line should print PASS. Any FAIL is a real security gap —
   most likely the RLS policies from SUPABASE-SETUP.md weren't run.
   ================================================================ */

// This file lives under test/, so the `node --test` runner auto-discovers it —
// but it's a live integration script, not a unit test. NODE_TEST_CONTEXT is set
// by the runner in each test subprocess; when present, we no-op so the runner
// doesn't try to execute the live checks (which need env vars + network).
if (process.env.NODE_TEST_CONTEXT) {
  // Discovered by `node --test` — skip. Run this file directly instead.
} else {
  await main();
}

async function main() {
const { SB_URL, SB_ANON_KEY, A_EMAIL, A_PASS, B_EMAIL, B_PASS } = process.env;

if (!SB_URL || !SB_ANON_KEY || !A_EMAIL || !A_PASS || !B_EMAIL || !B_PASS) {
  console.error("Missing env vars. See the header of this file for usage.");
  process.exit(2);
}

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
}

async function signIn(email, password) {
  const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SB_ANON_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, token: j.access_token || null, userId: (j.user && j.user.id) || null };
}

// Read app_state with a given bearer token (or none), optionally filtered by user_id.
async function readState(token, userIdFilter) {
  const q = userIdFilter ? `?user_id=eq.${encodeURIComponent(userIdFilter)}&select=user_id` : "?select=user_id";
  const r = await fetch(`${SB_URL}/rest/v1/app_state${q}`, {
    headers: {
      apikey: SB_ANON_KEY,
      ...(token ? { authorization: "Bearer " + token } : {}),
    },
  });
  const j = await r.json().catch(() => []);
  return Array.isArray(j) ? j : [];
}

  console.log("Live security checks against", SB_URL, "\n");

  // 4a. Correct password logs in.
  const a = await signIn(A_EMAIL, A_PASS);
  check("User A signs in with correct password", a.status === 200 && !!a.token);
  const b = await signIn(B_EMAIL, B_PASS);
  check("User B signs in with correct password", b.status === 200 && !!b.token);

  if (!a.token || !b.token || !a.userId || !b.userId) {
    console.error("\nCould not sign in both users — fix credentials and retry.");
    process.exit(2);
  }

  // 3. Wrong password is rejected.
  const wrong = await signIn(A_EMAIL, A_PASS + "_definitely_wrong");
  check("Wrong password is rejected", wrong.status >= 400 && !wrong.token, `status ${wrong.status}`);

  // 4b. Each user sees ONLY their own row.
  const aRows = await readState(a.token);
  check("User A sees only their own row", aRows.length <= 1 && aRows.every(r => r.user_id === a.userId),
    `${aRows.length} row(s)`);

  // 1. THE BIG ONE — cross-account isolation. User B explicitly asks for
  //    user A's row by id. RLS must return nothing.
  const leak = await readState(b.token, a.userId);
  check("User B CANNOT read user A's row (RLS isolation)", leak.length === 0,
    leak.length ? `LEAKED ${leak.length} row(s)!` : "no rows returned");

  // 2. Unauthenticated (anon key only) read returns nothing.
  const anon = await readState(null);
  check("Anonymous read returns no rows", anon.length === 0, `${anon.length} row(s)`);

  console.log(`\n${failures === 0 ? "ALL SECURITY CHECKS PASSED ✅" : failures + " CHECK(S) FAILED ❌"}`);
  process.exit(failures === 0 ? 0 : 1);
}
