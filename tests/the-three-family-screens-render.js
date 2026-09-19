// What this defends against:
//
// The family area is over a thousand lines of client code and until now NOTHING
// EVER RAN IT. Every suite touching it read it as text. Reading catches a
// renamed string key; it does not catch `querySelector` on a node that has none,
// an `undefined` two levels into a response, a branch that throws the first time
// somebody opens a drop-in, or a date that comes out in the wrong language. All
// of those fail on a family's screen and on nobody else's.
//
// So this one EXECUTES the script, in the DOM shim in _dom.js, against canned
// API answers — the same trade _helpers.js already makes for Blobs and GitHub.
// Three screens, both activity shapes, and two of the three languages, because
// the bugs it is looking for are the ones that only appear when a render path
// actually runs.
//
// It found two things while being written, and both are the kind that read fine:
// registering for an activity said "your request has been sent" and then rebooted
// the dashboard, which threw the notice away inside one repaint; and the two tabs
// on /account/details told themselves apart by comparing their own label text,
// which would have lit both up in any language where the wording converged.

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
  accountId: 'a-1', email: 'michal@example.com', emailVerifiedAt: '2026-01-01T00:00:00Z',
  profile: { firstName: 'Michal', lastName: 'Shinitzky', phone: '+35796020180',
             preferredLanguage: 'en' }
};
// The account holder and a child, on ONE list. That is the whole point: a
// participant makes no claim about age, so these differ by date of birth and by
// nothing else in the model.
const PARTICIPANTS = [
  { participantId: 'p-1', firstName: 'Michal', lastName: 'Shinitzky',
    dateOfBirth: '1975-07-31', age: 51, isSelf: true, isPrimary: true },
  { participantId: 'p-2', firstName: 'Noa', lastName: 'Levi',
    dateOfBirth: '2017-04-02', age: 9, isSelf: false, isPrimary: true }
];
const REGS = [
  { participantId: 'p-2', participantName: 'Noa Levi', activityId: 'act-1', slug: 'hebrew',
    title: { en: 'Hebrew for kids', he: 'עברית לילדים', ru: 'Иврит для детей' },
    type: 'course', groupId: null, groupName: { en: 'Beginners', he: 'מתחילים', ru: 'Начинающие' },
    status: 'approved', holdsASpot: true, owedCents: 35000, paidCents: 35000, creditedCents: 0,
    feeCharged: true, cancellation: { guardianMayCancel: true, total: 0 } },
  { participantId: 'p-1', participantName: 'Michal Shinitzky', activityId: 'act-2', slug: 'folk',
    title: { en: 'Folk dancing', he: 'ריקודי עם', ru: 'Народные танцы' },
    type: 'dropin', groupId: null, groupName: null,
    status: 'approved', holdsASpot: true, owedCents: 5000, paidCents: 0, creditedCents: 0,
    feeCharged: true, cancellation: { guardianMayCancel: true, total: 0 } },
  { participantId: 'p-2', participantName: 'Noa Levi', activityId: 'act-3', slug: 'old',
    title: { en: 'Autumn term', he: 'סמסטר סתיו', ru: 'Осенний семестр' },
    type: 'course', status: 'cancelled', holdsASpot: false,
    owedCents: 30000, paidCents: 0, creditedCents: 0, feeCharged: false,
    cancellation: { guardianMayCancel: false } }
];

