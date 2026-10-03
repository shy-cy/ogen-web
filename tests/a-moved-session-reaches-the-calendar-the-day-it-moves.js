// What this defends against:
//
// A MOVED SESSION REACHED A FAMILY'S CALENDAR ON THE EVENING BEFORE THE CLASS.
//
// The foundation was already built and what was missing was the WHEN. The UID a
// calendar file carries is stable across the approval invite and every reminder
// — keyed by the session's NUMBER rather than its date, precisely so a session
// that moves updates an entry in place instead of arriving as a second one — and
// buildIcs() raises a SEQUENCE whenever the record is saved. So the correction
// has always been correct and has always gone out with the day-before reminder.
//
// ⚠ WHICH IS TOO LATE FOR THE ONE THING IT IS FOR. A family who rearranged a
// Tuesday found out on the Monday, and anybody who opened their calendar in
// between read a date we already knew was wrong. The publish is the moment the
// date changes and the publish is where this now fires.
//
// Three things in it are worth a test rather than a comment:
//
//  1. WHAT COUNTS AS A MOVE is the INSTANT, not the date — so an edited HOUR is
//     a move, which a date comparison would miss entirely, and an excluded date
//     renumbers everything after it, which really does change every later entry
//     a family holds.
//  2. WHO IS TOLD is the sweep's own peopleFor(), not a second copy of it, and
//     on a drop-in the lookup is on the date that is GOING AWAY — the bookings
//     are keyed by evening, so asking about the new one finds nobody.
//  3. A FAMILY WHO SWITCHED REMINDERS OFF IS STILL TOLD. That switch says "do
//     not tell me about classes I already know about". A class moving is not
//     that, and the unsubscribe link promises in three languages that other
//     messages are unaffected.

const fs = require('fs');
// ⚠ BEFORE _email IS REQUIRED. send() refuses to go out with a default sender,
// so without this every assertion about what was sent reads zero — which looks
// exactly like the feature not firing.
process.env.RESEND_FROM = 'Merkaz Ogen <noreply@ogen.cy>';
const H = require('./_helpers');
const REM = require(H.fnPath('_reminders'));
const email = require(H.fnPath('_email'));

const AID = 'act-00000000000000f1';
const G1 = 'grp-aaaa', G2 = 'grp-bbbb';
const dates = (list) => list.map((d) => ({ date: d, status: 'scheduled' }));

// Far enough ahead that nothing here is near a real boundary — the lesson
// a-dialog-about-money-must-not-be-backwards.js had to learn the hard way, where
// a fixture's date was overtaken by the clock and the TEST was the stale thing.
const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const D = (n) => iso(Date.now() + n * DAY);
const SOON = [D(30), D(37), D(44), D(51)];
const OTHER = [D(32), D(39)];

function term(over) {
  const a = {
    slug: 'term', activityId: AID, type: 'course', status: 'open',
    title: { he: 'מועדון', en: 'Club', ru: 'Клуб' },
    isoUpdated: '2027-01-01T10:00:00.000Z',
    facts: { price: { registrationFee: 0, fullPrice: 100 }, groupSize: {} },
    registration: {
      autoApprove: true, pendingExpiryDays: null, registrationFeeCutoffDate: 'none',
      cancellationPolicy: { mode: 'flat', cancellationCutoffDate: 'none' },
      defaultBasis: null
    },
    groups: [
      { groupId: G1, name: { he: 'א', en: 'One', ru: 'Один' }, capacity: 9, teacherIds: [],
        facts: { schedule: { frequency: 'weekly', sessions: [{ day: 'monday', time: '16:00' }] },
          duration: { startDate: SOON[0], endDate: SOON[3], sessionMinutes: 60,
            sessionDates: dates(SOON) } } },
      { groupId: G2, name: { he: 'ב', en: 'Two', ru: 'Два' }, capacity: 9, teacherIds: [],
        facts: { schedule: { frequency: 'weekly', sessions: [{ day: 'wednesday', time: '18:00' }] },
          duration: { startDate: OTHER[0], endDate: OTHER[1], sessionMinutes: 90,
            sessionDates: dates(OTHER) } } }
    ]
  };
  return JSON.parse(JSON.stringify(Object.assign(a, over || {})));
}
const clone = (a) => JSON.parse(JSON.stringify(a));
const NOW = Date.now();
const rcpt = (m) => [].concat(m.to)[0];

