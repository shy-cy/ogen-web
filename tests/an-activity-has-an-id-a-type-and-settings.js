// What this defends against:
//
// Three things that are cheap now and expensive later, and one that was a live
// data-loss bug.
//
// 1. THE SLUG WAS THE IDENTITY. It is the filename, the URL, the sitemap entry
//    and the record key, so renaming an activity would orphan everything
//    attached to it. That is the same failure email-as-identity causes on the
//    sister project, where it is being unpicked across five migration phases.
//    Minting an activityId while there are no registrations costs one field;
//    minting it afterwards costs a migration across every store.
//
// 2. MINTING INSIDE A PURE FUNCTION. The design says migrate() mints the id
//    "idempotently", and those two words pull against each other: a function
//    that invents a random value returns something different every call. The
//    randomness is injected instead, so migrate(record) is still pure and
//    migrate(record, {mintId}) fills one in.
//
// 3. THE CALENDAR DID NOT SURVIVE A SAVE. SHAPES.duration is applied to every
//    record on every read and every save, and it did not list sessionDates — so
//    the calendar module could generate the dates, the facts module could render
//    them, and the next save silently deleted them. Same for the frequency list,
//    which had fallen behind the calendar's: biweekly and monthly were
//    enumerable and renderable, and a save coerced both back to weekly.
//
// 4. A DROP-IN IS A FLAG, NOT A SECOND CONTENT TYPE. The two differ in how money
//    is quoted, how it is collected, and what cancelling means. They are
//    identical in every other respect the site has, so the test that matters is
//    that the shared surface does not branch.

const H = require('./_helpers');
// The closing date, and a prorated last step: the two things a mode and a date
// used to say. Written once here rather than in each assertion below.
const closes = (reg) => {
  const list = (reg.cancellationPolicy || {}).tiers || [];
  return list.length ? list[list.length - 1].until : null;
};
const prorate = (activity) => {
  const list = activity.registration.cancellationPolicy.tiers;
  list[list.length - 1].percent = 'remaining';
};
const F = require('./_fixtures');
const REG = require('../netlify/functions/_activity-registration');
const facts = require('../netlify/functions/_activity-facts');
const { migrate, SHAPES } = require('../netlify/functions/_activity-migrate');

console.log('[the id is minted once, and never by a pure function on its own]');
const bare = { slug: 'x', status: 'draft' };
H.eq(migrate(bare).activityId, undefined,
  'migrate() with no minter leaves a record without an id exactly as it found it');
H.eq(JSON.stringify(migrate(bare)), JSON.stringify(migrate(migrate(bare))),
  'so running it twice is still a no-op, which is what idempotent has to mean');

let n = 0;
const mint = () => 'act-' + String(++n);
const first = migrate(bare, { mintId: mint });
H.eq(first.activityId, 'act-1', 'given a minter it fills one in');
H.eq(migrate(first, { mintId: mint }).activityId, 'act-1',
  'and the SECOND pass finds the id the first one wrote rather than minting again');
H.eq(n, 1, 'the minter was called exactly once across both passes');

// An existing id is never regenerated, whatever arrives claiming otherwise.
H.eq(migrate({ slug: 'x', activityId: 'act-kept' }, { mintId: mint }).activityId, 'act-kept',
  'a record that already has an id keeps it');

console.log('\n[the calendar survives the shape that is applied on every save]');
// This is the bug, in the smallest form that reproduces it: run the canonical
// shape over a duration fact and see whether the dates are still there.
const withCal = SHAPES.duration({
  startDate: '2026-10-14', sessionCount: 10, sessionMinutes: 90,
  sessionDates: [
    { date: '2026-10-21', status: 'excluded', reason: 'Sukkot' },
    { date: '2026-10-14', status: 'scheduled' }
  ]
});
H.eq(withCal.sessionDates.length, 2, 'sessionDates survives normalisation');
H.eq(withCal.sessionDates[0].date, '2026-10-14', 'and comes back in date order, not input order');
H.eq(withCal.sessionDates[1].status, 'excluded', 'an exclusion stays an exclusion');
H.eq(withCal.sessionDates[1].reason, 'Sukkot', 'and keeps its admin note');
H.eq(SHAPES.duration({ sessionDates: [{ date: 'not-a-date' }] }).sessionDates.length, 0,
  'a row with no usable date is dropped rather than published as an empty cell');

console.log('\n[every frequency the calendar can enumerate survives a save]');
require('../netlify/functions/_activity-sessions').FREQUENCIES.forEach((f) => {
  H.eq(SHAPES.schedule({ frequency: f }).frequency, f, f + ' is not coerced to weekly');
});
H.eq(SHAPES.schedule({ frequency: 'fortnightly-ish' }).frequency, 'weekly',
  'and something that is not a frequency still falls back rather than being published');
