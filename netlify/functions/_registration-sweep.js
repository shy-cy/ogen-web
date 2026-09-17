// The nightly pass. TWO JOBS, and they share a schedule rather than a subject:
// releasing registrations nobody answered, and completing activities that have
// finished. Both are the same KIND of work — writing down something that has
// already become true — which is why they run together and why neither is
// load-bearing.
//
// IT IS THE COSMETIC HALF, AND SAYING SO IS THE POINT. holdsASpot() in
// _registration.js already treats a lapsed pending registration as holding
// nothing, so the capacity numbers are correct whether or not this ever runs.
// What this adds is the human-visible half — a queue must not say "pending"
// forever — and the message to the family. If the schedule breaks, a dashboard
// goes stale; nothing is miscounted, and nobody's place is given away twice.
//
// Which is also why it is safe to run by hand, repeatedly, from the admin: it
// only ever rewrites records the derived rule already considers expired, and a
// second pass finds none of them.
//
// ⚠ Arms the legal gate, correctly.

const store = require('./_registration-store');
const accounts = require('./_account-store');
const R = require('./_registration');
const mail = require('./_registration-email');
const auto = require('./_activity-autocomplete');
const { recordAudit } = require('./_audit');

// Who the commit is by. A real name rather than a blank author, and one that
// cannot be mistaken for a person — somebody reading the git history a year
// later should not have to work out which admin published at 06:00.
const SYSTEM = { name: 'Ogen (scheduled)', email: 'noreply@ogen.cy' };

// ---- the second job: finish what has finished -----------------------------
//
// A `closed` activity whose last session has passed becomes `completed`, and
// that is a PUBLISH: the status lives in the record, on three static pages and
// in the listing, so changing it in the record alone would leave the live site
// saying "registration closed" under an activity that ended in December.
//
// It goes through activities-admin's generate(), the same function an admin's
// publish goes through and the same one preview is asserted byte-identical
// against. A second renderer here would be a second thing to keep in step.
//
// ⚠ REQUIRED LAZILY. activities-admin pulls in GitHub, Blobs, the template and
// the image pipeline; the registration half of this sweep needs none of it, and
// a scheduled function has ten seconds. Nothing is loaded until there is
// actually something to publish.
async function completeFinishedActivities(at) {
  const admin = require('./activities-admin')._internal;
  const published = await admin.allPublished();
  const due = auto.dueForCompletion(published, at);
  const completed = [];
  const failed = [];

  for (const activity of due) {
    try {
      // ONE AT A TIME, and each one commits. Batching them into a single commit
      // would be fewer requests and would also mean one bad record takes the
      // rest down with it — and this runs unattended, so the failure would be a
      // log line nobody reads until a family asks why the page is wrong.
      const next = auto.complete(activity, at);
      const result = await admin.generate(next, {
        commit: true,
        session: SYSTEM,
        message: `Complete activity: ${activity.slug} (last session ${next.autoCompletedAfter})`,
        previous: activity
      });
      completed.push({ slug: activity.slug, after: next.autoCompletedAfter, commit: result.commit && result.commit.sha });
      // Best effort and after the write, the same order every audited action in
      // this codebase uses: an audit entry that fails must not undo the thing it
      // was describing.
      await recordAudit(SYSTEM, 'activity.autocomplete', activity.slug, 'ok',
        { from: auto.FROM, to: auto.TO, lastSession: next.autoCompletedAfter });
    } catch (err) {
      // One activity's failure is not the run's. It stays `closed`, tomorrow's
      // run finds it again, and the log names it.
      failed.push({ slug: activity.slug, error: (err && err.message) || String(err) });
      await recordAudit(SYSTEM, 'activity.autocomplete', activity.slug, 'failed',
        { error: (err && err.message) || String(err) });
    }
  }
  return { considered: published.length, due: due.length, completed, failed };
}

// ---- the first job: release what nobody answered --------------------------
//
// SPLIT OUT FROM run() ON PURPOSE, and this is the whole reason: the admin's
// "Run now" button is gated on canApprove — a REGISTRATIONS permission — and
// says it "only updates what the queue says and tells the family". The activity
// half commits to git and republishes live pages, which is an ACTIVITIES
// permission and not what that button claims to do. An admin who may work the
// queue but may not publish must not publish by pressing it.
//
// So the admin calls this, and only the scheduled function calls run().
async function runRegistrations(now) {
  const at = now == null ? Date.now() : now;
  const all = await store.allRegistrations();
  const lapsed = all.filter((r) => R.hasLapsed(r, at));
  const expired = [];

  for (const reg of lapsed) {
    const next = R.transition(reg, {
      status: 'expired', by: 'system', now: at,
      // Named, because "why did this one expire in three days" is a question
      // somebody asks a month later and the record is the only place with an
      // answer.
      note: 'unanswered for ' + reg.expiryDays + ' days (' + reg.expirySource + ')'
    });
    await store.saveRegistration(next);
    expired.push(R.key(next.participantId, next.activityId));

    // Best effort, after the write, one guardian at a time. The account that
    // SUBMITTED is the one told — it is the one that was waiting for an answer,
    // and it is the one the record names as owing.
    const account = await accounts.getAccount(next.accountId);
    if (account) await mail.sendExpired(next, account);
  }

  return { checked: all.length, expired: expired.length, keys: expired, at: new Date(at).toISOString() };
}

// ---- the nightly job: both halves -----------------------------------------
//
// The scheduled function's entry point, and nothing else should call it. The
// two halves share a schedule rather than a subject: each writes down something
// that has already become true, and neither is load-bearing. Registrations run
// first and cannot be taken down by the activity half — they are already
// written, and an activity that fails to publish is simply found again tomorrow.
async function run(now) {
  const at = now == null ? Date.now() : now;
  const registrations = await runRegistrations(at);

  let activities = { considered: 0, due: 0, completed: [], failed: [], error: null };
  try {
    activities = await completeFinishedActivities(at);
  } catch (err) {
    activities.error = (err && err.message) || String(err);
  }

  return Object.assign({}, registrations, { activities: activities });
}

module.exports = { run, runRegistrations, completeFinishedActivities };
