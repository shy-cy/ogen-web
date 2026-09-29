// What this defends against: two faults on the same strip of buttons, reported
// in one breath from the admin's About editor.
//
// 1. H3 AND H4 WERE BLANK SQUARES. "I cannot see H3 and H4." They had just been
//    added to RICH_TOOLBAR and they were there, and clickable, and drew nothing
//    — because Quill 1.3.7's icon map is literally `header:{1:…,2:…}` and a
//    toolbar button whose value is not in it keeps an EMPTY innerHTML. Nothing
//    errored. The toolbar simply had two invisible controls between H2 and the
//    list buttons, which is worse than not offering the levels at all: a writer
//    who cannot see a control does not know the level exists, and a writer who
//    clicks the gap by accident cannot tell what happened.
//
//    ⚠ SO THE LABEL IS DERIVED FROM THE BUTTON'S OWN value, in ONE rule. A rule
//    per level is a rule that is right for the levels somebody remembered and
//    silently missing for the next one — which is exactly the state this bug
//    was, with Quill remembering two of them. The checks below are that there is
//    one rule and that no selector in the stylesheet names a level.
//
// 2. THE TOOLBAR SCROLLED AWAY. "When you scroll down the wysiwyg editor the
//    menu disappears." A body runs to several screens, so by the time there was
//    anything to format the controls for formatting it were off the top.
//
//    ⚠ AND `overflow:hidden` ON THE WRAPPER IS WHAT MADE IT IMPOSSIBLE. It was
//    there to clip the toolbar to the wrapper's rounded corners — which the
//    toolbar's own border-radius already does — and `overflow:hidden` makes a
//    box a scroll container, so a sticky child sticks within THAT box, which
//    never scrolls. Adding `position:sticky` on its own would have changed
//    nothing at all, with nothing to point at. The two cannot both be there, and
//    that is the pair this suite pins: the same shape as height:auto and
//    aspect-ratio on the card image, where one declaration silently disables the
//    other.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');

const R = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

const css = stripComments(read('admin/admin.css'));
const client = read('js/activities-admin.js');

// Every `selector { body }` in the file. Nested at-rules leave a stray match for
// the `@media …` line itself, which matches no selector we ask about.
const rules = [];
css.replace(/([^{}]+)\{([^{}]*)\}/g, (_, sel, body) => {
  rules.push({ sel: sel.trim().replace(/\s+/g, ' '), body: body });
  return '';
});
const matching = (re) => rules.filter((r) => re.test(r.sel));
const declaring = (re, prop) =>
  matching(re).filter((r) => new RegExp(prop + '\\s*:', 'i').test(r.body));

console.log('[the toolbar offers three levels, and all three are drawn]');

// The levels come off the toolbar itself rather than being listed here, so this
// is about whatever the toolbar offers today.
const toolbar = client.slice(client.indexOf('var RICH_TOOLBAR'),
                             client.indexOf(']', client.indexOf("['clean']")) + 1);
const levels = (toolbar.match(/header:\s*(\d+)/g) || []).map((m) => Number(m.replace(/\D/g, '')));
H.ok(levels.length >= 3, 'RICH_TOOLBAR offers ' + levels.length + ' heading levels: ' + levels.join(', '));
H.ok(levels.some((l) => l > 2),
  'and at least one of them is past the two Quill ships an icon for — which is the bug');

const label = declaring(/button\.ql-header::before/, 'content');
H.eq(label.length, 1, 'exactly one rule labels a heading button');
H.ok(/attr\(\s*value\s*\)/.test(label[0].body),
  "and it builds the label from the button's own value, so one rule covers every level");

// ⚠ THE CHECK THAT MAKES THE ONE ABOVE MEAN SOMETHING. A per-level rule would
// satisfy "there is a label" for the levels somebody wrote out and leave the
// next one blank — which is the bug, with Quill in the role of the author.
const perLevel = rules.filter((r) => /ql-header/.test(r.sel) && /\d/.test(r.sel));
H.eq(perLevel.length, 0,
  'and no selector in the stylesheet names a particular level: ' +
  perLevel.map((r) => r.sel).join(' / '));

// Quill DOES ship an icon for H2, so without this the word and the picture sit
// side by side in one button.
H.ok(declaring(/button\.ql-header svg/, 'display').some((r) => /display\s*:\s*none/.test(r.body)),
  "Quill's own heading icon is hidden, so the three buttons read alike");

console.log('\n[the toolbar follows the text down]');

const wrap = rules.filter((r) => r.sel === '.quill-wrap');
H.eq(wrap.length, 1, '.quill-wrap has one rule');
// ⚠ THE HALF THAT IS AN ABSENCE.
H.ok(!/overflow\s*:/.test(wrap[0].body),
  '.quill-wrap sets no overflow — which is what lets the toolbar stick at all');
H.ok(/border-radius/.test(wrap[0].body),
  'and it keeps its rounded corners, which is what the overflow was clipping to');

const bar = declaring(/\.quill-wrap .*\.ql-toolbar/, 'position');
H.eq(bar.length, 1, 'one rule positions the toolbar');
H.ok(/position\s*:\s*sticky/.test(bar[0].body), 'and it is sticky');
H.ok(/border-radius\s*:\s*8px 8px 0 0/.test(bar[0].body),
  'and it rounds its own top corners, so nothing has to clip it');

// ⚠ ONE TOKEN, TWO RULES. The sidebar has sat under the admin bar at 70px since
// this screen was built; the toolbar arrived needing the same number, and a
// second literal 70 is the shape --nav-h exists to stop on the public side —
// one moves, nothing errors, and the other sits under the bar.
H.ok(/--stick-top\s*:/.test(css), '--stick-top is declared');
const sidebar = rules.filter((r) => r.sel === '.sidebar');
H.eq(sidebar.length, 1, '.sidebar has one rule');
H.ok(/top\s*:\s*var\(--stick-top\)/.test(sidebar[0].body), 'the sidebar reads the token');
H.ok(/top\s*:\s*var\(--stick-top\)/.test(bar[0].body), 'and so does the toolbar');
// `.admin-bar{top:0}` is the chrome itself and is not measuring anything; every
// OTHER sticky top on this screen is "below the chrome", which is the one number.
const stickyTops = rules.filter((r) => /position\s*:\s*sticky/.test(r.body))
  .map((r) => ({ sel: r.sel, top: (r.body.match(/(?:^|;)\s*top\s*:\s*([^;]+)/) || [])[1] }))
  .filter((r) => r.top && r.top.trim() !== '0' && !/var\(--stick-top\)/.test(r.top));
H.eq(stickyTops.length, 0,
  'and nothing else sticks to a literal offset: ' +
  stickyTops.map((r) => r.sel + ' (top:' + r.top + ')').join(' / '));

// The bar it sits under has to stay on top of it, or the fix covers the chrome.
const adminBar = rules.filter((r) => r.sel === '.admin-bar')[0];
const z = (body) => Number((body.match(/z-index\s*:\s*(\d+)/) || [])[1]);
H.ok(z(bar[0].body) < z(adminBar.body),
  'the toolbar sits under the admin bar (' + z(bar[0].body) + ' < ' + z(adminBar.body) + ')');

H.done();
