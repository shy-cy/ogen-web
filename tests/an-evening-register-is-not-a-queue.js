// What this defends against:
//
// Asked for as "the drop-in dashboard should follow the course dashboard —
// separate the waiting list and add filters", looking at an evening register
// that showed a WAITING row between two booked ones, with Present and No-show
// offered against it and an OWED pill beside €0.00 / €0.00.
//
// Three faults, and only the first was asked about:
//
// ⚠ 1. THE QUEUE WAS IN THE REGISTER. Nothing in a register row applies to
// somebody waiting: they hold no seat, owe nothing, have no attendance to mark,
// and are not in the room the count above the table is about. The course roster
// decided this once already — "nothing in a queue row applies to somebody
// waiting… so it is its own table under the queue" — and the evening register
// was written afterwards without it.
//
// ⚠ 2. Present AND No-show WERE OFFERED ON A WAITING ROW. markCell() listed the
// one status that is not markable (`cancelled`), so `waiting` inherited
// "markable" by saying nothing — and marking somebody present for a seat they do
// not hold would put them in a room capacityForDate() does not count them in.
// The rule is a list of what DOES hold a seat now, so the next status added is
// refused until somebody decides otherwise.
//
// ⚠ 3. SEAT HAD NO WORD FOR `waiting`, so the pill fell through to `|| r.status`
// and printed the raw status. Identical to the family area, where the same gap
// reached a Hebrew page as the English word "waiting" — and the tell that this
// table had never been designed for a row holding no seat.
//
// And one that is not about the evening at all: moneyCell() read
// `payment.status`, which is stamped 'owed' when a record is written and stays
// there on a row that owes nothing — the documented cause of "€0.00 / €0.00
// OWED" on the live roster. The FILTERS beside it already derived the bucket for
// exactly this reason, so one table could file a row under "nothing to pay" and
// label it OWED. Fixed in the one place both tables read.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_helpers');
const D = require('./_dom');

const R = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(R, 'js/registrations-admin.js'), 'utf8');
const api = fs.readFileSync(path.join(R, 'netlify/functions/admin-registrations.js'), 'utf8');

const IDS = ['messages', 'picker', 'queue-panel', 'queue-title', 'capacity', 'dates', 'queue',
             'bundles-panel', 'bundles', 'codes-panel', 'codes', 'account-panel', 'account-title',
             'account-body', 'app', 'tool', 'no-access', 'who', 'logout',
             'btn-codes', 'btn-bundles', 'btn-sweep'];

const seat = (over) => Object.assign({
  participantId: 'p-1', sessionDate: '2026-10-05', name: 'Adf Asfsdf',
  accountId: 'a-1', accountEmail: 'michal+test1@ogen.cy', groupId: null,
  status: 'booked', waitingSince: null, startsAt: null, history: [],
  payment: { owedCents: 700, paidCents: 700, currency: 'EUR', status: 'owed', creditedCents: 0 }
}, over || {});

// The reported evening, exactly: one paid booking, one waiting row.
const REGISTER = [
  seat(),
  seat({ participantId: 'p-3', name: 'Yuval Cohen', accountEmail: 'yuval@ex.com',
         status: 'attended',
         payment: { owedCents: 700, paidCents: 0, currency: 'EUR', status: 'owed', creditedCents: 0 } })
];
const WAITING = [
  seat({ participantId: 'p-2', name: 'Test4 Testuus', accountEmail: 'michal.shin+test4@gmail.com',
         status: 'waiting', waitingSince: '2026-09-20T08:00:00.000Z',
         // ⚠ owedCents 0 and status 'owed' — the stamped-and-stale pairing.
         payment: { owedCents: 0, paidCents: 0, currency: 'EUR', status: 'owed', creditedCents: 0 } })
];

const QUEUE = {
  activity: { activityId: 'act-1', slug: 'test10', title: { en: 'Test 10' },
              type: 'dropin', status: 'open' },
  capacity: { capacity: null, taken: 2, left: null, over: false, perSession: true,
              unassigned: 0, named: [] },
  registrations: [], waiting: []
};
const REG_ANSWER = {
  activity: QUEUE.activity,
  dates: [{ date: '2026-10-05', taken: 1, capacity: 1, left: 0, full: true },
          { date: '2026-10-12', taken: 0, capacity: 1, left: 1, full: false }],
  sessionDate: '2026-10-05',
  capacity: { date: '2026-10-05', taken: 1, capacity: 1, left: 0, full: true, over: false },
  registered: 2,
  register: REGISTER,
  waiting: WAITING
};

