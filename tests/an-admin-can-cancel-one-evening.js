// What this defends against:
//
// A family has been able to cancel one evening from their own page since Phase
// 7. An ADMIN could not. What an admin had was `cancel`, which ends the whole
// REGISTRATION — and on a drop-in that releases every evening ahead of it — so a
// family who rang and asked for one Tuesday to come off was answered either by
// being told to go and press it themselves, or by the term being ended and
// rebuilt at today's price. Same shape as `markAttendance` before the register
// screen existed and `recordSessionPayment` before the money panel did: the
// mechanism written, tested, and reachable from one side only.
//
// Building it found that the per-evening arithmetic had ALREADY been written
// twice — the family's own `cancelSession` and the release loop inside
// _registration-cancel.js — while that same file opens by insisting a term's
// version is one function because two copies can round differently. A third copy
// in the admin handler is what forced the extraction.
//
// Seven things have to hold:
//
//   1. ⚠ ONE CANCELLER. No handler works out an evening's credit and writes its
//      own ledger line; the cancellation REASONS appear only in the writer and in
//      the ledger's own closed list.
//   2. ⚠ THE LEDGER LINE SAYS WHICH EVENING. "credited €12.00" against a term
//      somebody has five bookings on answers nothing six weeks later.
//   3. ⚠ THE REGISTRATION AND THE OTHER EVENINGS DO NOT MOVE. The evening is the
//      unit; cancelling one is not cancelling a term.
//   4. ⚠ PAST THE DEADLINE IT STILL CANCELS AND CREDITS NOTHING. That is the
//      split between entitlement and the ability to act that this project fixed
//      once already on the guardian's own button.
//   5. ⚠ THE FIGURE ON THE SCREEN IS THE FIGURE THAT IS WRITTEN. The deadline is
//      HOURS before a start time, so a register left open through an afternoon
//      crosses one — and `expectCreditCents` is REQUIRED, not checked-when-
//      offered, because optional-in-syntax is the trap five callers of
//      creditFor() fell into.
//   6. ⚠ `booked` AND NOTHING ELSE. A second pass over a cancelled evening would
//      credit twice into a ledger that cannot be edited; a waiting row holds no
//      seat and owes nothing.
//   7. ⚠ THE FAMILY IS TOLD, and the seat is announced to that evening's queue.
//      A silent version leaves somebody turning up on Tuesday — the group-move
//      gap exactly.
//
// And one bug found by the extraction: releaseFutureSessions() frees every
// evening ahead of a cancelled drop-in registration and told NONE of their
// queues, while the family's own single-evening cancellation always had. Both
// go through the one function now, so the announcement cannot be in one and not
// the other.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_helpers');
const D = require('./_dom');
const F = require('./_fixtures');

process.env.RESEND_FROM = 'Merkaz Ogen <noreply@ogen.cy>';

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const src = read('js/registrations-admin.js');
// Comments mention these words on purpose; a grep over raw text reads the prose
// as code. The same lesson `.activity-card-image img` taught in the stylesheet.
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

