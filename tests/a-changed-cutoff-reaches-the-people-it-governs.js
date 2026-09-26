// What this defends against:
//
// TWO GAPS REPORTED TOGETHER, both about a publish not reaching the people
// already registered.
//
// ⚠ 1. A CHANGED CUTOFF GOVERNED NOBODY WHO WAS ALREADY REGISTERED.
//
// Reported as "if we change the cut-off date it should be a new update to the
// rules, and those that registered before should get an email that updates them
// on this change" — after an admin moved a cancellation cutoff, watched the
// family's page go on showing the old date, and read it as staleness.
//
// It was not staleness, and that is what made it confusing: the terms are frozen
// onto the registration at submission precisely so an admin's later edit cannot
// rewrite what a family agreed to. The activity said 30 September, the family's
// page said 24 September, and both were correct. What did not exist was any way
// to make the change apply on purpose, or any screen saying that it had not.
//
// ⚠ IT MOVES IN BOTH DIRECTIONS, AND THAT WAS THE DECISION RATHER THAN THE
// DEFAULT. A later cutoff gives a family more than they agreed to. An EARLIER one
// takes credit rights away from somebody who has already accepted the old terms,
// which under EU unfair-terms law (93/13/EEC, as implemented in Cyprus) is liable
// to be unenforceable against them whatever this code writes. The narrower rule —
// apply it only where it helps them — was offered and declined. So this suite
// pins BOTH directions, and pins the compensating controls that are the reason
// the direction is safe to leave unfiltered: the family is always emailed, and
// the dates they used to hold stay in the registration's own history.
//
// ⚠ AND THE TRIGGER IS THE STORED FIELD, NOT THE RESOLVED DATE. resolveCutoffs()
// computes a default off the group's calendar when nobody set one, so comparing
// resolved dates would read an excluded holiday as a policy change and mail a
// family about nothing several times a term. That is the same silent
// re-evaluation basisChanged() exists to refuse, and there is a test for it here.
//
// ⚠ 2. RAISING A GROUP'S CAPACITY OPENED PLACES AND TOLD NOBODY.
//
// Reported as "if a group has a limit of 3 and we have 2 on the waiting list, we
// change the cap to 5 — what happens? 2 new spaces should appear and the email
// should fire, same as when a client cancels their seat." The places appeared
// (capacity is counted, never decremented) and the announcement did not: a freed
// place was announced from five events, and all five live in the registrations
// domain. Raising a limit is the sixth and it happens on the activities form.
//
// ⚠ AND IT IS DECIDED BY ASKING hasRoom() TWICE, not by comparing two numbers. A
// cap raised from 3 to 4 with five people registered is still full, and a number
// comparison would announce a place that does not exist.
//
// ⚠ 3. THE ANNOUNCEMENT IS SCOPED TO THE GROUP, which it never was. Under the
// equal-hours rule two groups may meet on a different day, at a different hour,
// in a different place, with different teachers — so a place freed in Beginners
// is not a place for a family waiting on Advanced. Sent activity-wide they were
// told to come and take it, pressed the button, and were refused, because the
// claim posts `submit` with THEIR groupId, which is still full. Fixed for the new
// caller and for the four that already existed, or "same behaviour as a
// cancellation" would have been two different behaviours.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');
const F = require('./_fixtures');

process.env.RESEND_FROM = 'Merkaz Ogen <noreply@ogen.cy>';

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const REG = require(H.fnPath('_activity-registration'));
const RR = require(H.fnPath('_registration'));

const AID = 'act-0000000000000c01';
const G1 = 'grp-one';
const G2 = 'grp-two';

// A two-group course. Equal total hours, different days — the shape the whole
// group model exists for, and the shape that makes an activity-wide announcement
// wrong.
function twoGroups(overrides) {
  const base = F.course({
    slug: 'term', activityId: AID,
    registration: Object.assign({
      autoApprove: true, pendingExpiryDays: null,
      registrationFeeCutoffDate: '2026-09-30',
      cancellationPolicy: { mode: 'flat', cancellationCutoffDate: '2026-10-28' },
      defaultBasis: null
    }, (overrides || {}).registration || {})
  });
  const dates = (list) => list.map((d) => ({ date: d, status: 'scheduled' }));
  base.groups = [
    { groupId: G1, name: { he: 'א', en: 'One', ru: 'Один' }, capacity: 3, teacherIds: [],
      facts: { schedule: { frequency: 'weekly', sessions: [{ day: 'monday', time: '16:00' }] },
        duration: { startDate: '2026-10-05', endDate: '2026-11-30', sessionMinutes: 60,
          sessionDates: dates(['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']) } } },
    { groupId: G2, name: { he: 'ב', en: 'Two', ru: 'Два' }, capacity: 3, teacherIds: [],
      facts: { schedule: { frequency: 'weekly', sessions: [{ day: 'wednesday', time: '18:00' }] },
        duration: { startDate: '2026-11-04', endDate: '2026-12-30', sessionMinutes: 120,
          sessionDates: dates(['2026-11-04', '2026-11-11']) } } }
  ];
  if (overrides && overrides.caps) {
    base.groups[0].capacity = overrides.caps[0];
    base.groups[1].capacity = overrides.caps[1];
  }
  return base;
}

