// What this defends against:
//
// ⚠ A FAMILY COULD CANCEL AND RECEIVE NOTHING AT ALL. Every other state change
// on a registration sent a message — registered, confirmed, not offered, we did
// not answer in time, payment received — and cancelling sent silence. The only
// trace was a reason typed into the history for an admin to read later.
//
// That was survivable while the confirmation called a registration a "request".
// It stopped being survivable the moment the confirmation started saying
// REGISTERED: a place a family was told they had, taken away with no message, is
// the one gap in this sequence they would notice and could not explain.
//
// Four rules, each of which could have gone the other way:
//
//  1. THE FIGURE COMES FROM THE LEDGER ENTRY THAT WAS WRITTEN, never from a
//     second call to creditFor(). Two computations of one number is how an email
//     and a ledger come to disagree about what somebody is owed, and the family
//     reads the email.
//  2. AFTER THE LEDGER, NEVER BEFORE. The email rule here is that a send never
//     blocks the action; the money rule is the opposite, and the money rule
//     decides the ORDER. A credit not written is money lost with nobody able to
//     tell; a message not sent leaves a person who can ask.
//  3. NO CREDIT LINE WHEN THE CREDIT IS ZERO. Nothing on this site has collected
//     money yet, so every cancellation today credits nothing — and "credited
//     €0.00" reads as a decision taken against the family rather than as the
//     arithmetic of an activity nobody has paid for.
//  4. TWO SEND PATHS, ONE MESSAGE. A guardian cancelling their own place gets it
//     immediately, because nobody is at a screen to review it. An admin
//     cancelling somebody else's reviews it first, exactly as a rejection is
//     reviewed. The difference is one optional argument.
//
// And one guard the rejection panel did not need: this draft carries MONEY. The
// cutoffs are days, so a panel opened at 23:59 and sent at 00:01 can straddle
// one — and then the family would be told a figure nobody credited them. The
// draft's number is sent back and compared before anything is cancelled.

const H = require('./_helpers');
const F = require('./_fixtures');
const fs = require('fs');
const path = require('path');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');

process.env.RESEND_FROM = 'Merkaz Ogen <noreply@ogen.cy>';

