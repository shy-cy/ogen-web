// What this defends against:
//
// The nav put the logo in the middle with `position:absolute; left:50%` and the
// controls on the right with `position:absolute; right:24px`. Two absolutely
// positioned boxes are out of flow, so neither can know the other is there and
// nothing pushes: past a certain width they simply sit on top of each other.
//
// Measured in Chrome against the live stylesheet, in Hebrew, signed OUT, they
// overlapped by 43px at 900, 109px at 768 and 134px at 500, and were clear only
// from about 1024px up. Signed in the chip is wider and it started higher still.
// That is every phone, every tablet and a narrow laptop window, with the עב
// button printed across the wordmark — reported from a phone with a screenshot.
//
// It survived because a nav is looked at on the machine it is built on. The bar
// is a flex row now, so the items are in each other's way and the layout has to
// resolve it; the assertions below are the properties that make that true, not
// the presence of the fix.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const css = read('shared.css');
// Comment-stripped: this file's own prose names what it forbids, and a naive
// search finds the words in the explanation and passes either way.
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
const nav = read('js/nav.js');

const rule = (sel) => {
  const at = bare.indexOf(sel + '{');
  if (at === -1) return null;
  return bare.slice(at, bare.indexOf('}', at) + 1).replace(/\s+/g, ' ');
};

console.log('[the bar is a row, so the items are in each other’s way]');
const navRule = rule('#page > nav');
H.ok(navRule !== null, 'the nav rule is there');
H.ok(/display:\s*flex/.test(navRule), 'the nav is a flex row rather than a positioning context');
H.ok(/height:\s*var\(--nav-h\)/.test(navRule),
  'and its height is the token — .hero, .mobile-menu and .thankyou all key off it');

// ⚠ THE CAUSE, NAMED. Either of these going back out of flow reopens the bug,
// and it reopens SILENTLY: nothing errors, nothing overflows, the two boxes just
// print on top of each other at a width nobody is testing at.
console.log('\n[neither of the two can leave the flow again]');
['.logo-mark', '.nav-right'].forEach((sel) => {
  const r = rule(sel);
  H.ok(r !== null, sel + ' is there');
  H.ok(!/position:\s*absolute/.test(r),
    sel + ' is NOT absolutely positioned — out of flow it cannot see its neighbour');
});

console.log('\n[the empty leading item is what CENTRES the logo]');
// Without it the only way to push the controls to the end is an auto margin,
// which centres the logo in what is LEFT of the bar — half the controls' width
// off centre at every size. The spacer and .nav-right take the same share.
const spacer = rule('.nav-spacer');
H.ok(spacer !== null, '.nav-spacer has a rule');
H.ok(/flex:\s*1 1 0/.test(spacer), 'it takes an equal share of the free space');
H.ok(/flex:\s*1 1 0/.test(rule('.nav-right')),
  'and .nav-right takes the same one, which is what puts the logo in the middle');
H.ok(/<div class="nav-spacer"><\/div>/.test(nav), 'the injector emits it');
H.ok(nav.indexOf('nav-spacer') < nav.indexOf('logo-mark'),
  'BEFORE the logo — after it, it would push the logo to the leading edge instead');
H.ok(nav.indexOf('logo-mark') < nav.indexOf('class="nav-right"'),
  'and the logo before the controls, so the bar reads spacer · logo · controls');

console.log('\n[the logo is the one thing that gives way]');
H.ok(/min-width:\s*0/.test(rule('.logo-mark')),
  '.logo-mark can shrink below its own content — a flex item will not without this');
// ⚠ AND THE CONTROLS MUST NOT. They are the reason the bar exists at a narrow
// width: the language toggle is for the reader who cannot read what is on
// screen, and the chip says whether you are signed in.
H.ok(!/min-width:\s*0/.test(rule('.nav-right')),
  'and .nav-right deliberately cannot — the controls stay whole and the logo yields');

console.log('\n[max-width and object-fit travel together]');
// The same pairing height:auto and aspect-ratio have on the activity picture:
// the box may be narrower than the artwork, and `contain` scales the artwork
// inside it. Drop either and a narrow bar squashes or crops the logo. Exactly
// one rule, so the pair cannot be split across a media query.
const imgRules = bare.match(/\.logo-mark img\{[^}]*\}/g) || [];
H.eq(imgRules.length, 1, 'there is exactly one .logo-mark img rule');
const img = imgRules[0].replace(/\s+/g, ' ');
H.ok(/max-width:\s*100%/.test(img), 'it caps the box at the space available');
H.ok(/object-fit:\s*contain/.test(img), 'and scales the artwork inside it rather than distorting it');
// ⚠ AND THE HEIGHT IS A TOKEN, NOT A SECOND RULE. The phone bar needs a
// shorter logo, and the obvious way to get one is `.logo-mark img{height:54px}`
// inside the media query — which is a second rule, which is exactly how a pair
// gets split. There is nothing to split if the query moves a variable.
H.ok(/height:\s*var\(--logo-h\)/.test(img), 'at whatever height the token says');

