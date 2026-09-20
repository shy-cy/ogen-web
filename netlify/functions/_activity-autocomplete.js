// When a closed activity has finished, and nothing else.
//
// PURE. Activities in, a list of the ones due in, out. No store, no GitHub, no
// clock — the caller passes `now`, exactly as _credit.js requires, so the same
// inputs give the same answer a year later and the whole thing is testable with
// no fixtures.
//
// ⚠ WHY THIS EXISTS AT ALL. The listing page and the nav menu both group by
// STATUS and never by a date, because every other part of this site does the
// same — js/activity.js renders the badge and the CTA from `data-status` and
// asks no clock — and because those pages are static build artifacts, so a date
// comparison baked into one is right on the day it is generated and wrong
// afterwards with nothing to notice.
//
// That leaves one drift: `closed` means "underway, registration shut", and it is
// set months before the thing ends. An admin who closes registration in October
// and never flips to `completed` leaves a finished activity filed as running,
// for good. Rather than teach three readers to second-guess the status, the
// status is kept TRUE at the other end — here, nightly. Status stays the single
// source of truth; something else keeps it honest.
//
// It holds nobody's data and opens no store, so it does not arm the legal gate.

const { past } = require('./_credit');
const groups = require('./_activity-groups');

// The only transition this makes. Written as a pair rather than inline so the
// one thing this file may do to a record is visible in one line.
const FROM = 'closed';
const TO = 'completed';

// The last day this activity meets, as YYYY-MM-DD, or null when nothing says.
//
// THE LATER OF THE CALENDAR AND THE TYPED END DATE, and that direction is the
// whole safety argument. Those two can disagree — this repo has carried an
// activity whose typed session count ran out a week before its stated end date —
// and the two possible errors are not symmetric. Completing too EARLY archives a
// running activity and rewrites its public page under a family who is still
// attending. Completing too LATE leaves a finished activity filed as running
// until somebody notices, which is exactly the state this function improves on
// and is harmless in the meantime. So when they disagree, the later one wins.
//
// An excluded date is not a session, so it cannot be the last one — the same
// rule freezeCancellation() follows, and for the same reason: if a holiday
// cannot take a number in the table, it cannot decide when the course ends.
function lastSessionDate(activity) {
  // ⚠ THE UNION, ACROSS EVERY GROUP. An activity is finished when the LAST group
  // has finished — reading one calendar would archive the page, and rewrite it
  // live, while a group that meets on Wednesdays still has two weeks to go.
  // This is one of the two readers that is group-blind on purpose; the other is
  // the check-in codes, for the same reason.
  const duration = ((activity || {}).facts || {}).duration || {};
  const dates = groups.unionDates(activity)
    .filter((r) => r && r.date && r.status !== 'excluded')
    .map((r) => String(r.date))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  // ISO dates sort and compare as strings, so this needs no Date at all.
  const fromCalendar = dates.length ? dates.slice().sort()[dates.length - 1] : null;
  const typed = /^\d{4}-\d{2}-\d{2}$/.test(String(duration.endDate || '')) ? String(duration.endDate) : null;
  if (fromCalendar && typed) return fromCalendar > typed ? fromCalendar : typed;
  return fromCalendar || typed || null;
}

// Has the last day ENDED? past() is _credit.js's, so this is the end of that day
// in Asia/Nicosia and not midnight UTC — an activity whose last session is today
// is still running all of today, and a course finishing on a Tuesday does not
// become "completed" at 02:00 Cyprus time on that Tuesday because a server
// somewhere is on UTC.
//
// A missing date reads as NOT ended, which is the same direction every blank in
// _credit.js takes: an activity nobody finished configuring must not be archived
// on the strength of an empty field.
function hasEnded(activity, now) {
  return past(lastSessionDate(activity), now);
}

// Is this one record due to be completed?
function isDue(activity, now) {
  if (!activity || activity.status !== FROM) return false;
  return hasEnded(activity, now);
}

// The records due, in a stable order so a run's log reads the same way twice.
function dueForCompletion(activities, now) {
  return (activities || [])
    .filter((a) => isDue(a, now))
    .sort((a, b) => String(a.slug).localeCompare(String(b.slug)));
}

// The completed record. A NEW OBJECT — the caller publishes it and the original
// is what a conflict check compares against, so mutating in place would make the
// two indistinguishable.
//
// `lastEditedBy` says `system` rather than borrowing an admin's name. Somebody
// reading the record a month later is entitled to know a person did not do this.
function complete(activity, now) {
  const at = new Date(now == null ? Date.now() : now).toISOString();
  return Object.assign({}, activity, {
    status: TO,
    isoUpdated: at,
    lastEditedBy: 'system',
    lastEditedByName: 'Ogen (scheduled)',
    // Why, and from what. The date it acted on is the interesting half: "it
    // completed on the 24th" is not a useful record, "its last session was the
    // 23rd" is.
    autoCompletedAt: at,
    autoCompletedAfter: lastSessionDate(activity)
  });
}

module.exports = { FROM, TO, lastSessionDate, hasEnded, isDue, dueForCompletion, complete };