function boot(answerOver) {
  const dom = D.makeDom({ ids: IDS, lang: 'en' });
  const answers = Object.assign({
    auth: () => ({ ok: true, data: { name: 'Michal', roleName: 'Super Admin',
                                     canApprove: true, canCancel: true } }),
    activities: () => ({ ok: true, data: { activities: [
      { slug: 'test10', title: { en: 'Test 10' }, status: 'open' }] } }),
    queue: () => ({ ok: true, data: QUEUE }),
    register: () => ({ ok: true, data: REG_ANSWER })
  }, answerOver || {});
  dom.window.AdminSession = {
    requireSession: () => true, logout: () => {},
    post: (url, body) => {
      const fn = answers[body.action];
      if (!fn) throw new Error('no canned answer for admin action "' + body.action + '"');
      return Promise.resolve(fn(body));
    }
  };
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

// The tables, read off the screen rather than off state. Two tables read
// separately on purpose: a helper that swept both would count a queue as a
// booking, which is the pairing this whole screen keeps getting wrong.
function tableHeaded(dom, first) {
  const t = D.byTag(dom.byId('queue'), 'table')
    .filter((x) => (D.byTag(x, 'th')[0] || {}).textContent === first)[0];
  if (!t) return [];
  return D.byClass(t, 'who').map((c) => (c.children[0] || { textContent: '' }).textContent)
    .filter(Boolean);
}
// ⚠ BY HEADING, NEVER BY POSITION. A register with no matching rows draws a
// sentence rather than a table, so the queue slides from index 1 to index 0 —
// and a positional helper then reads the queue's names as the register's and
// agrees with itself, which is the failure this whole screen keeps having.
const booked = (dom) => tableHeaded(dom, 'Participant');
const waitingNames = (dom) => tableHeaded(dom, 'Waiting');
const control = (dom, label) => D.byTag(dom.byId('queue'), 'select')
  .filter((s) => s.getAttribute('aria-label') === label)[0];
const countLine = (dom) => (D.byClass(dom.byId('queue'), 'filter-count')[0] || {}).textContent;
const screenText = (dom) => dom.byId('queue').textContent;
function choose(sel, value) {
  sel.value = value;
  (sel._handlers.change || []).forEach((f) => f({ currentTarget: sel, target: sel }));
}

(async () => {
  const dom = boot();
  await settle();

  console.log('[the queue is its own table, under the register]');
  H.eq(booked(dom).join(', '), 'Adf Asfsdf, Yuval Cohen',
    'the register holds the two who have a seat');
  H.eq(waitingNames(dom).join(', '), 'Test4 Testuus',
    '⚠ and the waiting row is in a table of its own, not between them');
  H.eq(D.byTag(dom.byId('queue'), 'table').length, 2, 'two tables, not one');
  H.ok(screenText(dom).indexOf('1 waiting for this evening') !== -1,
    'headed with its own count: ' + screenText(dom).slice(0, 0));

  console.log('\n[⚠ and nobody is marked present for a seat they do not hold]');
  // The waiting table has two columns and no controls at all. Read as the
  // absence of a button rather than as a disabled one: there is no admin action
  // for handing out a seat on one evening, so a control here would be a door to
  // nowhere — which is the mistake this admin has made three times.
  const tableOf = (first) => D.byTag(dom.byId('queue'), 'table')
    .filter((x) => (D.byTag(x, 'th')[0] || {}).textContent === first)[0];
  const waitTable = tableOf('Waiting');
  H.eq(D.byTag(waitTable, 'button').length, 0,
    'no button on a waiting row — Present would put them in a room nothing counts them in');
  H.eq(D.byTag(waitTable, 'th').map((h) => h.textContent).join(','), 'Waiting,Since',
    'and the columns are the two that mean anything: who, and since when');

  // The register's own rows still have theirs.
  const regTable = tableOf('Participant');
  H.ok(D.byTag(regTable, 'button').length >= 4, 'the seats keep Present and No-show');

  console.log('\n[⚠ the payment pill is derived, so €0.00 / €0.00 is not OWED]');
  // The stale stamped field. `payment.status` is 'owed' on every row in this
  // fixture, including the one that has paid in full and the one that owes
  // nothing at all.
  H.ok(REGISTER[0].payment.status === 'owed' && REGISTER[0].payment.paidCents === 700,
    'the fixture carries the stale field, or this assertion proves nothing');
  const pills = D.byClass(regTable, 'pill').map((p) => p.textContent);
  H.ok(pills.indexOf('paid') !== -1, 'a settled row reads paid: ' + pills.join(','));
  H.ok(pills.indexOf('owed') !== -1, 'and an unpaid one still reads owed');
  H.eq(D.byClass(waitTable, 'pill').length, 0,
    'while the waiting row carries no payment pill at all');

  console.log('\n[⚠ and `waiting` has a word]');
  // The pill fell through to `|| r.status` and printed the raw status. Asserted
  // against the SEAT table rather than the screen, because the waiting rows have
  // left the register and the gap would otherwise be invisible again.
  const statuses = (src.match(/var SEAT = \{[\s\S]*?\};/) || [''])[0];
  ['booked', 'attended', 'no-show', 'cancelled', 'waiting'].forEach((k) => {
    H.ok(statuses.indexOf(k) !== -1, 'SEAT names ' + k);
  });

  console.log('\n[the rows narrow, and the room does not]');
  H.ok(D.byClass(dom.byId('queue'), 'filters').length === 1, 'one filter bar');
  H.eq(countLine(dom), '3 bookings', 'which says how many of how many');

  const byStatus = control(dom, 'Any status');
  H.ok(byStatus, 'there is a status select');
  H.ok(byStatus.textContent.indexOf('Attended (1)') !== -1,
    'built from the rows in hand, with counts: ' + byStatus.textContent);
  H.ok(byStatus.textContent.indexOf('Waiting (1)') !== -1,
    'and the queue is one of the options, because filtering to it is how you ask for it');

  choose(byStatus, 'attended');
  H.eq(booked(dom).join(', '), 'Yuval Cohen', 'narrowing the status narrows the register');
  H.eq(waitingNames(dom).length, 0, 'and stands the queue down');
  H.eq(countLine(dom), '1 of 3 shown', 'and the bar says so');

  // ⚠ THE CAPACITY LINE IS THE ROOM AND MUST NOT FOLLOW A FILTER. A filtered
  // figure there would be a true number answering a different question — which
  // is the exact pairing this screen was reported for the first time.
  H.ok(screenText(dom).indexOf('1 of 1 places') !== -1,
    'the room still counts everybody: ' + D.byClass(dom.byId('queue'), 'capacity-line')[0].textContent);

  choose(byStatus, 'waiting');
  H.eq(booked(dom).length, 0, 'asking for the queue empties the register');
  H.eq(waitingNames(dom).join(', '), 'Test4 Testuus', 'and leaves the queue');

  // ⚠ NEVER "nobody has booked this evening yet" WHILE A FILTER IS ON. It is
  // true of an empty evening and a lie about a narrowed one.
  H.ok(screenText(dom).indexOf('Nobody has booked this evening yet') === -1,
    '⚠ and a narrowed evening never claims nobody has booked');
  H.ok(screenText(dom).indexOf('No bookings match these filters') !== -1,
    'it says what is actually true');

  console.log('\n[the payment filter is derived, and the queue has no answer to it]');
  choose(byStatus, '');
  const byPay = control(dom, 'Any payment');
  H.ok(byPay, 'there is a payment select');
  H.ok(byPay.textContent.indexOf('Settled (1)') !== -1,
    'derived from the figures, not from the stamped field: ' + byPay.textContent);
  choose(byPay, 'owes');
  H.eq(booked(dom).join(', '), 'Yuval Cohen', 'owing narrows to the one who owes');
  H.eq(waitingNames(dom).length, 0,
    '⚠ and stands the queue down rather than guessing — they hold nothing and owe nothing');
  H.ok(screenText(dom).indexOf('None of them match these filters') !== -1,
    'saying so, rather than hiding the table and implying nobody is waiting');

  console.log('\n[an empty evening still says it is empty]');
  {
    const empty = boot({ register: () => ({ ok: true, data:
      Object.assign({}, REG_ANSWER, { register: [], waiting: [] }) }) });
    await settle();
    H.ok(screenText(empty).indexOf('Nobody has booked this evening yet') !== -1,
      'with no filter and no rows, the plain sentence is the right one');
    H.eq(D.byClass(empty.byId('queue'), 'filters').length, 0, 'and no bar to narrow nothing with');
  }

  console.log('\n[the server splits it, because the course roster does]');
  H.ok(/register: rows\.filter\(\(r\) => r\.status !== 'waiting'\)/.test(api),
    'the register excludes the queue');
  H.ok(/waiting: rows\.filter\(\(r\) => r\.status === 'waiting'\)/.test(api),
    'and the queue is its own list');
  H.ok(/waitingSince \|\| ''\)\.localeCompare/.test(api),
    'in join order, which is the only order a queue has');
  H.ok(/waitingSince: att\.waitingSince \|\| null/.test(api),
    'carrying when they joined');

  console.log('\n[the rule is what HOLDS a seat, not what does not]');
  // Asked the other way round now: a status added later is refused until
  // somebody decides otherwise, rather than inheriting "markable" by silence.
  H.ok(/var MARKABLE = \['booked', 'attended', 'no-show'\]/.test(src),
    'a list of what is markable');
  H.ok(/MARKABLE\.indexOf\(r\.status\) === -1/.test(src), 'and the guard reads it');
  H.ok(!/r\.status === 'cancelled'\) return el\('span', \{ class: 'why'/.test(src),
    'rather than naming the one status that is not');

  // One derived bucket, read by the cell and by the filter, so a table cannot
  // file a row under "nothing to pay" and label it OWED.
  H.ok(/var bucket = payBucket\(r\);/.test(src), 'the money cell derives its pill');
  H.ok(!/pill ' \+ p\.status/.test(src), 'and the stored field is no longer painted');

  // ⚠ The filters reset with the ACTIVITY and survive a DATE, and the difference
  // is what the values mean: `booked` and `owes` are true of every evening,
  // where a group id belongs to one activity.
  H.ok(/S\.filter = newFilter\(\); S\.eveFilter = newEveFilter\(\);/.test(src),
    'both filters are forgotten when the activity changes');
  H.ok(!/S\.eveFilter = newEveFilter\(\)[\s\S]{0,200}loadRegister/.test(src),
    'and the evening filter is not reset by a date change');

  H.done();
})();
