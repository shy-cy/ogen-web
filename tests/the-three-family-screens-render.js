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
    feeCharged: true, cancellation: { guardianMayCancel: true, total: 0 },
    // ⚠ THE CUTOFFS WERE FROZEN ON EVERY REGISTRATION SINCE PHASE 5 AND SHOWN
    // NOWHERE. A family found out there was a deadline by meeting it.
    cancellationTermsTitle: 'Cancellation terms',
    cancellationTerms: ['You can cancel this registration up to 28 October 2026.',
                        'Credit stays on your account.'] },
  { participantId: 'p-1', participantName: 'Michal Shinitzky', activityId: 'act-2', slug: 'folk',
    title: { en: 'Folk dancing', he: 'ריקודי עם', ru: 'Народные танцы' },
    type: 'dropin', groupId: null, groupName: null,
    status: 'approved', holdsASpot: true, owedCents: 5000, paidCents: 0, creditedCents: 0,
    feeCharged: true, cancellation: { guardianMayCancel: true, total: 0 } },
  { participantId: 'p-2', participantName: 'Noa Levi', activityId: 'act-3', slug: 'old',
    title: { en: 'Autumn term', he: 'סמסטר סתיו', ru: 'Осенний семестр' },
    type: 'course', status: 'cancelled', holdsASpot: false,
    owedCents: 30000, paidCents: 0, creditedCents: 0, feeCharged: false,
    cancellation: { guardianMayCancel: false } },
  // ⚠ THERE WAS NO PENDING FIXTURE, which is why the screen a family sees while
  // an admin has not answered yet was never once drawn by anything. Every row
  // here was approved or over.
  { participantId: 'p-2', participantName: 'Noa Levi', activityId: 'act-4', slug: 'drama',
    title: { en: 'Drama club', he: 'חוג דרמה', ru: 'Театральный кружок' },
    type: 'course', groupId: null, groupName: null,
    status: 'pending', holdsASpot: true, owedCents: 50000, paidCents: 0, creditedCents: 0,
    feeCharged: true, cancellation: { guardianMayCancel: true, total: 0 } }
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
      priceRows: [{ label: 'Registration fee', note: null, value: '€50' },
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
  // One call: the activity and the family list together — see the registerPanel
  // note in account-registrations.js.
  registerPanel: () => ({ ok: true,
    participants: PARTICIPANTS.map((p) => Object.assign({}, p)),
    activity: { activityId: 'act-1', slug: 'hebrew', type: 'course',
    title: { en: 'Hebrew for kids' }, left: 4, capacity: 14, taken: 10, groups: null, full: false,
    cancellationTermsTitle: 'Cancellation terms',
    cancellationTerms: ['You can cancel this registration up to 28 October 2026.',
                        'Credit stays on your account.'] } }),
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
  H.ok(/function say\(kind, text, sticky\)[\s\S]{0,420}scrollIntoView/.test(src),
    'every notice is brought into view — the button and the message are a screen apart');
  H.ok(/function say\(kind, text, sticky\)[\s\S]{0,420}aria-live/.test(src),
    'and announced, because off-screen and unannounced are the same failure twice');
  // ⚠ AND IT STILL CLEARS ITSELF BY DEFAULT. `sticky` is an opt-in for the one
  // message that has to outlast the wait it describes; every other 'ok' notice
  // goes away on its own, and a flag that reversed that default would leave
  // stale confirmations on screen across a dozen forms.
  H.ok(/if \(kind === 'ok' && !sticky\)/.test(src),
    'and an ok notice still clears itself unless a caller asks otherwise');

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
  // ⚠ THE BUTTON NAMES WHAT IS BEHIND IT. This is the only door to inviting a
  // second guardian, and it used to carry the panel's own heading — "Who can see
  // and manage this record", six words sitting next to "Edit" in a row of
  // one-word controls. The flow behind it was built, reachable and covered, and
  // THIS SUITE CLICKED IT HAPPILY — which is exactly how QA came to report "I
  // cannot find where to invite the other guardian" four times in a row against
  // a passing test. Finding a button by its text proves it exists; it can never
  // prove anybody would read it as a control.
  const opener = D.byClass(noaRow, 'acc-link').filter((b) => b.textContent === 'Guardians')[0];
  H.ok(!!opener, 'the guardian panel opens from a button that names what it opens');
  opener.click();
  await settle();
  // And the sentence is not lost — it is the panel's heading, which is where a
  // description belongs. Both halves, or the next tidy-up moves it back.
  H.ok(noaRow.textContent.indexOf('Who can see and manage this record') !== -1,
    'the description survives as the heading inside the panel');
  H.ok(noaRow.textContent.indexOf('Primary') !== -1, 'the primary guardian is named');
  H.ok(noaRow.textContent.indexOf('Invitation pending') !== -1, 'a pending invitation is shown');
  H.ok(noaRow.textContent.indexOf('Invite a second guardian') !== -1,
    'and the primary may invite — the server re-decides, this only avoids offering a refusal');
  // ⚠ Never on your own record. You would be handing your own attendance to
  // somebody else and losing sight of it.
  const meRow = D.byClass(dom.mount, 'acc-row').filter((r) => r.textContent.indexOf('Michal') === 0)[0];
  // ⚠ AND THE CONTROL IS NOT CALLED "GUARDIANS" HERE. The panel behind it is
  // the same one and belongs on this row — inviting somebody to co-manage your
  // own attendance is a state `isSelf`-on-the-link exists to hold — but an
  // adult holding the account is nobody's ward, and the row had just stopped
  // calling anybody a child one heading above.
  H.eq(D.byClass(meRow, 'acc-link').filter((b) => b.textContent === 'Guardians').length, 0,
    'your own row does not offer you "Guardians"');
  const access = D.byClass(meRow, 'acc-link').filter((b) => b.textContent === 'Access')[0];
  H.ok(access, 'it names what the panel is instead');
  access.click();
  await settle();
  H.ok(meRow.textContent.indexOf('Who can see and manage this record') !== -1,
    'and the panel is the same one, with its description as its heading');
  H.ok(meRow.textContent.indexOf('Invite a second guardian') === -1,
    'the invite inside it does not call the account holder a ward either');
  H.ok(meRow.textContent.indexOf('Invite someone to manage this record') !== -1,
    'it asks for somebody to manage the record');
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
  // ⚠ AND UNTIL WHEN THEY CAN GET OUT OF IT. This is the page a family comes
  // back to six weeks later, and the deadline was nowhere on it.
  H.ok(has(dom, 'Cancellation terms'), 'the frozen cancellation terms are on the page');
  H.ok(has(dom, 'up to 28 October 2026'), 'naming the date rather than implying one');
  H.eq(D.byClass(dom.mount, 'acc-terms').length, 1, 'once, as small print');
  H.eq(D.byClass(dom.mount, 'acc-notice').length, 0,
    'and NOT as a notice — a tinted panel with a rule means something is wrong');

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

  console.log('\n[registering happens on the activity page, and the page becomes the registration]');
  // ⚠ NOT ON THE DASHBOARD. The panel sat at the top of a page headed "My
  // family", which is what made the family area look like the place
  // registration lives. The dashboard answers "what am I in" and "what else is
  // there"; a form for joining one particular activity is neither.
  dom = await screen({ view: 'account', lang: 'en', search: '?register=hebrew' });
  H.ok(!has(dom, 'Register for an activity'),
    'the dashboard draws no register panel, even when the query asks for one');
  H.ok(has(dom, 'My activities'), 'it is the list and the way out, and nothing else');

  dom = await screen({ view: 'activity', lang: 'en', search: '?register=hebrew' });
  H.ok(has(dom, 'Register for an activity'), 'the panel is drawn from ?register=');
  H.ok(has(dom, '4 places left'), 'with a count, never a list of who');
  // ⚠ SAID BEFORE THE BUTTON, not by the refusal that applies it.
  H.ok(has(dom, 'Cancellation terms') && has(dom, 'up to 28 October 2026'),
    'the register panel says what cancelling will be worth before anybody commits');
  H.ok(has(dom, 'Michal Shinitzky (me)'),
    'and you are in the who-is-registering list — folk dancing is not only for the kids');
  D.byTag(dom.mount, 'form')[0].submit();
  await settle();
  // ⚠ THE URL BECAME THE REGISTRATION'S OWN KEY, and the page was drawn again
  // from it. Not a notice sitting where a form was: the question a family has
  // the instant they press Register is "what happens now", and that is answered
  // by the registration page, not by the form they just used.
  H.ok(/[?&]p=p-2/.test(dom.window.location.search), 'the query carries the participant');
  H.ok(/[?&]a=act-1/.test(dom.window.location.search), 'and the activity');
  H.ok(!has(dom, 'Who is registering?'), 'and the form is gone — it cannot outlive the errand');
  // A REGISTRATION, NOT A REQUEST. The confirmation says the place is taken and
  // where to pay for it — being told a decision is pending is the shape of our
  // queue, not of what the family just did. It no longer promises a LINK
  // either: a pending registration is payable, so the payment is already on the
  // page rather than waiting on an admin reaching the queue.
  H.ok(has(dom, 'Registered. The details and the payment are on the registration page.'),
    'the confirmation is still on screen — rebooting the dashboard used to throw it away');

  console.log('\n[registered, and payment not yet open — the waiting state]');
  // ⚠ EXECUTED, not read. The words are one half; the other half is that the
  // branch runs at all, draws its glyph, and puts the participant's name in the
  // sentence rather than the literal {name}.
  dom = await screen({ view: 'activity', lang: 'en', search: '?p=p-2&a=act-4' });
  H.ok(has(dom, 'Registered — payment opens soon'), 'the lead says registered FIRST, then what is next');
  H.ok(has(dom, 'Noa Levi is registered.'), 'and the sentence names the participant');
  H.ok(!has(dom, '{name}'), 'the placeholder was filled, not printed');
  H.ok(!has(dom, 'Pay securely'), 'there is no pay button — nobody has agreed to the place yet');
  // None of the words a family must not be handed about their own registration.
  ['pending', 'awaiting', 'request', 'approval'].forEach((w) => {
    H.ok(!new RegExp(w, 'i').test(dom.mount.textContent),
      'and it never says "' + w + '" — that is the shape of our queue, not of what they did');
  });
  const tick = D.byTag(dom.mount, 'svg')[0];
  H.ok(tick, 'the check is drawn');
  H.eq(tick.namespaceURI, 'http://www.w3.org/2000/svg',
    'in the SVG namespace — createElement would make an HTMLUnknownElement that renders nothing');
  H.eq(tick.getAttribute('aria-hidden'), 'true', 'and hidden from a screen reader, which has the words');

  // The same state in Hebrew, because the copy carries a gender-neutral form
  // lifted from the email module and a placeholder that has to survive RTL.
  dom = await screen({ view: 'activity', lang: 'he', search: '?p=p-2&a=act-4' });
  H.ok(has(dom, 'ההרשמה בוצעה — התשלום ייפתח בקרוב'), 'the Hebrew lead');
  // The NAME is not translated — it is whatever the family typed, in whatever
  // script they typed it in, and it appears verbatim in all three trees.
  H.ok(has(dom, 'Noa Levi נרשם/ה.'), 'and the gender-neutral form the emails already use');

  console.log('\n[coming back from a completed Checkout]');
  // ⚠ THE PAGE SAID NOTHING. Stripe redirects to ?paid=<kind> and nothing read
  // it, so a family who had just paid €350 landed on a card reading "Still to
  // pay €350.00" with no acknowledgement — which is indistinguishable from a
  // payment that failed. And the redirect fires the moment the card clears,
  // routinely BEFORE the webhook that settles the record, so simply printing
  // "paid" would have been the other half of the same lie.
  dom = await screen({ view: 'activity', lang: 'en', search: '?p=p-2&a=act-1&paid=registration' });
  H.ok(has(dom, 'Payment received. Thank you!'),
    'a payment already settled when the reader arrives is acknowledged at once');
  H.ok(!/paid=/.test(dom.window.location.search),
    'and the parameter is dropped, so a reload does not announce the same payment again');

  // Nothing owed on the record yet: the webhook has not landed. The page must
  // say so rather than show the old figure in silence.
  dom = await screen({ view: 'activity', lang: 'en', search: '?p=p-2&a=act-4&paid=registration' });
  H.ok(has(dom, 'Payment received'), 'an unsettled one is acknowledged too');
  H.ok(has(dom, 'we are recording it'), 'and says the figures are about to move');
  H.ok(!has(dom, 'Thank you!'), 'without claiming it is done');
  H.ok(/paid=/.test(dom.window.location.search),
    'and keeps the parameter while it waits, so a redraw re-enters the wait');

  // The ordinary visit, which is every visit but one.
  dom = await screen({ view: 'activity', lang: 'en', search: '?p=p-2&a=act-1' });
  H.ok(!has(dom, 'Payment received'), 'a page opened without the parameter says nothing about payment');

  // The kind travels because the three settle in three different places, and a
  // page that guessed would watch the wrong one.
  const checkout = read('netlify/functions/_checkout.js');
  H.ok(/withPaid\(back, \(meta && meta\.ogen_kind\) \|\| '1'\)/.test(checkout),
    'the success URL names what was paid for, from the webhook\'s own discriminator');

  // ⚠ AND IT LANDS IN THE QUERY, NOT THE FRAGMENT.
  //
  // returnUrl() ends in `#pay`, and the marker used to be appended to the whole
  // string — which put it INSIDE THE HASH:
  //
  //     /account/activity?p=…&a=…#pay&paid=registration
  //
  // param() reads location.search, so it found nothing, paidWatch() bailed on
  // its first line, and a family came back from a completed Checkout to a page
  // that acknowledged nothing at all. The marker then sat in the address bar for
  // good, because the only thing that removes it is the acknowledgement that
  // never ran — which is how QA found it.
  //
  // Nothing about it read wrong: every string involved is correct on its own,
  // and the figures were usually right by the time anybody looked, so the screen
  // was merely silent about a payment just made. That is the exact failure the
  // parameter exists to prevent. EXECUTED, because reading cannot catch it.
  const withPaid = (() => {
    const a = checkout.indexOf('function withPaid(');
    const b = checkout.indexOf('\n}', a) + 2;
    const ctx = { out: null };
    vm.createContext(ctx);
    vm.runInContext(checkout.slice(a, b) + '\nout = withPaid;', ctx);
    return ctx.out;
  })();
  [['https://www.ogen.cy/account/activity?p=1&a=2#pay', 'registration'],
   ['https://www.ogen.cy/en/account/activity?p=1&a=2', 'session'],
   ['https://www.ogen.cy/ru/account/activity', 'bundle']].forEach(([back, kind]) => {
    H.eq(new URL(withPaid(back, kind)).searchParams.get('paid'), kind,
      kind + ': the marker is in the query, which is the only place param() looks');
  });
  H.eq(new URL(withPaid('https://www.ogen.cy/account/activity?p=1&a=2#pay', 'registration')).hash,
    '#pay', 'and the fragment it used to hide in is still there');
  H.ok(/registration: \{ read: owedOnReg, falls: true \}/.test(memberAccount),
    'a registration debt is watched by the figure falling');
  H.ok(/bundle: \{ read: bundleCount, falls: false \}/.test(memberAccount),
    'and a bundle by the list changing — it has no figure to fall');
  H.ok(/if \(paidTries >= PAID_TRIES\)/.test(memberAccount),
    'the wait is bounded rather than polling for ever');

  console.log('\n[the family area answers "what else is there", not only "what am I in"]');
  // ⚠ IT HAD NO ANSWER AT ALL. The dashboard listed what you are registered to
  // and offered no route to anything new — the only way to the listing was the
  // nav of some other page. The register PANEL is not that route and must not
  // become it: it is drawn from ?register= alone, because registering belongs on
  // an activity page, where the description, the price and the dates are. This
  // is a link out.
  dom = await screen({ view: 'account', lang: 'en' });
  H.ok(!has(dom, 'Register for an activity'),
    'arriving with no ?register= draws no registration form — this is the family area');
  const browse = D.byTag(dom.mount, 'a').filter((a) => /See all activities/.test(a.textContent))[0];
  H.ok(browse, 'and there is a link to the activities listing');
  H.eq(browse.getAttribute('href'), '/en/activities', 'in the reader\'s own tree');

  // With nothing registered it is the whole answer, so it has to be there too —
  // that is the screen where "what else is there" is the ONLY question.
  dom = await screen({ view: 'account', lang: 'en',
                       api: { dashboard: () => ({ ok: true, registrations: [], participantCount: 1,
                                                  balanceCents: 0, entries: [] }) } });
  H.ok(has(dom, 'No registrations yet.'), 'an empty list says so');
  H.ok(D.byTag(dom.mount, 'a').some((a) => /See all activities/.test(a.textContent)),
    'and still offers the way to find one');

  // Russian, because the link is built from the tree prefix rather than a
  // hardcoded path, and that is exactly the kind of thing that works in Hebrew
  // and sends a Russian reader into the default tree.
  dom = await screen({ view: 'account', lang: 'ru' });
  const ruBrowse = D.byTag(dom.mount, 'a').filter((a) => /Все занятия/.test(a.textContent))[0];
  H.ok(ruBrowse, 'the Russian dashboard has it too');
  H.eq(ruBrowse.getAttribute('href'), '/ru/activities', 'pointing inside the Russian tree');

  H.done();
})();
