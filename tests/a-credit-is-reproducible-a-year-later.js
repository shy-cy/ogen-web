// What this defends against:
//
// A family that paid 350 and was credited 150 will ask why, possibly months
// later, and "the system calculated it" is not an answer. Everything in
// _credit.js is arranged so that the answer survives: the policy is FROZEN onto
// the registration at submission, so creditFor() reads one record and one
// timestamp and can reach nothing that might have changed since.
//
// That makes the function reproducible, which is the property this suite exists
// to pin. An admin who switches an activity from flat to prorated in March, or
// moves a cutoff date, must not change what a family who registered in January
// is owed — and the way that would break is not dramatic. It is somebody, later,
// "simplifying" creditFor() by reading the activity instead of the frozen block,
// because the activity is right there and the numbers usually match.
//
// The rest is the ways a money calculation is quietly wrong:
//
//   - reading a blank date as a restriction rather than as a blank, which means
//     keeping a family's money on the strength of an empty field;
//   - comparing a cutoff against midnight, which costs them the last day;
//   - comparing it in UTC, which moves the deadline by the hours Cyprus runs
//     ahead of it, so 01:00 local on the final day is refused as late;
//   - rounding a division against them;
//   - two formulas for flat and prorated that round differently, so two
//     families comparing receipts find a discrepancy nobody can explain.
//
// The worked table at the bottom is from the design, computed against the
// activity that actually exists. It is the part a non-developer can check.

const H = require('./_helpers');
const C = require('../netlify/functions/_credit');

// Cyprus is UTC+2 in winter and UTC+3 in summer, and both appear below.
const at = (iso) => Date.parse(iso);

// hebrew4kids, as it stands: 50 fee, 300 course, ten weekly Wednesdays from
// 14 Oct 2026 at 16:00 local. A family that has paid all 350.
const SESSIONS = [
  '2026-10-14', '2026-10-21', '2026-10-28', '2026-11-04', '2026-11-11',
  '2026-11-18', '2026-11-25', '2026-12-02', '2026-12-09', '2026-12-16'
].map((d) => C.resolveLocal(d, '16:00'));

function reg(over) {
  const o = over || {};
  return {
    payment: { paidCents: o.paidCents == null ? 35000 : o.paidCents },
    frozen: {
      price: { registrationFee: 50, fullPrice: 300 },
      cancellation: Object.assign({
        mode: 'flat',
        registrationFeeCutoffDate: '2026-10-01',
        cancellationCutoffDate: '2026-12-23',
        sessionStartsAt: SESSIONS
      }, o.cancellation || {})
    }
  };
}

console.log('[the worked example from the design, row by row]');
// Every figure here was written down before the code was, which is what makes
// it a check rather than a restatement of whatever the function happens to do.
const ROWS = [
  { on: '2026-09-20T12:00:00Z', label: 'before both cutoffs',
    fee: 5000, flat: 30000, prorated: 30000 },
  { on: '2026-10-05T12:00:00Z', label: 'fee cutoff passed, course not started',
    fee: 0, flat: 30000, prorated: 30000 },
  { on: '2026-11-25T12:00:00Z', label: '6 of 10 sessions held',
    fee: 0, flat: 15000, prorated: 12000 }
];
ROWS.forEach((row) => {
  const flat = C.creditFor(reg(), at(row.on));
  const pro = C.creditFor(reg({ cancellation: { mode: 'prorated' } }), at(row.on));
  H.eq(flat.feeCredit, row.fee, row.label + ': fee ' + row.fee / 100 + ' EUR');
  H.eq(flat.courseCredit, row.flat, row.label + ': course, flat, ' + row.flat / 100 + ' EUR');
  H.eq(pro.courseCredit, row.prorated, row.label + ': course, prorated, ' + row.prorated / 100 + ' EUR');
  H.eq(flat.total, row.fee + row.flat, row.label + ': total, flat');
  H.eq(pro.total, row.fee + row.prorated, row.label + ': total, prorated');
  H.ok(flat.guardianMayCancel, row.label + ': and the guardian may still cancel');
});
// Row three is the only place the two modes differ, and by 30 EUR. Worth
// asserting as the difference rather than as two numbers that happen to differ.
H.eq(C.creditFor(reg(), at('2026-11-25T12:00:00Z')).courseCredit -
     C.creditFor(reg({ cancellation: { mode: 'prorated' } }), at('2026-11-25T12:00:00Z')).courseCredit,
  3000, 'flat and prorated part company by exactly 30 EUR on 25 November, and nowhere else');