H.eq(SHAPES.schedule({ frequency: 'monthly', weekOfMonth: 'last' }).weekOfMonth, 'last',
  'monthly keeps which week of the month it means');
H.eq(SHAPES.schedule({ frequency: 'weekly', weekOfMonth: 3 }).weekOfMonth, undefined,
  'and a weekly activity is not given a week-of-month it has no use for');

console.log('\n[a course and a drop-in, side by side]');
F.TYPE_PAIR.forEach((kind) => {
  const a = migrate(kind.build());
  H.eq(a.type, kind.name, kind.name + ': the type survives a migration');
  H.ok(a.registration && typeof a.registration === 'object',
    kind.name + ': and carries a registration block');
});
H.eq(migrate({ slug: 'x' }).type, 'course',
  'an activity written before the field existed is a course, which is what it was');
H.eq(migrate({ slug: 'x', type: 'workshop' }).type, 'course',
  'and an unknown type falls back rather than being stored');

// The drop-in half of the pair is the one that will sit unexercised, so it is
// asserted positively rather than by absence.
const drop = migrate(F.dropin());
H.eq(drop.registration.sessionCancelHours, 24,
  'a drop-in carries its per-session cancellation window');
H.eq(migrate(F.course()).registration.sessionCancelHours, undefined,
  'a course does not, because a session is not the unit it sells');

console.log('\n[the price card asks what data it has, never what type it is]');
// The reason a flag works instead of a second content type: priceRows() is
// built out of "if there is a fee", "if there is a term price". A drop-in is
// one more conditional row, not a second builder.
const D = { sessionCount: 10, sessionMinutes: 90 };
const dropRows = facts.priceRows(F.dropin().facts.price, 'en', D);
H.eq(dropRows.map((r) => r.label).join(' | '), 'Registration fee | Cost per session',
  'a drop-in quotes the session');
H.ok(!dropRows.some((r) => r.note),
  'and carries no "(N sessions × M lessons)" qualifier, which hangs off a term price it does not have');
const courseRows = facts.priceRows(F.course().facts.price, 'en', D);
H.eq(courseRows.map((r) => r.label).join(' | '), 'Registration fee | Cost per semester',
  'a course quotes the term, unchanged');
['he', 'en', 'ru'].forEach((l) => {
  const rows = facts.priceRows(F.dropin().facts.price, l, D);
  H.eq(rows.length, 2, l + ': the drop-in card is two rows in every language');
  H.ok(rows[1].value === '12 €', l + ': and the session price is the second');
});

// Per-lesson, opted in, derives from whichever figure the activity actually has.
const perLessonDropin = facts.priceRows(
  Object.assign({}, F.dropin().facts.price, { showPerLesson: true }), 'en', D);
H.ok(perLessonDropin.some((r) => r.label === 'Cost per lesson' && r.value === '6 €'),
  'a 90-minute session at 12 EUR is two academic hours, so 6 EUR a lesson');

console.log('\n[pooled and named groups, the other pair]');
// ⚠ BOTH HALVES OF THE PAIR ARE GROUPS NOW. "Pooled" used to mean an activity
// with no groups at all and two numbers describing one; migrate() turns those
// numbers into a single group holding the product, so the pair is now one group
// against two rather than none against some. What it still tests is the thing
// that matters: the sentence and the capacity are read off the same list, so
// they cannot disagree.
const asActivity = (groupSize) => migrate({ slug: 'x', facts: { groupSize: groupSize } });
F.GROUP_PAIR.forEach((g) => {
  H.ok(facts.formatGroupSize(asActivity(g.groupSize), 'en').length > 0, g.name + ': renders a sentence');
});
H.eq(facts.formatGroupSize(asActivity(F.POOLED), 'en'), 'Up to 14 students',
  'two pooled groups of seven are ONE group of fourteen — the places did not move, ' +
  'which is the whole promise the migration makes');
// "up to 7 students", not "up to 7": a named group saying only a number reads as
// seven of something unstated.
H.eq(facts.formatGroupSize(asActivity(F.NAMED), 'en'), 'Beginners, up to 7 students\nAdvanced, up to 10 students',
  'two groups are a line each, named, because now there is a choice to describe');
H.eq(facts.formatGroupSize(asActivity(F.NAMED), 'he'), 'מתחילים, עד 7 תלמידים\nמתקדמים, עד 10 תלמידים',
  'in Hebrew');
