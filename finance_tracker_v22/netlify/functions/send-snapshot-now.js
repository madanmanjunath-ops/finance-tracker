/* ============================================================
   netlify/functions/send-snapshot-now.js
   Manual, on-demand trigger for the daily snapshot — for testing
   without waiting for the 7:15 AM cron. Reuses the exact same
   send logic as daily-email.js.

   Protected by a secret: set EMAIL_TEST_SECRET in Netlify env, then
   visit:  /api/send-snapshot-now?key=YOUR_SECRET
   (A redirect maps /api/send-snapshot-now → this function; see netlify.toml.)
   ============================================================ */
const daily = require("./daily-email.js");

exports.handler = async (event) => {
  const key = (event.queryStringParameters && event.queryStringParameters.key) || "";
  const secret = process.env.EMAIL_TEST_SECRET || "";
  if (!secret) return { statusCode: 500, body: "Set EMAIL_TEST_SECRET in Netlify env to use the manual trigger." };
  if (key !== secret) return { statusCode: 401, body: "Bad or missing ?key= secret." };
  try {
    const res = await daily.sendAll();
    return { statusCode: res.statusCode || 200, body: "Manual run — " + (res.body || "done") };
  } catch (e) {
    return { statusCode: 500, body: "Error: " + (e && e.message ? e.message : String(e)) };
  }
};
