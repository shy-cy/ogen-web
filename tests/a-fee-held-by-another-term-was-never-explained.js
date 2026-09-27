// What this defends against:
//
// ⚠ THE CANCELLATION EMAIL STATED A FIGURE AND COULD NOT ACCOUNT FOR IT.
//
// Reported from QA, on the message itself: "€22.00 has been credited to your
// account", against €33.00 paid, with nothing anywhere saying where the other
// €11.00 went — "explain why the registration fee wasn't given back although
// it's still within the right timing, as it shares reg fees with another
// course."
//
// Both figures were right, and the pair was unreadable. test12's `seriesId`
// points at test11, so the yearly fee paid on the autumn is what the spring is
// standing on; giving it back would leave a live term with no fee paid anywhere,
// which is the loophole `feeHeldByLiveTerm()` was written to close. Reproduced
// off the real records: €11 fee + €22 course paid, fee credit 0, course credit
// €22, total €22.00 — the screenshot's figure exactly.
//
// ⚠ AND IT IS THE ONE REASON A FAMILY CANNOT WORK OUT, which is why it is the
// only one this message says. Every other way a credit comes back smaller — the
// step that applies, the fee's own cutoff — is a rule about THIS registration
// and is already in front of them twice: the cancel dialog says it before
// anything is confirmed, and the terms footnote rides in the confirmation and
// the approval. This one is a fact about a DIFFERENT record, appears on no
// screen they have ever seen, and reads as a deduction when it is not.
//
// It is also the one that is not a reproach, which is the half that keeps
// SESSION_CANCELLED's opposite rule intact: "a family told after the fact that
// they were too late is being argued with". Nobody missed a deadline here.
//
// Three properties, and the second is the one that fails silently:
//
//  1. THE WORDS ARE THE DIALOG'S, CHARACTER FOR CHARACTER. A browser cannot
//     require a Netlify function, so the sentence exists twice — pinned here the
//     way MIN_PASSWORD and the activities menu's status groups are. Two wordings
//     of one fact is two accounts of where a family's money went.
//  2. EVERY CALL SITE HANDS THE CREDIT OVER. Absent reads as "no fee is being
//     held", which is the silent direction: a caller that forgets it drops the
//     sentence with nothing erroring. Exactly the shape five callers of
//     creditFor() once had with the clock, and grepped for the same way. The
//     probe written to verify this fix forgot it on its first run.
//  3. IT IS STILL THE LEDGER'S FIGURE. The credit object decides only WHETHER
//     the sentence is said and which of the two it is; the amount comes from the
//     entry, so the email and the ledger cannot arrive at two numbers.

const H = require('./_helpers');
const F = require('./_fixtures');
const fs = require('fs');
const path = require('path');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');

process.env.RESEND_FROM = 'Merkaz Ogen <noreply@ogen.cy>';

// The literal a JS source spells across concatenated string parts.
function literal(src, key) {
  const at = src.indexOf(key + ':');
  if (at === -1) return null;
  const m = /^[^:]*:\s*((?:'(?:[^'\\]|\\.)*'\s*(?:\+\s*)?)+)/.exec(src.slice(at));
  return m ? eval(m[1]) : null; // eslint-disable-line no-eval
}
// Every occurrence of a key, in file order — the three language tables.
function literals(src, key) {
  const out = [];
  let from = 0;
  for (;;) {
    const at = src.indexOf(key + ':', from);
    if (at === -1) return out;
    out.push(literal(src.slice(at), key));
    from = at + 1;
  }
}

