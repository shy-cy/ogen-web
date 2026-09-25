// What this defends against:
//
// ⚠ "NO WAITING LIST FOR DROP IN" — reported from QA, and the third time this
// project has shipped a capability with no door on it.
//
// The server has been complete since Phase 7. `bookSession` takes a `waitlist`
// flag, queues on a full evening, mails the family and owes them nothing;
// `holdsASeat()` reads a `claimExpiresAt` so a claimer gets MINUTES rather than
// the open-ended hold a booking gets; `seatOpened()` tells that evening's queue
// and nobody else's. Every rule was there and tested.
//
// THE CLIENT DREW NOTHING. Three places, each defensible on its own:
//
//   1. `eveningAction()` ended with `if (!data.mayBook || s.full || s.past)
//      return null` — so the one row that had something new to offer was the one
//      row with no control at all. Identical in shape to the full GROUP option
//      being `disabled`, one screen over, and to the invite button labelled with
//      a description.
//   2. There was no branch for `s.status === 'waiting'`, so a family already in
//      an evening's queue could neither leave it nor take the seat when it
//      opened. The pill was drawn and nothing else.
//   3. The register panel dimmed a full evening, so with EVERY evening full
//      there was nothing tickable, a disabled pay button, and no sentence — a
//      dead end on the screen every activity page's Register button lands on.
//
// And two things were wrong underneath the missing doors:
//
// ⚠ `cancelSession` REFUSED A WAITING RECORD AS "already happened". The guard
// allowed only `booked`, so the one action a queue must offer — leaving it —
// answered with a refusal about something else entirely. Leaving is not a
// cancellation: nothing was held, nothing owed, no price frozen, so there is no
// credit and no ledger line — and `seatOpened()` must NOT fire, or everybody
// else waiting is told a place opened that nobody gave up.
//
// ⚠ AND `waiting` HAD NO WORD IN ANY LANGUAGE. `T.sessionStatus` held four
// statuses out of five, so the pill fell through to `|| s.status` and printed
// the raw English string `waiting` on the Hebrew and Russian pages.
//
// The copy is the COURSE queue's own — registerWaitGo, takePlace, leaveWait — so
// a family reads one sentence whichever queue they join and there is no second
// table of words to keep in step.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_helpers');
const F = require('./_fixtures');
const D = require('./_dom');

process.env.RESEND_FROM = 'Merkaz Ogen <noreply@ogen.cy>';

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const memberSession = read('js/member-session.js');
const memberAccount = read('js/member-account.js');
const ui = read('js/member-account.js');

// ---------------------------------------------------------------- the client --
const ACCOUNT = {
  accountId: 'a-1', email: 'michal@example.com',
  emailVerifiedAt: '2026-01-01T00:00:00Z',
  profile: { firstName: 'Michal', preferredLanguage: 'en' }
};
const REG = {
  participantId: 'p-1', activityId: 'act-9', slug: 'folk', type: 'dropin',
  participantName: 'Noa Levi', status: 'approved', groupId: null,
  title: { en: 'Folk dancing' }, frozen: { price: {} },
  payment: { owedCents: 0, paidCents: 0, creditedCents: 0 },
  cancellation: null, priceRows: []
};
const ACT = {
  activityId: 'act-9', slug: 'folk', type: 'dropin', perSession: true,
  title: { en: 'Folk dancing' }, status: 'open', full: false,
  capacity: null, taken: 3, left: null, facts: [], priceRows: [], sessionRows: [],
  groups: []
};

// One evening per case, so a single render shows every branch at once.
function sessionsPayload(rows, mayBook) {
  return {
    mayBook: mayBook !== false, registrationStatus: 'approved',
    sessions: rows,
    totals: { booked: 0, owedCents: 0, paidCents: 0, creditedCents: 0, outstandingCents: 0 },
    held: []
  };
}
const evening = (over) => Object.assign({
  date: '2026-10-06', priceCents: 700, priceBasis: null, standardPriceCents: 700,
  startsAt: null, past: false, left: 2, capacity: 3, full: false,
  status: null, owedCents: null, paidCents: null, cancellation: null
}, over || {});

