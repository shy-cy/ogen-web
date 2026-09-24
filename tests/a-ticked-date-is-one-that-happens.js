// The admin's session calendar drew a checkbox per generated date, and a TICKED
// box meant the class was NOT happening.
//
//     cb.checked = r.status === 'excluded';
//
// Each half was defensible on its own. The label said "No class this date", so
// tick-means-no-class was literally true; and the stored status has always been
// `excluded`, so the code read consistently. The pair was the problem. A column
// of dates is a list, and a tick in a list means "this one counts" — it is what
// every other checkbox in this admin means. So an admin scanning a term saw the
// two holidays lit up and the eleven teaching dates blank, and read it as a
// course that meets twice.
//
// ⚠ AND IT WAS WRITTEN TWICE, WORDED DIFFERENTLY. The activity's own calendar
// and a named group's were two editors built a release apart: one said "No
// class this date" and the other " not meeting", one had a box for the reason
// and the other dropped it on save, one struck the row through and the other
// did not. Both were inverted. Fixing it in one place and not the other was the
// likeliest outcome, which is why the two collapsed into one component first
// and the bug was fixed once.
//
// The third thing here is a gap rather than a bug: there was no way to DELETE a
// generated date. Unticking keeps it — deliberately, so it survives a
// regeneration with its reason — but an admin who generated weekly dates and
// then switched to a custom schedule could not clear them, because regeneration
// refuses on `custom` and there is nothing to enumerate. Eleven wrong dates,
// and the only tool was to untick all eleven, which stores eleven exclusions
// describing a term that never existed.
//
// This suite EXECUTES the editor. There is no DOM shim big enough to boot the
// whole activities admin — it wants an id index, an innerHTML parser and Quill
// — so the editor and el() are sliced out of the source and run in a vm against
// a DOM small enough to be honest about, the same technique the nav suite uses
// on its string table.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_helpers');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'activities-admin.js'), 'utf8');

// --- slice the two functions out -------------------------------------------
function slice(from, to) {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  H.ok(a !== -1 && b > a, 'found ' + from.trim().slice(0, 40));
  return src.slice(a, b);
}
const elSrc = slice('  function el(tag, attrs, children) {', '  var langObj =');
const calSrc = slice('  function sessionCalendarBox(opts) {', '  // Read a schedule editor');

// --- a DOM small enough to be honest about ----------------------------------
function node(tag) {
  const n = {
    tagName: String(tag).toUpperCase(),
    attributes: {}, childNodes: [], _text: '', _handlers: {}, _checked: false,
    get className() { return n.attributes['class'] || ''; },
    set className(v) { n.attributes['class'] = v; },
    get checked() { return n._checked; },
    set checked(v) { n._checked = !!v; },
    get disabled() { return n.attributes.disabled != null; },
    set disabled(v) { if (v) n.attributes.disabled = 'true'; else delete n.attributes.disabled; },
    get value() { return n.attributes.value || ''; },
    set value(v) { n.attributes.value = v; },
    get textContent() { return n._text + n.childNodes.map((c) => c.textContent).join(''); },
    set textContent(v) { n.childNodes.length = 0; n._text = String(v); },
    setAttribute(k, v) { n.attributes[k] = String(v); },
    getAttribute(k) { return k in n.attributes ? n.attributes[k] : null; },
    addEventListener(ev, fn) { (n._handlers[ev] = n._handlers[ev] || []).push(fn); },
    appendChild(c) {
      if (!c) throw new Error('appendChild(null) — el() is meant to filter those');
      n.childNodes.push(c); return c;
    },
    // A click with no handler is an error rather than a no-op: a button nobody
    // wired is exactly the kind of thing this suite exists to catch.
    click() {
      const hs = n._handlers.click || [];
      if (!hs.length) throw new Error('clicked a ' + n.tagName + ' with no click handler');
      hs.forEach((f) => f({ preventDefault() {} }));
    },
    change() {
      const hs = n._handlers.change || [];
      if (!hs.length) throw new Error('changed a node with no change handler');
      hs.forEach((f) => f({}));
    },
    input() { (n._handlers.input || []).forEach((f) => f({})); }
  };
  return n;
}
const all = (n, pred) => {
  const out = [];
  (function walk(x) { (x.childNodes || []).forEach((c) => { if (pred(c)) out.push(c); walk(c); }); })(n);
  return out;
};
const byClass = (n, c) => all(n, (x) => (x.className || '').split(/\s+/).indexOf(c) !== -1);
const boxes = (n) => all(n, (x) => x.tagName === 'INPUT' && x.attributes.type === 'checkbox');
const buttons = (n, label) =>
  all(n, (x) => x.tagName === 'BUTTON' && x.textContent.indexOf(label) !== -1);

