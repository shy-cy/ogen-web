// /calendar — the public month view.
//
// ⚠ THE BUG IT IS NAMED FOR. The first version built the grid, appended it, and
// replaced the server-rendered list with it — and never called draw(). So the
// page rendered an empty month under a blank heading, with the real content it
// had just destroyed. Nothing threw, every function was correct on its own, and
// reading the file showed a draw() defined and a draw() called. It was found by
// EXECUTING the client, which is the only thing that could have found it.
//
// The ordering is now the fail-open promise rather than a detail: the grid is
// drawn BEFORE the static list is touched, so a throw anywhere leaves the served
// page exactly as it was.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_helpers');
const { makeDom, textOf, byClass } = require('./_dom');

const T = require(H.fnPath('_activity-template'));
const IDX = require(H.fnPath('_activity-index'));
const CAL = require(H.fnPath('_activity-calendar'));

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const LANGS = ['he', 'en', 'ru'];

const dir = path.join(ROOT, 'activities');
const records = fs.readdirSync(dir)
  .filter((f) => f.endsWith('.json') && f !== 'activities-index.json')
  .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));

// ------------------------------------------------------------------ the route

console.log('\n[a file at the root of each tree, not a slug]');

H.eq(T.calendarPathFor('he'), '/calendar', 'Hebrew lives at the root of its tree');
H.eq(T.calendarPathFor('en'), '/en/calendar', 'English in its own');
H.eq(T.calendarPathFor('ru'), '/ru/calendar', 'Russian in its own');
H.eq(T.calendarFilePathFor('he'), 'calendar.html', 'and it is a FILE, not a directory');

// ⚠ NOT UNDER /activities. SLUG_RE allows `calendar`, so an activity with that
// slug would generate activities/calendar.html and silently overwrite this page.
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
H.ok(SLUG_RE.test('calendar'), '`calendar` is a legal activity slug, which is why the route avoids that namespace');
LANGS.forEach((l) => {
  H.ok(T.calendarPathFor(l).indexOf('/activities') === -1,
    T.calendarPathFor(l) + ' cannot be shadowed by an activity');
  // A file rather than a directory also means no trailing-slash redirect, which
  // the listing page needed a forced rewrite to escape.
  H.ok(!/\/$/.test(T.calendarPathFor(l)), 'and carries no trailing slash');
});

// -------------------------------------------------------------- the audience

console.log('\n[who is invited is not who occupies a room]');

const base = () => ({
  slug: 'x', status: 'open', type: 'course', listing: 'listed',
  title: { he: 'x', en: 'x', ru: 'x' },
  groups: [{
    groupId: 'g-1', name: { he: '', en: '', ru: '' },
    facts: {
      schedule: { frequency: 'weekly', sessions: [{ day: 3, time: '18:00' }] },
      duration: { sessionMinutes: 90, sessionDates: [{ date: '2027-01-17', status: 'scheduled' }] }
    }
  }]
});
const withListing = (v) => Object.assign(base(), { listing: v });

// ⚠ THE LIVE RECORDS CANNOT TEST THIS — there is no unlisted activity in the
// repository, so both audiences agree on the real data and a reverted rule would
// pass. That is what these fixtures are for.
H.eq(CAL.isLive(withListing('unlisted'), 'admin'), true,
  'admin: an unlisted class occupies a room and must be visible');
H.eq(CAL.isLive(withListing('unlisted'), 'public'), false,
  'public: an unlisted class is NOT advertised, and this page must not advertise it');
H.eq(CAL.isLive(withListing('listed'), 'public'), true, 'a listed class is public');
H.eq(CAL.isLive(withListing('test'), 'public'), false, 'a rehearsal is in neither');
H.eq(CAL.isLive(withListing('test'), 'admin'), false, 'in neither, from either side');

const pubRows = IDX.calendarRows([withListing('unlisted'), withListing('listed')], 'en');
H.ok(pubRows.every((r) => r.slug === 'x'), 'calendarRows returns rows');
H.eq(CAL.timetable([withListing('unlisted')], 'public').length, 0,
  'and an unlisted activity contributes no row to the public page');

// ------------------------------------------------------- the page is a build

console.log('\n[it asks no clock, so preview and publish cannot differ]');

const pageFor = (lang) => T.renderCalendarPage(IDX.calendarRows(records, lang), lang);

LANGS.forEach((lang) => {
  const a = pageFor(lang);
  const b = pageFor(lang);
  H.eq(a, b, lang + ': rendering twice is byte-identical');
});

