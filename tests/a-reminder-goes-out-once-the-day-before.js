// What this defends against:
//
// This is the first thing on this site that emails a family ON A SCHEDULE, over
// and over, for a year. Every other message here fires because something
// happened once. Three things follow and all three are failure modes nobody
// would notice from reading the code:
//
//   SENDING TWICE. The pass runs nightly and the mark that says "already told"
//   is written to a different store from the one the mail goes through. Get the
//   ORDER wrong — send, then mark — and a send that succeeds while Blobs is
//   having a bad minute leaves no mark, so tomorrow's pass sends again, and the
//   night after, until the session passes. A family gets the same reminder four
//   times about one class.
//
//   SENDING LATE. run()'s other three jobs are repairs: a missed night costs
//   nothing because tomorrow finds the same work. A reminder has a deadline, and
//   "your class is tomorrow" arriving on the morning of the class is not a late
//   message, it is a WRONG one. So a missed session must be reported to a human
//   rather than quietly mailed out.
//
//   SENDING TO ONE GUARDIAN. A participant can have two, and the parent doing
//   Tuesday's lift is not reliably the one who filled the form in.
//
// None of it is visible by reading: the mark, the order and the recipient set
// all look fine on the page. So the pass is EXECUTED, twice, with the clock
// moved between runs.

process.env.RESEND_FROM = 'Merkaz Ogen <noreply@ogen.cy>';
// The missed-reminder alert goes to the admin address. Without one it cannot be
// sent at all, which is worth knowing: the alert is only as good as this var.
process.env.ADMIN_NOTIFY_EMAIL = 'admin@ogen.cy';
const H = require('./_helpers');
const F = require('./_fixtures');

const AT = (iso) => Date.parse(iso);

