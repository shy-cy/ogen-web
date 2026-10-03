// What this defends against:
//
// An activity whose groups keep DIFFERENT timetables published one table per
// group, stacked, captioned by group. That is honest and it is a wall: on
// bnei-mitzvah-2027 it is twelve dated rows in two blocks, and a family belongs
// to exactly one of them. Asked for as tabs, one per group, named by group.
//
// ⚠ THE WHOLE RISK IS THAT TABS HIDE THINGS. Every mechanism that shows one
// panel is a mechanism that hides the rest, and two of the three obvious ways to
// build it hide a group's dates from somebody permanently:
//
//   - a SERVER-RENDERED tab strip is a row of dead buttons when the script does
//     not run, and only the selected panel is reachable at all;
//   - rendering only the selected panel server-side hides the other group from a
//     reader with no JavaScript and from a crawler.
//
// So the markup is complete and stacked, and js/activity.js rearranges it. The
// contract asserted here is the one js/calendar.js already keeps: a throw
// anywhere leaves what was served exactly as it was. That is checked on SOURCE
// ORDER, because no rendered result can see it — a run that does not throw
// produces an identical DOM either way, which is how the month grid shipped
// built and never drawn.
//
// It also pins the consequence of the time column: two groups meeting on
// IDENTICAL dates at different hours are no longer one table. They used to be
// merged, which was right for at most one of them.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');
const F = require('./_fixtures');
const template = require('../netlify/functions/_activity-template');
const facts = require('../netlify/functions/_activity-facts');
const { migrate } = require('../netlify/functions/_activity-migrate');

const R = path.join(__dirname, '..');
const client = fs.readFileSync(path.join(R, 'js/activity.js'), 'utf8');
const cssRaw = fs.readFileSync(path.join(R, 'shared.css'), 'utf8');
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');
const render = (a, lang) => template.renderActivityPage(migrate(a), lang);
const LANGS = ['he', 'en', 'ru'];

// Two groups, same dates, DIFFERENT hours — the shape the time column split.
function twoGroups(opts) {
  const a = F.course();
  const first = a.groups[0];
  const second = JSON.parse(JSON.stringify(first));
  second.groupId = 'g-advanced';
  second.name = F.lang('מתקדמים', 'Advanced', 'Продолжающие');
  first.name = F.lang('מתחילים', 'Beginners', 'Начинающие');
  const dates = [{ date: '2026-10-14', status: 'scheduled' },
                 { date: '2026-10-21', status: 'scheduled' }];
  first.facts.duration.sessionDates = JSON.parse(JSON.stringify(dates));
  second.facts.duration.sessionDates = JSON.parse(JSON.stringify(
    (opts && opts.dates) || dates));
  first.facts.schedule = { frequency: 'weekly', sessions: [{ day: 3, time: '16:00' }] };
  second.facts.schedule = { frequency: 'weekly',
    sessions: [{ day: 3, time: (opts && opts.time) || '18:00' }] };
  a.groups.push(second);
  return a;
}

console.log('[one group is not a choice, and renders exactly as it always has]');
const one = F.course();
LANGS.forEach((lang) => {
  const html = render(one, lang);
  H.ok(html.indexOf('data-session-tabs') === -1,
    lang + ': a single-group activity ships no tab container');
  H.ok(html.indexOf('session-panel') === -1, lang + ': and no panels');
  H.ok(html.indexOf('session-heading') === -1,
    lang + ': and no separate heading — the table\'s own caption is still the heading');
  H.eq((html.match(/<table class="session-table">/g) || []).length, 1,
    lang + ': one table');
});

console.log('\n[two groups that differ ship as panels, all of them, in the HTML]');
const two = twoGroups();
LANGS.forEach((lang) => {
  const html = render(two, lang);
  H.eq((html.match(/<table class="session-table">/g) || []).length, 2,
    lang + ': BOTH tables are served — nothing waits for JavaScript to exist');
  H.eq((html.match(/class="session-panel"/g) || []).length, 2,
    lang + ': each is wrapped in a panel the strip can point at');
  H.ok(html.indexOf('data-session-tabs') !== -1, lang + ': the container is marked');
  H.ok(html.indexOf('class="session-heading"') !== -1,
    lang + ': and the band keeps one heading, so the strip has something to be labelled by');
  H.ok(html.indexOf('<button') === -1 || !/role="tab"/.test(html),
    lang + ': NO tab strip is server-rendered — it would be dead buttons without the script');
  // Both rows' hours are present, which is the thing a reader with no script
  // would otherwise have to guess at.
  H.ok(/<td>16:00<\/td>/.test(html) && /<td>18:00<\/td>/.test(html),
    lang + ': and each group\'s own hour is in its own table');
});

const en = render(two, 'en');
H.ok(/data-session-title="Beginners"/.test(en), 'the panel names its group, for the tab');
H.ok(/data-session-title="Advanced"/.test(en), 'both of them');
H.ok(en.indexOf('<caption>Beginners</caption>') !== -1,
  'and stacked, the caption is the group name — the band heading above says what the list IS');
H.ok(en.indexOf('<p class="session-heading">Session dates</p>') !== -1,
  'said once, not once per table');

console.log('\n[groups that agree are still ONE table, and tabs do not appear]');
const same = twoGroups({ time: '16:00' });
H.eq((render(same, 'en').match(/<table class="session-table">/g) || []).length, 1,
  'identical dates AND identical hours collapse, exactly as before');
H.ok(render(same, 'en').indexOf('data-session-tabs') === -1,
  'so there is nothing to tab between and no strip is asked for');
// ⚠ The half the time column changed. These two were MERGED before, into one
// table that was right for at most one of the groups.
H.eq((render(twoGroups({ time: '18:00' }), 'en').match(/<table class="session-table">/g) || []).length, 2,
  'identical dates at DIFFERENT hours now split — they describe different meetings');

