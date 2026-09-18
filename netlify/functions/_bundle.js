// Bundles: N entries to one drop-in activity, bought in advance at a fixed rate.
//
// PURE. Activities and bundles in, answers out, `now` passed in — no store, no
// clock, no GitHub — so it is testable with no fixtures and the same inputs give
// the same answer a year later. It names nobody and opens nothing, so it does
// not arm the legal gate; the store that holds a purchase does, and is its own
// file.
//
// THE PROMISE IS THE ENTRY COUNT, NOT THE WINDOW, and every rule below is that
// sentence applied to a different situation:
//
//   at purchase   a bundle whose entries cannot all be covered by the calendar
//                 ahead is NOT OFFERED. Never silently resized — a bundle that
//                 quietly becomes an 8 when it was priced as a 10 is a different
//                 product at the same price.
//   afterwards    a session excluded after purchase is replaced by the next
//                 bookable date, EXTENDING PAST THE VALIDITY WINDOW if it must.
//                 The window exists to bound a promise, not to break it.
//   at the end    when the calendar genuinely runs out, the shortfall becomes
//                 account credit at the rate that was paid.
//
// ⚠ ENTRIES ARE DERIVED, NEVER DECREMENTED — `entries - usedDates.length`. The
// same rule capacity follows, for the same reason: Blobs has no compare-and-swap
// and a lost decrement is invisible, where a used date that failed to record is
// a place still on offer and a question somebody asks.
//
// ⚠ AND `usedDates` IS A LIST OF DATES, NOT A COUNT, which is what makes
// reconcile() safe. A count cannot say whether the session that was just
// cancelled had already been attended, so a count would either strand an entry
// or hand one back twice.

const sessions = require('./_activity-sessions');
const credit = require('./_credit');

const DAY_MS = 24 * 60 * 60 * 1000;

const eur = (v) => (v == null || v === '' ? 0 : Math.max(0, Math.round(Number(v) * 100)) || 0);
const num = (v) => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

// What the activity offers. A bundle needs all three of its numbers to mean
// anything, so one missing is a half-filled form rather than a product, and it
// is dropped rather than published with a default nobody chose.
function normaliseBundles(price) {
  const list = Array.isArray((price || {}).bundles) ? price.bundles : [];
  return list.map((b) => ({
    bundleId: String((b || {}).bundleId || '').trim(),
    entries: num((b || {}).entries),
    pricePerEntry: num((b || {}).pricePerEntry),
    validityDays: num((b || {}).validityDays)
  })).filter((b) =>
    b.bundleId && b.entries > 0 && b.pricePerEntry != null && b.pricePerEntry >= 0 &&
    b.validityDays > 0);
}

// ⚠ REFUSED ON SAVE, not dropped on read.
//
// normaliseBundles() filters an incomplete bundle out, which is the right
// behaviour at read time and the wrong one at save time: an admin who fills in
// two of three boxes would publish an activity offering nothing, with the form
// still showing what they typed and no explanation anywhere. So the same three
// requirements are checked where a person is standing at a screen.
//
// The cap on entries is not arbitrary. A purchase carries its covered dates in
// Stripe metadata, which allows 500 characters per value at 11 per date, so the
// limit is what that field can actually hold — and thirty sessions is already
// more than any term this site runs.
const MAX_ENTRIES = 30;

function validateBundles(price) {
  const list = Array.isArray((price || {}).bundles) ? price.bundles : [];
  const out = [];
  const seen = {};
  list.forEach((b, i) => {
    const where = 'Bundle ' + (i + 1) + ': ';
    const entries = num((b || {}).entries);
    const per = num((b || {}).pricePerEntry);
    const days = num((b || {}).validityDays);
    if (!(entries > 0)) out.push(where + 'how many entries it holds is required.');
    else if (entries > MAX_ENTRIES) out.push(where + 'at most ' + MAX_ENTRIES + ' entries.');
    if (per == null || per < 0) out.push(where + 'a price per entry is required.');
    if (!(days > 0)) out.push(where + 'a validity window in days is required.');
    // Two bundles of the same size are two products a family cannot tell apart,
    // and a purchase points at a bundleId — so the SIZE has to be unique even
    // though the id already is.
    if (entries > 0) {
      if (seen[entries]) out.push(where + 'there is already a bundle of ' + entries + ' entries.');
      seen[entries] = true;
    }
  });
  return out;
}

