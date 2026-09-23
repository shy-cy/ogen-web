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
const T = { confirmCredit: 'CREDITED', confirmNoCredit: 'NOTHING BACK' };
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
  H.eq(creditNote(reg.cancellation), 'NOTHING BACK',
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
  const said = creditNote(reg.cancellation);
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
  console.log('[one shape, both kinds of thing]');

  // A registration's answer and an evening's answer are different questions
  // with different internals; what they must not be is different KEY NAMES on
  // the one screen that renders both.
  const api = fs.readFileSync(H.fnPath('account-registrations'), 'utf8');
  H.ok(/function cancellationView\(c\)/.test(api), 'there is one adapter');
  H.eq((api.match(/cancellationView\(/g) || []).length, 3,
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