// The real guard: no clock anywhere in the render path. preview-matches-publish
// asserts byte-identity, so a page embedding "today" could differ between a
// preview at 23:59 and a publish at 00:01.
const tpl = read('netlify/functions/_activity-template.js');
const renderBlock = (tpl.match(/function renderCalendarPage[\s\S]*?\n}\n/) || [''])[0];
H.ok(renderBlock.length > 100, 'found renderCalendarPage');
H.ok(!/Date\.now\(\)|new Date\(\)/.test(renderBlock),
  'renderCalendarPage asks what time it is nowhere');

// ------------------------------------------------------------- what it serves

console.log('\n[every language, and rule 2]');

LANGS.forEach((lang) => {
  const page = pageFor(lang);
  const L = T.LABELS[lang];
  H.ok(page.indexOf('<html lang="' + lang + '">') !== -1, lang + ': declares its language');
  H.ok(!/<html[^>]*\sdir=/.test(page), lang + ': no dir on <html> — rule 2');
  H.ok(!/<body[^>]*\sdir=/.test(page), lang + ': no dir on <body> — rule 2');
  H.ok(page.indexOf('id="page" dir="' + L.dir + '"') !== -1, lang + ': dir is on #page only');
  H.ok(page.indexOf('rel="canonical" href="https://www.ogen.cy' + T.calendarPathFor(lang) + '"') !== -1,
    lang + ': canonical names the slashless path it is actually served at');
  H.eq((page.match(/<h1>/g) || []).length, 1, lang + ': exactly one h1 — rule 3');
  H.ok(page.indexOf('/js/calendar.js') !== -1, lang + ': loads its client');
  H.ok(page.indexOf(L.calTitle) !== -1, lang + ': carries its own title');

  // ⚠ THE EXACT ADDRESS IS MEMBERS-ONLY AND MUST NEVER REACH THIS PAGE. A public
  // grid naming where a child will be at 16:00 next Tuesday is the worst place
  // on the site to leak it, so the row builder never reads it at all.
  records.forEach((a) => {
    (a.groups || []).forEach((g) => {
      const addr = ((g.facts || {}).address || {});
      const text = (addr.text && (addr.text.he || addr.text.en || addr.text.ru)) || '';
      if (text && text.length > 6) {
        H.ok(page.indexOf(text) === -1, lang + ': does not print a members-only address');
      }
      if (addr.mapUrl) H.ok(page.indexOf(addr.mapUrl) === -1, lang + ': and no map pin');
    });
  });
});

console.log('\n[the data rides with the page]');

LANGS.forEach((lang) => {
  const page = pageFor(lang);
  const raw = (page.match(/id="calendar-data">([\s\S]*?)<\/script>/) || [])[1];
  H.ok(raw, lang + ': carries an embedded data block');
  // ⚠ `<` IS ESCAPED, or a title containing "</script>" ends the block early and
  // the rest of it is parsed as markup.
  H.ok(raw.indexOf('<') === -1, lang + ': no raw < inside the JSON block');
  let d = null;
  try { d = JSON.parse(raw); } catch (e) { d = null; }
  H.ok(d, lang + ': and it parses');
  H.eq(d.months.length, 12, lang + ': twelve month names');
  H.eq(d.days.length, 7, lang + ': seven weekday names');
  H.eq(d.sessions.length, CAL.timetable(records, 'public')
    .filter((s) => (records.find((a) => a.slug === s.slug).langs === undefined
      ? true : true)).filter((s) => {
        const a = records.find((x) => x.slug === s.slug);
        return T.langsPresent(a).indexOf(lang) !== -1;
      }).length, lang + ': one entry per session with a page in this language');
  d.sessions.forEach((s) => {
    H.ok(/^\d{4}-\d{2}-\d{2}$/.test(s.date), lang + ': ISO date');
    H.ok(s.href.indexOf('/activities/') !== -1, lang + ': every row links to its activity');
  });
});

// ------------------------------------------------------ generated and linked

