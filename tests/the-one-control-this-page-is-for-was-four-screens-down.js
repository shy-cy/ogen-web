// What this defends against:
//
// ⚠ THE REGISTER BUTTON WAS FOUR SCREENS DOWN ON A PHONE.
//
// Measured, not guessed: on hebrew4kids at 375px the real button sits 2651px
// into a 4342px page — 61% down, four viewports of scrolling — and three screens
// down at 768px. The stacked order that puts it there is correct and is not what
// changed: a family reads what it is, when it is and what it costs BEFORE they
// are asked to act. What was wrong is that having decided, they had to go and
// find the control again.
//
// Asked for as "in activity page - to have a lower sticky button for
// registration".
//
// ⚠ THE HEIGHT IS A TOKEN, FOR THE REASON --nav-h IS ONE. Two rules key off it:
// the bar, and the room the page leaves underneath so the footer is not sitting
// behind a fixed panel. The first version spelled 72px into the second while the
// bar measured 74, and the footer's last three pixels went under it. One
// declaration moves both now, and this computes the sum from those same
// declarations rather than trusting the comment.
//
// ⚠ AND THE HIDE/SHOW COULD NOT BE MEASURED THE USUAL WAY. Chrome headless under
// --virtual-time-budget does not deliver IntersectionObserver callbacks, so a
// screenshot showed the bar sitting on top of the real button and the DOM said
// it was visible — both wrong. Driven over CDP against real Chrome with real
// frames it hides at display:none with the button in view and comes back when it
// scrolls away. The behaviour is executed in a-coming-soon-activity-has-no-button.js,
// where the callback is called directly; this file is the geometry.

const H = require('./_helpers');
const fs = require('fs');
const path = require('path');

const R = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(R, 'shared.css'), 'utf8');
const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
const js = fs.readFileSync(path.join(R, 'js/activity.js'), 'utf8');
// ⚠ FROM A GIVEN POINT, because .activity-sticky is declared TWICE on purpose —
// display:none for every width, then the real bar inside the 939px query. A
// helper that always takes the first match reads the desktop default and reports
// that the bar has no height, which is how this test first failed.
const ruleFrom = (sel, from) => {
  const at = code.indexOf(sel + '{', from || 0);
  return at === -1 ? '' : code.slice(at, code.indexOf('}', at));
};
const rule = (sel) => ruleFrom(sel, 0);
const px = (re, s) => { const m = re.exec(s || ''); return m ? parseFloat(m[1]) : NaN; };