const cut = (a) => a.registration.cancellationPolicy.cancellationCutoffDate;
const frozenOf = (reg) => reg.frozen.cancellation;
// ⚠ THE CLOSING DATE IS THE LAST STEP OF THE REFUND SCHEDULE NOW, not a field of
// its own — a closing date beside a table of steps is two fields that can
// contradict each other. closingOf() is the one translation, and it answers for a
// block frozen before the schedule existed as well as one frozen after, which is
// why this suite reads through it rather than reaching for a key.
const credit = require(H.fnPath('_credit'));
const closesOn = (reg) => credit.closingOf(frozenOf(reg));
// The percentages, which a publish deliberately does NOT move.
const shapeOf = (reg) => credit.tiersFrom(frozenOf(reg)).map((t) => t.percent).join(',');
// The closing date an ADMIN set, written where it now lives: the last step of the
// schedule. These assertions are about the three states of that one value — a
// date, "none", and never-configured — and all three still mean what they meant;
// only the key they are written under has moved.
const setClose = (a, v) => {
  const list = a.registration.cancellationPolicy.tiers;
  list[list.length - 1].until = v;
};
// What the TRANSPORT was handed: _email.js wraps `to` in an array on the way to
// Resend, so a suite comparing it to a string silently matches nothing.
const rcpt = (m) => [].concat(m.to)[0];