const ctx = { document: { createElement: node }, window: H.adminHelpWindow(node), result: null };
vm.createContext(ctx);
vm.runInContext(elSrc + '\n' + calSrc + '\nresult = sessionCalendarBox;', ctx);
const sessionCalendarBox = ctx.result;

// --- the harness ------------------------------------------------------------
const LABELS = { generate: 'Generate sessions', regenerate: 'Regenerate from the schedule' };
function draw(dates, extra) {
  const state = { dates: dates.slice(), generated: 0 };
  state.box = sessionCalendarBox(Object.assign({
    prefix: 'sess', dates: state.dates, canEdit: true,
    lead: 'lead.', empty: 'empty.', generateLabel: LABELS,
    onGenerate: function () { state.generated++; },
    onChange: function (next) { state.next = next; }
  }, extra || {}));
  return state;
}
const TERM = [
  { date: '2026-10-14', status: 'scheduled', reason: '' },
  { date: '2026-10-21', status: 'excluded', reason: 'Sukkot' },
  { date: '2026-10-28', status: 'scheduled', reason: '' }
];

console.log('[⚠ a tick means the class HAPPENS]');
let s = draw(TERM);
let cbs = boxes(s.box);
H.eq(cbs.length, 3, 'one box per date');
H.eq(cbs[0].checked, true, '14 October is going ahead, so it is ticked');
H.eq(cbs[1].checked, false, 'Sukkot is not, so it is NOT ticked');
H.eq(cbs[2].checked, true, 'and 28 October is');
// The old behaviour, stated so the regression is named rather than implied.
H.ok(!(cbs[1].checked && TERM[1].status === 'excluded'),
  'the excluded date is not the ticked one — which is exactly what it used to be');

console.log('\n[and the row says so in words as well as in a box]');
H.eq(byClass(s.box, 'session-off-tag')[1].textContent, 'not meeting',
  'the date that is off is labelled, not left to the tick alone');
H.eq(byClass(s.box, 'session-off-tag')[0].textContent, '',
  'and the ones going ahead carry no tag — the absence of a warning IS the state');
H.eq(byClass(s.box, 'is-off').length, 1, 'exactly one row is styled as off');
H.ok(/2 of 3 dates are going ahead/.test(s.box.textContent),
  'and the summary counts the ones that HAPPEN, which is the number that is asked for');
H.ok(/Tick the dates it meets on/.test(s.box.textContent),
  'and the list says what a tick means rather than leaving it to be inferred');

console.log('\n[unticking excludes, ticking restores — and the stored word is unchanged]');
s = draw(TERM);
boxes(s.box)[0].checked = false;
boxes(s.box)[0].change();
H.eq(s.next[0].status, 'excluded', 'unticking stores `excluded`, as it always did');
H.eq(s.next[1].status, 'excluded', 'and leaves the others alone');
H.eq(s.next[2].status, 'scheduled', 'both of them');

s = draw(TERM);
boxes(s.box)[1].checked = true;
boxes(s.box)[1].change();
H.eq(s.next[1].status, 'scheduled', 'ticking a date that was off puts it back');
H.eq(s.next[1].reason, '', 'and drops the reason — a date that IS happening has none to give');

