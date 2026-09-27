// What this defends against:
//
// The evenings table on a family's registration page is five columns — date,
// status, to pay, paid, and the controls. A table column takes whatever is left
// over, and on a phone what was left over was the column the row exists for: at
// 375px the actions cell came out 65px wide and "תשלום על המפגש" rendered as
// three stacked fragments, each a word or two of a label, in a cell already half
// off the side of the screen.
//
// Reported from a phone with a screenshot: "check the text with the links at the
// side. It's unclear what it says or what the action is."
//
// Two separate faults, and fixing either alone leaves the other:
//
//   - a CONTROL'S LABEL was allowed to fragment. `.acc-actions` already wraps,
//     so there was never a reason for a label to break inside itself.
//   - and the table then does not FIT. `.acc-scroll` turns that into a sideways
//     swipe, which on the page whose job is paying hides the pay button behind a
//     gesture nobody is told about — the invite button labelled with a
//     description, one screen over.
//
// So below 700px an evening is a block. 700 is measured rather than chosen, and
// it is Russian that sets it: see the note in shared.css.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_helpers');
const D = require('./_dom');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const css = read('shared.css');
// Comment-stripped: this file's own prose names what it forbids, and a naive
// search finds the words in the explanation and passes either way.
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
const ui = read('js/member-account.js');

const LANGS = ['he', 'en', 'ru'];
const strings = (lang) => {
  const from = ui.indexOf('var T = {');
  const to = ui.indexOf('}[lang];', from) + '}[lang];'.length;
  const ctx = { lang: lang };
  vm.runInNewContext(ui.slice(from, to) + '\nresult = T;', ctx);
  return ctx.result;
};

console.log('[a label is never broken inside itself]');
const nowrap = bare.match(/\.acc-evenings \.acc-link\{[^}]*\}/);
H.ok(nowrap !== null, 'there is a rule for the controls in this table');
H.ok(/white-space:\s*nowrap/.test(nowrap[0]),
  'and it keeps each label on one line — the ROW wraps, the WORD does not');

