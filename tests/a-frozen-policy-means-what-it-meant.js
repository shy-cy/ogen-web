// What this defends against:
//
// THE REFUND SCHEDULE REPLACED THE flat/prorated MODE, AND EVERY REGISTRATION
// ALREADY TAKEN MUST GO ON MEANING EXACTLY WHAT IT MEANT.
//
// The cancellation policy used to be a MODE plus one closing date, and
// creditFor() branched on the mode: 100% before the first session, then 50% or
// remaining÷total, then nothing past the cutoff. It is a list of steps now, each
// with its own boundary and its own percentage.
//
// That pair was ALREADY a two-step schedule and could not say so, which is the
// whole reason this is a generalisation rather than a replacement — and it is why
// the migration can be exact. A frozen block written before the change keeps its
// `mode` and its `cancellationCutoffDate` for as long as that registration
// exists; tiersFrom() translates it on read, and the translation is the migration.
//
// ⚠ SO THE ASSERTION IS NOT "THE NEW CODE LOOKS RIGHT", IT IS "THE NEW CODE AND
// THE OLD CODE AGREE TO THE CENT". The old band-selection logic is written out
// again below, deliberately, as the thing being compared against: reading the new
// implementation could only ever prove the new implementation is self-consistent.
// Every shared primitive (past, share, splitPaid, the session list) is imported
// rather than copied, because those did not change and a second copy of them
// would be testing the copy.
//
// The matrix is the point. A single case would pass with the translation reversed.

const H = require('./_helpers');
const C = require(H.fnPath('_credit'));

// ---------------------------------------------------------------------------
// THE OLD ARITHMETIC, as it stood before the schedule existed. Only the band
// SELECTION is rewritten here; every primitive is the module's own.
function oldTotal(reg, now) {
  const frozen = reg.frozen || {};
  const cancellation = frozen.cancellation || {};
  const price = frozen.price || {};
  const payment = reg.payment || {};
  if (frozen.type === 'dropin') return 0;

  const split = C.splitPaid(payment.paidCents, price.registrationFee, price.feeCharged);
  const starts = C.sessionInstants(cancellation);

  // 1. the hard cutoff answered for everything, and came first
  if (C.past(cancellation.cancellationCutoffDate, now)) return 0;
  // 2. the fee on its own date
  const feeCredit = C.past(cancellation.registrationFeeCutoffDate, now) ? 0 : split.fee;
  // 3. the course: has it started, and then which mode
  let courseCredit;
  if (!C.hasStarted(starts, now)) courseCredit = split.course;
  else if (cancellation.mode === 'prorated') {
    courseCredit = C.share(split.course, C.remaining(starts, now), starts.length);
  } else courseCredit = C.share(split.course, 1, 2);
  return feeCredit + courseCredit;
}

// ---------------------------------------------------------------------------
console.log('[a 50% step and the old flat half are the same figure, at every cent]');
// FLAT IS PRORATION WITH A FIXED RATIO — share(cents, 1, 2) — and a 50% step is
// share(cents, 50, 100). One division and one rounding rule in both cases, but
// "rounded up" plus integer arithmetic is exactly where two formulas diverge by a
// cent, and a cent is what two families comparing receipts notice.
let apart = 0;
for (let cents = 0; cents <= 200000; cents++) {
  if (C.share(cents, 50, 100) !== C.share(cents, 1, 2)) apart++;
}
H.eq(apart, 0, 'no cent value between €0 and €2000 differs');
// And the bite: a 51% step is NOT the old half, so the comparison above is
// actually comparing something.
H.ok(C.share(35000, 51, 100) !== C.share(35000, 1, 2),
  'while 51% genuinely differs, so the loop above is not vacuously true');

// ---------------------------------------------------------------------------
console.log('\n[the matrix: every legacy shape, at every interesting instant]');

const SESSIONS = {
  'ten weekly': Array.from({ length: 10 }, (_, i) =>
    Date.parse('2026-10-14T13:00:00Z') + i * 7 * 86400000),
  'four': [Date.parse('2026-10-05T13:00:00Z'), Date.parse('2026-10-12T13:00:00Z'),
           Date.parse('2026-10-19T13:00:00Z'), Date.parse('2026-10-26T13:00:00Z')],
  'one': [Date.parse('2026-10-05T13:00:00Z')],
  // ⚠ AN EMPTY LIST IS IN THE MATRIX ON PURPOSE. It is what an activity nobody
  // has scheduled carries, it is what makes hasStarted() false forever, and it is
  // the case where the closing date has to win anyway — which is the one the
  // obvious "first unpassed boundary" rule got wrong.
  'none at all': []
};
const CLOSES = ['2026-11-04', '2026-09-01', 'none', null];
const FEES = ['2026-09-30', '2026-12-31', 'none', null];
const MODES = ['flat', 'prorated'];
const PAID = [0, 5000, 5001, 30000, 35000, 12345];
const MOMENTS = ['2026-08-01', '2026-09-02', '2026-10-01', '2026-10-15', '2026-11-05', '2027-06-01']
  .map((d) => Date.parse(d + 'T10:00:00Z'));