console.log('[the bar has a rule at all]');
// A class with no rule is a layout nobody designed — .acc-evening-acts taught
// this, and the client puts this one on an element it creates.
H.ok(/\.activity-sticky\{/.test(code), '.activity-sticky is styled');
H.ok(/class = 'activity-sticky'|className = 'activity-sticky'/.test(js),
  'and that is the class the script actually writes');
H.ok(/\.activity-sticky\[hidden\]\{[^}]*display:none/.test(code.replace(/\s+/g, ' ').replace(/\{ /g, '{')),
  'hidden means display:none — the attribute alone loses to display:block');

console.log('\n[one query, the one the grid already stacks in]');
H.eq((css.match(/@media \(max-width:939px\)/g) || []).length, 1,
  '⚠ ONE 939px query, not a second beside it — two blocks with one condition is '
  + 'two places a rule for this layout can live');
const at939 = code.indexOf('@media (max-width:939px)');
H.ok(code.indexOf('.activity-sticky{', at939) > at939,
  'and the bar is declared inside it');
// Above the breakpoint the aside leads the trailing column and the button is
// about one screen down: nothing to solve, and a bar would only cost viewport.
const before = code.slice(0, at939);
H.ok(/\.activity-sticky\{\s*display:none/.test(before.replace(/\s+/g, ' ').replace(/\{ /g, '{ ')),
  'and it is display:none by default, so a desktop never draws one');

console.log('\n[the height is a token, and the arithmetic adds up]');
H.eq((code.match(/--sticky-h:/g) || []).length, 1, '--sticky-h is declared exactly once');
H.eq((code.match(/--sticky-pad:/g) || []).length, 1, 'and so is its padding');
const root939 = rule(':root');
const h = px(/--sticky-h:\s*(\d+(?:\.\d+)?)px/, code);
const pad = px(/--sticky-pad:\s*(\d+(?:\.\d+)?)px/, code);
H.ok(h > 0 && pad > 0, 'both are real numbers (' + h + ' / ' + pad + ')');
const bar = ruleFrom('.activity-sticky', at939);
const btn = ruleFrom('.activity-sticky .sidebar-cta', at939);
H.ok(/height:\s*calc\(var\(--sticky-h\)/.test(bar.replace(/\s+/g, ' ')),
  'the bar reads the token for its own height');
H.ok(/box-sizing:border-box/.test(bar), 'border-box, or the border is added on top of it');
// The control inside, and the border, have to fit the number the bar declares.
const btnH = px(/height:\s*calc\(var\(--sticky-h\) - var\(--sticky-pad\) \* 2 - (\d+)px\)/, btn.replace(/\s+/g, ' '));
H.eq(btnH, 1, 'the button is the bar less its padding and the 1px border');
const borderW = px(/border-block-start:\s*(\d+)px/, bar);
H.eq(borderW, 1, 'which is the border that is actually declared');
// ⚠ AND THE SUM IS NOT WORTH ASSERTING, WHICH IS THE POINT.
//
// The first version of this test computed `button = h - pad*2 - border` and then
// asserted `pad + button + pad + border === h` — algebraically always true, so it
// passed with --sticky-pad mutated and was caught by the bite-check rather than
// by reading it. The nav's equivalent assertion is NOT a tautology because there
// the parts are three separate literals that have to agree; here the button's
// height is DERIVED from the token in CSS, so the arithmetic cannot come apart.
//
// So what is checked is the property that makes that true: every figure in the
// bar reads the token, and none of them is a literal that could drift from it.
const button = h - pad * 2 - borderW;
H.ok(button > 0, 'the control has room left over (' + button + 'px of ' + h + ')');
[['the bar', bar], ['the button', btn]].forEach(([what, r]) => {
  const flat = r.replace(/\s+/g, '');
  H.ok(/height:calc\(var\(--sticky-h\)/.test(flat),
    '⚠ ' + what + '\'s height is calculated FROM the token, never spelled out beside it');
  H.eq((flat.match(/height:\s*\d+px/g) || []).length, 0,
    what + ' carries no literal height to disagree with it');
});
// ⚠ PER DECLARATION, NOT PER RULE. Asking whether the rule mentions the token
// anywhere passes on a height that has hard-coded 20px while the line-height
// beside it still reads var(--sticky-pad) — which a bite-check found. The box
// and the line box must be the SAME derived figure, or the label stops being
// centred the moment the padding moves.
const INNER = 'calc(var(--sticky-h)-var(--sticky-pad)*2-1px)';
['height', 'line-height'].forEach((prop) => {
  const m = new RegExp('(?:^|;)' + prop + ':([^;]+)').exec(btn.replace(/\s+/g, ''));
  H.ok(m, 'the button declares ' + prop);
  H.eq(m[1], INNER,
    '⚠ ' + prop + ' subtracts the SAME padding the bar applies, rather than a copy of it');
});
H.ok(/line-height:\s*calc\(var\(--sticky-h\)/.test(btn.replace(/\s+/g, ' ')),
  'and the label is centred by a line-height reading the same token, not a second figure');

console.log('\n[the page leaves exactly that much room, from the same token]');
const body = ruleFrom('body:has(.activity-sticky)', at939);
H.ok(body.length > 0, 'the page is padded at all');
H.ok(/padding-block-end:\s*calc\(var\(--sticky-h\)/.test(body.replace(/\s+/g, ' ')),
  '⚠ from the SAME token — a literal here is how the footer ended up 3px under the bar');
// `env(safe-area-inset-bottom, 0px)` carries a 0px FALLBACK, which is not a
// competing figure — it is what the expression means on a phone without a notch.
H.eq((body.replace(/env\([^)]*\)/g, '').match(/\d+px/g) || []).length, 0,
  'and there is no second figure in it to disagree with the first');
// The notch, in both places or in neither.
const safe = (s) => (s.match(/env\(safe-area-inset-bottom/g) || []).length;
H.ok(safe(bar) >= 1, 'the bar allows for the home indicator');
H.ok(safe(body) >= 1, 'and so does the room left for it, or the two differ on a phone with one');

console.log('\n[nothing in it is physical, and it lives where direction does]');
H.eq((bar.match(/(^|[^-])(left|right)\s*:/g) || []).length, 0,
  'the bar is placed with inset-inline, so it spans correctly in all three languages');
H.ok(/inset-inline:0/.test(bar), 'which is the declaration doing it');
H.ok(/border-block-start/.test(bar) && !/border-top/.test(bar),
  'and its rule is logical too');
H.ok(/getElementById\('page'\) \|\| document\.body/.test(js),
  '⚠ it is appended inside #page — rule 2 puts direction ONLY there, and a bar '
  + 'pinned to <body> would sit outside it');

console.log('\n[it fails open]');
H.ok(/if \(!window\.IntersectionObserver\) return;/.test(js),
  'no IntersectionObserver means no bar rather than a bar that never hides');
H.ok(/const real = root\.querySelector\('\.sidebar-cta'\);\s*\n\s*if \(!real\) return;/.test(js),
  'and no real button means nothing to copy or to watch');

H.done();