console.log('\n[the reason belongs to the date that is NOT happening]');
s = draw(TERM);
const whys = all(s.box, (x) => x.tagName === 'INPUT' && x.attributes.type === 'text');
H.eq(whys.length, 3, 'a reason box on every row');
H.eq(whys[1].value, 'Sukkot', 'the excluded one carries its reason');
H.eq(whys[0].value, '', 'and a date going ahead shows none');
H.eq(whys[0].disabled, true, 'nor can one be typed on it');
H.eq(whys[1].disabled, false, 'where the excluded one invites it');
// ⚠ The group's editor had NO reason box at all, so a reason typed on the
// activity survived and one typed on a group could not be typed.
whys[1].value = 'Hanukkah';
whys[1].input();
H.eq(s.next[1].reason, 'Hanukkah', 'and typing one is kept');

console.log('\n[⚠ DELETE IS A DIFFERENT ACT FROM UNTICKING]');
s = draw(TERM);
const dels = buttons(s.box, 'Delete');
H.eq(dels.length, 3, 'every row can be deleted');
dels[1].click();
H.eq(s.next.length, 2, 'the row is gone, not switched off');
H.eq(s.next.map((r) => r.date).join(','), '2026-10-14,2026-10-28', 'and it is the right one');
H.eq(s.next.filter((r) => r.status === 'excluded').length, 0,
  'nothing is left behind describing a date that should not be in the list');

console.log('\n[and the whole list can be cleared, which regeneration cannot always do]');
s = draw(TERM);
const clear = buttons(s.box, 'Clear all');
H.eq(clear.length, 1, 'there is one clear');
H.ok(/Clear all 3 dates/.test(clear[0].textContent),
  'and it names the number it is about to remove, because it cannot be undone');
clear[0].click();
H.eq(s.next.length, 0, 'the calendar is empty');
// The case this exists for: regeneration REPLACES the list, so a wrong
// frequency is usually fixed by regenerating — unless the new frequency is
// `custom`, which cannot be enumerated at all. Then there is nothing to
// regenerate from and the wrong dates stay until they can be deleted.
H.eq(buttons(draw([]).box, 'Clear all').length, 0,
  'and an empty calendar offers no clear — there is nothing to say yes to');

console.log('\n[the empty state offers the one thing that helps]');
s = draw([]);
H.eq(boxes(s.box).length, 0, 'no rows');
H.ok(/empty\./.test(s.box.textContent), 'the caller\'s own explanation is shown');
const gen = buttons(s.box, LABELS.generate);
H.eq(gen.length, 1, 'and a generate button');
gen[0].click();
H.eq(s.generated, 1, 'which is wired');
H.eq(buttons(draw(TERM).box, LABELS.regenerate).length, 1,
  'a calendar that already has dates says REgenerate instead');

console.log('\n[a role that may not edit the structure can press none of it]');
s = draw(TERM, { canEdit: false });
H.ok(boxes(s.box).every((b) => b.disabled), 'every tick is disabled');
H.ok(buttons(s.box, 'Delete').every((b) => b.disabled), 'and every delete');
H.eq(buttons(s.box, 'Clear all')[0].disabled, true, 'and the clear');
H.eq(buttons(s.box, LABELS.regenerate)[0].disabled, true, 'and the regenerate');

