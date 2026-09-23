// What this defends against:
//
// THE ROSTER COUNTED REGISTRATIONS AGAINST THE SIZE OF THE ROOM AND CALLED THE
// RESULT "OVER CAPACITY".
//
// On a drop-in the two are different questions and always have been. Registering
// is deliberately uncapped — `submit` guards on `type !== 'dropin'` before it
// asks hasRoom(), because counting registrations against the room once refused
// the twenty-first family on an activity that was never more than half full on
// the night, with a refusal reading "this activity is full" that was untrue of
// every actual evening. Forty can be registered and eight turn up.
//
// The room is real and is enforced per evening, in capacityForDate(). The
// family's own picker has shown that figure since Phase 7 — it dims a full date
// and says why. The ADMIN never got it: the `register` action returned it to
// nobody, because there was no screen, and that gap sat in UNREACHED for
// releases.
//
// So the roster printed the uncapped count beside the room's number. The count
// was right, the limit was right, and putting them in one sentence was wrong:
// "4 of 3 places · Over capacity" on an activity where nothing was over anything
// and no rule had been broken. Reported as: "as each session is on its own, the
// count shouldn't be for the activity but per session."
//
// ⚠ AND THE OTHER DIRECTION IS WHAT MAKES IT WORTH A SUITE. Silencing the line
// would have been half a fix — an admin would then have had NO capacity figure
// at all on a drop-in, which is worse than a wrong one, because a full evening
// would be invisible until somebody arrived to a room with no chair. So this
// checks both: that the activity-level answer is gone, and that the per-evening
// one is there, correct, and changes when a booking does.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_helpers');
const F = require('./_fixtures');
const D = require('./_dom');

process.env.RESEND_FROM = 'Merkaz Ogen <noreply@ogen.cy>';

const R = path.join(__dirname, '..');
const screen = fs.readFileSync(path.join(R, 'js/registrations-admin.js'), 'utf8');

// The client's own renderCapacity(), lifted out and EXECUTED against a report
// built by the real capacityReport(). Reading the source would only prove the
// source is self-consistent — which is exactly how a dialog about money came to
// say the opposite of what happened, one screen over.
function capacityText(report) {
  const dom = D.makeDom({});
  const box = dom.node('div');
  const slice = (from, to) => screen.slice(screen.indexOf(from), screen.indexOf(to));
  const ctx = vm.createContext({
    document: dom.document,
    $: () => box,
    // The group rows on a course name their groups through the picker's own
    // helper, which is not part of what is under test here.
    titleOf: (name, id) => (name && (name.en || name)) || id,
    S: { canApprove: true }
  });
  vm.runInContext(
    slice('  function el(tag, attrs, kids) {', '  function money(cents)') +
    slice('  function renderCapacity(cap) {', '  // ---------- one row ----------') +
    '\nthis.renderCapacity = renderCapacity;', ctx);
  ctx.renderCapacity(report);
  return box.textContent;
}

