// What this defends against:
//
// A family settled a term with credit on a card where the PAY BUTTON had been
// correctly withheld, for two different reasons, in one QA session:
//
//   - their email address had never been confirmed, which is a course rule the
//     pay button applies and this door did not;
//   - the registration was still `pending`, waiting for an admin to say yes,
//     and the credit paid for a place nobody had agreed to give.
//
// Both holes were the same hole. `useCredit` settles the SAME debt on the SAME
// record and writes the SAME `payment.status` as `pay` does — the only thing
// that differs is which pocket the money comes out of, and neither gate is
// about the pocket. It was simply never asked, because it was written as a
// wallet feature rather than as a payment.
//
// That is this project's own "two doors, one payment" lesson arriving by a
// third door. _checkout.js exists because the button on the page and the
// emailed link must charge the same thing on the same terms; a test already
// asserts exactly one file opens a Stripe session. Nothing was watching the
// door that moves money without Stripe at all.
//
// ⚠ AND THE CLIENT MADE IT WORSE RATHER THAN HIDING IT. The credit button was
// drawn ABOVE the block that decides whether to draw the pay button, so the
// screen that had just refused to take a card offered to take the balance
// instead, two lines higher.
//
// The per-SESSION spend is deliberately exempt, and that exemption is asserted
// too: an attendance record exists only for a drop-in, which never asks for a
// confirmed address, and a booked evening is a booking rather than a request
// somebody may still refuse.

const H = require('./_helpers');
const F = require('./_fixtures');

process.env.RESEND_FROM = 'Merkaz Ogen <noreply@ogen.cy>';

