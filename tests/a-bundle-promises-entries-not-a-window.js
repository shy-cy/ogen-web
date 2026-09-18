// What this defends against:
//
// A bundle is N entries to one drop-in activity, bought in advance at a fixed
// rate. Every rule in _bundle.js is one sentence applied to a different moment:
// THE PROMISE IS THE ENTRY COUNT, NOT THE WINDOW.
//
//   at purchase   a bundle the calendar cannot cover in full is NOT OFFERED.
//                 The tempting alternative is to resize it — sell a 10 as an 8
//                 because eight sessions remain — which charges for a product
//                 with a different name, or to warn, which puts the arithmetic
//                 on the person least able to check it.
//   afterwards    a session excluded after purchase is replaced by the next
//                 bookable date, EXTENDING PAST THE WINDOW if it must. The
//                 window bounds a promise; it does not break one. A family must
//                 not lose an entry because we cancelled a class.
//   at the end    when the calendar genuinely runs out, the shortfall becomes
//                 account credit AT THE RATE PAID.
//
// Two shapes are load-bearing and would both fail silently:
//
//  1. ENTRIES ARE DERIVED, never decremented — the rule capacity already
//     follows, because Blobs has no compare-and-swap and a lost decrement is
//     invisible.
//  2. `usedDates` is a LIST OF DATES, not a count. A count cannot say whether
//     the session just cancelled had already been attended, so reconcile()
//     would either strand an entry or hand one back twice.
//
// And the pricing half: late drop-in pricing is a comparison against a start
// time, in a file whose whole contract is that it never asks what time it is.
// The moment of booking is passed in, absent reads as NOT late, and a bundle
// entry is exempt however late it is booked.

const H = require('./_helpers');
const F = require('./_fixtures');
const B = require(H.fnPath('_bundle'));
const credit = require(H.fnPath('_credit'));
const { migrate } = require(H.fnPath('_activity-migrate'));

const NOW = Date.parse('2026-10-01T09:00:00Z');
const withBundles = (list, extra) => {
  const a = F.dropin();
  a.facts.price = Object.assign({}, a.facts.price, { bundles: list }, extra || {});
  return a;
};
// Ten Tuesdays, so a 10-entry bundle has something to be covered by.
const longActivity = (list, extra) => {
  const a = withBundles(list, extra);
  a.facts.duration = Object.assign({}, a.facts.duration, {
    sessionDates: ['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27', '2026-11-03',
                   '2026-11-10', '2026-11-17', '2026-11-24', '2026-12-01', '2026-12-08']
      .map((d) => ({ date: d, status: 'scheduled' }))
  });
  return a;
};
const B3 = { bundleId: 'b3', entries: 3, pricePerEntry: 9, validityDays: 60 };
// Ninety days, deliberately: at sixty the tenth session (8 December) falls
// outside the window and the bundle is correctly not offered — which is the
// rule working, and made a confusing fixture.
const B10 = { bundleId: 'b10', entries: 10, pricePerEntry: 8, validityDays: 90 };

console.log('[a bundle the calendar cannot cover is not offered at all]');
const short = withBundles([B3, B10]);            // three sessions only
H.eq(B.bundlesAvailable(short, NOW).map((b) => b.bundleId).join(','), 'b3',
  'the 3 is offered and the 10 is ABSENT — never resized, never sold with a warning');
const long = longActivity([B3, B10]);
H.eq(B.bundlesAvailable(long, NOW).map((b) => b.bundleId).join(','), 'b3,b10',
  'with ten sessions ahead, both are offered');
H.eq(B.bundlesAvailable(F.course({ facts: long.facts }), NOW).length, 0,
  'and a COURSE offers none — a term is already bought whole');

console.log('\n[the window is measured from the purchase, so mid-term is ordinary]');
const midTerm = Date.parse('2026-11-05T09:00:00Z');   // five sessions left
H.eq(B.datesAhead(long, midTerm).length, 5, 'five sessions remain in November');
H.eq(B.bundlesAvailable(long, midTerm).map((b) => b.bundleId).join(','), 'b3',
  'so the 3 is still buyable and the 10 is not — nothing is special about the start of a term');
H.eq(B.coverageFor(long, B3, midTerm).join(','), '2026-11-10,2026-11-17,2026-11-24',
  'and it covers the next three, counted from the day it was bought');

console.log('\n[a session today is still ahead]');
// The morning of a class: past() is the end of the day in Nicosia, so a bundle
// bought at breakfast covers that evening.
const classMorning = Date.parse('2026-10-06T05:00:00Z');
H.ok(B.datesAhead(long, classMorning).indexOf('2026-10-06') === 0,
  'a bundle bought on the morning of a class covers that class');