H.eq(facts.formatGroupSize(asActivity(F.NAMED), 'ru'), 'Начинающие, до 7 учеников\nПродолжающие, до 10 учеников',
  'and in Russian, with the plural agreeing');
// A name is words and a capacity is not, which is the whole reason mergeGroups()
// splits them the way it does.
H.eq(facts.formatGroupSize(asActivity({ named: [
    { groupId: 'g', name: F.lang('מתחילים', '', ''), capacity: 7 },
    { groupId: 'h', name: F.lang('מתקדמים', '', ''), capacity: 9 }] }), 'en'),
  'מתחילים, up to 7 students\nמתקדמים, up to 9 students',
  'an untranslated group name falls back like every other sentence on this site');
H.eq(facts.formatGroupSize(asActivity({ named: [
    { groupId: 'g', name: F.lang('א', 'A', 'А') },
    { groupId: 'h', name: F.lang('ב', 'B', 'Б') }] }), 'en'), 'A\nB',
  'a group with no capacity yet is still named, because the name is what a family chooses by');

console.log('\n[capacity is derived, and uncapped is not zero]');
H.eq(facts.totalCapacity(asActivity(F.POOLED)), 14, 'the pooled product became one group holding it');
H.eq(facts.totalCapacity(asActivity(F.NAMED)), 17, 'and two named groups sum, never multiply');
H.eq(facts.totalCapacity(asActivity({})), null,
  'nothing filled in is UNCAPPED — zero would silently refuse every registration ' +
  'for an activity nobody had finished setting up');
H.eq(facts.totalCapacity(asActivity({ groups: 2 })), null, 'and half the numbers is still nothing');
H.eq(facts.totalCapacity(asActivity({ named: [{ groupId: 'g', capacity: 7 }, { groupId: 'h' }] })), null,
  'a group with no capacity makes the total unknown rather than understated');

console.log('\n[the two cutoff dates: filled when blank, never overwritten]');
const filled = REG.defaultIfBlank(F.course());
H.eq(filled.registrationFeeCutoffDate, '2026-09-30',
  '14 calendar days before a 14 Oct start');
// ⚠ THE CLOSING DATE IS THE LAST STEP OF THE REFUND SCHEDULE NOW. It was a field
// of its own beside a mode, which was already a two-step schedule that could not
// say so — and a closing date beside a table of steps would be two fields able to
// contradict each other. closes() reads it where it lives.
H.eq(closes(filled), '2026-10-28',
  'and the date of session 3, which is ceil(30% of 10) — counted in sessions, not days');
// The calendar reading would give 4 November, a week later and the fourth
// session. Sessions win because the credit formula is session-based, so a
// day-based cutoff would have the two halves of one policy disagreeing.
H.ok(closes(filled) < '2026-11-04',
  'the session basis is stricter than the calendar one, and they must not be mixed');

const already = REG.defaultIfBlank(F.course({
  registration: { registrationFeeCutoffDate: '2026-01-01',
                  cancellationPolicy: { mode: 'flat', cancellationCutoffDate: '2026-01-02' } }
}));
H.eq(already.registrationFeeCutoffDate, '2026-01-01', 'a date that is there is not overwritten');
H.eq(closes(already), '2026-01-02', 'neither is the other one');

// The three-state field. This is the reason it is one field and not a date
// beside a "disabled" boolean: two fields can contradict each other, and here
// the contradiction is not representable.
const off = REG.defaultIfBlank(F.course({
  registration: { registrationFeeCutoffDate: 'none',
                  cancellationPolicy: { mode: 'flat', cancellationCutoffDate: 'none' } }
}));
H.eq(off.registrationFeeCutoffDate, 'none',
  'switched OFF is a value, so the default does not refill it on the next save');
H.eq(closes(off), 'none', 'both of them');
H.eq(REG.normaliseRegistration({ registrationFeeCutoffDate: '' }).registrationFeeCutoffDate, null,
  'blank is null, which means never configured');
H.eq(REG.normaliseRegistration({ registrationFeeCutoffDate: '2026-02-30' }).registrationFeeCutoffDate, null,
  'and a date that does not exist is not a cutoff');

// No start date, nothing to compute from, and nothing invented.
const nothing = REG.defaultIfBlank({ type: 'course', facts: { duration: {} } });
H.eq(nothing.registrationFeeCutoffDate, null, 'no start date fills nothing');
H.eq(nothing.defaultBasis, null, 'and stamps no basis, because nothing was computed');

// A drop-in has no term to withdraw from, so there is no cancellation cutoff to
// compute. Filling one would give it a date that governs nothing.
const dropDefaults = REG.defaultIfBlank(F.dropin());
H.eq(closes(dropDefaults), null,
  'a drop-in gets no closing date — there is no term to withdraw from');