(async () => {
  const blobs = H.makeBlobs();

  // A course meeting on three Wednesdays at 16:00.
  const act = F.course({ slug: 'term', activityId: 'act-00000000000000r1' });
  act.groups[0].capacity = 20;
  act.groups[0].facts.duration.sessionDates = [
    { date: '2026-10-14', status: 'scheduled' },
    { date: '2026-10-21', status: 'excluded', reason: 'Half term' },
    { date: '2026-10-28', status: 'scheduled' }
  ];
  act.groups[0].facts.schedule = { frequency: 'weekly', sessions: [{ day: 3, time: '16:00' }] };
  // ⚠ APPROVED, not pending. Only an approved registration is reminded: a family
  // waiting on a decision has no place to turn up to, which is why the pass reads
  // the same single-status list isPayable() does rather than holdsASpot().
  act.registration = Object.assign({}, act.registration, { autoApprove: true });

  const github = H.makeGithub({
    'activities/term.json': JSON.stringify(act),
    'activities/activities-index.json': JSON.stringify(
      [{ slug: 'term', activityId: act.activityId, status: 'open',
         langs: ['he', 'en', 'ru'], title: act.title }])
  });
  const mods = H.loadWithStubs({ blobs, github,
    modules: ['account-auth', 'account-family', 'account-registrations',
              '_registration-sweep', '_registration-store', '_guardian-store',
              '_reminder-store', '_reminder-link'] });

  const sent = [];
  require(H.fnPath('_email'))._internal.setTransport({
    emails: { send: async (m) => { sent.push(m); return { data: { id: 'e-' + sent.length } }; } }
  });

  // Dana registers Noa, and invites a second guardian who accepts.
  const dana = (await H.signUp(mods['account-auth'], blobs,
    { email: 'dana@example.com', firstName: 'Dana' })).body;
  const made = await H.call(mods['account-family'].handler, { action: 'createParticipant',
    token: dana.token, participant: { firstName: 'Noa', lastName: 'Levi', dateOfBirth: '2017-04-02' } });
  const pid = made.body.participant.participantId;
  await H.call(mods['account-registrations'].handler,
    { action: 'submit', token: dana.token, slug: 'term', participantId: pid, lang: 'en' });

  const yuval = (await H.signUp(mods['account-auth'], blobs,
    { email: 'yuval@example.com', firstName: 'Yuval' })).body;
  await mods['_guardian-store'].addLink({ participantId: pid,
    accountId: yuval.account.accountId, addedVia: 'admin' });

  const sweep = mods['_registration-sweep'];
  const prefs = mods['_reminder-store'];
  const toAddrs = () => sent.map((m) => [].concat(m.to).join(',')).sort();

  // ========================================================================
  console.log('[the day before, once, to everybody who guards the child]');
  sent.length = 0;
  let out = await sweep.remindUpcomingSessions(AT('2026-10-13T06:00:00Z'));
  H.eq(out.on, '2026-10-14', 'the pass names the SESSION date it covered, not the date it ran');
  H.eq(out.sent, 2, 'two messages: one per guardian');
  H.eq(toAddrs().join(' | '), 'dana@example.com | yuval@example.com',
    '⚠ BOTH GUARDIANS, not only the account that registered');
  // ⚠ IN THE LANGUAGE OF THE ACCOUNT, not of whatever was running the pass.
  // Hebrew is the default, and the subject says tomorrow and names the hour, so
  // the message is answerable from a notification bar without opening it.
  H.ok(/מחר/.test(sent[0].subject),
    'the subject says tomorrow, in the account\'s own language: ' + sent[0].subject);
  H.ok(/16:00/.test(sent[0].subject), 'and the hour, which is the thing being reminded about');
  H.ok(sent[0].attachments && sent[0].attachments.length === 1,
    'and it carries one calendar file');

  console.log('\n[⚠ and running again sends NOTHING]');
  sent.length = 0;
  out = await sweep.remindUpcomingSessions(AT('2026-10-13T06:30:00Z'));
  H.eq(out.sent, 0, 'the second run of the same night sends nothing at all');
  H.eq(sent.length, 0, 'no message leaves');
  H.eq(out.due, 0, 'because the mark says it already went');
  // ⚠ The mark is per (account, activity, date), which is what makes two
  // children of one family one message rather than two.
  H.ok(await prefs.wasSent(dana.account.accountId, act.activityId, '2026-10-14'),
    'the mark names the account, the activity and the session date');

  console.log('\n[an excluded date is not a session, so nobody is reminded about it]');
  sent.length = 0;
  out = await sweep.remindUpcomingSessions(AT('2026-10-20T06:00:00Z'));
  H.eq(out.sent, 0, '21 October is excluded, so the 20th reminds nobody');
  H.eq(sent.length, 0, 'and sends nothing');

  console.log('\n[the next session is reminded about on its own night]');
  sent.length = 0;
  out = await sweep.remindUpcomingSessions(AT('2026-10-27T06:00:00Z'));
  H.eq(out.sent, 2, 'both guardians again, for 28 October');

  // ========================================================================
  console.log('\n[⚠ A MISSED NIGHT IS REPORTED, NEVER SENT LATE]');
  // A fresh family on a session whose night was missed entirely.
  const amit = (await H.signUp(mods['account-auth'], blobs,
    { email: 'amit@example.com', firstName: 'Amit' })).body;
  const made2 = await H.call(mods['account-family'].handler, { action: 'createParticipant',
    token: amit.token, participant: { firstName: 'Tal', lastName: 'Cohen', dateOfBirth: '2016-02-02' } });
  const pid2 = made2.body.participant.participantId;
  await H.call(mods['account-registrations'].handler,
    { action: 'submit', token: amit.token, slug: 'term', participantId: pid2, lang: 'en' });

  sent.length = 0;
  // The pass runs ON the day of a session it never reminded about.
  out = await sweep.remindUpcomingSessions(AT('2026-10-28T06:00:00Z'));
  const toFamilies = sent.filter((m) => /example\.com/.test([].concat(m.to).join(',')));
  H.eq(toFamilies.length, 0,
    '⚠ NOT ONE message to a family — "your class is tomorrow" on the morning of the class is a worse message than none');
  H.ok(out.missed.length > 0, 'the run names what it skipped: ' + out.missed.length);
  H.eq(out.missed[0].date, '2026-10-28', 'with the date it could not cover');
  H.ok(sent.some((m) => /NOT sent/i.test(m.subject || '')),
    '⚠ and a human is told, because a run result in a function log is not somebody finding out');

  // ========================================================================
  console.log('\n[a family can stop them, for this class and nothing else]');
  const other = F.course({ slug: 'other', activityId: 'act-00000000000000r2' });
  await prefs.setOff(dana.account.accountId, act.activityId, true, 'guardian');
  H.eq(await prefs.isOff(dana.account.accountId, act.activityId), true, 'off for this class');
  H.eq(await prefs.isOff(dana.account.accountId, other.activityId), false,
    '⚠ and ON for every other class — the switch is scoped by activity, by construction');
  H.eq(await prefs.isOff(yuval.account.accountId, act.activityId), false,
    'and it is this ACCOUNT\'s choice: the other guardian still gets theirs');

  // A fresh session, with Dana opted out.
  act.groups[0].facts.duration.sessionDates.push({ date: '2026-11-04', status: 'scheduled' });
  github._files.set('activities/term.json', JSON.stringify(act));
  sent.length = 0;
  out = await sweep.remindUpcomingSessions(AT('2026-11-03T06:00:00Z'));
  H.eq(toAddrs().join(' | '), 'amit@example.com | yuval@example.com',
    '⚠ the one who asked us to stop is not written to — and the other guardian of the SAME child still is, because the switch is one account\'s');

  console.log('\n[and an admin can stop them for everybody on one activity]');
  act.registration = Object.assign({}, act.registration, { sessionReminders: false });
  act.groups[0].facts.duration.sessionDates.push({ date: '2026-11-11', status: 'scheduled' });
  github._files.set('activities/term.json', JSON.stringify(act));
  sent.length = 0;
  out = await sweep.remindUpcomingSessions(AT('2026-11-10T06:00:00Z'));
  H.eq(out.considered, 0, 'the activity is not even considered');
  H.eq(sent.length, 0, 'and nobody is written to');

  H.done();
})();
