/****************************************************************
 * Finance Tracker — Gmail → app ingestion (Google Apps Script)
 *
 * This runs inside YOUR Google account on a timer, finds new bank
 * / card emails, and forwards their text to your app's secure
 * webhook. No Gmail API verification needed — it runs as you.
 *
 * SETUP (≈10 min) — see GMAIL-SETUP.md for screenshots:
 *  1. Go to https://script.google.com → New project.
 *  2. Delete the sample code, paste ALL of this.
 *  3. Edit the two CONFIG values below (your site URL + token).
 *  4. Run "testOnce" once → approve the permissions prompt.
 *  5. Run "createTrigger" once → it checks Gmail every 15 minutes.
 ****************************************************************/

// ---------- CONFIG — edit these two ----------
var WEBHOOK_URL = "https://YOUR-SITE.netlify.app/api/ingest";  // your deployed site + /api/ingest
var INGEST_TOKEN = "PASTE_YOUR_TOKEN_HERE";                    // from the app: Settings → Gmail import

// How far back the routine 15-min check looks (keep small for steady-state).
var LOOKBACK_DAYS = 3;

// One-time history import window (used by the backfill() function below).
// NOTE: backfill is optional and only runs if you run backfill() manually —
// the normal forwarder only processes new emails as they arrive. For old
// history, prefer importing your banks' Excel/CSV exports in the app
// (Import → Statements & files); that path is instant and free.
var BACKFILL_DAYS = 365;          // window for the optional manual backfill
var MAX_PER_RUN = 60;             // cap per run so Apps Script doesn't time out

// A transient failure (server/AI/billing outage) is NOT marked seen, so it
// retries on later runs and recovers on its own once the outage clears. Give
// up after this many days so a genuinely unprocessable email can't loop forever.
var GIVE_UP_DAYS = 7;

// Which emails count. Two groups:
//  1) transaction alerts (debited/credited/spent), and
//  2) BILL emails (bill generated, payment due, premium/EMI/recharge reminders)
//     — these become "Upcoming bills" in the app instead of expenses.
// This is intentionally broad — tighten later if it forwards too much.
// Add your banks' / billers' sender domains for best results.
var MATCH_FILTER =
  '(' +
  'from:(hdfcbank OR icicibank OR axisbank OR kotak OR sbi OR sbicard OR onecard OR ' +
  'amex OR americanexpress OR idfcfirstbank OR rblbank OR yesbank OR federalbank OR ' +
  'alerts OR transaction OR noreply OR statements OR cards OR estatement OR scapia OR ' +
  'airtel OR jio OR vi OR bsnl OR tataplay OR actcorp OR bescom OR tneb OR adanigas OR ' +
  'mahadiscom OR torrentpower OR lic OR policybazaar OR hdfcergo OR icicilombard OR ' +
  'bajajallianz OR starhealth OR niva) ' +
  'OR subject:(debited OR credited OR "transaction alert" OR "spent on" OR "payment of" OR ' +
  '"has been debited" OR "has been credited" OR "txn" OR "transaction" OR "statement" OR ' +
  '"e-statement" OR "card was used" OR "received in your account" OR ' +
  '"credit limit" OR "available limit" OR "available credit limit" OR "limit increase" OR ' +
  '"limit enhanced" OR "limit enhancement" OR "limit revised" OR "limit update" OR ' +
  '"bill generated" OR "bill is generated" OR "bill is ready" OR "new bill" OR ' +
  '"payment due" OR "due date" OR "amount due" OR "total amount due" OR "min amount due" OR ' +
  '"pay by" OR "due on" OR "premium due" OR "premium reminder" OR "renewal" OR ' +
  '"emi due" OR "recharge" OR "plan expiring" OR "bill payment reminder")' +
  ') -in:chats -in:sent';

// ---------- "only from now on" cutoff ----------
// The routine 15-min check forwards ONLY emails received AFTER this moment.
// Set it by running startFromNow() once (e.g. right after a resetSeen(), so an
// emptied seen-set can't cause the last few days to be re-forwarded). Stored
// per-user as epoch seconds, so clearing seenIds later never re-imports history.
function getStartAfter() {
  var v = PropertiesService.getUserProperties().getProperty("startAfter");
  return v ? parseInt(v, 10) : 0;   // 0 = no cutoff (rolling window)
}
// Run this ONCE to make the forwarder ignore everything up to now and only
// process emails that arrive from this point forward.
function startFromNow() {
  var now = Math.floor(Date.now() / 1000);
  PropertiesService.getUserProperties().setProperty("startAfter", String(now));
  Logger.log("Cutoff set. Only emails received after " + new Date(now * 1000) + " will be forwarded from now on.");
}
// Remove the cutoff (revert the routine check to the rolling LOOKBACK_DAYS window).
function clearStartAfter() {
  PropertiesService.getUserProperties().deleteProperty("startAfter");
  Logger.log("Cutoff cleared — the routine check reverts to the newer_than:" + LOOKBACK_DAYS + "d window.");
}

// Routine query (recent only) and backfill query (wide window).
// With a cutoff set, ask Gmail directly for messages after it; otherwise use
// the rolling LOOKBACK_DAYS window. (Gmail's after: accepts epoch seconds.)
function recentQuery() {
  var startAfter = getStartAfter();
  var timeClause = startAfter ? ('after:' + startAfter) : ('newer_than:' + LOOKBACK_DAYS + 'd');
  return timeClause + ' ' + MATCH_FILTER;
}
function backfillQuery() { return 'newer_than:' + BACKFILL_DAYS + 'd ' + MATCH_FILTER; }

