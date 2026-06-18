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
  '"bill generated" OR "bill is generated" OR "bill is ready" OR "new bill" OR ' +
  '"payment due" OR "due date" OR "amount due" OR "total amount due" OR "min amount due" OR ' +
  '"pay by" OR "due on" OR "premium due" OR "premium reminder" OR "renewal" OR ' +
  '"emi due" OR "recharge" OR "plan expiring" OR "bill payment reminder")' +
  ') -in:chats -in:sent';

// Routine query (recent only) and backfill query (wide window).
function recentQuery()   { return 'newer_than:' + LOOKBACK_DAYS + 'd ' + MATCH_FILTER; }
function backfillQuery() { return 'newer_than:' + BACKFILL_DAYS + 'd ' + MATCH_FILTER; }

// ---------- main ----------
function checkGmail() { run(recentQuery()); }

function run(query) {
  var threads = GmailApp.search(query, 0, 200);
  var props = PropertiesService.getUserProperties();
  var seen = JSON.parse(props.getProperty("seenIds") || "{}");
  var processed = 0, scanned = 0;

  outer:
  for (var t = 0; t < threads.length; t++) {
    var msgs = threads[t].getMessages();
    for (var m = 0; m < msgs.length; m++) {
      var msg = msgs[m];
      scanned++;
      var id = msg.getId();
      if (seen[id]) continue;
      var body = msg.getPlainBody();
      var text = "Subject: " + msg.getSubject() + "\nFrom: " + msg.getFrom() + "\n\n" + body;
      try {
        var res = UrlFetchApp.fetch(WEBHOOK_URL, {
          method: "post",
          contentType: "application/json",
          muteHttpExceptions: true,
          payload: JSON.stringify({ token: INGEST_TOKEN, text: text.slice(0, 4000) }),
        });
        Logger.log(msg.getSubject() + " → " + res.getResponseCode() + " " + res.getContentText());
        seen[id] = Date.now();
        processed++;
        if (processed >= MAX_PER_RUN) { Logger.log("Hit MAX_PER_RUN (" + MAX_PER_RUN + ") — run again to continue."); break outer; }
      } catch (e) {
        Logger.log("Error: " + e);
      }
    }
  }

  // prune old seen ids (keep ~45 days)
  var cutoff = Date.now() - 45 * 86400000;
  Object.keys(seen).forEach(function (k) { if (seen[k] < cutoff) delete seen[k]; });
  props.setProperty("seenIds", JSON.stringify(seen));
  Logger.log("Done. Scanned " + scanned + " message(s), forwarded " + processed + " new one(s).");
}

// Run this ONCE to test + approve permissions (checks the last few days)
function testOnce() { checkGmail(); }

// ONE-TIME history import. Run this manually to backfill old emails
// (BACKFILL_DAYS above). Re-run until it logs "forwarded 0" — each run
// handles up to MAX_PER_RUN messages so it won't time out.
function backfill() { run(backfillQuery()); }

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