const sent = [];
function fetchFor(payload, overrides) {
  const table = Object.assign({
    me: () => ({ ok: true, account: ACCOUNT, expiresAt: Date.now() + 1e7 }),
    registration: () => ({ ok: true, registration: REG, activity: ACT,
                           balanceCents: 0, perSession: payload }),
    registerPanel: () => ({ ok: true, activity: ACT, participants: [
      { participantId: 'p-1', firstName: 'Noa', lastName: 'Levi', age: 9 }],
      sessionsFor: 'p-1', ...payload }),
    sessions: () => Object.assign({ ok: true }, payload),
    bookSession: () => ({ ok: true, waiting: true }),
    cancelSession: () => ({ ok: true, waitingLeft: true }),
    submit: () => ({ ok: true, registration: Object.assign({}, REG) })
  }, overrides || {});
  return function (endpoint, init) {
    const body = JSON.parse(init.body);
    sent.push(body);
    const fn = table[body.action];
    const out = fn ? fn(body) : { ok: true };
    const status = out._status || 200;
    delete out._status;
    return Promise.resolve({ ok: status < 400, status: status,
                             json: () => Promise.resolve(out) });
  };
}
const settle = () => new Promise((r) => setTimeout(r, 40));

async function screen(opts) {
  const dom = D.makeDom(Object.assign(
    { fetch: fetchFor(opts.payload, opts.api) }, opts));
  dom.window.localStorage.setItem('ogenMemberSession', JSON.stringify({
    token: 't', firstName: 'Michal', email: ACCOUNT.email, expiresAt: Date.now() + 1e7 }));
  const ctx = vm.createContext({
    window: dom.window, document: dom.document, console: console,
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
const has = (dom, s) => dom.mount.textContent.indexOf(s) !== -1;
const labelled = (dom, text) => D.byTag(dom.mount, 'button')
  .filter((b) => b.textContent === text)[0];

(async () => {
  console.log('[a word for `waiting`, in all three languages]');
  // It printed the raw status. Four of five statuses had a label and the fifth
  // is the only one a family reaches by pressing something.
  const labels = ui.match(/sessionStatus: \{[^}]*\}/g) || [];
  H.eq(labels.length, 3, 'three tables');
  labels.forEach((t) => H.ok(/waiting:/.test(t), 'each has a word for waiting: ' + t.slice(17, 60)));
  H.ok(/waiting: 'ברשימת המתנה'/.test(ui), 'the Hebrew is Hebrew');
  H.ok(/waiting: 'В очереди'/.test(ui), 'and the Russian is Cyrillic');
  // Outlined rather than filled, like the course queue's pill: nothing is held,
  // and a solid full pill on this site means pressable.
  const css = read('shared.css');
  H.ok(/\.acc-pill\.is-waitlisted, \.acc-pill\.is-s-waiting\{/.test(css),
    '⚠ ONE RULE for both queues — waiting for a term and waiting for one evening ' +
    'are the same fact about a family, so they must not get two looks');

  // =========================================================================
  console.log('\n[a full evening offers its waiting list instead of nothing]');
  sent.length = 0;
  const full = await screen({ view: 'activity', lang: 'en', search: '?p=p-1&a=act-9',
    payload: sessionsPayload([evening({ full: true, left: 0 })]) });
  const join = labelled(full, 'Join the waiting list');
  H.ok(join, '⚠ there is a control at all — the row returned null before, which is ' +
    'what made the whole feature unreachable');
  H.ok(!labelled(full, 'Book'), 'and not the ordinary book button, which would be refused');

  console.log('\n[and pressing it asks for a QUEUE, not a booking]');
  sent.length = 0;
  join.click();
  await settle();
  const q = sent.filter((b) => b.action === 'bookSession')[0];
  H.ok(q, 'it posts bookSession — the endpoint that has always been able to queue');
  H.eq(q.waitlist, true,
    '⚠ with waitlist TRUE. Without it the server answers 409 evening-full, which ' +
    'is the refusal this whole feature exists to replace');
  H.eq(q.sessionDate, '2026-10-06', 'for that evening only');
  H.eq(q.slug, 'folk', 'by the activity\'s current slug');
  H.ok(has(full, 'You have not been charged'),
    'and the family is told what it means, in the course queue\'s own words');

  // =========================================================================
  console.log('\n[a queued evening can be LEFT, which was refused as a cancellation]');
  sent.length = 0;
  const queued = await screen({ view: 'activity', lang: 'en', search: '?p=p-1&a=act-9',
    payload: sessionsPayload([evening({ full: true, left: 0, status: 'waiting',
                                        owedCents: 0, paidCents: 0 })]) });
  H.ok(has(queued, 'On the waiting list'), 'the pill says so in words');
  const leave = labelled(queued, 'Leave the waiting list');
  H.ok(leave, '⚠ leaving is offered — the one action a queue has to have');
  H.ok(!labelled(queued, 'Take the place'),
    'and nothing to take while it is still full: a dead button is worse than none');

  console.log('\n[and a seat that opens can be taken, on that row]');
  sent.length = 0;
  const opened = await screen({ view: 'activity', lang: 'en', search: '?p=p-1&a=act-9',
    payload: sessionsPayload([evening({ full: false, left: 1, status: 'waiting',
                                       owedCents: 0, paidCents: 0 })]) });
  const take = labelled(opened, 'Take the place');
  H.ok(take, 'the claim appears the moment the evening has room');
  H.ok(labelled(opened, 'Leave the waiting list'), 'with leaving still there, one rank down');
  sent.length = 0;
  take.click();
  await settle();
  const claim = sent.filter((b) => b.action === 'bookSession')[0];
  H.ok(claim, 'it books');
  H.ok(claim.waitlist !== true,
    '⚠ and NOT as a queue join. `claiming` is read off the record rather than off ' +
    'the request, so an ordinary booking is recognised as a claim and held for ' +
    'minutes — with the flag true the server would quietly re-queue them');

  // =========================================================================
  console.log('\n[a past evening is still nothing, queue or no queue]');
  const gone = await screen({ view: 'activity', lang: 'en', search: '?p=p-1&a=act-9',
    payload: sessionsPayload([evening({ full: true, left: 0, past: true })]) });
  H.ok(!labelled(gone, 'Join the waiting list'),
    '⚠ a class that has happened cannot be queued for — `past` is refused BEFORE ' +
    'the queue is offered');
  H.ok(!labelled(gone, 'Book'), 'and not booked either, which is the older fix');

  console.log('\n[nor anything at all without an approved registration behind it]');
  const unapproved = await screen({ view: 'activity', lang: 'en', search: '?p=p-1&a=act-9',
    payload: sessionsPayload([evening({ full: true, left: 0 })], false) });
  H.ok(!labelled(unapproved, 'Join the waiting list'),
    'mayBook false offers no queue — the registration is the "may come" decision ' +
    'and an admin makes it once');

  // =========================================================================
  //
  // ⚠ AND THE REGISTER PANEL ONLY HAD A DOOR WHEN *EVERY* EVENING WAS FULL.
  //
  // Reported as "I cannot test the drop in waiting list, as it's not working",
  // on test 10: one evening marked מלא with a dimmed, disabled box, and no way
  // to queue for it. The first fix caught the rare shape — a term where NOTHING
  // has room — and missed the ordinary one, a popular Monday among free
  // Tuesdays. That is the full GROUP option's mistake arriving one screen over:
  // on a drop-in the evening IS the thing a family picks, so "the other Tuesday
  // has room" is no answer to somebody who can only come on the Monday.
  //
  // A full evening is a row like any other now, and ticking it is how you join
  // its queue — the same sentence the course side settled on.
  console.log('\n[a full evening is tickable, because ticking it is how you queue]');
  sent.length = 0;
  const panel = await screen({ view: 'activity', lang: 'en', search: '?register=folk',
    payload: sessionsPayload([evening({ full: true, left: 0 }),
                              evening({ date: '2026-10-13', full: true, left: 0 })]) });
  const boxes = D.byTag(panel.mount, 'input').filter((i) => i.type === 'checkbox');
  H.eq(boxes.length, 2, 'both evenings are drawn');
  H.eq(boxes.filter((b) => b.disabled).length, 0,
    '⚠ and NEITHER is disabled — a dimmed box is what made this unreachable');
  H.eq(boxes.filter((b) => b.checked).length, 0,
    'and nothing is pre-ticked: putting somebody in a queue they never asked ' +
    'about is not a convenience');
  H.ok(has(panel, 'ticking this joins the waiting list'),
    '⚠ said BEFORE the press. A tick that quietly means something else is the ' +
    'surprise the full-group option was rebuilt to avoid');

  console.log('\n[and the button says which of the two things it is about to do]');
  boxes[0].click();
  const go = D.byTag(panel.mount, 'button').filter((b) => b.getAttribute('type') === 'submit')[0];
  H.eq(go.textContent, 'Join the waiting list',
    '⚠ the course queue\'s own word, not "Register and pay · €0.00" — which would ' +
    'be a surprise about a child\'s place in the one place this site refuses one');
  H.eq(go.disabled, false, 'and it is live');

  console.log('\n[and it asks for a queue, in its own list]');
  sent.length = 0;
  D.byTag(panel.mount, 'form')[0].submit();
  await settle();
  const ask = sent.filter((b) => b.action === 'bookAndPay')[0];
  H.ok(ask, 'it is the one-step action, not a second endpoint');
  H.eq((ask.sessionDates || []).length, 0, 'no seat is asked for');
  H.eq((ask.waitDates || []).join(','), '2026-10-06',
    '⚠ TWO LISTS, not a flag per date. A request naming which evenings it wants ' +
    'a SEAT on can be refused for exactly those, and asking to queue is asking ' +
    'for less — so nothing here can buy itself a place');

  console.log('\n[⚠ and the reported shape: one full evening among free ones]');
  sent.length = 0;
  const mixed = await screen({ view: 'activity', lang: 'en', search: '?register=folk',
    payload: sessionsPayload([evening({ full: true, left: 0 }),
                              evening({ date: '2026-10-13' })]) });
  const mboxes = D.byTag(mixed.mount, 'input').filter((i) => i.type === 'checkbox');
  H.eq(mboxes.filter((b) => b.disabled).length, 0, 'the full one is still choosable');
  H.eq(mboxes[1].checked, true,
    'and the next evening WITH ROOM is the one pre-ticked, never the full one');
  const mgo = D.byTag(mixed.mount, 'button').filter((b) => b.getAttribute('type') === 'submit')[0];
  H.eq(mgo.textContent, 'Register and pay · €7.00',
    'the ordinary one-step flow is untouched, carrying its running total');
  mboxes[0].click();
  H.eq(mgo.textContent, 'Register and pay · €7.00',
    '⚠ and a queue join adds NOTHING to the total — it holds no seat, owes ' +
    'nothing and freezes no price');
  sent.length = 0;
  D.byTag(mixed.mount, 'form')[0].submit();
  await settle();
  const both = sent.filter((b) => b.action === 'bookAndPay')[0];
  H.eq((both.sessionDates || []).join(','), '2026-10-13', 'the free evening is booked');
  H.eq((both.waitDates || []).join(','), '2026-10-06', 'and the full one is queued for');

  // =============================================================== server ====
  console.log('\n[executed: the server queues, and lets go]');
  const blobs = H.makeBlobs();
  const dropin = F.dropin({ slug: 'folk', activityId: 'act-000000000000dr01' });
  // One seat on each evening, so filling it is one booking.
  dropin.facts = Object.assign({}, dropin.facts, {
    groupSize: Object.assign({}, (dropin.facts || {}).groupSize, { maxPerGroup: 1, groups: 1 })
  });
  (dropin.groups || []).forEach((g) => { g.capacity = 1; });
  const github = H.makeGithub({
    'activities/folk.json': JSON.stringify(dropin),
    'activities/activities-index.json': JSON.stringify(
      [{ slug: 'folk', activityId: dropin.activityId, status: 'open',
         langs: ['he', 'en', 'ru'], title: dropin.title }])
  });
  const mods = H.loadWithStubs({ blobs, github,
    modules: ['_registration-store', '_session-attendance', '_credit-ledger', 'account-auth',
              'account-family', 'account-registrations', '_stripe'] });
  const store = mods['_registration-store'];
  const attendance = mods['_session-attendance'];
  const ledger = mods['_credit-ledger'];
  const auth = mods['account-auth'];
  const family = mods['account-family'];
  const api = mods['account-registrations'];

  const mail = [];
  require(H.fnPath('_email'))._internal.setTransport({
    emails: { send: async (m) => { mail.push(m); return { data: { id: 'e' } }; } }
  });

  async function person(name) {
    const up = await H.signUp(auth, blobs, { email: name + '@example.com',
      profile: { firstName: name, preferredLanguage: 'en' } });
    const made = await H.call(family.handler, { action: 'createParticipant', token: up.body.token,
      participant: { firstName: name, lastName: 'Levi', dateOfBirth: '2016-04-02' } });
    const pid = made.body.participant.participantId;
    const res = await H.call(api.handler, { action: 'submit', token: up.body.token,
      slug: 'folk', participantId: pid, lang: 'en' });
    H.eq(res.status, 200, name + ' is registered to the drop-in');
    return { token: up.body.token, pid: pid, accountId: up.body.account.accountId };
  }
  const a = await person('ann');
  const b = await person('bea');

  // The first bookable evening that is still ahead.
  const dates = attendance.bookableDates(dropin, require(H.fnPath('_activity-groups')).ANY);
  const credit = require(H.fnPath('_credit'));
  const DATE = dates.filter((d) => !credit.past(d, Date.now()))[0];
  H.ok(DATE, 'the fixture has an evening still ahead (' + DATE + ')');

  const booked = await H.call(api.handler, { action: 'bookSession', token: a.token,
    slug: 'folk', participantId: a.pid, sessionDate: DATE, lang: 'en' });
  H.eq(booked.status, 200, 'Ann takes the one seat');

  console.log('\n[without the flag it is still a refusal, and it says a queue is possible]');
  const refused = await H.call(api.handler, { action: 'bookSession', token: b.token,
    slug: 'folk', participantId: b.pid, sessionDate: DATE, lang: 'en' });
  H.eq(refused.status, 409, 'Bea cannot book a full evening');
  H.eq(refused.body.canWaitlist, true,
    'and is told a queue is possible — the field the screen now acts on');

  console.log('\n[with it, she is in that evening\'s queue and owes nothing]');
  mail.length = 0;
  const wait = await H.call(api.handler, { action: 'bookSession', token: b.token,
    slug: 'folk', participantId: b.pid, sessionDate: DATE, waitlist: true, lang: 'en' });
  H.eq(wait.status, 200, 'queued');
  H.eq(wait.body.attendance.status, 'waiting', 'as `waiting`');
  H.eq(wait.body.attendance.payment.owedCents, 0,
    '⚠ owing NOTHING — a queue is not a bill, and a roster showing a debt against ' +
    'somebody with no seat would be the screen inventing one');
  H.eq(mail.length, 1, 'and she is written to');
  // Counted, never decremented: a status the count ignores cannot move a number.
  const all = await attendance.forActivity(dropin.activityId, DATE);
  const R2 = require(H.fnPath('_registration'));
  const cap = R2.capacityForDate(dropin, all, DATE);
  H.eq(cap.left, 0, 'the room is still full — waiting holds no seat');
  H.eq(cap.over, false, 'and nothing reads as over capacity');

  console.log('\n[leaving the queue is not a cancellation]');
  // ⚠ A SECOND FAMILY IS WAITING ON THE SAME EVENING, and that is what makes the
  // last assertion in this block bite. With Bea alone in the queue, firing
  // seatOpened() on her way out mails nobody — she is the only row and it is
  // already cancelled by then — so the check passed with the bug restored.
  const dee = await person('dee');
  await H.call(api.handler, { action: 'bookSession', token: dee.token, slug: 'folk',
    participantId: dee.pid, sessionDate: DATE, waitlist: true, lang: 'en' });
  mail.length = 0;
  const before = (await ledger.entriesFor(b.accountId)).length;
  const left = await H.call(api.handler, { action: 'cancelSession', token: b.token,
    activityId: dropin.activityId, participantId: b.pid, sessionDate: DATE, lang: 'en' });
  H.eq(left.status, 200,
    '⚠ it is allowed at all — the guard took only `booked`, so this answered 409 ' +
    '"that evening has already happened", a refusal about something else');
  H.eq(left.body.waitingLeft, true, 'and says which of the two things it did');
  H.eq(left.body.session.status, 'cancelled',
    'marked cancelled rather than deleted, so an admin can see somebody who waited and left');
  H.eq(left.body.credit.credit, 0, 'no credit — nothing was ever paid or held');
  H.eq((await ledger.entriesFor(b.accountId)).length, before,
    '⚠ and NOTHING in the ledger. A zero entry is a line in a financial record ' +
    'that means nothing and still has to be explained');
  H.eq(mail.length, 0,
    '⚠ AND DEE, WHO IS STILL WAITING ON THIS EVENING, WAS NOT TOLD A SEAT OPENED. ' +
    'No seat was given up, so seatOpened() must not fire — otherwise everybody ' +
    'else waiting is invited to take a place that does not exist');

  console.log('\n[a seat given back does tell that evening\'s queue, and only it]');
  // Bea waits again; Ann gives the seat back.
  await H.call(api.handler, { action: 'bookSession', token: b.token, slug: 'folk',
    participantId: b.pid, sessionDate: DATE, waitlist: true, lang: 'en' });
  const other = dates.filter((d) => d !== DATE && !credit.past(d, Date.now()))[0];
  H.ok(other, 'the fixture has a second evening (' + other + ')');
  const c = await person('cat');
  await H.call(api.handler, { action: 'bookSession', token: c.token, slug: 'folk',
    participantId: c.pid, sessionDate: other, waitlist: true, lang: 'en' });
  mail.length = 0;
  const gave = await H.call(api.handler, { action: 'cancelSession', token: a.token,
    activityId: dropin.activityId, participantId: a.pid, sessionDate: DATE, lang: 'en' });
  H.eq(gave.status, 200, 'Ann cancels her booking');
  const told = mail.map(function (m) { return [].concat(m.to)[0]; }).sort();
  H.eq(told.join(','), 'bea@example.com,dee@example.com',
    '⚠ EVERYBODY waiting on that evening, at once — the first one back takes it');
  H.ok(told.indexOf('cat@example.com') === -1,
    '⚠ and NOT the family waiting on a different evening — waiting for Tuesday ' +
    'says nothing about Thursday');

  console.log('\n[and Bea claiming it gets minutes, not weeks]');
  const claimed = await H.call(api.handler, { action: 'bookSession', token: b.token,
    slug: 'folk', participantId: b.pid, sessionDate: DATE, lang: 'en' });
  H.eq(claimed.status, 200, 'she books the seat that opened');
  H.eq(claimed.body.session.status, 'booked', 'as an ordinary booking');
  const held = claimed.body.session.claimExpiresAt;
  H.ok(held, '⚠ carrying a claim deadline — unpaid holds are the whole reason the ' +
    'queue exists, so handing a claimer the ordinary window rebuilds the problem');
  const minutes = (Date.parse(held) - Date.now()) / 60000;
  H.ok(minutes > 0 && minutes <= R2.CLAIM_MINUTES + 1,
    'of ' + R2.CLAIM_MINUTES + ' minutes, not days (' + Math.round(minutes) + ')');

  // =========================================================================
  console.log('\n[executed: registering and queueing in the one step]');
  //
  // ⚠ THE REGISTER PANEL IS THE WAY IN, and until now a full evening could not
  // be asked for from it at all. bookAndPay refused the whole request if any
  // chosen date was full, which is right for a date somebody asked for a SEAT on
  // and wrong for one they asked to WAIT for.
  mods['_stripe']._internal.setClient({
    checkout: { sessions: { create: async () => (
      { id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' }) } }
  });
  // Somebody with no registration yet — which is the whole point: the panel is
  // where a family arrives from an activity page's Register button.
  async function newcomer(name) {
    const up = await H.signUp(auth, blobs, { email: name + '@example.com',
      emailVerifiedAt: new Date().toISOString(),
      profile: { firstName: name, preferredLanguage: 'en' } });
    const made = await H.call(family.handler, { action: 'createParticipant', token: up.body.token,
      participant: { firstName: name, lastName: 'Levi', dateOfBirth: '2016-04-02' } });
    return { token: up.body.token, pid: made.body.participant.participantId,
             accountId: up.body.account.accountId };
  }

  // DATE is full again: Bea claimed the seat Ann gave back, two blocks up.
  const eve = await newcomer('eve');
  mail.length = 0;
  const joined = await H.call(api.handler, { action: 'bookAndPay', token: eve.token,
    slug: 'folk', participantId: eve.pid, sessionDates: [], waitDates: [DATE], lang: 'en' });
  H.eq(joined.status, 200,
    '⚠ a request for nothing but a queue is not "choose a date" — it IS a choice');
  H.eq((joined.body.waiting || []).join(','), DATE, 'and it says which evening she is waiting on');
  H.eq(joined.body.url, null, 'no Checkout: a queue join is not a purchase');
  const hers = await attendance.getAttendance(eve.pid, dropin.activityId, DATE);
  H.eq(hers.status, 'waiting', 'the record is the same `waiting` bookSession writes');
  H.eq(hers.payment.owedCents, 0, 'owing nothing');
  H.ok(!hers.frozen.priceCents,
    '⚠ and with NO price frozen — late pricing means the only honest moment to fix ' +
    'a price is when a place is actually taken');
  H.eq(mail.length, 1, 'and she is written to, by the same message the other door sends');
  // The registration underneath exists, which is what the queue hangs off: a
  // family should never have to know it is there.
  const under = await store.getRegistration(eve.pid, dropin.activityId);
  H.ok(under && under.status === 'approved',
    'the registration was opened on the way through, and approved');

  console.log('\n[⚠ a seat asked for and since gone is still refused]');
  const fay = await newcomer('fay');
  const taken = await H.call(api.handler, { action: 'bookAndPay', token: fay.token,
    slug: 'folk', participantId: fay.pid, sessionDates: [DATE], lang: 'en' });
  H.eq(taken.status, 409,
    '⚠ NOT quietly filed in the queue. Asking for a seat and being put in a line ' +
    'instead is a surprise about a child\'s place, which is the one thing this ' +
    'flow refuses to spring on anybody');
  H.eq((taken.body.refused || [])[0].reason, 'full', 'and says why');

  console.log('\n[⚠ while a queue asked for on an evening with room is simply taken]');
  const free = dates.filter((d) => d !== DATE && d !== other && !credit.past(d, Date.now()))[0];
  H.ok(free, 'the fixture has a third evening with room (' + free + ')');
  const gil = await newcomer('gil');
  const better = await H.call(api.handler, { action: 'bookAndPay', token: gil.token,
    slug: 'folk', participantId: gil.pid, sessionDates: [], waitDates: [free], lang: 'en' });
  H.eq(better.status, 200, 'it goes through');
  H.eq((better.body.waiting || []).length, 0, 'and he is in no queue');
  const seat = await attendance.getAttendance(gil.pid, dropin.activityId, free);
  H.eq(seat.status, 'booked',
    '⚠ a place opened between the screen and the press, and that is BETTER than ' +
    'what was asked for — so it is taken. Never the other way round');
  H.ok(better.body.url, 'and the evening is charged for, like any other booking');

  H.done();
})();
