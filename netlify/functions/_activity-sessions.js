// The session calendar: which dates an activity actually meets on.
//
// PURE. No stores, no network, no clock. Given a schedule it enumerates dates;
// given an admin's exclusions it carries them across a regeneration. It knows
// nothing about language, because a date is not display text — _activity-facts.js
// is still the one place a fact becomes words.
//
// Why this exists at all: duration.sessionCount and the schedule already
// disagree on the one activity that exists. hebrew4kids says ten sessions,
// weekly on Wednesdays, 14 Oct to 23 Dec 2026 — and enumerating that span gives
// ELEVEN Wednesdays, the tenth falling on 16 Dec, a week before the stated end.
// Nothing reads those two fields against each other today, so the disagreement
// is invisible. Under prorated cancellation it decides how much money a family
// gets back. So the calendar becomes the source of truth and the count becomes
// derived from it: two editable numbers for one fact is what produced the
// discrepancy, and keeping both would preserve it behind a nicer interface.
//
// Dates are handled as Y-M-D triples in UTC, never as local Date objects. The
// cutoff logic in the money phase is evaluated in Asia/Nicosia, but enumerating
// a calendar is not a wall-clock question, and going through local time is how
// a DST boundary silently shifts a session by a day.

const FREQUENCIES = ['one-time', 'weekly', 'biweekly', 'twice-weekly', 'monthly', 'custom'];