(async () => {
  const client = read('js/member-account.js');
  const mailSrc = read('netlify/functions/_registration-email.js');

  // ------------------------------------------------------------------------
  console.log('[the inbox and the dialog say it in the same words]');
  const dialogPartial = literals(client, 'confirmFeeHeld');
  const dialogNothing = literals(client, "'fee-held'");
  const mailPartial = literals(mailSrc, 'feeHeld');
  const mailNothing = literals(mailSrc, 'feeHeldAll');
  H.eq(dialogPartial.length, 3, 'the dialog has the partial sentence in three languages');
  H.eq(dialogNothing.length, 3, 'and the whole-of-it sentence in three languages');
  H.eq(mailPartial.length, 3, 'so does the email');
  H.eq(mailNothing.length, 3, 'both of them');
  [0, 1, 2].forEach((i) => {
    const l = ['he', 'en', 'ru'][i];
    H.ok(dialogPartial[i] && dialogPartial[i].length > 40, l + ': the dialog sentence is real copy');
    H.eq(mailPartial[i], dialogPartial[i],
      l + ': ⚠ the email says it CHARACTER FOR CHARACTER as the dialog does');
    H.eq(mailNothing[i], dialogNothing[i],
      l + ': and so does the version for when the fee was the whole of what was paid');
  });
  // The two are different sentences, or one of them is describing the wrong case.
  [0, 1, 2].forEach((i) => {
    H.ok(mailPartial[i] !== mailNothing[i],
      ['he', 'en', 'ru'][i] + ': part of a figure and the whole of it read differently');
  });

  // ------------------------------------------------------------------------
  // ⚠ ABSENT IS THE SILENT DIRECTION. A call site that forgets the credit drops
  // the sentence and nothing errors, so the omission is greppable and grepped.
  console.log('\n[every caller hands the credit over]');
  ['account-registrations.js', 'admin-registrations.js'].forEach((f) => {
    const src = read('netlify/functions/' + f).replace(/\/\/[^\n]*/g, '');
    ['sendCancelled', 'cancelledDraft'].forEach((fn) => {
      let from = 0;
      for (;;) {
        const at = src.indexOf('mail.' + fn + '(', from);
        if (at === -1) break;
        from = at + 1;
        const call = src.slice(at, src.indexOf(');', at));
        const args = call.split(',').length;
        H.ok(args >= (fn === 'sendCancelled' ? 5 : 4),
          f + ': ' + fn + ' is handed the credit as well as the figure');
        H.ok(/credit|owed/.test(call.split(',').slice(3).join(',')),
          f + ': ' + fn + ' passes the object creditFor() answered with');
      }
    });
  });
  // ⚠ AND THE FIGURE IS STILL THE LEDGER'S. The credit object is allowed to
  // decide whether a sentence is said and nothing else.
  // ⚠ ON COMMENT-STRIPPED SOURCE. The prose above the table now explains what
  // the credit object is FOR and names the function, and a naive search reads
  // the explanation as the thing it forbids — which is the trap the one-rule
  // check for `.activity-card-image img` met in the stylesheet, and the one
  // `getAccounts()`'s skipErrors check met a sentence away.
  const mailCode = mailSrc.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  H.ok(!/creditFor/.test(mailCode),
    'the message module still never computes a credit of its own');

  // ------------------------------------------------------------------------
  // ⚠ EXECUTED, against two linked terms, through the real handler. Reading the
  // source proves the source is self-consistent; it cannot prove that cancelling
  // one term of a series produces a message that mentions the other.
  console.log('\n[a linked term holding the fee, cancelled for real]');
  const blobs = H.makeBlobs();
  const autumn = F.course({ slug: 'autumn', activityId: 'act-0000000000000a01',
                            registration: { autoApprove: true, pendingExpiryDays: null,
                                            registrationFeeCutoffDate: 'none',
                                            cancellationPolicy: { tiers: [{ until: 'none', percent: 100 }] },
                                            defaultBasis: null } });
  // ⚠ THE SPRING POINTS AT THE AUTUMN, which is the whole setup: two DIFFERENT
  // activityIds resolving to ONE seriesId can only have got there because
  // somebody linked them, and that is what waives the second fee.
  const spring = F.course({ slug: 'spring', activityId: 'act-0000000000000a02',
                            seriesId: 'act-0000000000000a01',
                            registration: { autoApprove: true, pendingExpiryDays: null,
                                            registrationFeeCutoffDate: 'none',
                                            cancellationPolicy: { tiers: [{ until: 'none', percent: 100 }] },
                                            defaultBasis: null } });
  const github = H.makeGithub({
    'activities/autumn.json': JSON.stringify(autumn),
    'activities/spring.json': JSON.stringify(spring)
  });
  const mods = H.loadWithStubs({ blobs, github,
    modules: ['_session-store', '_registration-store', '_credit-ledger', 'account-auth',
              'account-family', 'account-registrations', '_registration-email'] });
  const store = mods['_registration-store'];
  const auth = mods['account-auth'];
  const family = mods['account-family'];
  const regs = mods['account-registrations'];

  const sent = [];
  require(H.fnPath('_email'))._internal.setTransport({
    emails: { send: async (a) => { sent.push(a); return { data: { id: 'id-' + sent.length } }; } }
  });

  const signed = await H.signUp(auth, blobs, {
    action: 'signup', email: 'dana@example.com', password: 'password-123', termsAccepted: true,
    profile: { firstName: 'Dana', preferredLanguage: 'en' }
  });
  const dana = { token: signed.body.token, accountId: signed.body.account.accountId };
  const acct = await mods['_session-store'] && null; // unused; kept out of the way
  await H.call(auth.handler, { action: 'verifyEmail', token: dana.token }).catch(() => {});
  // The address has to be confirmed before anything may be registered.
  const store2 = require(H.fnPath('_account-store'));
  const rec = await store2.getAccount(dana.accountId);
  rec.emailVerifiedAt = new Date().toISOString();
  await store2.saveAccount(rec);

  const made = await H.call(family.handler, {
    action: 'createParticipant', token: dana.token,
    participant: { firstName: 'Noa', lastName: 'Levi', dateOfBirth: '2017-04-02' }
  });
  const noa = made.body.participant.participantId;

  const a = await H.call(regs.handler,
    { action: 'submit', token: dana.token, slug: 'autumn', participantId: noa });
  H.eq(a.status, 200, 'the autumn term is registered');
  const s = await H.call(regs.handler,
    { action: 'submit', token: dana.token, slug: 'spring', participantId: noa });
  H.eq(s.status, 200, 'and the spring term is too');

  const autumnReg = await store.getRegistration(noa, autumn.activityId);
  const springReg = await store.getRegistration(noa, spring.activityId);
  H.eq(autumnReg.frozen.price.feeCharged, true, 'the autumn is charged the yearly fee');
  H.eq(springReg.frozen.price.feeCharged, false,
    '⚠ and the spring is WAIVED — which is what makes the autumn\'s fee load-bearing');

  // €50 fee + €300 term, paid in full.
  autumnReg.payment = Object.assign({}, autumnReg.payment, { paidCents: 35000 });
  await store.saveRegistration(autumnReg);

  const before = sent.length;
  const done = await H.call(regs.handler, { action: 'cancel', token: dana.token,
    participantId: noa, activityId: autumn.activityId });
  H.eq(done.status, 200, 'the autumn is cancelled');
  H.eq(done.body.credit.feeHeldElsewhere, true,
    '⚠ the fee is HELD — the spring is live and standing on it');
  H.eq(done.body.entry.amountCents, 30000,
    'so €300.00 comes back and the €50.00 fee does not');
  H.eq(sent.length, before + 1, 'one message follows');

  const msg = sent[sent.length - 1];
  H.ok(msg.html.indexOf('€300.00') !== -1, 'it states the ledger\'s figure');
  H.ok(msg.html.indexOf('another term is still registered') !== -1,
    '⚠ AND IT SAYS WHY THE OTHER €50.00 IS NOT THERE — the whole of this bug');
  H.ok(msg.text.indexOf('charged once a year') !== -1,
    'naming the yearly fee, so the missing figure is identifiable');

  // ------------------------------------------------------------------------
  // ⚠ AND WHEN THE FEE WAS THE WHOLE OF WHAT WAS PAID there is no credit line at
  // all, so without this the message would never mention money the family
  // handed over.
  console.log('\n[the fee being the whole of it reads differently]');
  const mail = mods['_registration-email'];
  const held = { total: 0, feeHeldElsewhere: true, paidFeeCents: 5000, paidCourseCents: 0 };
  const reg = { participantId: 'p', activityId: 'act',
                frozen: { participantName: 'Noa', activityTitle: { en: 'Autumn' } } };
  const whole = mail.cancelledMessage(reg, { email: 'd@e.com', profile: { preferredLanguage: 'en' } },
                                      0, null, held);
  H.ok(whole.html.indexOf('0.00') === -1,
    'still no "€0.00" — that reads as a decision taken against the family');
  H.ok(whole.html.indexOf('Everything paid on this registration') !== -1,
    '⚠ but the money IS accounted for, which it was not before');

  console.log('\n[and nothing is added when no fee is being held]');
  const plain = mail.cancelledMessage(reg, { email: 'd@e.com', profile: { preferredLanguage: 'en' } },
                                      30000, null, { total: 30000, feeHeldElsewhere: false });
  H.ok(plain.html.indexOf('another term') === -1,
    'a cancellation with nothing withheld says nothing about a fee');
  H.ok(plain.html.indexOf('€300.00') !== -1, 'and still states its figure');
  const none = mail.cancelledMessage(reg, { email: 'd@e.com', profile: { preferredLanguage: 'en' } },
                                     30000, null, null);
  H.ok(none.html.indexOf('another term') === -1,
    'and so does one built with no credit object at all');

  H.done();
})();
