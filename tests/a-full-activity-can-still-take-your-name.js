// What this defends against:
//
// ⚠ "THIS ACTIVITY IS FULL" WAS THE END OF THE ROAD.
//
// Reported from QA, looking at a term whose three places were held by three
// PENDING registrations that had paid nothing and would go on holding them for
// forty-five days:
//
//     "In cases where we have ppl register, but still not pay and we have
//      someone new that wishes to register, we tell them it's full. I suggest
//      that in such cases, where these registered ppl might not pay or some
//      might pay and cancel, we should have these over-capacity ppl to be added
//      to a waiting list."
//
// The refusal that produced it carried a comment naming exactly what had never
// been built: "a waitlist has to choose who gets a freed place, tell them, and
// give them a deadline before it moves on again, and none of that is decided."
// It is decided now, and this suite is the decisions.
//
//   - EVERYBODY WAITING IS TOLD AT ONCE and the first one back takes it. A
//     sequential offer needs a clock per person, and an evening can free up
//     thirty minutes before the class — there is no time to work down a list.
//     The cost is that most people lose the race, which is answered in the
//     WORDS: the message says out loud that everybody got it and it goes to
//     whoever is first. A fair thing to lose.
//   - A WAITING ENTRY HOLDS NOTHING. That is the property that makes this safe
//     to add at all: capacity is counted and never decremented, so a status the
//     count does not recognise cannot move a number.
//   - ⚠ A PLACE CLAIMED OFF THE LIST IS HELD FOR HOURS, NOT WEEKS. Unpaid holds
//     are the whole reason the queue exists, so handing the claimer the ordinary
//     45-day window would rebuild the problem one layer up. On one evening it is
//     minutes, and never past the start of the class.
//   - TERMS ARE FROZEN WHEN A PLACE IS TAKEN, not when somebody joins a queue.
//     Joining a queue is not agreeing to a price.

const H = require('./_helpers');
const F = require('./_fixtures');

process.env.RESEND_FROM = 'Merkaz Ogen <noreply@ogen.cy>';

