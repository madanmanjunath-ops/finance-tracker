/* ============================================================
   netlify/functions/claude.js
   STREAMING serverless proxy to the Anthropic API.

   Why streaming: Netlify kills regular (buffered) functions at
   ~10 seconds, which a full plan generation exceeds — that's the
   "AI request failed (504)" error. Streamed responses are exempt
   from that cap, so long generations complete.

   Auth: every request must carry a logged-in user's Supabase session token
   (Authorization: Bearer ...), verified server-side; per-user daily rate cap
   via the increment_ai_usage RPC. See AI-PROXY-SECURITY.md.

   Required env vars: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
   Optional env vars: CLAUDE_MODEL (default below), AI_DAILY_LIMIT (default 300)
   ============================================================ */

// Two tiers to control cost. High-volume parsing/extraction runs on the cheap
// model; reasoning features (coach, plans, critique) run on the stronger one.
// Both overridable via Netlify env vars.
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";            // reasoning (default)
const MODEL_FAST = process.env.CLAUDE_MODEL_FAST || "claude-haiku-4-5"; // parsing/extraction

export default async (req) => {
  // Health check — open the function URL in a browser (GET).
  if (req.method === "GET") {
    return Response.json({
      ok: true,
      streaming: true,
      auth: "supabase-session",
      hasApiKey: !!process.env.ANTHROPIC_API_KEY,
      apiKeyLooksValid: /^sk-ant-/.test(process.env.ANTHROPIC_API_KEY || ""),
      hasSupabase: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY),
      dailyLimit: parseInt(process.env.AI_DAILY_LIMIT || "300", 10),
      model: MODEL,
      modelFast: MODEL_FAST,
      hint: !process.env.ANTHROPIC_API_KEY
        ? "This deploy does NOT see ANTHROPIC_API_KEY. Set it in Netlify env vars, then deploy AGAIN."
        : "AI requests must carry a logged-in user's Supabase session token (Authorization: Bearer).",
    });
  }

  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "Server is missing ANTHROPIC_API_KEY. Add it in your host's environment variables." }, { status: 500 });
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return Response.json({ error: "Server is missing Supabase config (SUPABASE_URL / SUPABASE_SERVICE_KEY)." }, { status: 500 });
  }

  // ---- Per-user auth: require a valid Supabase session token ----
  // (Replaces the old shared APP_SECRET, which every browser held.)
  const authz = req.headers.get("authorization") || "";
  const token = authz.slice(0, 7).toLowerCase() === "bearer " ? authz.slice(7).trim() : "";
  if (!token) return Response.json({ error: "Sign in to use AI features." }, { status: 401 });

  let userId = null;
  try {
    const ures = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: process.env.SUPABASE_SERVICE_KEY, authorization: "Bearer " + token },
    });
    if (ures.ok) { const u = await ures.json(); userId = u && u.id ? u.id : null; }
  } catch (e) { /* leave userId null → 401 below */ }
  if (!userId) return Response.json({ error: "Your session is invalid or expired. Sign in again." }, { status: 401 });

  // ---- Per-user daily rate cap (best-effort: never blocks on infra errors) ----
  // Calls a Postgres RPC that atomically increments today's count and returns it.
  // If the RPC isn't installed yet or errors, we fail OPEN (auth already gates access).
  const dailyLimit = parseInt(process.env.AI_DAILY_LIMIT || "300", 10);
  try {
    const rres = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/increment_ai_usage`, {
      method: "POST",
      headers: {
        apikey: process.env.SUPABASE_SERVICE_KEY,
        authorization: "Bearer " + process.env.SUPABASE_SERVICE_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({ p_user: userId }),
    });
    if (rres.ok) {
      const count = await rres.json(); // RPC returns the new integer count
      if (typeof count === "number" && count > dailyLimit) {
        return Response.json({ error: "Daily AI limit reached. Try again tomorrow." }, { status: 429 });
      }
    }
  } catch (e) { /* fail open on rate-limit infra errors */ }

  let prompt = "";
  let tier = "";
  try {
    const body = await req.json();
    prompt = String(body.prompt || "");
    tier = String(body.tier || "");
  } catch (e) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!prompt.trim()) return Response.json({ error: "Missing prompt" }, { status: 400 });

  // High-volume parsing/extraction asks for the cheap model via tier:"fast".
  // Everything else (coach, plans, critique, chat) uses the stronger default.
  const model = tier === "fast" ? MODEL_FAST : MODEL;

  let upstream;
  try {
    upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 4096,
        stream: true,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch (e) {
    return Response.json({ error: "Upstream request failed: " + String(e) }, { status: 502 });
  }

  if (!upstream.ok) {
    let msg = "Anthropic API error (" + upstream.status + ")";
    try { const j = await upstream.json(); if (j && j.error && j.error.message) msg = j.error.message; } catch (e) {}
    return Response.json({ error: msg }, { status: upstream.status });
  }

  // Relay Anthropic's SSE stream as plain text deltas.
  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body.getReader();
      const dec = new TextDecoder();
      const enc = new TextEncoder();
      let buf = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop();
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              const ev = JSON.parse(payload);
              if (ev.type === "content_block_delta" && ev.delta && typeof ev.delta.text === "string") {
                controller.enqueue(enc.encode(ev.delta.text));
              }
            } catch (e) { /* ignore partial SSE json */ }
          }
        }
      } catch (e) { /* upstream dropped — close with what we have */ }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-cache" },
  });
};