console.log('\n[the validity window bounds what a purchase covers]');
const tight = Object.assign({}, B3, { validityDays: 14 });
H.eq(B.coverageFor(long, tight, NOW).join(','), '2026-10-06,2026-10-13',
  'only the sessions inside fourteen days');
H.eq(B.bundlesAvailable(longActivity([tight]), NOW).length, 0,
  'so a three-entry bundle with a fortnight to run is not offered at all');

console.log('\n[entries are derived from the dates spent, never decremented]');
const bought = {
  frozen: { entries: 3, pricePerEntry: 9, validityDays: 60 },
  coveredDates: ['2026-10-06', '2026-10-13', '2026-10-20'],
  usedDates: [], status: 'active'
};
H.eq(B.remaining(bought), 3, 'nothing spent');
H.eq(B.remaining(Object.assign({}, bought, { usedDates: ['2026-10-06'] })), 2, 'one spent');
H.eq(B.covers(bought, '2026-10-13'), true, 'a covered date can be spent');
H.eq(B.covers(Object.assign({}, bought, { usedDates: ['2026-10-13'] }), '2026-10-13'), false,
  'and not twice');
H.eq(B.covers(bought, '2026-10-27'), false, 'a date it does not cover cannot be spent');
H.eq(B.covers(Object.assign({}, bought, { status: 'closed' }), '2026-10-13'), false,
  'and a closed bundle spends nothing');

console.log('\n[⚠ a session cancelled after purchase EXTENDS the bundle]');
const pulled = B.reconcile(bought, long, NOW);
H.eq(pulled.changed, false, 'nothing to do while the calendar agrees');
// Drop the third session from the calendar.
const holed = JSON.parse(JSON.stringify(long));
holed.facts.duration.sessionDates = holed.facts.duration.sessionDates
  .map((r) => (r.date === '2026-10-20' ? { date: r.date, status: 'excluded', reason: 'holiday' } : r));
const fixed = B.reconcile(bought, holed, NOW);
H.eq(fixed.coveredDates.join(','), '2026-10-06,2026-10-13,2026-10-27',
  'the lost evening is replaced by the next one — the family still has three entries');
H.eq(fixed.shortfall, 0, 'so nothing is owed back');
H.eq(fixed.changed, true, 'and the record needs writing');

console.log('\n[it will reach PAST the validity window to keep the count]');
const nearEnd = { frozen: { entries: 3, pricePerEntry: 9, validityDays: 14 },
                  coveredDates: ['2026-10-06', '2026-10-13'], usedDates: [], status: 'active' };
const stretched = B.reconcile(nearEnd, long, NOW);
H.eq(stretched.coveredDates.join(','), '2026-10-06,2026-10-13,2026-10-20',
  'a date outside the fourteen-day window is pulled in rather than an entry being lost — ' +
  'the window bounds the promise, it does not break it');

console.log('\n[a spent date is never rewritten, whatever the calendar says now]');
const spent = { frozen: { entries: 3, pricePerEntry: 9, validityDays: 60 },
                coveredDates: ['2026-10-06', '2026-10-13', '2026-10-20'],
                usedDates: ['2026-10-06'], status: 'active' };
const later = Date.parse('2026-10-08T09:00:00Z');     // 6 Oct is now in the past
const kept = B.reconcile(spent, long, later);
H.ok(kept.coveredDates.indexOf('2026-10-06') !== -1,
  'the evening that HAPPENED stays on the list — the entry was spent and cannot be handed back');
H.eq(B.remaining(spent), 2, 'and two entries remain');

console.log('\n[when the calendar genuinely runs out, the shortfall is credited]');
const dying = { frozen: { entries: 5, pricePerEntry: 9, validityDays: 365 },
                coveredDates: ['2026-12-01', '2026-12-08'], usedDates: [], status: 'active' };
const out = B.reconcile(dying, long, Date.parse('2026-11-30T09:00:00Z'));
H.eq(out.coveredDates.length, 2, 'only two sessions are left in the whole calendar');
H.eq(out.shortfall, 3, 'so three entries cannot be honoured');
// ⚠ AT THE RATE PAID. Re-pricing the used entries at the standard rate would
// charge a family more for a shortfall that was ours.
H.eq(out.shortfallCents, 2700, 'credited at the BUNDLE rate — 3 x €9, not the €12 single price');

console.log('\n[⚠ a date that merely PASSED is not a date we cancelled]');
// The first version could not tell the two apart, and gave entries away for it.
// A covered date stops being "ahead" for two completely different reasons — we
// excluded it, or nobody booked it in time — and only the first is a promise we
// broke. Replacing the second would mean a family who let every date go by kept
// being handed new ones, and the validity window would bound nothing at all.
const lapsedOne = { frozen: { entries: 3, pricePerEntry: 9, validityDays: 60 },
                    coveredDates: ['2026-10-06', '2026-10-13', '2026-10-20'],
                    usedDates: [], status: 'active' };