console.log('\n[after the hard cutoff: nothing, and the guardian is refused]');
const shut = C.creditFor(reg(), at('2027-01-10T12:00:00Z'));
H.eq(shut.total, 0, 'nothing is creditable');
H.eq(shut.feeCredit, 0, 'not the fee');
H.eq(shut.courseCredit, 0, 'not the course');
H.eq(shut.guardianMayCancel, false, 'and the guardian cannot cancel at all');
H.eq(shut.reason, 'cancellation-closed', 'the refusal names itself');
H.eq(shut.closedOn, '2026-12-23', 'and carries the date, so the 409 can say which one');
// The cutoff governs ENTITLEMENT, not the ability to end a registration. An
// admin cancelling in week nine for a safety reason still goes through and
// credits nothing — a policy about money must not be what prevents it.
H.ok(!('adminMayCancel' in shut),
  'the function says nothing about admin cancellation, because it never governs it');

console.log('\n[a blank date is a blank, never a restriction]');
// All three dates default to null and every null resolves the way that favours
// the family. That is one line, past(), not three branches — so a fourth date
// added later cannot get the default wrong.
const unset = C.creditFor(reg({
  cancellation: { registrationFeeCutoffDate: null, cancellationCutoffDate: null }
}), at('2030-01-01T12:00:00Z'));
H.eq(unset.feeCredit, 5000, 'no fee cutoff means the fee is always creditable');
H.ok(unset.guardianMayCancel, 'no cancellation cutoff means cancellation never closes');
H.eq(C.past(null, at('2030-01-01T12:00:00Z')), false, 'past(null) is false, whatever the date');
// The reading that would have been wrong, stated as its own assertion because
// it is the one somebody would "fix" towards.
H.ok(unset.total > 0,
  'a missing date is an activity nobody finished configuring — reading it as ' +
  '"the cutoff has passed" would keep a family\'s money on the strength of an empty field');

// Switched off explicitly is the same outcome by a different route, and both
// have to work or the three-state cutoff means nothing.
H.eq(C.past('none', at('2030-01-01T12:00:00Z')), false, 'a cutoff switched off never passes');
H.ok(C.creditFor(reg({ cancellation: { cancellationCutoffDate: 'none' } }),
  at('2030-01-01T12:00:00Z')).guardianMayCancel,
  'so an activity with cancellation deliberately left open stays open');

console.log('\n[no sessions at all means the course has not started]');
// Judged before the hard cutoff, or that answers first and this would be
// testing the wrong branch — which is exactly what it did on the first run.
const noCal = C.creditFor(reg({ cancellation: { sessionStartsAt: [] } }), at('2026-12-01T12:00:00Z'));
H.eq(noCal.courseCredit, 30000, 'full course credit');
H.eq(noCal.reason, 'not-started', 'because an empty list cannot have begun');
H.eq(noCal.feeCredit, 0, 'while the fee still answers to its own date, which has passed');

console.log('\n[the cutoff is the END of the day, in Cyprus]');
// Two ways to get this wrong, and both cost the family.
const feeDay = '2026-10-01';
const r = reg({ cancellation: { registrationFeeCutoffDate: feeDay } });
// 23:30 local on the cutoff day. Cyprus is UTC+3 on 1 October (DST ends on the
// last Sunday of the month), so that is 20:30 UTC.
H.eq(C.creditFor(r, at('2026-10-01T20:30:00Z')).feeCredit, 5000,
  'half past eleven at night on the cutoff day is still inside it');
H.eq(C.creditFor(r, at('2026-10-01T00:30:00Z')).feeCredit, 5000,
  'and so is half past three in the morning, which comparing against midnight would have lost');
// 00:30 local the NEXT day is 21:30 UTC on the 1st. A UTC comparison would call
// this "still the 1st" and credit a fee that has expired.
H.eq(C.creditFor(r, at('2026-10-01T21:30:00Z')).feeCredit, 0,
  'half past midnight on the 2nd is outside it, even though it is still the 1st in UTC');

