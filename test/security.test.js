/* ============================================================
   test/security.test.js — the security properties we CAN verify
   offline (no live Supabase needed):

   • Ingest tokens are high-entropy and unguessable (CSPRNG), so a
     token that authorizes writing into a user's account can't be
     forged or brute-forced.
   • The ingest user-lookup filter is injection-safe: a crafted
     token cannot break out of the PostgREST eq.<token> filter to
     read or match other users' rows.

   Cross-account data isolation (RLS) and wrong-password login are
   LIVE properties — see test/integration/security-live.md.
   ============================================================ */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadBrowserGlobals, loadIngest } = require("./harness");

const { FT } = loadBrowserGlobals();
const I = loadIngest();

test("ingestToken: prefixed, long, and hex/CSPRNG-shaped", () => {
  const t = FT.ingestToken();
  assert.match(t, /^ft_[0-9a-f]{40,}$/); // ft_ + >=40 hex chars (two UUIDs = 64)
});

test("ingestToken: 5000 tokens are all unique (no collisions)", () => {
  const seen = new Set();
  for (let i = 0; i < 5000; i++) seen.add(FT.ingestToken());
  assert.equal(seen.size, 5000);
});

test("ingestToken: NOT derived from Math.random's weak alphabet", () => {
  // The old token was Math.random().toString(36) — base36, so it contained
  // letters g–z. A CSPRNG hex token never does. This guards against a
  // regression back to the predictable generator.
  const body = FT.ingestToken().slice(3); // drop "ft_"
  assert.equal(/[g-z]/.test(body), false);
  assert.ok(body.length >= 40, "token body should be >=40 chars of entropy");
});

test("tokenFilter: normal token maps to the expected PostgREST filter", () => {
  assert.equal(
    I.tokenFilter("ft_abc123"),
    "data->gmail->>token=eq.ft_abc123",
  );
});

test("SECURITY: a crafted token cannot inject PostgREST filter operators", () => {
  // If the token were interpolated raw, a value like:
  //   x&user_id=eq.<victim>
  // would add a second filter and could match another user's row. After
  // encodeURIComponent, the '&' and '=' are escaped (%26 / %3D), so the whole
  // thing stays a single opaque token value that simply matches nothing.
  const evil = "x&user_id=eq.00000000-0000-0000-0000-000000000000";
  const filter = I.tokenFilter(evil);
  // '&' (new query param) and '=' (operator) are the breakout characters that
  // could append a second filter. Both must be percent-encoded away.
  assert.equal(filter.includes("&user_id="), false, "raw & must not survive");
  assert.equal(filter.includes("=eq.0000"), false, "raw =eq.<uuid> must not survive");
  assert.ok(filter.includes("%26"), "the & should be percent-encoded (%26)");
  assert.ok(filter.includes("%3D"), "the = should be percent-encoded (%3D)");
  // The value after 'eq.' contains no raw '&' or '=' at all.
  const value = filter.slice("data->gmail->>token=eq.".length);
  assert.equal(/[&=]/.test(value), false, "token value holds no raw & or =");
});
