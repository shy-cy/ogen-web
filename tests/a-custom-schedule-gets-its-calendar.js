// What this defends against:
//
// Generating the session calendar was a BUTTON and only a button, so an activity
// could be saved and published with its dates sitting in `schedule.sessions[]`
// and `duration.sessionDates` never generated from them. All three custom
// activities on the live site were in exactly that state, for months:
//
//   - the published page rendered NO session table;
//   - `sessionCount()` is derived from the calendar, so there was no count;
//   - the "(N sessions × M lessons)" qualifier was absent;
//   - and a prorated refund divides sessions-remaining by sessions-total, so the
//     denominator was an empty list.
//
// Nothing errored and nothing looked broken, because each half behaved as
// written: the button works, and nothing ever said pressing it was compulsory.
//
// Reported as: "activities using a custom schedule can be saved with dates
// entered in schedule.sessions[], but never having their actual session calendar
// generated from those dates."
//
// Six things have to hold:
//
//   1. ⚠ IT READS, IT NEVER GUESSES. Only the dates an admin has written down.
//      A custom row carrying a weekday and no date yields NOTHING — which is
//      `beit-midrash` on the live site — rather than a calendar walked forward
//      from a pattern nobody typed.
//   2. ⚠ IT NEVER OVERWRITES. Any existing calendar means there is nothing to do,
//      so the manual button keeps its whole job: regenerating after a schedule
//      change, clearing, and editing by hand all still go through it.
//   3. ⚠ IT AGREES WITH THE BUTTON, to the date. Two mechanisms answering one
//      question have to give one answer, or pressing Generate after a save
//      changes the calendar for no reason.
//   4. ⚠ IT IS NOT SILENT. The save names what it generated, with the count and
//      the span; the client carries the dates into its own model so the table is
//      on screen rather than only described.
//   5. ⚠ PREVIEW SEES IT TOO, or `preview-matches-publish` breaks the first time
//      it fires — a preview with no session table and a published page with one.
//   6. ⚠ IT IS DERIVED FROM WHAT IS STORED, so a restricted role cannot steer it
//      and produces byte-identical dates to a full editor.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_helpers');
const D = require('./_dom');
const F = require('./_fixtures');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const SESSIONS = require(H.fnPath('_activity-sessions'));

// A custom schedule with its dates written down and no calendar built from them.
function customGroup(dates, over) {
  const g = F.course().groups[0];
  g.facts.schedule = {
    frequency: 'custom',
    sessions: dates.map((d) => ({ day: new Date(d + 'T00:00:00Z').getUTCDay(), time: '19:30', date: d })),
    overrideText: { he: '', en: '', ru: '' }
  };
  g.facts.duration = Object.assign({
    startDate: dates[0] || null, endDate: dates[dates.length - 1] || null,
    sessionCount: null, sessionMinutes: 90, sessionDates: []
  }, over || {});
  return g;
}

