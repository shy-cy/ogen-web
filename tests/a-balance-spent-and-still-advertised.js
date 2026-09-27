// What this defends against:
//
// ⚠ THE FAMILY'S PAGE HELD A BALANCE FROM PAGE LOAD AND SPENT IT WITHOUT EVER
// ASKING AGAIN.
//
// A drop-in's evenings each carry their own controls, and an unpaid one offers
// "Use credit · €7.00" when the account holds any. The figure arrives once, with
// the `registration` call, and `renderEvenings` re-fetches only the EVENINGS —
// so the moment one row spent the whole balance, every other row went on
// offering the same €7.00 out of an account holding nothing.
//
// Reported from a phone: "I see credit - but there is no credit." The ledger
// agreed with the refusal, to the second: a €7.00 credit at 15:23 and a €7.00
// debit at 15:49, with the screenshot at 15:50. The server was right every time
// and the screen was a minute out of date.
//
// It is the family-area twin of a rule the admin already keeps — "the row in
// hand is stale the moment the payment lands, so both money actions hand back
// the record they just wrote". Here BOTH actions already answered with the new
// balance (`useCredit` as `balanceCents`, `cancelSession` as `balance`) and the
// screen read neither.
//
// The refusal carries the figure too, and that is the half worth keeping: it is
// the one moment we know for certain the screen is wrong.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_helpers');
const D = require('./_dom');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const memberSession = read('js/member-session.js');
const memberAccount = read('js/member-account.js');

const ACCOUNT = { accountId: 'a-1', email: 'dana@example.com',
                  emailVerifiedAt: '2026-01-01T00:00:00Z',
                  profile: { firstName: 'Dana', preferredLanguage: 'en' } };
const REG = { participantId: 'p-1', participantName: 'Noa Levi', activityId: 'act-2',
              slug: 'folk', title: { en: 'Folk dancing' }, type: 'dropin',
              groupId: null, groupName: null, status: 'approved', holdsASpot: true,
              owedCents: 0, paidCents: 0, creditedCents: 0, feeCharged: false,
              cancellation: { guardianMayCancel: true, total: 0 } };
const ACTIVITY = { activityId: 'act-2', slug: 'folk', type: 'dropin',
                   title: { en: 'Folk dancing' }, facts: [], priceRows: [], sessionRows: [] };

// ⚠ AND THE OTHER CALLER, which is the one the ordering of the message turns on.
// A COURSE owes on the registration itself, so its credit control is the block
// on the cost card — whose `onDone` is renderActivity(), which replaces the very
// node `say()` writes into. The evenings' own `onDone` repaints one panel and
// leaves the notice alone, so nothing above this line can see the difference.
const COURSE = { participantId: 'p-1', participantName: 'Noa Levi', activityId: 'act-3',
                 slug: 'hebrew', title: { en: 'Hebrew for kids' }, type: 'course',
                 groupId: null, groupName: null, status: 'approved', holdsASpot: true,
                 owedCents: 5500, paidCents: 0, creditedCents: 0, feeCharged: true,
                 cancellation: { guardianMayCancel: true, total: 0 } };
const COURSE_ACT = { activityId: 'act-3', slug: 'hebrew', type: 'course',
                     title: { en: 'Hebrew for kids' }, facts: [], priceRows: [],
                     sessionRows: [] };

// Two unpaid evenings at €7.00 each, so one can be settled and the other watched.
const evenings = () => ({ ok: true, mayBook: true, registrationStatus: 'approved', sessions: [
  { date: '2026-10-12', left: 5, capacity: 20, full: false, status: 'booked',
    owedCents: 700, paidCents: 0, cancellation: { mayCancel: true, credit: 700 } },
  { date: '2026-10-19', left: 5, capacity: 20, full: false, status: 'booked',
    owedCents: 700, paidCents: 0, cancellation: { mayCancel: true, credit: 700 } }
] });

const settle = () => new Promise((r) => setTimeout(r, 30));

