// What this defends against:
//
// ⚠ AN ADMIN COULD MOVE A CHILD INTO A DIFFERENT CLASS AND NOBODY WAS TOLD.
//
// `moveGroup` exists so that correcting a group does not have to go through
// cancel-and-re-register — which writes a credit, sends a cancellation email and
// re-freezes the price at today's figure, all to fix a dropdown. It saved the
// record, named both groups in the history, wrote the audit line, and sent the
// family nothing. Reported from QA in one line: "I moved one person who
// registered to another group, but no email notification was sent."
//
// It is the same gap a cancellation had before it got a message, and it is
// worse in one respect. Every other state change on a registration is about
// whether there is a place; this one is about WHICH ROOM A CHILD WALKS INTO.
// Under the equal-hours rule two groups may meet on different days, at a
// different hour, in a different place, with different teachers — so a silent
// move is a family turning up to the old group, on the old day, and finding
// nobody there.
//
// Four rules, each of which could have gone the other way:
//
//  1. THE GROUP NAMES ARE PICKED IN THE ACCOUNT'S LANGUAGE, not the caller's.
//     The caller is a request handler whose language is the language of the
//     ADMIN'S screen; the message is written in the language of the family. A
//     handler that picked would send a Russian family an English group name —
//     the same bug the waiting-list messages had with a date.
//  2. LIVE ROWS ONLY. A cancelled or expired registration is not a class
//     anybody attends, so a note about which group it is filed under is news
//     about nothing.
//  3. AFTER THE SAVE, NEVER BLOCKING IT. The move stands whether or not the
//     message goes, exactly as an approval does, and `emailed` says which — an
//     admin left believing a family was told would let them arrive at the old
//     group.
//  4. NO DRAFT TO REVIEW. A rejection and a cancellation are reviewed because
//     approval carries no reason code and money is about to move. A move has
//     nothing to word: the two names are the whole of it.
//
// And the link has no `#pay` on it. Every other message about a live
// registration is partly about money and scrolls to the cost card; this one is
// about when and where, and the facts are at the top of the page.

const H = require('./_helpers');
const F = require('./_fixtures');
const fs = require('fs');
const path = require('path');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');

process.env.RESEND_FROM = 'Merkaz Ogen <noreply@ogen.cy>';