(async () => {
  console.log('[what counts as a move is the INSTANT, not the date]');

  const base = term();
  H.eq(REM.movedSessions(base, clone(base), NOW).length, 0,
    'an identical republish moved nothing');
  H.eq(REM.movedSessions(null, base, NOW).length, 0,
    '⚠ and a FIRST publish moved nothing — there is nothing a family already holds');

  const dateMoved = clone(base);
  dateMoved.groups[0].facts.duration.sessionDates[2].date = D(46);
  let got = REM.movedSessions(base, dateMoved, NOW);
  H.eq(got.length, 1, 'editing one date moves exactly one session');
  H.eq(got[0].session.index, 3, 'and it is the session the published table calls 3');
  H.eq(got[0].was.date, SOON[2], 'carrying the date it used to be on');

  // ⚠ THE CASE A DATE COMPARISON CANNOT SEE. The meeting is on the same day and
  // at a different hour, so every entry in every family's calendar is wrong and
  // nothing about the dates has changed.
  const hourMoved = clone(base);
  hourMoved.groups[0].facts.schedule.sessions[0].time = '17:30';
  got = REM.movedSessions(base, hourMoved, NOW);
  H.eq(got.length, 4, '⚠ changing the HOUR moves every session of that group');
  H.eq(got[0].session.date, got[0].was.date, 'on the same date it was always on');
  H.eq(got[0].was.time + ' -> ' + got[0].session.time, '16:00 -> 17:30',
    'and the hour is what differs');

  // ⚠ RENUMBERING IS REAL AND IS REPORTED. The UID is the session's number, so
  // excluding the second meeting makes entry 2 point at what used to be entry 3
  // and so on down the list. Reporting fewer would leave a family holding entries
  // we know to be wrong. The honest limit is written beside uidFor(): the LAST
  // entry is left behind with nothing able to withdraw it.
  const excluded = clone(base);
  excluded.groups[0].facts.duration.sessionDates[1].status = 'excluded';
  got = REM.movedSessions(base, excluded, NOW);
  H.eq(got.length, 2, 'excluding the second of four moves the two entries below it');
  H.eq(got.map((m) => m.session.index).join(','), '2,3',
    'which are the numbers that now point at different meetings');
  H.eq(got[0].was.date + ' -> ' + got[0].session.date, SOON[1] + ' -> ' + SOON[2],
    'entry 2 moves from the excluded date to the one after it');

  // Matched by groupId, never by position — the rule mergeGroups() already keeps.
  const swapped = clone(base);
  swapped.groups.reverse();
  H.eq(REM.movedSessions(base, swapped, NOW).length, 0,
    '⚠ reordering the groups is not every session of both of them moving');

  // A group nobody could have registered for has nothing in anybody's calendar.
  const added = clone(base);
  added.groups.push({ groupId: 'grp-cccc', name: { he: 'ג', en: 'Three', ru: 'Три' },
    capacity: 9, teacherIds: [],
    facts: { schedule: { frequency: 'weekly', sessions: [{ day: 'friday', time: '09:00' }] },
      duration: { startDate: D(33), endDate: D(40), sessionMinutes: 60,
        sessionDates: dates([D(33), D(40)]) } } });
  H.eq(REM.movedSessions(base, added, NOW).length, 0,
    'a brand new group moves nothing — nobody could have been in it');

  // Nobody needs a corrected entry for last Tuesday.
  const past = term();
  past.groups[0].facts.duration.sessionDates = dates([D(-20), D(-13), SOON[0]]);
  const pastMoved = clone(past);
  pastMoved.groups[0].facts.duration.sessionDates[0].date = D(-19);
  pastMoved.groups[0].facts.duration.sessionDates[2].date = D(31);
  got = REM.movedSessions(past, pastMoved, NOW);
  H.eq(got.length, 1, '⚠ a session already in the past is not reported');
  H.eq(got[0].session.index, 3, 'only the one still ahead');

  // An event with no start is not an event — the same answer nextSessionFrom()
  // gives, and the reason sendApproved() attaches nothing rather than a dead one.
  const noHour = clone(base);
  noHour.groups[0].facts.schedule.sessions = [{ day: 'monday', time: '16:00' },
                                              { day: 'tuesday', time: '19:00' }];
  noHour.groups[0].facts.duration.sessionDates[2].date = D(46);
  H.eq(REM.movedSessions(base, noHour, NOW)
        .filter((m) => m.groupId === G1).length, 0,
    '⚠ a session whose hour cannot be pinned down is not announced at all');

  console.log('\n[the file carries the UID the family already holds]');

  got = REM.movedSessions(base, dateMoved, NOW);
  const mail = require(H.fnPath('_registration-email'));
  const att = mail.sessionsIcs(dateMoved, got.map((m) => m.session), 'en');
  const text = Buffer.from(att.content, 'base64').toString('utf8');
  const uid = REM.uidFor(AID, G1, 3);
  H.ok(text.indexOf('UID:' + uid) !== -1,
    '⚠ the UID is the session NUMBER, so a calendar updates the entry it has: ' + uid);
  H.ok(/\nSEQUENCE:\d+/.test(text),
    '⚠ and a SEQUENCE, without which a calendar ignores a second file for one meeting');
  H.eq((text.match(/BEGIN:VEVENT/g) || []).length, 1, 'one moved session is one event');

  // ⚠ ONE BUILDER FOR BOTH DOORS. sessionIcs() is what the approval invite and
  // the reminder call; if this used a second one the UID could drift and the
  // family would collect a duplicate entry per moved session rather than an edit.
  const one = mail.sessionIcs(dateMoved, got[0].session, 'en');
  const oneText = Buffer.from(one.content, 'base64').toString('utf8');
  H.eq((oneText.match(/UID:[^\r\n]+/) || [''])[0], 'UID:' + uid,
    'and it is the SAME event the reminder for that session would send');

  // Several moves are ONE file, because the entries already exist: a file per
  // session is several emails about one edit.
  const manyMoves = REM.movedSessions(base, hourMoved, NOW);
  const manyAtt = mail.sessionsIcs(hourMoved, manyMoves.map((m) => m.session), 'en');
  const manyText = Buffer.from(manyAtt.content, 'base64').toString('utf8');
  H.eq((manyText.match(/BEGIN:VEVENT/g) || []).length, 4,
    'four moved sessions are four events in ONE file');
  H.eq(new Set(manyText.match(/UID:[^\r\n]+/g)).size, 4,
    'with four distinct UIDs, or a calendar keeps only the last');

  // ⚠ THE SEQUENCE HAS TO RISE OR THE FILE IS IGNORED.
  const seqOf = (t) => Number((/SEQUENCE:(\d+)/.exec(t) || [])[1]);
  const later = clone(dateMoved);
  later.isoUpdated = '2027-06-01T10:00:00.000Z';
  const laterText = Buffer.from(
    mail.sessionsIcs(later, REM.movedSessions(base, later, NOW).map((m) => m.session), 'en')
      .content, 'base64').toString('utf8');
  H.ok(seqOf(laterText) > seqOf(text),
    'a record saved later carries a higher sequence, so the update is applied');

  console.log('\n[and it reads in the language of the ACCOUNT, in all three]');
  //
  // A message is written in the language of the account and a screen in the
  // language of the page — the rule the group-move message had to learn. A key
  // quietly left holding the English is invisible to a reviewer who does not read
  // the language, so each one is checked for its own script.
  const SCRIPT = { he: /[\u0590-\u05FF]/, en: /[A-Za-z]/, ru: /[\u0400-\u04FF]/ };
  const fakeReg = { frozen: { activityTitle: { he: '\u05de\u05d5\u05e2\u05d3\u05d5\u05df', en: 'Club', ru: '\u041a\u043b\u0443\u0431' },
                              participantName: 'Noa' },
                    participantId: 'p1', activityId: AID };
  ['he', 'en', 'ru'].forEach((l) => {
    const acct = { email: 'x@example.com', profile: { preferredLanguage: l } };
    const moves = mail.movesFor(REM.movedSessions(base, dateMoved, NOW), l);
    H.eq(moves.length, 1, l + ': one move to describe');
    const msg = mail.sessionsMovedMessage(fakeReg, acct, { moves: moves, names: ['Noa'],
      hasIcs: true });
    H.ok(SCRIPT[l].test(msg.subject), l + ': the subject is in that language');
    H.ok(SCRIPT[l].test(msg.html), l + ': and so is the body');
    H.ok(msg.html.indexOf(moves[0].now) !== -1, l + ': it names the new date');
    H.ok(msg.html.indexOf(moves[0].was) !== -1, l + ': and the one it used to be on');
    // ⚠ NO CANCELLATION TERMS. Those ride on the two messages that mean "you are
    // in", where somebody is deciding — the same rule the reminder keeps.
    H.ok(!/#pay/.test(msg.html),
      l + ': and the link goes to the facts rather than the cost card');
  });
  // The plural forms are the language's own, not one helper approximating three.
  ['he', 'en', 'ru'].forEach((l) => {
    const acct = { email: 'x@example.com', profile: { preferredLanguage: l } };
    const one = mail.sessionsMovedMessage(fakeReg, acct,
      { moves: mail.movesFor(REM.movedSessions(base, dateMoved, NOW), l), names: ['Noa'] });
    const many = mail.sessionsMovedMessage(fakeReg, acct,
      { moves: mail.movesFor(REM.movedSessions(base, hourMoved, NOW), l), names: ['Noa'] });
    H.ok(one.subject !== many.subject,
      l + ': one session and several do not read the same');
  });

  console.log('\n[and it fires on the publish, to the people expected]');

  const blobs = H.makeBlobs();
  const github = H.makeGithub({
    'activities/term.json': JSON.stringify(base),
    'activities/activities-index.json': JSON.stringify(
      [{ slug: 'term', activityId: AID, status: 'open', langs: ['he', 'en', 'ru'],
         title: base.title }])
  });
  const mods = H.loadWithStubs({ blobs, github,
    modules: ['_registration-store', '_registration-fallout', '_reminder-store',
              'account-auth', 'account-family', 'account-registrations'] });
  const store = mods['_registration-store'];
  const fallout = mods['_registration-fallout'];
  const prefs = mods['_reminder-store'];
  const auth = mods['account-auth'];
  const family = mods['account-family'];
  const api = mods['account-registrations'];

  const sent = [];
  require(H.fnPath('_email'))._internal.setTransport({
    emails: { send: async (m) => { sent.push(m); return { data: { id: 'e-' + sent.length } }; } }
  });

  // Dana has two children in group one; Yossi has one child in group two.
  const dana = await H.signUp(auth, blobs, { email: 'dana@example.com',
    profile: { firstName: 'Dana', preferredLanguage: 'en' } });
  const yossi = await H.signUp(auth, blobs, { email: 'yossi@example.com',
    profile: { firstName: 'Yossi', preferredLanguage: 'en' } });
  const join = async (up, first, groupId) => {
    const made = await H.call(family.handler, { action: 'createParticipant',
      token: up.body.token,
      participant: { firstName: first, lastName: 'Levi', dateOfBirth: '2016-05-05' } });
    await H.call(api.handler, { action: 'submit', token: up.body.token, slug: 'term',
      participantId: made.body.participant.participantId, groupId: groupId });
    return made.body.participant.participantId;
  };
  await join(dana, 'Noa', G1);
  await join(dana, 'Ari', G1);
  await join(yossi, 'Tal', G2);
  sent.length = 0;

  let out = await fallout.afterPublish(dateMoved, base, { now: NOW });
  H.ok(out && out.sessions, 'the publish reports what it did to the calendar');
  H.eq(out.sessions.moved, 1, 'one session moved');
  H.eq(out.sessions.told, 1, '⚠ and ONE family was told — the one whose group it was');
  H.eq(sent.length, 1, 'one message');
  H.eq(rcpt(sent[0]), 'dana@example.com', 'to the account whose children are in that group');
  H.ok(/Ari Levi and Noa Levi are registered/.test(sent[0].html),
    '⚠ naming BOTH children in one message rather than sending two near-identical ones');
  H.ok(/Session 3/.test(sent[0].html), 'saying which session');
  H.ok(sent[0].html.indexOf('was') !== -1, 'and what it was before');
  // ⚠ NOT AN ARROW. A directional glyph on a site that renders the same sentence
  // in two directions is the trap the hamburger chevron was rebuilt out of.
  H.ok(sent[0].html.indexOf('→') === -1 && sent[0].html.indexOf('&rarr;') === -1,
    'with a WORD between the two dates, never an arrow');
  H.ok((sent[0].attachments || []).length === 1, 'and a calendar file is attached');
  H.ok(Buffer.from(sent[0].attachments[0].content, 'base64').toString('utf8')
        .indexOf('UID:' + uid) !== -1,
    'carrying the entry that family already holds');

  // The group name only when there is a choice to have made, and only when all
  // of this family's moves are in ONE of them.
  H.ok(/Group:/.test(sent[0].html), 'the group is named, because this activity offers two');

  sent.length = 0;
  out = await fallout.afterPublish(hourMoved, base, { now: NOW });
  H.eq(out.sessions.moved, 4, 'a changed hour moves four');
  H.eq(sent.length, 1, 'and is still one message to that family');
  H.eq((Buffer.from(sent[0].attachments[0].content, 'base64').toString('utf8')
         .match(/BEGIN:VEVENT/g) || []).length, 4, 'with four events in one file');

  console.log('\n[the switch that silences it, and the one that does not]');

  // ⚠ THE FAMILY'S OWN REMINDER SWITCH DOES NOT SILENCE THIS, and that is the
  // decision rather than an oversight. They asked not to be reminded about
  // classes they already know about; a class moving is news about what they
  // signed up for, and the unsubscribe copy promises other messages are not
  // affected.
  await prefs.setOff(dana.body.account.accountId, AID, true);
  sent.length = 0;
  out = await fallout.afterPublish(dateMoved, base, { now: NOW });
  H.eq(out.sessions.told, 1,
    '⚠ a family who switched REMINDERS off is still told their session moved');
  await prefs.setOff(dana.body.account.accountId, AID, false);

  // The ACTIVITY-level switch does silence it: with it off this activity has
  // never put an entry in anybody's calendar, so there is nothing of ours to
  // correct.
  const quiet = clone(dateMoved);
  quiet.registration.sessionReminders = false;
  const quietBase = clone(base);
  quietBase.registration.sessionReminders = false;
  sent.length = 0;
  out = await fallout.afterPublish(quiet, quietBase, { now: NOW });
  H.eq((out && out.sessions ? out.sessions.told : 0), 0,
    'the per-activity switch turns the calendar mail off, this included');
  H.eq(sent.length, 0, 'and nothing was sent');

  // A rehearsal reminds nobody, the same exclusion the clash report makes.
  const rehearsal = clone(dateMoved);
  rehearsal.listing = 'test';
  const rehearsalBase = clone(base);
  rehearsalBase.listing = 'test';
  sent.length = 0;
  await fallout.afterPublish(rehearsal, rehearsalBase, { now: NOW });
  H.eq(sent.length, 0, '⚠ a test activity tells nobody — its families are staff');

  console.log('\n[a drop-in is asked about the evening that is going away]');
  //
  // ⚠ THE ONE SHAPE WHERE OLD AND NEW ARE DIFFERENT QUESTIONS. A booking is keyed
  // by evening — `att-<pid>__<aid>__<date>` — so the people to tell are booked on
  // the date that is DISAPPEARING. Looking them up on the new one finds an empty
  // evening and tells nobody, silently, in exactly the case where somebody is
  // about to turn up on the wrong day. A source-level assertion can see which
  // date is passed and can never see what that costs, so this executes it.
  const DIN = 'act-00000000000000f2';
  const EVE = [D(20), D(27)];
  const dropin = {
    slug: 'evenings', activityId: DIN, type: 'dropin', status: 'open',
    title: { he: 'ערב', en: 'Evening', ru: 'Вечер' },
    isoUpdated: '2027-01-01T10:00:00.000Z',
    facts: { price: { registrationFee: 0, perSessionPrice: 7 }, groupSize: {} },
    registration: { autoApprove: true, pendingExpiryDays: null,
      registrationFeeCutoffDate: 'none', sessionCancelHours: 24,
      cancellationPolicy: { mode: 'flat', cancellationCutoffDate: 'none' }, defaultBasis: null },
    groups: [{ groupId: 'grp-dddd', name: { he: '', en: '', ru: '' }, capacity: 9,
      teacherIds: [],
      facts: { schedule: { frequency: 'weekly', sessions: [{ day: 'friday', time: '19:30' }] },
        duration: { startDate: EVE[0], endDate: EVE[1], sessionMinutes: 90,
          sessionDates: dates(EVE) } } }]
  };
  // ⚠ _files IS A Map. Assigning a property on it sets a key nothing reads, and
  // the handler then answers "no such activity" — which looks exactly like the
  // feature not firing.
  github._files.set('activities/evenings.json', JSON.stringify(dropin));
  github._files.set('activities/activities-index.json', JSON.stringify([
    { slug: 'term', activityId: AID, status: 'open', langs: ['he', 'en', 'ru'], title: base.title },
    { slug: 'evenings', activityId: DIN, status: 'open', langs: ['he', 'en', 'ru'],
      title: dropin.title }]));
  const book = require(H.fnPath('_session-attendance'));
  const tal = await H.call(family.handler, { action: 'listParticipants', token: yossi.body.token });
  const talId = tal.body.participants[0].participantId;
  await H.call(api.handler, { action: 'submit', token: yossi.body.token, slug: 'evenings',
    participantId: talId });
  await book.saveAttendance(book.newAttendance({
    activity: dropin, participantId: talId, accountId: yossi.body.account.accountId,
    groupId: 'grp-dddd', sessionDate: EVE[1], by: 'self' }));

  const eveMoved = clone(dropin);
  eveMoved.groups[0].facts.duration.sessionDates[1].date = D(28);
  sent.length = 0;
  out = await fallout.afterPublish(eveMoved, dropin, { now: NOW });
  H.eq(out.sessions.moved, 1, 'the evening moved');
  H.eq(out.sessions.told, 1,
    '⚠ and the family BOOKED ON THE OLD DATE was told — found on the date going away');
  H.eq(rcpt(sent[0]), 'yossi@example.com', 'the one who booked it');
  // ⚠ AND THE OTHER EVENING IS NOT EVERYBODY'S BUSINESS. Moving the FIRST one
  // changes nothing about the second, so the family booked on the second hears
  // nothing — which is the half a "tell everyone registered" rule would get
  // wrong, and the reason a drop-in is asked per evening rather than per
  // activity.
  const firstMoved = clone(dropin);
  firstMoved.groups[0].facts.duration.sessionDates[0].date = D(21);
  sent.length = 0;
  out = await fallout.afterPublish(firstMoved, dropin, { now: NOW });
  H.eq(out.sessions.moved, 1, 'moving the first evening moves one entry');
  H.eq(out.sessions.told, 0,
    '⚠ and tells nobody: the only booking is on the evening that did not move');
  H.eq(sent.length, 0, 'so no message went out');

  console.log('\n[an ordinary publish costs nothing]');

  const quietCounts = blobs._counts().reads;
  const reworded = clone(base);
  reworded.title = { he: 'מועדון', en: 'Club night', ru: 'Клуб' };
  out = await fallout.afterPublish(reworded, base, { now: NOW });
  H.eq(out, null, 'a publish that moved no date, no cutoff and no cap does nothing');
  H.eq(blobs._counts().reads, quietCounts,
    '⚠ and reads no store at all — the comparison is pure, so it IS the pre-check');

  console.log('\n[one rule for who is expected, not two]');

  const src = fs.readFileSync(H.fnPath('_registration-fallout'), 'utf8');
  H.ok(/sweep\.peopleFor\(/.test(src),
    '⚠ the publish asks the SWEEP who is expected rather than working it out again');
  H.ok(!/guardiansOf|_guardian-store/.test(src),
    'and does not reach for the guardian store itself, which is how the two would drift');
  H.ok(/require\('\.\/_registration-sweep'\)/.test(src) &&
       src.indexOf("require('./_registration-sweep')") > src.indexOf('async function announceMovedSessions'),
    'required lazily, inside the one branch that needs it');
  const sweepSrc = fs.readFileSync(H.fnPath('_registration-sweep'), 'utf8');
  H.ok(/peopleFor, mapCapped/.test(sweepSrc), 'and the sweep exports it on purpose');

  // ⚠ ON A DROP-IN THE RECIPIENTS ARE LOOKED UP ON THE DATE THAT IS GOING AWAY.
  // A booking is keyed by evening, so the people to tell are booked on the OLD
  // date; asking about the new one finds an empty evening and tells nobody, in
  // the one case where somebody is about to turn up on the wrong day.
  H.ok(/date: m\.was\.date/.test(src),
    '⚠ the lookup uses the OLD date, or a drop-in tells nobody at all');

  // The cap is named rather than silent: a publish happens once, so a family
  // past it is a family nobody tells unless an admin reads the notice.
  const ui = fs.readFileSync(require('path').join(__dirname, '..', 'js/activities-admin.js'), 'utf8');
  H.ok(/over the per-publish cap/.test(ui), 'the overflow is said on the screen');
  H.ok(/sessions \|\| \{\}\)\.deferred/.test(ui.replace(/\s+/g, ' ')) ||
       /deferred/.test(ui.slice(ui.indexOf('function falloutBad'), ui.indexOf('function falloutLine'))),
    'and it colours the notice, because it is something that did NOT happen');
  const adminSrc = fs.readFileSync(H.fnPath('activities-admin'), 'utf8');
  H.ok(/session\(s\) moved/.test(adminSrc), 'and it is in the audit trail too');

  H.done();
})();