// The page, opened on one registration, with whatever balance and whatever the
// money actions are going to answer.
async function page(opts) {
  const answers = Object.assign({
    me: () => ({ ok: true, account: ACCOUNT, expiresAt: Date.now() + 1e7 }),
    registration: () => ({ ok: true, registration: opts.reg || REG,
                           activity: opts.activity || ACTIVITY,
                           balanceCents: opts.balanceCents,
                           perSession: (opts.reg || REG).type === 'dropin' ? evenings() : null }),
    sessions: () => evenings(),
    bundles: () => ({ ok: true, held: [], offers: [] })
  }, opts.api || {});
  const dom = D.makeDom({ view: 'activity', lang: 'en',
    search: '?p=p-1&a=' + ((opts.reg || REG).activityId),
    fetch: function (endpoint, init) {
      const body = JSON.parse(init.body);
      const fn = answers[body.action];
      if (!fn) return Promise.reject(new Error('no canned answer for "' + body.action + '"'));
      const out = fn(body);
      return Promise.resolve({ status: out._status || 200,
        ok: out._status ? out._status < 400 : true, json: () => Promise.resolve(out) });
    } });
  dom.window.localStorage.setItem('ogenMemberSession', JSON.stringify({
    token: 't', firstName: 'Dana', email: ACCOUNT.email, expiresAt: Date.now() + 1e7 }));
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

// Every "Use credit" control currently on screen.
const creditButtons = (dom) => {
  const out = [];
  (function walk(n) {
    if (n.tagName === 'BUTTON' && /Use credit/.test(n.textContent || '')) out.push(n);
    (n.childNodes || []).forEach(walk);
  })(dom.mount);
  return out;
};

(async () => {
  console.log('[with a balance, every unpaid evening offers it]');
  let dom = await page({ balanceCents: 700 });
  H.eq(creditButtons(dom).length, 2, 'two unpaid evenings, two offers');
  H.ok(/Use credit · €7\.00/.test(dom.mount.textContent), 'and each names the figure');

  // ------------------------------------------------------------------------
  // ⚠ THE BUG. One row spends the whole balance; the other must stop offering
  // it. Before this, the second button survived the redraw and the family met a
  // refusal they could not account for.
  console.log('\n[spending it on one evening takes it off the others]');
  let spent = 0;
  dom = await page({ balanceCents: 700, api: {
    useCredit: () => { spent += 1; return { ok: true, spentCents: 700, balanceCents: 0 }; },
    // The evening it settled now reads as paid, which is what the server would
    // say; the OTHER one is untouched and still owes €7.00.
    sessions: () => { const e = evenings();
      if (spent) { e.sessions[0].paidCents = 700; e.sessions[0].cancellation = { mayCancel: true, credit: 700 }; }
      return e; }
  } });
  H.eq(creditButtons(dom).length, 2, 'both offered before the press');
  creditButtons(dom)[0].click();
  await settle();
  H.eq(spent, 1, 'useCredit was called once');
  H.eq(creditButtons(dom).length, 0,
    '⚠ and NOTHING offers credit any more — the balance came back as 0 and was believed');

  // ------------------------------------------------------------------------
  // ⚠ THE REFUSAL CARRIES IT TOO. A screen that is already wrong is exactly the
  // one that must not be left offering the same button to press again.
  console.log('\n[a refusal that names the balance also corrects the screen]');
  dom = await page({ balanceCents: 700, api: {
    useCredit: () => ({ _status: 409, error: 'There is no credit on this account.',
                        reason: 'no-credit', balanceCents: 0 })
  } });
  H.eq(creditButtons(dom).length, 2, 'offered before the press');
  creditButtons(dom)[0].click();
  await settle();
  H.eq(creditButtons(dom).length, 0, 'and gone afterwards rather than left to be pressed again');
  H.ok(/no credit on this account/.test(dom.mount.textContent),
    'with the refusal still on screen — said AFTER the redraw, or it is thrown away by it');

  // ------------------------------------------------------------------------
  // The other direction, which the same staleness broke silently: cancelling an
  // evening is what WRITES a credit, so rows that could not offer it now can.
  console.log('\n[cancelling an evening puts the credit back on the other rows]');
  let cancelled = 0;
  dom = await page({ balanceCents: 0, api: {
    cancelSession: () => { cancelled += 1;
      return { ok: true, credit: { credit: 700 }, balance: 700 }; },
    sessions: () => { const e = evenings();
      if (cancelled) { e.sessions[0].status = 'cancelled';
                       e.sessions[0].cancellation = null; }
      return e; }
  } });
  H.eq(creditButtons(dom).length, 0, 'nothing on offer while the account holds nothing');
  const cancels = [];
  (function walk(n) {
    if (n.tagName === 'BUTTON' && /Cancel this session/.test(n.textContent || '')) cancels.push(n);
    (n.childNodes || []).forEach(walk);
  })(dom.mount);
  H.ok(cancels.length > 0, 'there is a cancel control');
  cancels[0].click();
  // ⚠ The dialog is OURS, not window.confirm, and it mounts inside the page
  // rather than on <body> — #page owns the direction, so the two buttons read in
  // the right order in all three languages. So it is found where it lives.
  await settle();
  const yes = [];
  (function walk(n) {
    if (n.tagName === 'BUTTON' && /Cancel this session/.test(n.textContent || '')) yes.push(n);
    (n.childNodes || []).forEach(walk);
  })(dom.mount);
  H.ok(yes.length >= 2, 'the confirmation dialog is open, with its own confirm button');
  yes[yes.length - 1].click();
  await settle();
  H.eq(cancelled, 1, 'cancelSession was called');
  H.ok(creditButtons(dom).length > 0,
    '⚠ and the credit it wrote is offered on the evening that is left');

  // ------------------------------------------------------------------------
  // ⚠ AND THE MESSAGE IS SAID AFTER THE REDRAW, NOT BEFORE.
  //
  // The cost card's credit block hands `onDone` = renderActivity(), which
  // reassigns the notice node the moment it runs — so a message said first is
  // written into a div discarded in the same repaint. That is the bug this file
  // already carries one screen over: "your request has been sent", said and then
  // thrown away by the reboot that followed it.
  //
  // It cannot be seen on an evening's button, whose `onDone` repaints one panel
  // and leaves the notice where it is. Both orderings pass there, which is why
  // the course is exercised rather than argued about.
  console.log('\n[the message survives the redraw it asks for — success]');
  let course = 0;
  dom = await page({ balanceCents: 700, reg: COURSE, activity: COURSE_ACT, api: {
    registration: () => ({ ok: true,
      registration: Object.assign({}, COURSE, course ? { creditedCents: 700 } : {}),
      activity: COURSE_ACT, balanceCents: course ? 0 : 700, perSession: null }),
    useCredit: () => { course += 1; return { ok: true, spentCents: 700, balanceCents: 0 }; }
  } });
  H.eq(creditButtons(dom).length, 1, 'the cost card offers the balance');
  creditButtons(dom)[0].click();
  await settle();
  H.eq(course, 1, 'useCredit was called');
  H.ok(/Your credit has been used/.test(dom.mount.textContent),
    '⚠ and the confirmation is on screen after the page has redrawn under it');
  H.eq(creditButtons(dom).length, 0, 'with nothing left to spend');

  console.log('\n[the message survives the redraw it asks for — refusal]');
  dom = await page({ balanceCents: 700, reg: COURSE, activity: COURSE_ACT, api: {
    useCredit: () => ({ _status: 409, error: 'There is no credit on this account.',
                        reason: 'no-credit', balanceCents: 0 })
  } });
  H.eq(creditButtons(dom).length, 1, 'offered before the press');
  creditButtons(dom)[0].click();
  await settle();
  H.ok(/no credit on this account/.test(dom.mount.textContent),
    '⚠ and the refusal too — the one moment we KNOW the screen is wrong is the one '
    + 'moment it must not be silent');

  // ------------------------------------------------------------------------
  // ⚠ ONE READER FOR TWO NAMES. useCredit answers `balanceCents` and
  // cancelSession answers `balance`; a call site that remembers the wrong one
  // fails silently, by going on advertising money that is gone.
  console.log('\n[the two names the server uses are read in one place]');
  const src = read('js/member-account.js');
  H.ok(/function balanceIn\(res\)/.test(src), 'there is one reader');
  H.ok(/typeof d\.balanceCents === 'number'/.test(src) && /typeof d\.balance === 'number'/.test(src),
    'and it knows both names');
  H.eq((src.match(/function balanceIn\(/g) || []).length, 1, 'declared exactly once');
  H.eq((src.match(/balanceIn\(/g) || []).length, 3,
    'and called at both places money moves — useCredit and cancelSession');
  // ⚠ BY SHAPE, not by the count above. What must be true is that neither
  // handler reaches for a name of its own: the one that picks the wrong one
  // fails silently, by going on advertising money that is gone.
  ['useCredit', 'cancelSession'].forEach((action) => {
    const at = src.indexOf("action: '" + action + "'");
    H.ok(at !== -1, 'the client sends ' + action);
    const body = src.slice(at, src.indexOf('\n        });', at));
    H.ok(/balanceIn\(/.test(body), action + ' reads the balance through the one reader');
    H.ok(!/\.balanceCents|\.balance\b/.test(body),
      'and names neither key itself');
  });

  H.done();
})();
