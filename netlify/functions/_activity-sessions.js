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

// A frequency that names a repeating weekday can be enumerated. `custom` cannot:
// it is whatever the admin typed, which is why it has no generator and why
// prorated cancellation has to refuse it.
const GENERATED = ['one-time', 'weekly', 'biweekly', 'twice-weekly', 'monthly'];

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
  FREQUENCIES, GENERATED,
  enumerate, mergeExclusions, scheduled, sessionCount, isGenerated,
  parseISO, toISO, isoWeekday, nthWeekdayOfMonth
};
