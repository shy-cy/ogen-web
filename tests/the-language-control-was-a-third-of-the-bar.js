// What this defends against:
//
// ⚠ THREE LABELLED BUTTONS WERE THE WIDEST THING IN THE NAV.
//
// Asked for from a phone: "the lang selector can be replaced by a globe icon ->
// click can open the 3 languages to change. this will give more space to more
// needed functionalities in the top nav."
//
// Measured in a browser rather than argued about, at 320/375/414 signed in: the
// toggle was 130px, against a 74px account chip and a 32px hamburger — the
// widest item in the bar and more than half the controls row on the narrowest
// phone. The globe is 32px, the hamburger's own size, and hands back 98px.
//
// ⚠ AND THE READER WHO NEEDS THIS MOST IS THE ONE WHO CANNOT READ THE PAGE.
// That rule is why the old toggle was three always-visible buttons in a fixed
// [עב][EN][RU] order, and it is not broken here — it is what decided the shape
// of what replaces them. `עב` / `EN` / `RU` are abbreviations, and two of the
// three are Latin whichever language you read; the list spells the ENDONYMS out,
// each carrying its own `lang` so a screen reader says it in that language
// rather than in the page's. One tap buys a name somebody can recognise as their
// own.
//
// ⚠ ONE CONTROL AT EVERY WIDTH, not a globe on phones and buttons on a desktop.
// Two controls is two behaviours to keep in step — the trap rule 2 names for
// per-language overrides, arriving as a per-width one — and the endonyms are the
// better answer on a desktop too.
//
// It is EXECUTED, not read. Reading the markup proves the markup is
// self-consistent and can never prove that pressing the globe shows the
// languages, which is the whole of what was asked for.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_helpers');
const D = require('./_dom');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const navSrc = read('js/nav.js');
const css = read('shared.css');
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (sel) => {
  const at = cssCode.indexOf(sel + '{');
  return at === -1 ? '' : cssCode.slice(at, cssCode.indexOf('}', at));
};

// nav.js injects with insertAdjacentHTML and the shim has no parser, so the
// markup is captured as a string — the same seam the menu suite uses — and the
// two nodes the language control actually mutates are built for real below.
function boot(lang) {
  const dom = D.makeDom({ lang: lang });
  const page = dom.node('div');
  page.setAttribute('id', 'page');
  const globe = dom.node('button');
  globe.setAttribute('aria-expanded', 'false');
  const menu = dom.node('div');
  menu.hidden = true;
  const pick = dom.node('div');
  const mobile = dom.node('div');
  const burger = dom.node('button');
  const els = { page: page, 'lang-globe': globe, 'lang-menu': menu,
                'mobile-menu': mobile, hamburger: burger };
  const listeners = {};
  dom.document.getElementById = (id) => els[id] || null;
  dom.document.querySelector = (s) => (s === '.lang-pick' ? pick : null);
  dom.document.addEventListener = (k, fn) => { (listeners[k] = listeners[k] || []).push(fn); };
  dom.window.location.pathname = lang === 'he' ? '/' : '/' + lang;
  dom.window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
  let injected = '';
  page.insertAdjacentHTML = (where, html) => { injected = html; };
  const ctx = vm.createContext({
    window: dom.window, document: dom.document, location: dom.window.location,
    console: console, fetch: dom.window.fetch, Promise: Promise, JSON: JSON,
    Object: Object, Array: Array, String: String, Date: Date, Math: Math,
    setTimeout: setTimeout, encodeURIComponent: encodeURIComponent
  });
  vm.runInContext(navSrc, ctx, { filename: 'js/nav.js' });
  return { ctx, injected, globe, menu, pick, mobile, burger, listeners };
}