(async () => {
  const blobs = H.makeBlobs();
  const activity = F.course({ slug: 'term', activityId: 'act-0000000000000x01' });
  const github = H.makeGithub({ 'activities/term.json': JSON.stringify(activity) });

  const mods = H.loadWithStubs({
    blobs, github,
    modules: ['_session-store', '_registration-store', '_credit-ledger', 'account-auth',
              'account-family', 'account-registrations', 'admin-registrations',
              '_registration-email']
  });
  const store = mods['_registration-store'];
  const ledger = mods['_credit-ledger'];
  const auth = mods['account-auth'];
  const family = mods['account-family'];
  const regs = mods['account-registrations'];
  const adminRegs = mods['admin-registrations'];
  const mail = mods['_registration-email'];

  const sent = [];
  let failNext = false;
  require(H.fnPath('_email'))._internal.setTransport({
    emails: { send: async (a) => {
      if (failNext) { failNext = false; throw new Error('Resend is down'); }
      sent.push(a);
      return { data: { id: 'id-' + sent.length } };
    } }
  });

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
  const target = { participantId: noa, activityId: activity.activityId };
  const submit = () => H.call(regs.handler,
    { action: 'submit', token: dana.token, slug: 'term', participantId: noa });

  console.log('[the message itself: three languages, and no €0.00]');
  const reg = { participantId: 'p-1', activityId: 'act-1',
    frozen: { participantName: 'Noa Levi', activityTitle: { he: 'עברית', en: 'Hebrew', ru: 'Иврит' } } };
  ['he', 'en', 'ru'].forEach((l) => {
    const acct = { email: 'd@e.com', profile: { preferredLanguage: l } };
    const zero = mail.cancelledMessage(reg, acct, 0);
    const paid = mail.cancelledMessage(reg, acct, 15000);
    H.ok(zero.subject && zero.html && zero.text, l + ': a cancellation with no credit renders');
    H.ok(zero.html.indexOf('0.00') === -1,
      l + ': AND SAYS NOTHING ABOUT €0.00 — that reads as a decision taken against the family');
    H.ok(paid.html.indexOf('150.00') !== -1, l + ': a real credit is stated');
    H.ok(paid.html.length > zero.html.length, l + ': as one extra sentence, not a different message');
  });

  console.log('\n[a guardian cancelling their own place is told, with no review]');
  await submit();
  let before = sent.length;
  const own = await H.call(regs.handler, Object.assign({ action: 'cancel', token: dana.token }, target));
  H.eq(own.status, 200, 'the cancellation goes through');
  H.eq(sent.length, before + 1, 'and exactly one message follows it');
  const mine = sent[sent.length - 1];
  H.eq([].concat(mine.to)[0], 'dana@example.com', 'to the family');
  H.ok(/Запись/.test(mine.subject), 'in RUSSIAN — the language they read, not the admin\'s');
  H.ok(mine.html.indexOf('0.00') === -1, 'with no credit line, because nothing was credited');

  console.log('\n[the figure is the LEDGER\'s, not a second computation]');
  // Put money on the record so a cancellation credits something real.
  await submit();
  let live = await store.getRegistration(noa, activity.activityId);
  live.payment = Object.assign({}, live.payment, { paidCents: 30000 });
  await store.saveRegistration(live);
  before = sent.length;
  const paidCancel = await H.call(regs.handler,
    Object.assign({ action: 'cancel', token: dana.token }, target));
  H.eq(paidCancel.status, 200, 'it goes through');
  const entry = paidCancel.body.entry;
  H.ok(entry && entry.amountCents > 0, 'a ledger entry was written');
  const withMoney = sent[sent.length - 1];
  const euros = '€' + (entry.amountCents / 100).toFixed(2);
  H.ok(withMoney.html.indexOf(euros) !== -1,
    'and the email states THAT figure — ' + euros + ' — the one the ledger recorded');
  const entries = await ledger.entriesFor(dana.accountId);
  H.eq(entries.filter((e) => e.amountCents === entry.amountCents).length, 1,
    'one entry, one figure, one sentence');

  console.log('\n[the ledger is written even when the message is not]');
  await submit();
  live = await store.getRegistration(noa, activity.activityId);
  live.payment = Object.assign({}, live.payment, { paidCents: 30000 });
  await store.saveRegistration(live);
  const ledgerBefore = (await ledger.entriesFor(dana.accountId)).length;
  failNext = true;
  const broke = await H.call(regs.handler,
    Object.assign({ action: 'cancel', token: dana.token }, target));
  H.eq(broke.status, 200, 'a mail failure does not take the cancellation down');
  H.eq((await ledger.entriesFor(dana.accountId)).length, ledgerBefore + 1,
    'AND THE CREDIT IS STILL THERE — money not written is money lost with nobody able to tell');

  console.log('\n[the admin reviews it first, in the family\'s language]');
  await submit();
  const session = await H.installSession(blobs, H.superAdminSession({ token: 'adm', email: 'a@ogen.cy' }));
  const adm = (body) => H.call(adminRegs.handler, Object.assign({ token: session.token }, body));
  const draft = await adm(Object.assign({ action: 'cancelPreview' }, target));
  H.eq(draft.status, 200, 'the draft is served');
  H.eq(draft.body.lang, 'ru', 'in the family\'s language');
  H.ok(draft.body.subject && draft.body.bodyHtml, 'with something to edit');
  H.eq(typeof draft.body.creditCents, 'number', 'and the figure it was written against');
  H.eq((await store.getRegistration(noa, activity.activityId)).status, 'pending',
    'previewing decides nothing');

  console.log('\n[⚠ and refuses to send a figure that has moved since]');
  const stale = await adm(Object.assign({ action: 'cancel', message: {
    subject: 'About the place', bodyHtml: '<p>Sorry.</p>',
    basedOnCreditCents: draft.body.creditCents + 500
  } }, target));
  H.eq(stale.status, 409, 'a draft written against a different figure is refused');
  H.eq(stale.body.reason, 'credit-moved', 'with a reason the screen can act on');
  H.eq((await store.getRegistration(noa, activity.activityId)).status, 'pending',
    'and NOTHING WAS CANCELLED — the check runs before the irreversible part');

  console.log('\n[a sanitised, edited message is what arrives]');
  before = sent.length;
  const done = await adm(Object.assign({ action: 'cancel', note: 'mother rang', message: {
    subject: 'About the place',
    bodyHtml: '<p onclick="x()">We are sorry to see you go.</p><script>alert(1)</script>',
    basedOnCreditCents: draft.body.creditCents
  } }, target));
  H.eq(done.status, 200, 'it goes through');
  H.eq(done.body.emailed, true, 'and reports that the message went');
  const edited = sent[sent.length - 1];
  H.ok(/We are sorry to see you go\./.test(edited.html), 'the words are the admin\'s');
  H.ok(!/onclick|<script/i.test(edited.html), 'and nothing dangerous reached the inbox');
  H.eq(edited.subject, 'About the place', 'with the edited subject');
  // The internal note is for us. Putting it in the family's copy is how "mother
  // says they are moving abroad" ends up in somebody's inbox.
  H.ok(edited.html.indexOf('mother rang') === -1, 'and the INTERNAL note is not in it');
  const cancelled = await store.getRegistration(noa, activity.activityId);
  H.ok(JSON.stringify(cancelled.history).indexOf('mother rang') !== -1,
    'the note is in the history, where an admin will look for it');

  console.log('\n[a blank message is refused before anything is cancelled]');
  await submit();
  const blank = await adm(Object.assign({ action: 'cancel', message: {
    subject: 'x', bodyHtml: '<p><br></p>', basedOnCreditCents: 0
  } }, target));
  H.eq(blank.status, 400, 'an empty body is a mistake, not a blank cancellation notice');
  H.eq((await store.getRegistration(noa, activity.activityId)).status, 'pending',
    'and the registration still stands');

  console.log('\n[the wiring]');
  H.ok(/registration-cancelled/.test(read('netlify/functions/_email-log.js')),
    'the template is in the log, so a bounce on this one is visible too');
  H.ok(/'registration-cancelled': \{[^}]*resend: false/.test(read('netlify/functions/_email-log.js')),
    'and is NOT resendable — it describes a moment that has passed, and carries a figure');
  const guardian = read('netlify/functions/account-registrations.js');
  H.ok(guardian.indexOf('await cancelAndCredit(') < guardian.indexOf('mail.sendCancelled'),
    'the guardian path sends AFTER the ledger, never before');
  H.ok(/sendCancelled\(done\.registration, me,\s*\n?\s*\(done\.entry && done\.entry\.amountCents\) \|\| 0\)/.test(guardian),
    'with the figure the ENTRY recorded');
  H.ok(!/creditFor/.test(guardian.slice(guardian.indexOf('mail.sendCancelled'))),
    'and never recomputes it afterwards');

  H.done();
})();
