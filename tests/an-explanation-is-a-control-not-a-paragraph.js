// What this defends against:
//
// ⚠ THE ADMIN WAS MOSTLY PROSE ABOUT THINGS YOU WERE NOT CHANGING.
//
// Reported from QA with two of them circled on one screenshot: the Settings
// panel put a four-line paragraph under the Test activity checkbox and another
// under the "Part of" select, so a screen an admin opens to change one thing
// arrived as a wall of explanation. Every one of those sentences is there for a
// reason — most of them exist because somebody got something wrong once, and one
// of them was written the week before precisely because the previous wording
// left a question open. The words are not the problem. A sentence that is
// ALWAYS ON SCREEN is: it is read once, scrolled past forever, and it pushes the
// control it is about below the fold.
//
// So an explanation is a CONTROL: a small (i) beside the thing it is about, and
// the text on demand. Asked for as a rule across the whole admin, which is the
// only way it works — a tooltip on one screen and a paragraph on the next is
// worse than either, because an admin then has to learn which screens hide
// things.
//
// ⚠ AND NOT EVERY `.hint` IS AN EXPLANATION. That is the line this suite exists
// to hold. "Nobody has registered for this activity yet", "3 of 11 dates are
// going ahead", a bundle's computed total, "the code drawer did not load" — that
// is the screen telling you what is TRUE RIGHT NOW, and putting it behind a
// click hides the answer rather than the manual. What moves is the part that
// would read the same on an empty activity as on a full one. Several places
// were SPLIT rather than moved whole: the count stays and the paragraph about
// what a count means goes behind the (i).
//
// Three ways this could rot, and each is pinned below:
//
//   1. a second tooltip implementation on one screen, behaving differently;
//   2. a `.help` class with no rule in the stylesheet — the exact bug
//      `.acc-evening-acts` and `.ghost` were, one directory over;
//   3. a badge inside a <label>, where asking what a setting means would
//      CHANGE the setting.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_helpers');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');

const helpSrc = read('js/admin-help.js');
const css = read('admin/admin.css');
const PAGES = ['admin/index.html', 'admin/activities.html', 'admin/registrations.html',
               'admin/users.html', 'admin/families.html'];

console.log('[one builder, loaded by every admin page]');
H.ok(/function badge\(text, label\)/.test(helpSrc), 'js/admin-help.js holds the builder');
H.ok(/window\.AdminHelp = \{ badge: badge, wire: wire, close: close, setText: setText \};/.test(helpSrc),
  'and publishes exactly four things');

PAGES.forEach((p) => {
  const src = read(p);
  H.ok(src.indexOf('src="/js/admin-help.js"') !== -1, p + ' loads it');
  // After the session script, which is what every admin page already loads
  // first — a page that draws before it has the builder throws on the first
  // field with a hint, which is the right failure and a loud one.
  H.ok(src.indexOf('admin-session.js') < src.indexOf('admin-help.js'),
    '   after admin-session.js');
});

// ⚠ NOBODY ELSE BUILDS ONE. A second implementation is two tooltips that can
// behave differently on two screens, which is how this codebase came to have a
// checkbox meaning opposite things in two editors a release apart.
['js/activities-admin.js', 'js/registrations-admin.js'].concat(PAGES).forEach((p) => {
  const bare = read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  H.ok(!/class:\s*'help'|className\s*=\s*'help'/.test(bare),
    p + ' does not build its own (i)');
});

