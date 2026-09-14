// What this defends against:
//
// `autoApprove` means "this activity has no gate a human needs to apply". It
// does NOT mean "admit whoever asks" — an activity stating ages 6-10 that
// quietly admitted a twelve-year-old is the one thing "it is the admin's call"
// cannot mean. So an out-of-range age falls through to manual review, which was
// settled in the design and is pinned here.
//
// THE CASE THE DESIGN DID NOT NAME is an age that cannot be checked at all: a
// record with no usable date of birth, on an activity that states a range. The
// rule is therefore written as "a stated range must be POSITIVELY SATISFIED",
// not as "inRange must not be false" — reading a blank as a pass would make the
// one case nobody can verify the one case nobody looks at. An activity with no
// stated range has nothing to satisfy, so auto-approve applies in full; that is
// not an exception, there is simply nothing to check.
//
// Falling through is not a rejection. The registration waits for a person, and
// the person may well say yes. Nothing in this system is rejected by a machine,
// which is what makes the binary approval model genuinely binary and why there
// are no reason codes to carry.
//
// The second half is the FROZEN BLOCK, which is the only thing standing between
// a Blobs record and a git record that an admin edits daily. A price change or
// an age-range change in March must not rewrite what a family agreed to in
// January — and a group renamed from "Advanced" to "Level 3" must not rewrite
// what they chose.

const H = require('./_helpers');
const F = require('./_fixtures');

process.env.RESEND_FROM = 'Merkaz Ogen <noreply@ogen.cy>';

const NOW = Date.parse('2026-08-01T09:00:00Z');

