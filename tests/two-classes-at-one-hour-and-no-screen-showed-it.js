// Nothing anywhere put two activities on one screen.
//
// Every form in this admin draws ONE activity, so a timetable that reads
// perfectly on its own form can put a class at the same hour as another class,
// in the same town, and no screen could show it. That is the shape this file has
// met three times already — the two facts that printed a structured list and a
// restatement of it underneath, the yearly fee a series typed once per term, and
// the recompute notice that compared a date against nothing. It is the PAIR that
// is wrong, and only a view holding both halves can see one.
//
// Found on the live records the moment the view existed: beit-midrash and the
// Russian/English bnei-mitzvah group both meet at 18:00 in Limassol on three of
// the same dates, and intro-into-judaism runs until 21:00 on a night folk-dance
// starts at 20:30.
//
// ⚠ AND THE FIRST VERSION OF THE RULE WAS USELESS, which is the assertion that
// matters most below. It asked for BOTH sessions' durations and reported "cannot
// say" whenever either was missing — which on the real data was seven pairs, six
// of which provably do not overlap and one of which provably does. Only the
// EARLIER session's duration is needed: two sessions collide when the later one
// BEGINS before the earlier one ENDS.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_helpers');
const { makeDom, textOf, byClass } = require('./_dom');

const CAL = require(H.fnPath('_activity-calendar'));

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ---------------------------------------------------------------- the rule

console.log('\n[only the EARLIER session\'s length is needed]');

const at = (time, minutes) => ({ startsAt: CAL.minutesOf(time), minutes, date: '2027-01-17' });

// The earlier session runs to 21:00; the later one starts inside it. That is a
// collision whatever the later session's length is, and the whole point is that
// the answer does NOT become "unknown" when it is missing.
H.eq(CAL.collide(at('19:30', 90), at('20:30', null)).kind, 'overlap',
  'a later session starting inside the earlier one collides even with no length of its own');
H.eq(CAL.collide(at('19:30', 90), at('20:30', null)).minutes, 30,
  'and the overlap is measured from the earlier session\'s end');
H.eq(CAL.collide(at('20:30', null), at('19:30', 90)).kind, 'overlap',
  'and the order the pair is handed in does not change the answer');

// The mirror: the earlier one ends before the later one starts, so there is no
// collision — again regardless of the later session's unknown length. This is
// the case the crude rule wrongly called unknowable, six times over.
H.eq(CAL.collide(at('16:00', 90), at('20:30', null)), null,
  'a later session starting after the earlier one ends does NOT collide, length unknown or not');

// The one genuinely unknowable shape, and it is the other one: the EARLIER
// session has no length, so nothing says when it stops.
H.eq(CAL.collide(at('19:30', null), at('20:30', 90)).kind, 'unknown',
  'only a missing length on the EARLIER session makes a pair unknowable');

H.eq(CAL.collide(at('18:00', 90), at('18:00', 90)).kind, 'same-start',
  'an identical start is its own verdict, not an overlap of N minutes');
H.eq(CAL.collide(at('18:00', 90), at('18:00', null)).kind, 'same-start',
  'and it needs no length at all — two classes at one hour is the finding');

H.eq(CAL.collide(at(null, 90), at('18:00', 90)), null,
  'a session with no time is never reported as clashing, because there is nothing to compare');

H.eq(CAL.collide(at('16:00', 90), at('17:30', 90)), null,
  'touching end-to-start is not an overlap');

// ---------------------------------------------------------- what is included

console.log('\n[a rehearsal occupies no room; an unlisted class does]');

const activity = (over) => Object.assign({
  slug: 'x', status: 'open', type: 'course',
  title: { he: 'x', en: 'x', ru: 'x' },
  groups: [{
    groupId: 'g-1', name: { he: '', en: '', ru: '' },
    facts: {
      schedule: { frequency: 'weekly', sessions: [{ day: 3, time: '18:00' }] },
      duration: { sessionMinutes: 90, sessionDates: [{ date: '2027-01-17', status: 'scheduled' }] }
    }
  }]
}, over);

H.eq(CAL.isLive(activity({ listing: 'test' })), false, 'a test activity is left out — its payments are pretend and nobody turns up');
H.eq(CAL.isLive(activity({ listing: 'unlisted' })), true, 'an UNLISTED activity is included: it is a real class with the advertising off');
H.eq(CAL.isLive(activity({ listing: 'listed' })), true, 'a listed activity is included');
H.eq(CAL.isLive(activity({ testActivity: true })), false,
  'and the legacy flag still reads as a rehearsal, through listingOf()');

