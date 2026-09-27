// What this defends against:
//
// ⚠ A REDRAW OF THE GROUP SUB-PAGE THREW AWAY WHATEVER HAD BEEN TYPED INTO IT.
//
// Reported as "when I click on regenerate dates, the text in these fields
// disappears", on the trilingual "Instead of the schedule line" boxes.
// Regenerating was simply the redraw somebody happened to notice.
//
// The sub-page is repainted by FIVE things — regenerating the calendar, changing
// the frequency, adding a schedule row, removing one, and deleting or clearing
// dates — and only ONE of them read the form back before throwing the DOM away.
// So changing the frequency after typing a group's NAME lost the name, and every
// one of them lost the override sentence. Nothing errored; the boxes were simply
// empty again, which reads as a control that does not work.
//
// Two faults, and the second is the one that made the first survive:
//
//  1. The four handlers that repainted without capturing. This is the
//     undrawn-field trap in its other direction — not a field the form did not
//     draw, but a field the form drew and nobody read back.
//  2. ⚠ THE OVERRIDE SENTENCE WAS READ ONLY ON COMMIT. readOwnerEdit() skips
//     `schedule` on purpose, because commitOwnerEdit() rebuilds it from the
//     rows — but the sentence is not a row, it is typed prose, and reading it
//     off the DOM a second time in commit made the Back button the only path
//     that preserved it. One reader now, so every path does.
//
// ⚠ CHECKED BY SHAPE, because js/activities-admin.js has never been executed by
// anything — the state js/registrations-admin.js was in before tests/_dom.js
// grew enough to run it. A rule with call sites to count is a rule that grows an
// exception, so what is asserted is that NOTHING but the opener may reach the
// painter.

const H = require('./_helpers');
const fs = require('fs');
const path = require('path');

const R = path.join(__dirname, '..');
const raw = fs.readFileSync(path.join(R, 'js/activities-admin.js'), 'utf8');
// Comments explain the rule and would answer every search for it.
const src = raw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const fn = (name) => {
  const at = src.indexOf('function ' + name + '(');
  if (at === -1) return '';
  let d = 0, i = src.indexOf('{', at);
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (!d) return src.slice(at, j + 1); }
  }
  return '';
};

console.log('[one door to the painter]');
H.ok(fn('redrawOwnerPage'), 'there is a capturing redraw');
H.ok(fn('drawOwnerPage'), 'and the painter it wraps');
// Every call, less the declaration itself.
const calls = (src.match(/drawOwnerPage\(/g) || []).length
            - (src.match(/function drawOwnerPage\(/g) || []).length
            - (src.match(/redrawOwnerPage\(/g) || []).length;
H.eq(calls, 2,
  '⚠ the painter is called exactly twice — once inside the capturing redraw, once '
  + 'to OPEN the page, where there is nothing on screen yet to capture');
H.ok(/drawOwnerPage\(page\);/.test(fn('redrawOwnerPage')), 'the redraw paints');
H.ok(fn('openOwnerPage') === '' || /drawOwnerPage\(page\)/.test(fn('openOwnerPage')),
  'and the opener is the other one');

console.log('\n[and it captures BEFORE it paints]');
const redraw = fn('redrawOwnerPage');
H.ok(redraw.indexOf('readOwnerEdit()') !== -1, 'it reads the form');
// ⚠ `redrawOwnerPage(` CONTAINS `drawOwnerPage(`, so a bare indexOf finds the
// function's own name at position 8 and reports that it paints before it reads.
// The call is the one NOT preceded by `re`.
const paintAt = /(^|[^r])drawOwnerPage\(/.exec(redraw.slice(redraw.indexOf('{'))).index
              + redraw.indexOf('{');
H.ok(redraw.indexOf('readOwnerEdit()') < paintAt,
  '⚠ before painting, or the capture reads a DOM that is already gone');
// ⚠ mutate runs BETWEEN the two, which is the whole reason it takes one: adding
// or removing a row changes the list the capture just produced, and doing it the
// other way round reads the old list back over the change.
const mutateAt = redraw.indexOf('mutate', redraw.indexOf('readOwnerEdit()'));
H.ok(mutateAt > redraw.indexOf('readOwnerEdit()') && mutateAt < paintAt,
  'and the caller\'s change lands between the capture and the paint');

console.log('\n[every one of the five goes through it]');
// Each handler named by the thing that repaints, and found in the source rather
// than counted — a count would pass with the wrong five.
[['the frequency select', /freqSel\.addEventListener\('change',[\s\S]{0,220}?redrawOwnerPage\(/],
 ['adding a schedule row', /onAdd:[\s\S]{0,260}?redrawOwnerPage\(/],
 ['removing a schedule row', /onRemove:[\s\S]{0,260}?redrawOwnerPage\(/],
 ['editing the calendar', /onChange: function \(next, o\)[\s\S]{0,300}?redrawOwnerPage\(/],
 ['regenerating the dates', /rows\.length[\s\S]{0,400}?redrawOwnerPage\(/]
].forEach(([what, re]) => H.ok(re.test(src), what + ' repaints through the capturing door'));

console.log('\n[the override sentence has ONE reader]');
const reads = (src.match(/readLangField\(GROUP_PREFIX \+ '-schedule-overrideText'\)/g) || []).length;
H.eq(reads, 1,
  '⚠ read off the DOM in exactly one place — a second reader is how commit came '
  + 'to be the only path that kept it');
const read = fn('readOwnerEdit');
H.ok(/readLangField\(GROUP_PREFIX \+ '-schedule-overrideText'\)/.test(read),
  'and that place is the capture, so every redraw preserves it');
// The loop above it skips `schedule` on purpose; this is the field it skips past.
H.ok(/if \(key === 'schedule'\) return;/.test(read),
  'the fact loop still skips schedule, because commit rebuilds it from the rows');
H.ok(read.indexOf("if (key === 'schedule') return;")
   < read.indexOf("-schedule-overrideText"),
  'and the sentence is picked up after it, rather than by it');

console.log('\n[and commit takes it off the model, not the DOM again]');
const commit = fn('commitOwnerEdit');
H.ok(/overrideText: \(e\.facts\.schedule \|\| \{\}\)\.overrideText/.test(commit),
  '⚠ from what the capture produced — one reader, so Back and Regenerate agree');
H.ok(!/readLangField/.test(commit), 'commit reads no field of its own');
H.ok(/facts\.schedule = \{ frequency: e\.freq, sessions: rows,/.test(commit),
  'while still REBUILDING schedule, which is what makes a missing key a deletion');

console.log('\n[the guard matches the id the field is actually given]');
// A guard on an id nothing mints is a guard that is always false, which is this
// bug again with a fix in front of it.
H.ok(/\$\(GROUP_PREFIX \+ '-schedule-overrideText-he'\)/.test(read),
  'the capture guards on the Hebrew box');
H.ok(/GROUP_PREFIX \+ '-schedule-overrideText'\)/.test(src),
  'and the field is built under that prefix');
H.ok(/var id = idPrefix \+ '-' \+ lang;/.test(src),
  'and readLangField appends the language, so `-he` is a real id rather than a guess');

H.done();
