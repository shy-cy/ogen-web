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
H.ok(/height:\s*96px/.test(navRule), 'and is still 96px — .hero, .mobile-menu and .thankyou key off it');

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
H.ok(/height:\s*78px/.test(img), 'at the height the desktop bar has always used');

console.log('\n[nothing directional was introduced]');
// The bar is laid out physically on purpose — the toggle must not move between
// languages — but its own spacing is still logical, so a future edit does not
// have to remember which side is which.
H.ok(/padding-inline/.test(navRule) && !/padding-(left|right)/.test(navRule),
  'the nav pads with a logical property');
H.ok(/direction:\s*ltr/.test(navRule),
  'and is forced ltr, so [עב][EN][RU] keeps one place in all three languages');
H.ok(/direction:\s*ltr/.test(rule('.nav-right')), '.nav-right still says so itself');

H.done();
