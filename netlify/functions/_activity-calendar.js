// Every session every live activity meets on, in one list, and which of them
// collide. PURE — no store, no GitHub, no clock. `now` is the caller's to pass,
// for the reason _credit.js states: a module that asks what time it is gives a
// different answer tomorrow for the same input, and cannot be tested without
// fixtures.
//
// ⚠ WHY THIS EXISTS. Nothing anywhere put two activities on one screen. Each
// form draws ONE activity, so a timetable that reads perfectly on its own form
// can put a class at the same hour as another class — and no screen could show
// it, which is the same shape as the two facts that printed their structured
// list and a restatement of it underneath, and as the yearly fee a series typed
// once per term. It is the PAIR that is wrong, and only a view holding both can
// see one.

const groups = require('./_activity-groups');
const listing = require('./_activity-listing');

// ⚠ A REHEARSAL OCCUPIES NO ROOM. `test` is the one listing state that is not a
// real class — its payments are pretend and nobody turns up — so it is left out
// rather than marked, or every genuine clash would be read past a wall of noise
// from test1..test12. `unlisted` IS included: it is a real class with the
// advertising switched off, and it needs a room like any other.
const REHEARSAL = 'test';

// Statuses that still occupy a room. `completed` and `cancelled` do not, and
// `draft` cannot reach here at all — a draft has no committed record, so the
// published set this is built from has never contained one.
const RUNNING = ['open', 'closed', 'waitlist', 'announcement'];

// ⚠ WHO APPEARS DEPENDS ON WHO IS LOOKING, and this is the one place that
// decides it. The admin screen and the public page are not the same question:
//
//   admin   an activity that occupies a room. `unlisted` IS one — a real class
//           with the advertising switched off — so it must be there, or a room
//           clash against it is invisible on the only screen that could show it.
//   public  an activity somebody is invited to. `unlisted` is deliberately off
//           the listing, out of the hamburger and out of sitemap.xml, so putting
//           it on a public what's-on page would undo precisely what that state
//           exists for.
//
// An audience rather than a second copy of the rule, and the public half REUSES
// `listing.isListed` — the same predicate buildDerivedFiles() already applies to
// the three shop-window pages — so a fourth listing state cannot mean one thing
// on the listing and another here.
const AUDIENCES = ['admin', 'public'];