(async () => {
  const Reg = require(H.fnPath('_registration'));

  console.log('[the report itself: a drop-in has no activity-level capacity]');
  // A room of three and four registrations — exactly the screenshot.
  const room3 = { groups: 1, maxPerGroup: 3 };
  const dropin = F.dropin({ facts: Object.assign({}, F.rawDropin().facts, { groupSize: room3 }) });
  const course = F.course({ facts: Object.assign({}, F.rawCourse().facts, { groupSize: room3 }) });
  const four = [1, 2, 3, 4].map((n) => ({
    participantId: 'p-' + n, activityId: dropin.activityId, status: 'approved',
    groupId: null, frozen: {}, payment: {}
  }));

  const dr = Reg.capacityReport(dropin, four);
  H.eq(dr.taken, 4, 'four hold a registration, which is true and stays true');
  H.eq(dr.capacity, null, 'and there is no activity-level capacity to hold them against');
  H.eq(dr.over, false, '⚠ so it is NOT over capacity — nothing was over anything');
  H.eq(dr.perSession, true, 'the report says which question it is answering');

  const cr = Reg.capacityReport(course, four.map((r) => Object.assign({}, r, { activityId: course.activityId })));
  H.eq(cr.capacity, 3, 'a course with the same figure still reports it');
  H.eq(cr.over, true, 'and four against three is still over capacity there');
  H.eq(cr.perSession, false, 'because a course is a different question');

  console.log('\n[the line the admin reads]');
  const said = capacityText(dr);
  H.ok(!/of 3 places/.test(said), '⚠ the drop-in line does not say "of 3 places": ' + said);
  H.ok(!/Over capacity/.test(said), 'and does not say over capacity');
  H.ok(/4 registered/.test(said), 'it says the count, which is the honest half');
  H.ok(/per evening/.test(said), 'and points at where the limit actually lives');
  // ⚠ NOT "no limit set". That sentence exists for a course nobody finished
  // filling in, and reading it here would say somebody forgot something.
  H.ok(!/no limit set/.test(said), 'never "no limit set", which on a course means a field is blank');

  const courseSaid = capacityText(cr);
  H.ok(/of 3 places/.test(courseSaid), 'the course line is untouched: ' + courseSaid);
  H.ok(/Over capacity/.test(courseSaid), 'including the over-capacity flag it exists to raise');

  console.log('\n[an evening is capped, and counts only who is in the room]');
  const seat = (n, date, status) => ({
    participantId: 'p-' + n, activityId: dropin.activityId,
    sessionDate: date, status: status, groupId: null
  });
  const atts = [
    seat(1, '2026-10-06', 'booked'), seat(2, '2026-10-06', 'attended'),
    seat(3, '2026-10-06', 'cancelled'), seat(4, '2026-10-06', 'no-show'),
    seat(1, '2026-10-13', 'booked')
  ];
  const six = Reg.capacityForDate(dropin, atts, '2026-10-06');
  H.eq(six.capacity, 3, 'the evening IS capped, by the same groupSize figure');
  H.eq(six.taken, 2, 'booked and attended are in the room');
  H.eq(six.left, 1, 'so one place is left on that evening');
  H.eq(Reg.capacityForDate(dropin, atts, '2026-10-13').taken, 1,
    'and the next evening counts its own, independently — that is the whole point');
  H.eq(Reg.capacityForDate(dropin, atts, '2026-10-20').taken, 0,
    'an evening nobody booked is empty rather than missing');

  // -------------------------------------------------------------------------
  console.log('\n[through the handler: the strip, and marking the register]');

  const blobs = H.makeBlobs();
  const act = F.dropin({ slug: 'folk', activityId: 'act-00000000000ev01',
                         facts: Object.assign({}, F.rawDropin().facts, { groupSize: room3 }) });
  const github = H.makeGithub({
    'activities/folk.json': JSON.stringify(act),
    'activities/activities-index.json': JSON.stringify(
      [{ slug: 'folk', activityId: act.activityId, status: 'open', langs: ['he', 'en', 'ru'],
         title: act.title }])
  });
  const mods = H.loadWithStubs({ blobs, github,
    modules: ['account-auth', 'account-family', 'account-registrations', 'admin-registrations',
              '_session-attendance'] });
  const auth = mods['account-auth'];
  const family = mods['account-family'];
  const fam = mods['account-registrations'];
  const admin = mods['admin-registrations'];
  const attendance = mods['_session-attendance'];

  require(H.fnPath('_email'))._internal.setTransport({
    emails: { send: async () => ({ data: { id: 'e-1' } }) }
  });
  const session = await H.installSession(blobs, H.superAdminSession());

  const DATES = ['2026-10-06', '2026-10-13', '2026-10-20'];

  // Four families register. None is refused, which is the rule this screen was
  // misreporting rather than a rule it was breaking.
  const kids = [];
  for (const n of [1, 2, 3, 4]) {
    const up = await H.signUp(auth, blobs, { email: 'fam' + n + '@example.com',
      profile: { firstName: 'Fam' + n, preferredLanguage: 'en' } });
    const made = await H.call(family.handler, { action: 'createParticipant', token: up.body.token,
      participant: { firstName: 'Kid' + n, lastName: 'Levi', dateOfBirth: '2012-04-02' } });
    const id = made.body.participant.participantId;
    kids.push({ token: up.body.token, id: id });
    const res = await H.call(fam.handler, { action: 'submit', token: up.body.token,
      slug: 'folk', participantId: id, lang: 'en' });
    H.eq(res.status, 200, 'family ' + n + ' registers for the drop-in, room of three or not');
  }

  const queue = await H.call(admin.handler, { action: 'queue', token: session.token, slug: 'folk' });
  H.eq(queue.body.capacity.taken, 4, 'the roster sees four registrations');
  H.eq(queue.body.capacity.capacity, null, 'against no activity-level limit');
  H.eq(queue.body.capacity.over, false, '⚠ and reports no over capacity — this is the screenshot, fixed');

  // Three of them book the first evening — which is the room's actual limit.
  for (const k of kids.slice(0, 3)) {
    const b = await H.call(fam.handler, { action: 'bookSession', token: k.token,
      slug: 'folk', participantId: k.id, sessionDate: DATES[0], lang: 'en' });
    H.eq(b.status, 200, 'a family books the first evening');
  }
  // One books a different one, so the strip has something to tell apart.
  await H.call(fam.handler, { action: 'bookSession', token: kids[3].token,
    slug: 'folk', participantId: kids[3].id, sessionDate: DATES[1], lang: 'en' });

  const strip = await H.call(admin.handler, { action: 'register', token: session.token, slug: 'folk' });
  H.eq(strip.status, 200, 'the register opens');
  H.eq(strip.body.registered, 4, 'it reports how many hold a registration');
  const by = {};
  (strip.body.dates || []).forEach((d) => { by[d.sessionDate] = d; });
  H.eq(Object.keys(by).length, DATES.length, 'and one entry per evening in the calendar');
  // ⚠ EVERY EVENING, NOT JUST THE ONE ASKED FOR. forActivity() narrowed by date
  // would have counted only the chosen one and shown every other chip at nought.
  H.eq(by[DATES[0]].taken, 3, 'the first evening is full');
  H.eq(by[DATES[0]].left, 0, 'with nothing left');
  H.eq(by[DATES[1]].taken, 1, 'the second has one');
  H.eq(by[DATES[2]].taken, 0, 'and the third none');
  H.eq(by[DATES[0]].capacity, 3, 'each against the room, which is where that number belongs');

  // ⚠ AND THE STRIP STAYS RIGHT WHEN ONE DATE IS OPEN, which is the case the
  // narrowed read broke: every OTHER chip would have gone to nought the moment
  // an admin clicked one.
  const one = await H.call(admin.handler, { action: 'register', token: session.token,
    slug: 'folk', sessionDate: DATES[1] });
  const byOne = {};
  (one.body.dates || []).forEach((d) => { byOne[d.sessionDate] = d; });
  H.eq(byOne[DATES[0]].taken, 3, 'the first evening still reads three with the second one open');
  H.eq(one.body.register.length, 1, 'while the table itself is the chosen evening');
  H.eq(one.body.capacity.sessionDate, DATES[1], 'and the line above it is that evening\'s room');

  console.log('\n[marking the register, which only a QR code could do before]');
  const first = await H.call(admin.handler, { action: 'register', token: session.token,
    slug: 'folk', sessionDate: DATES[0] });
  const who = first.body.register[0];
  H.eq(first.body.register.length, 3, 'three names on the first evening');
  H.eq(who.status, 'booked', 'each booked');

  const marked = await H.call(admin.handler, { action: 'markAttendance', token: session.token,
    participantId: who.participantId, activityId: act.activityId,
    sessionDate: DATES[0], status: 'attended' });
  H.eq(marked.status, 200, 'an admin can mark somebody present');
  H.eq(marked.body.session.status, 'attended', 'and it writes into the register');
  // Same blob, same transition() — so the money, the ledger and the family's own
  // page see one thing. What differs is WHO marked it.
  const att = await attendance.getAttendance(who.participantId, act.activityId, DATES[0]);
  H.eq(att.status, 'attended', 'into the same att- record the QR page writes');
  H.ok((att.history || []).some((h) => h.by === session.email),
    'stamped with the admin who did it rather than "self"');

  H.eq((await H.call(admin.handler, { action: 'register', token: session.token,
    slug: 'folk', sessionDate: DATES[0] })).body.capacity.taken, 3,
    'attended still holds a seat — the room did not empty because somebody turned up');

  // ⚠ A NO-SHOW FREES THE PLACE. The question capacityForDate() answers is "is
  // there room", and somebody who did not come is not in the room. Whether they
  // still owe for the evening is a different question, on their own record.
  const owedBefore = att.payment.owedCents;
  await H.call(admin.handler, { action: 'markAttendance', token: session.token,
    participantId: who.participantId, activityId: act.activityId,
    sessionDate: DATES[0], status: 'no-show' });
  const after = await H.call(admin.handler, { action: 'register', token: session.token,
    slug: 'folk', sessionDate: DATES[0] });
  H.eq(after.body.capacity.taken, 2, 'a no-show frees the place on that evening');
  H.eq((await attendance.getAttendance(who.participantId, act.activityId, DATES[0]))
         .payment.owedCents, owedBefore,
    'and still owes for it — the room and the bill are different questions');

  console.log('\n[a course has no register, and is told so rather than shown nothing]');
  const courseGh = H.makeGithub({ 'activities/term.json': JSON.stringify(F.course({ slug: 'term' })) });
  courseGh._files.set('activities/activities-index.json', JSON.stringify([]));
  const refused = await H.call(admin.handler, { action: 'register', token: session.token, slug: 'term' });
  H.ok(refused.status >= 400, 'asking a course for a register is refused rather than answered emptily');

  console.log('\n[the screen: one table, and the strip decides what it is about]');
  // The two halves that cannot be executed without a whole admin page, pinned
  // structurally instead — each one a thing that was actually wrong.
  H.ok(/if \(q\.activity\.type === 'dropin' && S\.date\) return renderEvening\(box\)/.test(screen),
    'picking an evening swaps the one table rather than adding a second');
  H.ok(/S\.date = null; S\.register = null;/.test(screen),
    'switching activity forgets the date — the evenings belong to the activity');
  H.ok(/loadRegister\(S\.register \? S\.date : undefined\)/.test(screen),
    'and a refresh keeps whichever chip is open, including "All"');
  H.ok(/cap\.perSession/.test(screen),
    'the line branches on the REPORT, not on a second reading of the activity type');

  H.done();
})();