let compared = 0;
let disagreed = [];
MODES.forEach((mode) => {
  Object.keys(SESSIONS).forEach((sessionName) => {
    CLOSES.forEach((close) => {
      FEES.forEach((feeDate) => {
        PAID.forEach((paid) => {
          [true, false, undefined].forEach((feeCharged) => {
            // ⚠ A LEGACY BLOCK: a mode and a closing date, and NO `tiers` key.
            // That absence is what makes tiersFrom() translate rather than read.
            const reg = {
              payment: { paidCents: paid },
              frozen: {
                type: 'course',
                price: { registrationFee: 50, feeCharged: feeCharged },
                cancellation: {
                  mode: mode,
                  cancellationCutoffDate: close,
                  registrationFeeCutoffDate: feeDate,
                  sessionStartsAt: SESSIONS[sessionName]
                }
              }
            };
            MOMENTS.forEach((now) => {
              compared++;
              const was = oldTotal(reg, now);
              const is = C.creditFor(reg, now).total;
              if (was !== is) {
                disagreed.push([mode, sessionName, close, feeDate, paid, feeCharged,
                                new Date(now).toISOString().slice(0, 10), was, is].join(' / '));
              }
            });
          });
        });
      });
    });
  });
});
H.ok(compared > 3000, compared + ' combinations compared, which is a matrix rather than a case');
H.eq(disagreed.length, 0,
  'and the schedule credits what the mode credited, in every one of them' +
  (disagreed.length ? '\n    first three: ' + disagreed.slice(0, 3).join('\n    ') : ''));

// ⚠ AND THE BITE. If the translation were wrong in the obvious way — a 50% step
// written as something else — the matrix above would have to notice. It does.
const wrongly = { payment: { paidCents: 35000 }, frozen: { type: 'course',
  price: { registrationFee: 50, feeCharged: true },
  cancellation: { tiers: [{ until: 'start', percent: 100 }, { until: '2026-11-04', percent: 60 }],
                  registrationFeeCutoffDate: '2026-12-31',
                  sessionStartsAt: SESSIONS.four } } };
H.ok(C.creditFor(wrongly, Date.parse('2026-10-15T10:00:00Z')).total !==
     oldTotal(Object.assign({}, wrongly, { frozen: Object.assign({}, wrongly.frozen, {
       cancellation: Object.assign({}, wrongly.frozen.cancellation,
                                   { mode: 'flat', cancellationCutoffDate: '2026-11-04' }) }) }),
              Date.parse('2026-10-15T10:00:00Z')),
  'a 60% step is a different figure from the old half — so the matrix is comparing, not agreeing');

// ---------------------------------------------------------------------------
console.log('\n[the reason a screen reads is translated too, not only the figure]');
// whyLessCredit() branches on `reason`, and the client has a sentence per key. A
// figure that matched while the reason did not would leave the dialog silent
// about a deduction, which is the bug that suite is named for.
const legacy = (mode, close) => ({ payment: { paidCents: 35000 }, frozen: { type: 'course',
  price: { registrationFee: 50, feeCharged: true },
  cancellation: { mode: mode, cancellationCutoffDate: close,
                  registrationFeeCutoffDate: '2026-12-31', sessionStartsAt: SESSIONS.four } } });
const before = C.creditFor(legacy('flat', '2026-11-04'), Date.parse('2026-09-01T10:00:00Z'));
H.eq(before.reason, 'full', 'before the first session nothing is missing');
H.eq(before.band.percent, 100, 'and the step that applies credits all of it');
const after = C.creditFor(legacy('flat', '2026-11-04'), Date.parse('2026-10-15T10:00:00Z'));
H.eq(after.reason, 'tier', 'after it, a fixed step applies');
H.eq(after.band.percent, 50, 'which for a translated flat activity is 50');
H.eq(after.band.nextPercent, 0, 'and nothing comes after the closing date');
const pro = C.creditFor(legacy('prorated', '2026-11-04'), Date.parse('2026-10-15T10:00:00Z'));
H.eq(pro.reason, 'prorated', 'a prorated activity keeps its own reason, and its own sentence');
const shut = C.creditFor(legacy('flat', '2026-09-01'), Date.parse('2026-10-15T10:00:00Z'));
H.eq(shut.reason, 'cancellation-closed', 'and past the last boundary the window is closed');
H.eq(shut.closedOn, '2026-09-01', 'named by the date it closed on');

