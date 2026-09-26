// What this defends against:
//
// `recordSessionPayment` — cash at the desk for one evening — has existed on the
// server since Phase 7 and had NO CONTROL ANYWHERE. It was the last line left in
// UNREACHED, which is this project's standing list of capabilities that sit in
// the repository, pass their tests, and cannot be reached by anybody using the
// product. Asked for as: "recording a cash payment for one evening — server
// already built, add the admin control."
//
// An action with no door has also, usually, never been RUN. This suite executes
// it, and four things have to hold:
//
//   1. ⚠ IT ADDS, NEVER SETS. Two part payments are two calls and both are in the
//      history; a second €3 that replaced the first would lose money silently.
//   2. ⚠ IT SETTLES ONLY WHEN THE TOTAL COVERS WHAT IS OWED. A part payment
//      reading as `paid` is a debt nobody chases — the rule recordPayment
//      already follows on a term.
//   3. ⚠ THE EVENING AND THE TERM ARE DIFFERENT POTS. A drop-in registration
//      owes nothing; the money lives on the evenings. A payment that touched the
//      registration would settle a bill nobody has.
//   4. The control is on the register row, but the FORM is in the one money
//      panel — "every money control lives in one panel, not on the row" is a
//      rule this screen already learned, and an amount box repeated down twenty
//      rows is also the two-line row the glyphs were introduced to fix.
//
// And one thing found while wiring it: moneyCell() is shared between the queue
// and the register, and printed "fee already paid " — trailing space, no year —
// under every €7 evening, because a BOOKING carries no fee answer at all. The
// yearly fee is charged on the registration and has never had anything to do
// with an evening.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_helpers');
const D = require('./_dom');
const F = require('./_fixtures');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const src = read('js/registrations-admin.js');

