// What this defends against:
//
// Five password boxes in the family area and not one way to see what is in
// them. Reported from a phone, which is where it costs most: autocorrect, a
// shifted layout and a thumb, on a box whose entire feedback is a row of dots.
//
// It is worst on the two screens that ask for a password the person does not
// have yet — sign-up and reset. The rule is eight characters, a typo cannot be
// found by reading, and on the reset screen getting it wrong used to spend the
// link. A person who cannot check what they typed retypes it, or gives up, or
// opens a second account — which is the outcome that leaves real mess behind.
//
// The eye is wired in field(), the ONE builder all five go through, for the
// same reason setCustomValidity is: a sixth password box added next year
// inherits it rather than having to remember.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_helpers');
const D = require('./_dom');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const src = read('js/member-account.js');
const css = read('shared.css');
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');

const settle = () => new Promise((r) => setTimeout(r, 30));

async function screen(lang) {
  const dom = D.makeDom({ view: 'account', lang: lang,
    fetch: () => Promise.reject(new Error('no network in this test')) });
  const ctx = vm.createContext({
    window: dom.window, document: dom.document, console: console,
    Intl: Intl, Date: Date, Math: Math, JSON: JSON, Object: Object, Array: Array,
    String: String, Number: Number, RegExp: RegExp, Promise: Promise, setTimeout: setTimeout,
    encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent
  });
  vm.runInContext(read('js/member-session.js'), ctx, { filename: 'js/member-session.js' });
  vm.runInContext(read('js/member-account.js'), ctx, { filename: 'js/member-account.js' });
  await settle();
  return dom;
}

(async () => {
  console.log('[the sign-in box has an eye, and pressing it shows the password]');
  const dom = await screen('en');
  const pw = D.byTag(dom.mount, 'input').filter((i) => i.getAttribute('type') === 'password');
  H.ok(pw.length >= 1, 'the sign-in card has a password box (' + pw.length + ')');
  const eyes = D.byClass(dom.mount, 'acc-pw-eye');
  H.eq(eyes.length, pw.length, 'and exactly one eye per password box, no more and no fewer');

  const eye = eyes[0];
  const box = pw[0];
  // ⚠ type="button" IS LOAD-BEARING. The default for a button inside a form is
  // submit, so without it revealing the password would post the form — the same
  // trap the admin's (i) badge met beside a <label>, where asking what a setting
  // meant would tick it.
  H.eq(eye.getAttribute('type'), 'button',
    'the eye is type="button" — the default would submit the form it sits in');
  H.eq(eye.getAttribute('aria-pressed'), 'false', 'it starts unpressed');
  H.ok(/password/i.test(eye.getAttribute('aria-label') || ''),
    'and says what it does rather than being an unlabelled glyph');
  const labelBefore = eye.getAttribute('aria-label');

  eye.onclick({ preventDefault: function () {} });
  H.eq(box.getAttribute('type'), 'text', 'pressing it reveals the password');
  H.eq(eye.getAttribute('aria-pressed'), 'true', 'and says so to a screen reader');
  H.ok(eye.getAttribute('aria-label') !== labelBefore,
    'and the label changes, or it offers to do again what it has just done');

  eye.onclick({ preventDefault: function () {} });
  H.eq(box.getAttribute('type'), 'password', 'pressing it again hides it');
  H.eq(eye.getAttribute('aria-pressed'), 'false', 'and the state goes back with it');
  H.eq(eye.getAttribute('aria-label'), labelBefore, 'as does the label');

  console.log('\n[every password box in the area, not just this one]');
  // Counted off the source rather than by opening five screens: the point is
  // that they all go through one builder, so the count is what proves it.
  const asks = (src.match(/type:\s*'password'/g) || []).length;
  H.ok(asks >= 5, 'there are ' + asks + ' password fields in the family area');
  H.eq((src.match(/class:\s*'acc-pw-eye'/g) || []).length, 1,
    '⚠ and ONE place that builds an eye — five call sites is five that can forget');
  H.ok(/attrs && attrs\.type === 'password'/.test(src),
    'field() decides from the field it was asked for, so a sixth box inherits it');

  console.log('\n[the words, in all three]');
  ['showPassword', 'hidePassword'].forEach((k) => {
    H.eq((src.match(new RegExp(k + ':', 'g')) || []).length, 3,
      k + ' is in all three string tables');
  });
  for (const lang of ['he', 'ru']) {
    const d = await screen(lang);
    const e = D.byClass(d.mount, 'acc-pw-eye')[0];
    H.ok(e, lang + ': the eye is drawn');
    const label = e.getAttribute('aria-label') || '';
    H.ok(label.length > 0 && !/password/i.test(label),
      lang + ': and its label is in that language rather than the English fallback');
  }

  console.log('\n[nothing directional]');
  const rule = bare.slice(bare.indexOf('.acc-pw-eye{'), bare.indexOf('}', bare.indexOf('.acc-pw-eye{')) + 1);
  H.ok(rule.length > 40, 'the eye has a rule');
  H.ok(/inset-inline-end/.test(rule),
    'it sits at the reading end with a logical property — the left in Hebrew, the right in English');
  H.eq((rule.match(/(^|[^-])(left|right)\s*:/g) || []).length, 0,
    'and there is not one physical inset in it, so no per-language override is needed');
  const wrap = bare.slice(bare.indexOf('.acc-pw input{'), bare.indexOf('}', bare.indexOf('.acc-pw input{')) + 1);
  H.ok(/padding-inline-end/.test(wrap),
    'and the box makes room for it, or the typed password runs underneath the glyph');

  H.done();
})();
