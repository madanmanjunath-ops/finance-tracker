/* ============================================================
   ai.js — makes window.claude.complete() work in PRODUCTION.

   • Inside the Claude design studio, window.claude already exists,
     so this file detects that and does nothing.
   • On your hosted site (Netlify/Vercel/etc.) it defines
     window.claude.complete() to call your own serverless proxy,
     which holds your Anthropic API key server-side.

   Endpoint: defaults to /api/claude (mapped to the Netlify
   function by netlify.toml). Override by setting
   window.AI_PROXY_URL before this script loads if you host the
   function elsewhere.
   ============================================================ */
(function () {
  "use strict";

  // Studio already provides a working window.claude — leave it alone.
  if (window.claude && typeof window.claude.complete === "function") {
    window.__AI_MODE = "studio";
    return;
  }

  var ENDPOINT = window.AI_PROXY_URL || "/api/claude";
  window.__AI_MODE = "proxy";

  window.claude = {
    complete: async function (prompt) {
      var accessKey = "";
      try { accessKey = localStorage.getItem("ft_ai_access_key") || ""; } catch (e) {}

      var res;
      try {
        res = await fetch(ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-app-secret": accessKey,
          },
          body: JSON.stringify({ prompt: String(prompt) }),
        });
      } catch (e) {
        throw new Error("Could not reach the AI service. Check your connection or that the site is deployed with its function.");
      }

      if (res.status === 401) {
        throw new Error("AI access key missing or wrong. Set it in Settings → AI service.");
      }
      if (!res.ok) {
        var msg = "AI request failed (" + res.status + ").";
        try { var j = await res.json(); if (j && j.error) msg = j.error; } catch (e) {}
        throw new Error(msg);
      }

      var ct = (res.headers.get("content-type") || "").toLowerCase();
      if (ct.indexOf("application/json") >= 0) {
        // legacy buffered server: { text: "..." }
        var data = await res.json();
        return (data && data.text) || "";
      }
      // streaming server: plain text chunks
      if (res.body && res.body.getReader) {
        var reader = res.body.getReader();
        var dec = new TextDecoder();
        var out = "";
        while (true) {
          var r = await reader.read();
          if (r.done) break;
          out += dec.decode(r.value, { stream: true });
        }
        return out;
      }
      return await res.text();
    },
  };
})();
