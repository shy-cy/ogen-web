// What this defends against:
//
// The account chip is the one thing in this repository that runs on EVERY page
// in three languages, so the ways it can go wrong are the ways that go wrong
// everywhere at once.
//
//   1. IT MUST NOT NEED THE MEMBER SCRIPTS. js/nav.js loads on every page;
//      js/member-session.js loads only under /account. A chip that reached for
//      MemberSession would throw on the homepage, which is most of the site.
//      So it reads localStorage directly — the one place that duplication is
//      correct rather than lazy.
//
//   2. IT MUST NOT MIRROR ACROSS THE BAR, and this is the assertion most likely
//      to look wrong to somebody reading it later. Ogen's rule is logical
//      properties throughout — but `.nav-right` is pinned to the physical right
//      and forced direction:ltr ON PURPOSE, so the language toggle keeps one
//      place and one [עב][EN][RU] order in all three languages: the reader who
//      needs it most is the one who cannot read what is currently on screen. The
//      chip joins that group and inherits the rule. Mirroring it alone would
//      throw it to the far side of the bar in Hebrew, away from the controls it
//      belongs with.
//
//      What DOES mirror is the inside of the chip: the avatar sits at the
//      reading start, and the exit arrow points the way the language reads.
//
//   3. THE CHIP GOES TO THE FAMILY AREA, AND NOWHERE ELSE. It used to carry
//      `?next=<the page you were on>`, so signing in from the homepage signed
//      you in and put you back on the homepage — a control labelled MY FAMILY
//      that does not take you to your family reads as a sign-in that did not
//      take. The one case "come back to where you were" genuinely serves,
//      pressing Register on an activity page, never used it: that goes to
//      /account/activity?register=<slug>, which is already the right page.
//
//      Removing it removed an open redirect with it. `next` arrived in a URL
//      anyone could write and was followed the instant a password was typed, so
//      an absolute or protocol-relative value would have made a link that looks
//      like ogen.cy, asks for a password and lands somewhere else. It needed a
//      one-line guard; a one-line guard is what gets simplified away later. A
//      parameter nobody sets and nobody reads needs none, and THAT is what this
//      now checks — the absence, in both halves, because removing only one end
//      would leave the surface with none of the benefit.
//
//   4. THREE LANGUAGES OR NONE. A missing key renders `undefined` into the nav
//      of every page in that language.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_helpers');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const nav = read('js/nav.js');
const css = read('shared.css');
const account = read('js/member-account.js');
// Comments explain all of this in prose, and a naive search would find the words
// rather than the code. Stripped, for the same reason the stylesheet test that
// pins `height:auto` strips them.
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const navCode = strip(nav);
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '');

console.log('[the chip does not depend on the member scripts]');
H.ok(/localStorage\.getItem\('ogenMemberSession'\)/.test(navCode),
  'nav.js reads the session out of localStorage itself');
// The storage KEY is called ogenMemberSession, so the check has to name the
// global specifically or it matches the very line that proves the point.
H.ok(!/window\.MemberSession|\bMemberSession\./.test(navCode),
  'and never touches the window.MemberSession helper, which is not loaded on most pages');
// Every page that loads nav.js and every page that loads member-session.js.
const pages = [];
['', 'en/', 'ru/'].forEach((d) => {
  fs.readdirSync(path.join(R, d || '.')).filter((f) => f.endsWith('.html'))
    .forEach((f) => pages.push(d + f));
  const acc = path.join(R, d, 'account');
  if (fs.existsSync(acc)) fs.readdirSync(acc).filter((f) => f.endsWith('.html'))
    .forEach((f) => pages.push(d + 'account/' + f));
});
const withNav = pages.filter((f) => read(f).indexOf('src="/js/nav.js"') !== -1);
const withMember = pages.filter((f) => read(f).indexOf('src="/js/member-session.js"') !== -1);
H.ok(withNav.length >= 12, 'the nav is on a real number of pages (' + withNav.length + ')');
H.ok(withNav.length > withMember.length,
  'and on strictly more of them than the member scripts are — which is the whole reason for rule 1');

console.log('\n[the chip joins the pinned group rather than mirroring away from it]');
H.ok(/<div class="nav-account" id="nav-account"><\/div>/.test(nav), 'the slot exists');
const navRightBlock = nav.slice(nav.indexOf('<div class="nav-right">'), nav.indexOf('</nav>'));
H.ok(navRightBlock.indexOf('nav-account') !== -1, 'inside .nav-right');
H.ok(navRightBlock.indexOf('nav-account') < navRightBlock.indexOf('lang-toggle'),
  'and before the language toggle, so the hamburger keeps the edge it already owns');
