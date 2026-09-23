// What this defends against:
//
// A FAMILY WAS ASKED TO COMMIT TO A TERM AND TOLD NOTHING ABOUT GETTING OUT OF
// IT.
//
// Every rule was there. freezeCancellation() writes the cutoffs onto the record
// at submission, resolved per group; creditFor() applies them and is
// reproducible a year later; both cancel paths call it; the ledger carries the
// basis so a figure can be explained. All of it correct, none of it ever said
// out loud. A family learned the deadline by MEETING it — the cancel button
// quietly stopped being offered, or the credit came back smaller than expected,
// and the first mention of a cutoff was the refusal that named it.
//
// From outside, a policy nobody is shown is a policy invented at the moment it
// is enforced. Reported as: "when we register, we don't know until when we can
// cancel, until when we get the registration fee back — and in cases where we
// can cancel all the time, that should be said too."
//
// ⚠ THE INTERESTING HALF IS NOT THAT A SENTENCE EXISTS. It is that the sentence
// and the arithmetic cannot come apart. A footnote is copy, and copy is exactly
// the kind of thing that stays behind when a rule moves — so this suite does not
// read the words and check they look right. It takes the date the screen prints,
// hands that date to creditFor(), and asserts creditFor() behaves at it the way
// the sentence said it would. The same for the fee's own date, for flat, and for
// prorated.
//
// And it pins the two things that were nearly got wrong:
//
//   · the terms on a REGISTRATION come from the FROZEN block, never from the
//     activity — otherwise an admin switching flat to prorated in March
//     re-quotes the new policy at a January family, which is the one thing
//     freezing exists to prevent;
//   · the terms on the REGISTER PANEL come from freezeCancellation() itself, so
//     what is quoted before the button is byte-for-byte what gets stored after
//     it.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');
const F = require('./_fixtures');

process.env.RESEND_FROM = 'Merkaz Ogen <noreply@ogen.cy>';

const R = path.join(__dirname, '..');
const terms = require(H.fnPath('_cancellation-terms'));
const credit = require(H.fnPath('_credit'));
const LANGS = ['he', 'en', 'ru'];

// End of the cutoff day and one second past it, in Asia/Nicosia — the boundary
// creditFor() actually uses. Built by asking past() rather than by a second
// timezone calculation here, which would be the same bug one layer up.
const dayEnd = (iso) => Date.parse(iso + 'T21:59:59.999Z');   // 23:59:59.999 EET
const justAfter = (iso) => dayEnd(iso) + 4 * 3600 * 1000;     // safely into the next day
const justBefore = (iso) => Date.parse(iso + 'T06:00:00Z');

