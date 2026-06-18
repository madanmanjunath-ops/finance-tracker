/* ============================================================
   netlify/functions/daily-email.js
   Scheduled function — runs every morning, reads each user's
   data from Supabase, builds a finance snapshot, emails it via
   Resend. Schedule is set in netlify.toml (07:15 IST = 01:45 UTC).

   Env vars required:
     SUPABASE_URL          your project URL
     SUPABASE_SERVICE_KEY  the "service_role" key (server-only!)
     RESEND_API_KEY        from resend.com
     EMAIL_FROM            verified sender, e.g. "Finance Tracker <you@yourdomain>"
                           (or onboarding@resend.dev while testing)
   Optional:
     ANTHROPIC_API_KEY     to include a one-line AI tip
     CLAUDE_MODEL
   ============================================================ */
const SYM = { INR: "₹", USD: "$", EUR: "€", GBP: "£" };
function fmt(n, c) { c = c || "INR"; const s = SYM[c] || "₹"; return s + Math.round(Math.abs(n)).toLocaleString(c === "INR" ? "en-IN" : "en-US"); }
function conv(amt, from, fx, disp) { from = from || "INR"; return amt * ((fx && fx[from]) || 1) / ((fx && fx[disp]) || 1); }
function thisMonth() { return new Date().toISOString().slice(0, 7); }
function daysUntil(d) { if (!d) return null; const n = new Date(); const x = new Date(n.getFullYear(), n.getMonth(), d); if (x <= n) x.setMonth(x.getMonth() + 1); return Math.ceil((x - n) / 86400000); }

function snapshot(data) {
  const cur = data.displayCurrency || "INR", fx = data.fx || {};
  let assets = 0, liab = 0;
  (data.accounts || []).forEach(a => { const isAsset = !["loan"].includes(a.type); const v = conv(a.balance || 0, a.currency, fx, cur); if (isAsset) assets += v; else liab += v; });
  (data.cards || []).forEach(c => liab += conv(c.balance || 0, c.currency, fx, cur));
  (data.loans || []).forEach(l => liab += conv(l.outstanding || 0, l.currency, fx, cur));
  const tm = thisMonth();
  let inc = 0, exp = 0;
  (data.transactions || []).forEach(t => { if ((t.date || "").slice(0, 7) !== tm) return; const v = conv(t.amount || 0, t.currency, fx, cur); if (t.type === "income") inc += v; else exp += v; });
  // upcoming card dues + recurring (next 7 days)
  const dues = [];
  (data.cards || []).forEach(c => { const d = daysUntil(c.dueDay); if (d != null && d <= 7) dues.push(`${c.name} payment due in ${d}d`); });
  (data.recurring || []).forEach(r => { const d = daysUntil(r.day); if (d != null && d <= 5) dues.push(`${r.name} (${fmt(conv(r.amount||0,"INR",fx,cur),cur)}) in ${d}d`); });
  // best card today (highest general reward, not near limit)
  let best = null;
  (data.cards || []).forEach(c => {
    const util = c.limit ? (conv(c.balance||0,c.currency,fx,cur) / conv(c.limit,c.currency,fx,cur)) : 0;
    const rate = (c.base != null ? c.base : 1);
    if (util < 0.85 && (!best || rate > best.rate)) best = { name: c.name, rate };
  });
  return { cur, assets, liab, net: assets - liab, inc, exp, savRate: inc ? Math.round((1 - exp / inc) * 100) : 0, dues: dues.slice(0, 5), best };
}

async function aiTip(s) {
  if (!process.env.ANTHROPIC_API_KEY) return "";
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: process.env.CLAUDE_MODEL || "claude-sonnet-4-6", max_tokens: 120, messages: [{ role: "user", content: `One punchy personal-finance tip (max 22 words) for someone with net worth ${fmt(s.net,s.cur)}, this-month savings rate ${s.savRate}%. No preamble.` }] }),
    });
    const j = await r.json(); return (j.content || []).map(b => b.text || "").join("").trim();
  } catch (e) { return ""; }
}

