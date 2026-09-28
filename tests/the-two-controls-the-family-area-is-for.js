// What this defends against:
//
// The activity page's own register button sat 2651px into a 4342px page, and a
// pinned copy fixed it. The family area has exactly the same shape twice, and
// for a release it had neither. Measured with the real client laid out in Chrome
// at 375x680:
//
//   the drop-in register panel, ten evenings   1264px of 2111px   1.9 screens
//   the registration page's Pay button         1358px of 2926px   2.0 screens
//   the COURSE register panel                   606px of 1543px   0.9 screens
//
// ⚠ AND THE THIRD ONE DELIBERATELY DOES NOT GET ONE. It is a person select, a
// group select and a button; the control is at the fold already, so a fixed bar
// there would cost 74px of viewport to save a scroll nobody makes. "Put it
// everywhere" is the version of this that turns a fix into furniture.
//
// ⚠ THE PINNED CONTROL IS THE SAME BUTTON, NOT A SECOND ONE. The static page's
// bar is built from an href and a label passed in, which is right there because
// a link needs a target and deriving one twice is how ctaUrl went wrong twice.
// Nothing here has a target — these buttons run a submit handler — so the copy
// carries no behaviour of its own and calls real.click(). One code path for
// booking and one for paying, however the family reached it.
//
// ⚠ AND THE LABEL IS LIVE, WHICH THE STATIC PAGE'S NEVER IS. The drop-in button
// IS the running total, recomputed on every tick, and both buttons relabel while
// Checkout is opening. A copy built once from a string would be a fixed bar
// quoting a price the page has stopped charging. So it mirrors through a
// MutationObserver rather than a call from each place that retotals — retotal()
// and busy() have several callers each, and the one that forgot would be silent.
//
// The suite EXECUTES all of it. Reading the source would prove the source is
// self-consistent, which is what let a hidden Register button ship.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_helpers');
const D = require('./_dom');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const memberSession = read('js/member-session.js');
const memberAccount = read('js/member-account.js');
const client = read('js/member-account.js');
const css = read('shared.css');

const ACCOUNT = { accountId: 'a-1', email: 'm@e.com', emailVerifiedAt: '2026-01-01T00:00:00Z',
  profile: { firstName: 'Michal', lastName: 'Shinitzky', preferredLanguage: 'he' } };
const PEOPLE = [
  { participantId: 'p-2', firstName: 'Noa', lastName: 'Levi',
    dateOfBirth: '2017-04-02', age: 9, isSelf: false, isPrimary: true }
];
const REG = { participantId: 'p-2', participantName: 'Noa Levi', activityId: 'act-1',
  slug: 'hebrew', title: { he: 'עברית לילדים' }, type: 'course', groupId: null, groupName: null,
  status: 'approved', holdsASpot: true, owedCents: 35000, paidCents: 5000, creditedCents: 0,
  feeCharged: true, cancellation: { guardianMayCancel: true, total: 0 } };
const ACT = { activityId: 'act-1', slug: 'hebrew', type: 'course', title: REG.title,
  facts: [], priceRows: [{ label: 'עלות לסמסטר', note: null, value: '€ 300' }], sessionRows: [] };

const DATES = ['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27'];
const evenings = () => DATES.map((d, i) => ({ date: d, left: 5, capacity: 20, full: false,
  status: null, priceCents: 700, priceBasis: 'standard', standardPriceCents: 700, past: false }));

const sent = [];
const ANSWERS = {
  me: () => ({ ok: true, account: ACCOUNT, expiresAt: Date.now() + 1e7 }),
  registration: () => ({ ok: true, registration: REG, activity: ACT, balanceCents: 10000 }),
  useCredit: () => ({ ok: true, balanceCents: 5000 }),
  // The course panel: one select and a button.
  registerPanel: () => ({ ok: true, participants: PEOPLE, registered: {},
    activity: { activityId: 'act-1', slug: 'hebrew', type: 'course', title: REG.title,
                left: 13, capacity: 14, taken: 1, groups: null, full: false } }),
  bookAndPay: () => ({ ok: true, url: 'https://checkout.stripe.com/x' })
};
const DROPIN = {
  registerPanel: () => ({ ok: true, participants: PEOPLE, registered: {},
    activity: { activityId: 'act-2', slug: 'folk', type: 'dropin', perSession: true,
                title: { he: 'ריקודי עם' }, left: 13, capacity: 14, taken: 1,
                groups: null, full: false },
    sessions: { participantId: 'p-2', mayBook: true, sessions: evenings() } }),
  sessions: () => ({ ok: true, mayBook: true, participantId: 'p-2', sessions: evenings() })
};

