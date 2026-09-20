// What this defends against:
//
// A drop-in is not a course with a different price. It is the same activity
// record with `type: "dropin"`, and exactly five places are allowed to notice —
// priceRows(), creditFor(), the capacity count, validate(), and FIELD_SCHEMA.
// Everything else renders whatever the facts contain, which is what made a flag
// the right shape instead of a second content type.
//
// THE DANGEROUS ONE IS creditFor(), because the course path would ANSWER rather
// than fail. A drop-in has no cancellation policy, so the frozen block carries
// mode 'flat' with both cutoffs null — and every null in _credit.js resolves
// towards the family. The fee would come back at 100% and the "course" at 50%,
// on an activity where the fee is a once-a-year joining fee and there is no
// course to prorate. Nobody would have seen a wrong number. They would have seen
// a plausible one, on a real receipt.
//
// The rest:
//
//   - ONE BLOB PER EVENING, not a list on the registration. Hanging session
//     charges off the registration makes it a hot record rewritten every week on
//     a store with no compare-and-swap, so two writes on one evening lose one
//     silently. Separate keys make that impossible rather than unlikely — the
//     same argument that made a registration one-per-participant rather than an
//     attendees[] array.
//   - CAPACITY IS PER DATE. The room holds twenty on Tuesday, not twenty
//     forever, and a cancellation frees the place the moment it is written
//     because the count reads the status rather than a decremented number.
//   - CANCELLING IS ALL OR NOTHING. One evening has nothing to be part of, so
//     there is nothing to prorate — 1/1 or 0/1 is a boolean in a fraction's
//     clothes. Null hours is creditable until it starts, the same generous
//     direction every other blank takes.
//   - AND THE CONDITIONAL-PANEL TRAP, confirmed still shut: switching a type
//     must not silently clear the fields the other type's form did not draw.

const H = require('./_helpers');
const F = require('./_fixtures');

process.env.RESEND_FROM = 'Merkaz Ogen <noreply@ogen.cy>';

const HOUR = 3600 * 1000;