// ⚠ AND THE ESCAPE IS TESTED WITH SOMETHING THAT NEEDS ESCAPING. No real title
// contains `<`, so asserting it of the live data passes whether or not the
// replace is there — which a bite-check proved by surviving. A title carrying
// `</script>` ends the data block early and the rest of the JSON is parsed as
// markup, so it is rendered here on purpose.
console.log('\n[a title that would end the data block early]');
(function () {
  const nasty = Object.assign(base(), {
    slug: 'nasty',
    title: { he: 'x</script><img src=x>', en: 'x</script><img src=x>', ru: 'x</script><img src=x>' }
  });
  const page = T.renderCalendarPage(IDX.calendarRows([nasty], 'en'), 'en');
  const raw = (page.match(/id="calendar-data">([\s\S]*?)<\/script>/) || [])[1];
  H.ok(raw, 'the block is still delimited');
  H.ok(raw.indexOf('<') === -1, 'and holds no raw < at all');
  H.ok(raw.indexOf('\\u003c') !== -1, 'the < is escaped rather than dropped');
  let d = null;
  try { d = JSON.parse(raw); } catch (e) { d = null; }
  H.ok(d && d.sessions.length === 1, 'and the whole thing still parses');
  H.eq(d && d.sessions[0] && d.sessions[0].title, 'x</script><img src=x>', 'with the title intact, not mangled');
  H.ok(page.indexOf('<img src=x>') === -1, 'and nothing of it reaches the page as markup');
})();

console.log('\n[generated, in the sitemap, and in the menu]');

const files = IDX.buildDerivedFiles(records);
const paths = files.map((f) => f.path);
LANGS.forEach((lang) => {
  H.ok(paths.indexOf(T.calendarFilePathFor(lang)) !== -1,
    'buildDerivedFiles writes ' + T.calendarFilePathFor(lang));
});

const sitemap = files.filter((f) => f.path === 'sitemap.xml')[0].content;
LANGS.forEach((lang) => {
  H.ok(sitemap.indexOf('<loc>https://www.ogen.cy' + T.calendarPathFor(lang) + '</loc>') !== -1,
    'the sitemap lists ' + T.calendarPathFor(lang));
  // ⚠ AND ITS ALTERNATES ARE READ, NOT JUST COUNTED. urlEntry() does Object.keys()
  // over the map it is handed, so an array of {lang, path} renders hreflang="0"
  // and href="…[object Object]" — which is what the first version shipped. It was
  // found by generating the file and looking at it, so the check is on the output.
  H.ok(sitemap.indexOf('hreflang="' + lang + '" href="https://www.ogen.cy' + T.calendarPathFor(lang) + '"') !== -1,
    'with a real hreflang for ' + lang);
});
H.ok(sitemap.indexOf('[object Object]') === -1, 'and nothing anywhere stringifies an object into a URL');
H.ok(!/hreflang="[0-9]"/.test(sitemap), 'and no hreflang is an array index');

const nav = read('js/nav.js');
H.ok(/\$\{base\}\/calendar/.test(nav), 'the hamburger links to it');
LANGS.forEach((lang) => {
  H.ok(new RegExp('calendar\\s*:').test(nav), 'nav carries a calendar label');
  H.ok(nav.indexOf(T.LABELS[lang].calTitle) !== -1 || lang === 'en',
    lang + ': the nav label exists');
});