// DST, from both sides of the year, because the offset is derived rather than
// assumed. Cyprus is +3 in summer and +2 in winter.
H.eq(new Date(C.endOfDay('2026-07-01')).toISOString(), '2026-07-01T20:59:59.999Z',
  'a summer day ends at 21:00 UTC, because Cyprus is UTC+3 then');
H.eq(new Date(C.endOfDay('2026-12-01')).toISOString(), '2026-12-01T21:59:59.999Z',
  'a winter day ends an hour later in UTC terms, at 22:00, because it is UTC+2');
// The millisecond matters, and is the reason the offset is resolved on whole
// seconds and .999 added afterwards: formatToParts has no millisecond field, so
// resolving an instant that already carried .999 came back a second short and
// put the "end" of the day one second inside the NEXT one.
H.ok(/\.999Z$/.test(new Date(C.endOfDay('2026-07-01')).toISOString()),
  'and it is the last millisecond of the day, not the first of the next');
H.eq(C.endOfDay('2026-02-30'), null, 'a date that does not exist is not a deadline');
H.eq(C.endOfDay(''), null, 'and neither is a blank');

console.log('\n[a session counts as remaining until it has STARTED]');
// Counted by start time, so cancelling on the morning of a session day still
// counts that session — the family has not had it yet.
const sessionDay = reg({ cancellation: { mode: 'prorated' } });
const morning = C.creditFor(sessionDay, at('2026-11-25T07:00:00Z'));   // 09:00 local
const evening = C.creditFor(sessionDay, at('2026-11-25T16:00:00Z'));   // 18:00 local
H.eq(morning.courseCredit, 12000, 'at nine in the morning, 4 of 10 sessions remain');
H.eq(evening.courseCredit, 9000, 'by six in the evening the 16:00 session has happened, so 3 remain');
H.ok(morning.courseCredit > evening.courseCredit,
  'the boundary is the start time, and it falls on the family\'s side of it');

console.log('\n[flat is proration with a fixed ratio, not a second formula]');
// Two formulas can round differently, and the difference surfaces when two
// families compare receipts. One divider, one rounding rule.
H.eq(C.share(30000, 1, 2), 15000, 'flat is share(course, 1, 2)');
H.eq(C.share(301, 1, 2), 151, 'rounded UP — half a cent has to go somewhere, and it goes to the family');
H.eq(C.share(100, 1, 3), 34, 'a third of a euro rounds up too');
H.eq(C.share(100, 0, 10), 0, 'nothing remaining is nothing');
H.eq(C.share(100, 10, 10), 100, 'everything remaining is everything, exactly, with no rounding applied');
H.eq(C.share(100, 11, 10), 100, 'and it is capped rather than exceeding what was paid');
H.eq(C.share(100, 1, 0), 0, 'a zero denominator is zero rather than an exception thrown at a family');

console.log('\n[the fee is split off, never stored as a second number]');
H.eq(JSON.stringify(C.splitPaid(35000, 50)), JSON.stringify({ fee: 5000, course: 30000 }),
  'fee first, the remainder is the course');
H.eq(JSON.stringify(C.splitPaid(3000, 50)), JSON.stringify({ fee: 3000, course: 0 }),
  'a part payment is the fee and nothing else, because the fee is billed first');
H.eq(JSON.stringify(C.splitPaid(0, 50)), JSON.stringify({ fee: 0, course: 0 }),
  'nobody who has paid nothing is credited anything');
H.eq(JSON.stringify(C.splitPaid(35000, 0)), JSON.stringify({ fee: 0, course: 35000 }),
  'an activity with no fee puts it all towards the course');
// The alternative — two stored fields — would need paidFee + paidCourse to
// equal paidCents, on a store with no transaction to hold that invariant.
const part = C.creditFor(reg({ paidCents: 3000 }), at('2026-09-20T12:00:00Z'));
H.eq(part.total, 3000, 'a family who has paid 30 EUR is credited 30 EUR, not 350');
H.eq(part.courseCredit, 0, 'and none of it is course money, because none of it was');