console.log('\n[only the evenings table stacks]');
// The other two .acc-table uses are three short cells with no header row —
// a course's session list and a bundle's dates. Stacking those would turn one
// readable line into three for no gain, so the query is scoped by a class
// rather than applied to every table in the family area.
const tables = (ui.match(/el\('table', \{ class: '([^']*)' \}/g) || []);
H.eq(tables.length, 3, 'there are three tables in the family area');
H.eq(tables.filter((t) => /acc-evenings/.test(t)).length, 1,
  'and exactly one of them is the evenings table');
H.ok(/el\('table', \{ class: 'acc-table acc-evenings' \}/.test(ui),
  'which keeps .acc-table and adds the scope');

console.log('\n[the header row can be hidden, so the cells carry their own headings]');
H.ok(/el\('tr', \{ class: 'acc-thead' \}/.test(ui), 'the header row is marked');
// ⚠ THE SAME STRINGS, not a second set. A reworded column must not leave the
// stacked view naming something else, so the label and the heading are one key.
[['statusCol'], ['owes'], ['paid']].forEach(([key]) => {
  H.ok(new RegExp("'data-label': T\\." + key).test(ui),
    'the ' + key + ' cell is labelled from the same T.' + key + ' its <th> uses');
  H.ok(new RegExp("text: T\\." + key).test(ui), 'and that <th> still exists');
});
// The date is the block's heading and the controls are controls; a label on
// either is a word nobody needs.
H.ok(/class: 'acc-td-date'/.test(ui) && !/'acc-td-date'[^)]*data-label/.test(ui),
  'the date cell is the heading and takes no label');
H.ok(/class: 'acc-td-acts'/.test(ui) && !/'acc-td-acts'[^)]*data-label/.test(ui),
  'and the controls take none either');

console.log('\n[below the breakpoint the row is a block]');
const at = bare.indexOf('@media (max-width:700px)');
H.ok(at !== -1, 'there is a query, and it is at 700px');
const q = bare.slice(at, bare.indexOf('\n}', at) + 2);
H.ok(/\.acc-evenings \.acc-thead\{[^}]*display:\s*none/.test(q), 'the header row is hidden');
H.ok(/\.acc-evenings,[^{]*tr\{[^}]*display:\s*block/.test(q), 'and each row becomes a block');
H.ok(/\.acc-evenings td\{[^}]*display:\s*flex/.test(q), 'each cell a labelled line');
// ⚠ ATTRIBUTE-GUARDED. content:attr() on a cell with no data-label is an empty
// box, and an empty box in a flex row is a stray gap before the date.
H.ok(/td\[data-label\]::before/.test(q) && !/[^\]]td::before/.test(q),
  'and ::before fires only where there IS a label');
H.ok(/\.acc-evenings \.is-num\{[^}]*text-align:\s*start/.test(q),
  'end-alignment is right in a column of figures and wrong on a labelled line');
H.ok(/\.acc-evenings \.acc-date-why\{[^}]*flex:\s*1 0 100%/.test(q),
  'and the late-price note keeps a line of its own, as it does in the picker');

console.log('\n[nothing directional, and nothing physical]');
H.ok(!/(padding|margin)-(left|right):/.test(q), 'the query pads logically');
H.ok(!/text-align:\s*(left|right)/.test(q), 'and aligns logically');

// --------------------------------------------------------------------------
// ⚠ EXECUTED, because reading the source proves the source agrees with itself.
// The cells are lifted out of paint() and run, so a label that is set on the
// wrong cell — or not set at all — is caught by building the row rather than by
// matching a string near it.
console.log('\n[built, in all three languages]');
LANGS.forEach((lang) => {
  const dom = D.makeDom({ lang: lang });
  const box = dom.node('div');
  const T = strings(lang);
  const ctx = vm.createContext({
    document: dom.document, T: T,
    money: (c) => '€' + (Number(c) / 100).toFixed(2),
    dayMonth: (d) => d,
    eveningAction: () => null,
    data: {}, r: {}, act: {}, draw: () => {}, balance: 0, box: box
  });
  vm.runInContext(
    ui.slice(ui.indexOf('  function el(tag, attrs, kids) {'), ui.indexOf('  function clear(')) +
    'this.el = el;', ctx);
  const lineAt = (needle) => {
    const i = ui.indexOf(needle);
    H.ok(i !== -1, 'paint() still has ' + needle);
    return ui.lastIndexOf('\n', i) + 1;
  };
  const cells = ui.slice(lineAt('dayMonth(s.date)'), lineAt('[eveningAction('));
  const s = { date: '2026-10-06', status: 'booked', priceBasis: 'late',
              owedCents: 1000, paidCents: 0, standardPriceCents: 700 };
  vm.runInContext('var s = ' + JSON.stringify(s) + ';\n' +
                  'box.appendChild(el("tr", {}, [' + cells + 'null]));', ctx);
  // The shim has no querySelectorAll on a node; the row is the only child
  // and its cells are its children, which is all this needs.
  const tds = box.children[0].children.filter((c) => c.tagName === 'TD');
  H.eq(tds.length, 4, lang + ': four cells before the controls');
  H.eq(tds[0].getAttribute('data-label'), null, lang + ': the date carries no label');
  H.eq(tds[1].getAttribute('data-label'), T.statusCol, lang + ': status is labelled "' + T.statusCol + '"');
  H.eq(tds[2].getAttribute('data-label'), T.owes, lang + ': to-pay is labelled "' + T.owes + '"');
  H.eq(tds[3].getAttribute('data-label'), T.paid, lang + ': paid is labelled "' + T.paid + '"');
  // Every label is real copy in that language rather than a key that fell
  // through — the same check the refusals table gets.
  [T.statusCol, T.owes, T.paid].forEach((w) => {
    H.ok(typeof w === 'string' && w.trim() !== '', lang + ': "' + w + '" is a real string');
  });
});

H.done();
