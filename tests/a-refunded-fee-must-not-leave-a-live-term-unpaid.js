// What this defends against:
//
// ⚠ CANCEL THE AUTUMN TERM AND THE SPRING ONE IS SUDDENLY FREE OF A FEE NOBODY
// EVER PAID.
//
// Reported as a loophole, and it is one:
//
//   autumn   registered, the yearly fee charged, €350 paid
//   spring   registered, fee WAIVED — the autumn term stands, and the fee is
//            charged once per participant per activity per academic year
//   autumn   cancelled before its cutoffs -> €350 back, the fee included
//
// The family attends the spring term having paid no registration fee at all for
// that year. Executed against the real modules before anything was changed, the
// figure was €0.00 collected.
//
// ⚠ AND THE REFUND IS ONLY ONE WAY IN. The same hole opens with no money moving
// at all: register for both terms before paying anything, cancel the autumn, and
// the invoice that carried the fee stops standing while the spring bill was
// frozen at €300 in advance. That variant needs no cancellation timing and no
// payment, which makes it the likelier one.
//
// THE CAUSE IS THAT THE WAIVER ONLY LOOKED BACKWARDS. feeStandsOn() asks, of a
// NEW registration, whether this child has already been charged this year — and
// that half is right, and already closes the mirror-image hole where refunding
// the fee makes a third term chargeable again. Nothing looked forwards from a
// cancellation at the registrations that were waived because of it.
//
// So the fee does not come back while the year it paid for is still live.
// feeHeldByLiveTerm() in _registration.js is the rule, creditFor() takes it as
// an argument — never a lookup, because that module reads one record and one
// timestamp and opens no store — and every caller passes it for the same reason
// every caller passes the clock.
//
// ⚠ WHAT IS DELIBERATELY NOT FIXED HERE, so nobody reads this suite as covering
// it: the UNPAID variant above. Nothing is withheld when nothing was paid, so a
// family who registers for both terms, pays nothing and cancels the autumn is
// still carrying a waived spring term with no fee billed anywhere. Closing that
// means re-billing the surviving term, which moves a frozen figure and can turn
// "paid in full" into a debt — a bigger change, and one that was weighed and
// deferred rather than missed.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_helpers');
const F = require('./_fixtures');

process.env.RESEND_FROM = 'Merkaz Ogen <noreply@ogen.cy>';

const ROOT = path.join(__dirname, '..');
const ui = fs.readFileSync(path.join(ROOT, 'js/member-account.js'), 'utf8');

// The real string table, all three languages, so the sentence checked below is
// the one a family would actually read.
const tableSrc = ui.slice(ui.indexOf('var T = {'),
                          ui.indexOf('}[lang];', ui.indexOf('var T = {')) + '}[lang];'.length);
const tableFor = (l) => {
  const ctx = { lang: l };
  vm.runInNewContext(tableSrc + '\nresult = T;', ctx);
  return ctx.result;
};
// creditNote(), lifted out and executed — reading it is what missed the last bug
// in this dialog.
function noteMaker(strings) {
  const from = ui.indexOf('  function creditNote(cancellation) {');
  const to = ui.indexOf('\n  function ', from + 1);
  const ctx = vm.createContext({
    T: strings, money: (c) => '€' + (Number(c) / 100).toFixed(2)
  });
  vm.runInContext(ui.slice(from, to) + '\nthis.creditNote = creditNote;', ctx);
  return ctx.creditNote;
}

// Cutoffs far enough out that this suite is not measuring the wall clock. What
// it is about is the difference the rule makes, and a fee window that quietly
// closes would make every figure below nought and every assertion pass for the
// wrong reason.
const POLICY = {
  autoApprove: false,
  pendingExpiryDays: null,
  registrationFeeCutoffDate: '2099-01-01',
  cancellationPolicy: { mode: 'flat', cancellationCutoffDate: '2099-06-01' },
  defaultBasis: null
};

