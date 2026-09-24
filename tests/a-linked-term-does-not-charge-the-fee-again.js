// What this defends against:
//
// "If a course is marked that it is part of another course, whether it's the
// same year or another year, the registration fee should be omitted."
//
// The fee was scoped to ONE PARTICIPANT, ONE SERIES, ONE ACADEMIC YEAR. The year
// is right for a single activity — the fee is annual, and a course re-run next
// September is a new year of it. It was wrong between two terms an admin had
// deliberately LINKED: a programme running autumn, spring and then the following
// autumn charged the fee twice for what the family experiences as one thing.
//
// ⚠ THE TEST IS THE PAIR, NOT A FLAG ON THE RECORD, and that is the part worth
// remembering. seriesOf() DEFAULTS to the activity's own id, so every activity
// is a series of one and "does this carry a seriesId" cannot tell a linked first
// term from an unlinked activity — the first term of a series is usually the
// pointer TARGET and carries nothing itself. What is reliably true is that two
// DIFFERENT activityIds resolving to ONE seriesId can only have got there
// because somebody set "Part of". So the rule reads off the registrations:
//
//   a prior registration for a DIFFERENT activity in this series  -> any year
//   a prior registration for the SAME activity                    -> that year
//
// ⚠ AND THE FORWARD-LOOKING HALF HAD TO MOVE WITH IT. feeHeldByLiveTerm() stops
// a cancellation handing back a fee that a still-live waived term is leaning on.
// Leaving a feeYear condition there would have reopened exactly that loophole
// one year over: spring 2027 waived on autumn 2026's fee, autumn cancelled, the
// fee refunded in full, and the spring term standing with no fee paid anywhere.
// Both halves are executed here, against real records, for that reason.

const H = require('./_helpers');
const F = require('./_fixtures');

process.env.RESEND_FROM = 'Merkaz Ogen <noreply@ogen.cy>';

const R = require(H.fnPath('_registration'));

const SERIES = 'act-0000000000serie';
const FEE = 50;

// A stored registration, as the waiver reads one.
const prior = (over) => Object.assign({
  activityId: 'act-0000000000autumn',
  status: 'approved',
  frozen: { seriesId: SERIES, feeYear: '2026/27',
            price: { feeCharged: true, registrationFee: FEE } },
  payment: { paidCents: 0, feeCreditedCents: 0 }
}, over || {});

const applies = (priors, activityId, feeYear) =>
  R.feeApplies(priors, SERIES, feeYear || '2026/27', activityId);

