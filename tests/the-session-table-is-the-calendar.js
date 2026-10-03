// What this defends against:
//
// The schedule card says "Wednesdays, 16:00" and goes on saying it. What it
// cannot say is WHICH Wednesdays, and a family planning a term needs the dates.
// So facts.duration.sessionDates — the calendar built for the cancellation
// arithmetic — gets a second reader.
//
// The whole value of that is ONE SOURCE. The page renders the scheduled rows and
// the credit formula divides by their count, so the table cannot disagree with
// what a refund is priced against. Build a second list for the page and the two
// drift, and the drift shows up as an off-by-one in somebody's money.
//
// Two things follow, and both are asserted here rather than left to read as
// taste:
//
//   - An excluded date is ABSENT, not marked. Not a struck-through row, not a
//     "no class" line, not an acknowledged gap. The page says when the class
//     meets. That also makes the numbering free: if nothing skipped is shown,
//     nothing skipped can take a number, so session 3 is the third row and the
//     third meeting with no rule saying so.
//   - The admin's reason for excluding a date is an ADMIN note. It never reaches
//     the page. "Hanukkah" is fine; a reason will eventually say something like
//     "teacher's hospital appointment", and that must not be published because
//     somebody wrote it in a private field.
//
// It is a session, not a lesson. The price card two blocks up publishes
// "(10 sessions × 2 lessons)" off a distinction this project settled long ago —
// a session is one meeting, a lesson is the 45-minute academic hour — so a table
// headed "Lesson 1" would contradict it on the same page, in a way that reads as
// a mistake to the one person who counts.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');
const F = require('./_fixtures');
const facts = require('../netlify/functions/_activity-facts');
const template = require('../netlify/functions/_activity-template');
const { migrate } = require('../netlify/functions/_activity-migrate');

