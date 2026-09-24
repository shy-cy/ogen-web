// What this defends against:
//
// THE CONFIRMATION DIALOG SAID "THIS CANCELLATION EARNS NO CREDIT BACK" ON
// EVERY REGISTRATION, WHATEVER WAS ACTUALLY OWED BACK.
//
// _credit.js answers "what would cancelling do" twice, for two different things,
// and the two answers are correct in their own modules:
//
//   creditFor()        -> { guardianMayCancel, feeCredit, courseCredit, total }
//   creditForSession() -> { mayCancel, credit, deadline }
//
// A term's credit is a fee part plus a course part and `total` is their sum,
// which a ledger entry has to itemise; one evening has a single figure and
// nothing to split. Neither shape is wrong.
//
// ⚠ THE FAMILY'S SCREEN READS ONE SHAPE. creditNote() asked for `.credit`, which
// a session's answer carries and a registration's has never carried — so
// `undefined > 0` was false, and the sentence fell through to "no credit back"
// every single time. Nothing threw, nothing logged, the ledger was right
// throughout, and the only thing that was wrong was the last sentence somebody
// reads before an action that cannot be undone.
//
// It is the worst place on the site for a wrong number. It either stops a
// cancellation that should happen, or lets one happen under a false account of
// what it costs — and a family told they would get nothing, who then sees €330
// appear, has been given two reasons to distrust the figures.
//
// ⚠ AND A TEST WAS ALREADY WATCHING THIS, AND PASSED THROUGH IT. It asserted
// `/cancellation\.credit > 0[\s\S]{0,120}T\.confirmNoCredit/` against the CLIENT
// SOURCE — that the client reads a key called `credit` and falls back to the
// no-credit sentence. Both halves true, read separately, never once together.
// That is the same failure as the suite that clicked an invite button by its
// label while no human could find it: reading each side proves each side is
// self-consistent and can never prove they agree.
//
// So this one BUILDS BOTH PAYLOADS FROM REAL RECORDS and reads the sentence the
// client would render.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_helpers');
const F = require('./_fixtures');

const R = path.join(__dirname, '..');
const ui = fs.readFileSync(path.join(R, 'js/member-account.js'), 'utf8');

process.env.RESEND_FROM = 'Merkaz Ogen <noreply@ogen.cy>';

// creditNote(), lifted out and executed. Reading it is what missed this.
function noteMaker(strings) {
  const from = ui.indexOf('  function creditNote(cancellation) {');
  const to = ui.indexOf('\n  function ', from + 1);
  const ctx = vm.createContext({
    T: strings,
    money: (c) => '€' + (Number(c) / 100).toFixed(2)
  });
  vm.runInContext(ui.slice(from, to) + '\nthis.creditNote = creditNote;', ctx);
  return ctx.creditNote;
}
const T = { confirmCredit: 'CREDITED', confirmNoCredit: 'NOTHING BACK',
            whyNothing: { 'nothing-paid': 'NOTHING PAID', 'too-late': 'TOO LATE',
                          'started': 'STARTED', 'per-session': 'PER SESSION',
                          'past-cutoff': 'PAST CUTOFF', 'closed': 'CLOSED' } };
const creditNote = noteMaker(T);

