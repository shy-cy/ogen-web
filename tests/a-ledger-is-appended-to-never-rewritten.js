// What this defends against:
//
// A balance is the easiest number in this system to get quietly wrong. Two
// things make it safe, and both are refusals rather than features:
//
//   1. THE LEDGER IS APPEND-ONLY. An entry is never edited and never deleted; a
//      mistake is corrected by writing the opposite line, which leaves both in
//      the record. That is the point — the question a family asks is not "what
//      is my balance" but "why is it that".
//
//   2. THERE IS NO CACHED BALANCE. A stored total and a list of entries are two
//      representations of one fact on a store with no transaction to keep them
//      agreeing, and the sister project's own wallet warns that this failure is
//      silent and loses money. The balance is summed, every time.
//
// Three more rules that were each a way to lose money:
//
//   - amountCents is ALWAYS POSITIVE and the sign lives in `type`, so a negative
//     credit cannot mean a debit somewhere and a credit somewhere else.
//   - ZERO IS REFUSED. A zero entry is a line in a financial record that means
//     nothing and still has to be explained later; the caller with nothing to
//     write writes nothing.
//   - THE LEDGER IS WRITTEN BEFORE THE REGISTRATION, which is the opposite of
//     the rule for email and for the opposite reason. An email not sent leaves a
//     person waiting; a credit not written is money lost with nobody able to
//     tell. So a failed ledger write takes the whole cancellation down and the
//     family keeps their place.
//
// And the axis: reading a ledger is `access`, moving money is `cancel`. An admin
// who may approve registrations is not thereby an admin who may hand out credit.

const H = require('./_helpers');
const F = require('./_fixtures');

process.env.RESEND_FROM = 'Merkaz Ogen <noreply@ogen.cy>';

