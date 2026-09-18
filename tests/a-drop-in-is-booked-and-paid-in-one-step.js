// What this defends against:
//
// A DROP-IN WAS BEING RUN THROUGH A TERM'S MACHINERY, and every symptom of that
// was reported from the outside as a separate complaint.
//
// A term is one decision — this child, this activity, for months — taken once,
// with a price agreed up front and an admin deciding who gets a place. A drop-in
// is "we will come on Tuesday". The family area was making the second walk the
// first: register for the activity, wait, come back, book dates one at a time,
// then hunt for a way to pay for each of them. Two of those steps did not even
// exist yet — a drop-in registration owes nothing, because owedCentsFor() bills
// the yearly fee and, for a COURSE, the term price, so "a payment link is on its
// way" was a promise about a debt of zero — and the panel could not say which
// session was being registered to, because the honest answer was "none of them".
//
// It is one screen now: who, which dates, pay. The registration still exists
// underneath — it carries the guardian link, the frozen terms and an admin's
// ability to say no — and a family never has to know that.
//
// This suite EXECUTES the panel rather than reading it, in the DOM shim, because
// every bug it is guarding is one that reads perfectly as source: a total that
// does not add up, a date offered that is already booked, a button that posts
// the wrong action. And it pins the two orderings the server side rests on:
// nothing is written until everything that can refuse has refused, and the
// bookings are written BEFORE the charge is made.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_helpers');
const D = require('./_dom');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const memberSession = read('js/member-session.js');
const memberAccount = read('js/member-account.js');

const ACCOUNT = {
  accountId: 'a-1', email: 'michal@example.com',
  // ⚠ DELIBERATELY UNVERIFIED. This is the account that could not pay, and the
  // whole flow this suite describes is the one it refused: sign up, register,
  // pay, in one sitting.
  emailVerifiedAt: null,
  profile: { firstName: 'Michal', preferredLanguage: 'en' }
};
const PARTICIPANTS = [
  { participantId: 'p-1', firstName: 'Michal', lastName: 'Shinitzky', isSelf: true, isPrimary: true },
  { participantId: 'p-2', firstName: 'Noa', lastName: 'Levi', isSelf: false, isPrimary: true }
];

const DROPIN = { activityId: 'act-2', slug: 'folk', type: 'dropin', perSession: true,
  title: { en: 'Folk dancing' }, capacity: null, taken: null, left: null,
  groups: null, full: false };
const COURSE = { activityId: 'act-1', slug: 'hebrew', type: 'course', perSession: false,
  title: { en: 'Hebrew for kids' }, left: 4, capacity: 14, taken: 10, groups: null, full: false };

// One of each thing the picker has to tell apart: gone, already taken, full, and
// two that can be chosen.
const SESSIONS = [
  { date: '2026-01-06', past: true,  status: null, full: false, left: 5, priceCents: 1200 },
  { date: '2026-10-06', past: false, status: 'attended', full: false, left: 5, priceCents: 1200 },
  { date: '2026-10-13', past: false, status: 'booked',   full: false, left: 5, priceCents: 1200 },
  { date: '2026-10-20', past: false, status: null, full: true,  left: 0, priceCents: 1200 },
  { date: '2026-10-27', past: false, status: null, full: false, left: 5, priceCents: 1200 },
  { date: '2026-11-03', past: false, status: null, full: false, left: 3, priceCents: 1500 }
];

const sent = [];
const ANSWERS = {
  me: () => ({ ok: true, account: ACCOUNT, expiresAt: Date.now() + 1e7 }),
  listParticipants: () => ({ ok: true, participants: PARTICIPANTS }),
  list: () => ({ ok: true, registrations: [] }),
  balance: () => ({ ok: true, balanceCents: 0, entries: [] }),
  activity: (b) => ({ ok: true, activity: b.slug === 'folk' ? DROPIN : COURSE }),
  sessions: () => ({ ok: true, mayBook: true, registrationStatus: 'approved', sessions: SESSIONS }),
  bookAndPay: () => ({ ok: true, url: 'https://checkout.stripe.com/c/pay/xyz', booked: [] }),
  submit: () => ({ ok: true, registration: {} })
};