const R = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(R, 'shared.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const LANGS = ['he', 'en', 'ru'];
const render = (a, lang) => template.renderActivityPage(migrate(a), lang);
const tableOf = (html) => (html.match(/<table class="session-table">[\s\S]*?<\/table>/) || [''])[0];

console.log('[the table lists the sessions that are happening, and nothing else]');
const withGap = F.course();
F.groupFacts(withGap).duration.sessionDates = [
  { date: '2026-10-14', status: 'scheduled' },
  { date: '2026-10-21', status: 'excluded', reason: 'Teacher away — hospital' },
  { date: '2026-10-28', status: 'scheduled' }
];
LANGS.forEach((lang) => {
  const html = render(withGap, lang);
  const table = tableOf(html);
  H.ok(table.length > 0, lang + ': the table renders');
  H.eq((table.match(/<tr><td>/g) || []).length, 2, lang + ': two rows, for the two meetings');
  H.ok(html.indexOf('Teacher away') === -1,
    lang + ': the admin\'s reason for the exclusion is NOWHERE on the page');
  H.ok(!/no class|אין שיעור|нет занятия/i.test(table),
    lang + ': and the skipped date is absent rather than marked');
});

// The numbering follows from that, rather than being a rule of its own.
const enTable = tableOf(render(withGap, 'en'));
H.ok(/<tr><td>1<\/td><td>Wednesday<\/td><td>14 October<\/td><td>16:00<\/td><\/tr>/.test(enTable),
  'session 1 is the first meeting');
H.ok(/<tr><td>2<\/td><td>Wednesday<\/td><td>28 October<\/td><td>16:00<\/td><\/tr>/.test(enTable),
  'and session 2 is the NEXT one that happens, not the one that was skipped');

// ---------------------------------------------------------------------------
console.log('\n[the hour is a COLUMN, because the override would not carry it]');
//
// Five of the six published activities replace the schedule sentence with
// free-text words, and that line is the only place the page ever stated an hour
// — so the time vanished from every one of them while sitting in the record the
// whole time. It was reported as "there is no time shown for the activities".
//
// ⚠ AND THE FIX IS NOT TO APPEND IT TO THE OVERRIDE. That was proposed and
// declined: the override is free text and stays free text, so an admin who wants
// the hour in that sentence types it there, as intro-into-judaism's does. The
// hour belongs in the table, per row, where it is a field rather than prose.
const TIME_COL = { he: 'שעה', en: 'Time', ru: 'Время' };
LANGS.forEach((lang) => {
  const table = tableOf(render(withGap, lang));
  H.ok(table.indexOf('<th scope="col">' + TIME_COL[lang] + '</th>') !== -1,
    lang + ': the table has a Time column, headed in this language');
  H.eq((table.match(/<td>16:00<\/td>/g) || []).length, 2,
    lang + ': and every row carries the hour that session starts at');
});

// ⚠ AN HOUR NOBODY CAN PIN DOWN IS AN EMPTY CELL, NEVER A GUESS. A custom
// schedule may name a different hour per date; rows that disagree with none
// naming THIS date yield nothing, which is the same answer the clash report
// gives and the reason it never reports a timeless session as colliding. Live
// data depends on it: beit-midrash-ayeka carries a session whose own row has no
// hour at all.
const vague = F.course();
F.groupFacts(vague).schedule = { frequency: 'custom', sessions: [
  { day: 3, time: '16:00', date: '2026-10-14' },
  { day: 3, time: '18:00', date: '2026-10-21' }
] };
F.groupFacts(vague).duration.sessionDates = [
  { date: '2026-10-14', status: 'scheduled' },
  { date: '2026-10-21', status: 'scheduled' },
  { date: '2026-10-28', status: 'scheduled' }
];
const vagueTable = tableOf(render(vague, 'en'));
H.ok(/<td>14 October<\/td><td>16:00<\/td>/.test(vagueTable),
  'a date whose own row names an hour gets that hour');
H.ok(/<td>21 October<\/td><td>18:00<\/td>/.test(vagueTable),
  'and a different date with a different hour gets its own, not the first');
H.ok(/<td>28 October<\/td><td><\/td>/.test(vagueTable),
  'a date no row names, where the rows disagree, gets an EMPTY cell rather than a guess');

// The reverse, and it is what the live record needs: one hour across every row
// is the fallback for a date nobody named, so a blank row inherits it.
const oneHour = F.course();
F.groupFacts(oneHour).schedule = { frequency: 'custom', sessions: [
  { day: 3, time: '19:30', date: '2026-10-14' },
  { day: 3, time: '', date: '2026-10-21' }
] };
F.groupFacts(oneHour).duration.sessionDates = [
  { date: '2026-10-14', status: 'scheduled' },
  { date: '2026-10-21', status: 'scheduled' }
];
H.eq((tableOf(render(oneHour, 'en')).match(/<td>19:30<\/td>/g) || []).length, 2,
  'a row left blank takes the one hour every other row agrees on');

console.log('\n[the same list the credit arithmetic divides by]');
// Stated as an equality rather than trusted: the page's row count and the
// scheduled-session count come from one function, and this is what says so.
const sessions = require('../netlify/functions/_activity-sessions');
LANGS.forEach((lang) => {
  const rows = facts.sessionRows(F.groupFacts(withGap).duration, lang);
  H.eq(rows.length, sessions.sessionCount(F.groupFacts(withGap).duration.sessionDates),
    lang + ': the table has exactly as many rows as there are scheduled sessions');
});

console.log('\n[one number, not two: the count IS the calendar]');
// The discrepancy this project carried for months — a typed count of ten across
// a span holding eleven Wednesdays — was never a validation problem. It was two
// editable fields for one fact, and the fix is to stop having two.
//
// Deriving it was deliberately deferred when the calendar was introduced,
// because pricePerHour() divides by it and changing a denominator silently
// changes a published price. It was done at the moment both numbers agreed, so
// nothing visible moved.
const eleven = F.course();
F.groupFacts(eleven).duration.sessionCount = 10;          // the stale typed value
H.eq(facts.sessionTotal(F.groupFacts(eleven).duration), 10, 'ten dates and a typed ten agree');
F.groupFacts(eleven).duration.sessionDates.push({ date: '2026-12-23', status: 'scheduled' });
H.eq(facts.sessionTotal(F.groupFacts(eleven).duration), 11,
  'add the eleventh date and the total is eleven, whatever the field still says');
H.eq(facts.priceRows(eleven.facts.price, 'en', F.groupFacts(eleven).duration)[1].note,
  '(11 sessions × 2 lessons)',
  'so the price qualifier follows the calendar rather than the stale number beside it');
// An excluded date is not a session, in the count as on the page.
F.groupFacts(eleven).duration.sessionDates[0].status = 'excluded';
H.eq(facts.sessionTotal(F.groupFacts(eleven).duration), 10, 'excluding one takes it back to ten');
H.eq(facts.sessionRows(F.groupFacts(eleven).duration, 'en').length, facts.sessionTotal(F.groupFacts(eleven).duration),
  'and the table and the count can never disagree, because they are one list');
// No calendar at all still falls back, or an activity nobody has scheduled
// would lose its price qualifier entirely.
H.eq(facts.sessionTotal({ sessionCount: 12 }), 12, 'with no calendar the typed number still answers');
H.eq(facts.sessionTotal({}), null, 'and with neither, there is no count rather than a zero');

console.log('\n[a session, not a lesson — the price card is two blocks up]');
H.eq(facts.SESSION_TABLE.en.row, 'Session', 'English says Session');
H.eq(facts.SESSION_TABLE.he.row, 'מפגש', 'Hebrew says מפגש, which is what the price card counts');
H.eq(facts.SESSION_TABLE.ru.row, 'Занятие', 'Russian says Занятие');
LANGS.forEach((lang) => {
  const table = tableOf(render(withGap, lang));
  H.ok(!/lesson|שיעור|урок/i.test(table),
    lang + ': the word "lesson" appears nowhere in the table, or it would contradict the price');
});

console.log('\n[dates read day-first, and the year appears only when it has to]');
H.ok(/14 October/.test(enTable), 'English is day before month, matching the other two');
H.ok(!/2026/.test(enTable),
  'and carries no year: the date range is already on the page as the duration fact, ' +
  'and printing it twice is one more place for it to be wrong');
H.ok(/14 באוקטובר/.test(tableOf(render(withGap, 'he'))), 'Hebrew prefixes the month with ב');
H.ok(/14 октября/.test(tableOf(render(withGap, 'ru'))),
  'Russian takes the genitive — "14 октября", never "14 октябрь"');

// The one exception: a term running December into January.
const newYear = F.course();
F.groupFacts(newYear).duration.sessionDates = [
  { date: '2026-12-16', status: 'scheduled' },
  { date: '2027-01-06', status: 'scheduled' }
];
const spanning = tableOf(render(newYear, 'en'));
H.ok(/16 December 2026/.test(spanning) && /6 January 2027/.test(spanning),
  'sessions spanning two calendar years show the year, because "6 January" alone is ambiguous');

console.log('\n[no calendar, no table — an empty frame is worse than no frame]');
const noCal = F.course();
F.groupFacts(noCal).duration.sessionDates = [];
LANGS.forEach((lang) => {
  const html = render(noCal, lang);
  H.eq(tableOf(html), '', lang + ': an activity with no calendar renders no table at all');
  H.ok(html.indexOf('activity-sessions') === -1, lang + ': not even the band around it');
});
// Every date excluded is the same thing as no dates. It would be easy for the
// band to survive because the LIST is non-empty while the rendered rows are not.
const allOff = F.course();
F.groupFacts(allOff).duration.sessionDates = [{ date: '2026-10-14', status: 'excluded' }];
H.eq(tableOf(render(allOff, 'en')), '',
  'and an activity whose every date is excluded renders none either');

console.log('\n[both halves of the pair render it]');
// A drop-in has a calendar too — it is ongoing rather than absent, so the table
// is if anything more useful there. The page never asks what type it is.
F.TYPE_PAIR.forEach((kind) => {
  const table = tableOf(render(kind.build(), 'en'));
  H.ok(table.length > 0, kind.name + ': renders its sessions');
});

console.log('\n[it is a band of its own, laid out by the same mechanism as the credits]');
H.ok(css.indexOf('.activity-sessions{') !== -1, 'the band has a rule');
H.ok(/\.activity-sessions\{[^}]*grid-area:sessions/.test(css), 'placed by grid area, like every other block');
// Ten rows of three short values down the middle of a 1050px band is a thin
// ribbon of text in a lot of space. It splits on the CARD's inline size, not the
// viewport, which is what leaves the phone rendering untouched.
H.ok(/container-type:inline-size/.test(css.slice(css.indexOf('.session-columns{'), css.indexOf('.session-columns{') + 120)),
  'the split is decided by the card, not by a viewport breakpoint');
H.ok(/columns:2/.test(css.slice(css.indexOf('@container (min-width:520px)'))),
  'two columns when there is room');
// Reading order down each column. A sequence read across a pair would put
// session 2 beside session 1 and break the one thing the table is for.
const colsAt = css.indexOf('columns:2', css.indexOf('@container (min-width:520px)'));
const colsOpen = css.lastIndexOf('{', colsAt);
const colsSel = css.slice(
  Math.max(css.lastIndexOf('}', colsOpen), css.lastIndexOf('{', colsOpen - 1),
           css.lastIndexOf('*/', colsOpen)) + 1, colsOpen)
  .replace('*/', '').trim();
const colsRule = css.slice(colsAt, css.indexOf('}', colsAt));
H.ok(/^\.session-split/.test(colsSel) && !/display:\s*grid|display:\s*flex/.test(colsRule),
  'and it is CSS columns rather than a grid or flex, so 1-6 runs DOWN the first column');

// ⚠ TWO COLUMNS NEED TWO THINGS TO PUT IN THEM, and for a long time there was
// never more than one. `columns:2` and `break-inside:avoid` on the table are one
// declaration disabling the other — a single table cannot break, so it took
// column one and left column two empty. Measured in real Chrome at 1280px: 481px
// of table in a 1006px band on EVERY activity in the repository, the 24-row
// intro-into-judaism included, which is the exact list the split exists to
// shorten. Nothing errored and only the rendered page knew. Asserted on the
// SELECTOR rather than on the fix, so a rule that goes back to applying to every
// split fails here however it is spelled.
H.ok(/:has\(/.test(colsSel),
  'and it asks whether there are two children at all — one table is not a two-column flow');
H.ok(/:not\(\.has-tabs\)/.test(colsSel),
  'and never as tabs, where exactly one panel is on screen by construction');
H.ok(/\.session-split \.session-table\{[^}]*break-inside:avoid/.test(css),
  'a table still never splits: Chrome does not repeat a thead across columns, so the second one would be unlabelled values');

console.log('\n[a table, semantically, not a stack of divs]');
LANGS.forEach((lang) => {
  const html = render(withGap, lang);
  H.ok(/<caption>/.test(html), lang + ': it has a caption naming what it is');
  H.ok(/<th scope="col">/.test(html), lang + ': and column headers a screen reader can use');
});
H.ok(/<caption>Session dates<\/caption>/.test(render(withGap, 'en')),
  'the caption is a heading rather than the date range it used to be — that range ' +
  'is already on the page in the "When & where" card');

H.done();