function fetchFor(extra) {
  const a = Object.assign({}, ANSWERS, extra || {});
  return (endpoint, init) => {
    const body = JSON.parse(init.body);
    sent.push(body);
    const fn = a[body.action];
    if (!fn) return Promise.reject(new Error('no canned answer for "' + body.action + '"'));
    return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve(fn(body)) });
  };
}

const settle = () => new Promise((r) => setTimeout(r, 40));

async function screen(search, extra, domOpts) {
  const dom = D.makeDom(Object.assign({ fetch: fetchFor(extra), view: 'activity', lang: 'he',
    search: search, ids: ['page'] }, domOpts || {}));
  dom.window.localStorage.setItem('ogenMemberSession', JSON.stringify({
    token: 't', firstName: 'Michal', email: ACCOUNT.email, expiresAt: Date.now() + 1e7 }));
  const ctx = vm.createContext({ window: dom.window, document: dom.document, console: console,
    // Checkout is a redirect, not a fetch — the booking path ends by assigning
    // location.href, which is what the press below has to be able to reach.
    location: dom.window.location,
    Intl: Intl, Date: Date, Math: Math, JSON: JSON, Object: Object, Array: Array, String: String,
    Number: Number, RegExp: RegExp, Promise: Promise, setTimeout: setTimeout,
    encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent });
  vm.runInContext(memberSession, ctx, { filename: 'js/member-session.js' });
  vm.runInContext(memberAccount, ctx, { filename: 'js/member-account.js' });
  await settle();
  return dom;
}

const bars = (dom) => D.byClass(dom.byId('page'), 'activity-sticky');
const only = (dom) => { const b = bars(dom); return b.length === 1 ? b[0] : null; };
const copyIn = (bar) => D.byTag(bar, 'button')[0];
// The screen's own button, the one the bar is a copy of.
const realIn = (dom, label) => D.byTag(dom.mount, 'BUTTON')
  .filter((b) => b.textContent.indexOf(label) !== -1)[0];

