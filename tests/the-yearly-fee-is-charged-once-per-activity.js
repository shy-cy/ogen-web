// What this defends against:
//
// The registration fee is annual, and "annual" turned out to need three
// qualifiers before it meant anything. It is scoped to ONE PARTICIPANT, ONE
// ACTIVITY, ONE ACADEMIC YEAR:
//
//   same child, same activity, second term  -> NOT charged again
//   same child, a different activity        -> charged
//   a sibling, any activity                 -> charged
//
// This file was briefly written down as a FAMILY-level rule, which is wrong in
// both directions at once: it would have waived a sibling's fee, which Ogen does
// charge, and it would have needed the account's whole family resolved before it
// could price a single registration. Participant scope makes the waiver a prefix
// scan of that child's own key space — no sibling lookup, no ledger.
//
// THE YEAR IS ACADEMIC, NOT CALENDAR, and that is not a refinement — it is the
// feature. Autumn runs October to December and spring January to June, so on a
// calendar year the two halves of one course fall either side of the boundary
// and a returning child is charged twice. Which is the exact case the waiver
// exists for.
//
// And the consequence that costs money if it is missed: splitPaid() in
// _credit.js takes the fee off the top of whatever was paid. On a WAIVED
// registration nothing paid is fee, so without frozen.price.feeCharged the first
// €50 of a course payment comes back as a fee credit — inflating the fee half,
// deflating the course half, and moving the total, because the two halves answer
// to different dates.

const H = require('./_helpers');
const F = require('./_fixtures');
const path = require('path');

process.env.RESEND_FROM = 'Merkaz Ogen <noreply@ogen.cy>';