(async () => {
  console.log('[the old toggle is gone rather than left unstyled]');
  // A class with no rule is a layout nobody designed — the lesson
  // .acc-evening-acts taught. It has to leave both files together.
  H.eq((navSrc.match(/lang-toggle/g) || []).length, 0, 'no markup writes the old class');
  H.eq((css.match(/lang-toggle/g) || []).length, 0, 'and no rule is left behind for it');
  H.eq((navSrc.match(/>עב</g) || []).length, 0, 'the two-letter codes are gone from the bar');

  console.log('\n[the globe, and what it announces]');
  ['he', 'en', 'ru'].forEach((l) => {
    const { injected } = boot(l);
    const word = { he: 'שפה', en: 'Language', ru: 'Язык' }[l];
    H.ok(injected.indexOf('class="lang-globe"') !== -1, l + ': there is one globe');
    H.ok(injected.indexOf('aria-label="' + word + '"') !== -1,
      l + ': labelled in the page\'s language — a bare glyph announces nothing');
    H.ok(injected.indexOf('title="' + word + '"') !== -1,
      l + ': and titled, which is all a touch device with no hover has');
    H.ok(/aria-expanded="false"/.test(injected), l + ': it starts closed and says so');
    H.ok(/aria-controls="lang-menu"/.test(injected), l + ': and names what it opens');
    H.ok(/<svg[^>]*aria-hidden="true"/.test(injected),
      l + ': the drawing itself is hidden from the accessibility tree');
    H.ok(injected.indexOf('<div class="lang-menu" id="lang-menu" role="menu" hidden>') !== -1,
      l + ': the list ships hidden rather than being hidden by script after paint');
  });

  console.log('\n[the names are endonyms, each in its own language]');
  const { injected } = boot('en');
  [['he', 'עברית', /[֐-׿]/], ['en', 'English', /[A-Za-z]/],
   ['ru', 'Русский', /[Ѐ-ӿ]/]].forEach(([code, name, script]) => {
    H.ok(injected.indexOf('lang="' + code + '"') !== -1,
      code + ': the option carries its own lang, so it is pronounced in that language');
    H.ok(injected.indexOf('>' + name + '<') !== -1,
      code + ': ⚠ and is named in its OWN script — the reader who needs this cannot read the page');
    H.ok(script.test(name), code + ': which is a different script from a two-letter code');
    H.ok(injected.indexOf("setLang('" + code + "')") !== -1,
      code + ': and still goes through setLang, which carries the query string');
  });
  // ⚠ setLang, not an href built at render time. The query string is the entire
  // point on three pages — verify, reset and guardian-invite carry their token
  // there — and a link frozen at paint cannot follow a hash that changes after.
  H.ok(/location\.href = dest \+ location\.search \+ location\.hash/.test(navSrc),
    'and setLang still carries both the search and the hash');

  console.log('\n[the one you are reading is marked, not removed]');
  ['he', 'en', 'ru'].forEach((l) => {
    const out = boot(l).injected;
    const marks = out.match(/aria-current="true"/g) || [];
    H.eq(marks.length, 1, l + ': exactly one option is marked current');
    const at = out.indexOf('aria-current="true"');
    H.ok(out.lastIndexOf('lang="' + l + '"', at) > out.lastIndexOf('lang="', at - 1) - 1,
      l + ': and it is this language\'s');
    H.ok(out.indexOf('lang="' + l + '"') < at && at - out.indexOf('lang="' + l + '"') < 90,
      l + ': the mark sits on the option for the language being read');
  });

  console.log('\n[pressing it — executed, not read]');
  let b = boot('en');
  H.eq(b.menu.hidden, true, 'the list starts hidden');
  b.ctx.window.toggleLang();
  H.eq(b.menu.hidden, false, '⚠ pressing the globe SHOWS THE LANGUAGES — the whole request');
  H.eq(b.globe.getAttribute('aria-expanded'), 'true', 'and says so to a screen reader');
  b.ctx.window.toggleLang();
  H.eq(b.menu.hidden, true, 'pressing again closes it');
  H.eq(b.globe.getAttribute('aria-expanded'), 'false', 'and says that too');

  console.log('\n[a way out that is not the control that opened it]');
  b = boot('en');
  b.ctx.window.toggleLang();
  (b.listeners.keydown || []).forEach((fn) => fn({ key: 'Escape' }));
  H.eq(b.menu.hidden, true, 'Escape closes it');
  b.ctx.window.toggleLang();
  (b.listeners.click || []).forEach((fn) => fn({ target: b.mobile }));
  H.eq(b.menu.hidden, true, 'and so does a click anywhere else');
  b.ctx.window.toggleLang();
  (b.listeners.click || []).forEach((fn) => fn({ target: b.pick }));
  H.eq(b.menu.hidden, false, '⚠ but a click INSIDE it does not — that would eat the choice');

  console.log('\n[two panels hang off one bar and only one may be open]');
  b = boot('en');
  b.ctx.window.toggleLang();
  b.ctx.window.toggleMenu();
  H.eq(b.menu.hidden, true, 'opening the hamburger closes the languages');
  b.mobile.classList.add('open');
  b.ctx.window.toggleLang();
  H.ok(!b.mobile.classList.contains('open'), 'and opening the languages closes the hamburger');
  H.eq(b.menu.hidden, false, 'leaving the list on screen');

  console.log('\n[the width that was the point of all this]');
  const globe = rule('.lang-globe');
  H.ok(/width:32px/.test(globe.replace(/\s/g, '')),
    'the globe is 32px — the hamburger\'s own size, not a third of the bar');
  H.ok(/height:32px/.test(globe.replace(/\s/g, '')), 'square, so it sits in the row cleanly');
  const burgerH = /height:\s*32px/.test(rule('.hamburger'));
  H.ok(burgerH, 'and the hamburger is still 32px, so the two match by measurement');
  // ⚠ ONE ANSWER FOR THE WHOLE STYLESHEET. This rule used to carry its own
  // `.lang-menu[hidden]{display:none}`; so did .activity-sticky, and the third
  // element to need it did not get one — see
  // a-button-that-was-told-to-go-away-and-did-not.js.
  H.ok(!/\.lang-menu\[hidden\]/.test(cssCode),
    'no per-class patch left here — the global rule answers it');

  console.log('\n[nothing in the block is physical]');
  const from = cssCode.indexOf('.lang-pick{');
  const block = cssCode.slice(from, cssCode.indexOf('.hamburger{', from));
  H.ok(block.length > 400, 'the block is there');
  H.eq((block.match(/(^|[^-])(left|right)\s*:/g) || []).length, 0,
    '⚠ the panel is placed with inset-inline-end, so it follows the control in all three languages');
  H.ok(/inset-inline-end:0/.test(block), 'which is the declaration doing it');

  H.done();
})();