(async () => {
  // ⚠ THE HARNESS COMES FIRST. This module reaches the registration store, so
  // requiring it before the stubs are installed binds the real Blobs — which is
  // how the first draft of this suite failed with "store unavailable" while every
  // pure assertion above it passed.
  const blobs = H.makeBlobs();
  const activity = twoGroups();
  const github = H.makeGithub({
    'activities/term.json': JSON.stringify(activity),
    'activities/activities-index.json': JSON.stringify(
      [{ slug: 'term', activityId: AID, status: 'open', langs: ['he', 'en', 'ru'],
         title: activity.title }])
  });
  const mods = H.loadWithStubs({ blobs, github,
    modules: ['_registration-store', '_registration-fallout', '_waitlist', 'account-auth',
              'account-family', 'account-registrations', '_registration-email'] });
  const store = mods['_registration-store'];
  const fallout = mods['_registration-fallout'];
  const live = fallout;
  const wl = mods['_waitlist'];
  const auth = mods['account-auth'];
  const family = mods['account-family'];
  const api = mods['account-registrations'];

  const sent = [];
  require(H.fnPath('_email'))._internal.setTransport({
    emails: { send: async (m) => { sent.push(m); return { data: { id: 'e-' + sent.length } }; } }
  });

  // =========================================================================
  console.log('[the trigger is the field an admin touched, not the date it resolves to]');
  const before = twoGroups();

  H.ok(!fallout.cutoffFieldsMoved(before, twoGroups()),
    'an identical republish has moved nothing');
  H.ok(!fallout.cutoffFieldsMoved(null, before),
    '⚠ and a FIRST publish has moved nothing — there was nothing agreed to move from');

  const later = twoGroups();
  setClose(later, '2026-11-10');
  H.ok(fallout.cutoffFieldsMoved(before, later), 'a changed cancellation cutoff has');
  const feeMoved = twoGroups();
  feeMoved.registration.registrationFeeCutoffDate = '2026-09-01';
  H.ok(fallout.cutoffFieldsMoved(before, feeMoved), 'and so has a changed fee cutoff');

  // The three states of a cutoff field are genuinely three, and switching one OFF
  // is as much a change as moving it.
  const off = twoGroups();
  setClose(off, 'none');
  H.ok(fallout.cutoffFieldsMoved(before, off), '"none" is a change, not a blank');
  const cleared = twoGroups();
  setClose(cleared, null);
  H.ok(fallout.cutoffFieldsMoved(before, cleared),
    'and clearing it back to computed is a change too');
  H.ok(fallout.cutoffFieldsMoved(off, cleared),
    '⚠ "switched off" and "never configured" are not the same value');

  // ⚠ THE CASE THAT WOULD HAVE MAILED EVERYBODY ABOUT NOTHING, and it has to be
  // built on an activity whose cutoffs were NEVER SET. A stored date wins in
  // resolveCutoffs(), so on an activity that has one the resolved date does not
  // move either and the assertion proves nothing — the first draft of this suite
  // made exactly that mistake and passed with the rule reverted.
  //
  // With both fields null the dates are COMPUTED from the group's calendar, so
  // excluding a holiday genuinely moves them. thirtyPercentPoint() counts
  // sessions, and minusDays() counts back from the start date. Both are the
  // ordinary business of running a term, and neither is a change of policy.
  const unset = twoGroups();
  unset.registration.registrationFeeCutoffDate = null;
  setClose(unset, null);
  const firstGroup = unset.groups[0].groupId;

  const holiday = JSON.parse(JSON.stringify(unset));
  holiday.groups[0].facts.duration.sessionDates[1].status = 'excluded';
  H.ok(REG.resolveCutoffs(holiday, firstGroup).cancellationCutoffDate !==
       REG.resolveCutoffs(unset, firstGroup).cancellationCutoffDate,
    'excluding a session really does move the computed cutoff (so the check below bites)');
  H.ok(!fallout.cutoffFieldsMoved(unset, holiday),
    '⚠ and a calendar edit is still NOT a policy change — the formula must never ' +
    're-evaluate itself, which is the rule basisChanged() exists to keep');

  const cal = JSON.parse(JSON.stringify(unset));
  cal.groups[0].facts.duration.startDate = '2026-10-19';
  H.ok(REG.resolveCutoffs(cal, firstGroup).registrationFeeCutoffDate !==
       REG.resolveCutoffs(unset, firstGroup).registrationFeeCutoffDate,
    'a postponed start really does move the computed fee cutoff');
  H.ok(!fallout.cutoffFieldsMoved(unset, cal), 'and that is not a policy change either');

  // =========================================================================
  console.log('\n[which groups went from full to having room]');
  // Two people in group one, which holds three.
  const regsFor = (g1, g2) => []
    .concat(Array.from({ length: g1 }, (_, i) => ({ participantId: 'a' + i, groupId: G1, status: 'approved' })))
    .concat(Array.from({ length: g2 }, (_, i) => ({ participantId: 'b' + i, groupId: G2, status: 'approved' })));
  const now = Date.parse('2026-09-25T09:00:00Z');

  const full3 = twoGroups({ caps: [3, 3] });
  const to5 = twoGroups({ caps: [5, 3] });
  H.eq(fallout.roomOpened(full3, to5, regsFor(3, 3), now).length, 1,
    'a full group whose cap goes 3 -> 5 has reopened');
  H.eq(fallout.roomOpened(full3, to5, regsFor(3, 3), now)[0].groupId, G1,
    'and it is named — one group, not the activity');

  // ⚠ THE NUMBER WENT UP AND NOTHING OPENED. Five registered against a cap of
  // three is over capacity; raising it to four is still full, and a comparison of
  // capacities would have announced a place nobody can take.
  const to4 = twoGroups({ caps: [4, 3] });
  H.eq(fallout.roomOpened(full3, to4, regsFor(5, 3), now).length, 0,
    '⚠ 3 -> 4 with five registered opens nothing, because there is still no room');
  H.eq(fallout.roomOpened(full3, to4, regsFor(3, 3), now).length, 1,
    'while 3 -> 4 with three registered opens one');

  // Neither direction of nothing-to-say.
  H.eq(fallout.roomOpened(full3, twoGroups({ caps: [2, 3] }), regsFor(3, 3), now).length, 0,
    'lowering a cap opens nothing');
  H.eq(fallout.roomOpened(full3, full3, regsFor(1, 1), now).length, 0,
    'and a group that was never full has not "reopened"');
  H.eq(fallout.roomOpened(full3, to5, regsFor(1, 1), now).length, 0,
    'raising the cap on a group with room is not news either');

  // A drop-in's registrations are not capped by the room at all — capacity is per
  // evening — so there is no activity-level place to open.
  const dropA = F.dropin({ slug: 'd', activityId: 'act-0000000000000d01' });
  H.eq(fallout.roomOpened(dropA, dropA, [], now).length, 0, 'and a drop-in has no such event');

  // The cheap pre-check, so an ordinary publish costs no store read.
  H.ok(!fallout.roomOpenedPossible(full3, twoGroups({ caps: [3, 3] })),
    'an unchanged capacity needs no registrations read at all');
  H.ok(fallout.roomOpenedPossible(full3, to5), 'a changed one does');

  // =========================================================================
  console.log('\n[executed: the cutoff moves LATER and the family is told]');
  // Two families. Dana reads Russian, so the message that goes to her has to be
  // in HERS rather than in whatever language the admin's screen is in.
  const dana = await H.signUp(auth, blobs, { email: 'dana@example.com',
    profile: { firstName: 'Dana', preferredLanguage: 'ru' } });
  const yossi = await H.signUp(auth, blobs, { email: 'yossi@example.com',
    profile: { firstName: 'Yossi', preferredLanguage: 'en' } });

  async function register(up, name, groupId) {
    const made = await H.call(family.handler, { action: 'createParticipant', token: up.body.token,
      participant: { firstName: name, lastName: 'Levi', dateOfBirth: '2017-04-02' } });
    const pid = made.body.participant.participantId;
    const res = await H.call(api.handler, { action: 'submit', token: up.body.token, slug: 'term',
      participantId: pid, groupId: groupId, lang: 'en' });
    H.eq(res.status, 200, name + ' is registered to ' + groupId);
    return pid;
  }
  const noa = await register(dana, 'Noa', G1);
  const gil = await register(yossi, 'Gil', G2);

  const noaFirst = frozenOf(await store.getRegistration(noa, AID));
  const gilFirst = frozenOf(await store.getRegistration(gil, AID));
  H.eq(credit.closingOf(noaFirst), '2026-10-28', 'Noa froze the stored closing date');
  H.eq(credit.closingOf(gilFirst), '2026-10-28', 'and so did Gil');

  sent.length = 0;
  const moved = twoGroups();
  moved.registration.cancellationPolicy.tiers[1].until = '2026-11-20';
  // ⚠ AND THE SAME PUBLISH MOVES THE MODE AND THE CALENDAR, deliberately. Without
  // that, re-freezing the WHOLE block produces a byte-identical mode and session
  // list and the two assertions below are vacuous — which is how the first draft
  // of this suite passed with the narrowing reverted. An admin genuinely does
  // switch flat to prorated and exclude a holiday in the same sitting.
  // ⚠ AND THE PERCENTAGES MOVE IN THE SAME PUBLISH. This used to switch the MODE
  // from flat to prorated, which is the same rule stated in the old vocabulary:
  // what creditFor() applies to the course half is frozen terms, and a publish may
  // not rewrite it. Here the second step goes from 50% to prorated, so a
  // propagation that carried the schedule across would be visible below.
  moved.registration.cancellationPolicy.tiers[1].percent = 'remaining';
  moved.groups[0].facts.duration.sessionDates[3].status = 'excluded';
  const out1 = await live.afterPublish(moved, activity);
  H.ok(out1, 'the publish had something to do');
  H.eq(out1.terms.changed, 2, 'both live registrations moved to the new date');
  H.eq(out1.terms.emailed, 2, 'and both families were emailed');
  H.eq(out1.terms.failed.length, 0, 'with nothing failing');
  H.eq(closesOn(await store.getRegistration(noa, AID)), '2026-11-20',
    'the frozen block on the record now carries the new closing date');
  H.eq(frozenOf(await store.getRegistration(noa, AID)).registrationFeeCutoffDate, '2026-09-30',
    '⚠ and the fee cutoff, which nobody touched, is untouched');

  // ⚠ ONLY THE TWO DATES. The mode and the frozen session list are what
  // creditFor() divides by, and rewriting them here would re-price a term.
  const noaNow = frozenOf(await store.getRegistration(noa, AID));
  H.eq(shapeOf(await store.getRegistration(noa, AID)), '100,50',
    '⚠ and still holds 100 then 50, though the activity now says prorated — the ' +
    'percentages are what creditFor() applies, and rewriting them would re-price her term');
  H.eq(noaFirst.sessionStartsAt.length, 4, 'she was sold four sessions');
  H.eq(noaNow.sessionStartsAt.length, 4,
    '⚠ and still holds four, though one has since been excluded — that list is the ' +
    'DENOMINATOR of a prorated credit');
  H.eq(JSON.stringify(noaNow.sessionStartsAt), JSON.stringify(noaFirst.sessionStartsAt),
    'unchanged entry for entry');

  console.log('\n[the message is in the language of the ACCOUNT, and names the new date]');
  H.eq(sent.length, 2, 'one message each');
  const toDana = sent.filter((m) => rcpt(m) === 'dana@example.com')[0];
  const toYossi = sent.filter((m) => rcpt(m) === 'yossi@example.com')[0];
  H.ok(toDana && /[Ѐ-ӿ]/.test(toDana.subject), 'Dana is written to in Russian');
  H.ok(toYossi && /cancellation terms/i.test(toYossi.subject), 'and Yossi in English');
  H.ok(/20 November 2026/.test(toYossi.html),
    '⚠ the message carries the NEW date — it is built from the updated frozen block');
  H.ok(!/28 October 2026/.test(toYossi.html), 'and not the one it replaced');
  H.ok(/20 ноября 2026/.test(toDana.html), 'the Russian formats the date in Russian');
  // ⚠ IT MUST NOT CLAIM THE CHANGE IS GOOD NEWS. It can move either way, and a
  // message saying "you now have longer" would be false for half its readers.
  H.ok(!/more time|longer|extended/i.test(toYossi.html),
    'and never claims the family has gained time');
  H.ok(/earlier or later/i.test(toYossi.html),
    'it says plainly that the dates may be earlier or later');

  console.log('\n[executed: and EARLIER, which is the direction that takes something away]');
  sent.length = 0;
  const earlier = twoGroups();
  setClose(earlier, '2026-10-06');
  const out2 = await live.afterPublish(earlier, moved);
  H.eq(out2.terms.changed, 2, '⚠ an earlier cutoff moves the same records');
  H.eq(out2.terms.emailed, 2, 'and the same families are told');
  H.eq(closesOn(await store.getRegistration(noa, AID)), '2026-10-06',
    'the record now holds a deadline earlier than the one it was taken under');

  // ⚠ THE OLD DATES SURVIVE IN THE HISTORY. "The record says 6 October" is not an
  // answer to a family who was quoted 28 October, and this is the only place the
  // question can be answered from.
  const hist = (await store.getRegistration(noa, AID)).history
    .filter((h) => h.action === 'terms-changed');
  H.eq(hist.length, 2, 'both changes are in the history');
  H.ok(/2026-10-28/.test(hist[0].note), 'the first names the date it moved away from');
  H.ok(/2026-11-20/.test(hist[1].note), 'and the second names the one before it');
  H.ok(hist.every((h) => h.by === 'system'),
    'attributed to the system rather than to whoever happened to press Publish');
  // And nothing pretended a decision was retaken.
  const all = (await store.getRegistration(noa, AID)).history.map((h) => h.action);
  H.eq(all.filter((a) => a === 'approved').length, 0,
    '⚠ written by hand rather than through transition() — a history saying "approved" ' +
    'twice reads as an approval that happened twice');

  console.log('\n[it is asked PER GROUP, so each group keeps its own computed default]');
  // Clear the stored cutoff. The two groups meet four times and twice, from
  // different start dates, so resolveCutoffs() answers differently for each —
  // which is the whole reason the freeze is per group.
  sent.length = 0;
  const computed = twoGroups();
  setClose(computed, null);
  computed.registration.registrationFeeCutoffDate = null;
  const out3 = await live.afterPublish(computed, earlier);
  H.eq(out3.terms.changed, 2, 'both moved to their computed defaults');
  const noaC = frozenOf(await store.getRegistration(noa, AID));
  const gilC = frozenOf(await store.getRegistration(gil, AID));
  H.eq(credit.closingOf(noaC), REG.resolveCutoffs(computed, G1).cancellationCutoffDate,
    'Noa got group one\'s answer');
  H.eq(credit.closingOf(gilC), REG.resolveCutoffs(computed, G2).cancellationCutoffDate,
    'and Gil got group two\'s');
  H.ok(credit.closingOf(noaC) !== credit.closingOf(gilC),
    '⚠ which are DIFFERENT DATES — one activity-level answer would have governed ' +
    'the other group\'s families, plausibly and silently');
  H.ok(noaC.registrationFeeCutoffDate !== gilC.registrationFeeCutoffDate,
    'and the fee cutoff is per group too, off each group\'s own start date');

  console.log('\n[nothing to do is nothing done]');
  sent.length = 0;
  const again = JSON.parse(JSON.stringify(computed));
  H.eq(await live.afterPublish(again, computed), null,
    '⚠ an ordinary republish does not even read the registrations');
  H.eq(sent.length, 0, 'and mails nobody');
  // Idempotent: the same change applied twice finds the second pass has nothing
  // left, because it compares frozen against resolved rather than trusting a flag.
  const twice = twoGroups();
  setClose(twice, '2026-12-01');
  twice.registration.registrationFeeCutoffDate = '2026-09-30';
  await live.afterPublish(twice, computed);
  sent.length = 0;
  const third = await live.afterPublish(twice, computed);
  H.eq(third.terms.changed, 0,
    '⚠ re-running the same change changes nothing — which is what makes a failed ' +
    'pass safe to finish on the next publish');
  H.eq(sent.length, 0, 'and sends no second copy of the same news');

  console.log('\n[a record that holds no terms is left alone]');
  // A waitlisted record's terms are rebuilt the moment a place is actually taken,
  // and a cancelled one's are spent. Mailing either about a cancellation deadline
  // would be describing something they do not hold.
  const waiting = await register(yossi, 'Ari', G2);
  const wreg = await store.getRegistration(waiting, AID);
  await store.saveRegistration(Object.assign({}, wreg, { status: 'waitlisted' }));
  const dreg = await store.getRegistration(gil, AID);
  await store.saveRegistration(Object.assign({}, dreg, { status: 'cancelled' }));
  sent.length = 0;
  // Captured rather than written down: what matters is that these two do not
  // move, not what they happen to hold.
  const heldWaiting = frozenOf(await store.getRegistration(waiting, AID)).cancellationCutoffDate;
  const heldCancelled = frozenOf(await store.getRegistration(gil, AID)).cancellationCutoffDate;
  const shifted = twoGroups();
  setClose(shifted, '2026-12-20');
  const out4 = await live.afterPublish(shifted, twice);
  H.eq(out4.terms.changed, 1, 'only the live registration moved');
  H.eq(sent.length, 1, 'and only that family heard');
  H.eq(frozenOf(await store.getRegistration(waiting, AID)).cancellationCutoffDate, heldWaiting,
    'the waitlisted record still holds what it held');
  H.eq(frozenOf(await store.getRegistration(gil, AID)).cancellationCutoffDate, heldCancelled,
    'and so does the cancelled one');
  H.eq(RR.LIVE_STATUSES.join(','), 'pending,approved',
    'read from the module rather than listed here, so a sixth status inherits the rule');

  // =========================================================================
  console.log('\n[executed: raising a cap tells the queue, and only its own queue]');
  // Fill group one to its cap of three and put two people on its waiting list;
  // put one on group two's, which must hear nothing.
  const capped = twoGroups({ caps: [3, 3] });
  github._files.set('activities/term.json', JSON.stringify(capped));
  const waiters = [];
  for (const [name, group] of [['W1', G1], ['W2', G1], ['X1', G2]]) {
    const up = await H.signUp(auth, blobs, { email: name.toLowerCase() + '@example.com',
      profile: { firstName: name, preferredLanguage: 'en' } });
    const made = await H.call(family.handler, { action: 'createParticipant', token: up.body.token,
      participant: { firstName: name, lastName: 'Levi', dateOfBirth: '2017-04-02' } });
    const pid = made.body.participant.participantId;
    await H.call(api.handler, { action: 'submit', token: up.body.token, slug: 'term',
      participantId: pid, groupId: group, waitlist: true, lang: 'en' });
    const rec = await store.getRegistration(pid, AID);
    await store.saveRegistration(Object.assign({}, rec,
      { status: 'waitlisted', groupId: group, waitingSince: '2026-09-0' + waiters.length + 'T00:00:00Z' }));
    waiters.push({ name, pid, group, email: name.toLowerCase() + '@example.com' });
  }
  // Three approved in group one, which is its cap.
  const holders = [];
  for (const name of ['H1', 'H2', 'H3']) {
    const up = await H.signUp(auth, blobs, { email: name.toLowerCase() + '@example.com',
      profile: { firstName: name, preferredLanguage: 'en' } });
    const made = await H.call(family.handler, { action: 'createParticipant', token: up.body.token,
      participant: { firstName: name, lastName: 'Levi', dateOfBirth: '2017-04-02' } });
    const pid = made.body.participant.participantId;
    const rec = Object.assign({}, await store.getRegistration(noa, AID), {
      participantId: pid, accountId: up.body.account.accountId,
      groupId: G1, status: 'approved', history: []
    });
    await store.saveRegistration(rec);
    holders.push(pid);
  }
  const regsNow = await store.forActivity(AID);
  const report = RR.capacityReport(capped, regsNow, Date.now());
  H.ok(!RR.hasRoom(report, G1), 'group one is genuinely full before the change');

  sent.length = 0;
  const raised = twoGroups({ caps: [5, 3] });
  const out5 = await live.afterPublish(raised, capped);
  H.eq(out5.room.groups.length, 1, 'one group reopened');
  H.eq(out5.room.groups[0].groupId, G1, 'and it is the one whose cap moved');
  H.eq(out5.room.told, 2, '⚠ both families waiting for THAT group were told');
  const heard = sent.map(rcpt).sort();
  H.eq(heard.join(','), 'w1@example.com,w2@example.com',
    '⚠ and group two\'s queue heard nothing — a place there is a different day, ' +
    'a different room and a different teacher');
  H.ok(sent.every((m) => /place/i.test(m.subject) || /Test/i.test(m.subject)),
    'the message they got is the place-open one');
  H.eq(out5.terms.changed, 0, 'and no cutoff moved, because none was touched');

  // ⚠ RAISING IT AGAIN WHEN IT IS STILL FULL SAYS NOTHING. Five approved against
  // a cap of five, raised to six, is one place — but five against a cap of five
  // raised to five is not.
  sent.length = 0;
  H.eq((await live.afterPublish(twoGroups({ caps: [5, 3] }), raised)), null,
    'republishing the same capacity is not an event');
  H.eq(sent.length, 0, 'and tells nobody twice');

  // =========================================================================
  console.log('\n[the four announcements that already existed are scoped too]');
  // Otherwise "the same behaviour as when a client cancels their seat" would have
  // been two different behaviours, and the older one the wrong one.
  H.eq(wl.placeOpened.length, 2, 'placeOpened takes a group');
  [['account-registrations.js', /waitlist\.placeOpened\(reg\.activityId, reg\.groupId/],
   ['admin-registrations.js', /waitlist\.placeOpened\(body\.activityId,\s*\n?\s*out\.payload\.registration\.groupId/],
   ['admin-registrations.js', /waitlist\.placeOpened\(body\.activityId, reg\.groupId/]].forEach(([f, re]) => {
    H.ok(re.test(read('netlify/functions/' + f)), f + ' passes the group (' + re.source.slice(0, 40) + ')');
  });
  const sweep = read('netlify/functions/_registration-sweep.js');
  H.ok(/placeOpened\(f\.activityId, f\.groupId\)/.test(sweep), 'and so does the nightly sweep');
  H.ok(/freed = new Map\(\)/.test(sweep),
    '⚠ keyed by group rather than by activity, or three lapsed holds in one group ' +
    'would announce to another');

  // Executed, both ways: the narrowing has to actually narrow, and a waiter with
  // no group at all must still be told.
  // Counted off the store rather than written down, because the sections above
  // put a waiting record in group two as well and a literal here would pin this
  // suite's own fixture instead of the narrowing.
  const waitingNow = (await store.forActivity(AID)).filter(RR.isWaiting);
  const inG2 = waitingNow.filter((r) => r.groupId === G2).length;
  const inG1 = waitingNow.filter((r) => r.groupId === G1).length;
  H.ok(inG1 > 0 && inG2 > 0 && inG1 + inG2 === waitingNow.length,
    'both queues have somebody on them, and nobody is unassigned');
  sent.length = 0;
  H.eq((await wl.placeOpened(AID, G2)).told, inG2, 'group two\'s own queue is reachable');
  const told2 = sent.map(rcpt).sort();
  H.eq(told2.length, inG2, 'one message per family on that queue');
  // ⚠ AND THE OTHER QUEUE HEARD NOTHING. This is the whole assertion: before the
  // scoping, both of group one's waiters were mailed about a place they would have
  // been refused the moment they pressed the button.
  H.ok(!told2.includes('w1@example.com') && !told2.includes('w2@example.com'),
    '⚠ neither of group ONE\'s waiters was told about a place in group two');
  sent.length = 0;
  const anyone = await wl.placeOpened(AID);
  H.eq(anyone.told, waitingNow.length, 'with no group named, everybody waiting hears');
  // ⚠ ABSENT RESOLVES TOWARDS THE FAMILY. A record taken while the activity was
  // pooled has no group to compare, and reading that blank as "not this one"
  // would silence whoever has been waiting longest.
  const pooled = await store.getRegistration(waiters[2].pid, AID);
  await store.saveRegistration(Object.assign({}, pooled, { groupId: null }));
  sent.length = 0;
  H.eq((await wl.placeOpened(AID, G1)).told, inG1 + 1,
    '⚠ a waiting record with no group is told whatever opened');

  // =========================================================================
  console.log('\n[and the publish is what calls it]');
  // The lesson from the email that described a button nobody had built: reading
  // each side proves each side self-consistent. So the wiring is asserted too.
  const admin = read('netlify/functions/activities-admin.js');
  H.ok(/\.afterPublish\(merged, publishedBefore\)/.test(admin),
    'publish calls it with the new record and the one that was on the site');

  // ⚠ AND `publishedBefore` IS NOT `record`, WHICH IS THE HOLE THIS CLOSES.
  //
  // `record` is the working copy, and currentRecord() lets a DRAFT supersede the
  // published file. So an admin who changes a cutoff, presses Save, then presses
  // Publish — which is the ordinary way this site is edited — would hand the
  // comparison a `previous` that already carried the new date, and it would
  // conclude nothing had moved and tell nobody. The families' terms were frozen
  // against what was PUBLISHED, so that is what the change is measured from.
  H.ok(!/afterPublish\(merged, record\)/.test(admin),
    '⚠ never the working copy — a saved draft already holds the new date');
  H.ok(/result\._publishedBefore = published\.filter\(/.test(admin),
    'it comes from the published set generate() already read');
  H.ok(/const published = await allPublished\(\);/.test(admin),
    '⚠ and costs no extra request — allPublished() was already reading this slug ' +
    'and filtering it out to rebuild the derived files');
  H.ok(/const \{ _publishedBefore: publishedBefore, \.\.\.out \} = await generate\(/.test(admin),
    'and is stripped off, so a whole activity record never travels to the browser');
  const pub = admin.slice(admin.indexOf("case 'publish': {"));
  const branch = pub.slice(0, pub.indexOf("case 'unpublish'"));
  H.ok(branch.indexOf('await generate(') < branch.indexOf('_registration-fallout'),
    '⚠ AFTER the commit — the files are in git by then and nothing here may throw ' +
    'the publish away');
  H.ok(/fallout = \{ error: err\.message \}/.test(branch),
    'and a failure is NAMED rather than swallowed');
  H.ok(/fallout: fallout/.test(branch), 'the response carries what happened');
  H.ok(/detail: falloutAudit\(fallout\)/.test(branch),
    'and so does the audit line — "ok" beside a commit sha says nothing about ' +
    'terms that were rewritten');
  // ⚠ IT IS LAZY. It pulls in the registration store, the account store and the
  // mailer, and an ordinary publish has ten seconds and needs none of them.
  H.ok(!/^const .* = require\('\.\/_registration-fallout'\)/m.test(admin),
    'required inside the branch, not at the top of the file');

  console.log('\n[and the admin screen says so, rather than an admin finding out later]');
  const ui = read('js/activities-admin.js');
  H.ok(/function falloutLine\(f\)/.test(ui), 'the screen renders it');
  H.ok(/registration' \+ \(t\.changed === 1 \? '' : 's'\)/.test(ui),
    'naming how many registrations now follow the new dates');
  H.ok(/been emailed/.test(ui), 'and that the families were emailed');
  H.ok(/on the waiting list/.test(ui), 'and who was told about a reopened group');
  H.ok(/function falloutBad\(f\)/.test(ui) && /falloutBad\(res\.data\.fallout\) \? 'err' : 'ok'/.test(ui),
    '⚠ and a partial failure colours the WHOLE notice — "Published" in olive with ' +
    'a failure sentence inside it is a notice nobody reads to the end');
  H.ok(/publish again to (retry|finish)/.test(ui),
    'and says what to do about it, since both halves are idempotent');

  // =========================================================================
  console.log('\n[executed end to end: Save draft, then Publish, and the family is told]');
  //
  // ⚠ THE PATH THAT WOULD OTHERWISE HAVE BEEN SILENT, and the reason reading the
  // source was not enough. Everything above hands afterPublish() its two records
  // directly. This drives the real handler the way the admin screen does — change
  // a cutoff, press Save, press Publish — which is the one sequence where the
  // working copy already carries the new date and the comparison has to reach
  // past it to what was on the site.
  const seed = H.seedRepo();
  const gh2 = H.makeGithub(seed.files);
  const bl2 = H.makeBlobs();
  const m2 = H.loadWithStubs({ blobs: bl2, github: gh2,
    modules: ['activities-admin', '_registration-store', 'account-auth', '_registration-fallout'] });
  const adminApi = m2['activities-admin'];
  const store2 = m2['_registration-store'];
  const auth2 = m2['account-auth'];
  // loadWithStubs re-requires _email, so the transport has to go back in.
  const sent2 = [];
  require(H.fnPath('_email'))._internal.setTransport({
    emails: { send: async (m) => { sent2.push(m); return { data: { id: 'x' } }; } }
  });
  const session = await H.installSession(bl2, H.superAdminSession());
  const as = { token: session.token };

  const loaded = await H.call(adminApi.handler,
    Object.assign({ action: 'load', slug: 'hebrew-for-kids' }, as));
  H.eq(loaded.status, 200, 'the seeded activity loads');

  // ⚠ ONE PUBLISH FIRST, for two reasons that both come from the fixture being a
  // real record rather than a convenient one: `activityId` is minted on save and
  // is never editable, so a registration cannot be keyed against this activity
  // until it has one; and the seeded record has no cancellation cutoff at all, so
  // there would be no date to move away from.
  const OLDCUT = '2026-11-05';
  const first = JSON.parse(JSON.stringify(loaded.body.activity));
  first.registration = first.registration || {};
  // ⚠ WRITTEN AS A STEP, not as the old single field. Assigning
  // `cancellationCutoffDate` onto a policy that already carries a schedule writes a
  // key nothing reads — tiersOf() only translates the old pair when there is no
  // schedule at all — so the publish would have gone through and governed nobody.
  setClose(first, OLDCUT);
  const seededPub = await H.call(adminApi.handler, Object.assign({ action: 'publish',
    activity: first, baseUpdatedAt: loaded.body.baseUpdatedAt }, as));
  H.eq(seededPub.status, 200, 'and publishes once to mint its id and fix a cutoff');
  const rec = seededPub.body.activity;
  const aid = rec.activityId;
  const gid = rec.groups[0].groupId;
  H.ok(aid && gid, 'which gives an activityId and a group to register against');
  H.eq(REG.resolveCutoffs(rec, gid).cancellationCutoffDate, OLDCUT,
    'the published activity resolves the cutoff an admin set');
  H.eq(seededPub.body.fallout.terms.changed, 0,
    'the cutoff moved, and nobody was registered yet, so no record moved with it');

  // A family already registered under those terms.
  const fam = await H.signUp(auth2, bl2, { email: 'tal@example.com',
    profile: { firstName: 'Tal', preferredLanguage: 'en' } });
  await store2.saveRegistration({
    participantId: 'p-tal', activityId: aid,
    accountId: fam.body.account.accountId, groupId: gid,
    status: 'approved', isoUpdated: '2026-09-01T00:00:00Z', history: [],
    payment: { owedCents: 30000, paidCents: 0, creditedCents: 0 },
    frozen: {
      type: 'course', participantName: 'Tal Levi', activityTitle: rec.title,
      price: { registrationFee: 50, fullPrice: 300, feeCharged: true, currency: 'EUR' },
      cancellation: Object.assign({ mode: 'flat', sessionStartsAt: [] },
        REG.resolveCutoffs(rec, gid))
    }
  });
  H.eq(frozenOf(await store2.getRegistration('p-tal', aid)).cancellationCutoffDate, OLDCUT,
    'Tal is registered under the published cutoff');

  // Change the cutoff and SAVE. Nothing must reach the family yet: a draft has no
  // files, so the page a reader sees still carries the old date.
  const NEWCUT = '2027-02-14';
  const edited = JSON.parse(JSON.stringify(rec));
  setClose(edited, NEWCUT);
  sent2.length = 0;
  const saved = await H.call(adminApi.handler, Object.assign({ action: 'saveDraft',
    activity: edited, baseUpdatedAt: seededPub.body.baseUpdatedAt }, as));
  H.eq(saved.status, 200, 'the draft saves');
  H.eq(sent2.length, 0, '⚠ and saving tells nobody — a draft has no files and changes no page');
  H.eq(frozenOf(await store2.getRegistration('p-tal', aid)).cancellationCutoffDate, OLDCUT,
    'the family still holds the published terms');

  // Now publish. currentRecord() hands the handler the DRAFT, which already has
  // 2027-02-14 in it — so a comparison against the working copy would find
  // nothing, and these assertions are the whole point of the section.
  //
  // The status goes back on, exactly as the screen does it: saveDraft() forces
  // `status: 'draft'` on the STORED record while the form still holds whatever
  // the admin chose, and readForm() sends that.
  const donePub = await H.call(adminApi.handler, Object.assign({ action: 'publish',
    activity: Object.assign({}, saved.body.activity, { status: rec.status }),
    baseUpdatedAt: saved.body.baseUpdatedAt }, as));
  H.eq(donePub.status, 200, 'the publish succeeds');
  H.ok(donePub.body.fallout, 'and reports what it did to the registrations');
  H.eq(donePub.body.fallout.terms.changed, 1,
    '⚠ THE FAMILY ALREADY REGISTERED WAS MOVED, though the working copy it was ' +
    'compared against already held the new date');
  H.eq(donePub.body.fallout.terms.emailed, 1, 'and was emailed');
  H.eq(frozenOf(await store2.getRegistration('p-tal', aid)).cancellationCutoffDate, NEWCUT,
    'the record now carries the date an admin published');
  H.eq(sent2.length, 1, 'exactly one message went');
  H.ok(/14 February 2027/.test(sent2[0].html), 'naming the new date');
  H.ok(donePub.body._publishedBefore === undefined,
    'and no previous record was sent back to the browser');

  // Publishing again, unchanged, is not a second announcement.
  sent2.length = 0;
  const again2 = await H.call(adminApi.handler, Object.assign({ action: 'publish',
    activity: donePub.body.activity, baseUpdatedAt: donePub.body.baseUpdatedAt }, as));
  H.eq(again2.status, 200, 'republishing works');
  H.eq(again2.body.fallout, null, 'and has nothing to do');
  H.eq(sent2.length, 0, 'so the family is not told twice');

  H.done();
})();
