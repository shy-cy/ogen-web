// What this defends against:
//
// Asked as a question first: is spending credit on ONE EVENING already working
// on the family's own side, and only missing on the admin's? It was, exactly,
// at all three layers — and that is what makes this a door rather than a rule.
//
//   _spend-credit.js   takes `kind: 'session'`, saves to the attendance store
//                      through attendance.transition(), and writes the ledger
//                      line with `basis: { perSession: true, sessionDate }`
//   useCredit          branches on body.sessionDate and loads the attendance
//   member-account.js  draws creditButton() on every evening row, passing the
//                      date
//
// ⚠ AND THE ADMIN'S `applyCredit` LOADED A REGISTRATION AND NOTHING ELSE. So a
// family who rang and asked somebody to put their balance towards Tuesday was
// answered by a screen that could settle their term and not their evening —
// while they could have done it themselves from their own page. The same shape
// as markAttendance before the register existed, and as recordSessionPayment
// before this panel did: the mechanism written, tested and reachable from one
// side only.
//
// Four things have to hold:
//
//   1. THE SPENDER IS THE SAME ONE. Two implementations would be two that cap
//      differently or write the two halves in a different order, and the
//      difference surfaces when a family reads their balance to the admin
//      reading theirs.
//   2. ⚠ THE LEDGER LINE NAMES THE EVENING. "Credit applied" against a term
//      somebody has five bookings on answers nothing six weeks later.
//   3. ⚠ THE TERM MUST NOT MOVE. An evening and a registration are different
//      pots; credit spent on Tuesday that quietly settled the term's bill would
//      be right in the balance and wrong in both records.
//   4. Capped at what THIS EVENING owes and at what the account holds, and
//      refused past either. Credit paid beyond a debt is not a payment, it is
//      credit deleted.
//
// And one asymmetry that is deliberate and stays: the FAMILY's amount is decided
// server-side — spendable(record, balance), the smaller of the two — because a
// client that names its own figure is a client that can name somebody else's
// balance. An ADMIN names one, because part of a debt is a real thing to settle
// at a desk. Both go through the same caps.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_helpers');
const D = require('./_dom');
const F = require('./_fixtures');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');

// ---------------------------------------------------------------------------
console.log('[one spender, and both doors go through it]');

// ⚠ BY SHAPE, so a second implementation cannot arrive quietly. spendCredit() is
// the only thing that may write a `credit-applied` debit, and the two handlers
// have to reach it rather than reimplementing the four rules it holds.
const spender = read('netlify/functions/_spend-credit.js');
H.ok(/kind === 'session'/.test(spender), 'the spender knows what an evening is');
const writers = ['netlify/functions/account-registrations.js',
                 'netlify/functions/admin-registrations.js',
                 'netlify/functions/_registration-cancel.js']
  .filter((p) => /'credit-applied'/.test(read(p)));
H.eq(writers.join(','), '',
  '⚠ and no handler writes a credit-applied entry of its own — there is one spender');
