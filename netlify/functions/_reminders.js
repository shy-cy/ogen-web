// _reminders.js — which session a family should be reminded about, and the
// calendar event that goes with it.
//
// PURE. No store, no GitHub, no clock: `now` is the caller's to pass, for the
// reason _credit.js states and for one more that matters here — a reminder pass
// that asked the time itself could not be tested against a session in 2027
// without waiting for 2027.
//
// IT OPENS NO STORE AND NAMES NOBODY, so it does not arm the legal gate. The
// store that records what was sent does, and is declared there.
//
// ⚠ WHY THE REMINDER IS NOT LIKE THE OTHER THREE SWEEP JOBS. run() says its jobs
// "share a schedule rather than a subject: each writes down something that has
// already become true, and neither is load-bearing". Releasing a lapsed hold,
// completing a finished activity and repairing a bundle are all repairs — a
// missed night costs nothing, because tomorrow's pass finds the same thing. A
// reminder is the opposite: the day passes, and the message is not late, it is
// never sent at all. That is why a missed one is REPORTED rather than quietly
// sent after the fact.

const groups = require('./_activity-groups');
const credit = require('./_credit');
const listing = require('./_activity-listing');

const TZ = credit.TZ;

// Statuses that still occupy a room, so still have somebody turning up to
// remind. Borrowed from _activity-calendar's own list rather than rewritten:
// `completed` and `cancelled` have nobody to tell, and a `draft` has no page.
const RUNNING = ['open', 'closed', 'waitlist', 'announcement'];

// ⚠ A REHEARSAL REMINDS NOBODY. `test` is the listing state whose payments are
// pretend and whose families are staff — the same exclusion the clash report
// makes, for the same reason. `unlisted` IS included: it is a real class with the
// advertising switched off, and the people in it turn up like anybody else.
function isLive(activity) {
  if (!activity) return false;
  if (RUNNING.indexOf(String(activity.status)) === -1) return false;
  return listing.listingOf(activity) !== 'test';
}

// ⚠ ON UNLESS AN ADMIN SAYS OTHERWISE, and absent means on.
//
// Every activity in the repository predates this field, and reading a blank as
// "switched off" would ship a feature that silently does nothing on every
// existing class — which is indistinguishable from a feature that is broken. The
// direction every other blank in this system takes, pointing at the family.
function remindersOn(activity) {
  return ((activity && activity.registration) || {}).sessionReminders !== false;
}

// The calendar date `days` from an instant, as seen in Cyprus.
//
// ⚠ NOT A UTC DATE ARITHMETIC. The pass runs at 06:00 UTC, which is 08:00 or
// 09:00 in Nicosia depending on the time of year, and a class is on a Cypriot
// calendar day rather than a Greenwich one. Computing "tomorrow" by adding
// 86400000 and slicing an ISO string is right for most of the year and wrong
// around a clock change, which is the kind of bug that fires twice a year and is
// blamed on something else.
function localDate(atMs, days, tz) {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz || TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const today = dtf.format(new Date(atMs)); // en-CA formats as YYYY-MM-DD
  const p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!p) return null;
  // Shifted as a plain calendar date, which has no zone and therefore no DST.
  const d = new Date(Date.UTC(+p[1], +p[2] - 1, +p[3]));
  d.setUTCDate(d.getUTCDate() + (days || 0));
  return d.toISOString().slice(0, 10);
}

// ⚠ THE UID IS THE SESSION'S NUMBER, NOT ITS DATE.
//
// A calendar updates an event in place only when a later file carries the SAME
// UID. Key it by date and a session that MOVES arrives as a second event with
// the old one left sitting there — which is the one thing a reschedule notice
// must not do.
//
// The number is the position in the group's list of sessions that are actually
// happening, which is exactly what the published table prints as "Session 3" and
// what a family already calls it. The honest limit: remove a session mid-term and
// everything after it renumbers, so those events update to the following date and
// the last one is left behind with nothing to cancel it. METHOD:PUBLISH has no
// way to withdraw an event, so that is a property of the format rather than of
// this choice — a date-keyed UID has the same hole and loses the reschedule too.
function uidFor(activityId, groupId, index, domain) {
  return 'ogen-s-' + (activityId || 'act') + '-' + (groupId || 'all') +
         '-' + index + '@' + (domain || 'ogen.cy');
}

