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
  const ahead = datesAhead(activity, now);

  // Kept: what was spent, plus anything still on the calendar ahead. Sorted so
  // the list reads as a calendar rather than as a history of edits.
  const keep = coveredOf(bundle).filter((d) => used.indexOf(d) !== -1 || ahead.indexOf(d) !== -1);
  const next = keep.slice();
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

// A bundle is finished when every entry has been spent, or when the shortfall
// has been settled and nothing is left to spend. `closed` is not `spent`: one
// means the family used what they bought, the other means we could not offer it.
function statusAfter(bundle, shortfall) {
  if (remaining(bundle) === 0) return 'spent';
  if (shortfall > 0 && remaining(bundle) <= shortfall) return 'closed';
  return 'active';
}

module.exports = {
  DAY_MS,
  normaliseBundles, datesAhead, coverageFor, bundlesAvailable,
  remaining, covers, reconcile, statusAfter, _eur: eur
};