const sent = [];
const ANSWERS = {
  me: () => ({ ok: true, account: ACCOUNT, expiresAt: Date.now() + 1e7 }),
  listParticipants: () => ({ ok: true, participants: PARTICIPANTS.map((p) => Object.assign({}, p)) }),
  // ⚠ ONE CALL FOR THE WHOLE DASHBOARD. It was three — the participant count,
  // the registrations and the credit balance — asked of two functions, each
  // authenticating and each opening its own stores, for one question about one
  // account. `list` and `balance` are gone rather than left beside it: an action
  // nothing calls is dead copy indistinguishable from one whose caller was
  // renamed.
  dashboard: () => ({ ok: true, registrations: REGS, participantCount: PARTICIPANTS.length,
                      balanceCents: 0, entries: [] }),
  listGuardians: () => ({ ok: true,
    guardians: [{ name: 'Michal Shinitzky', email: 'michal@example.com', isPrimary: true }],
    pendingInvites: [{ invitedEmail: 'dana@example.com', token: 'tok' }],
    iAmPrimary: true, maxGuardians: 2 }),
  createParticipant: () => ({ ok: true, participant: PARTICIPANTS[1] }),
  registration: (b) => ({
    ok: true,
    registration: REGS.filter((r) => r.activityId === b.activityId)[0],
    activity: {
      activityId: b.activityId, slug: b.activityId === 'act-2' ? 'folk' : 'hebrew',
      type: b.activityId === 'act-2' ? 'dropin' : 'course',
      title: { en: 'Hebrew for kids' },
      facts: [{ key: 'schedule', heading: 'When & where', facts: [
        { key: 'schedule', label: 'When', value: 'Wednesdays 16:00' },
        { key: 'location', label: 'Location', value: 'Limassol' }] }],
      priceRows: [{ label: 'Yearly registration fee', note: null, value: '€50' },
                  { label: 'Cost per semester', note: '(10 sessions × 2 lessons)', value: '€300' }],
      sessionRows: [{ n: 1, label: 'Session 1', day: 'Wednesday', date: '14 October' }]
    }
  }),
  sessions: () => ({ ok: true, mayBook: true, registrationStatus: 'approved', sessions: [
    { date: '2026-10-06', left: 5, capacity: 20, full: false, status: 'attended',
      owedCents: 1200, paidCents: 1200, cancellation: null },
    { date: '2026-10-13', left: 5, capacity: 20, full: false, status: 'booked',
      owedCents: 1200, paidCents: 0, cancellation: { mayCancel: true, credit: 0 } },
    { date: '2026-10-20', left: 5, capacity: 20, full: false, status: null,
      owedCents: null, paidCents: null, cancellation: null }
  ] }),
  activity: () => ({ ok: true, activity: { activityId: 'act-1', slug: 'hebrew', type: 'course',
    title: { en: 'Hebrew for kids' }, left: 4, capacity: 14, taken: 10, groups: null, full: false } }),
  submit: () => ({ ok: true, registration: REGS[0] })
};

function fetchFor(overrides) {
  const answers = Object.assign({}, ANSWERS, overrides || {});
  return function (endpoint, init) {
    const body = JSON.parse(init.body);
    sent.push(body);
    const fn = answers[body.action];
    if (!fn) return Promise.reject(new Error('no canned answer for action "' + body.action + '"'));
    const out = fn(body);
    return Promise.resolve({ status: out._status || 200, ok: out._status ? out._status < 400 : true,
                             json: () => Promise.resolve(out) });
  };
}

// Load the two scripts into a fresh context with a fresh DOM, run to settle, and
// hand back the mount. Everything a browser gives for free and this script uses
// has to be listed here, which is deliberate: an addition to the script that
// needs a new global fails loudly rather than silently doing nothing.
async function screen(opts) {
  const dom = D.makeDom(Object.assign({ fetch: fetchFor(opts.api) }, opts));
  if (opts.signedIn !== false) {
    dom.window.localStorage.setItem('ogenMemberSession', JSON.stringify({
      token: 't', firstName: 'Michal', email: ACCOUNT.email, expiresAt: Date.now() + 1e7 }));
  }
  const ctx = vm.createContext({
    window: dom.window, document: dom.document, console: console,
    Intl: Intl, Date: Date, Math: Math, JSON: JSON, Object: Object, Array: Array,
    String: String, Number: Number, RegExp: RegExp, Promise: Promise, setTimeout: setTimeout,
    encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent
  });
  vm.runInContext(memberSession, ctx, { filename: 'js/member-session.js' });
  vm.runInContext(memberAccount, ctx, { filename: 'js/member-account.js' });
  await settle();
  return dom;
}
const settle = () => new Promise((r) => setTimeout(r, 30));
const has = (dom, s) => dom.mount.textContent.indexOf(s) !== -1;