function fetchFor(overrides) {
  const answers = Object.assign({}, ANSWERS, overrides || {});
  return function (endpoint, init) {
    const body = JSON.parse(init.body);
    sent.push(body);
    const fn = answers[body.action];
    if (!fn) return Promise.reject(new Error('no canned answer for "' + body.action + '"'));
    const out = fn(body);
    return Promise.resolve({ status: out._status || 200, ok: out._status ? out._status < 400 : true,
                             json: () => Promise.resolve(out) });
  };
}

async function screen(opts) {
  const dom = D.makeDom(Object.assign({ fetch: fetchFor(opts.api) }, opts));
  dom.window.localStorage.setItem('ogenMemberSession', JSON.stringify({
    token: 't', firstName: 'Michal', email: ACCOUNT.email, expiresAt: Date.now() + 1e7 }));
  const ctx = vm.createContext({
    window: dom.window, document: dom.document, console: console,
    // The script redirects to Stripe with a bare `location.href`, which is a
    // global in a browser and is not one here — without it the one line that
    // completes a payment throws, and the test would never reach it.
    location: dom.window.location,
    Intl: Intl, Date: Date, Math: Math, JSON: JSON, Object: Object, Array: Array,
    String: String, Number: Number, RegExp: RegExp, Promise: Promise, setTimeout: setTimeout,
    encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent
  });
  vm.runInContext(memberSession, ctx, { filename: 'js/member-session.js' });
  vm.runInContext(memberAccount, ctx, { filename: 'js/member-account.js' });
  await settle();
  return dom;
}
const settle = () => new Promise((r) => setTimeout(r, 40));
const has = (dom, s) => dom.mount.textContent.indexOf(s) !== -1;