console.log('\n[the client enhances what was served, and can only fail open]');
H.ok(/try\s*\{[\s\S]*data-session-tabs/.test(client),
  'the whole block is inside a try, so a throw cannot leave the page half-built');
H.ok(/catch\s*\(err\)\s*\{[\s\S]*session tabs not built/.test(client),
  'and it says so rather than failing silently');
// ⚠ ORDER, NOT PRESENCE. A run that does not throw builds an identical DOM
// whichever way round these go, so only the source can say which happens first.
const attach = client.indexOf('split.parentNode.insertBefore(strip, split)');
const firstHide = client.indexOf('panels[n].hidden');
const firstSelect = client.indexOf('select(0, false)');
H.ok(attach !== -1 && firstSelect !== -1, 'the strip is attached and a tab is selected');
H.ok(attach < firstSelect,
  'the strip is attached BEFORE anything is hidden — so the only state a throw can leave is every panel visible');
// Definition order is not execution order, so what is checked is that hiding
// happens in exactly ONE place — select() — and that the first call to it comes
// after the strip is on the page. A second `hidden =` anywhere would be a second
// path that could run before the strip exists.
H.ok(firstHide !== -1, 'select() is the thing that hides');
H.eq((client.slice(client.indexOf('--- 4.')).match(/\.hidden = /g) || []).length, 1,
  'and it is the only place in this block that hides anything');
H.ok(client.indexOf('strip.addEventListener') < attach,
  'the handlers are wired before attachment, but they only run on a press — nothing hides on load before the strip is there');
H.ok(/panels\.length > 1/.test(client),
  'one panel is not a choice, so no strip is built for it');

console.log('\n[a real tab control, not styled divs]');
[['role\', \'tablist', 'the strip is a tablist'],
 ['role\', \'tab\'', 'each control is a tab'],
 ['role\', \'tabpanel', 'each table is a panel'],
 ['aria-controls', 'a tab names the panel it shows'],
 ['aria-labelledby', 'and the panel names the tab'],
 ['aria-selected', 'the selected one is announced as selected']
].forEach(([needle, why]) => H.ok(client.indexOf(needle) !== -1, why));
H.ok(/tab\.type = 'button'/.test(client),
  '⚠ type="button" — the default inside a form is submit, the trap the admin (i) badge already met');
H.ok(/tab\.tabIndex = on \? 0 : -1/.test(client),
  'roving tabindex: one stop for the strip, arrows move within it');
H.ok(/'Home'/.test(client) && /'End'/.test(client), 'Home and End work');
H.ok(/tab\.focus\(\)/.test(client), 'and the arrow keys move focus, not just the selection');
// ⚠ A browser does not flip ArrowLeft in a right-to-left page. Nothing in the
// stylesheet can answer this one.
H.ok(/direction === 'rtl'/.test(client),
  'the arrows follow what is on screen: in Hebrew LEFT moves forward through the strip');

console.log('\n[styled, and in one direction-agnostic rule]');
['.session-heading', '.session-tabs', '.session-panel'].forEach((sel) => {
  H.ok(css.indexOf(sel) !== -1, sel + ' has a rule — a class nobody styled is a layout nobody designed');
});
H.ok(/\.session-split\.has-tabs \.session-table caption\{[^}]*display:none/.test(css.replace(/\s+/g, ' ').replace(/ \{/g, '{')) ||
     /has-tabs[\s\S]{0,80}display:none/.test(css),
  'as tabs the captions are hidden, because the strip already carries the names');
const block = (cssRaw.match(/ONE TABLE PER GROUP, AS TABS[\s\S]*?has-tabs \.session-table caption\{[^}]*\}/) || [''])[0]
  .replace(/\/\*[\s\S]*?\*\//g, '');
H.ok(block.length > 0, 'the tab block is findable');
H.ok(!/(^|[;{\s])(left|right|margin-left|margin-right|padding-left|padding-right|border-left|border-right)\s*:/.test(block),
  'not one physical inset in it — one rule reads correctly in all three languages');
H.ok(block.indexOf('--terracotta') === -1,
  '⚠ the selected tab is NOT terracotta: it marks which table you are reading, and terracotta is reserved for the one thing on the page you can act on');
H.ok(/focus-visible/.test(block), 'and keyboard focus is visible');

// ⚠ A ROW OF WORDS IS NOT A CONTROL. The strip was two bare labels with a 2px
// rule under the selected one, and it was reported as unclear — two long group
// names four pixels apart read as one run-on line, and the only thing saying
// either could be PRESSED was a marker a reader has to already know how to read.
// What replaced it is a segmented control, and these are the three properties
// that make it one rather than the three declarations that happen to do it
// today.
const selected = (block.match(/aria-selected="true"\]\{([^}]*)\}/) || ['', ''])[1];
H.ok(/background/.test(selected),
  '⚠ the chosen tab is a GROUND, not a line: figure against ground is what reads as chosen before a word is');
const strip = (block.match(/\.session-tabs\{([^}]*)\}/) || ['', ''])[1];
H.ok(/background/.test(strip),
  'and the set sits in a track — what says these belong together and that one of them is on');
H.ok(/inline-flex/.test(strip),
  'which hugs its labels rather than spanning the band: a track as wide as the card with two chips at one end is the detachment that made this unclear');
// Solid fill plus a FULL pill is the one shape this page reserves for the thing
// you can act on, and a row of pills under the session table would be several of
// them. 999px is how this stylesheet spells that everywhere it means it.
H.ok(!/border-radius:\s*(999|9999|50)/.test(block),
  '⚠ and it does not borrow the CTA\'s shape — a ground plus a FULL pill is reserved for the one thing on the page you can press');

H.done();