console.log('\n[nothing is read that could have changed since submission]');
// The property everything else rests on. Asserted against the SOURCE, because
// the failure is somebody later reading the activity instead of the frozen
// block — which usually gives the same answer, right up until it does not.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'netlify/functions/_credit.js'), 'utf8');
const code = src.replace(/\/\/[^\n]*\n/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
H.ok(code.indexOf('require(') === -1, 'the module requires nothing at all');
H.ok(!/Date\.now\(\)/.test(code), 'and never asks what time it is — the caller passes that in');
H.ok(!/Math\.random/.test(code), 'nor invents anything');
H.ok(!/requireStore|optionalStore|fetch\(/.test(code), 'it opens no store and makes no request');

// Same inputs, same answer, forever. This is what the ledger's basis promises a
// family, so it is stated as an assertion rather than left as a property of the
// code being written carefully.
const when = at('2026-11-25T12:00:00Z');
H.eq(JSON.stringify(C.creditFor(reg(), when)), JSON.stringify(C.creditFor(reg(), when)),
  'the same registration and the same timestamp give the same figure, every time');
// And an activity edited afterwards cannot reach it, because it is not an input.
H.eq(C.creditFor(reg(), when).courseCredit, 15000,
  'the mode comes from the registration, so changing the activity in March cannot ' +
  'rewrite what a January family is owed');

console.log('\n[the ledger records the reasoning, not just the number]');
const basis = C.basisFor(reg({ cancellation: { mode: 'prorated' } }), at('2026-11-25T12:00:00Z'));
H.eq(basis.total, 12000, 'the figure');
H.eq(basis.mode, 'prorated', 'the mode it was calculated under');
H.eq(basis.sessionsRemaining + ' of ' + basis.sessionsTotal, '4 of 10',
  'the sessions it divided by, so "why 120 and not 150" is answerable from the record');
H.eq(basis.paidFeeCents, 5000, 'the fee half of what was paid');
H.eq(basis.paidCourseCents, 30000, 'and the course half');
H.eq(basis.registrationFeeCutoffDate, '2026-10-01', 'both dates as they were frozen');
H.eq(basis.cancellationCutoffDate, '2026-12-23', 'including the one that had not been reached');
H.eq(basis.timezone, 'Asia/Nicosia',
  'and the zone the dates were judged in, which nothing else in this repo records');
H.eq(basis.feeCredit + basis.courseCredit, basis.total, 'the two halves add up to the total');

console.log('\n[freezing: only the sessions that are actually happening]');
// An excluded date never enters the frozen list, which is what lets creditFor()
// stay ignorant of exclusions — and means a holiday cannot skew a credit.
const activity = {
  registration: {
    registrationFeeCutoffDate: '2026-09-30',
    cancellationPolicy: { mode: 'prorated', cancellationCutoffDate: '2026-10-28' }
  },
  facts: {
    schedule: { sessions: [{ day: 3, time: '16:00' }] },
    duration: {
      sessionDates: [
        { date: '2026-10-14', status: 'scheduled' },
        { date: '2026-10-21', status: 'excluded', reason: 'Sukkot' },
        { date: '2026-10-28', status: 'scheduled' }
      ]
    }
  }
};
const frozen = C.freezeCancellation(activity);
H.eq(frozen.sessionStartsAt.length, 2, 'the excluded date is not frozen');
H.eq(frozen.mode, 'prorated', 'the mode is copied');
H.eq(frozen.registrationFeeCutoffDate, '2026-09-30', 'and both dates');
H.eq(frozen.cancellationCutoffDate, '2026-10-28', 'so the registration carries its own terms');
H.eq(new Date(frozen.sessionStartsAt[0]).toISOString(), '2026-10-14T13:00:00.000Z',
  '16:00 in Nicosia on 14 October is 13:00 UTC — the wall clock is resolved once, at freezing');
// The denominator is the length of that list, so an excluded session cannot be
// counted against a family. hebrew4kids has had a typed count disagreeing with
// its own calendar since before any of this existed, and this is the one place
// that disagreement would have decided money.
const withGap = { payment: { paidCents: 30000 },
  frozen: { price: { registrationFee: 0 }, cancellation: frozen } };
H.eq(C.creditFor(withGap, at('2026-10-15T12:00:00Z')).courseCredit, 15000,
  'one of the two remaining sessions is left, so half the course — the holiday ' +
  'is in neither the numerator nor the denominator');

H.done();