(async () => {
  console.log('[the lines exist, complete, in three languages]');
  const spec = { type: 'course', hasFee: true, cancellation: {
    mode: 'flat', cancellationCutoffDate: '2026-10-28',
    registrationFeeCutoffDate: '2026-09-30' } };
  const say = {};
  LANGS.forEach((l) => { say[l] = terms.termsFor(spec, l); });
  H.eq(say.he.length, say.en.length, 'Hebrew and English say the same number of things');
  H.eq(say.ru.length, say.en.length, 'and so does Russian');
  // ⚠ A key quietly left holding the English is invisible to a reviewer who does
  // not read the language — the same check _family-errors.js is held to.
  H.ok(say.he.every((s) => /[֐-׿]/.test(s)), 'the Hebrew is in Hebrew');
  H.ok(say.ru.every((s) => /[Ѐ-ӿ]/.test(s)), 'the Russian is in Cyrillic');
  LANGS.forEach((l) => {
    H.ok(terms.titleFor(l) && typeof terms.titleFor(l) === 'string', l + ' has a heading');
  });
  // The dates are formatted in the reader's language, not printed as ISO.
  H.ok(/28 באוקטובר 2026/.test(say.he.join(' ')), 'Hebrew dates take the ב prefix');
  H.ok(/28 октября 2026/.test(say.ru.join(' ')), 'Russian dates take the genitive');
  // ⚠ THE YEAR IS ALWAYS THERE, which the session table deliberately omits. A
  // deadline is read alone, months later, in an inbox.
  H.ok(say.en.every((s) => !/\b\d{1,2} (January|October|December)\b(?! \d{4})/.test(s)),
    'and every date carries its year');

  console.log('\n[a cutoff that is switched off is not printed as a deadline]');
  // "none" is a VALUE meaning switched off — the entire reason the field has
  // three states. Printing it as a date would be the opposite of what it says.
  const off = terms.termsFor({ type: 'course', hasFee: true, cancellation: {
    mode: 'flat', cancellationCutoffDate: 'none', registrationFeeCutoffDate: 'none' } }, 'en');
  H.ok(off.some((s) => /at any time/.test(s)),
    '"you can cancel at any time" is said out loud rather than left to be inferred');
  H.ok(!off.some((s) => /none/i.test(s)), 'and the word "none" never reaches a family');
  H.ok(off.some((s) => /whenever you cancel/.test(s)), 'same for the fee');

  console.log('\n[the date the screen prints is the date creditFor() acts on]');
  // ⚠ THIS IS THE POINT OF THE SUITE. A footnote is copy, and copy is what stays
  // behind when a rule moves. So: take the printed date, hand it to the
  // arithmetic, and watch the arithmetic do what the sentence promised.
  const CUT = '2026-10-28';
  const FEE = '2026-09-30';
  const reg = {
    frozen: {
      type: 'course',
      price: { registrationFee: 50, fullPrice: 300, feeCharged: true },
      cancellation: { mode: 'flat', cancellationCutoffDate: CUT,
                      registrationFeeCutoffDate: FEE,
                      sessionStartsAt: ['2026-10-14', '2026-10-21', '2026-10-28', '2026-11-04']
                        .map((d) => Date.parse(d + 'T13:00:00Z')) }
    },
    payment: { paidCents: 35000 }
  };
  const line = terms.termsFor({ type: 'course', hasFee: true,
                               cancellation: reg.frozen.cancellation }, 'en');
  H.ok(line[0].indexOf('28 October 2026') !== -1,
    'the screen says cancellation runs up to 28 October: "' + line[0] + '"');
  // ⚠ THE PRINTED DATE IS THE BOUNDARY OF THE CREDIT, NOT OF THE BUTTON. The
  // sentence says cancelling stays possible and stops earning anything, and the
  // arithmetic has to do exactly that at the instant either side of it.
  H.ok(credit.creditFor(reg, justBefore(CUT)).total > 0,
    'on that day, cancelling still earns something back');
  H.eq(credit.creditFor(reg, justAfter(CUT)).total, 0,
    'and the day after it earns nothing — the printed date IS the boundary');
  H.eq(credit.creditFor(reg, justAfter(CUT)).guardianMayCancel, true,
    'while cancelling itself stays open, which is what the same sentence promises');

  H.ok(line.some((s) => /registration fee comes back as credit if you cancel by 30 September 2026/.test(s)),
    'the screen names the fee\'s own date, which is not the same date');
  H.eq(credit.creditFor(reg, justBefore(FEE)).feeCredit, 5000,
    'before it, the whole €50 fee comes back');
  H.eq(credit.creditFor(reg, justAfter(FEE)).feeCredit, 0, 'after it, none of it');

  console.log('\n[flat and prorated say different things, and are different things]');
  const beforeStart = Date.parse('2026-10-01T09:00:00Z');
  const afterTwo = Date.parse('2026-10-22T09:00:00Z');   // two of four sessions gone
  H.eq(credit.creditFor(reg, beforeStart).courseCredit, 30000,
    'before the first session the whole course fee comes back, as the line says');
  H.ok(line.some((s) => /whole activity fee comes back as credit/.test(s)),
    'and the line says it: "' + line.filter((s) => /whole activity/.test(s))[0] + '"');

  H.ok(line.some((s) => /half of the activity fee/.test(s)), 'flat is described as half');
  H.eq(credit.creditFor(reg, afterTwo).courseCredit, 15000, 'and flat credits exactly half');

  const pro = JSON.parse(JSON.stringify(reg));
  pro.frozen.cancellation.mode = 'prorated';
  pro.frozen.cancellation.sessionStartsAt = reg.frozen.cancellation.sessionStartsAt;
  const proLine = terms.termsFor({ type: 'course', hasFee: true,
                                   cancellation: pro.frozen.cancellation }, 'en');
  H.ok(proLine.some((s) => /sessions you have not had/.test(s)),
    'prorated is described by the sessions left');
  H.ok(!proLine.some((s) => /half of the activity fee/.test(s)),
    'and never ALSO as half — the two modes must not both be quoted');
  H.eq(credit.creditFor(pro, afterTwo).courseCredit, 15000,
    'with two of four left, prorated happens to be half here too');
  // ⚠ SO PROVE THEY DIVERGE, or "half" and "proportional" are indistinguishable
  // and the sentence proves nothing. One session gone of four, still inside the
  // hard cutoff — which is the window a family is actually deciding in.
  const afterOne = Date.parse('2026-10-15T09:00:00Z');
  H.eq(credit.creditFor(reg, afterOne).courseCredit, 15000, 'flat is half whenever it is asked');
  H.eq(credit.creditFor(pro, afterOne).courseCredit, 22500,
    'prorated is three of four — the two lines describe two different rules');

  console.log('\n[a fee nobody is billing is not described]');
  // The same mistake "includes the yearly registration fee" made under every
  // cost card: a sentence about a charge that is not being made.
  const waived = terms.termsFor({ type: 'course', hasFee: false,
                                  cancellation: reg.frozen.cancellation }, 'en');
  H.ok(!waived.some((s) => /registration fee/.test(s)),
    'a second term with the fee waived says nothing about a fee');
  H.ok(waived.some((s) => /28 October 2026/.test(s)), 'everything else is unchanged');

  console.log('\n[once the window is shut there is one thing left to say]');
  const shut = terms.termsFor({ type: 'course', hasFee: true, closed: true,
                                cancellation: reg.frozen.cancellation }, 'en');
  H.eq(shut.length, 1, 'the rules that no longer apply are not listed');
  H.ok(/closed on 28 October 2026/.test(shut[0]), 'it says when it closed: "' + shut[0] + '"');
  H.ok(!/you can cancel/i.test(shut[0]),
    '⚠ and does not offer a cancellation under a page with no cancel button on it');
  // ⚠ WHETHER IT IS SHUT IS THE CALLER'S ANSWER, NOT THIS MODULE'S. _credit.js
  // is forbidden from asking what time it is so the same record gives the same
  // figure a year later, and a terms module that asked the clock would be the
  // same contract broken one file over.
  const src = fs.readFileSync(H.fnPath('_cancellation-terms'), 'utf8');
  H.ok(!/Date\.now\(\)|new Date\(\)/.test(src), 'the terms module never asks what time it is');
  H.ok(!/require\('\.\/_blobs'\)|require\('\.\/_github'\)/.test(src), 'and opens nothing');

  console.log('\n[a drop-in states the rule it actually has]');
  // Cancelling a drop-in REGISTRATION credits nothing — creditFor() refuses at
  // the top rather than answering. What is creditable is one evening, so that is
  // the only rule there is to state, and quoting a course's cutoffs here would
  // be exactly the plausible-wrong-number the guard exists to stop.
  const di = terms.termsFor({ type: 'dropin', sessionCancelHours: 24 }, 'en');
  H.ok(di.some((s) => /24 hours before it starts/.test(s)), 'the per-evening window is named');
  H.ok(!di.some((s) => /first session|half of|registration fee/.test(s)),
    'and none of the course arithmetic is quoted at it');
  H.eq(terms.termsFor({ type: 'dropin', sessionCancelHours: 1 }, 'ru')
         .some((s) => /1 час /.test(s)), true, 'Russian agrees its hour with the number');
  const open = terms.termsFor({ type: 'dropin', sessionCancelHours: null }, 'en');
  H.ok(open.some((s) => /any time before it starts/.test(s)),
    'a blank window is the generous reading, said out loud — the direction every blank in _credit.js takes');

  console.log('\n[credit, never a refund, in every language]');
  // The one sentence that is a policy rather than a date, and the one a family
  // is most likely to read as "money back".
  H.ok(say.en.some((s) => /not refunded to a card/.test(s)), 'English says it is not a refund');
  H.ok(say.he.some((s) => /אין החזר כספי/.test(s)), 'Hebrew says it');
  H.ok(say.ru.some((s) => /возврат на карту не производится/.test(s)), 'Russian says it');

  // -------------------------------------------------------------------------
  console.log('\n[the panel quotes what the registration ends up frozen with]');

  const blobs = H.makeBlobs();
  const course = F.course({
    slug: 'term', activityId: 'act-0000000000000t01',
    registration: {
      autoApprove: true, pendingExpiryDays: null,
      registrationFeeCutoffDate: '2026-09-30',
      cancellationPolicy: { mode: 'prorated', cancellationCutoffDate: '2026-10-28' },
      defaultBasis: null
    }
  });
  const github = H.makeGithub({
    'activities/term.json': JSON.stringify(course),
    'activities/activities-index.json': JSON.stringify(
      [{ slug: 'term', activityId: course.activityId, status: 'open', langs: ['he', 'en', 'ru'],
         title: course.title }])
  });
  const mods = H.loadWithStubs({ blobs, github,
    modules: ['_registration-store', 'account-auth', 'account-family', 'account-registrations',
              '_registration-email'] });
  const store = mods['_registration-store'];
  const auth = mods['account-auth'];
  const family = mods['account-family'];
  const api = mods['account-registrations'];
  const mail = mods['_registration-email'];

  require(H.fnPath('_email'))._internal.setTransport({
    emails: { send: async () => ({ data: { id: 'e-1' } }) }
  });

  const up = await H.signUp(auth, blobs, { email: 'dana@example.com',
    profile: { firstName: 'Dana', preferredLanguage: 'en' } });
  const token = up.body.token;
  const made = await H.call(family.handler, { action: 'createParticipant', token: token,
    participant: { firstName: 'Noa', lastName: 'Levi', dateOfBirth: '2017-04-02' } });
  const noa = made.body.participant.participantId;

  const panel = await H.call(api.handler,
    { action: 'activity', token: token, slug: 'term', lang: 'en' });
  H.eq(panel.status, 200, 'the register panel loads');
  const quoted = panel.body.activity.cancellationTerms;
  H.ok(quoted && quoted.length, 'and carries the terms, before anybody has pressed anything');
  H.ok(quoted.some((s) => /28 October 2026/.test(s)), 'naming the hard cutoff');
  H.ok(quoted.some((s) => /30 September 2026/.test(s)), 'and the fee\'s own, separate date');
  H.ok(panel.body.activity.cancellationTermsTitle, 'with a heading of its own');

  await H.call(api.handler, { action: 'submit', token: token, slug: 'term',
                              participantId: noa, lang: 'en' });
  const after = await H.call(api.handler, { action: 'registration', token: token,
    participantId: noa, activityId: course.activityId, lang: 'en' });
  H.eq(JSON.stringify(after.body.registration.cancellationTerms), JSON.stringify(quoted),
    '⚠ and what was quoted BEFORE the button is exactly what is on the record AFTER it');

  console.log('\n[and they are the FROZEN terms, not the activity\'s current ones]');
  // The whole reason freezeCancellation() runs at submission. A footnote rebuilt
  // from the live activity would quietly re-quote a new policy at an old family,
  // which is that rule broken by the one screen written to explain it.
  const moved = JSON.parse(JSON.stringify(course));
  moved.registration.cancellationPolicy.cancellationCutoffDate = '2026-12-16';
  moved.registration.registrationFeeCutoffDate = '2026-12-01';
  github._files.set('activities/term.json', JSON.stringify(moved));
  api._internal._setReader(async (slug) => JSON.parse(github._files.get('activities/' + slug + '.json')));

  const later = await H.call(api.handler, { action: 'registration', token: token,
    participantId: noa, activityId: course.activityId, lang: 'en' });
  H.ok(later.body.registration.cancellationTerms.some((s) => /28 October 2026/.test(s)),
    'the family still reads the date they agreed to');
  H.ok(!later.body.registration.cancellationTerms.some((s) => /16 December 2026/.test(s)),
    'and never the one an admin set afterwards');
  // The panel, which has no registration to be held to, moves with the activity.
  const panel2 = await H.call(api.handler,
    { action: 'activity', token: token, slug: 'term', lang: 'en' });
  H.ok(panel2.body.activity.cancellationTerms.some((s) => /16 December 2026/.test(s)),
    'while somebody registering today is quoted today\'s policy');

  console.log('\n[the message that creates the commitment carries them]');
  // A screen is read once, at the moment of deciding, by whoever was holding the
  // laptop. The email is the copy the household keeps.
  const reg2 = await store.getRegistration(noa, course.activityId);
  const msg = mail.receivedMessage(reg2, { email: 'dana@example.com',
    profile: { preferredLanguage: 'en' } });
  H.ok(msg, 'the confirmation message is buildable with no infrastructure');
  H.ok(/28 October 2026/.test(msg.html), 'and the deadline is in it');
  H.ok(/Cancellation terms/.test(msg.text), 'in the plain-text part too');
  // ⚠ SMALL, AND UNDER THE BUTTON. Set at body size above the call to action,
  // the terms of getting out of a thing read as a warning about the thing the
  // message is delivering.
  H.ok(msg.html.indexOf('Cancellation terms') > msg.html.indexOf('</a>'),
    'after the call to action, not before it');
  H.ok(/font-size:13px/.test(msg.html.slice(msg.html.indexOf('Cancellation terms') - 120)),
    'and set as small print');

  // ONE TABLE OF WORDS, so the inbox and the screen cannot describe two
  // different policies — the reason the pay link, the shell and the send path
  // are each singular.
  const emailSrc = fs.readFileSync(H.fnPath('_registration-email'), 'utf8');
  H.ok(/require\('\.\/_cancellation-terms'\)/.test(emailSrc),
    'the email reads the same module the screen does');
  H.ok(!/Cancellation terms|תנאי ביטול|Условия отмены/.test(emailSrc),
    'and holds no copy of the words itself');

  H.done();
})();