(async () => {
  // --------------------------------------------------------------- the rule --
  console.log('[it reads the dates that are there, and invents none]');

  const THREE = ['2026-10-21', '2026-11-04', '2026-11-18'];
  let out = SESSIONS.autoFill(customGroup(THREE).facts);
  H.ok(out && out.sessionDates, 'a custom schedule with dates gets a calendar');
  H.eq(out.sessionDates.map((r) => r.date).join(','), THREE.join(','),
    '⚠ exactly the dates entered, in order, and nothing else');
  H.ok(out.sessionDates.every((r) => r.status === 'scheduled'),
    'every one of them scheduled, since nothing has been excluded yet');

  // ⚠ The live `beit-midrash` shape: a custom row with a weekday and no date.
  const bare = customGroup([]);
  bare.facts.schedule.sessions = [{ day: 0, time: '18:00' }];
  out = SESSIONS.autoFill(bare.facts);
  H.eq((out || {}).undated, true,
    '⚠ a custom row with a WEEKDAY AND NO DATE generates nothing and says so — walking ' +
    'Sundays forward would be inventing meetings nobody typed');
  H.ok(!(out || {}).sessionDates, 'so there is no calendar to store');

  // Duplicates and disorder are the admin's typing, not new information.
  out = SESSIONS.autoFill(customGroup(
    ['2026-11-18', '2026-10-21', '2026-11-18', '2026-11-04']).facts);
  H.eq(out.sessionDates.map((r) => r.date).join(','), THREE.join(','),
    'duplicates collapse and the order is the calendar’s, not the typing’s');

  console.log('\n[and it never touches a calendar that exists]');
  const has = customGroup(THREE, { sessionDates: [{ date: '2020-01-01', status: 'scheduled' }] });
  H.eq(SESSIONS.autoFill(has.facts), null,
    '⚠ an existing calendar means nothing to do — the button owns regeneration');
  const allExcluded = customGroup(THREE, {
    sessionDates: THREE.map((d) => ({ date: d, status: 'excluded', reason: 'off' })) });
  H.eq(SESSIONS.autoFill(allExcluded.facts), null,
    '⚠ INCLUDING ONE WHOSE EVERY DATE IS EXCLUDED. That is a deliberate state, and ' +
    'refilling it would un-exclude a term an admin switched off');
  const weekly = customGroup(THREE);
  weekly.facts.schedule.frequency = 'weekly';
  H.eq(SESSIONS.autoFill(weekly.facts), null, 'and a non-custom frequency is left alone');
  const empty = customGroup([]);
  H.eq(SESSIONS.autoFill(empty.facts), null, 'a schedule with no rows at all has nothing to say');

  console.log('\n[the typed count is a cap, exactly as the button treats it]');
  out = SESSIONS.autoFill(customGroup(THREE, { sessionCount: 2 }).facts);
  H.eq(out.sessionDates.length, 2,
    'a typed count of 2 caps at 2, which is what pressing Generate does with the same input');

  console.log('\n[dates outside the term are reported, never corrected]');
  const stray = customGroup(['2026-10-21', '2021-05-05', '2026-11-18'],
    { startDate: '2026-10-01', endDate: '2026-12-31' });
  out = SESSIONS.autoFill(stray.facts);
  H.eq(out.sessionDates.length, 3,
    '⚠ the stray date is KEPT — filtering would drop a date somebody typed on purpose');
  H.eq(SESSIONS.strayDates(out.sessionDates, stray.facts.duration).join(','), '2021-05-05',
    'and named, which is how a typo nobody could see becomes visible');
  H.eq(SESSIONS.strayDates(out.sessionDates, { startDate: null, endDate: null }).length, 0,
    'with no term dates to compare against there is nothing to report');

  // ------------------------------------------------------------- the button --
  console.log('\n[the auto-fill and the Generate button give one answer]');

  const blobs = H.makeBlobs();
  const github = H.makeGithub({});
  const mods = H.loadWithStubs({ blobs, github, modules: ['activities-admin'] });
  const api = mods['activities-admin'];
  await H.installSession(blobs, H.superAdminSession());

  const SIX = ['2026-10-21', '2026-11-04', '2026-11-18', '2026-12-09', '2027-01-13', '2027-01-27'];
  for (const cap of [null, 4]) {
    const g = customGroup(SIX, { sessionCount: cap });
    const pressed = await H.call(api.handler, {
      action: 'sessions', token: 'test-token',
      schedule: g.facts.schedule, duration: g.facts.duration
    });
    H.eq(pressed.status, 200, 'the button answers (cap ' + cap + ')');
    const auto = SESSIONS.autoFill(g.facts);
    H.eq(JSON.stringify(auto.sessionDates), JSON.stringify(pressed.body.sessionDates),
      '⚠ BYTE-IDENTICAL to what the button produces for the same input (cap ' + cap + ') — ' +
      'or pressing Generate after a save would change the calendar for no reason');
  }

  // ------------------------------------------------------------ at save time --
  console.log('\n[a save fills it in, and says so]');

  const record = Object.assign(F.course(), { slug: 'custom-one', status: 'open' });
  // No series at all. mergeByPermission() MINTS an activityId for a record the
  // repository has never seen — deliberately, because preview does not stamp —
  // so the fixture's own seriesId would then point at a different id and preview
  // would refuse for pointing at a term that does not exist here.
  record.seriesId = null;
  record.groups = [customGroup(SIX)];
  record.groups[0].name = { he: '', en: '', ru: '' };

  const save = (over) => H.call(api.handler, Object.assign({
    action: 'saveDraft', token: 'test-token',
    activity: JSON.parse(JSON.stringify(record)), baseUpdatedAt: null
  }, over || {}));

  let res = await save();
  H.eq(res.status, 200, 'the draft saves');
  const saved = res.body.activity.groups[0].facts.duration.sessionDates;
  H.eq(saved.map((r) => r.date).join(','), SIX.join(','),
    '⚠ AND THE CALENDAR IS ON THE RECORD — which is the whole gap: this used to save ' +
    'with the dates in the schedule and nothing generated from them');
  H.eq(SESSIONS.sessionCount(saved), 6,
    'so the derived count answers, where it used to be nothing');

  H.ok(res.body.calendars, '⚠ and the save REPORTS it rather than doing it silently');
  H.eq(res.body.calendars.generated.length, 1, 'naming the one group it filled');
  H.eq(res.body.calendars.generated[0].count, 6, 'with the count');
  H.eq(res.body.calendars.generated[0].first, SIX[0], 'and the span it covers');
  H.eq(res.body.calendars.generated[0].last, SIX[SIX.length - 1], 'both ends of it');
  H.eq(res.body.calendars.generated[0].groupId, record.groups[0].groupId,
    'and which group, so the client can patch the right one');
  H.eq(res.body.calendars.undated.length, 0, 'and nothing to complain about');

  // ⚠ The second save must find nothing to do, or this would be rewriting the
  // calendar on every save and quietly undoing an admin's exclusions.
  const second = JSON.parse(JSON.stringify(record));
  second.groups[0].facts.duration.sessionDates =
    saved.map((r, i) => (i === 1 ? { date: r.date, status: 'excluded', reason: 'Hanukkah' } : r));
  res = await H.call(api.handler, { action: 'saveDraft', token: 'test-token',
    activity: second, baseUpdatedAt: res.body.baseUpdatedAt });
  H.eq(res.status, 200, 'a second save goes through');
  H.eq(res.body.calendars.generated.length, 0,
    '⚠ and generates nothing the second time — it only ever fills a blank');
  const kept = res.body.activity.groups[0].facts.duration.sessionDates;
  H.eq(kept[1].status, 'excluded', 'so an excluded date stays excluded');
  H.eq(kept[1].reason, 'Hanukkah', 'and keeps its reason');

  // ⚠ AND THE STRAY DATES RIDE BACK WITH IT. strayDates() being right is one
  // thing and the save carrying its answer is another — the client renders that
  // field, so a save that computed it and dropped it would leave a typo silent
  // with every unit test still green.
  const strayRec = Object.assign(F.course(), { slug: 'stray-one', status: 'open' });
  strayRec.seriesId = null;
  strayRec.groups = [customGroup(['2026-10-21', '2021-05-05', '2026-11-18'],
    { startDate: '2026-10-01', endDate: '2026-12-31' })];
  res = await H.call(api.handler, { action: 'saveDraft', token: 'test-token',
    activity: strayRec, baseUpdatedAt: null });
  H.eq(res.status, 200, 'a record with a date outside its term still saves');
  H.eq(res.body.calendars.generated[0].count, 3,
    '⚠ the stray date is KEPT in the calendar — never filtered out from under the admin');
  H.eq((res.body.calendars.generated[0].stray || []).join(','), '2021-05-05',
    '⚠ and the save NAMES it, which is the only reason a typo nobody could see becomes ' +
    'something somebody acts on');

  console.log('\n[a dateless custom schedule is told it got nothing]');
  const dateless = Object.assign(F.course(), { slug: 'dateless', status: 'open' });
  dateless.seriesId = null;
  const dg = customGroup([]);
  dg.facts.schedule.sessions = [{ day: 0, time: '18:00' }];
  dg.name = { he: '', en: '', ru: '' };
  dateless.groups = [dg];
  res = await H.call(api.handler, { action: 'saveDraft', token: 'test-token',
    activity: dateless, baseUpdatedAt: null });
  H.eq(res.status, 200, 'it still saves — a draft saves whatever is in it');
  H.eq(res.body.calendars.generated.length, 0, 'nothing was generated');
  H.eq(res.body.calendars.undated.length, 1,
    '⚠ and the admin is told WHY, or a save with no table looks like the feature failing');

  console.log('\n[preview fills it too, or preview stops matching publish]');
  const prev = await H.call(api.handler, { action: 'preview', token: 'test-token',
    activity: JSON.parse(JSON.stringify(record)) });
  H.eq(prev.status, 200, 'the preview renders');
  H.ok(/2026-10-21|21 October/.test(prev.body.html.he + prev.body.html.en),
    '⚠ and its HTML carries the session table — a fill that ran only on publish would ' +
    'make the previewed page differ from the committed one');

  console.log('\n[a restricted role produces the same dates as a full editor]');
  // ⚠ A stored draft with its dates and no calendar, seeded directly — because a
  // save by a full editor would already have filled it, and then the reviewer's
  // save would correctly find nothing to do and prove nothing.
  const stored = JSON.parse(JSON.stringify(record));
  stored.slug = 'ru-one';
  stored.isoUpdated = '2026-09-01T00:00:00.000Z';
  const drafts = await blobs.requireStore('activity-drafts');
  await drafts.setJSON('activity-ru-one', stored);

  await H.installSession(blobs, H.ruReviewerSession());
  // The reviewer asks for a calendar of its own and for the dates to move. A
  // restricted role may write words and not structure, so both are discarded —
  // and the fill must still produce the stored dates.
  const hostile = JSON.parse(JSON.stringify(stored));
  hostile.groups[0].facts.schedule.sessions = [{ day: 1, time: '09:00', date: '2099-01-01' }];
  hostile.groups[0].facts.duration.sessionDates = [{ date: '2099-01-01', status: 'scheduled' }];
  const ru = await H.call(api.handler, { action: 'saveDraft', token: 'ru-token',
    activity: hostile, baseUpdatedAt: stored.isoUpdated });
  H.eq(ru.status, 200, 'a Russian-only reviewer can save');
  H.eq(JSON.stringify((ru.body.activity.groups[0].facts.duration.sessionDates || [])
    .map((r) => r.date)), JSON.stringify(SIX),
    '⚠ and gets the STORED dates — the fill reads what is on the record, so nothing a ' +
    'request carries can steer it and no role can produce a different calendar');
  H.eq(ru.body.calendars.generated.length, 1, 'it did fill one, so the assertion is not vacuous');

  await H.installSession(blobs, H.superAdminSession());
  // The same record, saved by a full editor, has to come out identical.
  const drafts2 = await blobs.requireStore('activity-drafts');
  await drafts2.setJSON('activity-ru-one', stored);
  const full = await H.call(api.handler, { action: 'saveDraft', token: 'test-token',
    activity: JSON.parse(JSON.stringify(stored)), baseUpdatedAt: stored.isoUpdated });
  H.eq(full.status, 200, 'and so can a full editor');
  H.eq(JSON.stringify(full.body.activity.groups[0].facts.duration.sessionDates),
    JSON.stringify(ru.body.activity.groups[0].facts.duration.sessionDates),
    '⚠ BYTE-IDENTICAL between the two roles, which is what makes filling structure on a ' +
    'restricted role\u2019s save safe rather than a hole in the permission model');

  // ----------------------------------------------------------- the live data --
  console.log('\n[the three live custom activities, as they stand]');
  const live = {};
  ['beit-midrash', 'beit-midrash-ayeka', 'intro-into-judaism'].forEach((slug) => {
    const rec = JSON.parse(read('activities/' + slug + '.json'));
    live[slug] = rec.groups.map((g) => SESSIONS.autoFill(g.facts));
  });
  H.ok(live['beit-midrash'].every((x) => x && x.undated),
    '⚠ beit-midrash holds a weekday and no dates, so it gets NO calendar and is told why');
  H.eq(live['beit-midrash-ayeka'][0].sessionDates.length, 9,
    'beit-midrash-ayeka gets the nine dates it already lists');
  H.eq(live['intro-into-judaism'][0].sessionDates.length, 24,
    'intro-into-judaism gets its twenty-four');
  const introRec = JSON.parse(read('activities/intro-into-judaism.json'));
  H.eq(SESSIONS.strayDates(live['intro-into-judaism'][0].sessionDates,
    introRec.groups[0].facts.duration).join(','), '2021-05-05',
    '⚠ AND ITS ONE TYPO IS NAMED: a 2021 date in a run of 2027 ones, invisible until ' +
    'now because that activity had no calendar to print it');

  // ---------------------------------------------------------------- client ---
  console.log('\n[the client says what it generated, and puts it on screen]');
  const src = read('js/activities-admin.js');
  // The two new client functions, executed rather than read — the same way
  // a-ticked-date-is-one-that-happens.js runs sessionCalendarBox(). Reading the
  // source would prove the source is self-consistent and could never prove that
  // an admin is shown the dates.
  const slice = (name, end) => {
    const i = src.indexOf('function ' + name);
    H.ok(i !== -1, name + '() is there to be executed');
    const j = src.indexOf('\n  function ' + end, i);
    return src.slice(i, j === -1 ? undefined : j);
  };
  const drawn = [];
  const ctx2 = {
    S: { groups: [], ownerEdit: null },
    JSON: JSON, String: String, Number: Number, Object: Object, Array: Array,
    // A node for every id it looks up, so the redraws it asks for actually run —
    // with `$` returning null the whole visible half of this would be skipped and
    // the assertions below would pass on a function that draws nothing.
    $: (id) => ({ id: id, hidden: false }),
    drawGroups: () => drawn.push('groups'),
    drawOwnerPage: () => drawn.push('ownerPage'),
    out: null
  };
  vm.createContext(ctx2);
  vm.runInContext([
    slice('esc', 'message'), slice('groupLabel', 'liveDates'),
    slice('calendarLines', 'absorbCalendars'), slice('absorbCalendars', 'doSaveDraft'),
    'out = { calendarLines: calendarLines, absorbCalendars: absorbCalendars, S: S };'
  ].join('\n'), ctx2);
  const C = ctx2.out;

  // One unnamed group is the ordinary case: its name is not published, so the
  // sentence is about the activity rather than about "Unnamed group".
  C.S.groups = [{ groupId: 'g-1', name: { he: '', en: '', ru: '' }, facts: {} }];
  let line = C.calendarLines({ generated: [
    { groupId: 'g-1', name: { he: '', en: '', ru: '' }, count: 6,
      first: '2026-10-21', last: '2027-01-27', stray: [] }], undated: [] });
  H.ok(/Session calendar generated/.test(line), 'a save says a calendar was generated');
  H.ok(/6 dates/.test(line), 'with the count: ' + line.replace(/<[^>]*>/g, ''));
  H.ok(/2026-10-21 to 2027-01-27/.test(line), 'and the span it covers');
  H.ok(/this activity/.test(line) && !/Unnamed group/.test(line),
    'and it names the activity rather than an internal placeholder, with one unnamed group');

  C.S.groups = [C.S.groups[0], { groupId: 'g-2', name: { en: 'Advanced' }, facts: {} }];
  line = C.calendarLines({ generated: [
    { groupId: 'g-2', name: { en: 'Advanced' }, count: 1, first: '2026-10-21',
      last: '2026-10-21', stray: [] }], undated: [] });
  H.ok(/\u201cAdvanced\u201d/.test(line), 'with two groups the name is named: ' + line.replace(/<[^>]*>/g, ''));
  H.ok(/1 date\b/.test(line), 'and one date is not "1 dates"');

  line = C.calendarLines({ generated: [
    { groupId: 'g-2', name: { en: 'Advanced' }, count: 24, first: '2021-05-05',
      last: '2027-10-20', stray: ['2021-05-05'] }], undated: [] });
  H.ok(/falls\s+outside/.test(line.replace(/\s+/g, ' ')),
    '⚠ a date outside the term is called out on the save: ' + line.replace(/<[^>]*>/g, '').slice(0, 200));
  H.ok(/2021-05-05/.test(line), 'and named, so a typo nobody could see is in front of whoever typed it');

  line = C.calendarLines({ generated: [],
    undated: [{ groupId: 'g-2', name: { en: 'Advanced' } }] });
  H.ok(/no dates/.test(line) && /guesses/.test(line),
    '⚠ and a dateless custom schedule is told nothing was generated and why: ' +
    line.replace(/<[^>]*>/g, ''));

  console.log('\n[and the dates reach the client\u2019s own model]');
  C.S.groups = [{ groupId: 'g-1', name: { en: 'A' }, facts: { duration: { sessionDates: [] } } }];
  C.S.ownerEdit = { groupId: 'g-1', facts: { duration: { sessionDates: [] } }, dates: [] };
  const answer = {
    calendars: { generated: [{ groupId: 'g-1', name: { en: 'A' }, count: 2,
      first: '2026-10-21', last: '2026-11-04', stray: [] }], undated: [] },
    activity: { groups: [{ groupId: 'g-1', facts: { duration: { sessionDates: [
      { date: '2026-10-21', status: 'scheduled' },
      { date: '2026-11-04', status: 'excluded', reason: 'Hanukkah' }] } } }] }
  };
  C.absorbCalendars(answer);
  H.eq(C.S.groups[0].facts.duration.sessionDates.length, 2,
    '⚠ the model has the generated dates — without this the NEXT save would send the ' +
    'calendar-less groups it still held');
  H.eq(C.S.ownerEdit.dates.length, 2,
    '⚠ and so does the open sub-page\u2019s own working copy, or the table stays blank in ' +
    'front of the message saying it was built');
  H.eq(C.S.ownerEdit.dates[1].status, 'excluded', 'carrying each row\u2019s status');
  H.eq(C.S.ownerEdit.dates[1].reason, 'Hanukkah', 'and its reason');
  H.ok(drawn.indexOf('groups') !== -1,
    'the group list is redrawn, since it summarises each group\u2019s timetable');
  H.ok(drawn.indexOf('ownerPage') !== -1,
    '⚠ and the open group\u2019s page is redrawn, which is where the session table actually is');
  H.eq(C.absorbCalendars({}), '', 'a response with no calendars block says nothing at all');

  const drafted = src.slice(src.indexOf('function doSaveDraft'), src.indexOf('function doPublish'));
  H.ok(/absorbCalendars\(res\.data\)/.test(drafted),
    'a draft save absorbs it, because a draft save does not reload the record');
  const published = src.slice(src.indexOf('function doPublish'), src.indexOf('function doUnpublish'));
  H.ok(/calendarLines\(res\.data\.calendars/.test(published),
    'and a publish says it too, even though load() redraws the form for it');

  H.done();
})();