console.log('\n[nothing directional was introduced]');
// The bar is laid out physically on purpose — the toggle must not move between
// languages — but its own spacing is still logical, so a future edit does not
// have to remember which side is which.
H.ok(/padding-inline/.test(navRule) && !/padding-(left|right)/.test(navRule),
  'the nav pads with a logical property');
H.ok(/direction:\s*ltr/.test(navRule),
  'and is forced ltr, so [עב][EN][RU] keeps one place in all three languages');
H.ok(/direction:\s*ltr/.test(rule('.nav-right')), '.nav-right still says so itself');

// --------------------------------------------------------------------------
// ⚠ SEVEN RULES USED TO CARRY THE LITERAL 96px, with a convention saying to
// change them together. A convention is a discipline, and the phone bar below
// is what a discipline loses to: the bar grows there, and a .hero still
// starting at 96px slides under it with nothing erroring.
console.log('\n[the height is declared once and read everywhere]');
H.ok(/:root\{[^}]*--nav-h:\s*96px/.test(bare), '--nav-h is the desktop height');
H.ok(/:root\{[^}]*--logo-h:\s*78px/.test(bare), 'and --logo-h the desktop logo');
// By shape rather than by listing the seven: any literal left behind is a rule
// that has stopped following the bar.
H.eq((bare.match(/\b96px/g) || []).length, 1,
  'and 96px appears exactly once in the whole stylesheet — the token itself');
// The two jump targets used to say 112px, which is the bar plus 16 written out.
H.ok((bare.match(/scroll-margin-block-start:[^;]*/g) || [])
       .every((d) => /var\(--nav-h\)/.test(d)),
  'and every scroll margin clears the bar by reading it rather than by restating it');
[['.mobile-menu', 'top'], ['.hero', 'margin-top'], ['.page-header', 'margin-top'],
 ['.thankyou', 'margin-top'], ['.activity-group[id]', 'scroll-margin-block-start'],
 ['.acc-card[id]', 'scroll-margin-block-start']
].forEach(([sel, prop]) => {
  const r = rule(sel);
  H.ok(r !== null, sel + ' is there');
  H.ok(new RegExp(prop + ':\\s*(calc\\()?var\\(--nav-h\\)').test(r),
    sel + ' takes its ' + prop + ' from the token');
});
H.ok(/min-height:\s*calc\(100vh - var\(--nav-h\)\)/.test(rule('.thankyou')),
  'and .thankyou subtracts the same one from the viewport');

// --------------------------------------------------------------------------
// ⚠ THE LOGO GETS ITS OWN LINE ON A PHONE. One row resolved the collision and
// then charged the logo for it: .logo-mark is the only item with min-width:0,
// so it is the one that yields, and at 375px it yielded down to about 87px —
// the wordmark readable and the tagline under it not. The row runs out at about
// 592px, which is why this is a measurement rather than a preference.
console.log('\n[below the breakpoint the bar is two rows]');
const qAt = bare.indexOf('@media (max-width:600px)');
H.ok(qAt !== -1, 'there is a phone query');
const q = bare.slice(qAt, bare.indexOf('\n}', qAt) + 2);
H.ok(/flex-direction:\s*column/.test(q), 'the bar becomes a column, so the logo is on its own line');
H.ok(/\.nav-spacer\{[^}]*display:\s*none/.test(q),
  'and the empty spacer goes — align-items centres the logo for nothing once they are stacked');
H.ok(/\.nav-right\{[^}]*width:\s*100%/.test(q), 'the controls take the second row whole');
H.ok(!/position:\s*absolute/.test(q), 'and nothing in it goes back out of flow');

