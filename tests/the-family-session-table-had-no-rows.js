// What this defends against:
//
// /account/activity draws the dates a course meets on, from `sessionRows` in the
// `registration` payload. It built them like this:
//
//     facts.sessionRows((activity.facts || {}).duration, lang)
//
// `activity.facts.duration` is the ACTIVITY's duration fact, and it has been
// EMPTY on every record in this repository since the seven facts moved onto the
// group. So sessionRows() was handed {} and honestly returned [] — and the table
// on every family's own registration page, on every activity, had NO ROWS AT ALL.
//
// ⚠ NOTHING ERRORED AND NOTHING LOOKED WRONG. The client draws a table and omits
// it when there is nothing to draw, so the screen was simply missing a block
// nobody could miss without knowing it should be there. The line DIRECTLY ABOVE
// it threads `reg.groupId` through correctly and always has, which is the tell:
// one call site was missed when the facts moved.
//
// ⚠ AND THE SUITE THAT RENDERS THIS SCREEN WATCHED IT HAPPEN. It feeds the
// client a HAND-WRITTEN payload carrying one session row — so it proved the
// client renders rows it is given, and could never prove the server gives it
// any. Reading each side proves that side is self-consistent, which is this
// project's oldest lesson about its own tests. So this drives the REAL handler.
//
// The second half is the thing that was asked for: each row carries the hour
// that session starts at, from the same resolver the published table reads.

const H = require('./_helpers');
const F = require('./_fixtures');

(async () => {
  console.log('[the family\'s own session table, through the real handler]');
  const blobs = H.makeBlobs();
  const live = F.course({ slug: 'term', activityId: 'act-0000000000000b22' });
  live.groups[0].capacity = 20;
  live.groups[0].facts.duration.sessionDates = [
    { date: '2026-10-14', status: 'scheduled' },
    { date: '2026-10-21', status: 'excluded', reason: 'Teacher away' },
    { date: '2026-10-28', status: 'scheduled' }
  ];
  live.groups[0].facts.schedule = {
    frequency: 'weekly', sessions: [{ day: 3, time: '16:00' }],
    // ⚠ THE OVERRIDE IS WHAT HID THE HOUR EVERYWHERE ELSE, and it stays free
    // text: nothing appends a time to it. The table is where the hour lives now.
    overrideText: { he: 'פעם בשבועיים', en: 'Once a fortnight', ru: 'Раз в две недели' }
  };
  const github = H.makeGithub({
    'activities/term.json': JSON.stringify(live),
    'activities/activities-index.json': JSON.stringify(
      [{ slug: 'term', activityId: live.activityId, status: 'open',
         langs: ['he', 'en', 'ru'], title: live.title }])
  });
  const mods = H.loadWithStubs({ blobs, github,
    modules: ['account-auth', 'account-family', 'account-registrations'] });
  const up = await H.signUp(mods['account-auth'], blobs,
    { email: 'dana@example.com', firstName: 'Dana' });
  const token = up.body.token;
  const made = await H.call(mods['account-family'].handler, { action: 'createParticipant',
    token: token, participant: { firstName: 'Noa', lastName: 'Levi', dateOfBirth: '2017-04-02' } });
  const pid = made.body.participant.participantId;
  await H.call(mods['account-registrations'].handler,
    { action: 'submit', token: token, slug: 'term', participantId: pid, lang: 'en' });

  const page = async (lang) => (await H.call(mods['account-registrations'].handler,
    { action: 'registration', token: token, participantId: pid,
      activityId: live.activityId, lang: lang || 'en' })).body;

  const rows = ((await page()).activity || {}).sessionRows;
  H.ok(Array.isArray(rows), 'the payload carries sessionRows');
  H.eq(rows.length, 2, '⚠ TWO ROWS — it returned NONE on every activity for releases');
  H.eq(rows[0].date, '14 October', 'the first meeting');
  H.eq(rows[1].date, '28 October',
    'and the next one that HAPPENS — an excluded date is absent, as it is on the published page');
  H.eq(rows[0].time, '16:00', 'each row carries the hour that session starts at');
  H.eq(rows[1].time, '16:00', 'every one of them');

  // The override is still doing exactly what it did: replacing the sentence, and
  // carrying no hour unless an admin typed one into it. That is the behaviour
  // that was asked for, so it is pinned rather than left to drift back.
  const when = JSON.stringify(((await page()).activity || {}).facts || []);
  H.ok(when.indexOf('Once a fortnight') !== -1, 'the When line is the admin\'s own words');
  H.ok(!/Once a fortnight[^"]*16:00/.test(when),
    '⚠ and NOTHING appends the stored hour to them — the override is free text and stays free text');

  // Three languages, because the rows are built per language and a missing
  // language is how one of these tables goes blank again.
  for (const lang of ['he', 'ru']) {
    const r = ((await page(lang)).activity || {}).sessionRows;
    H.eq(r.length, 2, lang + ': the rows are there too');
    H.eq(r[0].time, '16:00', lang + ': with the hour');
    H.ok(String(r[0].day || '').length > 0, lang + ': and the weekday in that language');
  }

  // -------------------------------------------------------------------------
  // ⚠ AND THE PICKER'S HOUR, FROM THE SERVER.
  //
  // The client suite proves an option renders the `time` it is handed. It cannot
  // prove the server hands it one — that is the shape where two sides are each
  // self-consistent and disagree, which is how a link format and its test came
  // to differ in writing. So the real handler is asked.
  console.log('\n[each group states its own hour in the picker]');
  const two = F.course({ slug: 'two', activityId: 'act-0000000000000c33' });
  const second = JSON.parse(JSON.stringify(two.groups[0]));
  two.groups[0].name = { he: 'מתחילים', en: 'Beginners', ru: 'Начинающие' };
  two.groups[0].capacity = 10;
  two.groups[0].facts.schedule = { frequency: 'weekly', sessions: [{ day: 3, time: '16:00' }] };
  second.groupId = 'g-advanced';
  second.name = { he: 'מתקדמים', en: 'Advanced', ru: 'Продолжающие' };
  second.capacity = 10;
  second.facts.schedule = { frequency: 'weekly', sessions: [{ day: 3, time: '18:00' }] };
  two.groups.push(second);
  github._files.set('activities/two.json', JSON.stringify(two));
  github._files.set('activities/activities-index.json', JSON.stringify([
    { slug: 'term', activityId: live.activityId, status: 'open',
      langs: ['he', 'en', 'ru'], title: live.title },
    { slug: 'two', activityId: two.activityId, status: 'open',
      langs: ['he', 'en', 'ru'], title: two.title }]));

  const panel = (await H.call(mods['account-registrations'].handler,
    { action: 'registerPanel', token: token, slug: 'two', lang: 'en' })).body;
  const gs = (panel.activity || {}).groups || [];
  H.eq(gs.length, 2, 'both groups are offered');
  H.eq(gs[0].time, '16:00', 'the first carries its own hour');
  H.eq(gs[1].time, '18:00', '⚠ and the second a DIFFERENT one — never the first group\'s');

  H.done();
})();