CAL.RUNNING.forEach((s) => H.eq(CAL.isLive(activity({ status: s })), true, 'status ' + s + ' still occupies a room'));
['completed', 'cancelled', 'draft'].forEach((s) =>
  H.eq(CAL.isLive(activity({ status: s })), false, 'status ' + s + ' does not'));

console.log('\n[an excluded date is not a session]');

const withDates = activity({});
withDates.groups[0].facts.duration.sessionDates = [
  { date: '2027-01-17', status: 'scheduled' },
  { date: '2027-01-24', status: 'excluded', reason: 'holiday' }
];
const rows = CAL.timetable([withDates]);
H.eq(rows.length, 1, 'an excluded date never becomes a row');
H.eq(rows[0].date, '2027-01-17', 'and the scheduled one does');
H.eq(rows[0].endsAt, '19:30', 'the end time is derived from the length, not stored');

console.log('\n[a time nobody can pin down is null, never a guess]');

const vague = activity({});
vague.groups[0].facts.schedule.sessions = [{ day: 3, time: '18:00' }, { day: 0, time: '20:00' }];
H.eq(CAL.timeFor(vague.groups[0].facts.schedule, '2027-01-17'), null,
  'two different times and no row naming this date means no time, not the first one');
vague.groups[0].facts.schedule.sessions.push({ day: 0, time: '20:00', date: '2027-01-17' });
H.eq(CAL.timeFor(vague.groups[0].facts.schedule, '2027-01-17'), '20:00',
  'but a row naming this date wins outright');

// ------------------------------------------------- the real records, today

console.log('\n[the intent is the data, so it is asserted on the real records]');

const dir = path.join(ROOT, 'activities');
const records = fs.readdirSync(dir)
  .filter((f) => f.endsWith('.json') && f !== 'activities-index.json')
  .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));

const live = records.filter(CAL.isLive);
H.ok(live.length >= 1, 'at least one live activity in the repository (' + live.length + ')');
H.ok(records.some((a) => !CAL.isLive(a)), 'and at least one that is excluded, or the filter is untested');

const rep = CAL.report(records);
H.eq(rep.counts.sessions, rep.sessions.length, 'the count and the list agree');
H.ok(rep.sessions.every((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.date)), 'every row carries an ISO date');

// Sorted, totally. A screen that reshuffles between two loads reads as one that
// cannot be trusted — the rule the dashboard's own list follows.
const keys = rep.sessions.map((s) => s.date + (s.time || '~') + s.slug);
H.eq(keys.join('|'), keys.slice().sort().join('|'), 'the timetable is in a total order');

// Every clash names two DIFFERENT sessions on one date.
rep.clashes.forEach((c) => {
  H.eq(c.a.date, c.date, 'a clash names its own date');
  H.eq(c.b.date, c.date, 'on both sides');
  H.ok(c.a.slug !== c.b.slug || c.a.groupId !== c.b.groupId,
    'and never reports a session against itself');
});

// ⚠ RE-DERIVED, NEVER PINNED TO A DIGIT. Asserting "there are 4 clashes" would
// fail the day somebody fixes one, which is the opposite of what this defends.
// What must hold is that the report and the rule agree with each other on the
// real data.
let byHand = 0;
const byDate = {};
rep.sessions.forEach((s) => { (byDate[s.date] = byDate[s.date] || []).push(s); });
Object.keys(byDate).forEach((d) => {
  const l = byDate[d];
  for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) if (CAL.collide(l[i], l[j])) byHand++;
});
H.eq(rep.clashes.length, byHand, 'report() finds exactly the pairs the rule finds (' + byHand + ')');
H.eq(rep.clashedDates.length, Object.keys(rep.clashes.reduce((m, c) => (m[c.date] = 1, m), {})).length,
  'and clashedDates is those dates, deduplicated');

// ------------------------------------------------------ the screen is a view

console.log('\n[the client draws the answer and derives none of it]');

const client = read('js/admin-calendar.js');