(async () => {
  // -------------------------------------------------------------------------
  console.log('[the drop-in register panel gets one]');
  {
    const dom = await screen('?register=folk', DROPIN);
    const bar = only(dom);
    H.ok(bar, 'exactly one bar is drawn');
    H.eq(bar.attributes.hidden != null, true,
      '⚠ and it starts HIDDEN — the real button is on screen at the top of the page');
    H.eq(bar.parentNode.attributes.id, 'page',
      '⚠ inside #page, which is the only element on this site carrying dir');

    const copy = copyIn(bar);
    H.eq(copy.attributes.type, 'button',
      '⚠ type="button" — a submit inside no form does nothing, and the copy submits '
      + 'by pressing the real control rather than by being one');
    const real = realIn(dom, '·');
    H.ok(real, 'the real button is the running total: ' + real.textContent);

    // ⚠ THE FIRST MIRROR IS ALREADY STALE, AND THAT IS THE POINT. The panel
    // builds the button, pins it, and only THEN fetches the evenings and
    // retotals — so the copy is created reading "Register and pay" with no
    // figure on it. A browser delivers the mutation a microtask later; this
    // shim records observers rather than imitating them, so the test fires it.
    H.ok(copy.textContent.indexOf('€') === -1,
      'the copy was made before the total existed: ' + copy.textContent);
    dom.eyes('mutation').forEach((o) => o.cb([]));
    H.eq(copy.textContent, real.textContent, 'and the mirror catches it up');
    H.eq(copy.disabled, real.disabled,
      '⚠ including whether it is live — the panel enables the button when the '
      + 'next date arrives ticked, and a pinned copy still disabled would be a '
      + 'dead control the reader cannot scroll away from');

    // ⚠ AND IT KEEPS UP. Tick another evening and the real button retotals; a
    // copy built once from a string would go on quoting the old figure, which is
    // a fixed bar naming a price the page has stopped charging.
    const before = real.textContent;
    const boxes = D.all(dom.mount, (n) => n.tagName === 'INPUT'
      && n.attributes.type === 'checkbox' && !n._checked);
    H.ok(boxes.length, 'there is an unticked evening to add');
    boxes[0].click();
    H.ok(real.textContent !== before,
      'the real total moved: ' + before + ' -> ' + real.textContent);
    H.eq(copy.textContent, before, 'the copy has not moved on its own — nothing is magic');
    dom.eyes('mutation').forEach((o) => o.cb([]));
    H.eq(copy.textContent, real.textContent,
      '⚠ and the mirror carries it across: ' + copy.textContent);
    H.ok(copy.textContent.indexOf('14.00') !== -1, 'the new total, not the old one');

    // ⚠ AND THE DEAD STATE TRAVELS. Untick everything and the real button
    // disables itself; a copy that mirrored only the words would be a live pill
    // pinned to the bottom of the viewport offering to charge nothing. Checked
    // in the state where the two actually differ — comparing them while both
    // happen to be enabled passes on a copy that never reads the flag at all.
    const ticked = D.all(dom.mount, (n) => n.tagName === 'INPUT'
      && n.attributes.type === 'checkbox' && n._checked);
    ticked.forEach((b) => b.click());
    H.eq(real.disabled, true, 'nothing ticked: the real button is dead');
    dom.eyes('mutation').forEach((o) => o.cb([]));
    H.eq(copy.disabled, true, '⚠ and so is the copy');
    ticked.forEach((b) => b.click());
    dom.eyes('mutation').forEach((o) => o.cb([]));
    H.eq(copy.disabled, false, 'and both come back');

    // ⚠ ONLY WHILE THE REAL ONE IS OFF SCREEN. Two solid terracotta pills at
    // once is the pairing the credit block was rebuilt to avoid.
    const io = dom.eyes('intersection')[0];
    H.ok(io, 'the real button is watched');
    H.ok(io.targets[0] === real, 'and it is the REAL button being watched, not the copy');

    // ⚠ AND THE MIRROR IS ATTACHED TO IT TOO. An observer constructed and
    // never pointed at anything is the shape that reads correct and does
    // nothing — the pure bundle module wired to nothing, one layer in.
    const mo = dom.eyes('mutation')[0];
    H.ok(mo && mo.targets[0] === real, 'the mirror watches the real button');
    io.cb([{ isIntersecting: false }]);
    H.eq(bar.attributes.hidden == null, true, 'scrolled away: the bar appears');
    io.cb([{ isIntersecting: true }]);
    H.eq(bar.attributes.hidden != null, true, 'back in view: the bar goes again');

    // ⚠ PRESSING THE COPY RUNS THE REAL ACTION. Not a second handler that has to
    // stay in step with the first — the same submit, reached by pressing the
    // same control, which is what makes "one code path" a property rather than
    // a promise.
    io.cb([{ isIntersecting: false }]);
    sent.length = 0;
    copy.click();
    await settle();
    const booked = sent.filter((b) => b.action === 'bookAndPay')[0];
    H.ok(booked, '⚠ the copy booked, through the panel’s own submit handler');
    H.eq(booked.sessionDates.length, 2, 'with both ticked evenings on it');
    H.eq(dom.window.location.href, 'https://checkout.stripe.com/x',
      '⚠ and carried the family all the way to Checkout — the whole path ran, '
      + 'not a handler that happened to fire');
  }

  // -------------------------------------------------------------------------
  console.log('\n[the registration page’s Pay button gets one]');
  {
    const dom = await screen('?p=p-2&a=act-1');
    const bar = only(dom);
    H.ok(bar, 'exactly one bar');
    const real = realIn(dom, 'תשלום');
    H.ok(real, 'the real Pay button is there');
    H.eq(copyIn(bar).textContent, real.textContent, 'and the copy says the same');

    // ⚠ THE PRIMARY ONLY. "Use credit" is .btn-secondary, an outlined peer one
    // rank down — paying is what the card is for, and two pinned controls would
    // be the choice this bar exists to avoid.
    H.eq(D.byTag(bar, 'button').length, 1, 'one control in the bar, not two');
    H.ok((copyIn(bar).className || '').indexOf('btn-primary') !== -1,
      'and it is the primary');

    // ⚠ ONE BAR ACROSS A REDRAW. It lives in #page, outside the mount, so
    // clear(mount) does not reach it — and renderActivity() runs again after
    // every booking, cancellation and payment. Without dropSticky() they stack.
    const credit = D.byTag(dom.mount, 'BUTTON')
      .filter((b) => (b.className || '').indexOf('btn-secondary') !== -1)[0];
    H.ok(credit, 'the credit button is on the card');
    credit.click();
    await settle();
    H.eq(bars(dom).length, 1, '⚠ still exactly one bar after the screen redrew');
    H.ok(bars(dom)[0] !== bar, 'and it is the new screen’s, not the old one’s');
    H.ok(bar.parentNode === null, 'the old one is off the page, not stacked behind it');
    H.eq(dom.eyes('intersection').length, 1,
      '⚠ and the old observers were disconnected, not left watching a detached button');
  }

  // -------------------------------------------------------------------------
  console.log('\n[⚠ and the course register panel gets NONE]');
  {
    const dom = await screen('?register=hebrew');
    H.ok(realIn(dom, 'הרשמה'), 'its Register button is drawn');
    H.eq(bars(dom).length, 0,
      '⚠ and no bar: the control is at the fold already, and a fixed bar would '
      + 'cost 74px of viewport to save a scroll nobody makes');
  }

  // -------------------------------------------------------------------------
  console.log('\n[it fails open]');
  {
    // No observers at all — an older browser, or the DOM this is tested in
    // before it grew them. No bar, and the page is exactly as it was.
    const dom = D.makeDom({ fetch: fetchFor(DROPIN), view: 'activity', lang: 'he',
                            search: '?register=folk', ids: ['page'] });
    delete dom.window.IntersectionObserver;
    dom.window.localStorage.setItem('ogenMemberSession', JSON.stringify({
      token: 't', firstName: 'Michal', email: ACCOUNT.email, expiresAt: Date.now() + 1e7 }));
    const ctx = vm.createContext({ window: dom.window, document: dom.document, console: console,
      location: dom.window.location,
      Intl: Intl, Date: Date, Math: Math, JSON: JSON, Object: Object, Array: Array,
      String: String, Number: Number, RegExp: RegExp, Promise: Promise, setTimeout: setTimeout,
      encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent });
    vm.runInContext(memberSession, ctx, { filename: 'js/member-session.js' });
    vm.runInContext(memberAccount, ctx, { filename: 'js/member-account.js' });
    await settle();
    H.eq(bars(dom).length, 0, 'no IntersectionObserver means no bar');
    H.ok(realIn(dom, '·'), 'and the panel itself is untouched');
  }

  // -------------------------------------------------------------------------
  console.log('\n[the bar sizes both controls from one rule]');

  // ⚠ ONE RULE, TWO CLASSES. The static page pins a .sidebar-cta and this pins a
  // .btn-primary; sizing them separately would be the bar's own arithmetic
  // written twice, and that height has already been wrong once by 2px.
  const at939 = css.indexOf('@media (max-width:939px)');
  const inner = css.slice(css.indexOf('.activity-sticky .sidebar-cta{', at939),
                          css.indexOf('}', css.indexOf('.activity-sticky .sidebar-cta{', at939)));
  H.ok(inner, 'the bar has a rule for the control inside it');
  H.ok(css.slice(at939).indexOf('.activity-sticky .btn-primary') !== -1,
    '⚠ and .btn-primary is sized by it too');
  H.ok(/display:block/.test(inner) && /width:100%/.test(inner),
    'which fills the bar — .btn-primary is an inline-block pill everywhere else');
  H.ok(/height:\s*calc\(var\(--sticky-h\)/.test(inner.replace(/\s+/g, ' ')),
    'from the same token the bar reads for its own height');

  // The two call sites, and the one that is deliberately absent. Executed above;
  // this is what makes a third call site a decision somebody writes down.
  H.eq((client.match(/stickyPress\(/g) || []).length, 3,
    'one definition and exactly two callers');
  const term = client.slice(client.indexOf('function registerTerm('),
                            client.indexOf('function registerPerSession('));
  H.ok(term.indexOf('stickyPress(') === -1,
    '⚠ and the course panel is not one of them');

  H.done();
})();
