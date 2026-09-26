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

// ⚠ CONFIRMED, AND IT USED TO BE DELIBERATELY UNCONFIRMED.
//
// This suite was built around a split that no longer exists: a course asked for
// a confirmed address and a drop-in did not, so the whole booking flow below ran
// on an account nobody had confirmed and that WAS the point. QA registered and
// paid for a drop-in that way and asked whether it was meant to be possible. It
// was not: the same request writes a minor's name and date of birth and then
// opens Checkout, and a class on Tuesday stores exactly the record a term does.
//
// So the flow runs confirmed, and UNCONFIRMED is its own section at the end —
// which is now the same answer for both shapes.
const ACCOUNT = {
  accountId: 'a-1', email: 'michal@example.com',
  emailVerifiedAt: '2026-01-01T00:00:00Z',
  profile: { firstName: 'Michal', preferredLanguage: 'en' }
};
const UNCONFIRMED = { me: () => ({ ok: true, expiresAt: Date.now() + 1e7,
  account: Object.assign({}, ACCOUNT, { emailVerifiedAt: null }) }) };
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
  { date: '2026-10-13', past: false, status: 'booked',   full: false, left: 5, priceCents: 0,
    owedCents: 0, paidCents: 0, priceBasis: 'bundle' },
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
  // ⚠ ONE CALL: the activity, the family list, and — on a drop-in — the evenings
  // for the participant the select opens on. Three round trips before this, on
  // the first signed-in screen an activity page sends anybody to.
  registerPanel: (b) => {
    const out = { ok: true, activity: b.slug === 'folk' ? DROPIN : COURSE,
                  participants: PARTICIPANTS };
    if (b.slug === 'folk') {
      out.sessionsFor = PARTICIPANTS[0].participantId;
      out.mayBook = true;
      out.registrationStatus = 'approved';
      out.sessions = SESSIONS;
    }
    return out;
  },
  sessions: () => ({ ok: true, mayBook: true, registrationStatus: 'approved', sessions: SESSIONS }),
  bundles: () => ({
    ok: true,
    held: [{
      bundleId: 'b3', purchasedAt: '2026-10-01T00:00:00Z', status: 'active',
      entries: 3, pricePerEntry: 10, totalCents: 3000,
      validUntil: Date.parse('2026-12-30T00:00:00Z'),
      remaining: 1, used: 2, shortfallCreditedCents: 0,
      rows: [
        { date: '2026-10-06', state: 'used', mayReschedule: false, reason: 'used', deadline: null },
        { date: '2026-10-13', state: 'booked', mayReschedule: true, reason: 'in-time',
          deadline: null, targets: ['2026-10-27', '2026-11-03'] },
        { date: '2026-10-20', state: 'available', mayReschedule: false, reason: 'available', deadline: null }
      ]
    }],
    offers: [{ bundleId: 'b5', entries: 5, pricePerEntry: 10, validityDays: 90,
               totalCents: 5000, coveredDates: [] }]
  }),
  rescheduleSession: () => ({ ok: true, session: {}, bundle: {} }),
  buyBundle: () => ({ ok: true, url: 'https://checkout.stripe.com/c/pay/bundle' }),
  bookAndPay: () => ({ ok: true, url: 'https://checkout.stripe.com/c/pay/xyz', booked: [] }),
  submit: () => ({ ok: true, registration: {} }),
  // The activity page, for the one assertion that needs a rendered cost card.
  registration: (b) => ({
    ok: true,
    registration: {
      participantId: 'p-1', participantName: 'Michal Shinitzky', activityId: b.activityId,
      slug: b.activityId === 'act-2' ? 'folk' : 'hebrew',
      title: { en: b.activityId === 'act-2' ? 'Folk dancing' : 'Hebrew for kids' },
      type: b.activityId === 'act-2' ? 'dropin' : 'course',
      status: 'approved', holdsASpot: true,
      owedCents: 35000, paidCents: 0, creditedCents: 0, feeCharged: true,
      cancellation: { guardianMayCancel: false }
    },
    activity: {
      activityId: b.activityId, slug: b.activityId === 'act-2' ? 'folk' : 'hebrew',
      type: b.activityId === 'act-2' ? 'dropin' : 'course',
      title: { en: 'Folk dancing' }, facts: [], priceRows: [], sessionRows: []
    }
  })
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
  let dom = await screen({ view: 'activity', lang: 'en', search: '?register=folk' });
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
  // ⚠ TWO, NOT THREE. A FULL EVENING IS CHOOSABLE, because choosing it is how
  // you join its queue — see a-full-evening-can-still-take-your-name.js. What is
  // genuinely not takeable is an evening this participant already holds.
  H.eq(off.length, 2, 'two cannot be taken: the one attended and the one already booked');
  H.ok(has(dom, 'already booked'), 'and one says so');
  H.ok(has(dom, 'full'), 'and the full one still says it is full');
  H.ok(has(dom, 'ticking this joins the waiting list'),
    'and says what ticking it would mean, before it is ticked');
  H.ok(has(dom, '€12.00'), 'the rest carry their price');
  // The price comes from the same function that freezes it at booking, with the
  // same bookedAt — so a screen quoting the standard price cannot be followed by
  // a charge at the late one.
  H.ok(has(dom, '€15.00'), 'including a date priced differently from the others');

  console.log('\n[the next available date is ticked, and the button carries the total]');
  const live = boxes.filter((b) => b.getAttribute('disabled') == null);
  H.eq(live.length, 3, 'three dates can be chosen — the full one among them');
  const box = (d) => live.filter((b) => b.getAttribute('value') === d)[0];
  H.eq(live.filter((b) => b.checked).length, 1, 'exactly one starts ticked');
  H.ok(box('2026-10-27').checked === true,
    '⚠ the next date WITH ROOM — a family arriving from a Register button usually ' +
    'means the next session, and a dead button reads as a dead screen. Never the ' +
    'full one: pre-ticking a queue join puts somebody in a queue they never asked about');
  H.ok(box('2026-10-20').checked === false, 'so the full date is offered and not chosen');
  const btn = D.byTag(dom.mount, 'button').filter((b) => /Register and pay/.test(b.textContent))[0];
  H.ok(btn, 'the button says what pressing it does');
  H.eq(btn.textContent, 'Register and pay · €12.00', 'with the total on it');
  H.ok(btn.getAttribute('disabled') == null, 'and it is live');

  console.log('\n[ticking a second date re-totals it]');
  box('2026-11-03').click();
  H.eq(btn.textContent, 'Register and pay · €27.00', '12.00 + 15.00');
  box('2026-10-27').click();
  H.eq(btn.textContent, 'Register and pay · €15.00', 'and unticking takes it back off');
  // ⚠ AND A FULL EVENING ADDS NOTHING TO THE TOTAL. It holds no seat, owes
  // nothing and freezes no price — late pricing means the only honest moment to
  // fix a price is when a place is actually taken.
  box('2026-10-20').click();
  H.eq(btn.textContent, 'Register and pay · €15.00', 'a queue join is not a purchase');
  box('2026-11-03').click();
  H.eq(btn.textContent, 'Join the waiting list',
    'and with nothing left to pay for, the button says the other thing it does');
  box('2026-10-20').click();
  H.eq(btn.getAttribute('disabled'), 'true', 'nothing chosen disables the button rather than ' +
    'offering a payment of nothing');

  console.log('\n[submitting books and pays in ONE call, then leaves for Stripe]');
  box('2026-10-27').click();
  box('2026-11-03').click();
  sent.length = 0;
  D.byTag(dom.mount, 'form')[0].submit();
  await settle();
  const call = sent.filter((b) => b.action === 'bookAndPay')[0];
  H.ok(call, 'one action, not a registration followed by N bookings followed by a payment');
  H.eq(call.slug, 'folk', 'naming the activity');
  H.eq(call.participantId, 'p-1', 'and who is coming');
  H.eq((call.sessionDates || []).join(','), '2026-10-27,2026-11-03', 'and every date chosen');
  H.eq((call.waitDates || []).length, 0, 'with nothing in the queue list, since none is full');
  H.ok(!sent.some((b) => b.action === 'submit' || b.action === 'bookSession'),
    'and nothing goes through the term path');
  H.eq(dom.window.location.href, 'https://checkout.stripe.com/c/pay/xyz',
    'and the answer is a redirect to Checkout — the payment page, not an email about one');

  console.log('\n[the three answers that are not a redirect all say what happened]');
  const endings = [
    { api: { bookAndPay: () => ({ ok: true, url: null, awaitingApproval: true, booked: [] }) },
      // ⚠ NO REASON IN IT, deliberately — see a-figure-that-does-not-explain-itself.js.
      // The family is told the state; why a person is looking is the admin queue's,
      // with the numbers on it.
      says: 'We are confirming a few details', why: 'an activity that does not auto-approve stops before money moves' },
    { api: { bookAndPay: () => ({ ok: true, url: null, nothingDue: true, booked: [] }) },
      says: 'nothing to pay', why: 'a free evening is not sent to a payment page for €0.00' },
    { api: { bookAndPay: () => ({ ok: true, url: null, paymentFailed: true, booked: [] }) },
      says: 'could not open the payment page', why: 'the dates are booked and the family is told to pay from their own page' }
  ];
  for (const e of endings) {
    const d = await screen({ view: 'activity', lang: 'en', search: '?register=folk', api: e.api });
    D.byTag(d.mount, 'form')[0].submit();
    await settle();
    H.ok(d.mount.textContent.indexOf(e.says) !== -1, e.why);
    H.ok(d.window.location.href.indexOf('stripe') === -1, '  and it does not leave the page');
  }

  console.log('\n[a refusal that names dates reloads the list]');
  let asked = 0;
  const d2 = await screen({ view: 'activity', lang: 'en', search: '?register=folk', api: {
    sessions: () => { asked++; return { ok: true, mayBook: true, sessions: SESSIONS }; },
    bookAndPay: () => ({ _status: 409, error: 'gone', reason: 'unavailable',
                         refused: [{ date: '2026-10-27', reason: 'full' }] })
  } });
  const before = asked;
  D.byTag(d2.mount, 'form')[0].submit();
  await settle();
  H.ok(asked > before, 'the dates are re-read — what changed is on the screen they are looking at');
  H.ok(d2.mount.textContent.indexOf('no longer available') !== -1, 'and the family is told why');

  // ⚠ AND AN UNCONFIRMED ADDRESS MEETS THE SAME WALL ON BOTH SHAPES.
  //
  // It used to meet it on the course only, and the drop-in panel above drew a
  // full date picker for an account nobody had confirmed. The register panel
  // asks the question ONCE, above the branch that chooses between the two
  // shapes, so a third shape added later inherits it rather than copying it.
  console.log('\n[neither shape is registered for from an address nobody has proved]');
  for (const [what, query] of [['a course', '?register=hebrew'], ['a drop-in', '?register=folk']]) {
    sent.length = 0;
    const unverified = await screen({ view: 'activity', lang: 'en', search: query,
      api: UNCONFIRMED });
    H.eq(D.byTag(unverified.mount, 'form').length, 0,
      what + ': no registration form at all — a filled-in form that always loses is worse than none');
    H.eq(D.byClass(unverified.mount, 'acc-date').length, 0,
      what + ': and no date picker either');
    H.ok(has(unverified, 'confirm your email address'), what + ': the reason is on screen');
    H.ok(has(unverified, 'Send again'),
      what + ': and the ONE control that clears it is under the sentence asking for it');
    unverified.mount.querySelector('.acc-notice').childNodes
      .filter((n) => n.tagName === 'BUTTON')[0].click();
    await settle();
    H.ok(sent.some((b) => b.action === 'resendVerification'), what + ': and it resends');
  }

  console.log('\n[a course is otherwise untouched by any of this]');
  sent.length = 0;
  const d3 = await screen({ view: 'activity', lang: 'en', search: '?register=hebrew' });
  H.eq(D.byClass(d3.mount, 'acc-date').length, 0, 'no date picker on a term');
  H.ok(has(d3, '4 places left'), 'and the places-left line is still there, where it means something');
  D.byTag(d3.mount, 'form')[0].submit();
  await settle();
  H.ok(sent.some((b) => b.action === 'submit'), 'it still posts submit');
  H.ok(!sent.some((b) => b.action === 'bookAndPay'), 'and never bookAndPay');

  console.log('\n[the same screen in Hebrew and Russian]');
  for (const [l, word] of [['he', 'הרשמה ותשלום'], ['ru', 'Записаться и оплатить']]) {
    const d = await screen({ view: 'activity', lang: l, search: '?register=folk' });
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
    // `paymentMode` is what settle() checks the arriving payment against. A live
    // evening paid for with a live Checkout is the ordinary case.
    status: 'booked', frozen: { type: 'dropin', sessionDate: date, paymentMode: 'live' },
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
  await mods['stripe-webhook'].settle(session, 'live');
  let a = await att.getAttendance('p-1', 'act-2', '2026-10-27');
  let b = await att.getAttendance('p-1', 'act-2', '2026-11-03');
  H.eq(a.payment.paidCents, 1200, 'each evening is settled for its OWN amount');
  H.eq(b.payment.paidCents, 1500, 'not for a share of the total');
  H.eq(a.payment.status + '/' + b.payment.status, 'paid/paid', 'and both read as paid');

  // Running it again must find nothing. Stripe retries, and a double credit here
  // is money a family did not pay showing as paid.
  await mods['stripe-webhook'].settle(session, 'live');
  a = await att.getAttendance('p-1', 'act-2', '2026-10-27');
  H.eq(a.payment.paidCents, 1200, 'a redelivered event settles nothing twice');

  console.log('\n[a breakdown that does not add up settles nothing at all]');
  await book('2026-11-10', 1000);
  await mods['stripe-webhook'].settle({
    id: 'cs_2', amount_total: 2700,
    metadata: { organization: 'ogen', ogen_kind: 'session',
                participant_id: 'p-1', activity_id: 'act-2',
                session_dates: '2026-11-10,2026-10-27', session_amounts: '1000,1000' }
  }, 'live');
  const c = await att.getAttendance('p-1', 'act-2', '2026-11-10');
  H.eq(c.payment.paidCents, 0,
    'money is not split across blobs by a figure nobody checked — that lands it ' +
    'against the wrong debt, which is worse than money nobody can place');

  console.log('\n[and the cost card asks it of both too]');
  // It used to ask on a term and not on a drop-in, reading `r.type !== 'dropin'`
  // — the client's copy of a split the server no longer makes. A client that
  // hides a button the server would honour, or offers one it will refuse, looks
  // broken either way, so the two read the same field; this one has no field
  // left to read.
  for (const [what, query] of [['a term', '?p=p-1&a=act-1'], ['a drop-in', '?p=p-1&a=act-2']]) {
    const card = await screen({ view: 'activity', lang: 'en', search: query, api: UNCONFIRMED });
    H.ok(card.mount.textContent.indexOf('confirm your email address') !== -1,
      what + ': an unconfirmed family is told why, rather than shown a missing button');
    H.eq(D.byTag(card.mount, 'button').filter((b) => /Pay securely/.test(b.textContent)).length, 0,
      what + ': and no pay button');
  }
  const paid = await screen({ view: 'activity', lang: 'en', search: '?p=p-1&a=act-2' });
  H.eq(D.byTag(paid.mount, 'button').filter((b) => /Pay securely/.test(b.textContent)).length, 1,
    'and a confirmed one gets the button');

  console.log('\n[the bundle card, on the activity page]');
  const bun = await screen({ view: 'activity', lang: 'en', search: '?p=p-1&a=act-2' });
  H.ok(bun.mount.textContent.indexOf('1 of 3') !== -1,
    'entries left is the largest thing on the card, and it is derived — never a stored counter');
  H.ok(bun.mount.textContent.indexOf('Valid until') !== -1, 'with the date the window ends');
  ['used', 'booked', 'available'].forEach((w) => {
    H.ok(bun.mount.textContent.indexOf(w) !== -1, 'every covered date says where it stands: ' + w);
  });
  // ⚠ NOT "expired". The window doing its job and a promise we broke are two
  // different events, and only the second is credited back.
  H.ok(bun.mount.textContent.indexOf('expired') === -1, 'and nothing on it says "expired"');
  // €0.00 on an evening paid for in advance reads as a mistake; the reason it is
  // nothing is the interesting part.
  H.ok(bun.mount.textContent.indexOf('from your bundle') !== -1,
    'and the evenings table names the bundle rather than showing €0.00');

  console.log('\n[moving one session offers only the dates the server named]');
  const moveBtn = D.byTag(bun.mount, 'button').filter((b) => b.textContent === 'Move')[0];
  H.ok(moveBtn, 'the one booking that can move has a button');
  H.eq(D.byTag(bun.mount, 'button').filter((b) => b.textContent === 'Move').length, 1,
    'and only that one — a used entry and an unbooked date have nothing to move');
  moveBtn.click();
  const sel = D.byTag(bun.mount, 'select').filter((n) => (n.childNodes || []).length === 2)[0];
  H.ok(sel, 'it opens the list of targets the server computed');
  sel.value = '2026-11-03';
  sent.length = 0;
  D.byTag(bun.mount, 'button').filter((b) => b.textContent === 'Move it')[0].click();
  await settle();
  const moved = sent.filter((b) => b.action === 'rescheduleSession')[0];
  H.ok(moved, 'and moving posts rescheduleSession');
  H.eq(moved.fromDate + ' → ' + moved.toDate, '2026-10-13 → 2026-11-03', 'naming both dates');
  H.ok(!sent.some((b) => b.action === 'cancelSession'),
    '⚠ and NEVER as a cancel plus a booking — that would spend the entry and ' +
    'charge the standard price for the replacement');

  console.log('\n[and buying one goes straight to Checkout]');
  const buy = await screen({ view: 'activity', lang: 'en', search: '?p=p-1&a=act-2' });
  sent.length = 0;
  D.byTag(buy.mount, 'button').filter((b) => b.textContent === 'Buy')[0].click();
  await settle();
  const bought = sent.filter((b) => b.action === 'buyBundle')[0];
  H.ok(bought, 'the offer posts buyBundle');
  H.eq(bought.bundleId, 'b5', 'with an ID and nothing else');
  H.ok(!('pricePerEntry' in bought) && !('entries' in bought),
    'never a price or a count — the server re-decides the offer from the activity');
  H.eq(buy.window.location.href, 'https://checkout.stripe.com/c/pay/bundle',
    'and the family leaves for Stripe');

  H.done();
})();