console.log('\n[it is a control, not a span with a handler]');
H.ok(/b\.type = 'button';/.test(helpSrc), 'a real <button>, so it is in the tab order');
H.ok(/b\.setAttribute\('aria-expanded', 'false'\);/.test(helpSrc), 'which says whether it is open');
H.ok(/b\.setAttribute\('aria-controls'/.test(helpSrc), 'and what it opens');
H.ok(/pop\.setAttribute\('role', 'note'\)/.test(helpSrc), 'and the popover announces itself');
// ⚠ THE CHECKBOX TRAP. Several of these badges sit beside a <label for="…">
// wrapping a checkbox. Without preventDefault, asking what "Test activity"
// means would tick it.
H.ok(/if \(e && e\.preventDefault\) e\.preventDefault\(\);/.test(helpSrc),
  '⚠ the click is prevented — a badge beside a checkbox label must not toggle it');

console.log('\n[a class nobody styled is a layout nobody designed]');
// The same check the family area learned the hard way with `.acc-evening-acts`,
// which had a name, a wrapper and no rule, and rendered three controls flush.
const bareCss = css.replace(/\/\*[\s\S]*?\*\//g, '');
['button.help{', '.help-pop{', '.label-row{'].forEach((sel) => {
  H.ok(bareCss.indexOf(sel) !== -1, sel + ' has a rule');
});
// Outlined, not filled: it sits beside a label and is not the thing to press.
// Solid fill plus a full pill is what this project reserves for an action.
H.ok(/button\.help\{[^}]*background:transparent/.test(bareCss),
  'the badge is outlined rather than filled, so it is not mistaken for the button it explains');

console.log('\n[⚠ and the wrapper did not silently break the cascade]');
// THIS IS THE HALF THAT FAILS QUIETLY. Putting the label inside a .label-row
// changes what a CHILD combinator matches — `.field-row > .field-label` was
// correct and stopped matching the moment the wrapper appeared, so the heading
// kept its text and lost its weight, its colour and its spacing, with nothing
// erroring. Exactly the collision `.acc-field > label` was in shared.css, and
// exactly as invisible.
//
// Checked by SHAPE rather than by looking for the fix: any rule that reaches a
// label from a container through `>` has to go through .label-row, or it is a
// rule that a hint turns off.
const rules = bareCss.split('}').map((b) => b.split('{')[0].trim()).filter(Boolean);
let checked = 0;
rules.forEach((sel) => {
  if (sel.charAt(0) === '@') return;
  sel.split(',').forEach((one) => {
    // Split rather than matched. A regex with `\S+` in front of an optional `>`
    // backtracks over every comment-stripped block that has no `>` in it at all,
    // and a test that takes minutes is a test somebody stops running.
    const parts = one.split('>').map((x) => x.trim());
    if (parts.length < 2) return;
    const last = parts[parts.length - 1];
    if (last !== '.field-label' && last !== 'label') return;
    checked++;
    H.eq(parts[parts.length - 2], '.label-row',
      'a label reached through > must be reached through .label-row, not "' + one.trim() + '"');
  });
});
H.ok(checked > 0, 'and the check found something to look at, rather than passing on an empty list');
// And the spacing the label gave up has to land on the wrapper, or every field
// on every admin screen closes up by five pixels.
H.ok(/\.label-row\{[^}]*margin-bottom:/.test(bareCss),
  'the wrapper carries the bottom margin the label used to');
H.ok(/\.fact-head > \.label-row\{[^}]*flex:1/.test(bareCss),
  'and the flex:1 that made a fact heading span its row moved out with it');

console.log('\n[no authored markup still carries a paragraph of explanation]');
PAGES.forEach((p) => {
  // Outside <script>, which is where the EMPTY STATES live — "No accounts yet"
  // is the screen answering a question rather than explaining itself.
  const markup = read(p).replace(/<script[\s\S]*?<\/script>/g, '');
  H.ok(!/class="hint"/.test(markup), p + ' has no hint paragraph left in its markup');
});
const hinted = PAGES.reduce((n, p) => n + (read(p).match(/data-hint="/g) || []).length, 0);
H.ok(hinted >= 7, 'and the explanations moved to data-hint attributes instead (' + hinted + ')');

console.log('\n[the split: what is TRUE RIGHT NOW stays on screen]');
// If this ever reads zero, somebody has hidden the answers along with the
// manual. These are counts, empty states and computed totals.
const regs = read('js/registrations-admin.js');
const acts = read('js/activities-admin.js');
[['Nobody has registered for this activity yet', regs],
 ['No published activities yet', regs],
 ['The code drawer did not load', regs],
 ['dates are going ahead', acts],
 ["id: 'bun-' + id + '-total'", acts]].forEach(([needle, src]) => {
  H.ok(src.indexOf(needle) !== -1, 'still said out loud: ' + needle);
});

// ---------------------------------------------------------------------------
// ⚠ EXECUTED. Reading the source proves the source is self-consistent; it can
// never prove that pressing the thing shows the words.
console.log('\n[pressing it]');

function makeNode(tag) {
  const n = {
    tagName: String(tag).toUpperCase(), childNodes: [], attributes: {}, style: {},
    className: '', textContent: '', _handlers: {},
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k] === undefined ? null : this.attributes[k]; },
    appendChild(c) { this.childNodes.push(c); c.parentNode = this; return c; },
    removeChild(c) {
      this.childNodes = this.childNodes.filter((x) => x !== c); c.parentNode = null; return c;
    },
    contains(c) {
      if (c === this) return true;
      return this.childNodes.some((x) => x.contains && x.contains(c));
    },
    addEventListener(ev, fn) { (this._handlers[ev] = this._handlers[ev] || []).push(fn); },
    getBoundingClientRect() { return { left: 40, top: 100, bottom: 116, right: 56 }; },
    offsetWidth: 300, offsetHeight: 80,
    click() {
      let prevented = false;
      (this._handlers.click || []).forEach((f) => f({
        preventDefault() { prevented = true; }, stopPropagation() {}, target: this
      }));
      return prevented;
    }
  };
  return n;
}

const body = makeNode('body');
const docHandlers = {};
const winHandlers = {};
const root = makeNode('div');
const doc = {
  body: body, readyState: 'complete',
  createElement: makeNode,
  addEventListener(ev, fn) { (docHandlers[ev] = docHandlers[ev] || []).push(fn); },
  querySelectorAll(sel) {
    H.eq(sel, '[data-hint]', 'wire() looks for exactly one selector');
    const out = [];
    (function walk(n) {
      (n.childNodes || []).forEach((c) => {
        if (c.getAttribute && c.getAttribute('data-hint') !== null) out.push(c);
        walk(c);
      });
    })(root);
    return out;
  }
};
const win = {
  innerWidth: 1200, innerHeight: 800,
  addEventListener(ev, fn) { (winHandlers[ev] = winHandlers[ev] || []).push(fn); }
};
const ctx = { document: doc, window: win, Math: Math, String: String, Array: Array };
vm.createContext(ctx);
vm.runInContext(helpSrc, ctx, { filename: 'js/admin-help.js' });
const AH = ctx.window.AdminHelp;
H.ok(AH && typeof AH.badge === 'function', 'the module published itself');

const pops = () => body.childNodes.filter((n) => n.className === 'help-pop');

const b1 = AH.badge('Publish it as usual and it behaves like any other activity.');
H.eq(b1.tagName, 'BUTTON', 'the badge is a button');
H.eq(b1.getAttribute('aria-expanded'), 'false', 'closed to begin with');
H.eq(pops().length, 0, 'and nothing is in the document yet — the words cost nothing until asked for');

H.eq(b1.click(), true, '⚠ the click is prevented, so a badge beside a checkbox label does not tick it');
H.eq(pops().length, 1, 'pressing it opens one popover');
H.eq(pops()[0].textContent, 'Publish it as usual and it behaves like any other activity.',
  'holding the words');
H.eq(b1.getAttribute('aria-expanded'), 'true', 'and the button says it is open');
H.eq(pops()[0].id, b1.getAttribute('aria-controls'), 'and points at it by id');

b1.click();
H.eq(pops().length, 0, 'pressing it again closes it');
H.eq(b1.getAttribute('aria-expanded'), 'false', 'and says so');

// ⚠ ONE AT A TIME. Two open popovers is two answers to "what is this", and the
// second one is about something else.
const b2 = AH.badge('A second term is a NEW activity.');
b1.click(); b2.click();
H.eq(pops().length, 1, 'opening a second closes the first');
H.eq(pops()[0].textContent, 'A second term is a NEW activity.', 'and it is the second one showing');
H.eq(b1.getAttribute('aria-expanded'), 'false', 'the first is marked closed too');

// Escape, and a click anywhere else.
(docHandlers.keydown || []).forEach((f) => f({ key: 'Escape' }));
H.eq(pops().length, 0, 'Escape closes it');
b2.click();
H.eq(pops().length, 1, 'open again');
(docHandlers.click || []).forEach((f) => f({ target: makeNode('div') }));
H.eq(pops().length, 0, 'and a click anywhere else closes it');
// But not a click INSIDE it — selecting the text must not dismiss the thing.
b2.click();
(docHandlers.click || []).forEach((f) => f({ target: pops()[0] }));
H.eq(pops().length, 1, 'while a click inside the popover leaves it open');
AH.close();

console.log('\n[the authored half goes through the same builder]');
const h2 = makeNode('h2');
h2.setAttribute('data-hint', 'Nothing here is published on the page.');
root.appendChild(h2);
AH.wire(doc);
H.eq(h2.childNodes.length, 1, 'wire() adds the badge to the heading');
H.eq(h2.childNodes[0].className, 'help', 'and it is the same (i)');
AH.wire(doc);
H.eq(h2.childNodes.length, 1, '⚠ and wiring twice adds nothing — a redraw must not stack badges');
h2.childNodes[0].click();
H.eq(pops()[0].textContent, 'Nothing here is published on the page.',
  'the attribute and the function produce the same control');
AH.close();

console.log('\n[a hint whose words change with the screen]');
// The Role select's description is the one, and it is why setText exists: a
// badge left holding the previous role would be worse than no badge at all.
const b3 = AH.badge('Super Admin');
b3.click();
AH.setText(b3, 'Editor · may edit Russian only');
H.eq(pops()[0].textContent, 'Editor · may edit Russian only',
  'the OPEN popover follows, rather than going on describing the previous choice');
AH.close();
H.ok(read('admin/users.html').indexOf('AdminHelp.setText(roleHelp') !== -1,
  'and the Role select is the one caller');

H.done();