// Every date this activity still meets on, from `now` forward, in order.
//
// `past()` rather than a comparison of strings, so "still ahead" means the end
// of that day in Asia/Nicosia: a session TODAY has not gone, and a bundle bought
// on the morning of a class covers that class. The whole-site answer to when a
// day ends, rather than a second one here.
function datesAhead(activity, now) {
  const duration = ((activity || {}).facts || {}).duration || {};
  return sessions.scheduled(duration.sessionDates)
    .map((r) => r.date)
    .filter((d) => !credit.past(d, now))
    .sort();
}

// The dates a purchase made at `now` would cover: the next `entries` sessions
// that fall inside the validity window.
//
// The window is measured from the moment of purchase, so a bundle bought
// MID-TERM counts forward from that day — there is nothing special about the
// start of a term here, and an activity somebody joins in week five offers the
// same product it offered in week one.
function coverageFor(activity, bundle, now) {
  const deadline = now + bundle.validityDays * DAY_MS;
  return datesAhead(activity, now)
    // Start of the day, not the end: a session falling on the last day of the
    // window is inside it. Every blank and every boundary in this system
    // resolves towards the family.
    .filter((d) => credit.resolveLocal(d, '00:00', credit.TZ) <= deadline)
    .slice(0, bundle.entries);
}

// ⚠ OFFERED ONLY WHEN IT CAN BE HONOURED IN FULL.
//
// A bundle the calendar cannot cover is not sold at a smaller size and is not
// sold with a warning: it is absent. Auto-resizing at the point of sale would
// mean a family choosing "10 entries" and being charged for a product with a
// different name, and a warning puts the arithmetic on the person least able to
// check it.
//
// This is the PURCHASE-time rule, and it is deliberately stricter than the
// after-purchase one: before money changes hands the honest answer is "not
// this one"; afterwards the promise has been made and is kept by extending.
function bundlesAvailable(activity, now) {
  if (((activity || {}).type) !== 'dropin') return [];
  const price = ((activity.facts) || {}).price || {};
  return normaliseBundles(price)
    .filter((b) => coverageFor(activity, b, now).length >= b.entries);
}

const usedOf = (bundle) => (Array.isArray((bundle || {}).usedDates) ? bundle.usedDates : []);
const coveredOf = (bundle) => (Array.isArray((bundle || {}).coveredDates) ? bundle.coveredDates : []);

// Entries left, derived. Never a stored counter.
function remaining(bundle) {
  const entries = ((bundle || {}).frozen || {}).entries || 0;
  return Math.max(0, entries - usedOf(bundle).length);
}

// Whether an entry may be spent on this date: it has to be one of the dates the
// bundle covers, and not one already spent.
function covers(bundle, sessionDate) {
  if (!bundle || bundle.status === 'closed') return false;
  if (coveredOf(bundle).indexOf(sessionDate) === -1) return false;
  if (usedOf(bundle).indexOf(sessionDate) !== -1) return false;
  return remaining(bundle) > 0;
}

// ⚠ THE CALENDAR MOVED. Rebuild the coverage, keeping every promise that can
// still be kept.
//
// Dates already USED are kept whatever the calendar now says — the session
// happened, the entry was spent, and rewriting history to match a later edit
// would hand back an entry somebody has already had the benefit of.
//
// The rest are refilled from the dates still ahead, and this is the one place
// the validity window is allowed to be exceeded: the family was promised a
// number of entries, and a session cancelled by us must not cost them one. A
// date is pulled in even when it falls outside the original window.
//
// Idempotent, which is what lets the nightly pass run it on every bundle every
// night without a flag saying whether it has already looked.
function reconcile(bundle, activity, now) {
  const used = usedOf(bundle);
  const entries = ((bundle || {}).frozen || {}).entries || 0;
  const duration = ((activity || {}).facts || {}).duration || {};
  // ⚠ STILL ON THE CALENDAR, past or future — NOT "still ahead".
  //
  // This is the distinction the first version got wrong, and getting it wrong
  // gave entries away. A covered date stops being ahead for two completely
  // different reasons: WE EXCLUDED IT, or IT SIMPLY PASSED AND NOBODY BOOKED
  // IT. Only the first is a promise we broke. Replacing the second would mean a
  // family who let every date go by kept being handed new ones, and the validity
  // window would bound nothing at all.
  //
  // So a date that passed unused stays in the coverage, unusable, which is the
  // window doing its job; a date that left the calendar is replaced.
  const onCalendar = sessions.scheduled(duration.sessionDates).map((r) => r.date);
  const ahead = datesAhead(activity, now);

  const keep = coveredOf(bundle).filter((d) => used.indexOf(d) !== -1 || onCalendar.indexOf(d) !== -1);
  const next = keep.slice();
  // A replacement can only be a date still to come: nobody can be given an
  // evening that has already happened.
  for (const d of ahead) {
    if (next.length >= entries) break;
    if (next.indexOf(d) === -1) next.push(d);
  }
  next.sort();

  const shortfall = Math.max(0, entries - next.length);
  const before = coveredOf(bundle);
  return {
    coveredDates: next,
    shortfall: shortfall,
    // What the ledger would owe, at the rate that was PAID. A family who bought
    // ten at the bundle rate and could use six is credited four at that rate:
    // re-pricing the six they used at the standard rate would be charging them
    // more for a shortfall that was ours.
    shortfallCents: shortfall * eur(((bundle || {}).frozen || {}).pricePerEntry),
    changed: before.length !== next.length || before.some((d, i) => d !== next[i])
  };
}

