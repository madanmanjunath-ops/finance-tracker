/* ============================================================
   test/harness.js — load the app's browser-global modules
   (store.js → window.FT, compute.jsx → window.Compute) into a
   Node sandbox so their pure functions can be unit-tested WITHOUT
   a build step or any dependency.

   These files are written for the browser: each is an IIFE that
   attaches its API to `window`. We run them inside a vm context
   that provides a fake `window` (plus `crypto`, `localStorage`,
   `console`), then hand back the globals they defined.
   ============================================================ */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const APP = path.join(__dirname, "..", "finance_tracker_v22");

function read(rel) { return fs.readFileSync(path.join(APP, rel), "utf8"); }

// Minimal localStorage stub (store.js references it only inside load/save,
// which the unit tests don't call, but we provide it so nothing throws).
function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}

// Load the browser globals once and cache them.
let cached = null;
function loadBrowserGlobals() {
  if (cached) return cached;

  const sandbox = {
    window: { SUPABASE_URL: "", SUPABASE_ANON_KEY: "" },
    crypto: webcrypto,          // real CSPRNG so FT.ingestToken() works
    localStorage: memStorage(),
    console,
    // vm contexts get the standard intrinsics (Object, Array, Math, JSON,
    // Date, Uint8Array, etc.) automatically, so we don't re-declare them.
  };
  vm.createContext(sandbox);

  // store.js defines window.FT
  vm.runInContext(read("store.js"), sandbox, { filename: "store.js" });
  // compute.jsx reads a bare global `FT`, so expose it on the sandbox global
  // before loading compute.jsx (top-level `const` from the previous run does
  // not persist across runInContext calls).
  sandbox.FT = sandbox.window.FT;
  vm.runInContext(read("compute.jsx"), sandbox, { filename: "compute.jsx" });

  cached = { FT: sandbox.window.FT, Compute: sandbox.window.Compute };
  return cached;
}

// The ingest function is a normal CommonJS module; its pure internals are
// exposed via module.exports.__test.
function loadIngest() {
  return require(path.join(APP, "netlify", "functions", "ingest.js")).__test;
}

module.exports = { loadBrowserGlobals, loadIngest };