// ⚠ SEQUENCE RISES WHENEVER THE RECORD IS SAVED, which is a SUPERSET of "this
// session moved". A calendar handed an identical event with a higher sequence
// changes nothing it displays, so erring wide is free; erring narrow means a
// moved class that never reaches anybody's calendar. Minutes since the epoch:
// monotonic, an integer, and far inside what RFC 5545 allows.
function sequenceOf(activity) {
  const t = Date.parse((activity && activity.isoUpdated) || '');
  return isNaN(t) ? 0 : Math.floor(t / 60000);
}

// Every session every group of this activity meets on, on one date.
//
// Read through calendarFor(), so an EXCLUDED date is simply not here — which is
// how "skip a cancelled session" is answered without a rule of its own, and the
// same reader the published table and freezeCancellation() already use.
function sessionsOn(activity, dateISO) {
  if (!activity || !dateISO) return [];
  const out = [];
  groups.groupList(activity).forEach((g) => {
    const happening = groups.calendarFor(activity, g.groupId)
      .filter((r) => r && r.date && r.status !== 'excluded');
    const i = happening.map((r) => r.date).indexOf(dateISO);
    if (i === -1) return;
    const schedule = groups.scheduleFor(activity, g.groupId);
    const time = groups.timeFor(schedule, dateISO);
    const minutes = (groups.durationFor(activity, g.groupId) || {}).sessionMinutes;
    const start = time ? credit.resolveLocal(dateISO, time, TZ) : null;
    out.push({
      groupId: g.groupId,
      groupName: g.name || null,
      date: dateISO,
      index: i + 1,                 // what the published table calls it
      time: time || '',
      startsAt: start,
      // ⚠ NO LENGTH MEANS AN HOUR, NOT A POINT IN TIME. buildIcs falls back to
      // DTEND = DTSTART, which several clients draw as a zero-length marker or
      // refuse outright. An approximate length in a file that moves no money is
      // the cheaper error, and sessionMinutes is set on every real activity.
      endsAt: start == null ? null : start + ((minutes > 0 ? minutes : 60) * 60000),
      minutesKnown: minutes > 0
    });
  });
  return out;
}

// The event for one session, ready for buildIcs(). The WORDS are the caller's:
// a reminder is written in the language of the ACCOUNT and this module has no
// business picking one — the same rule whereFor() follows by returning the bag.
function sessionEvent(activity, session, words) {
  if (!session || session.startsAt == null) return null;
  const w = words || {};
  const ev = {
    uid: uidFor(activity && activity.activityId, session.groupId, session.index),
    sequence: sequenceOf(activity),
    start: session.startsAt,
    end: session.endsAt,
    summary: w.summary || ''
  };
  if (w.location) ev.location = w.location;
  if (w.description) ev.description = w.description;
  if (w.url) ev.url = w.url;
  return ev;
}

// The next session a family has still to come to, from an instant.
//
// ⚠ "THE NEXT ONE", NOT "SESSION 1". A family who joins a course in week four
// is not coming to week one, and an invite for a meeting that already happened
// is worse than no invite — it is the first thing in their calendar from us and
// it is wrong. Null when the course is over, when the group keeps no calendar,
// and when the hour cannot be resolved: an event with no start time is not an
// event, and the approval sends exactly as it did before.
//
// Measured from the START of the session rather than from the date, so a class
// at 19:30 is still "next" at 18:00 on the day.
function nextSessionFrom(activity, groupId, at) {
  const when = at == null ? 0 : at;
  const rows = groups.calendarFor(activity, groupId)
    .filter((r) => r && r.date && r.status !== 'excluded');
  for (let i = 0; i < rows.length; i++) {
    const got = sessionsOn(activity, rows[i].date)
      .filter((x) => x.groupId === groupId || (!groupId && true))[0];
    if (got && got.startsAt != null && got.startsAt >= when) return got;
  }
  return null;
}

module.exports = {
  TZ, RUNNING,
  isLive, remindersOn, localDate, uidFor, sequenceOf, sessionsOn, sessionEvent,
  nextSessionFrom
};