(async () => {
  const blobs = H.makeBlobs();
  // autoApprove OFF, so a submission lands as `pending` — which is the state
  // that must not be payable by any means.
  const manual = F.course({ slug: 'term', activityId: 'act-0000000000000x01' });
  manual.registration = Object.assign({}, manual.registration, { autoApprove: false });
  const github = H.makeGithub({ 'activities/term.json': JSON.stringify(manual) });

  const mods = H.loadWithStubs({
    blobs, github,
    modules: ['_registration-store', '_credit-ledger', 'account-auth', 'account-family',
              'account-registrations', '_account-store']
  });
  const store = mods['_registration-store'];
  const ledger = mods['_credit-ledger'];
  const auth = mods['account-auth'];
  const family = mods['account-family'];
  const regs = mods['account-registrations'];
  const accounts = mods['_account-store'];

  require(H.fnPath('_email'))._internal.setTransport({
    emails: { send: async () => ({ data: { id: 'e-1' } }) }
  });

  const r = await H.call(auth.handler, {
    action: 'signup', email: 'dana@example.com', password: 'password-123', termsAccepted: true,
    profile: { firstName: 'Dana', preferredLanguage: 'en' }
  });
  const dana = { token: r.body.token, accountId: r.body.account.accountId };
  const made = await H.call(family.handler, {
    action: 'createParticipant', token: dana.token,
    participant: { firstName: 'Noa', lastName: 'Levi', dateOfBirth: '2017-04-02' }
  });
  const noa = made.body.participant.participantId;
  const target = { participantId: noa, activityId: manual.activityId };

  // Real money on the account, so every refusal below is about the rule rather
  // than about an empty wallet.
  await ledger.append({ accountId: dana.accountId, type: 'credit', amountCents: 100000,
                        reason: 'admin-adjustment', note: 'seeded by the test' });
  H.eq(await ledger.balanceFor(dana.accountId), 100000, 'the account is holding €1000');

  const use = () => H.call(regs.handler, Object.assign({ action: 'useCredit', token: dana.token }, target));
  const pay = () => H.call(regs.handler, Object.assign({ action: 'pay', token: dana.token }, target));
  const owing = async () => {
    const reg = await store.getRegistration(noa, manual.activityId);
    return { status: reg.status, owed: reg.payment.owedCents,
             paid: reg.payment.paidCents, credited: reg.payment.creditedCents };
  };

  // -------------------------------------------------------------------------
  console.log('[the gate is at the FRONT now: no course from an unconfirmed address]');

  const early = await H.call(regs.handler,
    { action: 'submit', token: dana.token, slug: 'term', participantId: noa });
  H.eq(early.status, 403, 'registering for a course is refused before anything is written');
  H.eq(early.body.reason, 'email-unverified', 'naming the rule');
  H.eq(await store.getRegistration(noa, manual.activityId), null,
    'and no registration exists — the wall is before the commitment, not after it');

  // -------------------------------------------------------------------------
  console.log('[and the doors further down still hold, for a record taken before it]');

  // A registration on an unconfirmed account is no longer creatable through the
  // handlers, which is the point of the change. It still EXISTS: every one taken
  // before today, and anything an admin registers by hand. So the gates at
  // payment are not made redundant by the one at the front, and this is how a
  // suite reaches that state.
  await H.confirmAddress(blobs, dana.accountId);
  const sub = await H.call(regs.handler,
    { action: 'submit', token: dana.token, slug: 'term', participantId: noa });
  H.ok(sub.status < 300, 'the registration is taken once the address is confirmed');
  H.eq((await owing()).status, 'pending', 'and waits for a person, because autoApprove is off');
  H.ok((await owing()).owed > 0, 'with something owed on it — €' + (await owing()).owed / 100);

  await H.confirmAddress(blobs, dana.accountId, false);
  const account = await accounts.getAccount(dana.accountId);
  H.ok(!account.emailVerifiedAt, 'now the address is unconfirmed under a live registration');

  const payUnverified = await pay();
  H.eq(payUnverified.status, 403, 'the card door asks for a confirmed address on a term');
  H.eq(payUnverified.body.reason, 'email-unverified', 'and says which rule');

  // ⚠ THE ONE THAT WAS REPORTED. Same record, same debt, other pocket.
  const creditUnverified = await use();
  H.eq(creditUnverified.status, 403, 'and the credit door asks the same question');
  H.eq(creditUnverified.body.reason, 'email-unverified',
    'with the same reason, so the client branches on one thing rather than two');
  H.eq((await owing()).paid, 0, 'and nothing was paid against the place');
  H.eq(await ledger.balanceFor(dana.accountId), 100000, 'and the balance is untouched');

  // The refusal is in the reader's language, like every other one here.
  const inHebrew = await H.call(regs.handler, Object.assign(
    { action: 'useCredit', token: dana.token, lang: 'he' }, target));
  H.ok(/[\u0590-\u05FF]/.test(inHebrew.body.error), 'Hebrew: ' + inHebrew.body.error);

  // -------------------------------------------------------------------------
  console.log('[and neither is a place nobody has agreed to give]');

  // The address is confirmed now, so the FIRST gate can no longer be what is
  // doing the refusing, and the second is tested rather than shadowed by it.
  await H.confirmAddress(blobs, dana.accountId);
  H.eq((await owing()).status, 'pending', 'the registration is still waiting for an admin');

  const payPending = await pay();
  H.eq(payPending.status, 409, 'the card door refuses a pending place');
  H.eq(payPending.body.reason, 'not-approved', 'because it is not approved');

  const creditPending = await use();
  H.eq(creditPending.status, 409, 'and so does the credit door');
  H.eq(creditPending.body.reason, 'not-approved',
    'reading the same isPayable() both other doors read');
  H.eq((await owing()).paid, 0, 'and still nothing has moved');
  H.eq(await ledger.balanceFor(dana.accountId), 100000, 'and the balance is still whole');

  // -------------------------------------------------------------------------
  console.log('[with both answered, the credit is spent exactly as before]');

  // The direction that would do real damage: a fix that refuses everything is
  // indistinguishable from one that refuses the right things, until a family
  // cannot spend what they are owed.
  let reg = await store.getRegistration(noa, manual.activityId);
  reg.status = 'approved';
  await store.saveRegistration(reg);

  const owed = (await owing()).owed;
  const good = await use();
  H.eq(good.status, 200, 'an approved registration on a confirmed address spends it');
  H.eq((await owing()).paid, owed, 'the whole debt is settled from the balance');
  H.eq(await ledger.balanceFor(dana.accountId), 100000 - owed,
    'and the ledger is down by exactly that, never more');

  // Capped at the debt, which the suite beside this one pins in the pure half —
  // repeated here because the gates are new code around the same call.
  const again = await use();
  H.ok(again.status >= 400, 'and a second press finds nothing left to settle');

  // -------------------------------------------------------------------------
  console.log('[a drop-in evening is exempt, and that is not an oversight]');

  // An attendance record exists only for a drop-in, and a drop-in never asks
  // for a confirmed address; a booked evening is already a booking rather than
  // a request. So the sessionDate path skips both deliberately, and the source
  // says so in one condition rather than by omission.
  const api = require('fs').readFileSync(H.fnPath('account-registrations'), 'utf8');
  const branch = api.slice(api.indexOf("case 'useCredit'"), api.indexOf("case 'cancelSession'"));
  H.ok(/if \(!body\.sessionDate\) \{/.test(branch),
    'the two gates are inside one explicit "this is a registration" condition');
  H.ok(branch.indexOf('verificationRefusal') < branch.indexOf('spend.spendCredit'),
    'and both run before a cent moves');

  H.done();
})();