(async () => {
  const blobs = H.makeBlobs();

  // Ages 6-10, auto-approving, one place per group so nothing is refused for
  // capacity by accident.
  const withAges = (base, extra) => Object.assign({}, base, {
    facts: Object.assign({}, base.facts, { ages: { min: 6, max: 10 } }, extra || {}),
    registration: Object.assign({}, base.registration, { autoApprove: true })
  });
  const autoCourse = withAges(F.course({ slug: 'auto-course', activityId: 'act-00000000000a0001' }));
  const autoDropin = withAges(F.dropin({ slug: 'auto-dropin', activityId: 'act-00000000000a0002' }));
  const namedAuto = withAges(
    F.course({ slug: 'auto-named', activityId: 'act-00000000000a0003' }), { groupSize: F.NAMED });
  const noRange = Object.assign({}, F.course({ slug: 'no-range', activityId: 'act-00000000000a0004' }), {
    registration: Object.assign({}, F.course().registration, { autoApprove: true })
  });

  const github = H.makeGithub({
    'activities/auto-course.json': JSON.stringify(autoCourse),
    'activities/auto-dropin.json': JSON.stringify(autoDropin),
    'activities/auto-named.json': JSON.stringify(namedAuto),
    'activities/no-range.json': JSON.stringify(noRange)
  });

  const mods = H.loadWithStubs({
    blobs, github,
    modules: ['_registration', '_registration-store', 'account-auth',
              'account-family', 'account-registrations']
  });
  const R = mods['_registration'];
  const store = mods['_registration-store'];
  const auth = mods['account-auth'];
  const family = mods['account-family'];
  const regs = mods['account-registrations'];

  const sent = [];
  require(H.fnPath('_email'))._internal.setTransport({
    emails: { send: async (a) => { sent.push(a); return { data: { id: 'id-' + sent.length } }; } }
  });

  // ------------------------------------------------------------- the decision
  console.log('[auto-approve stands aside, and only for a reason]');
  const inRange = { participantId: 'p-1', firstName: 'Noa', dateOfBirth: '2018-04-02' };   // 8
  const tooOld = { participantId: 'p-2', firstName: 'Ari', dateOfBirth: '2013-04-02' };    // 13
  const noDob = { participantId: 'p-3', firstName: 'Tal', dateOfBirth: '' };

  const flag = (activity, p) => R.flagFor(activity, p, NOW);
  H.eq(R.autoApproves(autoCourse, flag(autoCourse, inRange)), true, 'in range, so nothing to decide');
  H.eq(R.autoApproves(autoCourse, flag(autoCourse, tooOld)), false,
    'out of range falls through to a person — this is NOT a rejection');
  H.eq(R.autoApproves(autoCourse, flag(autoCourse, noDob)), false,
    'and so does an age the activity states a range for and nobody can check');
  H.eq(R.autoApproves(noRange, flag(noRange, tooOld)), true,
    'an activity with no stated range has nothing to satisfy, so it auto-approves in full');
  H.eq(R.autoApproves(F.course(), flag(autoCourse, inRange)), false,
    'and with autoApprove off, nothing auto-approves however in-range the child is');

  console.log('\n[the age is measured at the activity\'s start, not at submission]');
  // A child who turns seven the week before a 7-10 class begins is seven for
  // that class, and a family registering in August must not be told otherwise.
  const sevenInSeptember = { participantId: 'p-4', firstName: 'Yael', dateOfBirth: '2019-09-20' };
  const sept = Object.assign({}, autoCourse, {
    facts: Object.assign({}, autoCourse.facts, { ages: { min: 7, max: 10 } })
  });
  const f = R.flagFor(sept, sevenInSeptember, Date.parse('2026-08-01T00:00:00Z'));
  H.eq(f.checkedAgainst, 'activity-start', 'the moment is the start date');
  H.eq(f.age, 7, 'so the child is seven, as they will be on the day');
  H.eq(f.inRange, true, 'and in range');
  H.eq(R.ageCheckMoment(F.dropin(), NOW).against, 'activity-start',
    'a drop-in with a start date uses it too');
  H.eq(R.ageCheckMoment({ facts: { duration: {} } }, NOW).against, 'submission',
    'and only an activity with no start date falls back to the submission moment');

  // ------------------------------------------------------------- end to end
  console.log('\n[through the handler, on both halves of both pairs]');
  const r = await H.call(auth.handler, {
    action: 'signup', email: 'dana@example.com', password: 'password-123', termsAccepted: true,
    profile: { firstName: 'Dana', preferredLanguage: 'he' }
  });
  const dana = { token: r.body.token, accountId: r.body.account.accountId };
  const kid = async (firstName, dob) => {
    const made = await H.call(family.handler, {
      action: 'createParticipant', token: dana.token,
      participant: { firstName: firstName, dateOfBirth: dob }
    });
    return made.body.participant.participantId;
  };
  const noa = await kid('Noa', '2018-04-02');   // 8
  const ari = await kid('Ari', '2013-04-02');   // 13

  for (const [label, slug, groupId] of [
    ['course', 'auto-course', null],
    ['drop-in', 'auto-dropin', null],
    ['named course', 'auto-named', 'g-beginners']
  ]) {
    const okReg = await H.call(regs.handler, {
      action: 'submit', token: dana.token, slug: slug, participantId: noa, groupId: groupId });
    H.eq(okReg.body.registration.status, 'approved', label + ': the in-range child is approved on the spot');
    H.eq(okReg.body.registration.autoApproved, true, label + ': and the record says a machine did it');

    const wait = await H.call(regs.handler, {
      action: 'submit', token: dana.token, slug: slug, participantId: ari, groupId: groupId });
    H.eq(wait.body.registration.status, 'pending', label + ': the out-of-range child WAITS');
    H.eq(wait.body.registration.autoApproved, false, label + ': and was not decided by anything');
    H.eq(wait.body.registration.ageFlag.inRange, false, label + ': the queue is told why');
    H.eq(wait.body.registration.ageFlag.reason, 'above-maximum', label + ': and which end');
    // It is a flag, not a gate: it did not refuse the submission, it annotated it.
    H.eq(wait.status, 200, label + ': the registration was taken, not refused');
  }

  console.log('\n[the family is told which of the two happened]');
  const subjects = sent.map((m) => m.subject);
  H.ok(subjects.some((s) => /רשום/.test(s)), 'an approval is confirmed');
  H.ok(subjects.some((s) => /קיבלנו את הבקשה/.test(s)), 'a pending request is acknowledged instead');
  H.ok(sent.every((m) => m.text && m.text.length), 'and every message carries a plain-text twin');

  // ---------------------------------------------------------------- freezing
  console.log('\n[the frozen block is the inputs to the decision, taken once]');
  const frozen = (await store.getRegistration(noa, 'act-00000000000a0003')).frozen;
  H.eq(frozen.participantName, 'Noa', 'the name as it read then');
  H.eq(frozen.dateOfBirth, '2018-04-02', 'the date of birth the age was computed from');
  H.eq(frozen.ageRange.min, 6, 'the range as the activity had it');
  H.eq(frozen.ageRange.max, 10, 'both ends');
  H.eq(frozen.ageCheckedAgainst, 'activity-start', 'and which moment it was measured at');
  H.eq(frozen.price.registrationFee, 50, 'the fee');
  H.eq(frozen.price.fullPrice, 300, 'the term price');
  H.eq(frozen.price.currency, 'EUR', 'in cents-friendly currency, stated');
  H.eq(frozen.groupName.en, 'Beginners', 'the group NAME, not only its id');
  H.eq(frozen.cancellation.mode, 'flat', 'the cancellation terms this family agreed to');
  H.eq(frozen.cancellation.sessionStartsAt.length, 10,
    'and the sessions that are actually happening, resolved once');
  H.eq(frozen.activitySlugAtSubmission, 'auto-named',
    'the slug is kept for auditing only — nothing keys off it, so a rename is a rename working');

  console.log('\n[and an edit to the activity afterwards does not reach it]');
  github._files.set('activities/auto-named.json', JSON.stringify(Object.assign({}, namedAuto, {
    facts: Object.assign({}, namedAuto.facts, {
      ages: { min: 11, max: 14 },
      price: { registrationFee: 90, fullPrice: 600 },
      groupSize: { named: [{ groupId: 'g-beginners', name: F.lang('רמה 1', 'Level 1', 'Уровень 1'), capacity: 7 }] }
    })
  })));
  const after = (await store.getRegistration(noa, 'act-00000000000a0003')).frozen;
  H.eq(after.price.fullPrice, 300, 'the price the family agreed to is still 300');
  H.eq(after.ageRange.max, 10, 'the range they were judged against is still 6-10');
  H.eq(after.groupName.en, 'Beginners', 'and a receipt still says the group they chose');
  // The live record moved, which is the whole point of checking.
  const live = await H.call(regs.handler, { action: 'activity', token: dana.token, slug: 'auto-named' });
  H.eq(live.body.activity.groups[0].name.en, 'Level 1', 'while the activity itself has genuinely changed');

  H.done();
})();