console.log('\n[⚠ THERE IS ONE OF THESE, NOT TWO]');
// The bug was worded two ways because it was written twice. Both editors call
// this builder now, and neither reads a checkbox back out of the DOM by id —
// which is what put the meaning of a tick in a second place that had to agree.
// ONE call site, because the two editors became one screen: the activity's own
// dates and a named group's are both "an owner's dates" now and open the same
// sub-page. It was two when the panels were still separate.
const calls = (src.match(/sessionCalendarBox\(\{/g) || []).length;
H.eq(calls, 1, 'there is one place a calendar is drawn');
H.eq((src.match(/function sessionCalendarBox/g) || []).length, 1, 'and there is one of it');
H.ok(!/-ex-/.test(src), 'the group editor no longer walks its checkboxes back by id');
H.ok(!/cb\.checked \? 'excluded'/.test(src),
  'and nothing reads a tick as an exclusion any more, in either editor');
// On COMMENT-STRIPPED source: the comments above the new component quote both
// old labels, on purpose, and a naive search finds them in the prose and fails
// whether or not either is still being rendered. Same rule the stylesheet's
// height:auto assertion follows, and for the same reason.
const bare = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
H.ok(!/No class this date/.test(bare),
  'the activity editor\'s old label is gone');
// The group's was a <label> reading " not meeting" with a leading space, beside
// a box that was ticked when it WAS not meeting. The surviving "not meeting" is
// the new tag: a span, no leading space, shown only on a row that is off.
H.ok(!/' not meeting'/.test(bare), 'and the group editor\'s');



// ---------------------------------------------------------------------------
// ⚠ AND THEN THE TWO EDITORS BECAME ONE SCREEN.
//
// An activity's schedule was edited inline in the Schedule panel with its own
// frequency select and its own row builder, its calendar inline in Duration,
// and a named group's on a sub-page. Three placements for one job, which is how
// the bug above came to be worded two different ways, and how a group on a
// custom schedule ended up unable to name its dates at all — only the inline
// builder ever grew the date field.
//
// There is one list now, WHO MEETS WHEN, and every row opens the same sub-page.
//
// ⚠ AND THE FIRST ROW IS A REAL GROUP. It was "Everyone" — a visible row
// standing for the activity's own timetable, which any unnamed group followed —
// because naming a group used to be what put a picker on the registration form
// and a name on the public page. That implicit default is gone: every activity
// has at least one group, it is renamable, and what decides whether a family is
// ASKED to choose is the COUNT. One group is not a choice however it is named.

console.log('\n[the list of the groups]');
const listSrc = ['function groupById', 'function groupLabel',
                 'function liveDates', 'function groupSummary']
  .map((name) => {
    const a = src.indexOf('  ' + name);
    H.ok(a !== -1, 'found ' + name);
    // Up to the next top-level function in the file.
    const b = src.indexOf('\n  function ', a + 1);
    return src.slice(a, b);
  }).join('\n');

const listCtx = {
  S: null,
  DAY_NAMES: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  out: null
};
vm.createContext(listCtx);
vm.runInContext(listSrc + '\nout = { groupSummary, groupLabel };', listCtx);
const L = listCtx.out;
const setState = (st) => { listCtx.S = st; };

const WED = { frequency: 'weekly', sessions: [{ day: 3, time: '16:00' }] };
const MON = { frequency: 'weekly', sessions: [{ day: 1, time: '16:00' }] };
const DATES = (n) => Array.from({ length: n }, (_, i) => ({ date: '2026-10-' + (14 + i * 7), status: 'scheduled' }));

const G = (over) => Object.assign({ groupId: 'g1', name: {}, capacity: null, facts: {} }, over);
const facts = (sch, dates) => ({
  schedule: sch, duration: { sessionDates: dates || [] }
});

console.log('  -- an activity with one class');
setState({ groups: [G({ facts: facts(WED, DATES(3)) })] });
H.eq(L.groupSummary(listCtx.S.groups[0]), 'Wednesday 16:00 \u00b7 3 dates', 'summarised on its row');
H.eq(L.groupLabel(listCtx.S.groups[0]), 'Unnamed group',
  '\u26a0 and it needs no name: one group offers no choice, so nothing is published ' +
  'and nobody is asked');

console.log('  -- and one with two, each on its own days');
setState({ groups: [
  G({ groupId: 'g1', name: { he: 'מתחילים', en: 'Beginners', ru: '' }, capacity: 7,
      facts: facts(MON, DATES(3)) }),
  G({ groupId: 'g2', name: { he: '', en: 'Advanced', ru: '' }, capacity: 10,
      facts: facts(WED, DATES(3)) })
] });
H.eq(listCtx.S.groups.map(L.groupLabel).join(', '), 'Beginners, Advanced', 'both are listed by name');
H.eq(L.groupSummary(listCtx.S.groups[0]), 'Monday 16:00 \u00b7 3 dates \u00b7 up to 7',
  'with its own timetable and its own places');
H.eq(L.groupSummary(listCtx.S.groups[1]), 'Wednesday 16:00 \u00b7 3 dates \u00b7 up to 10',
  '\u26a0 and the other its own \u2014 there is no shared default left for either to inherit');

console.log('  -- a group half set up says which half');
setState({ groups: [G({ facts: facts(MON, []) })] });
H.eq(L.groupSummary(listCtx.S.groups[0]), 'Monday 16:00 \u00b7 no dates',
  'a schedule with no calendar generated yet');
setState({ groups: [G({ facts: facts({ sessions: [] }, []) })] });
H.eq(L.groupSummary(listCtx.S.groups[0]), 'No schedule yet \u00b7 no dates',
  'and a brand-new activity says both');

console.log('  -- an excluded date is not one they meet on');
setState({ groups: [G({ facts: facts(WED, DATES(3).concat([{ date: '2026-11-11', status: 'excluded' }])) })] });
H.eq(L.groupSummary(listCtx.S.groups[0]), 'Wednesday 16:00 \u00b7 3 dates',
  'the count is the dates that happen, which is the same list the page prints');

H.eq(L.groupLabel({ name: { he: 'מתחילים', en: '', ru: '' } }), 'מתחילים',
  'and a group named in one language is labelled by it');

console.log('\n[⚠ nothing about an owner is read back off the main form any more]');
// The panels that used to hold these fields do not draw them, and the sub-page
// is hidden — not detached — while the main form is up. A save that walked the
// DOM would find nothing and clear the schedule, the calendar, every group name
// and every capacity. This is the undrawn-field trap this project keeps meeting,
// and the answer is the same every time: the model is the record.
H.ok(/rec\.groups = S\.groups \|\| \[\];/.test(src), 'the groups are saved from the model');
const reads = src.slice(src.indexOf('function readFacts'), src.indexOf('function listSpec'));
H.ok(!/sessionDates|S\.schedule/.test(reads),
  'and the main form\'s read-back mentions no calendar at all, because it draws none');
H.ok(!/\$\('fact-schedule-frequency'\)/.test(src),
  'and the id the old inline frequency select carried is referenced nowhere');
H.ok(!/fact-duration-/.test(src),
  'nor the activity-level duration ids, now that the dates belong to a group');

// The model has to be loaded before the facts panel draws, because that panel
// draws the group list and the price preview inside it reads a group's session
// length.
H.ok(/function renderFacts\(\) \{\s*\n\s*primeGroups\(\);/.test(src),
  'and it is primed before the first panel is drawn');

console.log('\n[a frequency that names a count gets exactly that many rows]');
// The activity's inline editor padded and trimmed to spec.sessions and a
// group's did not, so a group could be "twice weekly" with one day — half a
// term enumerated, nothing erroring. One editor, one rule.
const ownerPage = src.slice(src.indexOf('function drawOwnerPage'),
                            src.indexOf('function generateOwnerSessions'));
H.ok(/while \(e\.sessions\.length < wanted\)/.test(ownerPage), 'short rows are padded');
H.ok(/e\.sessions = e\.sessions\.slice\(0, wanted\)/.test(ownerPage), 'and extra ones trimmed');
H.ok(/onAdd: wanted \? null :/.test(ownerPage),
  'and a fixed-count frequency offers no Add, which is what made the two disagree');

H.done();
