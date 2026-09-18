// What this defends against:
//
// _bundle.js and _bundle-store.js were written first and WIRED TO NOTHING. The
// rules were right, tested, and unreachable: no admin could define a bundle, no
// family could buy one, booking an evening never looked for an entry, and the
// nightly pass had never heard of any of it. A pure module nothing calls is a
// design document that compiles.
//
// This suite is about the wiring, and it pins the orderings — every one of which
// is a decision about who loses when a write fails halfway:
//
//   buying      NOTHING IS WRITTEN UNTIL STRIPE SAYS IT WAS PAID. The terms and
//               the covered DATES travel in the metadata, so what a family was
//               shown when they chose is what they get — the calendar can be
//               edited in the seconds a card takes to clear.
//   booking     the attendance FIRST, the bundle SECOND. A crash between them
//               costs us a free session; the other order costs the family an
//               entry they paid for.
//   moving      the new booking, then the old one, then the bundle. A failure
//               leaves them holding two evenings on one entry, which is visible
//               and costs them nothing.
//   the sweep   the LEDGER first, the record second — the money rule, which is
//               the opposite of the email rule and wins over it.
//
// And the one that is not an ordering at all: entries are allocated ACROSS a
// whole multi-date booking in one pass. Asking the store per date re-reads a
// store that has not been written yet, so a family with one entry left booking
// four evenings would get four free ones.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');
const F = require('./_fixtures');
const B = require(H.fnPath('_bundle'));

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');

const DATES = ['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27', '2026-11-03', '2026-11-10'];
function activity() {
  const a = F.dropin();
  a.facts.price = Object.assign({}, a.facts.price, {
    perSessionPrice: 12,
    bundles: [{ bundleId: 'b5', entries: 5, pricePerEntry: 10, validityDays: 90 }]
  });
  a.facts.duration = Object.assign({}, a.facts.duration, {
    sessionDates: DATES.map((d) => ({ date: d, status: 'scheduled' }))
  });
  return a;
}