// ⚠ THE RULE MUST NOT EXIST TWICE. A second copy in the browser is a second rule
// free to disagree with the server's, and the one an admin reads is the copy.
// Same reason capacity is counted in one place and the payment pill is derived
// once. Checked on comment-stripped source, because this file EXPLAINS the rule
// at length and a naive search finds the prose.
const bare = client.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
H.ok(!/startsAt\s*\+\s*minutes/.test(bare), 'the client never adds a length to a start time');
H.ok(!/\.minutes\s*[<>]/.test(bare), 'and never compares durations');
H.ok(!/collide|clashes\s*\(/.test(bare), 'and calls no clash rule of its own');
H.ok(/action:\s*'calendar'/.test(bare), 'it asks the server for the report');

// The server must answer that action.
const handler = read('netlify/functions/activities-admin.js');
H.ok(/case 'calendar':/.test(handler), 'and activities-admin.js handles it');
H.ok(/CAL\.report\(/.test(handler), 'through the one pure module');

// ⚠ PUBLISHED RECORDS, NOT DRAFTS. A draft has no page and nobody turning up, so
// its dates are a proposal; reporting them would clash live classes against
// activities that do not exist.
const block = (handler.match(/case 'calendar': \{[\s\S]*?\n      \}/) || [''])[0];
H.ok(/allPublished\(\)/.test(block), 'built from the published set');
H.ok(!/listDrafts|seriesCandidates/.test(block), 'and never from the drafts');

// ------------------------------------------------- nothing unstyled, nothing unmounted

console.log('\n[every class has a rule and every id has a mount]');

const css = read('admin/admin.css').replace(/\/\*[\s\S]*?\*\//g, '');
const page = read('admin/calendar.html');

const classes = new Set();
bare.replace(/className:\s*'([^']+)'/g, (_, v) => { v.split(/\s+/).forEach((c) => c && classes.add(c.replace(/^\s*\+?\s*/, ''))); return ''; });
bare.replace(/'\s*(cal-[a-z-]+)\s*'/g, (_, c) => { classes.add(c); return ''; });
page.replace(/class="([^"]+)"/g, (_, v) => { v.split(/\s+/).forEach((c) => c && classes.add(c)); return ''; });
H.ok(classes.size > 5, 'the screen writes ' + classes.size + ' classes');
[...classes].sort().forEach((c) => {
  H.ok(css.indexOf('.' + c) !== -1, 'admin.css has a rule for .' + c);
});

// Every id the client looks up must be answered by the page — the check the
// three-panel split needed, for the same reason: a mount the markup stopped
// carrying throws at the top of the first screen an admin opens.
const looked = new Set();
bare.replace(/\$\('([^']+)'\)/g, (_, id) => { looked.add(id); return ''; });
H.ok(looked.size > 3, 'the client looks up ' + looked.size + ' ids');
[...looked].sort().forEach((id) => {
  H.ok(page.indexOf('id="' + id + '"') !== -1, 'admin/calendar.html carries #' + id);
});

// ------------------------------------------------------------- it is reachable

console.log('\n[a screen nobody can reach is a screen nobody has]');

['admin/activities.html', 'admin/registrations.html', 'admin/families.html', 'admin/users.html']
  .forEach((p) => {
    H.ok(read(p).indexOf('href="/admin/calendar.html"') !== -1, p + ' links to the calendar');
  });
H.ok(page.indexOf('js/admin-calendar.js') !== -1, 'and the page loads its client');
H.ok(page.indexOf('js/admin-help.js') !== -1, 'and admin-help, since both panels carry a hint');
H.ok(/noindex/.test(page), 'and it is noindex like every admin page');

// ------------------------------------------------------------ and it is RUN

// ⚠ READING THE CLIENT PROVES THE CLIENT IS SELF-CONSISTENT. It cannot prove the
// screen draws anything — which is how this project shipped a panel whose mount
// the markup had stopped carrying, and a button that set `hidden` on an element
// the stylesheet made unhideable. So the real client is executed over the real
// report and what it drew is read back.
async function drive(report) {
  const ids = ['who', 'logout', 'app', 'no-access', 'tool',
    'clash-panel', 'clashes', 'hide-past', 'counts', 'calendar'];
  const dom = makeDom({ ids, pathname: '/admin/calendar.html' });
  const win = dom.window;
  win.window = win;

  // Every declared id comes back a DIV; this one is the page's checkbox, and the
  // shim already knows a click on one toggles it and fires `change`.
  const box = dom.document.getElementById('hide-past');
  box.tagName = 'INPUT'; box.attributes.type = 'checkbox'; box.checked = true;

  const seen = { asked: null, wired: 0 };
  win.AdminSession = {
    requireSession: () => true,
    get: () => ({ name: 'Michal', roleName: 'Super Admin' }),
    logout() {},
    post(url, body) {
      seen.asked = { url, action: body.action };
      return Promise.resolve({ ok: true, data: Object.assign({ ok: true }, report) });
    }
  };
  win.AdminHelp = { wire() { seen.wired++; } };

  vm.runInNewContext(client, win);
  await new Promise((r) => setTimeout(r, 0));
  return { dom, box, seen };
}

(async () => {
  const { dom, box, seen } = await drive(rep);
  const asked = seen.asked;
  const wired = seen.wired;

  H.eq(asked && asked.url, '/api/activities-admin', 'it asks the activities endpoint');
  H.eq(asked && asked.action, 'calendar', 'for the calendar');
  H.eq(wired, 1, 'and wires the hints exactly once');

  const cal = dom.document.getElementById('calendar');
  const days = byClass(cal, 'cal-day');
  const drawn = byClass(cal, 'cal-row');
  H.eq(drawn.length, rep.sessions.length, 'every session is drawn (' + drawn.length + ')');
  H.eq(days.length, rep.counts.dates, 'one day block per date');
  H.ok(byClass(cal, 'cal-month').length > 0, 'and the months are headed');

  // ⚠ THE MARK IS ON THE ROWS IN THE CLASH, NOT THE WHOLE DAY. A date holding
  // three sessions of which two collide must mark two.
  const marked = drawn.filter((n) => /is-clash/.test(n.className));
  const sides = new Set();
  rep.clashes.forEach((c) => {
    sides.add(c.a.slug + '__' + c.a.groupId + '__' + c.a.date);
    sides.add(c.b.slug + '__' + c.b.groupId + '__' + c.b.date);
  });
  H.eq(marked.length, sides.size, 'exactly the rows in a clash are marked (' + marked.length + ')');
  H.ok(marked.length < drawn.length, 'and not every row');

  const cards = byClass(dom.document.getElementById('clashes'), 'cal-clash');
  H.eq(cards.length, rep.clashes.length, 'one card per clash (' + cards.length + ')');
  H.eq(dom.document.getElementById('clash-panel').hidden, rep.clashes.length === 0,
    'the clash panel is shown only when there is something in it');

  const counts = textOf(dom.document.getElementById('counts'));
  H.ok(counts.indexOf(String(rep.counts.sessions)) !== -1, 'the counts line names the session total');
  H.ok(counts.indexOf('live activit') !== -1, 'and says what it is counting');

  // A title is a {he,en,ru} bag and the admin reads English. A row printing
  // "[object Object]" is the shape this repo already shipped once on a teacher
  // roster, so the drawn text is read rather than assumed.
  const firstRow = textOf(drawn[0] || {});
  H.ok(firstRow.indexOf('[object Object]') === -1, 'no row prints a raw language bag');
  H.ok(firstRow.length > 0, 'and a row has words in it');

  // Unticking may only ever ADD days.
  const before = byClass(dom.document.getElementById('calendar'), 'cal-day').length;
  box.click();
  const after = byClass(dom.document.getElementById('calendar'), 'cal-day').length;
  H.ok(after >= before, 'unticking "hide past" never hides a day (' + before + ' -> ' + after + ')');
  H.eq(box.checked, false, 'and the box actually toggled');

  // ⚠ THE LIVE DATA EXERCISES NEITHER EMPTY BRANCH — it has clashes, and every
  // one of its dates is still ahead — so both assertions above passed with the
  // code reverted. A bite-check found that, and it is the reason this second
  // report exists rather than a comment saying the branches are fine.
  console.log('\n[the two states the live data cannot reach]');

  const quiet = {
    counts: { activities: 1, sessions: 2, dates: 2, clashes: 0, undated: 0 },
    clashes: [], clashedDates: [],
    sessions: [
      { date: '2020-01-01', time: '18:00', startsAt: 1080, minutes: 90, endsAt: '19:30',
        slug: 'old', title: { en: 'Long Over' }, type: 'course', status: 'open',
        listing: 'listed', groupId: 'g-1', groupName: {}, named: false, location: {} },
      { date: '2099-01-01', time: '18:00', startsAt: 1080, minutes: 90, endsAt: '19:30',
        slug: 'soon', title: { en: 'Far Ahead' }, type: 'course', status: 'open',
        listing: 'listed', groupId: 'g-1', groupName: {}, named: false, location: {} }
    ]
  };
  const q = await drive(quiet);
  H.eq(q.dom.document.getElementById('clash-panel').hidden, true,
    'with nothing colliding the clash panel is HIDDEN, not an empty box');
  H.eq(q.dom.document.getElementById('clashes').childNodes.length, 0, 'and holds no cards');
  H.eq(byClass(q.dom.document.getElementById('calendar'), 'cal-row')
    .filter((n) => /is-clash/.test(n.className)).length, 0, 'and no row is marked');

  const ahead = byClass(q.dom.document.getElementById('calendar'), 'cal-day').length;
  H.eq(ahead, 1, 'a date that has passed is hidden while the box is ticked');
  q.box.click();
  const all = byClass(q.dom.document.getElementById('calendar'), 'cal-day').length;
  H.eq(all, 2, 'and unticking brings it back — so the checkbox is really wired');
  H.ok(byClass(q.dom.document.getElementById('calendar'), 'cal-day')
    .some((n) => /is-past/.test(n.className)), 'the one that has passed is marked as past');

  H.done();
})();