// ---------------------------------------------------------------------------
console.log('\n[⚠ a closing date BEFORE the first session still wins]');
// This is the case the obvious evaluator gets wrong, and it is a policy Ogen
// asked for: costs committed on the family's behalf, so nothing is creditable
// even before the course begins. Under "the first step whose boundary has not
// passed", the 100%-until-it-starts step applies and the whole of it comes back —
// a full refund out of a policy written to withhold one.
const earlyClose = { payment: { paidCents: 35000 }, frozen: { type: 'course',
  price: { registrationFee: 50, feeCharged: true },
  cancellation: { tiers: [{ until: 'start', percent: 100 }, { until: '2026-09-01', percent: 50 }],
                  registrationFeeCutoffDate: null, sessionStartsAt: SESSIONS.four } } };
const onTheFifth = C.creditFor(earlyClose, Date.parse('2026-09-05T10:00:00Z'));
H.eq(onTheFifth.total, 0, 'nothing is creditable, though the course has not begun');
H.eq(onTheFifth.reason, 'cancellation-closed', 'and it says the window is closed rather than inventing a step');
// And the same shape as a legacy record, which is how the old code behaved.
H.eq(oldTotal({ payment: { paidCents: 35000 }, frozen: { type: 'course',
  price: { registrationFee: 50, feeCharged: true },
  cancellation: { mode: 'flat', cancellationCutoffDate: '2026-09-01',
                  registrationFeeCutoffDate: null, sessionStartsAt: SESSIONS.four } } },
  Date.parse('2026-09-05T10:00:00Z')), 0,
  '⚠ which is exactly what the single hard cutoff always did, and the reason it came first');

// ---------------------------------------------------------------------------
console.log('\n[⚠ an empty schedule credits everything, which the obvious loop reverses]');
// Walking the steps and returning nought when none matches is the natural shape,
// and it reads a blank as "every deadline has passed" — the one place in this file
// where an unconfigured value would resolve AGAINST the family, in the one file
// where that costs them money.
const emptied = { payment: { paidCents: 35000 }, frozen: { type: 'course',
  price: { registrationFee: 50, feeCharged: true },
  cancellation: { tiers: [], registrationFeeCutoffDate: null, sessionStartsAt: SESSIONS.four } } };
const late = C.creditFor(emptied, Date.parse('2027-06-01T10:00:00Z'));
H.eq(late.total, 35000, 'a year after the course ended, the whole of what was paid still comes back');
H.eq(late.reason, 'full', 'because the one implied step credits all of it');
H.eq(C.tiersFrom({ tiers: [] }).length, 1, 'and the translation supplies that step rather than leaving none');
H.eq(C.tiersFrom({ tiers: [] })[0].percent, 100, 'crediting everything');
H.eq(C.tiersFrom({ tiers: [] })[0].until, 'none', 'and never closing');

// ---------------------------------------------------------------------------
console.log('\n[the ledger can still explain a figure it wrote a year ago]');
const basis = C.basisFor(legacy('prorated', '2026-11-04'), Date.parse('2026-10-15T10:00:00Z'));
H.eq(basis.mode, 'prorated', 'a legacy entry still records the mode it was taken under');
H.eq(basis.sessionsTotal, 4, 'with the denominator');
H.eq(basis.sessionsRemaining, 2, 'and the numerator');
H.eq(basis.cancellationCutoffDate, '2026-11-04', 'and the closing date, derived from the last step');
const modern = C.basisFor({ payment: { paidCents: 35000 }, frozen: { type: 'course',
  price: { registrationFee: 50, feeCharged: true },
  cancellation: { tiers: [{ until: 'start', percent: 100 }, { until: '2026-10-20', percent: 75 },
                          { until: '2026-11-04', percent: 40 }],
                  registrationFeeCutoffDate: null, sessionStartsAt: SESSIONS.four } } },
  Date.parse('2026-10-25T10:00:00Z'));
H.eq(modern.mode, 'schedule', 'a schedule says so rather than naming a mode it does not have');
H.eq(modern.tierIndex, 2, 'and records WHICH step was applied');
H.eq(modern.tierPercent, 40, 'and what that step credited');
H.eq(modern.tiers.length, 3, 'with the whole schedule beside it, so the figure can be re-derived');

H.done();
