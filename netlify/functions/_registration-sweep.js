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
const REM = require('./_reminders');
const prefs = require('./_reminder-store');
const links = require('./_reminder-link');
const guardians = require('./_guardian-store');
const attendance = require('./_session-attendance');
const facts = require('./_activity-facts');
const groupsMod = require('./_activity-groups');
const { SITE, pathFor } = require('./_email-shell');
const B = require('./_bundle');
const bundleStore = require('./_bundle-store');
const LST = require('./_activity-listing');
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
  const freed = new Map();

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
    // ⚠ KEYED BY GROUP, not by activity. Three holds lapsing in Beginners are
    // one round of messages to that queue, and say nothing to Advanced.
    freed.set(next.activityId + '\u0000' + (next.groupId || ''),
              { activityId: next.activityId, groupId: next.groupId || null });
  }

  // After the whole pass, so three lapsed holds on one activity are one round of
  // messages rather than three.
  for (const f of freed.values()) {
    try { await waitlist.placeOpened(f.activityId, f.groupId); }
    catch (e) { /* never blocks a sweep */ }
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
            // The mode the bundle was BOUGHT in, off its own frozen block. A
            // rehearsal's shortfall comes back as rehearsal credit.
            mode: LST.normaliseMode((bundle.frozen || {}).paymentMode),
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
// ---- the fourth job: remind the people coming tomorrow --------------------
//
// ⚠ THIS IS THE ONE JOB ON THIS SCHEDULE THAT IS LOAD-BEARING, and run()'s own
// comment says why the other three are not: each of them "writes down something
// that has already become true", so a missed night costs nothing and tomorrow's
// pass finds the same work. A reminder has a deadline. Miss the night and the
// message is not late — the class happens and nobody was told.
//
// Two rules follow, and they are the opposite of the other three:
//
//   · IT NEVER SENDS LATE. A session that should have been reminded about
//     yesterday is NOT mailed today, because "your class is tomorrow" arriving on
//     the morning of the class is a different message and a worse one. It is
//     reported instead, loudly, so somebody can pick up the phone.
//   · THE MARK IS WRITTEN BEFORE THE SEND. See _reminder-store.js: a mark with
//     no send costs one reminder and is reported; a send with no mark costs a
//     duplicate every night until the session passes.
//
// "The day before", not "24 hours before". The pass runs once, at 06:00 UTC,
// which is 08:00 or 09:00 in Nicosia — so a 19:30 class gets about 34 hours and
// a 09:00 class about 24. Exact-hour precision would need an hourly function and
// would land some reminders at three in the morning; the .ics carries the real
// time either way.
const REMIND_CAP = 60;

async function remindUpcomingSessions(at) {
  const when = at == null ? Date.now() : at;
  const admin = require('./activities-admin')._internal;
  const published = await admin.allPublished();
  const live = published.filter((a) => REM.isLive(a) && REM.remindersOn(a));

  const tomorrow = REM.localDate(when, 1);
  const today = REM.localDate(when, 0);

  const planned = [];   // { activity, session, recipients }
  const missed = [];

  for (const activity of live) {
    for (const date of [tomorrow, today]) {
      const late = date === today;
      for (const session of REM.sessionsOn(activity, date)) {
        const people = await peopleFor(activity, session, when);
        for (const r of people) planned.push({ activity, session, person: r, late });
      }
    }
  }

  // One read per (account, activity, date), together rather than in a loop —
  // the discipline _blobs.js exists for.
  const marks = await prefs.sentMany(planned.map((p) => ({
    accountId: p.person.accountId, activityId: p.activity.activityId, date: p.session.date })));
  const offs = await prefs.offMany(planned.map((p) => ({
    accountId: p.person.accountId, activityId: p.activity.activityId })));

  const due = [];
  planned.forEach((p, i) => {
    if (marks[i]) return;                       // already told
    if (offs[i]) return;                        // asked us not to
    // ⚠ A SESSION THAT IS ALREADY TODAY IS SKIPPED AND NAMED, never sent.
    if (p.late) {
      missed.push({ slug: p.activity.slug, date: p.session.date,
                    accountId: p.person.accountId });
      return;
    }
    due.push(p);
  });

  const capped = due.slice(0, REMIND_CAP);
  const deferred = due.length - capped.length;

  let sent = 0;
  const failed = [];
  // Concurrent and capped, because SEND_TIMEOUT_MS is 6 seconds and a function
  // has ten: a roster mailed one at a time is how this job runs out of time and
  // silently reminds half a class.
  await mapCapped(capped, 8, async (p) => {
    try {
      // BEFORE the send. See the note above.
      await prefs.markSent(p.person.accountId, p.activity.activityId, p.session.date,
        { slug: p.activity.slug, groupId: p.session.groupId });
      // ⚠ COUNT WHAT WENT, NOT WHAT WAS ATTEMPTED. settle() SWALLOWS a failed
      // send and answers false — which is right, because an email must never take
      // down the thing it accompanies — so a counter that incremented regardless
      // would report a clean run on a night when every message bounced off a
      // misconfigured sender. A test caught exactly that.
      if (await sendOne(p)) sent++;
      else failed.push({ slug: p.activity.slug, date: p.session.date, error: 'send-failed' });
    } catch (err) {
      failed.push({ slug: p.activity.slug, date: p.session.date,
                    error: (err && err.message) || String(err) });
    }
  });

  // ⚠ A MISSED REMINDER IS TOLD TO A HUMAN, not left in a log nobody opens. The
  // whole point of refusing to send late is that somebody decides what to do
  // instead, and they cannot decide what they are not told.
  if (missed.length) {
    try { await mail.sendRemindersMissed(missed, deferred); }
    catch (e) { /* never blocks the sweep */ }
  }

  return { considered: live.length, due: due.length, sent: sent,
           missed: missed, deferred: deferred, failed: failed,
           on: tomorrow };
}

// Who is coming to this session, grouped into ONE entry per account.
//
// ⚠ BOTH GUARDIANS, NOT THE ONE WHO REGISTERED. A participant can have two, the
// link store exists precisely so that is representable, and the parent doing
// Tuesday's lift is not reliably the one who filled the form in.
//
// ⚠ AND ONE MESSAGE PER ACCOUNT, NOT PER CHILD. Two children of one family in
// one class is one email naming both — two near-identical messages twenty-four
// times over a year is the thing that teaches a family to filter us.
//
// The unit differs by type and the rule does not: remind whoever is expected at
// this session. On a course that is an APPROVED registration; on a drop-in it is
// a BOOKED evening, so a family who has not booked tomorrow hears nothing, which
// is right — they are not coming.
async function peopleFor(activity, session, at) {
  const regs = await store.forActivity(activity.activityId);
  const byParticipant = new Map();
  regs.forEach((r) => { if (r && r.participantId) byParticipant.set(r.participantId, r); });

  let coming;
  if (activity.type === 'dropin') {
    coming = (await attendance.forDate(activity.activityId, session.date))
      .filter((a) => a && a.status === 'booked')
      .map((a) => byParticipant.get(a.participantId))
      .filter(Boolean);
  } else {
    coming = regs.filter((r) => r && r.status === 'approved')
      // ⚠ A REGISTRATION WITH NO GROUP MATCHES ANY OF THEM, the rule
      // placeOpened() already follows: those were taken while the activity was
      // pooled, nobody asked them to choose, and calendarFor() reads them the
      // union of every group's dates. Reading the blank as "not this one" would
      // silence exactly the families who have been on the list longest.
      .filter((r) => !r.groupId || !session.groupId || r.groupId === session.groupId);
  }
  if (!coming.length) return [];

  const byAccount = new Map();
  await mapCapped(coming, 8, async (reg) => {
    const links = await guardians.guardiansOf(reg.participantId);
    links.forEach((link) => {
      const id = link && link.accountId;
      if (!id) return;
      const got = byAccount.get(id) || { accountId: id, reg: reg, names: [] };
      const name = (reg.frozen || {}).participantName || '';
      if (name && got.names.indexOf(name) === -1) got.names.push(name);
      byAccount.set(id, got);
    });
  });
  // Stable order, so a run is reproducible and a test can read it back.
  return Array.from(byAccount.values())
    .map((p) => Object.assign({}, p, { names: p.names.slice().sort() }))
    .sort((a, b) => String(a.accountId).localeCompare(String(b.accountId)));
}

// Build and send one reminder. Everything the message needs is a parameter, so
// the builder stays runnable with no store — the rule every message here keeps.
async function sendOne(p) {
  const account = await accounts.getAccount(p.person.accountId);
  if (!account || !account.email) return false;
  const l = ((account.profile || {}).preferredLanguage) || 'he';
  const activity = p.activity;
  const session = p.session;

  // ⚠ READ LIVE, NEVER FROZEN. The frozen block is what money is computed
  // against; a reminder is "where to be tomorrow", and a room that has moved has
  // to reach them — the same decision the address itself already makes.
  const where = facts.whereFor(activity, session.groupId);
  const when = [facts.dayAndMonth(session.date, l), session.time]
    .filter(Boolean).join(', ');

  const ics = mail.sessionIcs(activity, session, l);

  const link = await links.linkFor(p.person.accountId, activity.activityId,
    facts.pick(activity.title, l), l);

  return await mail.sendReminder(p.person.reg, account, {
    names: p.person.names,
    when: when,
    // Only when there is a choice to have made. Naming the group on a
    // single-group activity describes a structure nobody has been shown.
    groupName: groupsMod.offersAChoice(activity)
      ? facts.pick(session.groupName, l) : '',
    where: where,
    hasIcs: !!ics,
    ics: ics,
    unsubscribeUrl: SITE + '/reminders?t=' + encodeURIComponent(link.token) + '&l=' + l
  });
}

// Bounded concurrency, results discarded. Same shape as readMany's worker pool.
async function mapCapped(items, limit, fn) {
  let next = 0;
  await Promise.all(new Array(Math.min(limit, items.length)).fill(null).map(async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      await fn(items[i]);
    }
  }));
}

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

  // FOURTH, and last, in its own try for the reason the two above it are: it must
  // neither be stopped by them nor stop them. It is last because it is the only
  // one that sends mail to families on a schedule, and the three before it are
  // repairs that should land whatever happens here.
  let reminders = { considered: 0, due: 0, sent: 0, missed: [], deferred: 0, failed: [], error: null };
  try {
    reminders = await remindUpcomingSessions(at);
  } catch (err) {
    reminders.error = (err && err.message) || String(err);
  }

  return Object.assign({}, registrations,
    { activities: activities, bundles: bundles, reminders: reminders });
}

module.exports = { run, runRegistrations, completeFinishedActivities, reconcileBundles,
                   remindUpcomingSessions, REMIND_CAP };
