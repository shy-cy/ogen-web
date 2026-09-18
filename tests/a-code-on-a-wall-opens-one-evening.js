// What this defends against:
//
// This is the only endpoint on the site that both READS PEOPLE'S NAMES and
// WRITES, with no session of any kind. It exists because the alternative is a
// parent in a doorway with a coat in one hand being asked for a password, and it
// is safe only because what it can do is small. Everything here is an assertion
// about how small.
//
// The disclosure was accepted deliberately and in its narrow form, so the narrow
// form is what is pinned:
//
//   READ   the names booked for ONE evening of ONE activity. Full names, asked
//          for over first-name-plus-initial because two children called Noa
//          cannot otherwise tap the right row. Nothing else — no dates of birth,
//          no contacts, no amounts, no other date.
//   WRITE  mark a listed name present. That moves NO money: what an evening
//          costs is decided when it is booked and a no-show owes it too, so the
//          worst case is a wrong register rather than a wrong bill.
//   NEVER  book, cancel, create a participant, read a balance, or reach any
//          other date.
//
// And two guards turn a photographable code into a key to one evening:
//
//   1. it expires when its session's day ENDS in Asia/Nicosia — the same
//      endOfDay() the cancellation cutoffs use, not a second timezone and not
//      UTC, which on a Tuesday-evening class would kill it during the class;
//   2. it does not open until that day BEGINS, so a code photographed a week
//      early lists nobody.
//
// One more thing that looks cosmetic and is not: codeFor() is idempotent per
// (activity, date). If re-opening the admin panel minted a new token, every
// poster already on a wall would stop working the moment somebody looked at the
// screen.

const H = require('./_helpers');
const F = require('./_fixtures');
const fs = require('fs');
const path = require('path');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');

process.env.RESEND_FROM = 'Merkaz Ogen <noreply@ogen.cy>';

const DATE = '2026-10-13';

