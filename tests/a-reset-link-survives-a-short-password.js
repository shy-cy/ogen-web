// What this defends against:
//
// A family lost their way back into their own account to a typo, and every
// screen involved reported something true and unhelpful.
//
// `resetPassword` consumed the one-time token FIRST and looked at the password
// SECOND. The order was deliberate and the argument for it was wrong: it held
// that a token surviving a failed attempt was the more dangerous shape, when
// whoever holds a reset link already has everything the link grants — a second
// try costs nothing, and a password under the minimum is not an attack.
//
// What it cost was real. QA typed a short password, the link was spent, and the
// refusal told them to ask for a new one. The two tabs they already had open
// then answered "that link has expired or has already been used", which is the
// sentence for a link somebody else has used. Reported as: three tabs, three
// dead links, no password accepted.
//
// And NOTHING ANYWHERE SAID THE MINIMUM WAS EIGHT. Not the reset form, not the
// sign-up form, not the change-password form — five password inputs and not one
// `minlength` between them. The rule existed only as a refusal, which is the
// shape that guarantees somebody breaks it, and on this one screen breaking it
// cost the link as well.
//
// So: the length is checked before the token is spent (pinned in
// a-guardian-token-is-not-an-admin-token.js, where the reset flow lives), and
// every field that takes a NEW password states the rule before it is broken.
// This suite is the second half — the screens are executed, not read.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_helpers');
const D = require('./_dom');

const R = path.join(__dirname, '..');
const CLIENT = fs.readFileSync(path.join(R, 'js/member-account.js'), 'utf8');
const SESSION = fs.readFileSync(path.join(R, 'js/member-session.js'), 'utf8');
const accounts = require(H.fnPath('_account-store'));

const settle = () => new Promise((r) => setTimeout(r, 30));

// The screens here need no API: the reset and sign-up views draw their form
// before anything is fetched, which is the whole reason a hint can be shown
// before a refusal can.
async function screen(opts) {
  const dom = D.makeDom(Object.assign({
    fetch: () => Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve({}) })
  }, opts));
  const ctx = vm.createContext({
    window: dom.window, document: dom.document, console: console,
    Intl: Intl, Date: Date, Math: Math, JSON: JSON, Object: Object, Array: Array,
    String: String, Number: Number, RegExp: RegExp, Promise: Promise, setTimeout: setTimeout,
    encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent
  });
  vm.runInContext(SESSION, ctx, { filename: 'js/member-session.js' });
  vm.runInContext(CLIENT, ctx, { filename: 'js/member-account.js' });
  await settle();
  return dom;
}

(async () => {
  console.log('[the client and the server agree what the minimum IS]');
  // A browser cannot require a Netlify function, so the number is written twice
  // — the same duplication the activities menu makes, and pinned the same way.
  // Two copies that can drift is how a form comes to promise a rule the server
  // does not enforce, or enforce one the form never mentioned.
  const declared = CLIENT.match(/var MIN_PASSWORD = (\d+);/);
  H.ok(!!declared, 'the client states a minimum of its own');
  H.eq(Number(declared[1]), accounts.MIN_PASSWORD,
    'and it is the server\'s MIN_PASSWORD, not a number somebody typed');

  console.log('\n[every NEW-password field says the rule before it is broken]');
  // The reset screen is the one where breaking the rule used to cost the link.
  for (const lang of ['he', 'en', 'ru']) {
    const dom = await screen({ view: 'reset', lang: lang, search: '?token=a-live-token' });
    const pw = D.byTag(dom.mount, 'input').filter((i) => i.getAttribute('type') === 'password');
    H.eq(pw.length, 1, `[${lang}] the reset screen asks for one new password`);
    H.eq(String(pw[0].getAttribute('minlength')), String(accounts.MIN_PASSWORD),
      `[${lang}] and the input carries the minimum`);

    const hint = D.byClass(dom.mount, 'acc-hint')[0];
    H.ok(!!hint, `[${lang}] with a hint beside it, not only an attribute`);
    H.ok(hint.textContent.indexOf(String(accounts.MIN_PASSWORD)) !== -1,
      `[${lang}] naming the number itself — "at least some characters" is not a rule`);
    // The hint is DESCRIBED BY, never a second label: a screen reader should
    // read it after the field's name rather than instead of it.
    H.eq(pw[0].getAttribute('aria-describedby'), hint.getAttribute('id'),
      `[${lang}] and it is wired to the input with aria-describedby`);
  }

  console.log('\n[a box you type an EXISTING password into explains nothing]');
  // Sign-in must not carry the rule. It is about CHOOSING a password, and
  // printing it under a box that wants the one you already have reads as a
  // demand to change it.
  const signin = await screen({ view: 'account', lang: 'en', signedIn: false });
  H.eq(D.byClass(signin.mount, 'acc-hint').length, 0,
    'signing in asks for what you have, and explains no rule about it');

  console.log('\n[and sign-up, which is where most people meet the rule first]');
  // ⚠ NOT ONLY THE RESET SCREEN. Sign-up is the tallest form in the area, so a
  // refusal there is the one most likely to render below the fold — which is
  // the bug already on record as "pressed Create account, nothing happened".
  // Saying the rule up front is worth more on this form than on any other.
  D.byTag(signin.mount, 'a').filter((b) => b.textContent === 'Create an account')[0].click();
  await settle();
  const hints = D.byClass(signin.mount, 'acc-hint');
  H.ok(hints.length >= 1, 'the sign-up form states it too');
  H.ok(hints.some((h) => h.textContent.indexOf(String(accounts.MIN_PASSWORD)) !== -1),
    'with the same number');
  const newPw = D.byTag(signin.mount, 'input')
    .filter((i) => i.getAttribute('autocomplete') === 'new-password');
  H.eq(newPw.length, 1, 'on the one field that takes a new password');
  H.eq(String(newPw[0].getAttribute('minlength')), String(accounts.MIN_PASSWORD),
    'and that field carries the minimum');

  H.done();
})();