(async () => {
  const blobs = H.makeBlobs();
  const autumn = F.course({ registration: POLICY });
  const spring = F.secondTerm({ registration: POLICY });
  const github = H.makeGithub({
    'activities/course-fixture.json': JSON.stringify(autumn),
    'activities/course-fixture-spring.json': JSON.stringify(spring)
  });

  const mods = H.loadWithStubs({
    blobs, github,
    modules: ['_registration', '_registration-store', '_credit', '_credit-ledger',
              'account-auth', 'account-family', 'account-registrations',
              'admin-registrations']
  });
  const R = mods['_registration'];
  const store = mods['_registration-store'];
  const credit = mods['_credit'];
  const ledger = mods['_credit-ledger'];
  const auth = mods['account-auth'];
  const family = mods['account-family'];
  const regs = mods['account-registrations'];
  const adminRegs = mods['admin-registrations'];

  require(H.fnPath('_email'))._internal.setTransport({
    emails: { send: async () => ({ data: { id: 'x' } }) }
  });

  // =========================================================================
  console.log('[the rule: is the fee still doing a job somewhere else]');

  const SERIES = autumn.activityId;
  const YEAR = '2026/27';
  const term = (over) => Object.assign({
    activityId: 'act-000000000000c0de',
    status: 'approved',
    frozen: { seriesId: SERIES, feeYear: YEAR, price: { feeCharged: true, registrationFee: 50 } }
  }, over || {});
  // The spring term as the loophole makes it: live, and waived.
  const waivedLive = term({
    activityId: 'act-000000000000spr1',
    frozen: { seriesId: SERIES, feeYear: YEAR, price: { feeCharged: false, registrationFee: 50 } }
  });
  const held = (reg, list) => R.feeHeldByLiveTerm(reg, list);

  H.eq(held(term(), [waivedLive]), true,
    'another term of this year is live and was waived, so the fee stays paid');
  H.eq(held(term(), []), false, 'on its own, nothing is relying on it');
  // ⚠ A DIFFERENT activityId ON PURPOSE. Written with the same id, this passed
  // whatever the rule did — the self-exclusion answered it before the fee clause
  // was ever reached, so the two guards masked each other and the assertion
  // proved nothing. Found by reverting the clause and watching the suite stay
  // green.
  H.eq(held(term(), [term({ activityId: 'act-000000000000oth1' })]), false,
    '⚠ a live sibling that paid its OWN fee is not relying on this one');
  H.eq(held(term(), [Object.assign({}, waivedLive, { status: 'cancelled' })]), false,
    'and a cancelled sibling is not relying on anything');
  H.eq(held(term(), [Object.assign({}, waivedLive, { status: 'expired' })]), false,
    'nor is one that lapsed');
  H.eq(held(term(), [Object.assign({}, waivedLive, { status: 'pending' })]), true,
    'but a request still waiting on an admin IS live — it holds a place and will be billed');
  H.eq(held(term({
    frozen: { seriesId: SERIES, feeYear: YEAR, price: { feeCharged: false } }
  }), [waivedLive]), false,
    'a registration whose own fee was waived has no fee to withhold');
  H.eq(held(term(), [Object.assign({}, waivedLive, {
    frozen: { seriesId: 'act-somethingelse00', feeYear: YEAR, price: { feeCharged: false } } })]), false,
    'a different activity is a different fee');
  // ⚠ AND A DIFFERENT ACADEMIC YEAR IS THE SAME FEE, WHICH IS A POLICY CHANGE.
  //
  // It used to be `false` here: the waiver was scoped to one academic year, so a
  // term in the next year carried its own fee and could not be relying on this
  // one. The rule asked for is that a term MARKED as part of another is waived
  // "whether it's the same year or another year" — so a linked later term does
  // lean on this fee, and cancelling this registration must not hand it back
  // while that term is still standing. That is the same loophole this suite is
  // named for, one year over rather than one term over.
  //
  // Note this only ever looks at a DIFFERENT activityId, which is what makes it
  // safe to drop the year: the same activity re-run next year is still charged.
  H.eq(held(term(), [Object.assign({}, waivedLive, {
    frozen: { seriesId: SERIES, feeYear: '2027/28', price: { feeCharged: false } } })]), true,
    '⚠ and a LINKED term in another year leans on this fee too — the waiver ' +
    'crosses years, so withholding has to cross them with it');
  // The list a caller hands over is that participant's WHOLE key space, this
  // registration included, so being handed itself has to be harmless.
  //
  // ⚠ AND THE id GUARD THAT MAKES IT SO CANNOT BE OBSERVED FROM OUT HERE, which
  // is worth saying rather than pretending otherwise: a registration reaching
  // the scan at all has `feeCharged` true, and the scan only matches siblings
  // whose fee was WAIVED, so the fee clause already excludes it. The guard is
  // kept for the day that clause is relaxed — self-counting would then withhold
  // the fee from every cancellation on the site, silently.
  H.eq(held(term(), [term()]), false, 'being handed itself changes nothing');
  H.eq(held({ status: 'approved', frozen: { price: { feeCharged: true } } }, [waivedLive]), false,
    'a record from before the waiver existed has no series or year, and holds nothing');

  // =========================================================================
  console.log('\n[creditFor takes it as an argument, and the total moves by the fee]');

  const reg = {
    frozen: {
      type: 'course',
      price: { registrationFee: 50, fullPrice: 300, feeCharged: true },
      cancellation: {
        mode: 'flat',
        registrationFeeCutoffDate: '2099-01-01',
        cancellationCutoffDate: '2099-06-01',
        sessionStartsAt: [Date.parse('2098-10-14T13:00:00Z')]
      }
    },
    payment: { paidCents: 35000 }
  };
  const at = Date.parse('2026-10-07T09:00:00Z');
  const free = credit.creditFor(reg, at);
  const kept = credit.creditFor(reg, at, { feeHeldElsewhere: true });
  H.eq(free.total, 35000, 'with nothing else live, the whole 350 comes back');
  H.eq(kept.total, 30000, 'and with the spring term still registered, 300 does');
  H.eq(free.total - kept.total, 5000, 'the difference is the fee, exactly');
  H.eq(kept.courseCredit, free.courseCredit, 'the COURSE half is untouched — this is not a penalty');
  H.eq(kept.feeCredit, 0, 'it is the fee half and only the fee half');
  H.eq(kept.feeHeldElsewhere, true, 'and the answer says so, so a screen can explain it');
  H.eq(free.feeHeldElsewhere, false, 'where nothing was withheld it claims nothing');

  // ⚠ Reported true only when it actually suppressed something. A sentence
  // explaining a difference that is not there is noise in the one place nobody
  // can afford it.
  const past = JSON.parse(JSON.stringify(reg));
  past.frozen.cancellation.registrationFeeCutoffDate = '2020-01-01';
  const shut = credit.creditFor(past, at, { feeHeldElsewhere: true });
  H.eq(shut.feeCredit, 0, 'past its own date the fee is nought anyway');
  H.eq(shut.feeHeldElsewhere, false,
    '⚠ and the answer does not ALSO claim to be holding it — one zero, one explanation');
  const nothingPaid = JSON.parse(JSON.stringify(reg));
  nothingPaid.payment.paidCents = 0;
  H.eq(credit.creditFor(nothingPaid, at, { feeHeldElsewhere: true }).feeHeldElsewhere, false,
    'and with no fee ever paid there is nothing to hold back');

  // The ledger's account of the figure has to be the account of THAT figure.
  const basis = credit.basisFor(reg, at, { feeHeldElsewhere: true });
  H.eq(basis.total, kept.total, 'basisFor answers for the same call');
  H.eq(basis.feeHeldElsewhere, true, 'and records why the fee half is nought');
  H.eq(credit.basisFor(reg, at).feeHeldElsewhere, false, 'while an ordinary cancellation records nothing');

  // =========================================================================
  console.log('\n[end to end: two children, one of them registered for both terms]');

  const signed = await H.signUp(auth, blobs, {
    action: 'signup', email: 'dana@example.com', password: 'password-123', termsAccepted: true,
    profile: { firstName: 'Dana', preferredLanguage: 'en' }
  });
  const dana = { token: signed.body.token, accountId: signed.body.account.accountId };
  const kid = async (name) => (await H.call(family.handler, {
    action: 'createParticipant', token: dana.token,
    participant: { firstName: name, dateOfBirth: '2017-04-02' }
  })).body.participant.participantId;
  const noa = await kid('Noa');     // both terms
  const ari = await kid('Ari');     // the autumn only — the control
  const admin = await H.installSession(blobs, H.superAdminSession({ token: 'full' }));

  const sub = (pid, slug) => H.call(regs.handler,
    { action: 'submit', token: dana.token, slug: slug, participantId: pid });
  const pay = (pid, aid, cents) => H.call(adminRegs.handler, {
    action: 'recordPayment', token: admin.token, participantId: pid, activityId: aid,
    amountCents: cents });

  const noaAutumn = await sub(noa, 'course-fixture');
  H.eq(noaAutumn.body.registration.payment.owedCents, 35000, 'Noa\'s autumn term is billed 350');
  const noaSpring = await sub(noa, 'course-fixture-spring');
  H.eq(noaSpring.body.registration.frozen.price.feeCharged, false, 'her spring term waives the fee');
  H.eq(noaSpring.body.registration.payment.owedCents, 30000, 'and is billed 300');
  await sub(ari, 'course-fixture');

  await pay(noa, autumn.activityId, 35000);
  await pay(ari, autumn.activityId, 35000);

  // What the screen promises, BEFORE anything is confirmed.
  const page = await H.call(regs.handler, { action: 'registration', token: dana.token,
    participantId: noa, activityId: autumn.activityId });
  const offer = page.body.registration.cancellation;
  H.eq(offer.feeHeldElsewhere, true, 'the page says the fee is not in the figure');
  const control = await H.call(regs.handler, { action: 'registration', token: dana.token,
    participantId: ari, activityId: autumn.activityId });
  H.eq(control.body.registration.cancellation.feeHeldElsewhere, false,
    'and on a child with one term it says nothing, because nothing was withheld');
  H.eq(control.body.registration.cancellation.credit - offer.credit, 5000,
    '⚠ the two offers differ by exactly one registration fee');

  // And the dashboard, which builds its rows from a different call.
  const dash = await H.call(regs.handler, { action: 'dashboard', token: dana.token });
  const dashRow = dash.body.registrations.filter((r) =>
    r.participantId === noa && r.activityId === autumn.activityId)[0];
  H.eq(dashRow.cancellation.credit, offer.credit,
    'the dashboard row agrees with the page opened from it');

  // ⚠ AND THE LEDGER MOVES BY WHAT WAS PROMISED. A payload agreeing with a
  // dialog proves only that two readers of one bug agree.
  const before = await ledger.balanceFor(dana.accountId, 'live');
  const done = await H.call(regs.handler, { action: 'cancel', token: dana.token,
    participantId: noa, activityId: autumn.activityId });
  H.eq(done.status, 200, 'the family cancels the autumn term');
  const moved = (await ledger.balanceFor(dana.accountId, 'live')) - before;
  H.eq(moved, offer.credit, 'and the ledger moved by exactly what the page offered — ' + moved);
  H.eq(done.body.credit.feeCredit, 0, 'with no fee in it');
  H.eq(done.body.entry.basis.feeHeldElsewhere, true, 'and the entry says why, for whoever asks');

  // The control, through the same door.
  const beforeAri = await ledger.balanceFor(dana.accountId, 'live');
  await H.call(regs.handler, { action: 'cancel', token: dana.token,
    participantId: ari, activityId: autumn.activityId });
  const movedAri = (await ledger.balanceFor(dana.accountId, 'live')) - beforeAri;
  H.eq(movedAri - moved, 5000,
    '⚠ THE WHOLE BUG IN ONE LINE: one term back is 350, one of two is 300');

  // ⚠ AND THE FEE IS STILL PAID, which is the point of withholding it. The
  // record shows it was never credited, so feeStandsOn() still answers true and
  // a third term of this year is still waived — correctly, because the money is
  // still ours.
  const cancelled = await store.getRegistration(noa, autumn.activityId);
  H.eq(cancelled.payment.feeCreditedCents, 0, 'nothing of the fee was given back');
  H.eq(R.feeStandsOn(cancelled), true, 'so it still stands as the fee for this year');
  H.eq(R.feeApplies([cancelled], SERIES, YEAR), false,
    'and a third term of the same year is still waived, on a fee that was really paid');
  // Where the refund DID happen, the opposite — which is the rule that was
  // already right and must stay right.
  const ariReg = await store.getRegistration(ari, autumn.activityId);
  H.eq(ariReg.payment.feeCreditedCents, 5000, 'Ari\'s fee came back');
  H.eq(R.feeApplies([ariReg], SERIES, YEAR), true, 'so Ari is charged it again next time');

  // =========================================================================
  console.log('\n[⚠ every caller of creditFor() supplies the sibling answer too]');
  //
  // Same shape as the clock, and the same failure if it is forgotten: the
  // argument is optional in syntax and not in meaning. `undefined` reads as "no
  // other term is live", which is the generous direction and, here, the
  // loophole — silently, on a screen that keeps working.
  const FN = path.join(ROOT, 'netlify', 'functions');
  let sites = 0;
  const withCalls = new Set();
  fs.readdirSync(FN).filter((f) => /\.js$/.test(f) && f !== '_credit.js').forEach((f) => {
    const code = fs.readFileSync(path.join(FN, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*\n/gm, '');
    // Balanced-paren scan rather than a regex: the third argument is an object
    // literal holding a call of its own, and `[^)]*` would stop inside it.
    let i = 0;
    while ((i = code.indexOf('creditFor(', i)) !== -1) {
      // A dot before it is `credit.creditFor(`, which is every real call site.
      // What this skips is a longer identifier ENDING in the name.
      if (/[A-Za-z0-9_$]/.test(code.charAt(i - 1) || '')) { i += 10; continue; }
      let depth = 0, args = 0, j = i + 9;
      for (; j < code.length; j++) {
        if (code[j] === '(' || code[j] === '{' || code[j] === '[') depth++;
        else if (code[j] === '}' || code[j] === ']') depth--;
        else if (code[j] === ',' && depth === 1) args++;
        else if (code[j] === ')' && --depth === 0) break;
      }
      const call = code.slice(i, j + 1);
      i = j + 1;
      // ⚠ THERE IS NO EXCLUSION HERE ANY MORE, and that is the fix rather than a
      // relaxation. `function creditFor(account)` in _registration-email.js was a
      // DIFFERENT function that read a ledger balance, and this scan had to skip
      // it by matching its exact signature — so the day it gained an argument,
      // this rule about _credit.js failed on a function in another file. It is
      // called heldBy() now. Two unrelated functions sharing one name in one
      // directory is the thing that was wrong; a cleverer skip would only have
      // hidden it again.
      sites++;
      // ⚠ COUNTED, NOT MATCHED ON THE LITERAL. cancelAndCredit() builds the
      // object once and hands the same one to creditFor() and basisFor(),
      // which is the point — two constructions of one fact is how a ledger
      // entry comes to explain a figure it did not produce. So what is pinned
      // is that a third argument is there at all, exactly as the clock test
      // pins a second, and the file-level check below says what it has to be.
      H.ok(args >= 2, f + ': ' + call.replace(/\s+/g, ' ') + ' passes the year answer');
      withCalls.add(f);
    }
  });
  H.ok(sites >= 4, 'and there were real call sites to check (' + sites + ')');
  // And that third argument is THIS question rather than some other one: a file
  // that works out a cancellation credit has to ask the rule by name.
  withCalls.forEach((f) => {
    H.ok(/feeHeldByLiveTerm/.test(fs.readFileSync(path.join(FN, f), 'utf8')),
      f + ' asks feeHeldByLiveTerm() for it');
  });

  // =========================================================================
  console.log('\n[the family is told, in their own language, before they confirm]');

  ['he', 'en', 'ru'].forEach((l) => {
    const T = tableFor(l);
    const note = noteMaker(T);
    H.ok(typeof T.confirmFeeHeld === 'string' && T.confirmFeeHeld.length > 20,
      l + ' has the sentence');
    H.ok(typeof T.whyNothing['fee-held'] === 'string',
      l + ' has one for the case where the fee was ALL that was paid');
    const lines = note({ credit: 30000, feeHeldElsewhere: true });
    H.eq(lines.length, 2, l + ': the figure, and then why it is not larger');
    H.eq(lines[1], T.confirmFeeHeld, l + ': and the second line is that sentence');
    H.eq(note({ credit: 30000, feeHeldElsewhere: false }).length, 1,
      l + ': ⚠ and an ordinary cancellation gains no extra line');
  });
  // The one language check that catches a key quietly left holding the English.
  H.ok(/[֐-׿]/.test(tableFor('he').confirmFeeHeld), 'the Hebrew is in Hebrew');
  H.ok(/[Ѐ-ӿ]/.test(tableFor('ru').confirmFeeHeld), 'the Russian is in Cyrillic');

  // ⚠ SAID EVEN WHEN THERE IS CREDIT, which no other line in that dialog is.
  // The rule everywhere else is that a figure explains itself; this is the case
  // where the figure is smaller than what was paid and cannot.
  H.ok(/if \(cancellation\.feeHeldElsewhere\) lines\.push\(T\.confirmFeeHeld\);/.test(ui),
    'the client appends it outside the no-credit branch');

  // And the admin sees it too, on the screen where somebody is about to send
  // that figure to a family.
  const adminUi = fs.readFileSync(path.join(ROOT, 'js/registrations-admin.js'), 'utf8');
  H.ok(/draft\.feeHeldElsewhere/.test(adminUi), 'the cancel draft explains the smaller figure');
  const preview = await H.call(adminRegs.handler, { action: 'cancelPreview', token: admin.token,
    participantId: noa, activityId: spring.activityId });
  H.eq(preview.status, 200, 'and the preview action answers');
  H.ok('feeHeldElsewhere' in preview.body, 'carrying the flag for it to read');

  H.done();
})();