// A frequency that names a repeating weekday can be enumerated by walking the
// calendar. `custom` is enumerated a different way and for a different reason:
// its rows carry the DATES THEMSELVES, so there is nothing to walk — the admin
// has already written the answer down and the generator's job is to read it.
//
// ⚠ IT USED TO BE UNENUMERABLE, and that cost more than a button. `custom` meant
// a list of weekday-and-time pairs with no dates at all, so an activity that met
// on a handful of specific dates could not have a session calendar generated,
// could not show a session table, and — because prorated cancellation divides by
// the session list — could not use prorated cancellation either. All three came
// back the moment a row could say which day it means.
//
// A custom schedule with no dates on its rows still enumerates to nothing, which
// is exactly what it did before. Nothing regresses; a capability was added.
const GENERATED = ['one-time', 'weekly', 'biweekly', 'twice-weekly', 'monthly', 'custom'];

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseISO(s) {
  const m = ISO_RE.exec(String(s || '').trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  // Rejects 2026-02-30, which Date.UTC would roll forward into March.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return t;
}

function toISO(t) {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
}

const DAY_MS = 86400000;
function addDays(t, n) { return t + n * DAY_MS; }
function weekdayOf(t) { return new Date(t).getUTCDay(); }        // 0 = Sunday
function isoWeekday(iso) { const t = parseISO(iso); return t == null ? null : weekdayOf(t); }

// First occurrence of `weekday` on or after `t`.
function onOrAfter(t, weekday) {
  const diff = (weekday - weekdayOf(t) + 7) % 7;
  return addDays(t, diff);
}

// The nth given weekday of a month, 1-based. `nth` may also be 'last', and a
// numeric nth that overflows the month CLAMPS to the last one rather than
// spilling into the next month — a month with only four Wednesdays uses the
// fourth when asked for the fifth. Silently moving to the 1st of the next month
// would put a session outside the month it was scheduled in.
function nthWeekdayOfMonth(year, month0, weekday, nth) {
  const first = Date.UTC(year, month0, 1);
  const firstHit = onOrAfter(first, weekday);
  const last = Date.UTC(year, month0 + 1, 0);
  if (nth === 'last') {
    let t = firstHit;
    while (addDays(t, 7) <= last) t = addDays(t, 7);
    return t;
  }
  const n = Number(nth);
  if (!isFinite(n) || n < 1) return null;
  let t = addDays(firstHit, (n - 1) * 7);
  if (t > last) {                       // clamp
    t = firstHit;
    while (addDays(t, 7) <= last) t = addDays(t, 7);
  }
  return t;
}

function dayNumbers(spec) {
  const list = Array.isArray(spec && spec.sessions) ? spec.sessions : [];
  return list
    .map((s) => (s && s.day != null ? Number(s.day) : null))
    .filter((d) => d != null && isFinite(d) && d >= 0 && d <= 6);
}

// Enumerate the dates an activity meets on. Bounded by endDate; `limit` caps the
// result when a record still carries an explicit count. Returns ISO strings,
// ascending, deduplicated — twice-weekly can name the same weekday twice.
function enumerate(spec) {
  spec = spec || {};
  const freq = String(spec.frequency || '').trim();
  if (GENERATED.indexOf(freq) === -1) return [];

  // ⚠ CUSTOM IS READ, NOT WALKED, and it answers before the start date is asked
  // for. Every other frequency needs a start to count from; these dates need
  // nothing, because they ARE the answer. Bounding them by a typed start or end
  // would silently drop a date an admin wrote on purpose, which is the one thing
  // a list of exact dates must never do — so `limit` is honoured (it is a cap on
  // how many to take) and the two dates are not.
  if (freq === 'custom') {
    const seen = {};
    const dates = [];
    (Array.isArray(spec.sessions) ? spec.sessions : []).forEach((sess) => {
      const t = parseISO(sess && sess.date);
      if (t == null || seen[t]) return;
      seen[t] = true;
      dates.push(t);
    });
    dates.sort((a, b) => a - b);
    const cap = Number(spec.limit);
    const take = isFinite(cap) && cap > 0 ? dates.slice(0, Math.floor(cap)) : dates;
    return take.map(toISO);
  }

  const start = parseISO(spec.startDate);
  if (start == null) return [];
  const end = parseISO(spec.endDate);
  const limit = Number(spec.limit);
  const capped = isFinite(limit) && limit > 0 ? Math.floor(limit) : null;
  const days = dayNumbers(spec);

  // A generated frequency with no weekday cannot be enumerated, except one-time,
  // which is simply the start date.
  if (freq === 'one-time') return [toISO(start)];
  if (!days.length) return [];
  if (end == null && capped == null) return [];

  const out = [];
  const guard = 1000;                       // a semester cannot need more

  if (freq === 'monthly') {
    const nth = spec.weekOfMonth == null || spec.weekOfMonth === '' ? 1 : spec.weekOfMonth;
    const startDate = new Date(start);
    let y = startDate.getUTCFullYear(), m = startDate.getUTCMonth();
    for (let i = 0; i < guard; i++) {
      days.forEach((d) => {
        const t = nthWeekdayOfMonth(y, m, d, nth);
        if (t != null && t >= start && (end == null || t <= end)) out.push(t);
      });
      if (out.length && capped != null && out.length >= capped) break;
      m += 1; if (m > 11) { m = 0; y += 1; }
      if (end != null && Date.UTC(y, m, 1) > end) break;
      if (end == null && capped == null) break;
    }
  } else {
    const step = freq === 'biweekly' ? 14 : 7;
    days.forEach((d) => {
      let t = onOrAfter(start, d);
      for (let i = 0; i < guard; i++) {
        if (end != null && t > end) break;
        out.push(t);
        if (end == null && capped != null && out.length >= capped * days.length) break;
        t = addDays(t, step);
      }
    });
  }

  const seen = Object.create(null);
  const sorted = out.sort((a, b) => a - b).filter((t) => {
    if (seen[t]) return false;
    seen[t] = true;
    return true;
  }).map(toISO);
  return capped != null ? sorted.slice(0, capped) : sorted;
}

// ⚠ THE CALENDAR A CUSTOM SCHEDULE ALREADY IMPLIES, filled in at save time.
//
// Generation was a button and only a button, so an activity could be saved and
// published with its dates in `schedule.sessions[]` and `duration.sessionDates`
// never generated from them. All three custom activities on the live site were
// in exactly that state: the pages rendered no session table, `sessionCount()`
// derived nothing, the "(N sessions × M lessons)" qualifier was absent, and a
// prorated refund would have divided by an empty list. Nothing errored, because
// each half was behaving as written — the button works, and nothing ever said it
// was compulsory.
//
// ⚠ IT READS, IT NEVER GUESSES. `enumerate()` on a custom schedule takes the
// dates that are written down and nothing else — no start date, no end date, no
// weekday walked forward — so this cannot invent a meeting. A custom row with a
// weekday and no date yields nothing, and that is the honest answer rather than
// a calendar built from a pattern nobody typed: `beit-midrash` holds
// `{day: 0, time: '18:00'}` and no dates at all, and gets no calendar from this.
// It says so instead, because an admin who saves and sees no table needs to know
// which of the two states they are in.
//
// ⚠ AND IT NEVER OVERWRITES. Any existing calendar — including one whose every
// date an admin has excluded — means this has nothing to do. So the button keeps
// its whole job: regenerating after a schedule change, clearing, and editing by
// hand all still go through it, and this only ever fills a blank.
//
// It is built from the SAME spec the button builds, `limit` included, so pressing
// Generate straight after a save cannot produce a different calendar from the one
// the save produced. Two mechanisms answering one question have to agree, and the
// only way to be sure is to ask once.
function autoFill(facts) {
  const sched = (facts && facts.schedule) || {};
  const duration = (facts && facts.duration) || {};
  if (String(sched.frequency || '') !== 'custom') return null;
  const rows = Array.isArray(sched.sessions) ? sched.sessions : [];
  if (!rows.length) return null;
  const have = Array.isArray(duration.sessionDates) ? duration.sessionDates : [];
  if (have.length) return null;

  const dates = enumerate({
    frequency: 'custom',
    sessions: rows,
    weekOfMonth: sched.weekOfMonth,
    startDate: duration.startDate,
    endDate: duration.endDate,
    limit: duration.sessionCount
  });
  // Rows, but not one of them carrying a date. There is nothing here to build a
  // calendar out of, and saying so is the only useful answer.
  if (!dates.length) return { undated: true };
  // `previous` is empty by definition — this only runs on a blank calendar — but
  // it goes through the same merge so there is one way a calendar is shaped.
  return { sessionDates: mergeExclusions(dates, have) };
}

// ⚠ DATES THAT FALL OUTSIDE THE ACTIVITY'S OWN TERM.
//
// `enumerate()` deliberately does not bound a custom schedule by the start and
// end dates, because filtering would drop a date somebody typed on purpose —
// that rule stands and is not being weakened here. What was missing is anybody
// SAYING SO. A typed date is a typed date, and a typo in one is invisible until
// a calendar exists to print it: `intro-into-judaism` holds `2021-05-05` in the
// middle of a run of 2027 dates, and an end date of `0027-02-21`, and neither
// could be seen because that activity had no calendar at all.
//
// So it is reported and never corrected. Both halves matter: a stray date may be
// a real extra meeting before the term formally opens, and the two figures it is
// compared against may themselves be the thing that is wrong.
function strayDates(sessionDates, duration) {
  const d = duration || {};
  const start = parseISO(d.startDate);
  const end = parseISO(d.endDate);
  if (start == null && end == null) return [];
  return scheduled(sessionDates).map((r) => r.date).filter((iso) => {
    const t = parseISO(iso);
    if (t == null) return false;
    return (start != null && t < start) || (end != null && t > end);
  });
}

// Regenerating the calendar after a schedule change must not quietly un-exclude
// a holiday the admin already removed. Exclusions are matched by date, so a date
// that survives the change keeps its status and one that no longer occurs simply
// disappears with it.
function mergeExclusions(dates, previous) {
  const was = Object.create(null);
  (Array.isArray(previous) ? previous : []).forEach((row) => {
    const d = row && (typeof row === 'string' ? row : row.date);
    // The REASON travels with the status, not just the fact of exclusion. An
    // admin writes "Hanukkah" once, and it has to be there for whoever asks
    // next year why there was no class that week — including after a
    // regeneration, which is exactly when it would be easiest to lose.
    if (d && row && row.status === 'excluded') was[d] = String(row.reason || '');
  });
  return (Array.isArray(dates) ? dates : []).map((d) => {
    if (was[d] === undefined) return { date: d, status: 'scheduled' };
    const row = { date: d, status: 'excluded' };
    if (was[d]) row.reason = was[d];
    return row;
  });
}

// Only these reach the published table, the derived count, and the money. One
// filter, applied once, so nothing downstream has to know exclusions exist.
function scheduled(sessionDates) {
  return (Array.isArray(sessionDates) ? sessionDates : [])
    .filter((r) => r && r.date && r.status !== 'excluded');
}

// The count is DERIVED. It is not a field, so it cannot drift from the calendar.
function sessionCount(sessionDates) { return scheduled(sessionDates).length; }

function isGenerated(freq) { return GENERATED.indexOf(String(freq || '')) !== -1; }

module.exports = {
  autoFill, strayDates,
  FREQUENCIES, GENERATED,
  enumerate, mergeExclusions, scheduled, sessionCount, isGenerated,
  parseISO, toISO, isoWeekday, nthWeekdayOfMonth
};