(async () => {
  const blobs = H.makeBlobs();
  const activity = F.course({
    slug: 'term', activityId: 'act-0000000000000x01',
    facts: Object.assign({}, F.rawCourse().facts, { groupSize: F.NAMED })
  });
  const github = H.makeGithub({ 'activities/term.json': JSON.stringify(activity) });

  const mods = H.loadWithStubs({
    blobs, github,
    modules: ['_session-store', '_registration-store', 'account-auth', 'account-family',
              'account-registrations', 'admin-registrations', '_registration-email']
  });
  const store = mods['_registration-store'];
  const auth = mods['account-auth'];
  const family = mods['account-family'];
  const regs = mods['account-registrations'];
  const adminRegs = mods['admin-registrations'];
  const mail = mods['_registration-email'];

  const beginners = activity.groups[0];
  const advanced = activity.groups[1];

  const sent = [];
  let failNext = false;
  require(H.fnPath('_email'))._internal.setTransport({
    emails: { send: async (a) => {
      if (failNext) { failNext = false; throw new Error('Resend is down'); }
      sent.push(a);
      return { data: { id: 'id-' + sent.length } };
    } }
  });

  // ---------------------------------------------------------------- the words
  console.log('[the message itself, in three languages]');
  const reg = { participantId: 'p-1', activityId: 'act-1',
    frozen: { participantName: 'Noa Levi',
              activityTitle: { he: 'עברית', en: 'Hebrew', ru: 'Иврит' } } };
  const CHECK = {
    he: { from: 'מתחילים', to: 'מתקדמים' },
    en: { from: 'Beginners', to: 'Advanced' },
    ru: { from: 'Начинающие', to: 'Продолжающие' }
  };
  ['he', 'en', 'ru'].forEach((l) => {
    const acct = { email: 'd@e.com', profile: { preferredLanguage: l } };
    const msg = mail.movedMessage(reg, acct, beginners.name, advanced.name);
    H.ok(msg.subject && msg.html && msg.text, l + ': it renders');
    H.ok(msg.html.indexOf(CHECK[l].from) !== -1, l + ': it names the group they came OUT of');
    H.ok(msg.html.indexOf(CHECK[l].to) !== -1, l + ': and the one they are going into');
    H.ok(msg.subject.indexOf(CHECK[l].to) !== -1, l + ': the subject names the new group');
    H.ok(msg.html.indexOf('Noa Levi') !== -1, l + ': and the participant, because a family has several');
    // ⚠ THE NAMES ARE PICKED IN THE READER'S LANGUAGE. A Russian family must not
    // be handed "Advanced" in a Russian sentence.
    ['he', 'en', 'ru'].filter((o) => o !== l).forEach((other) => {
      H.ok(msg.html.indexOf(CHECK[other].to) === -1,
        l + ': and NOT in ' + other + ' — the names follow the account, not the caller');
    });
  });

  console.log('\n[what it does and does not say]');
  const en = mail.movedMessage(reg, { email: 'd@e.com', profile: { preferredLanguage: 'en' } },
                               beginners.name, advanced.name);
  H.ok(/different day|different hour|different place|teachers/.test(en.html),
    'it says the groups can meet differently — which is the whole reason this is news');
  H.ok(/price has not changed/.test(en.html),
    'and that the price has not moved: one fullPrice buys the same teaching either way');
  H.ok(!/€/.test(en.html), 'with no figure in it — there is no figure, and one would invite arithmetic');
  H.ok(!/pending|approval|request|queue/i.test(en.html),
    'and nothing about our queue: a move is a fact, not a decision being taken');
  // `&` is escaped in an href, as it must be in HTML.
  H.ok(/\?p=p-1&(amp;)?a=act-1/.test(en.html), 'the link is the registration page, by its own key');
  H.ok(en.html.indexOf('#pay') === -1,
    '⚠ AND CARRIES NO #pay — this message is about when and where, not about money');

  console.log('\n[a registration that was never in a group]');
  // Taken while the activity was still pooled: there is no group it came out
  // of, so the sentence says where it landed rather than naming a blank.
  const placed = mail.movedMessage(reg, { email: 'd@e.com', profile: { preferredLanguage: 'en' } },
                                   null, advanced.name);
  H.ok(placed.html.indexOf('Advanced') !== -1, 'it names where they are now');
  H.ok(!/from\s+to|from\s+Advanced/.test(placed.html), 'and does not report a move out of nothing');

  // ------------------------------------------------------------- the real move
  console.log('\n[a real move writes to the family, once]');
  const r = await H.signUp(auth, blobs, {
    action: 'signup', email: 'dana@example.com', password: 'password-123', termsAccepted: true,
    profile: { firstName: 'Dana', preferredLanguage: 'ru' }
  });
  const dana = { token: r.body.token, accountId: r.body.account.accountId };
  const made = await H.call(family.handler, {
    action: 'createParticipant', token: dana.token,
    participant: { firstName: 'Noa', lastName: 'Levi', dateOfBirth: '2017-04-02' }
  });
  const noa = made.body.participant.participantId;
  const submitted = await H.call(regs.handler, {
    action: 'submit', token: dana.token, slug: 'term',
    participantId: noa, groupId: beginners.groupId
  });
  H.eq(submitted.status, 200, 'the family registers into Beginners');

  const session = await H.installSession(blobs, H.superAdminSession({ token: 'adm', email: 'a@ogen.cy' }));
  const adm = (body) => H.call(adminRegs.handler, Object.assign({ token: session.token }, body));

  let before = sent.length;
  const moved = await adm({ action: 'moveGroup', slug: 'term',
                            participantId: noa, groupId: advanced.groupId });
  H.eq(moved.status, 200, 'the admin moves them');
  H.eq(moved.body.emailed, true, 'and is told the message went');
  H.eq(sent.length, before + 1, 'exactly one message follows — not one per redraw');
  const note = sent[sent.length - 1];
  H.eq([].concat(note.to)[0], 'dana@example.com', 'to the family');
  H.ok(/Продолжающие/.test(note.html),
    'IN RUSSIAN, naming the Russian group name — the language they read, not the admin\'s');
  H.ok(note.html.indexOf('Advanced') === -1, 'and not the English one the handler itself uses');
  H.eq((await store.getRegistration(noa, activity.activityId)).groupId, advanced.groupId,
    'and the registration really moved');

  console.log('\n[the move stands when the message does not]');
  before = sent.length;
  failNext = true;
  const broke = await adm({ action: 'moveGroup', slug: 'term',
                            participantId: noa, groupId: beginners.groupId });
  H.eq(broke.status, 200, 'a mail failure does not take the move down');
  H.eq(broke.body.emailed, false, 'AND SAYS SO — an admin must not believe a family was told');
  H.eq(sent.length, before, 'nothing was sent');
  H.eq((await store.getRegistration(noa, activity.activityId)).groupId, beginners.groupId,
    'and the move went through anyway');

  console.log('\n[a registration that is over is not news]');
  let over = await store.getRegistration(noa, activity.activityId);
  over.status = 'cancelled';
  await store.saveRegistration(over);
  before = sent.length;
  const dead = await adm({ action: 'moveGroup', slug: 'term',
                           participantId: noa, groupId: advanced.groupId });
  H.eq(dead.status, 200, 'the record can still be filed differently');
  H.eq(sent.length, before,
    'and NOTHING is sent — a cancelled place is not a class anybody is attending');
  H.eq(dead.body.emailed, null, 'which the answer reports as "not attempted", not as a failure');

  // ---------------------------------------------------------------- the wiring
  console.log('\n[the wiring]');
  const server = read('netlify/functions/admin-registrations.js');
  const move = server.slice(server.indexOf("case 'moveGroup'"), server.indexOf("case 'register'"));
  H.ok(move.indexOf('saveRegistration') < move.indexOf('mail.sendMoved'),
    'the send is AFTER the save — the move is the thing that must not be lost');
  H.ok(/R\.LIVE_STATUSES\.indexOf\(next\.status\)/.test(move),
    'and only on a live row, decided server-side rather than trusted from the client');
  H.ok(/sendMoved\(next, account, from, target\.name/.test(move),
    'the NAME BAGS travel, unpicked, so the message can choose the family\'s language');
  H.ok(!/facts\.pick\([^)]*\)[^;]*sendMoved/.test(move), 'the handler never picks one for it');

  const log = read('netlify/functions/_email-log.js');
  H.ok(/'registration-moved': \{/.test(log), 'the template is in the log, so a bounce is visible');
  H.ok(/'registration-moved': \{[^}]*resend: false/.test(log),
    'and is not resendable — a second copy reads as a second move');

  const screen = read('js/registrations-admin.js');
  const cell = screen.slice(screen.indexOf('function groupCell'), screen.indexOf('function actions'));
  H.ok(/emailed === false/.test(cell),
    'and the screen says whether the family was actually told, as the cancel panel does');

  H.done();
})();