(async () => {
  const blobs = H.makeBlobs();
  const course = F.course({ slug: 'term', activityId: 'act-0000000000000x01' });
  const github = H.makeGithub({ 'activities/term.json': JSON.stringify(course) });

  const mods = H.loadWithStubs({
    blobs, github,
    modules: ['_registration-store', '_credit-ledger', 'account-auth', 'account-family',
              'account-registrations']
  });
  const store = mods['_registration-store'];
  const ledger = mods['_credit-ledger'];
  const auth = mods['account-auth'];
  const family = mods['account-family'];
  const regs = mods['account-registrations'];

  require(H.fnPath('_email'))._internal.setTransport({
    emails: { send: async () => ({ data: { id: 'e-1' } }) }
  });

  const r = await H.signUp(auth, blobs, { email: 'dana@example.com',
    profile: { firstName: 'Dana', preferredLanguage: 'en' } });
  const dana = { token: r.body.token, accountId: r.body.account.accountId };
  const made = await H.call(family.handler, {
    action: 'createParticipant', token: dana.token,
    participant: { firstName: 'Noa', lastName: 'Levi', dateOfBirth: '2017-04-02' }
  });
  const noa = made.body.participant.participantId;
  await H.call(regs.handler,
    { action: 'submit', token: dana.token, slug: 'term', participantId: noa });

  const row = async () => {
    const res = await H.call(regs.handler, { action: 'registration', token: dana.token,
      participantId: noa, activityId: course.activityId });
    return res.body.registration;
  };

  // -------------------------------------------------------------------------
  console.log('[nothing paid: the dialog says nothing comes back, and it is right]');

  let reg = await row();
  H.ok(reg.cancellation, 'the payload carries what cancelling would do');
  H.eq(creditNote(reg.cancellation).join(' | '), 'NOTHING BACK | NOTHING PAID',
    'with nothing paid there is nothing to credit, and the sentence says so');

  // -------------------------------------------------------------------------
  console.log('[money on the record: the dialog says the FIGURE]');

  // The state QA was in: a term paid for, before the first session.
  const live = await store.getRegistration(noa, course.activityId);
  live.payment = Object.assign({}, live.payment, { paidCents: 33000 });
  live.status = 'approved';
  await store.saveRegistration(live);

  reg = await row();
  H.ok(reg.cancellation.credit > 0,
    '⚠ the payload carries a figure under the key the client reads — ' + reg.cancellation.credit);
  const said = creditNote(reg.cancellation).join(' | ');
  H.ok(/CREDITED/.test(said), 'so the dialog offers a credit rather than denying one: ' + said);
  H.ok(!/NOTHING BACK/.test(said), 'and does NOT say nothing comes back, which is what it said');
  H.ok(/330\.00/.test(said), 'naming the amount: ' + said);

  // ⚠ AND THE FIGURE IS THE ONE THAT IS ACTUALLY WRITTEN. A dialog agreeing with
  // a payload proves only that two readers of one bug agree. Cancel, and read
  // the ledger.
  const before = await ledger.balanceFor(dana.accountId);
  const done = await H.call(regs.handler, { action: 'cancel', token: dana.token,
    participantId: noa, activityId: course.activityId });
  H.eq(done.status, 200, 'the cancellation goes through');
  const moved = (await ledger.balanceFor(dana.accountId)) - before;
  H.eq(moved, reg.cancellation.credit,
    'and the ledger moved by EXACTLY what the dialog promised — ' + moved);

  // -------------------------------------------------------------------------
  console.log('\n[⚠ every caller of creditFor() supplies the clock]');
  //
  // _credit.js NEVER ASKS WHAT TIME IT IS. That is its contract and it is what
  // makes the same record and the same instant give the same figure a year
  // later — a test in another suite asserts the file contains no Date.now().
  //
  // The cost is that the second argument is not optional in meaning, only in
  // syntax: `past(date, undefined)` is FALSE and `hasStarted(starts, undefined)`
  // is FALSE, so `creditFor(reg)` reads every threshold as not yet reached and
  // returns the most generous answer the function can give.
  //
  // FIVE CALL SITES HAD OMITTED IT — the family's dialog and cancel button, the
  // cancellation-terms footnote, the family's own cancel gate, and both of the
  // admin's. Only cancelAndCredit() passed a timestamp, and it is the only one
  // that writes. So a family past every deadline was shown a cancel button,
  // promised the whole of what they had paid, and credited nothing; and an
  // admin's cancellation email named a figure the ledger never wrote, while the
  // 409 guard meant to catch exactly that compared two copies of the same wrong
  // number and agreed with itself.
  //
  // Greppable, so it is grepped.
  const FN = path.join(__dirname, '..', 'netlify', 'functions');
  const callers = fs.readdirSync(FN).filter((f) => /\.js$/.test(f) && f !== '_credit.js');
  let sites = 0;
  callers.forEach((f) => {
    const code = fs.readFileSync(path.join(FN, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const calls = code.match(/\bcreditFor(Session)?\s*\([^)]*\)/g) || [];
    calls.forEach((call) => {
      // `function creditFor(account)` in _registration-email.js is a different
      // function entirely — it reads a ledger balance — and is matched by name
      // alone. Declarations are not call sites.
      if (/^creditFor\s*\(account\)/.test(call)) return;
      sites++;
      H.ok(/,/.test(call),
        f + ': ' + call.trim() + ' passes a timestamp');
    });
  });
  H.ok(sites >= 5, 'and there were real call sites to check (' + sites + ')');

  // The one that always did, and the reason the others were invisible: it is the
  // only caller that WRITES, so the money was right and only the screens lied.
  const cancelSrc = fs.readFileSync(H.fnPath('_registration-cancel'), 'utf8');
  H.ok(/const at = now == null \? Date\.now\(\) : now;/.test(cancelSrc),
    'cancelAndCredit() resolves its own clock, and always did');

  console.log('\n[and a zero says WHY it is a zero]');
  //
  // ⚠ "NO CREDIT BACK" WITH NO ACCOUNT OF ITSELF READS AS A PENALTY, whatever
  // the reason — and the commonest reason by far is the gentlest one: nothing
  // has been paid yet, so there is nothing to give back. Reported as "we need to
  // explain also in the popup why no credit will be returned".
  //
  // The reason was already computed. _credit.js has returned one on every answer
  // since it was written and cancellationView() passed it straight through to a
  // client that never read it — the same shape as `priceBasis` sitting unread in
  // the sessions payload while a late price explained nothing.

  // 1. NOTHING PAID — the case in the report, and the one that must win over any
  //    deadline, because both can be true at once and "the window has closed"
  //    then implies money was lost when none ever moved.
  const fresh = await store.getRegistration(noa, course.activityId);
  fresh.payment = Object.assign({}, fresh.payment,
                                { paidCents: 0, creditedCents: 0, owedCents: 35000 });
  fresh.status = 'approved';
  await store.saveRegistration(fresh);
  let now = await row();
  H.eq(now.cancellation.credit, 0, 'nothing paid, nothing to credit');
  H.eq(now.cancellation.whyNothing, 'nothing-paid',
    '⚠ and the reason is that nothing was paid — not a deadline, not a policy');
  H.eq(creditNote(now.cancellation).join(' | '), 'NOTHING BACK | NOTHING PAID',
    'so the dialog says both: there is nothing back, and why');

  // 2. CREDIT — no reason at all. The figure is its own explanation, and a
  //    sentence under it would answer a question nobody asked.
  fresh.payment = Object.assign({}, fresh.payment, { paidCents: 33000 });
  await store.saveRegistration(fresh);
  now = await row();
  H.ok(now.cancellation.credit > 0, 'with money on the record there is credit');
  H.eq(now.cancellation.whyNothing, null, 'and no reason is sent');
  H.eq(creditNote(now.cancellation).length, 1, 'so the dialog is one line again');

  // 3. THE FEE'S OWN DATE. Paid, inside the cancellation window, and still
  //    nothing back: everything paid so far was the registration fee, and the
  //    fee answers to its own cutoff. The one case where the two thresholds come
  //    apart, and the one a "too late" sentence would describe wrongly.
  fresh.payment = Object.assign({}, fresh.payment, { paidCents: 5000 });
  fresh.frozen = JSON.parse(JSON.stringify(fresh.frozen));
  fresh.frozen.price.registrationFee = 50;
  fresh.frozen.price.feeCharged = true;
  fresh.frozen.cancellation.registrationFeeCutoffDate = '2020-01-01';
  fresh.frozen.cancellation.cancellationCutoffDate = null;
  fresh.frozen.cancellation.sessionStartsAt = [];
  await store.saveRegistration(fresh);
  now = await row();
  H.eq(now.cancellation.credit, 0, 'the whole fee was paid and its date has passed');
  H.eq(now.cancellation.whyNothing, 'past-cutoff',
    'so it says the date has passed rather than blaming a session deadline');

  // 4. A DROP-IN REGISTRATION credits nothing by design — there was no upfront
  //    commitment to unwind. Saying "too late" there would be plainly untrue.
  fresh.frozen.type = 'dropin';
  await store.saveRegistration(fresh);
  now = await row();
  H.eq(now.cancellation.credit, 0, 'a drop-in registration credits nothing');
  H.eq(now.cancellation.whyNothing, 'per-session',
    'and says the money is per evening rather than implying a lost deadline');

  // 5. ⚠ PAST THE HARD CUTOFF, AND THE BUTTON IS STILL THERE.
  //
  // It was not. creditFor() returned `guardianMayCancel: false` and the handler
  // turned that into a 409, so a family who had decided not to come back was
  // told they could not say so — on a screen whose only other option is to keep
  // a place they do not want, which also keeps it from the next family. Reported
  // as "I don't understand why a family should be rejected to cancel their
  // course. They can cancel, but not get a refund."
  //
  // And the two halves of one policy disagreed: creditForSession() has always
  // returned `mayCancel: true` past its own deadline and simply credited
  // nothing, under a comment claiming to match what the course cutoff did.
  fresh.frozen.type = 'course';
  fresh.payment = Object.assign({}, fresh.payment, { paidCents: 33000, creditedCents: 0 });
  fresh.frozen.cancellation.cancellationCutoffDate = '2020-01-01';
  fresh.frozen.cancellation.registrationFeeCutoffDate = null;
  fresh.status = 'approved';
  await store.saveRegistration(fresh);
  now = await row();
  H.eq(now.cancellation.mayCancel, true,
    'the cancel button is still offered after the cutoff');
  H.eq(now.cancellation.credit, 0, 'and it earns nothing');
  H.eq(now.cancellation.whyNothing, 'closed',
    'and the dialog says the window closed BEFORE anything is confirmed');
  H.eq(creditNote(now.cancellation).join(' | '), 'NOTHING BACK | CLOSED',
    'both lines, so nobody presses it expecting money');

  // Executed, not read: the client's own check is cosmetic, and what decides is
  // the handler.
  const shutBefore = await ledger.balanceFor(dana.accountId);
  const shut = await H.call(regs.handler, { action: 'cancel', token: dana.token,
    participantId: noa, activityId: course.activityId });
  H.eq(shut.status, 200, '⚠ and the SERVER lets it through — it answered 409 before');
  H.eq(await ledger.balanceFor(dana.accountId), shutBefore,
    'writing nothing to the ledger, which is the half the cutoff does decide');
  H.eq((await store.getRegistration(noa, course.activityId)).status, 'cancelled',
    'and the place is genuinely given back');

  console.log('\n[every reason has a sentence, in every language]');
  // 'fee-held' joined the set when the yearly fee stopped coming back while
  // another term of that year is still registered — see
  // a-refunded-fee-must-not-leave-a-live-term-unpaid.js. This list is what
  // makes an orphan detectable, so adding a reason means adding it here.
  const REASONS = ['nothing-paid', 'fee-held', 'too-late', 'started',
                   'per-session', 'past-cutoff', 'closed'];
  const tableSrc = ui.slice(ui.indexOf('var T = {'),
                            ui.indexOf('}[lang];', ui.indexOf('var T = {')) + '}[lang];'.length);
  ['he', 'en', 'ru'].forEach((l) => {
    const ctx = { lang: l };
    vm.runInNewContext(tableSrc + '\nresult = T;', ctx);
    const w = ctx.result.whyNothing;
    H.ok(w, l + ' has the table');
    REASONS.forEach((r) => {
      H.ok(typeof w[r] === 'string' && w[r].length > 10, l + ': "' + r + '" has a sentence');
    });
    H.eq(Object.keys(w).length, REASONS.length,
      l + ': and no orphan — a key with no producer is dead copy three languages carry');
    if (l === 'he') H.ok(/[\u0590-\u05FF]/.test(w['nothing-paid']), 'the Hebrew is in Hebrew');
    if (l === 'ru') H.ok(/[\u0400-\u04FF]/.test(w['nothing-paid']), 'the Russian is in Cyrillic');
  });

  // ⚠ AND EVERY VALUE THE SERVER CAN SEND IS ONE THE CLIENT HAS A SENTENCE FOR.
  // A code with no key renders as nothing, which is this bug wearing a different
  // costume: the dialog would say "no credit back" and stop again.
  const apiSrc = fs.readFileSync(H.fnPath('account-registrations'), 'utf8');
  const emitted = (apiSrc.slice(apiSrc.indexOf('function whyNoCredit'),
                                apiSrc.indexOf('function cancellationView'))
    .match(/return '([a-z-]+)'/g) || []).map((m) => m.slice(8, -1));
  H.ok(emitted.length >= 5, 'the server emits a real set of reasons (' + emitted.join(', ') + ')');
  emitted.forEach((r) => {
    H.ok(REASONS.indexOf(r) !== -1, 'the client has a sentence for "' + r + '"');
  });

  console.log('[one shape, both kinds of thing]');

  // A registration's answer and an evening's answer are different questions
  // with different internals; what they must not be is different KEY NAMES on
  // the one screen that renders both.
  const api = fs.readFileSync(H.fnPath('account-registrations'), 'utf8');
  H.ok(/function cancellationView\(c, paidCents\)/.test(api), 'there is one adapter');
  // ⚠ COUNTED ON CODE, NOT ON PROSE. This counted the raw file, so the paragraph
  // ABOVE the function explaining what it is for pushed the count to four and
  // failed a test about call sites — the same trap the stylesheet check was
  // fixed out of, where a comment naming `height:auto` made a naive search pass
  // whether or not the declaration was still there.
  const apiCode = api.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  H.eq((apiCode.match(/cancellationView\(/g) || []).length, 3,
    'declared once and used at both payload builders, and nowhere else');
  H.ok(!/cancellation: own \? credit\.creditForSession\(own, now\) : null/.test(api),
    'the session payload no longer emits the raw shape');
  H.ok(!/cancellation: credit\.creditFor\(reg\)\s*$/m.test(api),
    'nor does the registration payload');

  // The client reads ONE name for each, on both. `guardianMayCancel` was the
  // other half of the same split and was read for a registration only.
  const bare = ui.replace(/^\s*\/\/.*$/gm, '');
  H.ok(/cancellation\.mayCancel !== false/.test(bare),
    'the client asks mayCancel, which both now answer');
  H.ok(!/guardianMayCancel/.test(bare),
    'and the name that existed on only one of them is gone from the client');
  H.ok(!/cancellation\.total/.test(bare),
    'as is the other one — two names for one number is how this happened');

  // ⚠ THE ADAPTER MUST NOT INVENT A ZERO. `credit: c.credit || c.total` would
  // read a real 0 from a session as absent and fall through to a term's total,
  // which on a record carrying both would quietly report the wrong figure. It is
  // `!== undefined`, and this is the case that tells them apart.
  H.ok(/c\.credit !== undefined \? c\.credit : c\.total/.test(api),
    'a genuine zero is taken as a zero, not as a missing value');
  H.ok(/c\.mayCancel !== undefined \? c\.mayCancel/.test(api),
    'and the same for a genuine false');

  H.done();
})();
