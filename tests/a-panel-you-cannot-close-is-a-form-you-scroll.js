// What this defends against: a form eleven panels long with no way to put any of
// it away, and the three ways the obvious fix would have broken it.
//
// Reported from the screen: "the whole activity area is becoming very long — I
// think it would be good if we have +/- to open/close sections, so areas we
// completed or don't need, we can hide them."
//
// ⚠ 1. A CLOSED PANEL MUST STILL BE READ BACK ON SAVE. This is the trap, and it
//    is the one this codebase keeps meeting: readForm() walks the DOM, so a
//    section collapsed by emptying its container — or by detaching it — is a
//    section published away by the next press of Save, with nobody having typed
//    anything. The group sub-page answered the same question the same way and
//    said so ("hidden rather than detached, because every editor on them holds
//    live nodes and ids that the read-back walks on save"). Collapsing here is a
//    class on the panel and CSS; the fields never move. The check below closes a
//    panel and then goes looking for the field inside it.
//
// ⚠ 2. THE HEADING MUST NOT CLOSE WITH THE PANEL. Eleven titles in a column is a
//    table of contents; eleven nothings is a form somebody has lost. It is also
//    what keeps a publish refusal actionable — the message names a field in a
//    panel that is shut, and the panel is one click away rather than gone.
//
// ⚠ 3. THE (i) MUST NOT BE INSIDE THE TOGGLE. A button inside a button is not
//    markup a browser keeps, and asking what a panel means would close the
//    panel. js/admin-help.js already preventDefaults for the same pairing beside
//    a checkbox's own label; here it is structural instead — the badge is a
//    sibling of the toggle, and after it, whichever script wired first.
//
// It is EXECUTED rather than read. Reading js/admin-collapse.js proves
// js/admin-collapse.js agrees with itself, which is this project's oldest lesson
// about its own tests — and every one of the three faults above looks perfectly
// correct in the source.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_helpers');
const D = require('./_dom');

const R = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const src = read('js/admin-collapse.js');
const css = stripComments(read('admin/admin.css'));
const markup = read('admin/activities.html');

// A page shaped like the real one: a plain panel, a panel whose heading already
// carries the (i) js/admin-help.js appends, the preview panel that opts out, and
// a child of .main that is not a panel at all.
function build(dom) {
  const root = dom.node('div');
  const main = dom.node('div');
  main.className = 'main';
  root.appendChild(main);

  function panel(id, heading, withBadge) {
    const p = dom.node('div');
    p.className = 'panel';
    if (id) p.setAttribute('id', id);
    const h2 = dom.node('h2');
    h2.appendChild(dom.document.createTextNode(heading));
    if (withBadge) {
      const b = dom.node('button');
      b.className = 'help';
      b.textContent = 'i';
      h2.appendChild(b);
    }
    p.appendChild(h2);
    const body = dom.node('div');
    body.className = 'fields';
    const input = dom.node('input');
    input.className = 'field-' + (id || heading.toLowerCase());
    input.value = heading + ' value';
    body.appendChild(input);
    p.appendChild(body);
    main.appendChild(p);
    return p;
  }

  const settings = panel(null, 'Settings', false);
  const seo = panel('seo-panel', 'Search & sharing', true);
  const preview = dom.node('div');
  preview.className = 'panel';
  preview.setAttribute('id', 'preview-panel');
  preview.setAttribute('data-no-collapse', '');
  const ph = dom.node('h2');
  ph.textContent = 'Preview';
  preview.appendChild(ph);
  main.appendChild(preview);
  const bar = dom.node('div');
  bar.className = 'action-bar';
  main.appendChild(bar);

  return { root, main, settings, seo, preview, bar };
}

function run(dom) {
  const ctx = vm.createContext({ window: dom.window, document: dom.document });
  vm.runInContext(src, ctx, { filename: 'js/admin-collapse.js' });
  return ctx.window.AdminCollapse;
}

const toggleOf = (panel) => panel.children[0].querySelector('.panel-toggle');

// --------------------------------------------------------------------------
console.log('[every panel gets a control, and it says what it is]');

const dom = D.makeDom({ pathname: '/admin/activities.html' });
const p = build(dom);
run(dom).wire(p.root);

[['Settings', p.settings], ['Search & sharing', p.seo]].forEach(([name, panel]) => {
  const btn = toggleOf(panel);
  H.ok(btn, 'the ' + name + ' panel has a toggle');
  H.eq(btn.tagName, 'BUTTON', 'it is a real button');
  H.eq(btn.getAttribute('type'), 'button', 'and not a submit');
  H.eq(btn.getAttribute('aria-expanded'), 'true', 'and it says the panel is open');
  H.ok(!panel.classList.contains('is-collapsed'), 'nothing starts closed');
});

H.ok(toggleOf(p.settings).textContent.indexOf('Settings') !== -1,
  'the toggle carries the heading\'s own words');
H.eq(toggleOf(p.preview), null,
  'the preview panel opts out — it is opened by its own button, and one that opened folded would read as one that failed');
H.eq(p.bar.children.length, 0, 'and a child of .main that is not a panel is untouched');

// ⚠ 3. The badge is a sibling, and after the toggle.
const seoH2 = p.seo.children[0];
H.eq(seoH2.children.length, 2, 'the heading holds two elements: the toggle and the (i)');
H.eq(seoH2.children[0].className, 'panel-toggle', 'the toggle is first');
H.eq(seoH2.children[1].className, 'help', 'and the (i) is beside it, not inside it');
H.eq(toggleOf(p.seo).querySelector('.help'), null,
  'nothing shaped like a button is nested in the toggle');