H.ok(/\.nav-right\{[^}]*direction:ltr/.test(cssCode),
  '.nav-right is still forced ltr — the chip inherits a deliberate non-mirroring');
// The inside of the chip is the part that flips.
H.ok(/html\[lang="he"\] \.nav-account\{ direction:rtl; \}/.test(cssCode),
  'while the chip itself opts Hebrew back into rtl, so the avatar is at the reading start');
H.ok(/html\[lang="he"\] \.nav-signout svg\{ transform:scaleX\(-1\); \}/.test(cssCode),
  'and the exit arrow points the way the language reads');

console.log('\n[no physical inset anywhere in the chip]');
const block = cssCode.slice(cssCode.indexOf('.nav-account{'), cssCode.indexOf('.lang-toggle{'));
H.ok(block.length > 800, 'the block is there');
H.eq((block.match(/(^|[^-])(left|right)\s*:/g) || []).length, 0,
  'padding and margins are logical, so the rounded end follows the label in both directions');
H.ok(/padding-inline:6px 11px/.test(block.replace(/\s+/g, ' ')),
  'including the asymmetric padding, which is what would otherwise look wrong in Hebrew');

console.log('\n[it is persistent at every width, and sheds the word rather than itself]');
H.ok(/@media \(max-width:760px\)\{[^}]*\.nav-account-label\{ display:none; \}/.test(
  cssCode.replace(/\s+/g, ' ').replace(/ \{/g, '{')) ||
  /\.nav-account-label\{ display:none; \}/.test(cssCode),
  'the LABEL hides on a narrow bar');
H.ok(!/\.nav-account\{ display:none/.test(cssCode),
  'and the chip itself never does — it was asked for at every width');

console.log('\n[three languages, or none]');
const start = nav.indexOf('const L = {');
const end = nav.indexOf('}[lang];', start);
const table = nav.slice(start, end + '}[lang];'.length);
const tableFor = (l) => {
  const ctx = { lang: l };
  vm.runInNewContext(table + '\nresult = L;', ctx);
  return ctx.result;
};
const he = tableFor('he');
const keys = Object.keys(he).sort();
['account', 'signIn', 'signOut'].forEach((k) => {
  H.ok(keys.indexOf(k) !== -1, 'Hebrew has "' + k + '"');
});
['en', 'ru'].forEach((l) => {
  const other = tableFor(l);
  H.eq(Object.keys(other).sort().join(','), keys.join(','),
    l + ' has exactly the same keys — a missing one renders "undefined" into every page');
  H.ok(Object.keys(other).every((k) => other[k] && other[k].trim()), l + ' has nothing blank');
});
H.eq(he.account, 'אזור המשפחה', 'and the signed-in label is "My family", not "My account"');
H.eq(tableFor('en').account, 'My family', 'in English');
H.eq(tableFor('ru').account, 'Моя семья', 'and in Russian');

console.log('\n[`next` is gone from both halves, so there is nothing to redirect]');
// Both ends, because either one alone is worse than neither: a generator with no
// consumer is dead copy, and a consumer with no generator is an open redirect
// anyone can still reach by typing the parameter.
H.ok(!/next=/.test(navCode), 'the chip does not build a next parameter');
H.ok(/const signInHref = base \+ '\/account';/.test(navCode),
  'it goes to the family area, which is what it is labelled');
const bare = strip(account);
H.ok(!/nextTarget|goNext/.test(bare), 'and the family area no longer has anything that follows one');
H.ok(!/param\('next'\)/.test(bare), 'nor reads it at all');
// The property that replaces the guard: signing in redraws whichever account
// view the reader is on, so the register flow still lands where it should.
H.ok(/if \(opts\.onSignedIn\) return opts\.onSignedIn\(res\.data\.account\);\s*\n\s*boot\(\);/.test(bare),
  'signing in re-boots the view the reader is already on');
H.eq((bare.match(/boot\(\);/g) || []).length >= 3, true,
  'from sign-in, from sign-up, and on load');

console.log('\n[signing out drops the token before it tells anyone]');
const signOut = navCode.slice(navCode.indexOf('window.ogenSignOut'));
H.ok(signOut.indexOf('removeItem') < signOut.indexOf('fetch('),
  'local first, server second — a failed network call still leaves the person signed out here');
H.ok(/location\.reload\(\)/.test(signOut),
  'and it reloads in place rather than navigating, because this is a change of state not of place');
H.ok(/account/.test(signOut.slice(signOut.indexOf('const done'), signOut.indexOf('if (!token)'))),
  'except on an account page, where reloading would only ask you to sign back in');

H.done();