// ---------- main ----------
function checkGmail() { run(recentQuery(), true); }

// enforceCutoff: routine checks pass true so pre-cutoff mail is never forwarded;
// backfill() passes false because its whole job is to pull older history.
function run(query, enforceCutoff) {
  var threads = GmailApp.search(query, 0, 200);
  var props = PropertiesService.getUserProperties();
  var seen = JSON.parse(props.getProperty("seenIds") || "{}");
  var fails = JSON.parse(props.getProperty("failIds") || "{}"); // id -> first-failure time (ms)
  var startAfterMs = enforceCutoff ? getStartAfter() * 1000 : 0;
  var giveUpMs = GIVE_UP_DAYS * 86400000;
  var attempts = 0, scanned = 0, booked = 0, willRetry = 0, gaveUp = 0;

  outer:
  for (var t = 0; t < threads.length; t++) {
    var msgs = threads[t].getMessages();
    for (var m = 0; m < msgs.length; m++) {
      var msg = msgs[m];
      scanned++;
      var id = msg.getId();
      if (seen[id]) continue;
      // Message-level cutoff: a new reply can pull an OLD message back into the
      // search (threads match by any message). Skip anything at/before the
      // cutoff and mark it seen so it's never forwarded or rescanned.
      if (startAfterMs && msg.getDate().getTime() <= startAfterMs) { seen[id] = Date.now(); continue; }

      // Collapse whitespace bloat: HTML bank emails flatten into hundreds of
      // blank, deeply-indented lines, which push the real transaction details
      // (payee / UPI ref) past the length limit below and get them truncated
      // away. Collapsing runs of spaces and blank lines keeps the content intact.
      var body = msg.getPlainBody()
        .replace(/[ \t ]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{2,}/g, "\n")
        .trim();
      // NOTE: we deliberately do NOT prepend "From: <sender>" to the text — the
      // bank's name in the From line was anchoring the AI to pick the bank as the
      // merchant instead of the actual payee in the body. Send subject + body only.
      var text = "Subject: " + msg.getSubject() + "\n\n" + body;

      // Forward, then decide whether the server DEFINITIVELY handled it (terminal)
      // or this was a transient failure to retry later. We mark a message seen
      // ONLY on a terminal outcome, so an outage (HTTP error / parse_failed)
      // leaves it unseen and it re-forwards automatically once the outage clears.
      var terminal = false, logLine = "";
      try {
        var res = UrlFetchApp.fetch(WEBHOOK_URL, {
          method: "post",
          contentType: "application/json",
          muteHttpExceptions: true,
          payload: JSON.stringify({ token: INGEST_TOKEN, text: text.slice(0, 4000), sender: msg.getFrom() }),
        });
        var code = res.getResponseCode();
        var bodyTxt = res.getContentText();
        var ok = false, reason = "";
        try { var j = JSON.parse(bodyTxt); ok = (j.ok === true); reason = j.reason || j.booked || ""; } catch (eParse) {}
        // Terminal = HTTP 200 AND (ok:true OR any ok:false reason other than
        // "parse_failed"). Only parse_failed and HTTP/network errors are transient.
        terminal = (code === 200) && (ok || (reason && reason !== "parse_failed"));
        logLine = code + " " + bodyTxt;
      } catch (e) {
        terminal = false; // network-level failure (DNS/timeout) → transient
        logLine = "fetch error: " + e;
      }
      Logger.log(msg.getSubject() + " → " + logLine + (terminal ? "" : " [transient — will retry]"));

      if (terminal) {
        seen[id] = Date.now(); delete fails[id]; booked++;
      } else {
        // keep it UNSEEN so it retries — unless it has been failing longer than
        // GIVE_UP_DAYS, in which case stop retrying so it can't loop forever.
        if (!fails[id]) fails[id] = Date.now();
        if (Date.now() - fails[id] > giveUpMs) {
          seen[id] = Date.now(); delete fails[id]; gaveUp++;
          Logger.log("Gave up after " + GIVE_UP_DAYS + "d, marking seen: " + msg.getSubject());
        } else { willRetry++; }
      }

      attempts++;
      if (attempts >= MAX_PER_RUN) { Logger.log("Hit MAX_PER_RUN (" + MAX_PER_RUN + ") — run again to continue."); break outer; }
    }
  }

  // prune old seen ids (keep ~45 days); drop fail records that are now seen
  var cutoff = Date.now() - 45 * 86400000;
  Object.keys(seen).forEach(function (k) { if (seen[k] < cutoff) delete seen[k]; });
  Object.keys(fails).forEach(function (k) { if (seen[k]) delete fails[k]; });
  props.setProperty("seenIds", JSON.stringify(seen));
  props.setProperty("failIds", JSON.stringify(fails));
  Logger.log("Done. Scanned " + scanned + ", forwarded " + booked + ", will retry " + willRetry + ", gave up " + gaveUp + ".");
}

// Run this ONCE to test + approve permissions (checks the last few days)
function testOnce() { checkGmail(); }

// ONE-TIME history import. Run this manually to backfill old emails
// (BACKFILL_DAYS above). Re-run until it logs "forwarded 0" — each run
// handles up to MAX_PER_RUN messages so it won't time out.
function backfill() { run(backfillQuery(), false); }

// Run this ONCE to schedule the routine check every 15 minutes
function createTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "checkGmail") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("checkGmail").timeBased().everyMinutes(15).create();
  Logger.log("Trigger created — Gmail will be checked every 15 minutes.");
}

// Optional: clear the de-dupe memory (re-imports recent emails)
function resetSeen() { PropertiesService.getUserProperties().deleteProperty("seenIds"); }