(async () => {
  console.log('[the panel asks the whole question at once]');
  sent.length = 0;
  let dom = await screen({ view: 'account', lang: 'en', search: '?register=folk' });
  H.ok(has(dom, 'Folk dancing'), 'it names the activity');
  H.ok(has(dom, 'Choose who is coming and which sessions'),
    'and says what registering here actually does');
  H.eq(D.byTag(dom.mount, 'select').length, 1, 'one person picker');
  H.ok(!has(dom, 'places left') && !has(dom, 'no limit'),
    'and NO term-level places-left line — the number that means anything on a ' +
    'drop-in is per date, and a count of places on the activity is a number about nothing');

  console.log('\n[the dates are the choice, and each says where it stands]');
  const rows = D.byClass(dom.mount, 'acc-date');
  H.eq(rows.length, 5, 'one row per date, and the date that has gone is not among them');
  H.ok(dom.mount.textContent.indexOf('2026-01-06') === -1 && !has(dom, '6 January'),
    'a past date is never offered');
  const boxes = D.byTag(dom.mount, 'input');
  const off = boxes.filter((b) => b.getAttribute('disabled') != null);
  H.eq(off.length, 3, 'three cannot be taken: attended, already booked, and full');
  H.ok(has(dom, 'already booked'), 'and one says so');
  H.ok(has(dom, 'full'), 'and one says it is full');
  H.ok(has(dom, '€12.00'), 'the rest carry their price');
  // The price comes from the same function that freezes it at booking, with the
  // same bookedAt — so a screen quoting the standard price cannot be followed by
  // a charge at the late one.
  H.ok(has(dom, '€15.00'), 'including a date priced differently from the others');

  console.log('\n[the next available date is ticked, and the button carries the total]');
  const live = boxes.filter((b) => b.getAttribute('disabled') == null);
  H.eq(live.length, 2, 'two dates can be chosen');
  H.ok(live[0].checked === true, 'the first of them starts ticked — a family arriving ' +
    'from a Register button usually means the next session, and a dead button reads as a dead screen');
  H.ok(live[1].checked === false, 'and only that one');
  const btn = D.byTag(dom.mount, 'button').filter((b) => /Register and pay/.test(b.textContent))[0];
  H.ok(btn, 'the button says what pressing it does');
  H.eq(btn.textContent, 'Register and pay · €12.00', 'with the total on it');
  H.ok(btn.getAttribute('disabled') == null, 'and it is live');

  console.log('\n[ticking a second date re-totals it]');
  live[1].click();
  H.eq(btn.textContent, 'Register and pay · €27.00', '12.00 + 15.00');
  live[0].click();
  H.eq(btn.textContent, 'Register and pay · €15.00', 'and unticking takes it back off');
  live[1].click();
  H.eq(btn.getAttribute('disabled'), 'true', 'nothing chosen disables the button rather than ' +
    'offering a payment of nothing');

  console.log('\n[submitting books and pays in ONE call, then leaves for Stripe]');
  live[0].click();
  live[1].click();
  sent.length = 0;
  D.byTag(dom.mount, 'form')[0].submit();
  await settle();
  const call = sent.filter((b) => b.action === 'bookAndPay')[0];
  H.ok(call, 'one action, not a registration followed by N bookings followed by a payment');
  H.eq(call.slug, 'folk', 'naming the activity');
  H.eq(call.participantId, 'p-1', 'and who is coming');
  H.eq((call.sessionDates || []).join(','), '2026-10-27,2026-11-03', 'and every date chosen');
  H.ok(!sent.some((b) => b.action === 'submit' || b.action === 'bookSession'),
    'and nothing goes through the term path');
  H.eq(dom.window.location.href, 'https://checkout.stripe.com/c/pay/xyz',
    'and the answer is a redirect to Checkout — the payment page, not an email about one');

  console.log('\n[the three answers that are not a redirect all say what happened]');
  const endings = [
    { api: { bookAndPay: () => ({ ok: true, url: null, awaitingApproval: true, booked: [] }) },
      says: 'We will confirm the place', why: 'an activity that does not auto-approve stops before money moves' },
    { api: { bookAndPay: () => ({ ok: true, url: null, nothingDue: true, booked: [] }) },
      says: 'nothing to pay', why: 'a free evening is not sent to a payment page for €0.00' },
    { api: { bookAndPay: () => ({ ok: true, url: null, paymentFailed: true, booked: [] }) },
      says: 'could not open the payment page', why: 'the dates are booked and the family is told to pay from their own page' }
  ];
  for (const e of endings) {
    const d = await screen({ view: 'account', lang: 'en', search: '?register=folk', api: e.api });
    D.byTag(d.mount, 'form')[0].submit();
    await settle();
    H.ok(d.mount.textContent.indexOf(e.says) !== -1, e.why);
    H.ok(d.window.location.href.indexOf('stripe') === -1, '  and it does not leave the page');
  }

  console.log('\n[a refusal that names dates reloads the list]');
  let asked = 0;
  const d2 = await screen({ view: 'account', lang: 'en', search: '?register=folk', api: {
    sessions: () => { asked++; return { ok: true, mayBook: true, sessions: SESSIONS }; },
    bookAndPay: () => ({ _status: 409, error: 'gone', reason: 'unavailable',
                         refused: [{ date: '2026-10-27', reason: 'full' }] })
  } });
  const before = asked;
  D.byTag(d2.mount, 'form')[0].submit();
  await settle();
  H.ok(asked > before, 'the dates are re-read — what changed is on the screen they are looking at');
  H.ok(d2.mount.textContent.indexOf('no longer available') !== -1, 'and the family is told why');

  console.log('\n[a course is untouched by any of this]');
  sent.length = 0;
  const d3 = await screen({ view: 'account', lang: 'en', search: '?register=hebrew' });
  H.eq(D.byClass(d3.mount, 'acc-date').length, 0, 'no date picker on a term');
  H.ok(has(d3, '4 places left'), 'and the places-left line is still there, where it means something');
  D.byTag(d3.mount, 'form')[0].submit();
  await settle();
  H.ok(sent.some((b) => b.action === 'submit'), 'it still posts submit');
  H.ok(!sent.some((b) => b.action === 'bookAndPay'), 'and never bookAndPay');

  console.log('\n[the same screen in Hebrew and Russian]');
  for (const [l, word] of [['he', 'הרשמה ותשלום'], ['ru', 'Записаться и оплатить']]) {
    const d = await screen({ view: 'account', lang: l, search: '?register=folk' });
    H.ok(d.mount.textContent.indexOf(word) !== -1, l + ': the button is in the reader\'s language');
    H.eq(D.byClass(d.mount, 'acc-date').length, 5, l + ': and the picker renders');
  }

  // ---- the server side ------------------------------------------------------
  console.log('\n[nothing is written until everything that can refuse has refused]');
  const src = read('netlify/functions/account-registrations.js');
  const branch = src.slice(src.indexOf("case 'bookAndPay'"), src.indexOf("case 'cancelSession'"));
  H.ok(branch.length > 800, 'found the branch');
  const at = (s) => branch.indexOf(s);
  H.ok(at('mustGuard') < at('attendance.validate'), 'the guardian link is checked first');
  H.ok(at('refused.push') < at('saveAttendance'),
    'EVERY chosen date is checked for room before ANY of them is written — a family ' +
    'choosing four and being given three plus a charge is worse than being asked to choose again');
  H.ok(at('saveAttendance') < at('createSessionsCheckout'),
    '⚠ AND THE BOOKINGS ARE WRITTEN BEFORE THE CHARGE. The other order takes money ' +
    'for a place that might not exist; this one holds an unpaid booking the family can see and settle');
  H.ok(/awaitingApproval: true/.test(branch) && at('awaitingApproval') < at('saveAttendance'),
    'and a registration that still needs a person stops before any of it');
  H.ok(!/json\(500|throw/.test(branch.slice(at('createSessionsCheckout'))),
    'a Stripe failure after the bookings is not reported as a failure — that would ' +
    'send a family to book again and hold two places');

  console.log('\n[one payment, one line per date, and a breakdown Stripe has to agree with]');
  const checkout = read('netlify/functions/_checkout.js');
  H.ok(/line_items: lines\.map/.test(checkout), 'the builder takes a list of lines');
  H.ok(/description: att\.sessionDate/.test(checkout),
    'each named by its date — ten identical charges on a statement is not a receipt');
  H.ok(/session_amounts: dues\.join/.test(checkout), 'and our breakdown travels with it');
  H.ok(/MAX_SESSION_LINES = \d+/.test(checkout), 'with a cap, because metadata values are finite');

  const hook = read('netlify/functions/stripe-webhook.js');
  H.ok(/sum !== total/.test(hook), 'the webhook compares the breakdown to Stripe\'s own total');
  H.ok(/nothing settled/.test(hook), 'and settles NOTHING when they disagree');

  console.log('\n[and it really does split one payment across the right blobs]');
  const blobs = H.makeBlobs();
  const mods = H.loadWithStubs({ blobs: blobs,
    modules: ['_session-attendance', 'stripe-webhook'] });
  const att = mods['_session-attendance'];
  const book = (date, owed) => att.saveAttendance({
    participantId: 'p-1', activityId: 'act-2', sessionDate: date, accountId: 'a-1',
    status: 'booked', frozen: { type: 'dropin', sessionDate: date },
    payment: { owedCents: owed, paidCents: 0, currency: 'EUR', status: 'owed' }, history: []
  });
  await book('2026-10-27', 1200);
  await book('2026-11-03', 1500);
  const session = {
    id: 'cs_1', amount_total: 2700,
    metadata: { organization: 'ogen', ogen_kind: 'session',
                participant_id: 'p-1', activity_id: 'act-2',
                session_dates: '2026-10-27,2026-11-03', session_amounts: '1200,1500' }
  };
  await mods['stripe-webhook'].settle(session);
  let a = await att.getAttendance('p-1', 'act-2', '2026-10-27');
  let b = await att.getAttendance('p-1', 'act-2', '2026-11-03');
  H.eq(a.payment.paidCents, 1200, 'each evening is settled for its OWN amount');
  H.eq(b.payment.paidCents, 1500, 'not for a share of the total');
  H.eq(a.payment.status + '/' + b.payment.status, 'paid/paid', 'and both read as paid');

  // Running it again must find nothing. Stripe retries, and a double credit here
  // is money a family did not pay showing as paid.
  await mods['stripe-webhook'].settle(session);
  a = await att.getAttendance('p-1', 'act-2', '2026-10-27');
  H.eq(a.payment.paidCents, 1200, 'a redelivered event settles nothing twice');

  console.log('\n[a breakdown that does not add up settles nothing at all]');
  await book('2026-11-10', 1000);
  await mods['stripe-webhook'].settle({
    id: 'cs_2', amount_total: 2700,
    metadata: { organization: 'ogen', ogen_kind: 'session',
                participant_id: 'p-1', activity_id: 'act-2',
                session_dates: '2026-11-10,2026-10-27', session_amounts: '1000,1000' }
  });
  const c = await att.getAttendance('p-1', 'act-2', '2026-11-10');
  H.eq(c.payment.paidCents, 0,
    'money is not split across blobs by a figure nobody checked — that lands it ' +
    'against the wrong debt, which is worse than money nobody can place');

  H.done();
})();