(async () => {
  // =========================================================================
  console.log('[a linked later term is not charged again, in any year]');

  // The case that was already right: the spring term of the same year.
  H.eq(applies([prior()], 'act-0000000000spring', '2026/27'), false,
    'the spring term of the same year is waived, as it always was');

  // ⚠ THE CHANGE. Next autumn, same series, a different activity.
  H.eq(applies([prior()], 'act-0000000000next01', '2027/28'), false,
    '⚠ and so is a LINKED term in the NEXT academic year — the marking is what ' +
    'decides, not the calendar');
  H.eq(applies([prior()], 'act-0000000000far001', '2031/32'), false,
    'however far apart the two terms are');

  // =========================================================================
  console.log('\n[but an activity nobody linked keeps its yearly fee]');
  //
  // The same activityId in a new year is not "part of another course" — nobody
  // marked anything, and a course re-run next September is a new year of it.
  H.eq(applies([prior()], 'act-0000000000autumn', '2027/28'), true,
    '⚠ the SAME activity in a new year is charged — this is the half that did ' +
    'not change, and it is why the rule reads the pair rather than a flag');
  H.eq(applies([prior()], 'act-0000000000autumn', '2026/27'), false,
    'and within one year it is still waived');

  // A different series is a different fee, whatever the year.
  H.eq(R.feeApplies([prior({ frozen: { seriesId: 'act-000000000other0',
    feeYear: '2026/27', price: { feeCharged: true } } })],
    SERIES, '2026/27', 'act-0000000000spring'), true,
    'a different activity entirely is charged');
  H.eq(applies([], 'act-0000000000spring'), true, 'and a first registration is charged');

  // =========================================================================
  console.log('\n[what counts as "already charged" is unchanged]');
  //
  // ⚠ CROSSING YEARS MUST NOT WEAKEN feeStandsOn(). Register, do not pay,
  // cancel, register again would otherwise become a way to never pay the fee —
  // and now across years as well, which is longer for nobody to notice.
  H.eq(applies([prior({ status: 'cancelled' })], 'act-0000000000next01', '2027/28'), true,
    '⚠ a cancelled term that was never PAID proves nothing, in a later year either');
  H.eq(applies([prior({ status: 'cancelled',
    payment: { paidCents: FEE * 100, feeCreditedCents: 0 } })],
    'act-0000000000next01', '2027/28'), false,
    'but one that was paid and not given back does');
  H.eq(applies([prior({ status: 'cancelled',
    payment: { paidCents: FEE * 100, feeCreditedCents: FEE * 100 } })],
    'act-0000000000next01', '2027/28'), true,
    'and a fee paid then refunded is charged again — the mirror hole stays shut');
  H.eq(applies([prior({ status: 'rejected' })], 'act-0000000000next01', '2027/28'), true,
    'a rejected request never became a place');
  H.eq(applies([prior({ status: 'expired' })], 'act-0000000000next01', '2027/28'), true,
    'nor did one that lapsed');
  H.eq(applies([prior({ frozen: { seriesId: SERIES, feeYear: '2026/27',
    price: { feeCharged: false } } })], 'act-0000000000next01', '2027/28'), true,
    '⚠ and a term whose OWN fee was waived proves nothing — `feeCharged: false` ' +
    'is not a payment, so a series cannot waive itself forever off one blank');

  // A record written before any of this has no series and is charged, which is
  // the direction that costs nobody a place.
  H.eq(R.feeApplies([prior()], null, '2026/27', 'act-1'), true,
    'no series at all is charged');

  // =========================================================================
  console.log('\n[the forward-looking half crosses years too]');
  //
  // Otherwise: spring 2027 waived on autumn 2026's fee, autumn cancelled, the
  // fee handed back in full, and the spring term standing with nothing paid.
  const held = (reg, sibs) => R.feeHeldByLiveTerm(reg, sibs);
  const autumn = prior();
  const waivedNextYear = {
    activityId: 'act-0000000000next01', status: 'approved',
    frozen: { seriesId: SERIES, feeYear: '2027/28',
              price: { feeCharged: false, registrationFee: FEE } }
  };
  H.eq(held(autumn, [waivedNextYear]), true,
    '⚠ cancelling the term that paid the fee does NOT hand it back while a ' +
    'linked later term is still leaning on it, whatever year that term is in');
  H.eq(held(autumn, [Object.assign({}, waivedNextYear, { status: 'cancelled' })]), false,
    'a sibling that is over is relying on nothing');
  H.eq(held(autumn, [Object.assign({}, waivedNextYear, {
    frozen: { seriesId: SERIES, feeYear: '2027/28',
              price: { feeCharged: true, registrationFee: FEE } } })]), false,
    'nor is one that was charged its own fee — withholding there would take €50 ' +
    'from a family who owes nothing');
  H.eq(held(autumn, [Object.assign({}, waivedNextYear,
    { frozen: { seriesId: 'act-000000000other0', feeYear: '2027/28',
                price: { feeCharged: false } } })]), false,
    'and a different series is a different fee');

  // =========================================================================
  console.log('\n[end to end, through the real modules and a real series]');
  const blobs = H.makeBlobs();
  const POLICY = { autoApprove: true, pendingExpiryDays: null,
                   registrationFeeCutoffDate: '2099-01-01',
                   cancellationPolicy: { mode: 'flat', cancellationCutoffDate: '2099-06-01' },
                   defaultBasis: null };
  const autumnAct = F.course({ registration: POLICY });
  // The spring term as the admin makes one: a separate record POINTED at the
  // first. F.secondTerm already carries the seriesId, which is the shape.
  const springAct = F.secondTerm({ registration: POLICY });
  H.eq(springAct.seriesId, autumnAct.activityId,
    'the fixture links the two terms the way "Part of" does');

  // And next year's autumn, linked to the same series, with its dates moved on.
  const nextAct = JSON.parse(JSON.stringify(springAct));
  nextAct.slug = 'course-fixture-next';
  nextAct.activityId = 'act-0000000000next99';
  nextAct.groups.forEach((g) => {
    g.facts = g.facts || {};
    g.facts.duration = Object.assign({}, g.facts.duration,
      { startDate: '2027-10-05', endDate: '2027-12-21', sessionDates: [] });
  });

  const github = H.makeGithub({
    'activities/course-fixture.json': JSON.stringify(autumnAct),
    'activities/course-fixture-spring.json': JSON.stringify(springAct),
    'activities/course-fixture-next.json': JSON.stringify(nextAct)
  });
  const mods = H.loadWithStubs({ blobs, github,
    modules: ['_registration', '_registration-store', 'account-auth', 'account-family',
              'account-registrations'] });
  const api = mods['account-registrations'];
  const fam = mods['account-family'];
  const store = mods['_registration-store'];

  require(H.fnPath('_email'))._internal.setTransport({
    emails: { send: async () => ({ data: { id: 'e-1' } }) }
  });

  const up = await H.signUp(mods['account-auth'], blobs, { email: 'dana@example.com',
    profile: { firstName: 'Dana', preferredLanguage: 'en' } });
  const token = up.body.token;
  const made = await H.call(fam.handler, { action: 'createParticipant', token: token,
    participant: { firstName: 'Noa', lastName: 'Levi', dateOfBirth: '2016-04-02' } });
  const noa = made.body.participant.participantId;

  const join = async (slug) => H.call(api.handler, { action: 'submit', token: token,
    slug: slug, participantId: noa, lang: 'en' });
  const feeOn = (reg) => ((reg.frozen || {}).price || {}).feeCharged;

  const one = await join('course-fixture');
  H.eq(one.status, 200, 'the autumn term is registered');
  H.eq(feeOn(one.body.registration), true, 'and carries the fee');

  const two = await join('course-fixture-spring');
  H.eq(two.status, 200, 'the spring term is registered');
  H.eq(feeOn(two.body.registration), false, 'with the fee waived, as before');

  const three = await join('course-fixture-next');
  H.eq(three.status, 200, 'and next year\'s term is registered');
  H.eq(feeOn(three.body.registration), false,
    '⚠ WITH THE FEE WAIVED TOO — the change, executed through the real handler ' +
    'rather than through feeApplies() alone');

  // And the bill that follows from it, because feeCharged is the third argument
  // to splitPaid() and moves the total rather than only a label.
  const stored = await store.getRegistration(noa, nextAct.activityId);
  const charged = await store.getRegistration(noa, autumnAct.activityId);
  H.ok(stored.payment.owedCents < charged.payment.owedCents,
    'the linked term is billed less than the one that carried the fee (' +
    stored.payment.owedCents + ' vs ' + charged.payment.owedCents + ')');
  H.eq(charged.payment.owedCents - stored.payment.owedCents, FEE * 100,
    'by exactly the fee');

  H.done();
})();