(async () => {
  // ---------------------------------------------------------------- server --
  console.log('[the action runs, and it adds rather than sets]');

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
              '_registration', '_account-store'] });
  const api = mods['admin-registrations'];
  const att = mods['_session-attendance'];
  const regStore = mods['_registration-store'];
  const REG = mods['_registration'];
  const accts = mods['_account-store'];

  await H.installSession(blobs, H.superAdminSession());
  const account = await accts.createAccount({ email: 'desk@example.com',
    password: 'longenough1', termsAccepted: true });

  const DATE = (activity.groups[0].facts.duration.sessionDates[0] || {}).date;
  H.ok(DATE, 'the fixture drop-in has an evening to book: ' + DATE);

  const booking = att.newAttendance({
    activity: activity, participantId: 'p-1', accountId: account.accountId,
    groupId: activity.groups[0].groupId, sessionDate: DATE,
    resolveSessionInstant: () => Date.parse(DATE + 'T16:00:00Z')
  });
  await att.saveAttendance(booking);
  const OWED = booking.payment.owedCents;
  H.ok(OWED > 0, 'and it owes something: ' + OWED);

  // A registration behind it, which is what every booking has — and which must
  // not move when the evening is paid for.
  const reg = REG.newRegistration({
    activity: activity, accountId: account.accountId, groupId: activity.groups[0].groupId,
    participant: { participantId: 'p-1', firstName: 'Noa', lastName: 'Levi',
                   dateOfBirth: '2016-01-01' }
  });
  await regStore.saveRegistration(reg);
  const regOwedBefore = reg.payment.owedCents;

  const pay = (cents, over) => H.call(api.handler, Object.assign({
    action: 'recordSessionPayment', token: 'test-token',
    participantId: 'p-1', activityId: AID, sessionDate: DATE, amountCents: cents
  }, over || {}));

  let res = await pay(Math.floor(OWED / 2));
  H.eq(res.status, 200, 'a part payment is taken');
  H.eq(res.body.session.payment.paidCents, Math.floor(OWED / 2), 'and recorded');
  H.eq(res.body.session.payment.status, 'owed',
    '⚠ and it is STILL OWED — a part payment reading as settled is a debt nobody chases');

  res = await pay(OWED - Math.floor(OWED / 2));
  H.eq(res.body.session.payment.paidCents, OWED,
    '⚠ the second call ADDS to the first rather than replacing it');
  H.eq(res.body.session.payment.status, 'paid', 'and now it settles');
  H.eq(res.body.session.history.filter((h) => /paid/.test(h.note || '')).length, 2,
    'both payments are in the history, which is the point of adding rather than setting');

  const after = await regStore.getRegistration('p-1', AID);
  H.eq(after.payment.owedCents, regOwedBefore,
    '⚠ and the REGISTRATION has not moved — the evening and the term are different pots');
  H.eq(after.payment.paidCents, reg.payment.paidCents, 'nothing was paid against the term');

  H.eq((await pay(0)).status, 400, 'nought is not a payment');
  H.eq((await pay(-500)).status, 400, 'and nor is a negative one');
  H.eq((await pay(100, { sessionDate: '2099-01-01' })).status, 404,
    'an evening with no booking on it is a 404, not a new record');

  // ⚠ THE CANCEL AXIS, NOT APPROVE. It moves money, which is the whole reason
  // that axis exists — an admin who may work the queue is not thereby an admin
  // who may write a figure into a family's record.
  const noMoney = H.superAdminSession({ token: 'queue-only' });
  noMoney.permissions.registrations = { access: true, approve: true, cancel: false };
  await H.installSession(blobs, noMoney);
  H.eq((await pay(100, { token: 'queue-only' })).status, 403,
    '⚠ a role that may approve but not cancel is refused: this moves money');
  await H.installSession(blobs, H.superAdminSession());

  // ---------------------------------------------------------------- client --
  console.log('\n[the control is on the row and the form is in the panel]');

  const IDS = ['messages', 'picker', 'queue-panel', 'queue-title', 'capacity', 'dates', 'queue',
               'bundles-panel', 'bundles', 'codes-panel', 'codes', 'account-panel',
               'account-title', 'account-body', 'mail-panel', 'mail-title', 'mail-body',
               'app', 'tool', 'no-access', 'who', 'logout',
               'btn-codes', 'btn-bundles', 'btn-sweep'];

  const seat = (over) => Object.assign({
    participantId: 'p-1', sessionDate: '2026-10-05', name: 'Noa Levi',
    accountId: 'a-1', accountEmail: 'desk@example.com', groupId: null,
    status: 'booked', waitingSince: null, startsAt: Date.parse('2020-10-05T16:00:00Z'),
    history: [],
    payment: { owedCents: 700, paidCents: 0, currency: 'EUR', status: 'owed', creditedCents: 0 }
  }, over || {});

  const REGISTER = [
    seat(),
    seat({ participantId: 'p-2', name: 'Dana Katz', status: 'no-show' }),
    seat({ participantId: 'p-3', name: 'Yuval Cohen', status: 'cancelled',
           payment: { owedCents: 0, paidCents: 700, currency: 'EUR', status: 'paid',
                      creditedCents: 0 } })
  ];
  const WAITING = [seat({ participantId: 'p-4', name: 'Roni Adler', status: 'waiting',
    waitingSince: '2026-09-20T08:00:00Z',
    payment: { owedCents: 0, paidCents: 0, currency: 'EUR', status: 'owed', creditedCents: 0 } })];

  const posted = [];
  function boot(over) {
    over = over || {};
    const dom = D.makeDom({ ids: IDS, lang: 'en' });
    const ACT = { activityId: 'act-1', slug: 'drop', title: { en: 'Drop in' }, type: 'dropin' };
    const answers = {
      auth: () => ({ ok: true, data: { name: 'Michal', roleName: 'Super Admin',
                                       canApprove: true, canCancel: over.canCancel !== false } }),
      activities: () => ({ ok: true, data: { activities: [
        { slug: 'drop', title: { en: 'Drop in' }, status: 'open' }] } }),
      queue: () => ({ ok: true, data: { activity: ACT,
        capacity: { capacity: null, taken: 3, left: null, over: false, perSession: true,
                    unassigned: 0, named: [] },
        registrations: [], waiting: [] } }),
      register: () => ({ ok: true, data: { activity: ACT,
        dates: [{ sessionDate: '2026-10-05', taken: 3, capacity: 10, left: 7, full: false }],
        sessionDate: '2026-10-05',
        capacity: { sessionDate: '2026-10-05', taken: 3, capacity: 10, left: 7, over: false },
        registered: 3, register: REGISTER, waiting: WAITING } }),
      mail: () => ({ ok: true, data: { ok: true, mail: {}, perRecipient: 12,
                                       addressesRead: 0, addressesTotal: 0, capped: false } }),
      ledger: () => ({ ok: true, data: { accountId: 'a-1', email: 'desk@example.com',
                                         balanceCents: 1500, entries: [] } }),
      recordSessionPayment: (b) => ({ ok: true, data: { ok: true, session: Object.assign({},
        seat(), { payment: { owedCents: 700, paidCents: b.amountCents, currency: 'EUR',
                             status: b.amountCents >= 700 ? 'paid' : 'owed', creditedCents: 0 } }) } })
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
  const tableHeaded = (dom, first) => D.byTag(dom.byId('queue'), 'table')
    .filter((x) => (D.byTag(x, 'th')[0] || {}).textContent === first)[0];
  function rowFor(dom, name) {
    return D.byTag(tableHeaded(dom, 'Participant'), 'tr')
      .filter((tr) => tr.textContent.indexOf(name) !== -1)[0];
  }
  const buttons = (node) => D.byTag(node, 'button')
    .map((b) => ({ label: b.getAttribute('aria-label') || b.textContent, off: !!b.disabled, el: b }));

  const dom = boot();
  await settle();

  H.ok(rowFor(dom, 'Noa Levi'), 'the evening register drew');
  H.ok(buttons(rowFor(dom, 'Noa Levi')).some((b) => b.label === 'Payments and credit'),
    'a booked row can be paid for');
  H.ok(buttons(rowFor(dom, 'Dana Katz')).some((b) => b.label === 'Payments and credit'),
    '⚠ and so can a NO-SHOW — it frees the place and still owes for it');
  H.ok(buttons(rowFor(dom, 'Yuval Cohen')).some((b) => b.label === 'Payments and credit'),
    '⚠ and a CANCELLED booking — an evening paid in cash has to be recordable before it ' +
    'can be credited back');
  const waitRow = D.byTag(tableHeaded(dom, 'Waiting'), 'tr')
    .filter((tr) => tr.textContent.indexOf('Roni Adler') !== -1)[0];
  H.eq(buttons(waitRow).filter((b) => b.label === 'Payments and credit').length, 0,
    '⚠ and NOT a waiting row — it holds no booking and owes nothing by definition');

  // ⚠ THE FEE LINE IS THE TERM'S. A booking carries no fee answer, and the cell
  // printed "fee already paid " under every evening because undefined is falsy.
  H.ok(rowFor(dom, 'Noa Levi').textContent.indexOf('fee already paid') === -1,
    '⚠ no evening claims anything about the yearly fee: ' +
    rowFor(dom, 'Noa Levi').textContent.replace(/\s+/g, ' '));
  H.ok(rowFor(dom, 'Noa Levi').textContent.indexOf('inc. yearly fee') === -1,
    'in either direction');

  // ------------------------------------------------------------------ pay --
  const press = (node, label) => buttons(node).filter((b) => b.label === label)[0]
    .el._handlers.click.forEach((f) => f({}));
  press(rowFor(dom, 'Noa Levi'), 'Payments and credit');
  await settle();

  H.ok(!dom.byId('account-panel').hidden, 'pressing it opens the money panel');
  H.eq(dom.byId('account-title').textContent, 'Money · desk@example.com · 5 Oct',
    '⚠ headed with the EVENING, so the panel cannot be mistaken for the term\'s');
  const body = dom.byId('account-body');
  H.ok(/for this evening/.test(body.textContent),
    'and the line above the form names which debt it is about');

  const forms = D.byClass(body, 'field-label').map((n) => n.textContent);
  H.ok(forms.indexOf('Record a payment for this evening') !== -1,
    'the form says what it records: ' + forms.join(' | '));
  H.ok(forms.indexOf('Spend credit on this registration') === -1,
    '⚠ and the TERM\'s credit form is not drawn here — applyCredit looks up a ' +
    'registration and would pay down the term while the evening stayed owed');
  H.ok(/Not built/.test(body.textContent),
    '⚠ said out loud rather than left as a missing control, with the route that does exist');

  // Euros in the box, cents on the wire.
  const inputs = D.byTag(body, 'input');
  inputs[0].value = '7.00';
  inputs[1].value = 'cash at the desk';
  const btn = D.byTag(body, 'button').filter((b) => b.textContent === 'Record a payment for this evening')[0];
  H.ok(btn, 'with a button naming the same thing');
  btn._handlers.click.forEach((f) => f({}));
  await settle();

  const sentPay = posted.filter((b) => b.action === 'recordSessionPayment').pop();
  H.ok(sentPay, 'it posts recordSessionPayment');
  H.eq(sentPay.amountCents, 700, '⚠ in CENTS — 7.00 typed, 700 on the wire');
  H.eq(sentPay.sessionDate, '2026-10-05', 'against the evening it was opened from');
  H.eq(sentPay.activityId, 'act-1',
    '⚠ and the activity comes from the screen — an evening row carries no activityId');
  H.eq(sentPay.note, 'cash at the desk', 'with the note the admin typed');

  // ⚠ THE PANEL REOPENS ON THE FIGURES THAT WERE JUST WRITTEN. The row in hand
  // is stale the moment the payment lands, and the line above the form is the
  // one number somebody at a desk reads back to a family.
  H.ok(/paid €7\.00/.test(dom.byId('account-body').textContent),
    '⚠ and it reopens showing the payment that was just made: ' +
    dom.byId('account-body').textContent.replace(/\s+/g, ' ').slice(0, 90));

  // --------------------------------------------------------- the term's own --
  const posted2 = posted.length;
  const q = boot();
  await settle();
  H.ok(posted.slice(posted2).some((b) => b.action === 'register'),
    'and the course queue is untouched by any of this');

  // A role that may not move money gets the control greyed rather than hidden,
  // because the row still has to say the capability exists.
  const readOnly = boot({ canCancel: false });
  await settle();
  const off = buttons(rowFor(readOnly, 'Noa Levi'))
    .filter((b) => b.label === 'Payments and credit')[0];
  H.ok(off && off.off, 'a role without the cancel axis sees it disabled, not absent');

  H.done();
})();
