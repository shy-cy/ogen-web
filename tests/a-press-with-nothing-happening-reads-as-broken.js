// What this defends against:
//
// Four things reported from one testing session, and three of them are the same
// shape: THE SCREEN DID NOT SAY WHAT WAS GOING ON.
//
// 1 & 2. "Clicking Create account — nothing happened. After a long time, an
//    error." Every form here already disabled its button for the length of the
//    call, and that was the WHOLE of the feedback: `.btn-primary` had no
//    `:hover`, no `:active`, no `:disabled` and no `:focus-visible`, so a
//    disabled button is pixel-for-pixel a button sitting there doing nothing.
//    Sign-up is also the slowest action on the site — a password is hashed at
//    cost 12 and several records are written — so the gap is seconds long on the
//    one form where it is least affordable.
//
//    And "after a long time, an error" was a second bug underneath. settle()
//    promised that an email failure never blocks the action it accompanies, and
//    that was true of a send that FAILS and false of one that HANGS: it waited
//    forever, Netlify killed the function at ten seconds, and the caller was
//    told something went wrong about an account that had already been created.
//    The person then tries another address, because that is what the message
//    said to do.
//
// 4. A family on the HEBREW page was offered group names in English. Every
//    display string this API renders — named groups, the facts card, the price
//    rows, the session table — was built in the language stored on the ACCOUNT.
//    That is the right language for an email, which arrives later and out of
//    context, and the wrong one for a screen somebody is looking at.
//
// The fixes are one CSS block, one busy() helper, one timeout, and one field on
// every request. This suite executes the first, third and fourth.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_helpers');
const D = require('./_dom');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');

console.log('[the button has states at all]');
const css = read('shared.css');
const btn = css.slice(css.indexOf('.btn-primary{'), css.indexOf('.link-arrow{'));
['\\.btn-primary:hover', '\\.btn-primary:active', '\\.btn-primary:disabled', '\\.btn-primary:focus-visible']
  .forEach((sel) => {
    H.ok(new RegExp(sel).test(btn), sel.replace(/\\/g, '') + ' is styled');
  });
// The press is the state that matters most: it is the only feedback that
// arrives before the network does.
H.ok(/\.btn-primary:active\{[^}]*transform/.test(btn), 'and pressing it moves — feedback with no round trip');
H.ok(/\.btn-primary:disabled\{[^}]*cursor:progress/.test(btn),
  'and a disabled one says it is working rather than looking idle');
// A disabled button that still lights up on hover reads as pressable.
H.ok(/\.btn-primary:disabled:hover\{[^}]*background: var\(--terracotta\)/.test(btn),
  'and does not brighten under the cursor while it is busy');