(async () => {
  const blobs = H.makeBlobs();

  // One place, so the second family meets the wall the report is about.
  const course = F.course({ slug: 'one-place', activityId: 'act-00000000000w0001' });
  course.groups[0].capacity = 1;
  course.registration.autoApprove = true;

  const dropin = F.dropin({ slug: 'one-seat', activityId: 'act-00000000000w0002' });
  dropin.groups[0].capacity = 1;
  dropin.registration.autoApprove = true;

  const github = H.makeGithub({
    'activities/one-place.json': JSON.stringify(course),
    'activities/one-seat.json': JSON.stringify(dropin)
  });

  const mods = H.loadWithStubs({
    blobs, github,
    modules: ['_registration', '_registration-store', '_session-attendance', '_waitlist',
              'account-auth', 'account-family', 'account-registrations', 'admin-registrations']
  });
  const R = mods['_registration'];
  const store = mods['_registration-store'];
  const attendance = mods['_session-attendance'];
  const auth = mods['account-auth'];
  const family = mods['account-family'];
  const regs = mods['account-registrations'];
  const adminRegs = mods['admin-registrations'];

  // Every message, kept, so "everybody waiting was told" is read rather than
  // assumed.
  const sent = [];
  require(H.fnPath('_email'))._internal.setTransport({
    emails: { send: async (m) => { sent.push(m); return { data: { id: 'x' + sent.length } }; } }
  });
  const since = () => { const n = sent.length; return () => sent.slice(n); };

  // =========================================================================
  console.log('[the rule: a name in a queue is not a place in a room]');

  H.eq(R.holdsASpot({ status: 'waitlisted' }), false,
    '⚠ a waiting entry holds no place, which is why nothing else had to change');
  H.eq(R.isWaiting({ status: 'waitlisted' }), true, 'and it has one word for it');
  H.eq(R.isWaiting({ status: 'pending' }), false, 'that no other status answers to');
  H.ok(R.STATUSES.indexOf('waitlisted') !== -1, 'it is a real status, not a flag on the side');

  // The seat version, which is the one genuinely new counting rule.
  const seat = (over) => Object.assign({ status: 'booked', payment: { paidCents: 0 } }, over || {});
  const at = Date.parse('2026-10-06T17:40:00Z');
  H.eq(R.holdsASeat(seat(), at), true,
    '⚠ an ordinary booking carries no deadline and holds its seat — absent must never read as lapsed');
  H.eq(R.holdsASeat(seat({ claimExpiresAt: '2026-10-06T17:45:00Z' }), at), true,
    'a claim inside its window holds the seat');
  H.eq(R.holdsASeat(seat({ claimExpiresAt: '2026-10-06T17:30:00Z' }), at), false,
    '⚠ and past it stops holding, with no job having run — the seat is free that instant');
  H.eq(R.holdsASeat(seat({ claimExpiresAt: '2026-10-06T17:30:00Z', payment: { paidCents: 700 } }), at), true,
    'unless it was paid for, which is what the deadline existed to make happen');
  H.eq(R.holdsASeat({ status: 'attended', claimExpiresAt: '2020-01-01T00:00:00Z' }, at), true,
    'somebody who came was in the room, whatever any clock says now');
  H.eq(R.holdsASeat({ status: 'waiting' }, at), false, 'and a queued evening holds nothing');

  // ⚠ NEVER PAST THE START. Holding a seat into the lesson keeps the room shut
  // against somebody who could still walk in.
  H.eq(R.sessionClaimDeadline('2026-10-06T18:00:00Z', Date.parse('2026-10-06T17:30:00Z')),
    '2026-10-06T17:45:00.000Z', 'thirty minutes out, the claim runs the full fifteen');
  H.eq(R.sessionClaimDeadline('2026-10-06T18:00:00Z', Date.parse('2026-10-06T17:54:00Z')),
    '2026-10-06T18:00:00.000Z', 'six minutes out, it runs six');

  // =========================================================================
  console.log('\n[end to end: a term with one place and two families]');

  const signUp = async (name) => {
    const s = await H.signUp(auth, blobs, {
      action: 'signup', email: name.toLowerCase() + '@example.com', password: 'password-123',
      termsAccepted: true, profile: { firstName: name, preferredLanguage: 'en' }
    });
    const token = s.body.token;
    const pid = (await H.call(family.handler, {
      action: 'createParticipant', token: token,
      participant: { firstName: name, dateOfBirth: '2017-04-02' }
    })).body.participant.participantId;
    return { token: token, accountId: s.body.account.accountId, pid: pid };
  };
  const dana = await signUp('Dana');
  const rina = await signUp('Rina');
  const yael = await signUp('Yael');

  const sub = (who, slug, opts) => H.call(regs.handler, Object.assign(
    { action: 'submit', token: who.token, slug: slug, participantId: who.pid }, opts || {}));

  const first = await sub(dana, 'one-place');
  H.eq(first.status, 200, 'the first family takes the place');
  H.eq(first.body.registration.status, 'approved', 'and is in');

  const refused = await sub(rina, 'one-place');
  H.eq(refused.status, 409, 'the second is refused');
  H.eq(refused.body.code, 'activity-full', 'because it is full');
  H.eq(refused.body.canWaitlist, true, '⚠ and the refusal now OFFERS something');

  const queued = await sub(rina, 'one-place', { waitlist: true });
  H.eq(queued.status, 200, 'so she joins the waiting list');
  H.eq(queued.body.waiting, true, 'and is told that is what happened');
  H.eq(queued.body.registration.status, 'waitlisted', 'the record says so');
  H.eq(queued.body.registration.payment.owedCents, 0,
    '⚠ owing NOTHING — a queue is not a bill, and an admin roster showing a debt ' +
    'against somebody with no place would be the screen inventing one');
  H.eq(queued.body.registration.expiresAt, null, 'with no deadline, because nothing is being held');
  H.ok(queued.body.registration.waitingSince, 'and the moment they joined, which is the only order a list has');

  const yaelQueued = await sub(yael, 'one-place', { waitlist: true });
  H.eq(yaelQueued.body.registration.status, 'waitlisted', 'a third family joins behind her');

  // The count is the whole argument for the design: adding two names must not
  // move it by one.
  const report = R.capacityReport(course, await store.forActivity(course.activityId));
  H.eq(report.taken, 1, '⚠ and the activity is STILL one of one — two names in a queue moved nothing');
  H.eq(report.left, 0, 'with no place free');

  // =========================================================================
  console.log('\n[a place frees, and everybody waiting hears at once]');

  const watch = since();
  const gone = await H.call(regs.handler, { action: 'cancel', token: dana.token,
    participantId: dana.pid, activityId: course.activityId });
  H.eq(gone.status, 200, 'the first family cancels');

  const blast = watch().filter((m) => /place has opened/i.test(m.subject + m.html));
  H.eq(blast.length, 2, '⚠ BOTH waiting families are told, in the same breath');
  const to = blast.map((m) => m.to).sort();
  H.eq(to.join(','), 'rina@example.com,yael@example.com', 'and they are the two who asked to be');
  H.ok(/first person to take it/i.test(blast[0].html),
    '⚠ AND THE MESSAGE SAYS IT IS A RACE — everybody got this, and it goes to whoever is first');
  H.ok(!/is yours|reserved for you/i.test(blast[0].html),
    'rather than promising a place most of them will not get');

  // =========================================================================
  console.log('\n[the first one back takes it, on a short clock]');

  const took = await sub(yael, 'one-place');
  H.eq(took.status, 200, 'the third family gets there first');
  H.eq(took.body.registration.status, 'approved', 'and has the place');
  H.eq(took.body.registration.expirySource, 'waitlist-claim',
    '⚠ claimed off the list, which the record says rather than the client');
  H.eq(took.body.registration.expiryDays, R.CLAIM_HOURS / 24,
    'so it is held for ' + R.CLAIM_HOURS + ' hours, not the ordinary forty-five days');
  H.ok(Date.parse(took.body.registration.expiresAt) - Date.parse(took.body.registration.submittedAt)
       < 3 * 24 * 3600 * 1000,
    'which is the point: an unpaid claim goes back to the list in days, not weeks');
  // ⚠ CLAIMING IS READ OFF THE RECORD. There is no flag for a hostile client to
  // leave out in order to buy itself the ordinary window.
  H.eq(took.body.registration.waitingSince, null,
    'and the fresh terms are frozen now, because joining a queue is not agreeing to a price');

  const slow = await sub(rina, 'one-place');
  H.eq(slow.status, 409, 'the one who was slower is refused');
  H.eq(slow.body.code, 'activity-full', 'the place having gone');
  H.eq(slow.body.canWaitlist, false,
    '⚠ and is not offered the list again — she is already on it');
  H.eq((await store.getRegistration(rina.pid, course.activityId)).status, 'waitlisted',
    'her place in the queue is untouched by losing a race');

  // =========================================================================
  console.log('\n[leaving the queue is not a cancellation]');

  const left = await H.call(regs.handler, { action: 'leaveWaitlist', token: rina.token,
    participantId: rina.pid, activityId: course.activityId });
  H.eq(left.status, 200, 'she can leave');
  H.eq(left.body.registration.status, 'cancelled', 'and the record is kept rather than deleted');
  H.ok((left.body.registration.history || []).some((h) => /waiting list/.test(h.note || '')),
    'saying what actually happened, for an admin reading it later');
  H.eq(left.body.registration.payment.creditedCents || 0, 0,
    '⚠ with no ledger line: nothing was ever paid, so there is nothing to credit');

  // =========================================================================
  console.log('\n[the admin sees a list, not a sixth kind of queue row]');

  const admin = await H.installSession(blobs, H.superAdminSession({ token: 'full' }));
  await sub(dana, 'one-place', { waitlist: true });
  const queue = await H.call(adminRegs.handler, { action: 'queue', token: admin.token, slug: 'one-place' });
  H.eq(queue.status, 200, 'the roster loads');
  H.eq((queue.body.waiting || []).length, 1, '⚠ waiting is its own list');
  H.eq(queue.body.registrations.some((r) => r.status === 'waitlisted'), false,
    'and nobody waiting is in the table, where every column would be blank');
  H.ok(queue.body.waiting[0].waitingSince, 'each row saying how long they have been there');
  H.eq(queue.body.capacity.taken, 1, 'and the capacity line still counts places, not names');

  // =========================================================================
  console.log('\n[⚠ and a place can be GIVEN, not only raced for]');
  //
  // This file used to say the waiting list gets no controls at all, because "a
  // give this one a place button would be a second, quieter rule running beside
  // the announced race, and the two would disagree the first time somebody used
  // it." The reasoning is right and the conclusion was not, and the case that
  // shows it is the ordinary one: a place opens, everybody is emailed, nobody
  // claims it, and somebody phones instead. The race is what happens when
  // families act. It was never meant to be the only thing that can happen.
  //
  // ⚠ IT IS THE SAME ACT, NOT A SECOND RULE. It goes through the very function
  // a family claiming their own place goes through — which is why that function
  // was lifted out of account-registrations.js into a module both handlers
  // require. The two cannot disagree because there is only one of them.

  // Dana is on the list and the one place is Yael's, so there is nothing to give.
  const noRoom = await H.call(adminRegs.handler, { action: 'givePlace', token: admin.token,
    slug: 'one-place', participantId: dana.pid, activityId: course.activityId });
  H.eq(noRoom.status, 409,
    '⚠ refused while the group is full — an admin handing out a place that does ' +
    'not exist is the disabled full-group option\'s mistake from the other side, ' +
    'and it would put a family in a room with no chair');
  H.eq(noRoom.body.full, true, 'and says which kind of refusal it is');
  H.eq((await store.getRegistration(dana.pid, course.activityId)).status, 'waitlisted',
    'with nothing written: she is still exactly where she was');

  // Yael gives the place back. Everybody waiting is emailed, as always — and
  // nobody comes for it, which is the case this button exists for.
  await H.call(regs.handler, { action: 'cancel', token: yael.token,
    participantId: yael.pid, activityId: course.activityId });

  const gaveWatch = since();
  const gave = await H.call(adminRegs.handler, { action: 'givePlace', token: admin.token,
    slug: 'one-place', participantId: dana.pid, activityId: course.activityId });
  H.eq(gave.status, 200, 'now it goes through');
  H.eq(gave.body.registration.status, 'approved', 'and she has the place');

  const given = await store.getRegistration(dana.pid, course.activityId);
  H.eq(given.status, 'approved', 'on the record, not only in the answer');
  H.eq(given.expirySource, 'waitlist-claim',
    '⚠ THE SAME SHORT HOLD a family claiming their own place gets — unpaid holds ' +
    'are the whole reason the queue exists, so a place handed over cannot carry ' +
    'the ordinary open-ended window');
  H.eq(given.expiryDays, R.CLAIM_HOURS / 24,
    'measured in hours (' + R.CLAIM_HOURS + '), not the ordinary forty-five days');
  H.eq(given.waitingSince, null,
    '⚠ and the terms are re-frozen NOW. Joining a queue is not agreeing to a ' +
    'price, so a family who waited from September is quoted today\'s');
  H.ok(given.frozen && given.frozen.price,
    'which means a whole frozen block, rebuilt — not the one from the day she queued');

  // `to` arrives as an array from _email.js, which is why this concats.
  const told = gaveWatch().filter((m) => [].concat(m.to)[0] === 'dana@example.com');
  H.ok(told.length >= 1, 'and the family is written to: ' + (told[0] || {}).subject);

  // ⚠ ASKED OF THE RECORD, NOT OF THE REQUEST. Pressing it twice, or pressing it
  // on somebody who got there first, must not open a second registration.
  const twice = await H.call(adminRegs.handler, { action: 'givePlace', token: admin.token,
    slug: 'one-place', participantId: dana.pid, activityId: course.activityId });
  H.eq(twice.status, 409, 'a second press is refused');
  H.ok(/not waiting/.test(twice.body.error || ''), 'because that row is not waiting any more');

  // The same axis as approving, because it IS approving: it decides that a
  // family may come. A role that may read the queue and not decide on it cannot.
  const reader = await H.installSession(blobs, H.superAdminSession({
    token: 'reader', email: 'reader@ogen.cy', role: 'reader', roleName: 'Queue reader',
    permissions: { registrations: { access: true, approve: false, cancel: false } }
  }));
  const refusedRole = await H.call(adminRegs.handler, { action: 'givePlace', token: reader.token,
    slug: 'one-place', participantId: yael.pid, activityId: course.activityId });
  H.eq(refusedRole.status, 403, 'a role without `approve` is refused');

  // =========================================================================
  console.log('\n[an evening, where the queue has minutes rather than days]');

  // A drop-in fills up one evening at a time — the room holds one on Tuesday,
  // not one forever — so the queue is per date. Waiting for the 6th says nothing
  // about the 13th.
  const DATE = '2026-10-06';
  const OTHER = '2026-10-13';
  await sub(dana, 'one-seat');
  await sub(rina, 'one-seat');
  const book = (who, date, opts) => H.call(regs.handler, Object.assign(
    { action: 'bookSession', token: who.token, participantId: who.pid,
      slug: 'one-seat', sessionDate: date }, opts || {}));

  H.eq((await book(dana, DATE)).status, 200, 'the first family books the evening');
  const fullNight = await book(rina, DATE);
  H.eq(fullNight.status, 409, 'the second finds it full');
  H.eq(fullNight.body.code, 'evening-full', 'on that evening');
  H.eq(fullNight.body.canWaitlist, true, 'and is offered the queue for it');

  const nightWatch = since();
  const inQueue = await book(rina, DATE, { waitlist: true });
  H.eq(inQueue.status, 200, 'she joins it');
  H.eq(inQueue.body.attendance.status, 'waiting', 'and is waiting rather than booked');
  H.eq(inQueue.body.attendance.payment.owedCents, 0, 'owing nothing for a seat she does not have');
  H.eq(inQueue.body.attendance.claimExpiresAt, null, 'with no clock running, because nothing is held');
  H.eq(R.capacityForDate(dropin, await attendance.forActivity(dropin.activityId, DATE), DATE).taken, 1,
    '⚠ and the evening is still one of one');
  const ack = nightWatch().filter((m) => /waiting list/i.test(m.subject));
  H.eq(ack.length, 1, 'she is told she is on it');
  H.ok(/6 October/.test(ack[0].html),
    '⚠ naming the EVENING, and in her own language — the date is formatted by the ' +
    'message rather than by a handler, whose language is the language of a page');

  // The other evening is a different room and a different queue.
  H.eq((await book(rina, OTHER)).status, 200,
    'and the queue for one evening does not stop her booking another');

  const seatWatch = since();
  const freed = await H.call(regs.handler, { action: 'cancelSession', token: dana.token,
    participantId: dana.pid, activityId: dropin.activityId, sessionDate: DATE });
  H.eq(freed.status, 200, 'the first family gives the evening back');
  const nightBlast = seatWatch().filter((m) => /place has opened/i.test(m.subject));
  H.eq(nightBlast.length, 1, 'and the one person waiting for THAT evening is told');
  H.ok(/6 October/.test(nightBlast[0].html), 'which evening it was');

  const claimed = await book(rina, DATE);
  H.eq(claimed.status, 200, 'she takes it');
  H.eq(claimed.body.session.status, 'booked', 'and is booked');
  H.ok(claimed.body.session.claimExpiresAt,
    '⚠ ON A CLOCK — a seat taken off a queue is held only until it is paid for, ' +
    'or the unpaid holds this feature exists to fix come back one layer down');
  H.ok(Date.parse(claimed.body.session.claimExpiresAt) - Date.now() <= R.CLAIM_MINUTES * 60 * 1000 + 1000,
    'measured in minutes rather than days, because the class may be tonight');
  // And an ordinary booking — one nobody queued for — carries no clock at all.
  // A third evening, because Rina took the second one above and each holds one.
  H.eq((await book(dana, '2026-10-20')).body.session.claimExpiresAt, null,
    '⚠ while an ordinary booking carries none, so absent cannot read as lapsed');

  H.done();
})();