// ---------------------------------------------------------------- rescheduling
//
// A guardian moving one booked evening to another date, with no admin in the
// loop. Twenty-four hours' notice, and inside that window there is no
// rescheduling at all — the entry is spent exactly as a no-show spends it.
//
// ⚠ THIS IS NOT reconcile() WITH A DIFFERENT TRIGGER, and the difference is the
// whole reason it is a separate function. reconcile() repairs a promise WE
// broke: it picks the replacement itself, it can never cost an entry, it has no
// deadline, and it runs every night. This costs an entry when it is refused, the
// guardian picks the date, and it happens once. Folding them together would give
// the repair function the power to destroy an entry, which is the one thing it
// must never have.
//
// They do not collide: a swap keeps coveredDates the same LENGTH in both of its
// branches, so the next nightly reconcile has nothing to refill and will not
// drag the abandoned date back in.
//
// A fixed twenty-four hours rather than a per-activity field, deliberately.
// `sessionCancelHours` uses null to mean NO deadline — creditable until it
// starts — so a reschedule field would have to read null as 24, and two nulls
// meaning opposite things in one block is a trap this codebase keeps finding.
const RESCHEDULE_HOURS = 24;

// Where a guardian may move an entry to.
//
// ⚠ BOUNDED BY THE WINDOW THAT WAS SOLD, which is the one place this is
// deliberately less generous than reconcile(). reconcile() reaches past the
// window because the system failed; a guardian's own change of plan does not,
// or repeated rescheduling would extend a bundle indefinitely. The bound is the
// later of the frozen deadline and the furthest date the bundle already covers,
// so a bundle reconcile() has already extended is not then narrowed by this.
function rescheduleTargets(bundle, activity, fromDate, now, takenDates) {
  const covered = coveredOf(bundle);
  const used = usedOf(bundle);
  const frozen = (bundle || {}).frozen || {};
  const furthest = covered.length
    ? Math.max.apply(null, covered.map((d) => credit.resolveLocal(d, '00:00', credit.TZ) || 0))
    : 0;
  const limit = Math.max(Number(frozen.validUntil) || 0, furthest);
  const busy = Array.isArray(takenDates) ? takenDates : [];

  return datesAhead(activity, now)
    .filter((d) => d !== fromDate)
    .filter((d) => credit.resolveLocal(d, '00:00', credit.TZ) <= limit)
    // An evening this participant is already on is not somewhere to move to,
    // and a date whose entry is already spent cannot take a second one.
    .filter((d) => busy.indexOf(d) === -1 && used.indexOf(d) === -1)
    // A date the bundle already covers but has NOT spent is a legal target: the
    // swap simply reorders which of its own dates it is holding.
    .filter((d) => covered.indexOf(d) === -1 || used.indexOf(d) === -1);
}

// May this booking be moved at all? Answered from the booking and one timestamp,
// so the button a family is shown is decided by the function the server applies.
function mayReschedule(att, now) {
  if (!att || att.status !== 'booked') return { may: false, reason: 'not-booked' };
  if (((att.frozen || {}).priceBasis) !== 'bundle') return { may: false, reason: 'not-a-bundle-entry' };
  // ⚠ `== null` FIRST, because Number(null) is 0 and 0 is finite. Checking
  // only for a finite number read a missing start time as the first instant of
  // 1970, put the deadline before that, and refused every reschedule on a
  // misconfigured evening — the exact opposite of the intended direction.
  const raw = (att.frozen || {}).startsAt;
  const startsAt = raw == null || raw === '' ? null : Number(raw);
  // No resolvable start is a misconfigured evening rather than the family's
  // doing, so it resolves towards them — the same direction every blank in
  // _credit.js takes.
  if (startsAt == null || !Number.isFinite(startsAt)) return { may: true, reason: 'no-start-time' };
  const deadline = startsAt - RESCHEDULE_HOURS * 60 * 60 * 1000;
  if (now >= deadline) return { may: false, reason: 'too-late', deadline: deadline };
  return { may: true, reason: 'in-time', deadline: deadline };
}

