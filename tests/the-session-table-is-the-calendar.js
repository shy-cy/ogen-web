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
withGap.facts.duration.sessionDates = [
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
H.ok(/<tr><td>1<\/td><td>Wednesday<\/td><td>14 October<\/td><\/tr>/.test(enTable),
  'session 1 is the first meeting');
H.ok(/<tr><td>2<\/td><td>Wednesday<\/td><td>28 October<\/td><\/tr>/.test(enTable),
  'and session 2 is the NEXT one that happens, not the one that was skipped');

console.log('\n[the same list the credit arithmetic divides by]');
// Stated as an equality rather than trusted: the page's row count and the
// scheduled-session count come from one function, and this is what says so.
const sessions = require('../netlify/functions/_activity-sessions');
LANGS.forEach((lang) => {
  const rows = facts.sessionRows(withGap.facts.duration, lang);
  H.eq(rows.length, sessions.sessionCount(withGap.facts.duration.sessionDates),
    lang + ': the table has exactly as many rows as there are scheduled sessions');
});

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
newYear.facts.duration.sessionDates = [
  { date: '2026-12-16', status: 'scheduled' },
  { date: '2027-01-06', status: 'scheduled' }
];
const spanning = tableOf(render(newYear, 'en'));
H.ok(/16 December 2026/.test(spanning) && /6 January 2027/.test(spanning),
  'sessions spanning two calendar years show the year, because "6 January" alone is ambiguous');

console.log('\n[no calendar, no table — an empty frame is worse than no frame]');
const noCal = F.course();
noCal.facts.duration.sessionDates = [];
LANGS.forEach((lang) => {
  const html = render(noCal, lang);
  H.eq(tableOf(html), '', lang + ': an activity with no calendar renders no table at all');
  H.ok(html.indexOf('activity-sessions') === -1, lang + ': not even the band around it');
});
// Every date excluded is the same thing as no dates. It would be easy for the
// band to survive because the LIST is non-empty while the rendered rows are not.
const allOff = F.course();
allOff.facts.duration.sessionDates = [{ date: '2026-10-14', status: 'excluded' }];
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
const splitRule = css.slice(css.indexOf('.session-split{'), css.indexOf('}', css.indexOf('.session-split{')));
H.ok(/columns:\s*2/.test(splitRule) && !/display:\s*grid|display:\s*flex/.test(splitRule),
  'and it is CSS columns rather than a grid or flex, so 1-6 runs DOWN the first column');

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