console.log('[an admin can actually define one]');
// The form half. A bundle that cannot be typed in is a bundle nobody can sell.
const adminJs = read('js/activities-admin.js');
H.ok(/function bundlesEditor\(fact\)/.test(adminJs), 'the price panel draws a bundle editor');
H.ok(/out\.bundles = syncBundles\(\);/.test(adminJs), 'and reads it back');
H.ok(/function lateDropInEditor\(fact\)/.test(adminJs), 'late pricing is typeable too');
H.ok(/out\.lateDropIn = \{/.test(adminJs), 'and read back');
// ⚠ Both are DROP-IN ONLY, so a course does not draw them — and the server must
// keep what the form did not send, or switching type to fix something else
// deletes products a family has already bought entries from.
const scoped = read('netlify/functions/_activity-registration.js');
H.ok(/lateDropIn: \['dropin'\], bundles: \['dropin'\]/.test(scoped),
  'and both survive a save from the course form');

console.log('\n[a half-filled bundle is refused on save, not dropped on read]');
// normaliseBundles() filters it out, which is right on read and silent on save:
// an admin would publish an activity offering nothing, with the form still
// showing what they typed.
H.eq(B.validateBundles({ bundles: [{ bundleId: 'x', entries: 5, pricePerEntry: 10 }] }).length, 1,
  'a missing validity window is named');
H.eq(B.validateBundles({ bundles: [{ bundleId: 'x', entries: 5, validityDays: 30 }] }).length, 1,
  'and a missing price');
H.eq(B.validateBundles({ bundles: [
  { bundleId: 'a', entries: 5, pricePerEntry: 10, validityDays: 30 },
  { bundleId: 'b', entries: 5, pricePerEntry: 8, validityDays: 30 }] }).length, 1,
  'two bundles of the same SIZE are two products a family cannot tell apart');
H.eq(B.validateBundles({ bundles: [{ bundleId: 'x', entries: 500, pricePerEntry: 1, validityDays: 30 }] })
  .filter((m) => /at most/.test(m)).length, 1,
  'and the cap is what the Stripe metadata field can hold, not a round number');
H.eq(B.validateBundles({ bundles: [
  { bundleId: 'a', entries: 5, pricePerEntry: 10, validityDays: 30 }] }).length, 0,
  'a complete one passes');
const adminFn = read('netlify/functions/activities-admin.js');
H.ok(/BUNDLE\.validateBundles/.test(adminFn), 'and validate() calls it');
H.ok(/activity\.type === 'dropin'/.test(adminFn.slice(adminFn.indexOf('function validate('))),
  'only on a drop-in — a course is not editing a list it does not draw');

console.log('\n[nothing is written until Stripe says it was paid]');
const checkout = read('netlify/functions/_checkout.js');
H.ok(/async function createBundleCheckout/.test(checkout), 'there is a bundle checkout');
H.ok(/covered_dates: coveredDates\.join\(','\)/.test(checkout),
  '⚠ the DATES travel with the payment — recomputing on the way back would hand ' +
  'a family a bundle covering dates other than the ones they chose from');
H.ok(/purchased_at:/.test(checkout), 'and the moment of purchase, which the key is built from');
const api = read('netlify/functions/account-registrations.js');
const buy = api.slice(api.indexOf("case 'buyBundle'"), api.indexOf("case 'rescheduleSession'"));
H.ok(/NOTHING IS WRITTEN/.test(buy), 'the buy action commits nothing');
H.ok(!/bundleStore\.saveBundle/.test(buy), 'and never writes a bundle record');
H.ok(/B\.bundlesAvailable\(activity, now\)/.test(buy),
  '⚠ and the offer is re-decided from the activity — the client sends an id, never a price');
H.ok(!/body\.pricePerEntry|body\.entries/.test(buy), 'no amount is ever taken from the request');

const hook = read('netlify/functions/stripe-webhook.js');
H.ok(/ogen_kind === 'bundle'/.test(hook), 'the webhook tells a bundle payment apart');
H.ok(/const existing = await bundles\.getBundle\([\s\S]{0,120}if \(existing\) return;/.test(hook),
  'and a redelivered event finds the record already there — by the time Stripe ' +
  'retries, entries may have been spent, and rewriting would hand them back');

console.log('\n[booking spends an entry, and the booking is written first]');
const book = api.slice(api.indexOf("case 'bookSession'"), api.indexOf("case 'bundles'"));
H.ok(book.indexOf('attendance.saveAttendance') < book.indexOf('commitEntries'),
  '⚠ THE ATTENDANCE FIRST, THE BUNDLE SECOND — a crash between them costs US a ' +
  'free session rather than costing the family an entry');
const bookAndPay = api.slice(api.indexOf("case 'bookAndPay'"), api.indexOf("case 'paySession'"));
H.ok(bookAndPay.indexOf('saveAttendance') < bookAndPay.indexOf('commitEntries'),
  'and the multi-date flow follows the same order');
H.ok(/function allocateEntries/.test(api), 'entries are allocated in one pass');
H.ok(/b\.usedDates = \(b\.usedDates \|\| \[\]\)\.concat\(\[date\]\)/.test(api),
  'marking each spend in memory, so covers() sees it when it decides the next date');

// The allocator, executed. This is the bug the one-pass shape exists to stop.
console.log('\n[one entry is never handed out twice in one booking]');
const oneLeft = {
  bundleId: 'b5', frozen: { entries: 5, pricePerEntry: 10 },
  coveredDates: DATES.slice(0, 5), usedDates: DATES.slice(0, 4), status: 'active'
};
const chosen = [DATES[4], DATES[5]];
const spend = {};
chosen.forEach((d) => {
  const hit = [oneLeft].filter((x) => B.covers(x, d))[0];
  if (!hit) return;
  hit.usedDates = hit.usedDates.concat([d]).sort();
  spend[d] = hit;
});
H.eq(Object.keys(spend).join(','), DATES[4],
  'a bundle with ONE entry left pays for one of two dates, not both');
H.eq(B.remaining(oneLeft), 0, 'and it is spent');
H.eq(B.covers(oneLeft, DATES[5]), false, 'with nothing left to cover the other');

console.log('\n[moving a session keeps the entry; cancelling would spend it]');
const move = api.slice(api.indexOf("case 'rescheduleSession'"), api.indexOf("case 'cancelSession'"));
H.ok(/B\.mayReschedule\(att, now\)/.test(move), 'the deadline comes from the shared function');
H.ok(/B\.rescheduleTargets\(bundle, activity, body\.fromDate, now, taken\)/.test(move),
  'and so does the list of legal targets');
H.ok(/targets\.indexOf\(body\.toDate\) === -1/.test(move),
  'a date not on that list is refused rather than trusted');
H.ok(move.indexOf('saveAttendance(moved)') < move.indexOf('saveAttendance(released)'),
  '⚠ the NEW booking is written before the old one is released — the other order ' +
  'takes the evening away and gives nothing back');
H.ok(move.indexOf('saveAttendance(released)') < move.indexOf('bundleStore.saveBundle'),
  'and the bundle last');
H.ok(/R\.capacityForDate\(activity, all, body\.toDate\)/.test(move),
  'and the room on the target evening is checked, like any other booking');

// The swap itself, executed — both branches, because treating them alike lost
// the family an entry once already.
const bundle3 = {
  bundleId: 'b3', frozen: { entries: 3 },
  coveredDates: ['2026-10-06', '2026-10-13', '2026-10-20'],
  usedDates: ['2026-10-06'], status: 'active'
};
const inside = B.afterReschedule(bundle3, '2026-10-06', '2026-10-13');
H.eq(inside.coveredDates.length, 3, 'moving INSIDE the coverage changes no dates');
H.eq(inside.usedDates.join(','), '2026-10-13', 'but the entry moves');
const outside = B.afterReschedule(bundle3, '2026-10-06', '2026-11-03');
H.eq(outside.coveredDates.join(','), '2026-10-13,2026-10-20,2026-11-03',
  'moving OUTSIDE it relocates one of the bundle\'s own slots');
H.eq(outside.coveredDates.length, 3, 'and the coverage keeps its length either way, ' +
  'so the next nightly reconcile finds nothing to refill');

console.log('\n[the nightly pass repairs a moved calendar]');
const sweep = read('netlify/functions/_registration-sweep.js');
H.ok(/async function reconcileBundles/.test(sweep), 'the sweep has a third job');
H.ok(/await run.{0,40}\n/.test(sweep) || /bundles = await reconcileBundles\(at\)/.test(sweep),
  'and run() calls it');
H.ok(/ahead === 0 && result\.shortfall > 0/.test(sweep),
  '⚠ A SHORTFALL IS CREDITED ONLY WHEN THE ACTIVITY IS OVER. An admin who excludes ' +
  'a session this week usually adds one next week, and crediting on the spot pays ' +
  'for a date the family is about to be given back');
H.ok(sweep.indexOf('ledger.append') < sweep.indexOf('bundle.shortfallCreditedCents = owed'),
  'the ledger is written before the record — the money rule, not the email one');
H.ok(/owed > already/.test(sweep), 'and a bundle already credited is not credited again');
const ledger = read('netlify/functions/_credit-ledger.js');
H.ok(/'bundle-shortfall'/.test(ledger), 'with its own reason on the closed list');
H.ok(/pricePerEntry: \(bundle\.frozen \|\| \{\}\)\.pricePerEntry/.test(sweep),
  'and the basis names the rate that was PAID, which is what it is credited at');

// The arithmetic behind that, executed.
console.log('\n[and the shortfall is the entries that left the calendar, not the ones nobody used]');
const act = activity();
const bought = {
  frozen: { entries: 3, pricePerEntry: 10 },
  coveredDates: ['2026-10-06', '2026-10-13', '2026-10-20'], usedDates: [], status: 'active'
};
// Every date passed and nobody booked. The window did its job; nothing is owed.
const afterTerm = B.reconcile(bought, act, Date.parse('2026-12-01T09:00:00Z'));
H.eq(afterTerm.shortfall, 0,
  'dates a family simply let pass are NOT a shortfall — the entry was theirs');
// Now two of them leave the calendar entirely, with nothing to replace them.
const shrunk = activity();
shrunk.facts.duration.sessionDates = [{ date: '2026-10-06', status: 'scheduled' }];
const broken = B.reconcile(bought, shrunk, Date.parse('2026-12-01T09:00:00Z'));
H.eq(broken.shortfall, 2, 'two sessions we removed and could not replace are');
H.eq(broken.shortfallCents, 2000, 'at the rate that was paid — 2 × €10, not the standard price');

console.log('\n[one view of a bundle, read by the family and by the admin]');
// Two builders would be two screens that can disagree about how many entries
// somebody has left — and the family would be reading one of them out to the
// admin reading the other.
H.ok(/B\.bundleView\(/.test(read('netlify/functions/admin-registrations.js')),
  'the roster uses the shared view');
H.ok(/B\.bundleView\(b, mine, now\)/.test(api), 'and so does the family area');
const view = B.bundleView({
  bundleId: 'b3', purchasedAt: '2026-10-01T00:00:00Z',
  frozen: { entries: 3, pricePerEntry: 10, totalCents: 3000, validUntil: 1 },
  coveredDates: ['2026-10-06', '2026-10-13', '2026-10-20'],
  usedDates: ['2026-10-06', '2026-10-13'], status: 'active'
}, {
  '2026-10-06': { status: 'attended', frozen: { priceBasis: 'bundle' } },
  '2026-10-13': { status: 'booked', frozen: { priceBasis: 'bundle', startsAt: Date.parse('2026-10-13T16:00:00Z') } }
}, Date.parse('2026-10-08T09:00:00Z'));
H.eq(view.remaining, 1, 'entries left is derived from the dates used');
H.eq(view.rows.map((r) => r.state).join(','), 'used,booked,available',
  'and every covered date says where it stands');
H.eq(view.rows[1].mayReschedule, true, 'a booking more than a day out can be moved');
H.eq(view.rows[2].mayReschedule, false, 'a date that was never booked has nothing to move');

const late = B.bundleView({
  frozen: { entries: 1 }, coveredDates: ['2026-10-13'], usedDates: ['2026-10-13'], status: 'active'
}, { '2026-10-13': { status: 'booked', frozen: { priceBasis: 'bundle',
      startsAt: Date.parse('2026-10-13T16:00:00Z') } } },
  Date.parse('2026-10-13T09:00:00Z'));
H.eq(late.rows[0].mayReschedule, false,
  'and inside twenty-four hours it cannot — the entry is spent exactly as a no-show spends it');

console.log('\n[a date the family let pass is not called "expired"]');
// The word has to keep two different events apart: the window doing its job,
// and a promise we broke. Only the second is credited back.
const ui = read('js/member-account.js');
H.ok(/gone: 'not used'/.test(ui), 'the family area says "not used"');
H.ok(/gone: 'not used'/.test(read('js/registrations-admin.js')), 'and so does the admin');

H.done();