function html(name, s, tip) {
  const row = (l, v, c) => `<tr><td style="padding:6px 0;color:#56635b;font-size:14px">${l}</td><td style="padding:6px 0;text-align:right;font-weight:700;font-size:14px;color:${c||"#16202c"}">${v}</td></tr>`;
  return `<div style="max-width:520px;margin:0 auto;font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#fff;border:1px solid #e2e7e4;border-radius:16px;overflow:hidden">
  <div style="background:#0a7d56;padding:22px 24px;color:#fff"><div style="font-size:13px;opacity:.85">Good morning${name ? ", " + name : ""} 👋</div><div style="font-size:22px;font-weight:700;margin-top:4px">Your money this morning</div></div>
  <div style="padding:22px 24px">
    <div style="font-size:12px;color:#8a958d;text-transform:uppercase;letter-spacing:.05em;font-weight:700">Net worth</div>
    <div style="font-size:32px;font-weight:800;color:#16202c;margin:4px 0 16px">${fmt(s.net, s.cur)}</div>
    <table style="width:100%;border-collapse:collapse;border-top:1px solid #eef1ee">
      ${row("Assets", fmt(s.assets, s.cur), "#0a7d56")}
      ${row("Liabilities", "−" + fmt(s.liab, s.cur), "#c8474f")}
      ${row("Income (this month)", fmt(s.inc, s.cur), "#0a7d56")}
      ${row("Spent (this month)", fmt(s.exp, s.cur), "#c8474f")}
      ${row("Savings rate", s.savRate + "%")}
    </table>
    ${s.best ? `<div style="margin-top:16px;background:#f1f8f4;border-radius:12px;padding:12px 14px"><div style="font-size:12px;color:#0a7d56;font-weight:700">💳 Best card to use today</div><div style="font-size:15px;font-weight:700;margin-top:2px">${s.best.name}</div></div>` : ""}
    ${s.dues.length ? `<div style="margin-top:14px"><div style="font-size:12px;color:#8a958d;font-weight:700;text-transform:uppercase">Coming up</div><ul style="margin:6px 0 0;padding-left:18px;color:#56635b;font-size:13px">${s.dues.map(d => `<li style="margin:3px 0">${d}</li>`).join("")}</ul></div>` : ""}
    ${tip ? `<div style="margin-top:16px;border-left:3px solid #0a7d56;padding:4px 0 4px 12px;color:#16202c;font-size:13.5px;font-style:italic">${tip}</div>` : ""}
  </div>
  <div style="padding:14px 24px;background:#f7f9f8;color:#8a958d;font-size:11px;text-align:center">Finance Tracker · educational only, not financial advice</div>
</div>`;
}

async function sendEmail(to, subject, body) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + process.env.RESEND_API_KEY },
    body: JSON.stringify({ from: process.env.EMAIL_FROM || "Finance Tracker <onboarding@resend.dev>", to: [to], subject, html: body }),
  });
  return r.ok;
}

exports.handler = async () => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY || !process.env.RESEND_API_KEY) {
    return { statusCode: 500, body: "Missing env vars (SUPABASE_URL / SUPABASE_SERVICE_KEY / RESEND_API_KEY)." };
  }
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/app_state?select=data`, {
    headers: { apikey: process.env.SUPABASE_SERVICE_KEY, authorization: "Bearer " + process.env.SUPABASE_SERVICE_KEY },
  });
  const rows = await res.json();
  let sent = 0;
  for (const row of rows || []) {
    const data = row.data; if (!data || !data.notify || !data.notify.enabled || !data.notify.email) continue;
    const s = snapshot(data);
    const tip = await aiTip(s);
    const ok = await sendEmail(data.notify.email, `Your finance snapshot — ${fmt(s.net, s.cur)} net worth`, html(data.profile && data.profile.name, s, tip));
    if (ok) sent++;
  }
  return { statusCode: 200, body: `Sent ${sent} snapshot email(s).` };
};