(async () => {
  const blobs = H.makeBlobs();
  const autumn = F.course();
  const spring = F.secondTerm();
  // A different course entirely: its own series, so its own fee.
  const other = F.course({
    slug: 'other-course', activityId: 'act-0000000000000o01', seriesId: 'act-0000000000000o01'
  });
  const github = H.makeGithub({
    'activities/course-fixture.json': JSON.stringify(autumn),
    'activities/course-fixture-spring.json': JSON.stringify(spring),
    'activities/other-course.json': JSON.stringify(other)
  });

  const mods = H.loadWithStubs({
    blobs, github,
    modules: ['_registration', '_registration-store', '_credit', '_credit-ledger',
              '_activity-migrate', 'account-auth', 'account-family', 'account-registrations',
              'admin-registrations']
  });
  const R = mods['_registration'];
  const store = mods['_registration-store'];
  const credit = mods['_credit'];
  const { migrate } = mods['_activity-migrate'];
  const auth = mods['account-auth'];
  const family = mods['account-family'];
  const regs = mods['account-registrations'];
  const adminRegs = mods['admin-registrations'];

  require(H.fnPath('_email'))._internal.setTransport({
    emails: { send: async () => ({ data: { id: 'x' } }) }
  });

  // ------------------------------------------------------- the academic year
  console.log('[the year is academic, and September is the boundary]');
  H.eq(R.academicYearOf('2026-10-14'), '2026/27', 'an autumn term');
  H.eq(R.academicYearOf('2027-03-02'), '2026/27', 'and the spring after it are ONE year');
  H.eq(R.academicYearOf('2027-08-31'), '2026/27', 'right up to the end of August');
  H.eq(R.academicYearOf('2027-09-01'), '2027/28', 'and over on the first of September');
  H.eq(R.academicYearOf(''), null, 'no date is no answer, rather than this year');
  // Measured from the activity's START, not from the moment of submission: a
  // family enrolling on 31 August for an October course must land in the same
  // year as one enrolling on 1 September for it.
  H.eq(R.feeYearOf(autumn, Date.parse('2026-08-31T12:00:00Z')), '2026/27', 'enrolled in August');
  H.eq(R.feeYearOf(autumn, Date.parse('2026-09-01T12:00:00Z')), '2026/27', 'or in September — same term, same year');

  console.log('\n[a series defaults to the record\'s own id, so nothing existing changes]');
  const plain = migrate({ activityId: 'act-000000000000aaaa', slug: 'x' });
  H.eq(plain.seriesId, 'act-000000000000aaaa', 'an activity is a series of one until somebody says otherwise');
  H.eq(migrate(spring).seriesId, autumn.activityId, 'and a linked term points at the first one');
  H.eq(R.seriesOf(autumn), R.seriesOf(spring), 'so the two terms are the same activity');
  H.ok(R.seriesOf(other) !== R.seriesOf(autumn), 'and a different course is not');
  // Idempotent, like every other thing migrate() does.
  H.eq(migrate(migrate(spring)).seriesId, autumn.activityId, 'running it twice changes nothing');

  // ------------------------------------------------------------- the waiver
  console.log('\n[the waiver, at the level of the rule]');
  const paidAutumn = {
    status: 'approved', frozen: { seriesId: autumn.activityId, feeYear: '2026/27', price: { feeCharged: true } },
    payment: {}
  };
  H.eq(R.feeApplies([], autumn.activityId, '2026/27'), true, 'nothing before it, so the fee applies');
  H.eq(R.feeApplies([paidAutumn], autumn.activityId, '2026/27'), false,
    'same child, same activity, same year — NOT charged again');
  H.eq(R.feeApplies([paidAutumn], other.activityId, '2026/27'), true,
    'same child, a DIFFERENT activity — charged');
  H.eq(R.feeApplies([paidAutumn], autumn.activityId, '2027/28'), true,
    'same activity, the NEXT academic year — charged');
  // A sibling has their own participant record and therefore their own prefix
  // scan; there is no list in which the two could meet.
  H.eq(R.feeApplies([], autumn.activityId, '2026/27'), true,
    'a sibling starts from an empty list, which is why they are charged');

  console.log('\n[what counts as "already charged"]');
  const withStatus = (s, over) => Object.assign({}, paidAutumn, { status: s }, over || {});
  H.eq(R.feeStandsOn(withStatus('approved')), true, 'an approved registration was billed');
  H.eq(R.feeStandsOn(withStatus('pending')), true, 'and so was a live request');
  H.eq(R.feeStandsOn(withStatus('rejected')), false,
    'but a REJECTED request never became a place, so nothing was billed');
  H.eq(R.feeStandsOn(withStatus('expired')), false, 'and neither did one nobody answered');

  // A cancellation is a DIFFERENT question from a live registration. "Billed" is
  // a promise about a registration that still stands; once it is over, only what
  // was actually paid counts.
  H.eq(R.feeStandsOn(withStatus('cancelled', { payment: { paidCents: 0 } })), false,
    'registering, not paying, cancelling and registering again must not be a way to never pay the fee');
  H.eq(R.feeStandsOn(withStatus('cancelled', {
    frozen: { seriesId: autumn.activityId, feeYear: '2026/27', price: { feeCharged: true, registrationFee: 50 } },
    payment: { paidCents: 35000, feeCreditedCents: 0 } })), true,
    'a cancellation that kept the fee still counts — it was paid');
  H.eq(R.feeStandsOn(withStatus('cancelled', {
    frozen: { seriesId: autumn.activityId, feeYear: '2026/27', price: { feeCharged: true, registrationFee: 50 } },
    payment: { paidCents: 35000, feeCreditedCents: 5000 } })), false,
    'and one that gave it back does not — which is why the fee half is tracked apart from the total');
  H.eq(R.feeStandsOn({ status: 'approved', frozen: { price: {} }, payment: {} }), true,
    'a record from before the waiver existed reads as charged, because it was');

  // --------------------------------------------------------- what it is billed
  console.log('\n[what each term is billed]');
  H.eq(R.owedCentsFor(autumn, true), 35000, 'the first term is the fee plus the course');
  H.eq(R.owedCentsFor(spring, false), 30000, 'the second is the course alone — 300, not 350');
  H.eq(R.owedCentsFor(F.dropin(), true), 5000,
    'a drop-in owes the fee and nothing else at submission — its sessions are billed as attended');

  // ---------------------------------------------------------------- end to end
  console.log('\n[through the handler, autumn then spring]');
  const signed = await H.signUp(auth, blobs, {
action: 'signup', email: 'dana@example.com', password: 'password-123', termsAccepted: true,
    profile: { firstName: 'Dana', preferredLanguage: 'en' }
  });
  const dana = { token: signed.body.token, accountId: signed.body.account.accountId };
  const kid = async (name) => (await H.call(family.handler, {
    action: 'createParticipant', token: dana.token,
    participant: { firstName: name, dateOfBirth: '2017-04-02' }
  })).body.participant.participantId;
  const noa = await kid('Noa');
  const ari = await kid('Ari');          // the sibling

  const sub = (pid, slug) => H.call(regs.handler, {
    action: 'submit', token: dana.token, slug: slug, participantId: pid });

  const a1 = await sub(noa, 'course-fixture');
  H.eq(a1.body.registration.frozen.price.feeCharged, true, 'the autumn term is charged the fee');
  H.eq(a1.body.registration.payment.owedCents, 35000, 'so it owes 350');
  H.eq(a1.body.registration.frozen.feeYear, '2026/27', 'in the 2026/27 year');
  H.eq(a1.body.registration.frozen.seriesId, autumn.activityId, 'against this series');

  const s1 = await sub(noa, 'course-fixture-spring');
  H.eq(s1.status, 200, 'the spring term is a separate registration, on a separate key');
  H.eq(s1.body.registration.frozen.price.feeCharged, false, 'and is NOT charged the fee again');
  H.eq(s1.body.registration.payment.owedCents, 30000, 'so it owes 300, not 350');

  const o1 = await sub(noa, 'other-course');
  H.eq(o1.body.registration.frozen.price.feeCharged, true,
    'the same child in a DIFFERENT activity is charged again');
  H.eq(o1.body.registration.payment.owedCents, 35000, 'the full 350');

  const b1 = await sub(ari, 'course-fixture');
  H.eq(b1.body.registration.frozen.price.feeCharged, true,
    'and so is a sibling in the same activity — the scope is the participant, not the family');

  console.log('\n[splitPaid reads the flag, and the credit depends on it]');
  // 300 paid against a waived registration. Without the flag the first 50 comes
  // back as a fee credit, which is money that was never a fee.
  H.eq(JSON.stringify(credit.splitPaid(30000, 50, false)), '{"fee":0,"course":30000}',
    'on a waived registration, nothing paid is fee');
  H.eq(JSON.stringify(credit.splitPaid(30000, 50, true)), '{"fee":5000,"course":25000}',
    'and on a charged one the fee comes off the top');
  H.eq(JSON.stringify(credit.splitPaid(30000, 50)), '{"fee":5000,"course":25000}',
    'absent reads as charged, so nothing written before the waiver changes meaning');

  // The two halves answer to DIFFERENT dates, so getting the split wrong moves
  // the total and not only its labels. Here the fee cutoff has passed and the
  // course has not started: a charged registration loses its fee, a waived one
  // has no fee to lose.
  const frozenReg = (feeCharged, paid) => ({
    frozen: {
      price: { registrationFee: 50, fullPrice: 300, feeCharged: feeCharged },
      cancellation: {
        mode: 'flat', registrationFeeCutoffDate: '2026-09-01', cancellationCutoffDate: null,
        sessionStartsAt: [Date.parse('2026-10-14T16:00:00Z')]
      }
    },
    payment: { paidCents: paid }
  });
  const at = Date.parse('2026-09-20T12:00:00Z');
  const charged = credit.creditFor(frozenReg(true, 30000), at);
  const waived = credit.creditFor(frozenReg(false, 30000), at);
  H.eq(charged.feeCredit, 0, 'past the fee cutoff, a charged registration credits no fee');
  H.eq(charged.courseCredit, 25000, 'and only 250 of the 300 is course');
  H.eq(waived.courseCredit, 30000, 'where a waived one has the whole 300 as course');
  H.ok(waived.total > charged.total,
    'so the flag changes the TOTAL, not just which column it sits in — 50 euros of it');

  console.log('\n[the waiver is re-read, not re-derived, once frozen]');
  // Moving the spring term out of the series afterwards must not change what
  // this family was billed.
  github._files.set('activities/course-fixture-spring.json',
    JSON.stringify(Object.assign({}, spring, { seriesId: 'act-0000000000000o01' })));
  const still = await store.getRegistration(noa, spring.activityId);
  H.eq(still.frozen.price.feeCharged, false, 'the spring registration is still fee-free');
  H.eq(still.frozen.seriesId, autumn.activityId, 'and still records which series decided that');

  H.done();
})();