(async () => {
  const blobs = H.makeBlobs();
  const activity = F.course({
    facts: Object.assign({}, F.rawCourse().facts, {
      // Starts well after the cancellation, so the course credits in full and
      // there is a real number to move around.
      duration: Object.assign({}, F.rawCourse().facts.duration, { startDate: '2027-01-11' })
    })
  });
  const github = H.makeGithub({ 'activities/course-fixture.json': JSON.stringify(activity) });

  const mods = H.loadWithStubs({
    blobs, github,
    modules: ['_credit-ledger', '_registration-store', 'account-auth', 'account-family',
              'account-registrations', 'admin-registrations']
  });
  const ledger = mods['_credit-ledger'];
  const store = mods['_registration-store'];
  const auth = mods['account-auth'];
  const family = mods['account-family'];
  const regs = mods['account-registrations'];
  const adminRegs = mods['admin-registrations'];

  require(H.fnPath('_email'))._internal.setTransport({
    emails: { send: async () => ({ data: { id: 'x' } }) }
  });

  console.log('[the shape of an entry]');
  const A = 'a-testaccount0001';
  await ledger.append({ accountId: A, type: 'credit', amountCents: 12000,
                        reason: 'admin-adjustment', mode: 'live', note: 'goodwill', createdBy: 'michal@ogen.cy' });
  const one = (await ledger.entriesFor(A))[0];
  H.eq(one.amountCents, 12000, 'integer cents, never euros — a float balance drifts and cannot be explained');
  H.eq(one.type, 'credit', 'and the sign lives here, not in the number');

  let refused = null;
  try { await ledger.append({ accountId: A, type: 'credit', amountCents: 0, reason: 'admin-adjustment', mode: 'live' }); }
  catch (err) { refused = err.message; }
  H.ok(/positive/.test(refused || ''), 'zero is refused — a line meaning nothing still has to be explained');
  refused = null;
  try { await ledger.append({ accountId: A, type: 'credit', amountCents: 100, reason: 'goodwill-ish', mode: 'live' }); }
  catch (err) { refused = err.message; }
  H.ok(/Unknown ledger reason/.test(refused || ''),
    'and the reason is a closed list, so a typo cannot invent a category');

  console.log('\n[two entries in the same millisecond do not overwrite each other]');
  const at = Date.parse('2026-11-01T10:00:00Z');
  await ledger.append({ accountId: A, type: 'credit', amountCents: 500, reason: 'admin-adjustment', mode: 'live', createdAt: at });
  await ledger.append({ accountId: A, type: 'credit', amountCents: 700, reason: 'admin-adjustment', mode: 'live', createdAt: at });
  H.eq((await ledger.entriesFor(A)).length, 3,
    'the random tail is what saves them — there is no compare-and-swap to fall back on');

  console.log('\n[the balance is summed, never stored]');
  H.eq(await ledger.balanceFor(A, 'live'), 13200, 'credits add');
  await ledger.append({ accountId: A, type: 'debit', amountCents: 3200, reason: 'credit-applied', mode: 'live' });
  H.eq(await ledger.balanceFor(A, 'live'), 10000, 'and debits subtract');
  H.eq(ledger.balanceOf([], 'live'), 0, 'an account with no entries holds nothing, which needs no special case');
  // Correcting a mistake leaves BOTH lines.
  await ledger.append({ accountId: A, type: 'debit', amountCents: 10000, reason: 'admin-adjustment', mode: 'live', note: 'written back' });
  H.eq(await ledger.balanceFor(A, 'live'), 0, 'a correction is the opposite entry');
  H.eq((await ledger.entriesFor(A)).length, 5, 'and the record still holds every line that led there');

  console.log('\n[a cancellation writes one, and the registration records it]');
  const signed = await H.signUp(auth, blobs, {
action: 'signup', email: 'dana@example.com', password: 'password-123', termsAccepted: true,
    profile: { firstName: 'Dana', preferredLanguage: 'en' } });
  const dana = { token: signed.body.token, accountId: signed.body.account.accountId };
  const noa = (await H.call(family.handler, {
    action: 'createParticipant', token: dana.token,
    participant: { firstName: 'Noa', dateOfBirth: '2017-04-02' } })).body.participant.participantId;
  await H.call(regs.handler, { action: 'submit', token: dana.token, slug: 'course-fixture', participantId: noa });

  const admin = await H.installSession(blobs, H.superAdminSession({ token: 'full', email: 'michal@ogen.cy' }));
  const target = { participantId: noa, activityId: activity.activityId };

  // Nothing paid, so nothing to credit — and no entry at all, which is the rule
  // rather than an accident of the arithmetic.
  const beforePay = await H.call(regs.handler,
    Object.assign({ action: 'cancel', token: dana.token }, target));
  H.eq(beforePay.body.entry, null, 'a family who has paid nothing is owed nothing, and NO entry is written');
  H.eq(beforePay.body.balance, 0, 'so the balance does not move');

  // Now with money on it.
  await H.call(regs.handler, { action: 'submit', token: dana.token, slug: 'course-fixture', participantId: noa });
  const paid = await H.call(adminRegs.handler,
    Object.assign({ action: 'recordPayment', token: admin.token, amountCents: 35000 }, target));
  H.eq(paid.status, 200, 'the admin records a payment');
  H.eq(paid.body.registration.payment.paidCents, 35000, 'which ADDS rather than sets');
  H.eq(paid.body.registration.payment.status, 'paid', 'and settles it, because it covers what was billed');

  const cancelled = await H.call(regs.handler,
    Object.assign({ action: 'cancel', token: dana.token }, target));
  H.eq(cancelled.status, 200, 'the family cancels before the course starts');
  H.eq(cancelled.body.credit.total, 35000, 'and is owed all of it');
  H.ok(cancelled.body.entry && cancelled.body.entry.amountCents === 35000, 'a ledger entry is written');
  H.eq(cancelled.body.entry.reason, 'registration-cancelled-by-guardian', 'saying who ended it');
  H.ok(cancelled.body.entry.basis && cancelled.body.entry.basis.sessionsTotal === 10,
    'and WHY that amount — the mode, both dates, the sessions, and the two figures added');
  H.eq(cancelled.body.balance, 35000, 'the balance is the sum of the lines');

  const after = await store.getRegistration(noa, activity.activityId);
  H.eq(after.payment.creditedCents, 35000, 'the registration records what came back');
  H.eq(after.payment.feeCreditedCents, 5000,
    'and the FEE half apart, because the waiver reads it — a refunded fee is paid again next time');

  console.log('\n[reading a ledger is access; moving money is cancel]');
  const approver = await H.installSession(blobs, H.superAdminSession({
    token: 'approver', email: 'approver@ogen.cy',
    permissions: Object.assign({}, H.superAdminSession().permissions,
      { registrations: { access: true, approve: true, cancel: false } })
  }));
  const read = await H.call(adminRegs.handler, {
    action: 'ledger', token: approver.token, accountId: dana.accountId });
  H.eq(read.status, 200, 'an approver may read what a family is owed');
  H.eq(read.body.balanceCents, 35000, 'and see the same number');
  H.eq((await H.call(adminRegs.handler, {
    action: 'adjustCredit', token: approver.token, accountId: dana.accountId,
    amountCents: 5000, note: 'because' })).status, 403,
    'but may not write a line into it');
  H.eq((await H.call(adminRegs.handler, {
    action: 'recordPayment', token: approver.token, amountCents: 100,
    participantId: noa, activityId: activity.activityId })).status, 403,
    'nor record a payment');

  console.log('\n[an adjustment has to say why]');
  H.eq((await H.call(adminRegs.handler, {
    action: 'adjustCredit', token: admin.token, accountId: dana.accountId, amountCents: 5000
  })).status, 400, 'a number with no note is refused');
  const adj = await H.call(adminRegs.handler, {
    action: 'adjustCredit', token: admin.token, accountId: dana.accountId,
    amountCents: 5000, note: 'agreed by phone' });
  H.eq(adj.status, 200, 'with one, it lands');
  H.eq(adj.body.balanceCents, 40000, 'and the balance follows');

  console.log('\n[credit spent is a debit, and cannot exceed what is held]');
  await H.call(regs.handler, { action: 'submit', token: dana.token, slug: 'course-fixture', participantId: noa });
  const tooMuch = await H.call(adminRegs.handler,
    Object.assign({ action: 'applyCredit', token: admin.token, amountCents: 99000 }, target));
  H.eq(tooMuch.status, 409, 'more than the account holds is refused');
  H.eq(tooMuch.body.balanceCents, 40000, 'and the refusal says what it does hold');
  const applied = await H.call(adminRegs.handler,
    Object.assign({ action: 'applyCredit', token: admin.token, amountCents: 30000 }, target));
  H.eq(applied.status, 200, 'within it, the credit is spent');
  H.eq(applied.body.entry.type, 'debit', 'as a debit');
  H.eq(applied.body.balanceCents, 10000, 'the balance drops');
  H.eq(applied.body.registration.payment.paidCents, 30000,
    'and the same euros land on the registration — one action, or the two disagree');

  console.log('\n[the family can see it all]');
  // The dashboard action, which is where a family's balance now comes from: it
  // was its own call, and three requests for one screen is what that screen was
  // waiting on.
  const mine = await H.call(regs.handler, { action: 'dashboard', token: dana.token });
  H.eq(mine.body.balanceCents, 10000, 'the same number they were told');
  H.eq(mine.body.entries.length, 3, 'and every line behind it');
  H.ok(mine.body.entries.every((e) => e.amountCents > 0), 'all positive, with the sign in the type');

  // ⚠ AND THE FIGURE AND THE LINES UNDER IT ARE THE SAME KIND OF MONEY.
  //
  // An account can hold a rehearsal's credit as well as real credit — a test
  // activity is published for real and its cancellations write real ledger lines
  // in test mode. The dashboard is about an ACCOUNT rather than about one
  // activity, so there is no record to take a mode from and the honest headline is
  // the money they actually have. What must not happen is the card printing that
  // total and then listing rows that do not add up to it, which is what sending
  // every entry would do — and it would make this card the one place on the site
  // where the two kinds of money appear in one column.
  await ledger.append({ accountId: dana.accountId, type: 'credit', amountCents: 4200,
                        reason: 'admin-adjustment', mode: 'test', note: 'a rehearsal' });
  const mixed = await H.call(regs.handler, { action: 'dashboard', token: dana.token });
  H.eq(mixed.body.balanceCents, 10000,
    'a rehearsal\u2019s credit does not move the balance a family is shown');
  H.eq(mixed.body.entries.length, 3, 'and its line is not listed under that balance either');
  H.ok(mixed.body.entries.every((e) => e.mode !== 'test'),
    '\u26a0 so the total and the lines under it are the same kind of money — the test ' +
    'activity\u2019s own page is where its balance is shown, because that is where it can be spent');

  console.log('\n[unlinking a guardian who still owes is a question, not a rule]');
  // The admin override exists for lost access and disputes, which is precisely
  // when there is likely to be an unpaid registration attached to the guardian
  // being removed. There is no rule for what happens to it; there is a question,
  // and the action refuses to complete until it is answered.
  const adminFamily = H.loadWithStubs({ blobs, github, modules: ['admin-family'] })['admin-family'];
  const second = await H.signUp(auth, blobs, {
action: 'signup', email: 'yossi@example.com', password: 'password-123', termsAccepted: true,
    profile: { firstName: 'Yossi', preferredLanguage: 'en' } });
  await H.call(adminFamily.handler, {
    action: 'linkGuardian', token: admin.token, participantId: noa, email: 'yossi@example.com' });

  const unpaid = await store.getRegistration(noa, activity.activityId);
  H.ok(unpaid.payment.owedCents > unpaid.payment.paidCents, 'the registration is not settled');

  const asked = await H.call(adminFamily.handler, {
    action: 'unlinkGuardian', token: admin.token, participantId: noa, accountId: dana.accountId });
  H.eq(asked.status, 409, 'the unlink refuses to complete on its own');
  H.eq(asked.body.requires, 'debtDisposition', 'and says what it is waiting for');
  H.eq(asked.body.owed.length, 1, 'naming what is owed');
  H.eq(asked.body.remainingGuardian, second.body.account.accountId, 'and who is left to take it');
  // No default and no "skip". Both options are real choices somebody makes.
  H.eq(asked.body.options.join(','), 'reassign,write-off', 'two answers, neither of them "leave it"');
  H.eq((await H.call(adminFamily.handler, {
    action: 'unlinkGuardian', token: admin.token, participantId: noa,
    accountId: dana.accountId, debtDisposition: 'ignore' })).status, 409,
    'and an answer that is not one of them is not an answer');

  const moved = await H.call(adminFamily.handler, {
    action: 'unlinkGuardian', token: admin.token, participantId: noa,
    accountId: dana.accountId, debtDisposition: 'reassign' });
  H.eq(moved.status, 200, 'answered, it goes through');
  const reassigned = await store.getRegistration(noa, activity.activityId);
  H.eq(reassigned.accountId, second.body.account.accountId, 'the debt moves to the remaining guardian');
  H.eq(reassigned.payment.reassignedFrom, dana.accountId,
    'and it records who it came from, because the person being asked to pay did not submit it');
  H.ok(reassigned.history.some((h) => h.action === 'debt-reassign'),
    'and the history says what was decided');

  H.done();
})();
