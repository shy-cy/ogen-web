// What this defends against: a lock that worked and looked like nothing.
//
// Eight failed sign-ins set a fifteen-minute lock, and the ninth attempt is
// refused even with the RIGHT password. That has always worked — QA reported
// "it doesn't lock", because every attempt answered with the same sentence and
// nothing on the screen ever said a limit was being approached or reached. A
// rule nobody can observe is, from the outside, a rule that is not there.
//
// ⚠ AND THE SERVER CANNOT BE THE ONE TO SAY IT. A wrong password and an address
// nobody has used answer identically on purpose: an attacker who learns
// dana@example.com has an Ogen account has learned she has children attending
// and roughly where they are on a Wednesday afternoon. "You have three tries
// left" can only be true of an account that EXISTS, so sending it would make
// the refusal tell the two apart — the one thing sign-in must never do.
//
// So the counting is the browser's, of its own user's keystrokes. The same
// words appear for an address with an account and one without, because the
// browser cannot tell and never asks. This suite pins both halves: the screen
// says it, and the two numbers it says match the ones the server enforces.

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

// Every sign-in is refused, exactly as the server refuses one: 401, one code,
// one sentence, and NOTHING that varies with whether the address is real.
function screen() {
  const dom = D.makeDom({
    view: 'account', lang: 'en',
    fetch: () => Promise.resolve({
      status: 401, ok: false,
      json: () => Promise.resolve({
        error: 'That email address and password do not match an account.',
        code: 'signin-failed'
      })
    })
  });
  const ctx = vm.createContext({
    window: dom.window, document: dom.document, console: console,
    Intl: Intl, Date: Date, Math: Math, JSON: JSON, Object: Object, Array: Array,
    String: String, Number: Number, RegExp: RegExp, Promise: Promise, setTimeout: setTimeout,
    encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent
  });
  vm.runInContext(SESSION, ctx, { filename: 'js/member-session.js' });
  vm.runInContext(CLIENT, ctx, { filename: 'js/member-account.js' });
  return dom;
}

async function tryOnce(dom, email) {
  const inputs = D.byTag(dom.mount, 'input');
  inputs.filter((i) => i.getAttribute('type') === 'email')[0].value = email;
  inputs.filter((i) => i.getAttribute('type') === 'password')[0].value = 'wrong';
  D.byTag(dom.mount, 'form')[0].submit();
  await settle();
  return (D.byClass(dom.mount, 'acc-notice')[0] || {}).textContent || '';
}

(async () => {
  console.log('[the browser counts, and says so]');
  const dom = screen();
  await settle();

  const first = await tryOnce(dom, 'dana@example.com');
  H.ok(first.indexOf('do not match an account') !== -1,
    'the server\'s own refusal is still what leads the message');
  H.ok(/Attempt 1 of 8/.test(first), 'and the attempt is counted from the first failure');

  let last = first;
  for (let i = 2; i <= accounts.MAX_FAILED - 1; i++) {
    last = await tryOnce(dom, 'dana@example.com');
    H.ok(last.indexOf('Attempt ' + i + ' of 8') !== -1, 'attempt ' + i + ' is named');
  }
  H.ok(!/blocked/.test(last), 'nothing says blocked while there are tries left');

  const atLimit = await tryOnce(dom, 'dana@example.com');
  H.ok(/blocked for 15 minutes/.test(atLimit),
    'and at the limit it says how long, which is the half QA could not see at all');
  H.ok(!/Attempt 8 of 8/.test(atLimit), 'the count gives way to the answer rather than doubling it');

  console.log('\n[counted per address, so a second one starts clean]');
  const other = await tryOnce(dom, 'someone-else@example.com');
  H.ok(/Attempt 1 of 8/.test(other),
    'a different address is not already eight-ninths of the way to a lock');

  console.log('\n[the numbers are the server\'s, not a second pair]');
  // A browser cannot require a Netlify function, so they are written twice. Two
  // copies that drift would count down to a limit that is not the real one.
  const max = CLIENT.match(/var MAX_SIGNIN_ATTEMPTS = (\d+);/);
  const mins = CLIENT.match(/var SIGNIN_LOCK_MINUTES = (\d+);/);
  H.ok(!!max && !!mins, 'both constants are declared');
  H.eq(Number(max[1]), accounts.MAX_FAILED, 'the ceiling is MAX_FAILED');
  H.eq(Number(mins[1]), accounts.LOCK_MS / 60000, 'and the wait is LOCK_MS');

  console.log('\n[and NOTHING about it reached the server]');
  // The whole point. If a count or a remaining time ever travels in a response,
  // the refusal has started telling a real address from an invented one.
  const authSrc = fs.readFileSync(path.join(R, 'netlify/functions/account-auth.js'), 'utf8');
  const signinCase = authSrc.slice(authSrc.indexOf("case 'signin'"),
                                  authSrc.indexOf("case 'signout'"));
  H.ok(!/attempts|remaining|lockedUntil|failedSignIns|MAX_FAILED|LOCK_MS/.test(signinCase),
    'the signin handler reports no count, no remaining tries and no unlock time');

  // And the refusal itself is still one sentence with nothing variable in it.
  const errors = require(H.fnPath('_family-errors'));
  ['he', 'en', 'ru'].forEach((l) => {
    H.eq(typeof errors.MESSAGES['signin-failed'][l], 'string',
      '[' + l + '] the sign-in refusal is a fixed sentence, not built from parameters');
  });

  H.done();
})();