(async () => {
  // ⚠ A REFUSAL NOBODY CAN SEE IS A DEAD BUTTON.
  //
  // Sign-up is the tallest form in the area, so its submit button sits near the
  // fold while the one notice renders above the heading. "An account with that
  // email already exists" was being written off screen, and what a person saw
  // was: pressed Create account, nothing happened. It is scrolled into view now,
  // and announced.
  const src = fs.readFileSync(path.join(R, 'js/member-account.js'), 'utf8');
  H.ok(/function say\(kind, text\)[\s\S]{0,420}scrollIntoView/.test(src),
    'every notice is brought into view — the button and the message are a screen apart');
  H.ok(/function say\(kind, text\)[\s\S]{0,420}aria-live/.test(src),
    'and announced, because off-screen and unannounced are the same failure twice');

  console.log('[the wait has a shape]');
  // ⚠ DRAWN BEFORE THE REQUEST LEAVES. The wait used to be the word "Loading…"
  // on an otherwise empty page, which says exactly as much about a call that
  // takes 200ms as about one that has already failed — and leaves the page to
  // jump when the real content arrives at a different height.
  {
    const held = D.makeDom({ view: 'account', lang: 'en', fetch: function (e, init) {
      const body = JSON.parse(init.body);
      // Authentication answers; everything after it hangs, which is the state
      // being asserted.
      if (body.action === 'me') {
        return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve(ANSWERS.me()) });
      }
      return new Promise(function () {});
    } });
    held.window.localStorage.setItem('ogenMemberSession', JSON.stringify({
      token: 't', firstName: 'Michal', email: ACCOUNT.email, expiresAt: Date.now() + 1e7 }));
    const heldCtx = vm.createContext({
      window: held.window, document: held.document, console: console,
      location: held.window.location,
      Intl: Intl, Date: Date, Math: Math, JSON: JSON, Object: Object, Array: Array,
      String: String, Number: Number, RegExp: RegExp, Promise: Promise, setTimeout: setTimeout,
      encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent
    });
    vm.runInContext(memberSession, heldCtx, { filename: 'js/member-session.js' });
    vm.runInContext(memberAccount, heldCtx, { filename: 'js/member-account.js' });
    await settle();
    H.ok(D.byClass(held.mount, 'acc-skel').length >= 2,
      'a screen waiting on data draws the SHAPE of what is coming, not a spinner');
    const box = D.byClass(held.mount, 'acc-skeleton')[0];
    H.eq(box.getAttribute('role'), 'status',
      'announced, because a stack of grey blocks says nothing to a screen reader');
    H.ok(box.getAttribute('aria-label'), 'with the word it replaced as its label');
    H.ok(held.mount.textContent.indexOf('Loading') === -1,
      'and the word itself is not on screen — the shape is the message');
  }

  console.log('\n[the dashboard]');
  let dom = await screen({ view: 'account', lang: 'en' });
  H.ok(has(dom, 'Hello, Michal'), 'it greets you by name');
  H.ok(has(dom, 'My family'), 'the family tile is there');
  H.eq(D.byClass(dom.mount, 'acc-stat')[0].textContent, '2', 'with the count of people on the account');
  H.ok(has(dom, 'michal@example.com'), 'and your address, on the tile that leads to your details');
  // EVERY ROW IS A PERSON AND AN ACTIVITY. Two children in one class are two
  // registrations, so a row naming only the activity would hide which it is about.
  H.ok(has(dom, 'Noa Levi · Hebrew for kids'), 'a child\'s registration names both');
  H.ok(has(dom, 'Michal Shinitzky · Folk dancing'),
    'and so does the account holder\'s own — the list is not about children');
  H.ok(has(dom, 'Current') && has(dom, 'Finished'),
    'live and finished are grouped — by what the data says, not by a date no row carries');
  H.eq(D.byClass(dom.mount, 'is-muted').length, 1, 'the cancelled one is quieted, not hidden');
  const links = D.byTag(dom.mount, 'a').map((a) => a.getAttribute('href'));
  H.ok(links.indexOf('/en/account/activity?p=p-2&a=act-1') !== -1,
    'each row leads to its own page, addressed by the registration\'s key — and in the reader\'s own tree: ' +
    links.join(' '));
  H.ok(links.every((h) => h.indexOf('//') !== 0), 'and no link is protocol-relative');
  // Payments are not built, so there is nothing to show — and the card stays in
  // the code because cancelling in time ALREADY writes a credit to the ledger.
  H.ok(!has(dom, 'Credit'), 'the credit card renders nothing while the ledger is empty');

  // ONE h1 PER PAGE, and the shell already has it. Two is two claims about what
  // the page is; these are noindex, so nothing is reading them for SEO, but a
  // screen reader announces this outline.
  H.eq(D.byTag(dom.mount, 'h1').length, 0,
    'the script adds no h1 of its own — the page-header in the shell carries it');

  // ⚠ ONE CALL, NOT THREE. The dashboard asked two functions three questions
  // about one account — the participant count, the registrations and the credit
  // balance — each authenticating and each opening its own stores.
  H.eq(sent.filter((b) => b.action === 'dashboard').length, 1, 'the dashboard is one request');
  H.eq(sent.filter((b) => ['list', 'balance', 'listParticipants'].indexOf(b.action) !== -1).length, 0,
    'and none of the three it replaced is still asked');

  console.log('\n[the same screen in Hebrew]');
  dom = await screen({ view: 'account', lang: 'he' });
  H.ok(has(dom, 'שלום, Michal'), 'the greeting is Hebrew');
  H.ok(has(dom, 'המשפחה שלי'), 'and so is the family tile');
  H.ok(has(dom, 'עברית לילדים'), 'titles come through the he/en/ru fallback chain');
  H.ok(!/ילדים שלי|הילדים/.test(dom.mount.textContent), 'and nothing calls the list "my children"');
  H.eq(D.byTag(dom.mount, 'a').filter((a) => /^\/(en|ru)\//.test(a.getAttribute('href') || '')).length, 0,
    'a Hebrew reader is never linked out of the Hebrew tree');

  console.log('\n[a Russian reader stays in the Russian tree]');
  dom = await screen({ view: 'account', lang: 'ru' });
  H.ok(has(dom, 'Моя семья'), 'the family tile is Russian');
  const ruLinks = D.byTag(dom.mount, 'a').map((a) => a.getAttribute('href'));
  H.ok(ruLinks.every((h) => h.indexOf('/ru/') === 0 || h.charAt(0) === '#'),
    'and every link it draws is under /ru: ' + ruLinks.join(' '));

  console.log('\n[/account/details — your own details]');
  dom = await screen({ view: 'details', lang: 'en' });
  H.eq(D.byClass(dom.mount, 'acc-tab').length, 2, 'two tabs, not four — Ogen has no dietary or accessibility field');
  const values = D.byTag(dom.mount, 'input').map((i) => i.value);
  H.ok(values.indexOf('Michal') !== -1, 'the form opens filled in');
  H.ok(values.indexOf('michal@example.com') !== -1, 'the address is shown');
  const em = D.byTag(dom.mount, 'input').filter((i) => i.value === 'michal@example.com')[0];
  H.eq(em.getAttribute('readonly'), 'readonly',
    'and not editable — identity is an accountId, and changing the pointer is three writes with no transaction');
  H.ok(has(dom, 'contact us'), 'with a line saying what to do instead');
  H.ok(has(dom, 'Change password'), 'and the password form below it');

  console.log('\n[/account/details — the people on this account]');
  dom = await screen({ view: 'details', lang: 'en', search: '?tab=family' });
  const pills = D.byClass(dom.mount, 'is-self');
  H.eq(pills.length, 1, 'exactly one row is marked as you');
  H.eq(pills[0].textContent, 'me', 'and it says so in one word');
  H.ok(D.byClass(dom.mount, 'acc-row')[0].textContent.indexOf('Michal') === 0,
    'your own row is first — you should not have to find it');
  H.ok(has(dom, 'Add someone'), 'somebody else can be added');
  H.ok(!has(dom, 'Add myself'),
    'and "Add myself" is gone once you are on the list, because you cannot be added twice');
  H.ok(has(dom, 'Age 51') && has(dom, 'Age 9'),
    'an adult and a child are the same kind of row, differing by a derived age');

  console.log('\n[and "Add myself" is offered when you are NOT on the list]');
  dom = await screen({ view: 'details', lang: 'en', search: '?tab=family',
    api: { listParticipants: () => ({ ok: true, participants: [PARTICIPANTS[1]] }) } });
  H.ok(has(dom, 'Add myself'), 'the button is there');
  D.byClass(dom.mount, 'acc-link').filter((b) => b.textContent === 'Add myself')[0].click();
  await settle();
  const prefilled = D.byTag(dom.mount, 'input').map((i) => i.value);
  H.ok(prefilled.indexOf('Michal') !== -1 && prefilled.indexOf('Shinitzky') !== -1,
    'and it fills in the name the account already knows, rather than asking for it again');

  console.log('\n[who can see and manage a record]');
  dom = await screen({ view: 'details', lang: 'en', search: '?tab=family' });
  const noaRow = D.byClass(dom.mount, 'acc-row').filter((r) => r.textContent.indexOf('Noa') === 0)[0];
  D.byClass(noaRow, 'acc-link').filter((b) => b.textContent === 'Who can see and manage this record')[0].click();
  await settle();
  H.ok(noaRow.textContent.indexOf('Primary') !== -1, 'the primary guardian is named');
  H.ok(noaRow.textContent.indexOf('Invitation pending') !== -1, 'a pending invitation is shown');
  H.ok(noaRow.textContent.indexOf('Invite a second guardian') !== -1,
    'and the primary may invite — the server re-decides, this only avoids offering a refusal');
  // ⚠ Never on your own record. You would be handing your own attendance to
  // somebody else and losing sight of it.
  const meRow = D.byClass(dom.mount, 'acc-row').filter((r) => r.textContent.indexOf('Michal') === 0)[0];
  D.byClass(meRow, 'acc-link').filter((b) => b.textContent === 'Who can see and manage this record')[0].click();
  await settle();
  H.ok(meRow.textContent.indexOf('Remove myself from this record') === -1,
    '"remove myself" is not offered on the record that IS you');

  console.log('\n[/account/activity — a term course]');
  dom = await screen({ view: 'activity', lang: 'en', search: '?p=p-2&a=act-1' });
  H.ok(has(dom, 'Noa Levi'), 'it says who it is about');
  H.ok(has(dom, 'Wednesdays 16:00') && has(dom, 'Limassol'),
    'the public facts are there, from the same module the published page uses');
  H.ok(has(dom, '(10 sessions × 2 lessons)'), 'the price qualifier is its own quiet line');
  H.ok(has(dom, 'Still to pay'), 'and what is outstanding');
  // ROWS, NEVER A TOTAL of the yearly fee and the term price: that sum is a
  // figure nobody is ever billed. "Paid €350.00" is money actually received.
  const priceRows = D.byClass(dom.mount, 'acc-money').filter((r) => !/is-sum/.test(r.className));
  H.eq(priceRows.length, 2, 'two price rows');
  H.eq(priceRows.filter((r) => /350/.test(r.textContent)).length, 0,
    'and neither of them adds the yearly fee to the term price');
  H.ok(has(dom, 'Session 1') && has(dom, '14 October'),
    'the dates it meets on are the calendar, formatted once on the server');

  console.log('\n[/account/activity — pay per session, where "attended" lives]');
  dom = await screen({ view: 'activity', lang: 'en', search: '?p=p-1&a=act-2' });
  H.ok(has(dom, 'Attended'), 'an evening that happened says so');
  H.ok(has(dom, 'Booked'), 'one still to come says that');
  H.ok(has(dom, '6 October'), 'and the dates are in the reader\'s language');
  H.ok(has(dom, 'Cancel this session'), 'a booked evening can be given back');
  H.ok(has(dom, 'Book'), 'and an unbooked one taken');
  H.eq(D.byClass(dom.mount, 'acc-link').filter((b) => b.textContent === 'Book').length, 1,
    'exactly one evening is bookable — the two that are done or booked are not');

  console.log('\n[the same evenings in Russian]');
  dom = await screen({ view: 'activity', lang: 'ru', search: '?p=p-1&a=act-2' });
  H.ok(has(dom, '6 октября'), 'the date is Russian, from Intl rather than a second table of month names');
  H.ok(has(dom, 'Посетил(а)'), 'and the status comes from the one string table');

  console.log('\n[signed out, every signed-in view asks you in]');
  for (const v of ['account', 'details', 'activity']) {
    dom = await screen({ view: v, lang: 'en', signedIn: false });
    H.ok(has(dom, 'Sign in'), v + ': the sign-in form, not a blank page');
    H.ok(!has(dom, 'Noa'), v + ': and nothing about anybody\'s family');
  }

  console.log('\n[registering says so, and the message survives]');
  dom = await screen({ view: 'account', lang: 'en', search: '?register=hebrew' });
  H.ok(has(dom, 'Register for an activity'), 'the panel is drawn from ?register=');
  H.ok(has(dom, '4 places left'), 'with a count, never a list of who');
  H.ok(has(dom, 'Michal Shinitzky (me)'),
    'and you are in the who-is-registering list — folk dancing is not only for the kids');
  D.byTag(dom.mount, 'form')[0].submit();
  await settle();
  // A REGISTRATION, NOT A REQUEST. The confirmation says the place is taken and
  // the payment link is coming — being told a decision is pending is the shape
  // of our queue, not of what the family just did.
  H.ok(has(dom, 'Registered. We will send you a payment link shortly.'),
    'the confirmation is still on screen — rebooting the dashboard used to throw it away');

  H.done();
})();
