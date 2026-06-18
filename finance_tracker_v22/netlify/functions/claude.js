/* ============================================================
   netlify/functions/claude.js
   STREAMING serverless proxy to the Anthropic API.

   Why streaming: Netlify kills regular (buffered) functions at
   ~10 seconds, which a full plan generation exceeds — that's the
   "AI request failed (504)" error. Streamed responses are exempt
   from that cap, so long generations complete.

   Required env var:  ANTHROPIC_API_KEY
   Optional env vars: CLAUDE_MODEL (default below), APP_SECRET
   ============================================================ */

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

export default async (req) => {
  // Health check — open the function URL in a browser (GET).
  if (req.method === "GET") {
    return Response.json({
      ok: true,
      streaming: true,
      hasApiKey: !!process.env.ANTHROPIC_API_KEY,
      apiKeyLooksValid: /^sk-ant-/.test(process.env.ANTHROPIC_API_KEY || ""),
      hasAppSecret: !!process.env.APP_SECRET,
      model: MODEL,
      hint: !process.env.ANTHROPIC_API_KEY
        ? "This deploy does NOT see ANTHROPIC_API_KEY. Set it in Netlify env vars, then deploy AGAIN."
        : "Key is visible to the function. The AI should work.",
    });
  }

  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  if (process.env.APP_SECRET) {
    const sent = req.headers.get("x-app-secret") || "";
    if (sent !== process.env.APP_SECRET) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "Server is missing ANTHROPIC_API_KEY. Add it in your host's environment variables." }, { status: 500 });
  }

  let prompt = "";
  try {
    const body = await req.json();
    prompt = String(body.prompt || "");
  } catch (e) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!prompt.trim()) return Response.json({ error: "Missing prompt" }, { status: 400 });

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
        model: MODEL,
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