(async () => {
  const blobs = H.makeBlobs();
  const activity = F.dropin();
  const course = F.course({ slug: 'term', activityId: 'act-0000000000000c01' });
  const github = H.makeGithub({
    'activities/dropin-fixture.json': JSON.stringify(activity),
    'activities/term.json': JSON.stringify(course)
  });

  const mods = H.loadWithStubs({
    blobs, github,
    modules: ['_checkin-token', '_session-attendance', '_participant-store', '_session-store',
              'checkin', 'admin-registrations', '_credit']
  });
  const codes = mods['_checkin-token'];
  const attendance = mods['_session-attendance'];
  const participants = mods['_participant-store'];
  const checkin = mods['checkin'];
  const adminRegs = mods['admin-registrations'];
  const credit = mods['_credit'];

  // Two people booked, one cancelled, all with LAST NAMES — the thing this
  // screen shows and the reason it shows it.
  const people = [
    { participantId: 'p-1', firstName: 'Noa', lastName: 'Levi', status: 'booked' },
    { participantId: 'p-2', firstName: 'Noa', lastName: 'Cohen', status: 'booked' },
    { participantId: 'p-3', firstName: 'Ari', lastName: 'Gold', status: 'cancelled' }
  ];
  for (const p of people) {
    await participants.saveParticipant({
      participantId: p.participantId, firstName: p.firstName, lastName: p.lastName,
      dateOfBirth: '2017-04-02'
    });
    const att = attendance.newAttendance({
      activity: activity, participantId: p.participantId, accountId: 'a-1', sessionDate: DATE
    });
    att.status = p.status;
    await attendance.saveAttendance(att);
  }

  const call = (body) => H.call(checkin.handler, body);

  console.log('[the token dies with its own day, in Cyprus and not in UTC]');
  const code = await codes.codeFor(activity, DATE);
  // 13 October 2026 is EEST, UTC+3, so the Cyprus day ends at 20:59:59.999Z.
  // A UTC day-end would be three hours later — during the following morning —
  // and a UTC MIDNIGHT would end it three hours early, in the middle of an
  // evening class.
  H.eq(new Date(code.expiresAt).toISOString(), '2026-10-13T20:59:59.999Z',
    'it expires at the end of the Cyprus day, to the millisecond');
  H.eq(await codes.readCode(code.token, code.expiresAt + 1), null, 'a millisecond later it opens nothing');
  H.ok(await codes.readCode(code.token, code.expiresAt), 'and on the last millisecond it still does');

  console.log('\n[the same evening always gets the same code]');
  const again = await codes.codeFor(activity, DATE);
  H.eq(again.token, code.token,
    're-opening the admin panel must not retire the sheet already pinned to the wall');
  const other = await codes.codeFor(activity, '2026-10-20');
  H.ok(other.token !== code.token, 'a different evening is a different code');
  H.ok(code.title && code.slug,
    'the title is FROZEN onto the token, so the public endpoint reads no repository');

  console.log('\n[before the day begins it lists nobody, and says which evening it is for]');
  const early = await call({ action: 'session', token: code.token });
  H.eq(early.status, 200, 'a code scanned early is not an error');
  H.eq(early.body.open, false, 'but the register is not open');
  H.eq(early.body.reason, 'too-early', 'and says why');
  H.eq(early.body.sessionDate, DATE, 'naming the evening, which is on the poster anyway');
  H.eq(early.body.people, undefined, 'AND LISTS NOBODY — a code photographed a week early names no children');

  // Move into the session's own day.
  const duringDay = credit.resolveLocal(DATE, '18:00', credit.TZ);
  const realNow = Date.now;
  Date.now = () => duringDay;

  console.log('\n[on the day: the list is this evening, in full names, and only who is coming]');
  const open = await call({ action: 'session', token: code.token });
  H.eq(open.body.open, true, 'the register is open');
  H.eq(open.body.people.length, 2, 'two people, not three');
  H.eq(open.body.people.map((p) => p.name).join(' / '), 'Noa Cohen / Noa Levi',
    'FIRST AND LAST — two children called Noa cannot tap the right row otherwise');
  H.ok(!open.body.people.some((p) => p.name.indexOf('Ari') !== -1),
    'a cancelled booking is not on the list — they are not coming and must not be tappable');
  // The narrow disclosure, asserted as an absence.
  const leaked = JSON.stringify(open.body);
  ['dateOfBirth', '2017-04-02', 'owedCents', 'paidCents', 'accountId', 'a-1']
    .forEach((f) => H.ok(leaked.indexOf(f) === -1, 'no ' + f + ' reaches the doorway'));

  console.log('\n[tapping a name writes into the register that already exists]');
  const tap = await call({ action: 'checkIn', token: code.token, participantId: 'p-1' });
  H.eq(tap.status, 200, 'it is accepted');
  H.eq(tap.body.already, false, 'and was not already marked');
  const att = await attendance.getAttendance('p-1', activity.activityId, DATE);
  H.eq(att.status, 'attended', 'the SAME blob the admin register reads now says attended');
  const last = att.history[att.history.length - 1];
  H.eq(last.by, 'self', 'and the history says a person marked themselves, not an admin');
  H.eq(last.note, 'QR check-in', 'and how');

  console.log('\n[tapping twice is a success, not an error]');
  const twice = await call({ action: 'checkIn', token: code.token, participantId: 'p-1' });
  H.eq(twice.status, 200, 'two people scanning one poster in the same minute is normal');
  H.eq(twice.body.already, true, 'and is reported as already done rather than as a failure');

  console.log('\n[somebody already here stays on the list, marked]');
  const after = await call({ action: 'session', token: code.token });
  H.eq(after.body.people.length, 2, 'the name does not vanish — that reads as a tap that went wrong');
  H.eq(after.body.people.filter((p) => p.name === 'Noa Levi')[0].status, 'attended', 'it is marked');

  console.log('\n[and that is ALL it can do]');
  H.eq((await call({ action: 'checkIn', token: code.token, participantId: 'p-3' })).status, 404,
    'a cancelled booking cannot be revived by tapping');
  H.eq((await call({ action: 'checkIn', token: code.token, participantId: 'nobody' })).status, 404,
    'and a name that is not there is refused');
  H.eq((await call({ action: 'checkIn', token: code.token, participantId: 'p-3' })).body.error,
       (await call({ action: 'checkIn', token: code.token, participantId: 'nobody' })).body.error,
    'in the SAME words, so the list cannot be probed for names it does not show');
  H.eq((await call({ action: 'book', token: code.token })).status, 400, 'there is no booking action');
  H.eq((await call({ action: 'cancel', token: code.token })).status, 400, 'no cancelling');
  H.eq((await call({ action: 'balance', token: code.token })).status, 400, 'and no money');

  console.log('\n[an invented token and an expired one answer identically]');
  const invented = await call({ action: 'session', token: 'made-up' });
  H.eq(invented.status, 404, 'an invented token opens nothing');
  Date.now = () => code.expiresAt + 1000;
  const dead = await call({ action: 'session', token: code.token });
  H.eq(dead.status, 404, 'and neither does yesterday\'s');
  H.eq(dead.body.error, invented.body.error,
    'in the same words — telling them apart says whether a code ever existed');
  Date.now = realNow;

  console.log('\n[the admin side: drop-ins only, behind access]');
  const session = await H.installSession(blobs, H.superAdminSession({ token: 'adm', email: 'a@ogen.cy' }));
  const adm = (body) => H.call(adminRegs.handler, Object.assign({ token: session.token }, body));
  const got = await adm({ action: 'checkinCodes', slug: 'dropin-fixture' });
  H.eq(got.status, 200, 'the codes are served');
  H.eq(got.body.codes.length, 3, 'one per bookable evening');
  H.ok(/^https:\/\/www\.ogen\.cy\/checkin\?t=/.test(got.body.codes[0].url),
    'as a URL — a QR is a picture of a string, and the browser draws the picture');
  H.eq((await adm({ action: 'checkinCodes', slug: 'term' })).status, 400,
    'a COURSE has no register: it creates no per-session records at all');
  const outsider = await H.installSession(blobs, H.superAdminSession({
    token: 'out', email: 'o@ogen.cy',
    permissions: Object.assign({}, H.superAdminSession().permissions,
      { registrations: { access: false, approve: false, cancel: false } })
  }));
  H.eq((await H.call(adminRegs.handler,
    { token: outsider.token, action: 'checkinCodes', slug: 'dropin-fixture' })).status, 403,
    'and a role with no access to the queue cannot mint a code into it');

  console.log('\n[the page and the screen]');
  const page = read('checkin.html');
  H.ok(/<meta name="robots" content="noindex/.test(page), 'the page is noindex');
  H.ok(read('sitemap.xml').indexOf('/checkin') === -1, 'and absent from the sitemap');
  H.ok(/<div id="page" dir="rtl">/.test(page) && !/<html[^>]+dir=|<body[^>]+dir=/.test(page),
    'direction on #page and nowhere else, the rule the whole site is held to');
  const ui = read('js/checkin.js');
  H.ok(/lang = l; applyLang\(\); render\(\);/.test(ui),
    'the language toggle RE-RENDERS rather than navigating — one poster cannot be three posters, ' +
    'and navigating is how the account pages once dropped a token out of the query string');
  ['he', 'en', 'ru'].forEach((l) => {
    H.ok(new RegExp('\\n    ' + l + ': \\{').test(ui), l + ' is in the one string table');
  });
  H.ok(/notListed/.test(ui) && !/createParticipant/.test(ui),
    'a walk-in is told to speak to a teacher — creating a participant here would be ' +
    'an unauthenticated stranger writing a child\'s record');
  // The endpoint must not be able to reach the repository. A public handler with
  // a GitHub credential in scope is a different class of thing from this one.
  const fn = read('netlify/functions/checkin.js');
  H.ok(!/_github|GITHUB/.test(fn), 'and the public endpoint never opens GitHub');

  H.done();
})();