H.eq(dropDefaults.registrationFeeCutoffDate, '2026-09-22',
  'but it does get a fee cutoff, because the joining fee still applies');

console.log('\n[the basis is remembered so the form can OFFER to recompute]');
const stamped = F.course();
stamped.registration = REG.defaultIfBlank(stamped);
H.eq(stamped.registration.defaultBasis.startDate, '2026-10-14', 'the inputs are recorded');
H.eq(stamped.registration.defaultBasis.sessionCount, 10, 'both of them');
H.eq(REG.basisChanged(stamped), null, 'and nothing has moved yet');

const postponed = JSON.parse(JSON.stringify(stamped));
F.groupFacts(postponed).duration.startDate = '2026-11-14';
const moved = REG.basisChanged(postponed);
H.ok(moved && moved.was.startDate === '2026-10-14' && moved.now.startDate === '2026-11-14',
  'moving the start date is DETECTED');
H.eq(REG.defaultIfBlank(postponed).registrationFeeCutoffDate, '2026-09-30',
  'and changes nothing on its own — an activity postponed by a month keeps the ' +
  'dates it was given until a person clicks recompute');

console.log('\n[expiry: three levels, first one that answers wins]');
H.eq(REG.resolveExpiryDays({}, {}).days, REG.DEFAULT_EXPIRY_DAYS, 'the floor is in code');
// 45, not 14. The confirmation tells a family they are REGISTERED, so a place
// released inside a fortnight contradicts the message that created it. Off is
// not the alternative — capacity counts holdsASpot(), so a hold that never
// expires ties up a place forever and tells the family nothing at all.
H.eq(REG.DEFAULT_EXPIRY_DAYS, 45, 'and it is long enough that answering a queue beats it');
H.eq(REG.resolveExpiryDays({}, {}).source, 'default', 'and says where it came from');
H.eq(REG.resolveExpiryDays({}, { PENDING_EXPIRY_DAYS: '7' }).source, 'env', 'the site default is next');
H.eq(REG.resolveExpiryDays({ registration: { pendingExpiryDays: 3 } }, { PENDING_EXPIRY_DAYS: '7' }).days, 3,
  'and the activity wins over both');
H.eq(REG.normaliseRegistration({ pendingExpiryDays: 0 }).pendingExpiryDays, null,
  'zero days is refused: a request dead on arrival is far more likely a half-typed field');
H.eq(REG.normaliseRegistration({ pendingExpiryDays: -5 }).pendingExpiryDays, null, 'so is a negative');

console.log('\n[a prorated step is refused unless it can be computed]');
// Without a calendar the formula divides by a number that is not there, at the
// moment a family is cancelling. That is the worst possible time to find out.
const proratedNoCal = F.course({ facts: { duration: { startDate: '2026-10-14' } } });
prorate(proratedNoCal);
const errs = REG.validateRegistration(proratedNoCal);
H.eq(errs.length, 1, 'a prorated step with no session calendar is one error');
H.ok(/session calendar/.test(errs[0]), 'and it names what is missing');

const proratedOk = F.course();
prorate(proratedOk);
H.eq(REG.validateRegistration(proratedOk).length, 0, 'with a calendar it is fine');
H.eq(REG.validateRegistration(F.course()).length, 0,
  'and the default schedule needs nothing, which is why it is the default');

// ⚠ AND A DROP-IN'S SCHEDULE IS NOT CHECKED AT ALL, which is a deliberate change
// of answer. This used to assert that a prorated drop-in is refused — right about
// the danger ("a setting saved and never read is one somebody will believe is in
// force") and it produced a trap: the form does not draw the policy on a drop-in,
// mergeRegistration() keeps it across a type switch on purpose, so a prorated
// course switched to a drop-in could not be published and no control anywhere
// could fix it. Keeping a value across a switch and refusing to save it are
// incompatible. What makes it safe is structural: creditFor() returns at the top
// on `frozen.type === 'dropin'`, so the schedule cannot be reached rather than
// being merely unused.
const proratedDropin = F.dropin();
prorate(proratedDropin);
H.eq(REG.validateRegistration(proratedDropin).length, 0,
  'a drop-in carries the schedule unread rather than refusing to save it');
H.eq(require(H.fnPath('_credit')).creditFor(
  { payment: { paidCents: 5000 }, frozen: { type: 'dropin', price: {}, cancellation:
    proratedDropin.registration.cancellationPolicy } }, Date.now()).total, 0,
  '⚠ and what makes that safe is that creditFor() refuses a drop-in at the top');

H.done();
