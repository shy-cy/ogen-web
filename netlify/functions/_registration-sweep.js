// The nightly pass. THREE JOBS, and they share a schedule rather than a subject:
// releasing registrations nobody answered, completing activities that have
// finished, and keeping every bundle's promise against a calendar that moved.
// All three are the same KIND of work — writing down something that has already
// become true — which is why they run together and why none is load-bearing.
//
// The third is the one exception worth naming: when an activity is genuinely
// over and a bundle could not be honoured in full, it writes a CREDIT. That is
// money, so it follows the money rule rather than the cosmetic one — ledger
// first, record second — and it is deliberately the last thing to run.
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
const waitlist = require('./_waitlist');
const auto = require('./_activity-autocomplete');
const B = require('./_bundle');
const bundleStore = require('./_bundle-store');
const ledger = require('./_credit-ledger');
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
  const freed = new Set();

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
    // ⚠ THE PLACE WAS ALREADY FREE, and that is exactly why this belongs here.
    // holdsASpot() stopped counting a lapsed hold the instant it lapsed, so
    // nothing about capacity was waiting on this job — but nobody had been TOLD,
    // and a queue nobody is told about is a queue that never moves. It is the
    // one place a freed place has no human action behind it to announce it.
    freed.add(next.activityId);
  }

  // After the whole pass, so three lapsed holds on one activity are one round of
  // messages rather than three.
  for (const activityId of freed) {
    try { await waitlist.placeOpened(activityId); } catch (e) { /* never blocks a sweep */ }
  }
  return { checked: all.length, expired: expired.length, keys: expired,
           toldWaiting: freed.size, at: new Date(at).toISOString() };
}

// ---- the third job: keep every bundle's promise ---------------------------
//
// THE PROMISE IS THE ENTRY COUNT, NOT THE WINDOW. A family bought ten sessions;
// if we cancel one of the dates their bundle was holding, they are owed a
// replacement — reaching PAST the validity window if it has to, because the
// window exists to bound a promise rather than to break it.
//
// reconcile() is idempotent, which is what lets this run over every bundle every
// night with no flag saying whether it has already looked. Most nights it
// changes nothing.
//
// ⚠ AND THE SHORTFALL IS CREDITED ONLY WHEN THE ACTIVITY IS OVER.
//
// A shortfall today is not a shortfall: an admin who excludes a session this
// week usually adds one next week, and crediting on the spot would pay a family
// for a date they are about to be given back — and then hand them the date too.
// So the trigger is that there are NO DATES AHEAD AT ALL. Nothing more can be
// offered, so what is missing is missing for good.
//
// Note what does NOT produce a shortfall: a date the family simply let pass
// unused. reconcile() keeps those in the coverage precisely so they cannot be
// replaced, which is the window doing its job — the entry was theirs and they
// did not use it. Only a date that LEFT THE CALENDAR is ours to make good.
async function reconcileBundles(at) {
  const admin = require('./activities-admin')._internal;
  const published = await admin.allPublished();
  const dropins = published.filter((a) => a && a.type === 'dropin');
  const out = { considered: 0, adjusted: 0, credited: 0, creditedCents: 0, failed: [] };

  for (const activity of dropins) {
    const held = await bundleStore.forActivity(activity.activityId);
    for (const bundle of held) {
      out.considered++;
      // ⚠ PER BUNDLE, NOT PER ACTIVITY, because it gates a CREDIT. The shortfall
      // is written only when nothing is left to replace a lost session with, and
      // where the groups keep their own calendars "nothing left" is a question
      // about this family's timetable. Asked of the activity, a Beginners bundle
      // would be told the term is still running because Advanced meet next week,
      // and a credit they are owed would never be written.
      const ahead = B.datesAhead(activity, at, bundle.groupId || null).length;
      try {
        const result = B.reconcile(bundle, activity, at);
        let dirty = false;
        if (result.changed) {
          bundle.coveredDates = result.coveredDates;
          bundle.history = (bundle.history || []).concat([{
            iso: new Date(at).toISOString(), action: 'reconciled', by: 'system',
            note: 'coverage rebuilt: ' + result.coveredDates.length + ' of ' + (bundle.frozen || {}).entries
          }]);
          dirty = true;
          out.adjusted++;
        }

        const owed = result.shortfallCents;
        const already = bundle.shortfallCreditedCents || 0;
        if (ahead === 0 && result.shortfall > 0 && owed > already) {
          const amount = owed - already;
          // ⚠ THE LEDGER FIRST, THE RECORD SECOND — the money rule, which is the
          // opposite of the email rule and wins over it. A credit not written is
          // money lost with nobody able to tell; a credit written twice is a
          // visible line in an append-only record a person reads, and is
          // reversible with an adjustment.
          await ledger.append({
            accountId: bundle.accountId, type: 'credit', amountCents: amount,
            reason: 'bundle-shortfall',
            basis: {
              bundleId: bundle.bundleId, purchasedAt: bundle.purchasedAt,
              entries: (bundle.frozen || {}).entries,
              covered: result.coveredDates.length,
              shortfall: result.shortfall,
              // The rate that was PAID, not the standard one. A family who
              // bought ten at the bundle rate and could use six is credited four
              // at that rate; re-pricing the six they used at the standard rate
              // would charge them more for a shortfall that was ours.
              pricePerEntry: (bundle.frozen || {}).pricePerEntry
            },
            createdBy: 'system'
          });
          bundle.shortfallCreditedCents = owed;
          bundle.history = (bundle.history || []).concat([{
            iso: new Date(at).toISOString(), action: 'shortfall-credited', by: 'system',
            note: result.shortfall + ' entries · ' + amount + 'c'
          }]);
          dirty = true;
          out.credited++;
          out.creditedCents += amount;
        }

        if (dirty) {
          bundle.status = B.statusAfter(bundle, result.shortfall);
          await bundleStore.saveBundle(bundle);
        }
      } catch (err) {
        // One bundle failing must not take the rest down. It is found again
        // tomorrow, and reconcile() is idempotent, so nothing is half-done.
        out.failed.push({ bundle: bundle.bundleId, participantId: bundle.participantId,
                          error: (err && err.message) || String(err) });
      }
    }
  }
  return out;
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

  // THIRD, and independently. It touches no git and publishes nothing, so a
  // failure in the activity half above must not stop a family's bundle being
  // repaired — and its own failure must not stop anything either.
  let bundles = { considered: 0, adjusted: 0, credited: 0, creditedCents: 0, failed: [], error: null };
  try {
    bundles = await reconcileBundles(at);
  } catch (err) {
    bundles.error = (err && err.message) || String(err);
  }

  return Object.assign({}, registrations, { activities: activities, bundles: bundles });
}

module.exports = { run, runRegistrations, completeFinishedActivities, reconcileBundles };