// ⚠ THE SUM, COMPUTED. The height is DECLARED rather than measured — everything
// on the page is pushed down by --nav-h — so contents taller than the number
// overlap the hero, silently, at a width nobody opens a laptop to.
const px = (re, where) => {
  const m = (where || q).match(re);
  H.ok(m !== null, 'read ' + re);
  return m ? parseFloat(m[1]) : NaN;
};
const navH  = px(/--nav-h:\s*(\d+(?:\.\d+)?)px/);
const logoH = px(/--logo-h:\s*(\d+(?:\.\d+)?)px/);
const padB  = px(/padding-block:\s*(\d+(?:\.\d+)?)px/);
const gap   = px(/row-gap:\s*(\d+(?:\.\d+)?)px/);
// The tallest thing in the second row. Read from its own rule rather than
// typed here, or the sum stops describing the bar the moment it is restyled.
const burger = px(/height:\s*(\d+(?:\.\d+)?)px/, rule('.hamburger'));
H.eq(padB * 2 + logoH + gap + burger, navH,
  'the two rows and the padding add up to --nav-h exactly (' + padB + '*2 + ' +
  logoH + ' + ' + gap + ' + ' + burger + ' = ' + navH + ')');
H.ok(navH > 96, 'and the phone bar is the taller of the two');
H.ok(logoH < 78, 'with a shorter logo than the desktop one, which is what pays for the row');

// ⚠ AND THE SECOND ROW IS PUSHED APART, NOT CENTRED.
//
// Asked for from a phone: "the menu and the globe align to one side and the
// login/logout + family section align to the other". Centred, the four controls
// read as one undifferentiated clump; apart, the row says what it is — who you
// are at one end, the ways OFF this page at the other — and the space between
// them is what says they are different kinds of control.
console.log('\n[the controls row is two groups, not one clump]');
const navJs = nav;
// ⚠ THE BASE RULE, NOT JUST THE NAME. The phone query below carries a second
// `.nav-ways{ gap:… }`, so merely finding the class in the stylesheet passes with
// the base rule deleted — and without `display:flex` the wrapper is a block and
// the globe sits ABOVE the hamburger. A bite-check found exactly that.
const waysRule = rule('.nav-ways');
H.ok(waysRule, '.nav-ways has a rule — a class with none is a layout nobody designed');
H.ok(/display:\s*flex/.test(waysRule),
  '⚠ and it is a flex ROW, or the two controls stack on top of each other');
H.ok(/align-items:\s*center/.test(waysRule), 'with them on one line');
H.ok(/gap:/.test(waysRule), 'and a gap, so they are two controls rather than one blob');
// ⚠ AND IT IS DECLARED ABOVE THE PHONE QUERY. The query narrows this same gap at
// the SAME specificity, so a base rule written after it wins at every width and
// the phone's figure never applies. It was, and nothing looked wrong — two pixels
// is not something anybody sees. The collision `.acc-field > label` and
// `.queue .who span` already paid for, arriving through source ORDER instead.
H.ok(bare.indexOf('.nav-ways{') < qAt,
  '⚠ the base rule comes before the phone query, or the query loses to it');
H.ok(/\.nav-ways\{[^}]*gap:\s*12px/.test(q),
  'and the query is what narrows the gap on a phone');
H.ok(/<div class="nav-ways">/.test(navJs), 'and the markup uses it');
// ⚠ IT WRAPS THE TWO WAYS OFF THE PAGE, and not the chip. Without a wrapper,
// space-between puts three gaps between three items instead of one gap between
// two groups — which is the same clump, spread out.
const ways = navJs.slice(navJs.indexOf('<div class="nav-ways">'), navJs.indexOf('</nav>'));
H.ok(ways.indexOf('lang-pick') !== -1, 'the globe is inside it');
H.ok(ways.indexOf('hamburger') !== -1, 'and so is the hamburger');
H.ok(ways.indexOf('nav-account') === -1,
  '⚠ and the account chip is NOT — it is the other group, or there is nothing to push apart');
const right = navJs.slice(navJs.indexOf('<div class="nav-right">'), navJs.indexOf('</nav>'));
H.ok(right.indexOf('nav-account') < right.indexOf('nav-ways'),
  'the chip leads, so it lands at the physical start and the hamburger keeps the end');
H.ok(/justify-content:space-between/.test(q.replace(/\s+/g, '')),
  '⚠ and the phone row pushes them apart');
// ⚠ THE SIDES DO NOT SWAP BETWEEN LANGUAGES. .nav-right is forced ltr so these
// controls keep ONE place whatever is on screen — the rule the language toggle
// was built on, and the reason the chip is at the physical start in all three.
H.ok(/\.nav-right\{[^}]*direction:ltr/.test(bare),
  'with .nav-right still forced ltr, so neither group changes side per language');
H.eq((rule('.nav-ways').match(/(^|[^-])(left|right)\s*:/g) || []).length, 0,
  'and nothing in the wrapper is physical');

H.done();