function isLive(activity, audience) {
  if (!activity) return false;
  if (RUNNING.indexOf(String(activity.status)) === -1) return false;
  if (audience === 'public') return listing.isListed(activity);
  return listing.listingOf(activity) !== REHEARSAL;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

// Minutes past midnight, or null for anything that is not a real HH:MM. Null is
// the honest answer and every caller branches on it rather than defaulting: a
// session with no time cannot be shown to clash with anything, and guessing one
// would invent a collision or hide one.
function minutesOf(time) {
  const m = HHMM.exec(String(time || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function hhmm(mins) {
  if (mins == null) return null;
  const h = Math.floor(mins / 60) % 24;
  return String(h).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
}

// The hour one dated session starts at. LIFTED into _activity-groups.js — the
// module that requires nothing — and re-exported here unchanged, so the session
// table and this report cannot answer "when does this meeting start" differently.
// The rule and its reasoning live beside scheduleFor(), which produces its input.
const timeFor = groups.timeFor;

function pickText(bag) {
  if (bag == null) return '';
  if (typeof bag === 'string') return bag;
  if (typeof bag !== 'object') return String(bag);
  return bag;
}

// One row per group per date it actually meets on. calendarFor() is the reader,
// so an EXCLUDED date never appears — the same rule freezeCancellation() and the
// published session table already follow, and it is what keeps this list exactly
// the set of evenings somebody turns up to.
function timetable(activities, audience) {
  const out = [];
  (activities || []).filter((a) => isLive(a, audience)).forEach((activity) => {
    groups.groupList(activity).forEach((group) => {
      const gid = group.groupId;
      const schedule = groups.scheduleFor(activity, gid) || {};
      const duration = groups.durationFor(activity, gid) || {};
      const minutes = Number(duration.sessionMinutes) > 0 ? Number(duration.sessionMinutes) : null;
      const facts = group.facts || {};
      groups.calendarFor(activity, gid)
        .filter((r) => r && r.date && r.status !== 'excluded')
        .forEach((row) => {
          const time = timeFor(schedule, row.date);
          const startsAt = minutesOf(time);
          out.push({
            date: row.date,
            time: time || null,
            startsAt,
            minutes,
            endsAt: (startsAt != null && minutes != null) ? hhmm(startsAt + minutes) : null,
            slug: activity.slug,
            title: pickText(activity.title),
            type: activity.type || 'course',
            status: activity.status,
            listing: listing.listingOf(activity),
            groupId: gid,
            groupName: pickText(group.name),
            named: groups.offersAChoice(activity),
            location: pickText((facts.location || {}).text || facts.location),
          });
        });
    });
  });
  // Date, then time, then slug — a total order, so the same records always
  // render in the same sequence and a screen cannot reshuffle between loads.
  out.sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 :
    (a.startsAt == null) - (b.startsAt == null) ||
    (a.startsAt || 0) - (b.startsAt || 0) ||
    (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return out;
}

// ⚠ ONLY THE EARLIER SESSION'S DURATION IS NEEDED, and getting that wrong is
// what made the first version of this report useless. Two sessions collide when
// the later one BEGINS before the earlier one ENDS — so an unset duration on the
// later session rules nothing out and must not be reported as unknowable.
// Measured on the live records: the crude version called seven pairs "cannot
// say" when six of them provably do not overlap and the seventh provably does.
//
// `same-start` is its own verdict rather than an overlap of N minutes, because
// it is the one an admin can act on without reading a figure.
function collide(a, b) {
  if (a.startsAt == null || b.startsAt == null) return null;
  const early = a.startsAt <= b.startsAt ? a : b;
  const late = early === a ? b : a;
  if (early.startsAt === late.startsAt) return { kind: 'same-start', minutes: null };
  if (early.minutes == null) return { kind: 'unknown', minutes: null };
  const overlap = (early.startsAt + early.minutes) - late.startsAt;
  return overlap > 0 ? { kind: 'overlap', minutes: overlap } : null;
}

// Every colliding pair, once each. Two groups of ONE activity count: under the
// equal-hours rule they are separate rooms with separate teachers, so putting
// them at the same hour is exactly the mistake worth catching.
function clashes(sessions) {
  const byDate = {};
  (sessions || []).forEach((s) => { (byDate[s.date] = byDate[s.date] || []).push(s); });
  const out = [];
  Object.keys(byDate).sort().forEach((date) => {
    const list = byDate[date];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const verdict = collide(list[i], list[j]);
        if (verdict) out.push({ date, kind: verdict.kind, minutes: verdict.minutes, a: list[i], b: list[j] });
      }
    }
  });
  return out;
}

// Which dates carry a clash, so a screen can mark a day without re-deriving the
// rule. A Set would not survive JSON.
function clashedDates(list) {
  const seen = {};
  (list || []).forEach((c) => { seen[c.date] = true; });
  return Object.keys(seen).sort();
}

function report(activities, audience) {
  const sessions = timetable(activities, audience);
  const found = clashes(sessions);
  return {
    sessions,
    clashes: found,
    clashedDates: clashedDates(found),
    counts: {
      activities: (activities || []).filter((a) => isLive(a, audience)).length,
      sessions: sessions.length,
      dates: Object.keys(sessions.reduce((m, s) => (m[s.date] = 1, m), {})).length,
      clashes: found.length,
      undated: sessions.filter((s) => s.startsAt == null).length,
    },
  };
}

module.exports = {
  RUNNING, REHEARSAL, AUDIENCES,
  isLive, minutesOf, hhmm, timeFor,
  timetable, collide, clashes, clashedDates, report,
  _internal: { pickText },
};