(async () => {
  // ------------------------------------------------------- one canceller ----
  console.log('[the per-evening credit is written in exactly one place]');

  const fnDir = path.join(R, 'netlify/functions');
  const REASONS = ['registration-cancelled-by-guardian', 'registration-cancelled-by-admin'];
  const namesAReason = fs.readdirSync(fnDir).filter((f) => /\.js$/.test(f))
    .filter((f) => REASONS.some((r) => strip(read('netlify/functions/' + f)).indexOf(r) !== -1));
  H.eq(namesAReason.sort().join(','), '_credit-ledger.js,_registration-cancel.js',
    '⚠ only the writer names a cancellation reason, and the ledger lists it: ' +
    namesAReason.join(','));

  const cancelSrc = strip(read('netlify/functions/_registration-cancel.js'));
  H.eq((cancelSrc.match(/async function cancelOneSession\(/g) || []).length, 1,
    'cancelOneSession is defined once');
  ['account-registrations.js', 'admin-registrations.js'].forEach((f) => {
    H.ok(strip(read('netlify/functions/' + f)).indexOf('cancelOneSession(') !== -1,
      f + ' goes through it rather than writing its own');
    H.ok(strip(read('netlify/functions/' + f)).indexOf('creditForSession(att') === -1 ||
      f === 'admin-registrations.js',
      f + ' does not work out an evening’s credit for itself');
  });

  // ------------------------------------------------------------- server -----
  console.log('\n[an admin cancels one evening, in time]');

  const blobs = H.makeBlobs();
  const activity = F.dropin();
  const AID = activity.activityId;
  const DATES = activity.groups[0].facts.duration.sessionDates.map((d) => d.date);
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

  const sent = [];
  require(H.fnPath('_email'))._internal.setTransport({
    emails: { send: async (a) => { sent.push(a); return { data: { id: 'id-' + sent.length } }; } }
  });

  await H.installSession(blobs, H.superAdminSession());
  const account = await accts.createAccount({ email: 'dana@example.com',
    password: 'longenough1', termsAccepted: true,
    profile: { firstName: 'Dana', preferredLanguage: 'ru' } });

  const HOUR = 3600 * 1000;
  // The frozen start is what the deadline is measured from, and the fixture's
  // window is 24 hours. Ten days ahead is in time; one hour ahead is not.
  const book = async (pid, date, at, paid) => {
    const b = att.newAttendance({
      activity: activity, participantId: pid, accountId: account.accountId,
      groupId: activity.groups[0].groupId, sessionDate: date,
      resolveSessionInstant: () => at
    });
    b.payment.paidCents = paid;
    b.payment.status = paid >= b.payment.owedCents ? 'paid' : 'owed';
    await att.saveAttendance(b);
    return b;
  };
  const reg = REG.newRegistration({
    activity: activity, accountId: account.accountId, groupId: activity.groups[0].groupId,
    participant: { participantId: 'p-1', firstName: 'Noa', lastName: 'Levi',
                   dateOfBirth: '2016-01-01' }
  });
  await regStore.saveRegistration(reg);

  const inTime = await book('p-1', DATES[0], Date.now() + 240 * HOUR, 1200);
  const late = await book('p-1', DATES[1], Date.now() + 1 * HOUR, 1200);
  H.eq(inTime.payment.owedCents, 1200, 'an evening of this activity costs €12.00');

  const cancel = (over) => H.call(api.handler, Object.assign({
    action: 'cancelSession', token: 'test-token',
    participantId: 'p-1', activityId: AID, sessionDate: DATES[0], expectCreditCents: 1200
  }, over || {}));

  let res = await cancel();
  H.eq(res.status, 200, 'the evening is cancelled');
  H.eq(res.body.session.status, 'cancelled', 'and the record says so');
  H.eq(res.body.credit.credit, 1200, 'the whole €12.00 comes back, in time');
  H.eq(res.body.entry.amountCents, 1200, 'and that is what the ledger entry recorded');
  H.eq(res.body.entry.type, 'credit', 'as a credit');
  H.eq(res.body.entry.reason, 'registration-cancelled-by-admin',
    '⚠ named as the ADMIN’s cancellation, not the guardian’s');
  H.eq(res.body.entry.basis.sessionDate, DATES[0],
    '⚠ and the entry says WHICH EVENING — a term with five bookings needs it to');
  H.eq(res.body.entry.basis.perSession, true, 'marked as a per-evening line');
  H.eq(res.body.session.payment.creditedCents, 1200, 'the booking records what was credited');
  H.eq(res.body.session.payment.status, 'credited', 'and its status moves');
  H.eq(await ledger.balanceFor(account.accountId), 1200,
    'the account’s balance is the entry, summed rather than cached');

  const regAfter = await regStore.getRegistration('p-1', AID);
  H.eq(regAfter.status, reg.status,
    '⚠ THE REGISTRATION HAS NOT MOVED — one evening is not a term');
  H.eq(regAfter.payment.creditedCents, reg.payment.creditedCents, 'and nothing was credited on it');
  const otherAfter = await att.getAttendance('p-1', AID, DATES[1]);
  H.eq(otherAfter.status, 'booked', '⚠ and the family’s OTHER evening is untouched');

  H.ok(res.body.session.history.some((h) => (h.note || '').indexOf('admin') !== -1),
    'the history says an admin did it: ' +
    res.body.session.history.map((h) => h.note).filter(Boolean).join(' | '));
  H.eq(res.body.session.history[res.body.session.history.length - 1].by, 'michal@ogen.cy',
    'and names which admin');

  console.log('\n[the family is told, in their own language]');
  H.eq(res.body.emailed, true, 'the message went');
  const msg = sent[sent.length - 1];
  H.ok(/отменено/.test(msg.subject),
    '⚠ in the language of the ACCOUNT rather than of the admin’s screen: ' + msg.subject);
  H.ok(msg.html.indexOf('12,00') !== -1 || msg.html.indexOf('12.00') !== -1,
    'and it names the credit: ' + (msg.html.match(/[^ >]*12[.,]00[^ <]*/) || [''])[0]);
  H.ok(/Noa/.test(msg.text), 'and who it is about');
  const log = require(H.fnPath('_email-log'));
  H.eq(log.templateLabel('session-cancelled'), 'Session cancelled',
    '⚠ the template has a label, or the mail panel shows an admin a raw key');
  H.eq(log.isResendable('session-cancelled'), false,
    'and is not resendable: a second copy reads as a second evening cancelled');

  console.log('\n[past the deadline it still cancels, and credits nothing]');
  res = await cancel({ sessionDate: DATES[1], expectCreditCents: 0 });
  H.eq(res.status, 200, '⚠ an admin is never REFUSED by the deadline');
  H.eq(res.body.session.status, 'cancelled', 'the seat is given back');
  H.eq(res.body.credit.credit, 0, 'and nothing is credited');
  H.eq(res.body.credit.reason, 'too-late', 'for a reason the screen can print');
  H.eq(res.body.entry, null, '⚠ with NO ledger line at all — a zero entry explains nothing');
  H.eq(await ledger.balanceFor(account.accountId), 1200, 'so the balance is unchanged');

  console.log('\n[the figure on the screen is the figure that is written]');
  const third = await book('p-1', DATES[2], Date.now() + 240 * HOUR, 1200);
  H.ok(third, 'a third evening, in time');
  res = await cancel({ sessionDate: DATES[2], expectCreditCents: undefined });
  H.eq(res.status, 400,
    '⚠ omitting the expected credit is REFUSED rather than trusted — optional in ' +
    'syntax is how five callers of creditFor() came to lie');
  H.eq((await att.getAttendance('p-1', AID, DATES[2])).status, 'booked', 'and nothing was written');

  res = await cancel({ sessionDate: DATES[2], expectCreditCents: 700 });
  H.eq(res.status, 409, '⚠ a figure that has moved since the register loaded is refused');
  H.eq(res.body.reason, 'credit-moved', 'with a reason the client can branch on');
  H.eq(res.body.creditCents, 1200, 'and the figure it should have been');
  H.eq((await att.getAttendance('p-1', AID, DATES[2])).status, 'booked',
    '⚠ and NOTHING WAS CANCELLED — the check is before the write, like the optimistic lock');
  H.eq(await ledger.balanceFor(account.accountId), 1200, 'and no credit was written');

  console.log('\n[booked and nothing else]');
  res = await cancel({ sessionDate: DATES[0], expectCreditCents: 0 });
  H.eq(res.status, 409,
    '⚠ an already cancelled evening is refused — a second pass would credit twice');
  H.eq(await ledger.balanceFor(account.accountId), 1200, 'and it did not');

  const waiting = att.newAttendance({
    activity: activity, participantId: 'p-9', accountId: account.accountId,
    groupId: activity.groups[0].groupId, sessionDate: DATES[2],
    resolveSessionInstant: () => Date.now() + 240 * HOUR, waiting: true
  });
  await att.saveAttendance(waiting);
  H.eq(waiting.status, 'waiting', 'a family waiting for that evening');
  res = await cancel({ participantId: 'p-9', sessionDate: DATES[2], expectCreditCents: 0 });
  H.eq(res.status, 409, '⚠ a WAITING row is refused: it holds no seat and owes nothing');
  // ⚠ NOT just "does it mention waiting" — the generic refusal is "This booking
  // is waiting." and contains the word too, so that test could not tell the
  // dedicated sentence from the fallback. It has to name what is actually true
  // of a queue: no seat is held, so there is nothing to give back.
  H.ok(/nothing to cancel/.test(res.body.error) && /holding a seat/.test(res.body.error),
    'and the refusal says a queue holds no seat rather than reporting a status: ' +
    res.body.error);

  const marked = await att.getAttendance('p-1', AID, DATES[2]);
  await att.saveAttendance(att.transition(marked, { status: 'attended', by: 'x' }));
  res = await cancel({ sessionDate: DATES[2], expectCreditCents: 1200 });
  H.eq(res.status, 409, 'and an ATTENDED evening is refused: it happened');

  H.eq((await cancel({ sessionDate: '2099-01-01', expectCreditCents: 0 })).status, 404,
    'an evening with no booking on it is a 404, not a new record');

  // ⚠ THE CANCEL AXIS. It writes a credit a family can spend and cannot be
  // undone, which is the whole reason that axis exists apart from approve.
  const noMoney = H.superAdminSession({ token: 'queue-only' });
  noMoney.permissions.registrations = { access: true, approve: true, cancel: false };
  await H.installSession(blobs, noMoney);
  H.eq((await cancel({ token: 'queue-only' })).status, 403,
    '⚠ a role that may approve but not cancel is refused');
  await H.installSession(blobs, H.superAdminSession());

  console.log('\n[the seat is announced to that evening’s queue]');
  // The waiting family needs a registration behind them, which is what
  // seatOpened() builds the message from.
  const reg9 = REG.newRegistration({
    activity: activity, accountId: account.accountId, groupId: activity.groups[0].groupId,
    participant: { participantId: 'p-9', firstName: 'Roni', lastName: 'Adler',
                   dateOfBirth: '2015-01-01' }
  });
  await regStore.saveRegistration(reg9);
  const seat = await book('p-2', DATES[2], Date.now() + 240 * HOUR, 0);
  H.ok(seat, 'somebody else holds a seat on the evening p-9 is waiting for');
  const before = sent.length;
  res = await cancel({ participantId: 'p-2', sessionDate: DATES[2], expectCreditCents: 0 });
  H.eq(res.status, 200, 'that seat is given back');
  H.ok(sent.slice(before).some((m) => /Освободилось|place has opened|התפנה/.test(m.subject)),
    '⚠ and the family waiting for THAT evening is told a seat has opened: ' +
    sent.slice(before).map((m) => m.subject).join(' | '));

  console.log('\n[and ending the whole registration announces every evening it frees]');
  // ⚠ THE BUG THE EXTRACTION FOUND. releaseFutureSessions() cancels every
  // evening ahead of a drop-in registration and told NONE of their queues, while
  // the family's own single-evening cancellation always had. Two copies of one
  // piece of work, and the announcement was in one of them.
  const reg7 = REG.newRegistration({
    activity: activity, accountId: account.accountId, groupId: activity.groups[0].groupId,
    participant: { participantId: 'p-7', firstName: 'Omer', lastName: 'Ziv',
                   dateOfBirth: '2014-01-01' }
  });
  await regStore.saveRegistration(reg7);
  const reg8 = REG.newRegistration({
    activity: activity, accountId: account.accountId, groupId: activity.groups[0].groupId,
    participant: { participantId: 'p-8', firstName: 'Lior', lastName: 'Gal',
                   dateOfBirth: '2014-02-02' }
  });
  await regStore.saveRegistration(reg8);
  await book('p-7', DATES[1], Date.now() + 240 * HOUR, 0);
  const wait8 = att.newAttendance({
    activity: activity, participantId: 'p-8', accountId: account.accountId,
    groupId: activity.groups[0].groupId, sessionDate: DATES[1],
    resolveSessionInstant: () => Date.now() + 240 * HOUR, waiting: true
  });
  await att.saveAttendance(wait8);

  const beforeTerm = sent.length;
  res = await H.call(api.handler, { action: 'cancel', token: 'test-token',
    participantId: 'p-7', activityId: AID });
  H.eq(res.status, 200, 'the whole registration is cancelled');
  H.eq((await att.getAttendance('p-7', AID, DATES[1])).status, 'cancelled',
    'and the evening ahead of it is released');
  H.ok(sent.slice(beforeTerm).some((m) => /Освободилось|place has opened|התפנה/.test(m.subject)),
    '⚠ and the family queueing for that evening IS told now: ' +
    sent.slice(beforeTerm).map((m) => m.subject).join(' | '));

  console.log('\n[the register row carries what cancelling would credit]');
  const fresh = await book('p-3', DATES[0], Date.now() + 240 * HOUR, 1200);
  H.ok(fresh, 'a booked evening to read back');
  res = await H.call(api.handler, { action: 'register', token: 'test-token',
    slug: 'drop', sessionDate: DATES[0] });
  H.eq(res.status, 200, 'the register opens');
  const row = res.body.register.filter((r) => r.participantId === 'p-3')[0];
  H.eq(row.cancelCredit, 1200,
    '⚠ the row says what cancelling would credit, from the same function the ' +
    'cancellation will use — so what is offered is what happens');
  H.eq(row.cancelReason, 'in-time', 'and why it is that figure');
  const dead = res.body.register.filter((r) => r.status !== 'booked')[0];
  H.ok(dead, 'there is a row that is not a live booking');
  H.eq(dead.cancelCredit, null,
    'and a row with no seat to give back carries no figure rather than a nought');

  // ------------------------------------------------------------- client -----
  console.log('\n[the control, and the dialog that names the money]');

  const IDS = ['messages', 'picker', 'queue-panel', 'queue-title', 'capacity', 'dates', 'queue',
               'bundles-panel', 'bundles', 'codes-panel', 'codes', 'account-panel',
               'account-title', 'account-body', 'mail-panel', 'mail-title', 'mail-body',
               'app', 'tool', 'no-access', 'who', 'logout',
               'btn-codes', 'btn-bundles', 'btn-sweep'];

  const seatRow = (over) => Object.assign({
    participantId: 'p-1', sessionDate: '2026-10-05', name: 'Noa Levi',
    accountId: 'a-1', accountEmail: 'dana@example.com', groupId: null,
    status: 'booked', waitingSince: null, startsAt: Date.now() + 240 * HOUR, history: [],
    cancelCredit: 1200, cancelReason: 'in-time',
    payment: { owedCents: 1200, paidCents: 1200, currency: 'EUR', status: 'paid', creditedCents: 0 }
  }, over || {});

  const REGISTER = [
    seatRow(),
    // Paid, and past its window: the deadline is the reason, and it is the
    // sentence that has to appear.
    seatRow({ participantId: 'p-2', name: 'Dana Katz', cancelCredit: 0,
              cancelReason: 'too-late' }),
    // ⚠ Past its window AND never paid. "Nothing paid" has to win, or the dialog
    // implies money was lost when none ever moved.
    seatRow({ participantId: 'p-5', name: 'Amit Bar', cancelCredit: 0,
              cancelReason: 'too-late',
              payment: { owedCents: 1200, paidCents: 0, currency: 'EUR', status: 'owed',
                         creditedCents: 0 } }),
    seatRow({ participantId: 'p-3', name: 'Yuval Cohen', status: 'cancelled',
              cancelCredit: null, cancelReason: null }),
    seatRow({ participantId: 'p-6', name: 'Tal Shani', status: 'attended',
              cancelCredit: null, cancelReason: null })
  ];
  const WAITING = [seatRow({ participantId: 'p-4', name: 'Roni Adler', status: 'waiting',
    waitingSince: '2026-09-20T08:00:00Z', cancelCredit: null, cancelReason: null,
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
        capacity: { capacity: null, taken: 5, left: null, over: false, perSession: true,
                    unassigned: 0, named: [] },
        registrations: [], waiting: [] } }),
      register: () => ({ ok: true, data: { activity: ACT,
        dates: [{ sessionDate: '2026-10-05', taken: 5, capacity: 10, left: 5, full: false }],
        sessionDate: '2026-10-05',
        capacity: { sessionDate: '2026-10-05', taken: 5, capacity: 10, left: 5, over: false },
        registered: 5, register: REGISTER, waiting: WAITING } }),
      mail: () => ({ ok: true, data: { ok: true, mail: {}, perRecipient: 12,
                                       addressesRead: 0, addressesTotal: 0, capped: false } }),
      cancelSession: (b) => { posted.push(b); return { ok: true, data: { ok: true,
        session: Object.assign({}, seatRow(), { status: 'cancelled' }),
        credit: { credit: 1200 }, entry: { amountCents: 1200 },
        emailed: over.emailed === undefined ? true : over.emailed } }; }
    };
    dom.window.AdminSession = { requireSession: () => true, logout: () => {},
      post: (url, body) => {
        const fn = answers[body.action];
        if (!fn) throw new Error('no canned answer for admin action "' + body.action + '"');
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
  const rowFor = (dom, name) => D.byTag(tableHeaded(dom, 'Participant'), 'tr')
    .filter((tr) => tr.textContent.indexOf(name) !== -1)[0];
  const buttons = (node) => D.byTag(node, 'button')
    .map((b) => ({ label: b.getAttribute('aria-label') || b.textContent, off: !!b.disabled, el: b }));
  const find = (node, label) => buttons(node).filter((b) => b.label === label)[0];
  const press = (b) => b.el._handlers.click.forEach((f) => f({}));

  let dom = boot();
  await settle();

  const LABEL = 'Cancel this evening';
  H.ok(rowFor(dom, 'Noa Levi'), 'the evening register drew');
  const live = find(rowFor(dom, 'Noa Levi'), LABEL);
  H.ok(live, '⚠ a booked row can be cancelled — which is the whole gap this closes');
  H.eq(live.off, false, 'and the control is live');
  H.eq(find(rowFor(dom, 'Yuval Cohen'), LABEL).off, true,
    '⚠ a cancelled row is DISABLED rather than absent — the columns line up down the table');
  H.eq(find(rowFor(dom, 'Tal Shani'), LABEL).off, true,
    'and so is an attended one: it happened');
  const waitRow = D.byTag(tableHeaded(dom, 'Waiting'), 'tr')
    .filter((tr) => tr.textContent.indexOf('Roni Adler') !== -1)[0];
  H.eq(buttons(waitRow).filter((b) => b.label === LABEL).length, 0,
    '⚠ and the waiting table offers nothing that gives a seat back');

  const noCancel = boot({ canCancel: false });
  await settle();
  H.eq(find(rowFor(noCancel, 'Noa Levi'), LABEL).off, true,
    'a role without the cancel axis sees it greyed — cosmetically, the server re-decides');

  // ------------------------------------------------------------- dialog ----
  press(find(rowFor(dom, 'Noa Levi'), LABEL));
  await settle();
  const panel = () => D.byClass(dom.document.body, 'modal')[0];
  H.ok(panel(), 'the confirmation opened');
  let text = panel().textContent;
  H.ok(text.indexOf('Credits €12.00') !== -1,
    '⚠ and it names what the ledger will record: ' + text.replace(/\s+/g, ' ').slice(0, 90));
  H.ok(/emailed/.test(text), 'and says the family is emailed');
  H.ok(/One family is waiting/.test(text),
    '⚠ and that the family waiting for this evening will be told a seat has opened');
  H.ok(/other bookings are untouched/.test(text),
    'and that this ends one evening rather than the registration');

  const acts = D.byClass(panel(), 'modal-acts')[0];
  const labels = D.byTag(acts, 'button').map((b) => b.textContent);
  H.eq(labels.join(' | '), 'Keep the booking | Cancel this evening',
    '⚠ NEITHER BUTTON IS A BARE "Cancel" — on this one panel the action is also ' +
    'called cancelling, so the word would appear twice meaning opposite things');

  press({ el: D.byTag(acts, 'button')[1] });
  await settle();
  H.eq(posted.length, 1, 'it sent one request');
  H.eq(posted[0].action, 'cancelSession', 'to the action that exists');
  H.eq(posted[0].sessionDate, '2026-10-05', 'naming the evening');
  H.eq(posted[0].expectCreditCents, 1200,
    '⚠ and carrying the figure the panel showed, so the server can refuse a ' +
    'figure that moved while the register sat open');
  H.eq(dom.byId('messages').textContent.indexOf('credited €12.00') !== -1, true,
    'and the confirmation says what was credited: ' + dom.byId('messages').textContent);

  console.log('\n[a zero says why it is a zero]');
  dom = boot();
  await settle();
  press(find(rowFor(dom, 'Dana Katz'), LABEL));
  await settle();
  text = D.byClass(dom.document.body, 'modal')[0].textContent;
  H.ok(text.indexOf('Credits') === -1,
    '⚠ no "Credits €0.00" — a nought reads as a decision taken against the family');
  H.ok(/past the cancellation deadline/.test(text),
    'it says the deadline has passed: ' + text.replace(/\s+/g, ' ').slice(0, 120));

  // ⚠ AND THE FIGURE IT SENDS IS THIS ROW'S. Reading it back off the booked row
  // alone could not tell "takes the row's figure" from "sends a constant that
  // happens to match" — so it is pressed on a row whose credit is a DIFFERENT
  // number, which is the only version of this check that can fail.
  const wasPosted = posted.length;
  press({ el: D.byTag(D.byClass(dom.document.body, 'modal')[0], 'button')[1] });
  await settle();
  H.eq(posted.length, wasPosted + 1, 'the zero-credit evening is cancellable too');
  H.eq(posted[posted.length - 1].expectCreditCents, 0,
    '⚠ and it sends THIS row\u2019s figure — nought, not the €12.00 of the row above');
  H.eq(posted[posted.length - 1].participantId, 'p-2', 'against the right family');

  dom = boot();
  await settle();
  press(find(rowFor(dom, 'Amit Bar'), LABEL));
  await settle();
  text = D.byClass(dom.document.body, 'modal')[0].textContent;
  H.ok(/Nothing was paid/.test(text),
    '⚠ AND "NOTHING PAID" WINS OVER THE DEADLINE, even though this row is also ' +
    'too late: "you were late" implies money was lost when none ever moved');
  H.ok(!/past the cancellation deadline/.test(text),
    'so the deadline sentence is not also shown');

  console.log('\n[a failed send is said loudly]');
  dom = boot({ emailed: false });
  await settle();
  press(find(rowFor(dom, 'Noa Levi'), LABEL));
  await settle();
  press({ el: D.byTag(D.byClass(dom.document.body, 'modal')[0], 'button')[1] });
  await settle();
  H.ok(/did NOT go/.test(dom.byId('messages').textContent),
    '⚠ an admin left believing a family was told will not follow it up another way: ' +
    dom.byId('messages').textContent);

  H.done();
})();