['netlify/functions/account-registrations.js',
 'netlify/functions/admin-registrations.js'].forEach((p) => {
  H.ok(/spendCredit\(/.test(read(p)), path.basename(p) + ' reaches it');
  H.ok(/kind: (body\.sessionDate|onDate) \? 'session' : 'registration'/.test(read(p)),
    '⚠ and decides term-or-evening the same way: ' + path.basename(p));
});

(async () => {
  // ---------------------------------------------------------------- server --
  console.log('\n[the admin can put a balance on one evening]');

  const blobs = H.makeBlobs();
  const activity = F.dropin();
  const AID = activity.activityId;
  const github = H.makeGithub({
    'activities/drop.json': JSON.stringify(Object.assign({}, activity, { slug: 'drop' })),
    'activities/activities-index.json': JSON.stringify(
      [{ slug: 'drop', activityId: AID, status: 'open', langs: ['he'], title: activity.title }])
  });
  const mods = H.loadWithStubs({ blobs, github,
    modules: ['admin-registrations', '_session-attendance', '_registration-store',
              '_registration', '_account-store', '_credit-ledger'] });
  const api = mods['admin-registrations'];
  const att = mods['_session-attendance'];
  const regStore = mods['_registration-store'];
  const REG = mods['_registration'];
  const accts = mods['_account-store'];
  const ledger = mods['_credit-ledger'];

  await H.installSession(blobs, H.superAdminSession());
  const account = await accts.createAccount({ email: 'desk@example.com',
    password: 'longenough1', termsAccepted: true });

  const dates = activity.groups[0].facts.duration.sessionDates.map((d) => d.date);
  const [D1, D2] = dates;
  H.ok(D1 && D2, 'the fixture has two evenings: ' + D1 + ', ' + D2);

  const book = async (date) => {
    const a = att.newAttendance({
      activity: activity, participantId: 'p-1', accountId: account.accountId,
      groupId: activity.groups[0].groupId, sessionDate: date,
      resolveSessionInstant: () => Date.parse(date + 'T16:00:00Z')
    });
    await att.saveAttendance(a);
    return a;
  };
  const one = await book(D1);
  const two = await book(D2);
  const OWED = one.payment.owedCents;

  const reg = REG.newRegistration({
    activity: activity, accountId: account.accountId, groupId: activity.groups[0].groupId,
    participant: { participantId: 'p-1', firstName: 'Noa', lastName: 'Levi',
                   dateOfBirth: '2016-01-01' }
  });
  await regStore.saveRegistration(reg);

  await ledger.append({ accountId: account.accountId, type: 'credit',
    amountCents: OWED * 3, reason: 'registration-cancelled-by-admin', createdBy: 'test' });
  const startBalance = await ledger.balanceFor(account.accountId);
  H.eq(startBalance, OWED * 3, 'the account holds a balance: ' + startBalance);

  const apply = (over) => H.call(api.handler, Object.assign({
    action: 'applyCredit', token: 'test-token',
    participantId: 'p-1', activityId: AID
  }, over || {}));

  // Part of it first, because an admin settling part of a debt at a desk is the
  // reason the admin names the amount at all.
  let res = await apply({ sessionDate: D1, amountCents: Math.floor(OWED / 2),
                          note: 'they rang' });
  H.eq(res.status, 200, 'part of the balance goes onto one evening');
  H.eq(res.body.session.sessionDate, D1,
    '⚠ and it comes back as `session`, the name this handler already uses for a booking');
  H.eq(res.body.session.payment.paidCents, Math.floor(OWED / 2), 'the booking is part paid');
  H.eq(res.body.session.payment.status, 'owed',
    'and still owed — a part payment reading as settled is a debt nobody chases');
  H.eq(res.body.balanceCents, startBalance - Math.floor(OWED / 2), 'the balance falls by that much');

  // ⚠ THE LEDGER LINE NAMES WHICH EVENING.
  const entries = await ledger.entriesFor(account.accountId);
  const debit = entries.filter((e) => e.type === 'debit')[0];
  H.eq(debit.reason, 'credit-applied', 'the debit is written under the one reason for it');
  H.ok(debit.basis && debit.basis.perSession === true,
    '⚠ and the basis says it was an evening');
  H.eq(debit.basis.sessionDate, D1,
    '⚠ and WHICH evening — "credit applied" against a term with five bookings answers nothing');
  H.eq(debit.createdBy, 'michal@ogen.cy', 'recorded against the admin who did it, not the family');

  // ⚠ THE TERM AND THE OTHER EVENING HAVE NOT MOVED.
  const term = await regStore.getRegistration('p-1', AID);
  H.eq(term.payment.paidCents, reg.payment.paidCents,
    '⚠ the registration is untouched — an evening and a term are different pots');
  H.eq((await att.getAttendance('p-1', AID, D2)).payment.paidCents, two.payment.paidCents,
    'and so is the other evening');

  // The caps, both of them, from the one spender.
  res = await apply({ sessionDate: D1, amountCents: OWED });
  H.eq(res.status, 409, '⚠ more than THIS EVENING owes is refused');
  H.eq(res.body.reason, 'over-paying', 'and says which cap it hit: ' + res.body.reason);
  H.eq(res.body.owedCents, OWED - Math.floor(OWED / 2), 'naming what is left on it');

  res = await apply({ sessionDate: D1, amountCents: OWED - Math.floor(OWED / 2) });
  H.eq(res.status, 200, 'the rest of it settles the evening');
  H.eq(res.body.session.payment.status, 'paid', 'and now it is paid');

  res = await apply({ sessionDate: '2099-01-01', amountCents: 100 });
  H.eq(res.status, 404, 'an evening with no booking is a 404, not a new record');
  H.eq(res.body.error, 'No such booking.',
    'and says booking rather than registration, because that is what was asked for');

  res = await apply({ sessionDate: D2, amountCents: 0 });
  H.eq(res.status, 400, 'nought is not an amount');

  // Drain the balance, then prove the other cap.
  const left = await ledger.balanceFor(account.accountId);
  await ledger.append({ accountId: account.accountId, type: 'debit', amountCents: left,
                        reason: 'admin-adjustment', note: 'drained', createdBy: 'test' });
  res = await apply({ sessionDate: D2, amountCents: 100 });
  H.eq(res.status, 409, '⚠ and more than the account holds is refused');
  H.eq(res.body.reason, 'insufficient', 'by the other cap: ' + res.body.reason);

  // The term's own path still works, unchanged, and still answers under its own
  // name — the client reads `session || registration` and must not get both.
  await ledger.append({ accountId: account.accountId, type: 'credit', amountCents: 5000,
                        reason: 'registration-cancelled-by-admin', createdBy: 'test' });
  res = await apply({ amountCents: 1000 });
  H.eq(res.status, 200, 'a term is settled from the same action with no date');
  H.ok(res.body.registration && !res.body.session,
    '⚠ under `registration`, and only that — one key, so the client needs no third branch');

  // ⚠ STILL THE CANCEL AXIS.
  const queueOnly = H.superAdminSession({ token: 'queue-only' });
  queueOnly.permissions.registrations = { access: true, approve: true, cancel: false };
  await H.installSession(blobs, queueOnly);
  H.eq((await apply({ sessionDate: D2, amountCents: 100, token: 'queue-only' })).status, 403,
    '⚠ a role that may approve but not cancel is refused: this moves money');
  await H.installSession(blobs, H.superAdminSession());

  // ---------------------------------------------------------------- client --
  console.log('\n[and the panel draws the form]');

  const src = read('js/registrations-admin.js');
  const IDS = ['messages', 'picker', 'queue-panel', 'queue-title', 'capacity', 'dates', 'queue',
               'bundles-panel', 'bundles', 'codes-panel', 'codes', 'account-panel',
               'account-title', 'account-body', 'mail-panel', 'mail-title', 'mail-body',
               'app', 'tool', 'no-access', 'who', 'logout',
               'btn-codes', 'btn-bundles', 'btn-sweep'];
  const seat = {
    participantId: 'p-1', sessionDate: '2026-10-05', name: 'Noa Levi',
    accountId: 'a-1', accountEmail: 'desk@example.com', groupId: null, status: 'booked',
    waitingSince: null, startsAt: Date.parse('2020-10-05T16:00:00Z'), history: [],
    payment: { owedCents: 700, paidCents: 0, currency: 'EUR', status: 'owed', creditedCents: 0 }
  };
  const posted = [];
  function boot(balanceCents) {
    const dom = D.makeDom({ ids: IDS, lang: 'en' });
    const ACT = { activityId: 'act-1', slug: 'drop', title: { en: 'Drop in' }, type: 'dropin' };
    const answers = {
      auth: () => ({ ok: true, data: { name: 'Michal', roleName: 'Super Admin',
                                       canApprove: true, canCancel: true } }),
      activities: () => ({ ok: true, data: { activities: [
        { slug: 'drop', title: { en: 'Drop in' }, status: 'open' }] } }),
      queue: () => ({ ok: true, data: { activity: ACT,
        capacity: { capacity: null, taken: 1, left: null, over: false, perSession: true,
                    unassigned: 0, named: [] }, registrations: [], waiting: [] } }),
      register: () => ({ ok: true, data: { activity: ACT,
        dates: [{ sessionDate: '2026-10-05', taken: 1, capacity: 10, left: 9, full: false }],
        sessionDate: '2026-10-05',
        capacity: { sessionDate: '2026-10-05', taken: 1, capacity: 10, left: 9, over: false },
        registered: 1, register: [seat], waiting: [] } }),
      mail: () => ({ ok: true, data: { ok: true, mail: {}, perRecipient: 12,
                                       addressesRead: 0, addressesTotal: 0, capped: false } }),
      ledger: () => ({ ok: true, data: { accountId: 'a-1', email: 'desk@example.com',
                                         balanceCents: balanceCents, entries: [] } }),
      applyCredit: (b) => ({ ok: true, data: { ok: true, balanceCents: balanceCents - b.amountCents,
        session: Object.assign({}, seat, { payment: Object.assign({}, seat.payment,
          { paidCents: b.amountCents, status: b.amountCents >= 700 ? 'paid' : 'owed' }) }) } })
    };
    dom.window.AdminSession = { requireSession: () => true, logout: () => {},
      post: (url, body) => {
        posted.push(body);
        const fn = answers[body.action];
        if (!fn) throw new Error('no canned answer for "' + body.action + '"');
        return Promise.resolve(fn(body));
      } };
    dom.window.AdminUrl = { remember: () => {}, read: () => null };
    dom.window.AdminHelp = { badge: () => dom.node('span'), wire: () => {} };
    const ctx = vm.createContext({
      window: dom.window, document: dom.document, console: console,
      Date: Date, Math: Math, JSON: JSON, Object: Object, Array: Array,
      String: String, Number: Number, RegExp: RegExp, Promise: Promise, setTimeout: setTimeout,
      encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent
    });
    vm.runInContext(src, ctx, { filename: 'js/registrations-admin.js' });
    return dom;
  }
  const settle = () => new Promise((r) => setTimeout(r, 40));

  const dom = boot(1500);
  await settle();
  const money = D.byTag(dom.byId('queue'), 'button')
    .filter((b) => b.getAttribute('aria-label') === 'Payments and credit')[0];
  money._handlers.click.forEach((f) => f({}));
  await settle();

  const box = dom.byId('account-body');
  const labels = D.byClass(box, 'field-label').map((n) => n.textContent);
  H.ok(labels.indexOf('Spend credit on this evening') !== -1,
    'the form is drawn, and it names the evening: ' + labels.join(' | '));

  const form = D.byTag(box, 'button')
    .filter((b) => b.textContent === 'Spend credit on this evening')[0];
  const inputs = D.byTag(form.parentNode, 'input');
  inputs[0].value = '5.00';
  inputs[1].value = 'rang and asked';
  form._handlers.click.forEach((f) => f({}));
  await settle();

  const sent = posted.filter((b) => b.action === 'applyCredit').pop();
  H.ok(sent, 'it posts applyCredit');
  H.eq(sent.sessionDate, '2026-10-05', '⚠ WITH the evening, which is the whole of the change');
  H.eq(sent.amountCents, 500, 'in cents — 5.00 typed, 500 on the wire');
  H.eq(sent.activityId, 'act-1', 'and the activity from the screen, since a booking carries none');
  H.eq(sent.note, 'rang and asked', 'with the note');
  H.ok(/paid €5\.00/.test(dom.byId('account-body').textContent),
    'and the panel reopens on the figures that were just written');

  // ⚠ NOT OFFERED WITH NOTHING TO SPEND. A form that can only lose is worse than
  // no form — the rule the register panel already follows for a family who is
  // already registered.
  const broke = boot(0);
  await settle();
  const m2 = D.byTag(broke.byId('queue'), 'button')
    .filter((b) => b.getAttribute('aria-label') === 'Payments and credit')[0];
  m2._handlers.click.forEach((f) => f({}));
  await settle();
  const b2 = broke.byId('account-body');
  const btn2 = D.byTag(b2, 'button')
    .filter((b) => b.textContent === 'Spend credit on this evening')[0];
  H.ok(btn2 && btn2.disabled,
    '⚠ an account holding nothing gets the form greyed rather than a button that refuses');

  H.done();
})();