const afterTheSixth = Date.parse('2026-10-08T09:00:00Z');
const lapsed = B.reconcile(lapsedOne, long, afterTheSixth);
H.eq(lapsed.coveredDates.join(','), '2026-10-06,2026-10-13,2026-10-20',
  'an evening nobody booked stays in the coverage, unusable — that is the window working');
H.eq(lapsed.changed, false, 'and nothing is rewritten');
H.eq(lapsed.shortfall, 0, 'nothing is owed: we did not break this promise');

const pulledOut = JSON.parse(JSON.stringify(long));
pulledOut.facts.duration.sessionDates = pulledOut.facts.duration.sessionDates
  .map((r) => (r.date === '2026-10-20' ? { date: r.date, status: 'excluded', reason: 'holiday' } : r));
const replaced = B.reconcile(lapsedOne, pulledOut, afterTheSixth);
H.ok(replaced.coveredDates.indexOf('2026-10-20') === -1, 'a date we EXCLUDED leaves the coverage');
H.ok(replaced.coveredDates.indexOf('2026-10-27') !== -1, 'and is replaced by the next one ahead');
H.ok(replaced.coveredDates.indexOf('2026-10-06') !== -1,
  'while the one that merely passed is left alone in the same pass');

console.log('\n[reconcile is idempotent, which is what lets it run every night]');
const first = B.reconcile(bought, holed, NOW);
const second = B.reconcile(Object.assign({}, bought, { coveredDates: first.coveredDates }), holed, NOW);
H.eq(second.coveredDates.join(','), first.coveredDates.join(','), 'the second pass finds the same answer');
H.eq(second.changed, false, 'and says there is nothing to write');

console.log('\n[a half-filled bundle is not a product]');
H.eq(B.normaliseBundles({ bundles: [{ bundleId: 'x', entries: 5 }] }).length, 0,
  'a bundle missing its price or its window is dropped rather than published with a default');
H.eq(B.normaliseBundles({ bundles: [B3] }).length, 1, 'a complete one stands');
H.eq(B.normaliseBundles({}).length, 0, 'and no bundles at all is the ordinary case');

// ---------------------------------------------------------------- pricing
console.log('\n[late pricing: passed the moment, never asking for it]');
const late = withBundles([], { lateDropIn: { enabled: true, hoursBefore: 1, price: 15 } });
const plain = credit.freezeSession(late, '2026-10-13');
H.eq(plain.priceBasis, 'standard',
  'with no booking moment it is NOT late — reading a blank as late charges more in the one case nobody can check');
H.eq(plain.perSessionPrice, 12, 'so the standard price stands');
const early = credit.freezeSession(late, '2026-10-13', null, { bookedAt: plain.startsAt - 3 * 3600e3 });
H.eq(early.priceBasis, 'standard', 'three hours before is not late');
const inside = credit.freezeSession(late, '2026-10-13', null, { bookedAt: plain.startsAt - 30 * 60e3 });
H.eq(inside.priceBasis, 'late', 'half an hour before is');
H.eq(inside.perSessionPrice, 15, 'and costs the late price');
const onTheDot = credit.freezeSession(late, '2026-10-13', null, { bookedAt: plain.startsAt - 3600e3 });
H.eq(onTheDot.priceBasis, 'late', 'exactly on the cutoff is late — "at or after", as specified');

console.log('\n[and a bundle entry is exempt, however late]');
const byBundle = credit.freezeSession(late, '2026-10-13', null,
  { bookedAt: plain.startsAt - 60e3, bundle: true, bundleId: 'b3' });
H.eq(byBundle.priceBasis, 'bundle', 'the basis says why');
H.eq(byBundle.perSessionPrice, 0, 'and the evening costs nothing further — it was bought in advance');
H.eq(byBundle.bundleId, 'b3', 'with the bundle it came from frozen beside it');

console.log('\n[an unconfigured rule resolves towards the family]');
const halfSet = withBundles([], { lateDropIn: { enabled: true, price: 15 } });   // no hoursBefore
H.eq(credit.freezeSession(halfSet, '2026-10-13', null, { bookedAt: Date.parse('2026-10-13T16:29:00Z') }).priceBasis,
  'standard', 'no cutoff is a rule nobody finished, not a rule that is always on');
const off = withBundles([], { lateDropIn: { enabled: false, hoursBefore: 1, price: 15 } });
H.eq(credit.freezeSession(off, '2026-10-13', null, { bookedAt: Date.parse('2026-10-13T16:29:00Z') }).priceBasis,
  'standard', 'and switched off is switched off, with the numbers kept');