H.ok(toggleOf(p.seo).textContent.indexOf('i') === -1 ||
     toggleOf(p.seo).textContent.indexOf('Search & sharing') !== -1,
  'and the toggle still reads as the heading');

// --------------------------------------------------------------------------
console.log('\n[closing one, and what survives it]');

toggleOf(p.settings).click();
H.ok(p.settings.classList.contains('is-collapsed'), 'the panel is closed');
H.eq(toggleOf(p.settings).getAttribute('aria-expanded'), 'false', 'and says so');
H.ok(!p.seo.classList.contains('is-collapsed'), 'and its neighbour is not');

// ⚠ 1. THE ASSERTION THIS SUITE EXISTS FOR.
const field = p.settings.querySelector('.field-settings');
H.ok(field, 'the field inside the closed panel is still in the document');
H.eq(field.value, 'Settings value', 'still holding what was typed into it');
H.ok(p.settings.querySelector('.fields'), 'and its container was never emptied or detached');

// ⚠ 2.
H.ok(p.settings.children[0] && p.settings.children[0].tagName === 'H2',
  'the heading is still there');
H.ok(toggleOf(p.settings), 'and so is the control that reopens it');

toggleOf(p.settings).click();
H.ok(!p.settings.classList.contains('is-collapsed'), 'pressing it again opens the panel');
H.eq(toggleOf(p.settings).getAttribute('aria-expanded'), 'true', 'and says that too');

// --------------------------------------------------------------------------
console.log('\n[it is still closed tomorrow, and only on this screen]');

toggleOf(p.seo).click();
H.ok(p.seo.classList.contains('is-collapsed'), 'Search & sharing is closed');

const again = D.makeDom({ pathname: '/admin/activities.html' });
Object.assign(again._store, dom._store);
const p2 = build(again);
run(again).wire(p2.root);
H.ok(p2.seo.classList.contains('is-collapsed'), 'a reload finds it closed');
H.eq(toggleOf(p2.seo).getAttribute('aria-expanded'), 'false', 'and the control agrees');
H.ok(!p2.settings.classList.contains('is-collapsed'), 'and a panel nobody closed is open');

// The key carries the page, so folding up this form does not fold up the next
// screen's panels behind an admin's back.
const elsewhere = D.makeDom({ pathname: '/admin/registrations.html' });
Object.assign(elsewhere._store, dom._store);
const p3 = build(elsewhere);
run(elsewhere).wire(p3.root);
H.ok(!p3.seo.classList.contains('is-collapsed'),
  'a panel closed on one screen is not closed on another');

// Wiring twice must not wrap the heading twice — the second toggle would carry
// the first one and the words would be two buttons deep.
run(dom).wire(p.root);
H.eq(p.seo.children[0].children.length, 2, 'wiring again leaves the heading with two elements');
// ⚠ AND THAT COUNT IS NOT ENOUGH ON ITS OWN. A second pass that wrapped the
// first toggle would ALSO leave two, with the words two buttons deep — which is
// what the first version of this check missed.
H.eq(toggleOf(p.seo).querySelector('.panel-toggle'), null,
  'and no toggle is nested inside another');

// --------------------------------------------------------------------------
console.log('\n[it may only paint]');

const body = stripComments(src);
['removeChild', 'innerHTML', 'replaceChild', '.hidden'].forEach((bad) => {
  H.ok(body.indexOf(bad) === -1,
    'js/admin-collapse.js never reaches for ' + bad + ' — closing a panel is a class and nothing else');
});

// --------------------------------------------------------------------------
console.log('\n[and the classes it writes are classes somebody designed]');

const rules = [];
css.replace(/([^{}]+)\{([^{}]*)\}/g, (_, sel, b) => { rules.push({ sel: sel.trim().replace(/\s+/g, ' '), body: b }); return ''; });
const has = (needle) => rules.some((r) => r.sel.indexOf(needle) !== -1);

// Every class the module puts on an element, read off the module rather than
// listed here — the same check the family area's stylesheet already carries,
// because a class nobody styled is a layout nobody designed.
const written = [];
body.replace(/className = '([^']+)'/g, (_, c) => { written.push(c); return ''; });
written.push('is-collapsed');
[...new Set(written)].forEach((c) => {
  H.ok(has('.' + c), '.' + c + ' has a rule in admin.css');
});

// ⚠ A BASE RULE, not only :hover and ::before. A class whose only rules are
// state variants is still a control drawn as the browser's default button.
H.ok(rules.some((r) => r.sel === '.panel-toggle'),
  '.panel-toggle is styled as a control, not only in its states');

const collapsed = rules.filter((r) => /\.panel\.is-collapsed/.test(r.sel) && /display\s*:\s*none/.test(r.body));
H.eq(collapsed.length, 1, 'one rule hides a closed panel\'s contents');
H.ok(/:not\(h2\)/.test(collapsed[0].sel),
  'and it spares the heading by saying so, rather than by listing what to hide: ' + collapsed[0].sel);
H.ok(rules.some((r) => r.sel === '.panel.is-collapsed > h2' && /margin-bottom\s*:\s*0/.test(r.body)),
  'and the heading drops the margin it was keeping between itself and a body that is gone');
H.ok(!/#|\.fields|\.settings-grid/.test(collapsed[0].sel),
  'and it names no particular panel, so one that grows a new child closes with the rest');

console.log('\n[the page loads it, and the preview opts out]');
H.ok(/<script src="\/js\/admin-collapse\.js"><\/script>/.test(markup),
  'admin/activities.html loads the module');
H.ok(/id="preview-panel"[^>]*data-no-collapse/.test(markup),
  'and the preview panel carries the opt-out');

H.done();