// Every class the page and the client write must have a rule — a class nobody
// styled is a layout nobody designed, and this page has TWO states to style.
const css = read('shared.css').replace(/\/\*[\s\S]*?\*\//g, '');
const classes = new Set();
pageFor('he').replace(/class="([^"]+)"/g, (_, v) => { v.split(/\s+/).forEach((c) => c && classes.add(c)); return ''; });
const client = read('js/calendar.js');
client.replace(/el\('[a-z]+',\s*'([a-z- ]+)'/g, (_, v) => { v.split(/\s+/).forEach((c) => c && classes.add(c)); return ''; });
client.replace(/classList\.(?:add|remove)\('([a-z-]+)'\)/g, (_, c) => { classes.add(c); return ''; });
H.ok(classes.size > 10, 'the page and client write ' + classes.size + ' classes');
[...classes].sort().forEach((c) => H.ok(css.indexOf('.' + c) !== -1, 'shared.css has a rule for .' + c));

// ⚠ NOT ONE PHYSICAL INSET in the calendar block, so the Hebrew month mirrors
// with no per-language override — the same assertion the account chip carries.
const block = (css.match(/\.cal-page\{[\s\S]*$/) || [''])[0];
H.ok(block.length > 200, 'found the calendar CSS block');
[/(^|[;{\s])left\s*:/, /(^|[;{\s])right\s*:/, /padding-left/, /padding-right/, /margin-left/, /margin-right/]
  .forEach((re) => H.ok(!re.test(block), 'no physical inset in the calendar CSS (' + re + ')'));

// ---------------------------------------------------------------- IT IS RUN

console.log('\n[and the client is executed, which is the only thing that found the bug]');

(function () {
  const page = pageFor('en');
  const json = (page.match(/id="calendar-data">([\s\S]*?)<\/script>/) || [])[1];
  const dom = makeDom({ ids: ['cal-static', 'calendar-data'], pathname: '/en/calendar' });
  const win = dom.window; win.window = win;
  dom.document.getElementById('calendar-data').textContent = json;

  vm.runInNewContext(client, win);

  const host = dom.document.getElementById('cal-static');
  H.eq(host.childNodes.length, 1, 'the static list is replaced by exactly one node');
  const wrap = host.childNodes[0];
  H.ok(/cal-grid-wrap/.test(wrap.className || ''), 'and it is the grid');

  // THE BUG: all of these were zero, with the list already destroyed.
  H.eq(byClass(wrap, 'cal-title').length, 1, 'the month heading exists on FIRST paint');
  H.ok(String(textOf(byClass(wrap, 'cal-title')[0] || {}) || '').length > 0,
    'and it has the month in it, rather than being drawn empty');
  H.eq(byClass(wrap, 'cal-dow').length, 7, 'seven weekday headers are drawn immediately');
  H.ok(byClass(wrap, 'cal-cell').length >= 28, 'and a full month of day cells');

  const cells = byClass(wrap, 'cal-cell');
  const live = cells.filter((c) => /has-sessions/.test(c.className));
  H.ok(live.length > 0, 'some days carry sessions (' + live.length + ')');
  H.eq(cells.filter((c) => /is-on/.test(c.className)).length, 1,
    'exactly one day is selected, so the panel is never empty on arrival');
  H.ok(String(textOf(byClass(wrap, 'cal-detail-head')[0] || {}) || '').length > 0, 'and its panel is headed');

  // ⚠ ORDER, ASSERTED BY SHAPE. Drawing after the list is cleared renders an
  // identical DOM when nothing throws, so no amount of reading the result can
  // tell the two apart — a bite-check proved it by surviving. What the fail-open
  // promise actually needs is that draw() has already run when the served list
  // is destroyed, so a throw leaves the page as it was.
  const drawAt = client.indexOf('\n  draw();');
  const wipeAt = client.indexOf("host.textContent = ''");
  H.ok(drawAt !== -1, 'the client calls draw() at startup');
  H.ok(wipeAt !== -1, 'and clears the served list');
  H.ok(drawAt < wipeAt, 'and it draws BEFORE it clears, or a throw leaves an empty page');

  const steps = byClass(wrap, 'cal-step');
  H.eq(steps.length, 2, 'two month controls');
  // ⚠ WORDS, NOT CHEVRONS. A caret is directional and this page renders in two
  // directions; words need no mirroring and no per-language override.
  steps.forEach((b) => H.ok(textOf(b).length > 2, 'a month control is a word, not a glyph'));

  const before = textOf(byClass(wrap, 'cal-title')[0]);
  steps[1].click();
  const after = textOf(byClass(host.childNodes[0], 'cal-title')[0]);
  H.ok(after !== before, 'Next moves the month (' + before + ' -> ' + after + ')');
  steps[0].click();
  H.eq(textOf(byClass(host.childNodes[0], 'cal-title')[0]), before, 'and Prev comes back');

  // Clicking a day changes the panel.
  const live2 = byClass(host.childNodes[0], 'cal-cell').filter((c) => /has-sessions/.test(c.className));
  if (live2.length > 1) {
    const headBefore = textOf(byClass(host.childNodes[0], 'cal-detail-head')[0]);
    live2[live2.length - 1].click();
    H.ok(textOf(byClass(host.childNodes[0], 'cal-detail-head')[0]) !== headBefore,
      'clicking a day opens that day');
    H.eq(byClass(host.childNodes[0], 'cal-cell').filter((c) => /is-on/.test(c.className)).length, 1,
      'and only one day is ever selected');
  }
})();

console.log('\n[and it fails open]');

[
  ['no data block', { ids: ['cal-static'] }],
  ['unparseable JSON', { ids: ['cal-static', 'calendar-data'], json: '{oops' }],
  ['empty session list', { ids: ['cal-static', 'calendar-data'], json: '{"sessions":[],"months":[],"days":[]}' }]
].forEach(([name, opt]) => {
  const dom = makeDom({ ids: opt.ids, pathname: '/en/calendar' });
  const win = dom.window; win.window = win;
  const blob = dom.document.getElementById('calendar-data');
  if (blob) blob.textContent = opt.json;
  const host = dom.document.getElementById('cal-static');
  host.appendChild(dom.document.createElement('section'));
  const before = host.childNodes.length;
  let threw = false;
  try { vm.runInNewContext(client, win); } catch (e) { threw = true; }
  H.ok(!threw, name + ': does not throw');
  H.eq(host.childNodes.length, before, name + ': leaves the served list untouched');
});

H.done();