(async () => {
  const blobs = H.makeBlobs();
  // 19:30 Tuesdays, 12 EUR a session, a 24-hour cancellation window, room for 2.
  const dropin = F.dropin({
    facts: Object.assign({}, F.dropin().facts, { groupSize: { groups: 1, maxPerGroup: 2 } })
  });
  const course = F.course();
  const github = H.makeGithub({
    'activities/dropin-fixture.json': JSON.stringify(dropin),
    'activities/course-fixture.json': JSON.stringify(course)
  });

  const mods = H.loadWithStubs({
    blobs, github,
    modules: ['_credit', '_registration', '_session-attendance', '_credit-ledger',
              '_activity-facts', '_activity-registration',
              'account-auth', 'account-family', 'account-registrations', 'admin-registrations']
  });
  const credit = mods['_credit'];
  const R = mods['_registration'];
  const att = mods['_session-attendance'];
  const ledger = mods['_credit-ledger'];
  const facts = mods['_activity-facts'];
  const REG = mods['_activity-registration'];
  const auth = mods['account-auth'];
  const family = mods['account-family'];
  const regs = mods['account-registrations'];
  const adminRegs = mods['admin-registrations'];

  require(H.fnPath('_email'))._internal.setTransport({
    emails: { send: async () => ({ data: { id: 'x' } }) }
  });

  // ------------------------------------------------------ the five places ----
  console.log('[1. the price card quotes a session, and no term row appears]');
  ['he', 'en', 'ru'].forEach((l) => {
    const rows = facts.priceRows(dropin.facts.price, l, dropin.facts.duration);
    const labels = rows.map((r) => r.label);
    H.ok(rows.some((r) => /12/.test(r.value)), l + ': the session price is quoted');
    H.eq(rows.filter((r) => /semester|סמסטר|семестр/i.test(r.label)).length, 0,
      l + ': and there is no "cost per semester", because there is no term price to name');
    H.ok(rows.every((r) => !/×/.test(r.note || '')),
      l + ': the "(N sessions × M lessons)" qualifier hangs off fullPrice and disappears on its own');
    H.ok(labels.length >= 2, l + ': the fee is still there — a once-a-year joining fee applies more, not less');
  });
  // The course keeps its exact behaviour. This is a guard, not a rewrite.
  H.ok(facts.priceRows(course.facts.price, 'en', course.facts.duration)
    .some((r) => /semester/i.test(r.label)), 'and a course still quotes its term');

  console.log('\n[2. creditFor() refuses the course arithmetic outright]');
  const asDropin = { frozen: { type: 'dropin', price: { registrationFee: 50, feeCharged: true },
                               cancellation: { mode: 'flat', registrationFeeCutoffDate: null,
                                               cancellationCutoffDate: null, sessionStartsAt: [] } },
                     payment: { paidCents: 5000 } };
  const verdict = credit.creditFor(asDropin, Date.now());
  H.eq(verdict.total, 0, 'cancelling a drop-in REGISTRATION credits nothing');
  H.eq(verdict.reason, 'per-session', 'and says why rather than looking like a zero that fell out of the maths');
  H.eq(verdict.feeCredit, 0, 'the joining fee does not come back');
  // Proof the guard is load-bearing: the same record without the type flag runs
  // the course path and hands back the whole fee.
  const unguarded = JSON.parse(JSON.stringify(asDropin));
  delete unguarded.frozen.type;
  H.eq(credit.creditFor(unguarded, Date.now()).total, 5000,
    'and without the flag the course path would have credited all 50 EUR — plausibly, and wrongly');

  console.log('\n[3. capacity is a room on one evening, not a term]');
  const seat = (d, st) => ({ sessionDate: d, status: st });
  const tue = R.capacityForDate(dropin, [seat('2026-10-06', 'booked'), seat('2026-10-06', 'attended'),
                                         seat('2026-10-13', 'booked')], '2026-10-06');
  H.eq(tue.capacity, 2, 'the room holds two');
  H.eq(tue.taken, 2, 'and two are coming on the 6th');
  H.eq(R.capacityForDate(dropin, [seat('2026-10-06', 'booked')], '2026-10-13').taken, 0,
    'while the 13th is empty — twenty on Tuesday, not twenty forever');
  H.eq(R.holdsASeat(seat('x', 'cancelled')), false, 'a cancellation frees the place immediately');
  H.eq(R.holdsASeat(seat('x', 'no-show')), false,
    'and a no-show never occupied the room, whatever they still owe for it');
  H.eq(R.capacityForDate({ facts: { groupSize: {} } }, [], '2026-10-06').left, null,
    'a blank group size is uncapped, never zero');

  console.log('\n[4. validate() refuses what is meaningless on a drop-in]');
  H.ok(REG.validateRegistration(Object.assign({}, dropin, {
    registration: Object.assign({}, dropin.registration, { cancellationPolicy: { mode: 'prorated' } })
  })).some((e) => /prorate/i.test(e)), 'a drop-in has no course to prorate, and says so rather than ignoring it');
  H.eq(REG.validateRegistration(dropin).length, 0, 'and is otherwise valid as configured');
  // ⚠ KEYS, NOT SENTENCES. validate() used to answer in English prose, which
  // put one language's copy inside a pure rule module that both a family and an
  // admin call. It names the refusal now and the handler renders it — see
  // _family-errors.js, which holds all three languages.
  H.eq(att.validate(course, '2026-10-14'), 'dropin-only',
    'a course cannot be booked by the evening');
  H.eq(att.validate(dropin, '2026-10-07'), 'not-a-meeting-date',
    'and a date the calendar does not contain is not a session');
  H.ok(!/ /.test(att.validate(course, '2026-10-14')),
    'and what comes back is a key, not a sentence somebody could print');

  console.log('\n[5. FIELD_SCHEMA draws each type its own fields, and keeps the rest]');
  const drawn = (t) => REG.FIELDS.filter((f) => !f.types || f.types.indexOf(t) !== -1).map((f) => f.key);
  H.ok(drawn('dropin').indexOf('sessionCancelHours') !== -1, 'the drop-in draws its per-session window');
  H.ok(drawn('dropin').indexOf('cancellationPolicy.mode') === -1, 'and not the term modes');
  H.ok(drawn('course').indexOf('registrationFeeCutoffDate') !== -1, 'the course draws its cutoffs');

  // THE CONDITIONAL-PANEL TRAP, confirmed still shut. A group the form did not
  // draw is not read back, and "nothing" merged as "cleared" would destroy
  // configured values as a side effect of changing a dropdown — with nobody
  // having typed anything, which is what makes it worse than an ordinary
  // read-back bug.
  const configured = { autoApprove: true, pendingExpiryDays: 7,
                       registrationFeeCutoffDate: '2026-09-30',
                       cancellationPolicy: { mode: 'prorated', cancellationCutoffDate: '2026-11-04' },
                       sessionCancelHours: 24 };
  const switched = REG.mergeRegistration(configured, { autoApprove: false, sessionCancelHours: 12 }, 'dropin');
  H.eq(switched.registrationFeeCutoffDate, '2026-09-30', 'the fee cutoff survives a switch to drop-in');
  H.eq(switched.cancellationPolicy.cancellationCutoffDate, '2026-11-04', 'and so does the hard cutoff');
  H.eq(switched.cancellationPolicy.mode, 'prorated', 'and the mode');
  H.eq(switched.sessionCancelHours, 12, 'while the field it DID draw was applied');
  const back = REG.mergeRegistration(switched, { autoApprove: false }, 'course');
  H.eq(back.sessionCancelHours, 12, 'switching back keeps the drop-in field the course form does not draw');
  // The same protection on the facts, where the two prices live.
  H.eq(REG.keepUndrawnFactKeys('price', { fullPrice: 300, perSessionPrice: 12 },
    { perSessionPrice: 15 }, 'dropin').fullPrice, 300,
    'and the term price survives a drop-in save that never mentioned it');

  // ---------------------------------------------------------- one evening ----
  console.log('\n[cancelling one evening is all or nothing]');
  const start = Date.parse('2026-10-06T19:30:00+03:00');
  const booking = (paid, hours) => ({ frozen: { startsAt: start, cancelHours: hours },
                                      payment: { paidCents: paid } });
  H.eq(credit.creditForSession(booking(1200, 24), start - 48 * HOUR).credit, 1200,
    'two days out, with a 24-hour rule: the whole 12 EUR');
  H.eq(credit.creditForSession(booking(1200, 24), start - 2 * HOUR).credit, 0,
    'two hours out: nothing — no half, no proration, because one evening is not part of anything');
  H.eq(credit.creditForSession(booking(1200, 24), start - 2 * HOUR).mayCancel, true,
    'but they may still cancel — the deadline governs the money, never the ability to say you are not coming');
  H.eq(credit.creditForSession(booking(1200, null), start - 60000).credit, 1200,
    'no stated window is creditable right up to the start — a blank must never read as a restriction');
  H.eq(credit.creditForSession(booking(1200, null), start + 60000).credit, 0, 'and not after it');
  H.eq(credit.creditForSession(booking(0, 24), start - 48 * HOUR).credit, 0,
    'and a family who paid nothing is owed nothing, so no entry is written at all');

  console.log('\n[the times are Asia/Nicosia, resolved the same way the cutoffs are]');
  const frozen = credit.freezeSession(dropin, '2026-10-06');
  H.eq(frozen.startsAt, Date.parse('2026-10-06T19:30:00+03:00'),
    '19:30 local in October is 16:30 UTC — Cyprus is UTC+3 in summer time');
  H.eq(credit.freezeSession(dropin, '2026-12-01').startsAt, null,
    'a date the calendar does not hold has no start time to freeze');
  H.eq(frozen.cancelHours, 24, 'the window is frozen onto the booking');
  H.eq(frozen.perSessionPrice, 12, 'and so is the price, so a rise in March cannot re-bill January');

  // ------------------------------------------------------------ end to end ---
  console.log('\n[through the handlers]');
  const signed = await H.call(auth.handler, {
    action: 'signup', email: 'dana@example.com', password: 'password-123', termsAccepted: true,
    profile: { firstName: 'Dana', preferredLanguage: 'en' } });
  const dana = { token: signed.body.token, accountId: signed.body.account.accountId };
  const kid = async (n) => (await H.call(family.handler, {
    action: 'createParticipant', token: dana.token,
    participant: { firstName: n, dateOfBirth: '2017-04-02' } })).body.participant.participantId;
  const noa = await kid('Noa');
  const ari = await kid('Ari');
  const tal = await kid('Tal');

  const admin = await H.installSession(blobs, H.superAdminSession({ token: 'full', email: 'michal@ogen.cy' }));

  // Booking needs an approved registration behind it: the registration is the
  // "may come" decision and an admin makes it once.
  const early = await H.call(regs.handler, {
    action: 'bookSession', token: dana.token, slug: 'dropin-fixture',
    participantId: noa, sessionDate: '2026-10-06' });
  H.eq(early.status, 409, 'you cannot book an evening before you are registered at all');

  for (const p of [noa, ari, tal]) {
    await H.call(regs.handler, { action: 'submit', token: dana.token, slug: 'dropin-fixture', participantId: p });
  }
  // autoApprove is on for the drop-in fixture, so all three are approved.
  const first = await H.call(regs.handler, {
    action: 'bookSession', token: dana.token, slug: 'dropin-fixture',
    participantId: noa, sessionDate: '2026-10-06' });
  H.eq(first.status, 200, 'an approved participant books an evening');
  H.eq(first.body.session.payment.owedCents, 1200, 'and owes 12 EUR for it');
  H.eq(first.body.session.status, 'booked', 'and holds a place on that date');

  await H.call(regs.handler, { action: 'bookSession', token: dana.token, slug: 'dropin-fixture',
                               participantId: ari, sessionDate: '2026-10-06' });
  const thirdOne = await H.call(regs.handler, { action: 'bookSession', token: dana.token,
    slug: 'dropin-fixture', participantId: tal, sessionDate: '2026-10-06' });
  H.eq(thirdOne.status, 409, 'the third is refused — the room holds two');
  const nextWeek = await H.call(regs.handler, { action: 'bookSession', token: dana.token,
    slug: 'dropin-fixture', participantId: tal, sessionDate: '2026-10-13' });
  H.eq(nextWeek.status, 200, 'but the SAME child gets the next Tuesday, which is a different room');

  console.log('\n[one blob per evening, and nothing contended]');
  const keys = Array.from(blobs._stores.get('session-attendance').keys());
  H.eq(keys.length, 3, 'three bookings, three blobs');
  H.ok(keys.every((k) => /^att-p-[0-9a-f]{16}__act-[0-9a-f]{16}__\d{4}-\d{2}-\d{2}$/.test(k)),
    'keyed participant, then activity, then the date — the date is in the key because a session IS when it happened');
  // The registration was NOT rewritten by any of it, which is the whole reason
  // for a separate store.
  const regStore = blobs._stores.get('registrations');
  H.eq(Array.from(regStore.keys()).length, 3, 'and the three registrations are untouched by the bookings');

  console.log('\n[the register, and marking it]');
  const reg6 = await H.call(adminRegs.handler, {
    action: 'register', token: admin.token, slug: 'dropin-fixture', sessionDate: '2026-10-06' });
  H.eq(reg6.status, 200, 'the admin opens the evening');
  H.eq(reg6.body.register.length, 2, 'and sees who is coming — a list, because they are running the room');
  H.eq(reg6.body.capacity.left, 0, 'with the room full');
  const marked = await H.call(adminRegs.handler, {
    action: 'markAttendance', token: admin.token, participantId: noa,
    activityId: dropin.activityId, sessionDate: '2026-10-06', status: 'no-show' });
  H.eq(marked.status, 200, 'and marks a no-show');
  H.eq(marked.body.session.payment.owedCents, 1200,
    'who still owes for the evening — the status answers "was there room", the payment answers "who pays"');

  console.log('\n[cancelling the registration releases the evenings, one at a time]');
  const held = await H.call(adminRegs.handler, {
    action: 'recordSessionPayment', token: admin.token, participantId: tal,
    activityId: dropin.activityId, sessionDate: '2026-10-13', amountCents: 1200 });
  H.eq(held.body.session.payment.status, 'paid', 'Tal has paid for the 13th');

  const ended = await H.call(regs.handler, {
    action: 'cancel', token: dana.token, participantId: tal, activityId: dropin.activityId });
  H.eq(ended.status, 200, 'the family stops coming');
  H.eq(ended.body.credit.total, 0, 'the registration itself credits nothing — there was no commitment to unwind');
  H.eq(ended.body.sessions.length, 1, 'but the evening they had booked is released');
  H.eq(ended.body.sessions[0].credit, 1200,
    'and the money they paid for it comes back, judged on that evening\'s own deadline');
  H.eq(await ledger.balanceFor(dana.accountId), 1200, 'which is what the ledger says');
  const talRows = await att.forParticipant(tal, dropin.activityId);
  H.eq(talRows[0].status, 'cancelled', 'the booking is cancelled rather than deleted — it is something that happened');

  H.done();
})();