console.log('\n[and the label says so, from one helper]');
const ui = read('js/member-account.js');
H.ok(/function busy\(btn\)\s*\{[\s\S]{0,320}btn\.textContent = T\.working;/.test(ui),
  'busy() disables AND relabels');
H.ok(/return function \(\) \{ btn\.disabled = false; btn\.textContent = was; \};/.test(ui),
  'and hands back the undo, so a caller cannot restore the wrong text');
// One helper rather than a line in each handler: the failure was every handler
// doing the same half-measure, and the next form added would have done it too.
H.ok((ui.match(/busy\(/g) || []).length >= 9, 'every form goes through it');
// The handlers that still set `disabled` by hand are the ones that write their
// OWN label — "Opening payment…", "Register and pay · €27.00" — so they are not
// the silent case this fixes. Every one of them is checked rather than counted:
// a new handler that disables and says nothing must not slip in beside them.
const handRolled = ui.split('\n')
  .map((line, i) => ({ line: line, i: i }))
  .filter((x) => /\w+\.disabled = true;/.test(x.line) && !/btn\.disabled/.test(x.line));
handRolled.forEach((x) => {
  const window20 = ui.split('\n').slice(Math.max(0, x.i - 6), x.i + 8).join('\n');
  H.ok(/textContent = T\./.test(window20) || /go\.disabled = true;\n\s*return dates/.test(window20),
    'line ' + (x.i + 1) + ' disables a control that sets its own label (or draws a reason): ' + x.line.trim());
});

console.log('\n[a new account is TOLD it exists, across the redraw that hides it]');
// say() writes into the notice the current screen owns, and signing up REPLACES
// that screen — so the one thing a new account needs to know was being written
// into a node discarded in the same repaint.
H.ok(/flash\(T\.signUpDone\);/.test(ui), 'sign-up flashes a message');
H.ok(/function flash\(text\) \{ S\.flash = text; \}/.test(ui), 'which is held on the state');
H.ok(/else renderAccount\(S\.account\);[\s\S]{0,400}if \(S\.flash\)/.test(ui),
  'and said AFTER the screen is drawn, which is the whole point of it');
// ⚠ AND AFTER WHICHEVER SCREEN. The drain sat past two early returns, so it ran
// for the dashboard alone — a message carried towards /account/details or
// /account/activity was dropped with nothing saying so.
H.ok(!/if \(view === '(details|activity)'\) return render/.test(ui),
  'no view returns before the drain');
['he', 'en', 'ru'].forEach((l) => {
  const t = tableFor(l);
  H.ok(t.working && t.signUpDone, l + ': both strings exist');
  H.ok(/@|http/.test(t.signUpDone) === false, l + ': and neither is a placeholder');
});

console.log('\n[the language is the PAGE\'s, not the account\'s]');
const sess = read('js/member-session.js');
H.ok(/payload\.lang = \(window\.document\.documentElement\.lang \|\| 'he'\)/.test(sess),
  'every request carries the language of the page it was made from');
H.ok(/if \(payload\.lang === undefined\)/.test(sess),
  'and a caller that names one explicitly still wins');
const api = read('netlify/functions/account-registrations.js');
// The resolver is shared by all three family endpoints now, so the three cannot
// answer the same request in different languages.
H.ok(/const lang = E\.readerLang\(body, me\);/.test(api),
  'the server prefers it');
// The fallback lives with the resolver, and is EXECUTED rather than matched —
// which is the stronger check, and the reason moving it out of this file was
// safe to do at all.
const FE = require('../netlify/functions/_family-errors');
H.eq(FE.readerLang({ lang: 'ru' }, { profile: { preferredLanguage: 'en' } }), 'ru',
  'the page wins over the account');
H.eq(FE.readerLang({}, { profile: { preferredLanguage: 'en' } }), 'en',
  'and falls back to the preference, so an older tab still answers in something');
H.eq(FE.readerLang({ lang: 'fr' }, {}), 'he',
  'and to Hebrew, which is the language of the tree at /');
// ⚠ AND THE EMAILS ARE UNTOUCHED. A message arrives later and out of context,
// which is a different question with a different right answer.
const mailCalls = (api.match(/mail\.send\w+\([^)\n]*/g) || []);
H.ok(mailCalls.length >= 3, 'the file sends mail');
H.ok(mailCalls.every((c) => !/\blang\b/.test(c)),
  'and never hands it a page language — it reads the account: ' + mailCalls.join(' | '));

console.log('\n[an email that HANGS no longer takes the action down with it]');
const email = read('netlify/functions/_email.js');
H.ok(/const SEND_TIMEOUT_MS = \d+;/.test(email), 'the send is bounded');
const ms = Number(/const SEND_TIMEOUT_MS = (\d+);/.exec(email)[1]);
H.ok(ms >= 3000 && ms < 10000,
  'inside Netlify\'s ten seconds with room for the work that ran first (' + ms + 'ms)');
H.ok(/finally \{[\s\S]{0,140}t\.clear\(\)/.test(email),
  'and the timer is cleared, or a pending one keeps the function alive after it has answered');

// Executed, because a race written the wrong way round is invisible in source.
const E = require(H.fnPath('_email'));
(async () => {
  const t0 = Date.now();
  const hung = await E.settle('a hanging send', 'nobody@example.com', () => new Promise(() => {}));
  const waited = Date.now() - t0;
  H.eq(hung, false, 'a send that never answers is reported as not sent');
  H.ok(waited >= ms && waited < ms + 2000, 'after the bound, not forever (' + waited + 'ms)');
  const t1 = Date.now();
  H.eq(await E.settle('a fast send', 'x', async () => {}), true, 'a healthy send still returns true');
  H.ok(Date.now() - t1 < 500, 'immediately — the bound costs a working send nothing');
  H.eq(await E.settle('a failing send', 'x', async () => { throw new Error('no'); }), false,
    'and a send that throws is still swallowed, as it always was');

  console.log('\n[executed: the button changes, and the request names the language]');
  await screens();
  H.done();
})();

function tableFor(l) {
  const src = read('js/member-account.js');
  const tableSrc = src.slice(src.indexOf('var T = {'),
                             src.indexOf('}[lang];', src.indexOf('var T = {')) + '}[lang];'.length);
  const ctx = { lang: l };
  vm.runInNewContext(tableSrc + '\nresult = T;', ctx);
  return ctx.result;
}

async function screens() {
  const sent = [];
  let release = null;
  const dom = D.makeDom({
    view: 'account', lang: 'he',
    fetch: function (endpoint, init) {
      const body = JSON.parse(init.body);
      sent.push(body);
      // The signup answer is held open on purpose: the state being asserted is
      // the one a person sees WHILE they are waiting, which is the state that
      // did not exist.
      if (body.action === 'signup') {
        return new Promise((resolve) => {
          release = () => resolve({ status: 200, ok: true, json: () => Promise.resolve({
            ok: true, token: 't', expiresAt: Date.now() + 1e7,
            account: { accountId: 'a-1', email: 'michal@example.com',
                       profile: { firstName: 'Michal', preferredLanguage: 'en' } }
          }) });
        });
      }
      const canned = {
        me: { ok: true, account: { accountId: 'a-1', email: 'michal@example.com',
                                   profile: { firstName: 'Michal', preferredLanguage: 'en' } },
              expiresAt: Date.now() + 1e7 },
        listParticipants: { ok: true, participants: [] },
        list: { ok: true, registrations: [] },
        balance: { ok: true, balanceCents: 0, entries: [] }
      }[body.action] || { ok: true };
      return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve(canned) });
    }
  });
  const ctx = vm.createContext({
    window: dom.window, document: dom.document, console: console, location: dom.window.location,
    Intl: Intl, Date: Date, Math: Math, JSON: JSON, Object: Object, Array: Array,
    String: String, Number: Number, RegExp: RegExp, Promise: Promise, setTimeout: setTimeout,
    encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent
  });
  vm.runInContext(read('js/member-session.js'), ctx, { filename: 'js/member-session.js' });
  vm.runInContext(read('js/member-account.js'), ctx, { filename: 'js/member-account.js' });
  const settle = () => new Promise((r) => setTimeout(r, 30));
  await settle();

  // Signed out, on the Hebrew page: the sign-up form.
  D.byTag(dom.mount, 'a').filter((a) => a.textContent === 'פתיחת חשבון')
    .forEach((a) => a.click());
  await settle();
  let go = D.byTag(dom.mount, 'button').filter((b) => b.textContent === 'פתיחת חשבון')[0];
  H.ok(go, 'the sign-up button is drawn in Hebrew');

  // ⚠ THE TERMS BOX IS CHECKED BY US, NOT BY THE BROWSER. It carried
  // `required`, and a native validation bubble is drawn by the browser in the
  // BROWSER's language — so a Hebrew form was refusing in English, with no
  // attribute that could change it. Submitting without ticking now says so in
  // the language of the page, and says it through the same notice every other
  // refusal uses, which scrolls itself into view.
  D.byTag(dom.mount, 'form')[0].submit();
  await settle();
  H.eq(sent.filter((b) => b.action === 'signup').length, 0,
    'an unticked box does not even reach the network');
  H.ok(dom.mount.textContent.indexOf('תנאי השימוש') !== -1,
    'and the reason is on screen, in Hebrew');

  const box = D.byTag(dom.mount, 'input').filter((i) => i.type === 'checkbox')[0];
  H.ok(box, 'the terms box is there');
  H.ok(!box.getAttribute('required'),
    'and it does not hand its refusal to the browser');
  box.checked = true;
  D.byTag(dom.mount, 'form')[0].submit();
  await settle();

  H.eq(go.disabled, true, 'pressing it disables the button');
  H.eq(go.textContent, 'רגע…',
    '⚠ AND CHANGES THE LABEL — disabled alone is what looked like nothing happening');
  const req = sent.filter((b) => b.action === 'signup')[0];
  H.ok(req, 'the request went');
  H.eq(req.lang, 'he', 'and it names the language of the page, not of the account');

  release();
  await settle();
  H.ok(dom.mount.textContent.indexOf('החשבון נוצר') !== -1,
    'and when it lands the family is told the account exists, in Hebrew');
  // The account's own preference is English; the page is Hebrew. The screen
  // follows the page.
  H.ok(dom.mount.textContent.indexOf('שלום') !== -1, 'on a screen that is still Hebrew throughout');
}