console.log('\n[⚠ both fields survive the shape applied on every save]');
// The calendar was silently deleted by this exact omission once: SHAPES is run
// on every read and every save, so a key missing from it is a key the next save
// throws away.
const round = migrate(withBundles([B3], { lateDropIn: { enabled: true, hoursBefore: 2, price: 15 } }));
H.eq(round.facts.price.bundles.length, 1, 'bundles survive');
H.eq(round.facts.price.lateDropIn.hoursBefore, 2, 'and so does the late rule');
H.eq(JSON.stringify(migrate(round)), JSON.stringify(round), 'and migrate() is still idempotent');

// ------------------------------------------------------------- rescheduling
console.log('\n[rescheduling: twenty-four hours, and the entry is spent either way]');
const booked = (startsAt, over) => Object.assign(
  { status: 'booked', frozen: { priceBasis: 'bundle', startsAt: startsAt } }, over || {});
const starts = credit.freezeSession(long, '2026-10-13').startsAt;
H.eq(B.mayReschedule(booked(starts), starts - 48 * 3600e3).may, true, 'two days before, yes');
H.eq(B.mayReschedule(booked(starts), starts - 2 * 3600e3).may, false, 'two hours before, no');
H.eq(B.mayReschedule(booked(starts), starts - 2 * 3600e3).reason, 'too-late', 'and says why');
H.eq(B.mayReschedule(booked(starts), starts - 24 * 3600e3).may, false,
  'exactly on the deadline is too late — "at least 24 hours notice" means strictly more');
H.eq(B.mayReschedule(booked(starts, { status: 'attended' }), starts - 48 * 3600e3).reason,
  'not-booked', 'an evening already attended cannot be moved');
H.eq(B.mayReschedule(booked(starts, { frozen: { priceBasis: 'standard', startsAt: starts } }),
  starts - 48 * 3600e3).reason, 'not-a-bundle-entry',
  'and this is a bundle mechanism — a paid single session is cancelled, not moved');
H.eq(B.mayReschedule(booked(null), starts - 48 * 3600e3).may, true,
  'an evening with no resolvable start is misconfigured, which is not the family\'s doing');

console.log('\n[where it may be moved to]');
const held = { frozen: { entries: 3, pricePerEntry: 9, validityDays: 60,
                         validUntil: Date.parse('2026-11-30T00:00:00Z') },
               coveredDates: ['2026-10-06', '2026-10-13', '2026-10-20'],
               usedDates: ['2026-10-13'], status: 'active' };
const targets = B.rescheduleTargets(held, long, '2026-10-13', NOW, ['2026-10-13']);
H.ok(targets.indexOf('2026-10-13') === -1, 'not the evening it is already on');
H.ok(targets.indexOf('2026-10-20') !== -1, 'a date it already covers is fine');
H.ok(targets.indexOf('2026-11-24') !== -1, 'and so is one it does not, inside the window');
// ⚠ THE ONE PLACE THIS IS LESS GENEROUS THAN reconcile(). Without it, repeated
// rescheduling would extend a bundle indefinitely.
H.ok(targets.indexOf('2026-12-08') === -1,
  'but NOT past the window that was sold — a guardian\'s own change of plan does not extend a bundle');
H.ok(B.rescheduleTargets(held, long, '2026-10-13', NOW, ['2026-10-13', '2026-10-20'])
      .indexOf('2026-10-20') === -1, 'an evening already booked is not somewhere to move to');

console.log('\n[the swap: two different moves, and they are not the same]');
// Treating them alike lost the family an entry. Moving INSIDE the coverage
// changes which date is booked and nothing about which dates may be used;
// removing fromDate there would give up the right to rebook that evening.
const sameSet = B.afterReschedule(held, '2026-10-13', '2026-10-20');
H.eq(sameSet.usedDates.join(','), '2026-10-20', 'the entry moves');
H.eq(sameSet.coveredDates.join(','), '2026-10-06,2026-10-13,2026-10-20',
  'and the coverage does NOT — the family still may book the evening they left');
const outside = B.afterReschedule(held, '2026-10-13', '2026-10-27');
H.eq(outside.coveredDates.join(','), '2026-10-06,2026-10-20,2026-10-27',
  'moving outside the coverage relocates the slot');
H.eq(outside.coveredDates.length, 3, 'and both branches keep the length');
H.eq(sameSet.coveredDates.length, 3, 'so reconcile has nothing to refill afterwards');
H.eq(B.reconcile(Object.assign({}, held, sameSet), long, NOW).changed, false,
  'which is asserted rather than assumed');

console.log('\n[rescheduling more than once is allowed]');
let chain = Object.assign({}, held, B.afterReschedule(held, '2026-10-13', '2026-10-27'));
chain = Object.assign({}, chain, B.afterReschedule(chain, '2026-10-27', '2026-11-03'));
H.eq(chain.usedDates.join(','), '2026-11-03', 'the entry follows the family');
H.eq(chain.coveredDates.length, 3, 'and the bundle is still three dates');
H.eq(B.remaining(chain), 2, 'still one entry spent, not three');

H.done();