// The swap itself, as data. The caller writes the records; this only says what
// the bundle should look like afterwards.
//
// ⚠ TWO DIFFERENT MOVES, and treating them alike lost the family an entry.
//
// `usedDates` always moves: the entry was spent on `fromDate` and is spent on
// `toDate` instead. `coveredDates` moves ONLY when the target is outside the
// coverage — then one of the bundle's slots is genuinely being relocated.
// Moving to a date the bundle already covers changes nothing about WHICH dates
// it may be spent on, and the first version removed `fromDate` anyway: the
// family gave up their booking on that evening and silently gave up the right
// to rebook it too, so a three-entry bundle came back covering two dates.
//
// Both branches keep the coverage the same LENGTH, which is what lets
// reconcile() run afterwards and find nothing to do.
function afterReschedule(bundle, fromDate, toDate) {
  const covered = coveredOf(bundle);
  const move = (list) => {
    const out = list.filter((d) => d !== fromDate);
    if (out.indexOf(toDate) === -1) out.push(toDate);
    return out.sort();
  };
  return {
    usedDates: move(usedOf(bundle)),
    coveredDates: covered.indexOf(toDate) === -1 ? move(covered) : covered.slice()
  };
}

// ⚠ ONE VIEW OF A BUNDLE, BUILT ONCE — read by the family's own card and by the
// admin roster. Two builders would be two screens that can disagree about how
// many entries somebody has left, and the family would be reading one of them
// out to the admin reading the other.
//
// Pure: the attendance records are passed in, keyed by date.
//
// Four states, and the difference between the last two is the whole point of
// the validity window. `gone` is a date the family simply did not book — the
// entry is still theirs on paper and there is nothing left to spend it on,
// which is the window doing its job. `available` is one they still can.
function entryRows(bundle, attendanceByDate, now) {
  const used = usedOf(bundle);
  const byDate = attendanceByDate || {};
  return coveredOf(bundle).map((date) => {
    const att = byDate[date] || null;
    const spent = used.indexOf(date) !== -1;
    const gone = credit.past(date, now);
    let state;
    if (!spent) state = gone ? 'gone' : 'available';
    else if (att && att.status === 'booked' && !gone) state = 'booked';
    else state = 'used';
    // Only a booking still ahead of its deadline can move, and the answer comes
    // from the same function the server applies — so what is offered is what
    // happens.
    const may = state === 'booked' ? mayReschedule(att, now) : { may: false, reason: state };
    return {
      date: date, state: state,
      mayReschedule: may.may === true,
      reason: may.reason,
      deadline: may.deadline == null ? null : may.deadline
    };
  });
}

// What a screen shows about one bundle. `remaining` is derived here as it is
// everywhere; nothing reads a stored count.
function bundleView(bundle, attendanceByDate, now) {
  return {
    bundleId: bundle.bundleId,
    purchasedAt: bundle.purchasedAt,
    participantId: bundle.participantId,
    activityId: bundle.activityId,
    status: bundle.status,
    entries: (bundle.frozen || {}).entries || 0,
    pricePerEntry: (bundle.frozen || {}).pricePerEntry,
    totalCents: (bundle.frozen || {}).totalCents || 0,
    validUntil: (bundle.frozen || {}).validUntil || null,
    remaining: remaining(bundle),
    used: usedOf(bundle).length,
    shortfallCreditedCents: bundle.shortfallCreditedCents || 0,
    rows: entryRows(bundle, attendanceByDate, now)
  };
}

// A bundle is finished when every entry has been spent, or when the shortfall
// has been settled and nothing is left to spend. `closed` is not `spent`: one
// means the family used what they bought, the other means we could not offer it.
function statusAfter(bundle, shortfall) {
  if (remaining(bundle) === 0) return 'spent';
  if (shortfall > 0 && remaining(bundle) <= shortfall) return 'closed';
  return 'active';
}

module.exports = {
  DAY_MS, RESCHEDULE_HOURS, MAX_ENTRIES,
  normaliseBundles, validateBundles, datesAhead, coverageFor, bundlesAvailable,
  remaining, covers, reconcile, statusAfter, entryRows, bundleView,
  rescheduleTargets, mayReschedule, afterReschedule,
  _eur: eur
};
