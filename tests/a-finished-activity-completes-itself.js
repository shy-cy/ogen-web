// What this defends against:
//
// `closed` means "registration is shut, the activity is underway", and an admin
// sets it MONTHS before the thing ends. Nothing ever asked them to come back and
// flip it to `completed`, so a course that finished in December stayed filed as
// running — on its own page, in the listing, and now in the nav menu, which
// groups by status and deliberately asks no clock.
//
// The alternative was to make the readers smarter: have the menu and the listing
// page compare dates and decide for themselves. That is wrong here for two
// reasons that are specific to this site. Every other part of it decides display
// from the declared status — js/activity.js renders the badge and the CTA from
// `data-status` alone — so a date-checking menu would be the only component
// overriding an admin, and it would contradict the page it links to. And the
// listing page is a STATIC BUILD ARTIFACT: a date comparison baked into it is
// right on the day it is generated and wrong afterwards, with nothing to notice.
//
// So the status stays the single source of truth and something else keeps it
// true. The three things this pins:
//
//   1. IT IS A PUBLISH, NOT A FIELD EDIT. The status lives in the record, on
//      three static pages and in the listing, so writing it to the record alone
//      leaves the live site saying "registration closed" under an activity that
//      ended in December — which is the exact bug this exists to fix, moved.
//   2. IT GOES THROUGH generate(). The same function an admin's publish goes
//      through, and the one preview is asserted byte-identical against. A second
//      renderer would be a second thing to keep in step.
//   3. IT ONLY EVER MOVES closed → completed, and only when the last session has
//      actually passed, end-of-day in Asia/Nicosia. Completing too early
//      archives a running activity and rewrites its public page under a family
//      still attending; the two errors are not symmetric, and every default here
//      leans the safe way.

const H = require('./_helpers');
const F = require('./_fixtures');
const A = require(H.fnPath('_activity-autocomplete'));

process.env.RESEND_FROM = 'Merkaz Ogen <noreply@ogen.cy>';

const cal = (dates) => dates.map((d) => ({ date: d, status: 'scheduled' }));
const act = (over) => F.course(Object.assign({
  slug: 'course-fixture', status: 'closed'
}, over || {}));
const withDates = (over, duration) => {
  const a = act(over);
  a.facts = Object.assign({}, a.facts, {
    duration: Object.assign({}, a.facts.duration, duration)
  });
  return a;
};
const AT = (iso) => Date.parse(iso);

console.log('[the last day is the later of the calendar and the typed end date]');
H.eq(A.lastSessionDate(withDates({}, { sessionDates: cal(['2026-10-14', '2026-12-23']), endDate: null })),
  '2026-12-23', 'the calendar when that is all there is');
H.eq(A.lastSessionDate(withDates({}, { sessionDates: [], endDate: '2026-12-20' })),
  '2026-12-20', 'the typed end date when there is no calendar');
// ⚠ THE TWO CAN DISAGREE — this repo has carried an activity whose typed session
// count ran out a week before its stated end date. The later one wins, because
// completing too early is the harmful error and completing late is not.
H.eq(A.lastSessionDate(withDates({}, { sessionDates: cal(['2026-12-16']), endDate: '2026-12-23' })),
  '2026-12-23', 'the end date when it is LATER than the last session');
H.eq(A.lastSessionDate(withDates({}, { sessionDates: cal(['2026-12-30']), endDate: '2026-12-23' })),
  '2026-12-30', 'and the calendar when IT is later');
// An excluded date is not a session, so it cannot be the last one — the same
// rule freezeCancellation() follows. If a holiday cannot take a number in the
// session table, it cannot decide when the course ends.
H.eq(A.lastSessionDate(withDates({}, {
  sessionDates: cal(['2026-12-16']).concat([{ date: '2026-12-23', status: 'excluded' }]), endDate: null
})), '2026-12-16', 'an excluded date is not the last session');
H.eq(A.lastSessionDate(withDates({}, { sessionDates: [], endDate: null })), null,
  'and nothing at all is null, not a guess');

console.log('\n[the day ends in Cyprus, not in UTC]');
const ending = withDates({}, { sessionDates: cal(['2026-12-23']), endDate: '2026-12-23' });
H.eq(A.isDue(ending, AT('2026-12-23T18:00:00Z')), false,
  '20:00 on the last day in Limassol — the activity is still running');
H.eq(A.isDue(ending, AT('2026-12-23T21:59:00Z')), false, '23:59 local, still running');
H.eq(A.isDue(ending, AT('2026-12-23T22:30:00Z')), true, 'half past midnight local, and it is over');
// Midnight UTC would have completed it two hours early; a plain date compare in
// the server's own zone would move the deadline by however far that zone is from
// Cyprus. Both errors point the same way, which is how they survive review.

console.log('\n[nothing else is ever touched]');
['draft', 'announcement', 'open', 'waitlist', 'completed', 'cancelled'].forEach((status) => {
  H.eq(A.isDue(withDates({ status }, { sessionDates: cal(['2020-01-01']) }), AT('2030-01-01T00:00:00Z')),
    false, status + ' is never auto-completed, however long ago it ended');
});
H.eq(A.isDue(withDates({ status: 'closed' }, { sessionDates: cal(['2020-01-01']) }), AT('2030-01-01T00:00:00Z')),
  true, 'only closed is');
// A missing date reads as NOT ended — the same direction every blank in
// _credit.js takes. An activity nobody finished configuring must not be archived
// on the strength of an empty field.
H.eq(A.isDue(withDates({ status: 'closed' }, { sessionDates: [], endDate: null }), AT('2030-01-01T00:00:00Z')),
  false, 'and an activity with no dates at all is left alone rather than guessed at');

console.log('\n[the completed record says a person did not do this]');
const done = A.complete(ending, AT('2026-12-24T06:00:00Z'));
H.eq(done.status, 'completed', 'the status moves');
H.eq(done.lastEditedBy, 'system', 'attributed to the system, not to whichever admin last touched it');
H.eq(done.autoCompletedAfter, '2026-12-23',
  'and the record carries the date it acted on — "it completed on the 24th" is not a useful record');
H.eq(ending.status, 'closed', 'the original is not mutated — a conflict check compares against it');
H.eq(A.isDue(done, AT('2027-06-01T00:00:00Z')), false,
  'and the result is not due again, so a second run finds nothing');

// ----------------------------------------------------------------- end to end
(async () => {
  console.log('\n[through the nightly sweep: it publishes, it does not just save]');
  const blobs = H.makeBlobs();
  const finished = withDates({ slug: 'finished', activityId: 'act-000000000000fff1' },
    { sessionDates: cal(['2026-10-14', '2026-12-23']), endDate: '2026-12-23' });
  const running = withDates({ slug: 'still-running', activityId: 'act-000000000000fff2' },
    { sessionDates: cal(['2027-03-01']), endDate: '2027-03-01' });
  const openOne = withDates({ slug: 'taking-names', activityId: 'act-000000000000fff3', status: 'open' },
    { sessionDates: cal(['2020-01-01']), endDate: '2020-01-01' });

  const seed = {};
  [finished, running, openOne].forEach((a) => {
    seed['activities/' + a.slug + '.json'] = JSON.stringify(a, null, 2) + '\n';
  });
  seed['activities/activities-index.json'] = JSON.stringify(
    [finished, running, openOne].map((a) => ({ slug: a.slug, activityId: a.activityId, status: a.status })), null, 2);
  const github = H.makeGithub(seed);

  const mods = H.loadWithStubs({ blobs, github,
    modules: ['_registration-sweep', '_activity-template'] });
  const sweep = mods['_registration-sweep'];
  const T = mods['_activity-template'];

  const result = await sweep.completeFinishedActivities(AT('2026-12-24T06:00:00Z'));
  H.eq(result.due, 1, 'exactly one activity is due');
  H.eq(result.failed.length, 0, 'and nothing failed');
  H.eq(result.completed[0].slug, 'finished', 'the one whose last session has passed');
  H.eq(result.completed[0].after, '2026-12-23', 'named with the date it acted on');

  console.log('\n[and the files on disk agree with the record]');
  const record = JSON.parse(github._files.get('activities/finished.json'));
  H.eq(record.status, 'completed', 'the record is written');
  ['he', 'en', 'ru'].forEach((l) => {
    const p = (l === 'he' ? '' : l + '/') + 'activities/finished.html';
    H.ok(github._files.has(p), p + ' was regenerated');
    H.ok(/data-status="completed"/.test(github._files.get(p)),
      p + ' carries the new status — the whole point, since the status lives in the HTML');
  });
  // ⚠ The listing page too. Without it the menu would offer "Archived" and the
  // page it jumps to would still file the activity under Currently Running.
  const listing = github._files.get('activities/index.html');
  H.ok(listing.indexOf('id="archived"') !== -1, 'the listing page grew an Archived section');
  H.ok(listing.indexOf('>' + T.LABELS.he.indexArchived + '<') !== -1,
    'headed in the page\'s own language');
  H.ok(listing.indexOf('id="running"') !== -1,
    'and still has Currently Running, because the other closed activity is still closed');
  const index = JSON.parse(github._files.get('activities/activities-index.json'));
  H.eq((index.filter((a) => a.slug === 'finished')[0] || {}).status, 'completed',
    'and the index the menu reads is rebuilt, or the menu would disagree with the page');

  console.log('\n[it commits like a publish, attributed to nobody in particular]');
  const commit = github._commits[github._commits.length - 1];
  H.ok(/Complete activity: finished/.test(commit.message), 'the commit says what it did: ' + commit.message);
  H.ok(/last session 2026-12-23/.test(commit.message), 'and why');
  H.ok(commit.paths.indexOf('activities/finished.json') !== -1, 'the record is in the commit');
  H.ok(commit.paths.indexOf('sitemap.xml') !== -1, 'and the sitemap, rebuilt from the full set');

  console.log('\n[running it twice finds nothing the second time]');
  const again = await sweep.completeFinishedActivities(AT('2026-12-24T06:00:00Z'));
  H.eq(again.due, 0, 'idempotent — the same safety the registration half has');
  H.eq(github._commits.length, 1, 'and it commits nothing');

  console.log('\n[one bad activity does not take the run down]');
  const broken = withDates({ slug: 'broken', activityId: 'act-000000000000fff4' },
    { sessionDates: cal(['2026-12-23']), endDate: '2026-12-23' });
  delete broken.title;                       // validate() refuses a record with no title
  github._files.set('activities/broken.json', JSON.stringify(broken, null, 2) + '\n');
  const alsoDue = withDates({ slug: 'also-due', activityId: 'act-000000000000fff5' },
    { sessionDates: cal(['2026-12-23']), endDate: '2026-12-23' });
  github._files.set('activities/also-due.json', JSON.stringify(alsoDue, null, 2) + '\n');
  github._files.set('activities/activities-index.json', JSON.stringify(
    [finished, running, openOne, broken, alsoDue].map((a) => ({ slug: a.slug, activityId: a.activityId })), null, 2));

  const mixed = await sweep.completeFinishedActivities(AT('2026-12-24T06:00:00Z'));
  H.eq(mixed.failed.length, 1, 'the broken one fails');
  H.eq(mixed.failed[0].slug, 'broken', 'and is named, so tomorrow somebody knows which');
  H.eq(mixed.completed.length, 1, 'while the other still completes');
  H.eq(mixed.completed[0].slug, 'also-due', 'one activity is never the run');
  H.eq(JSON.parse(github._files.get('activities/broken.json')).status, 'closed',
    'and the failed one is untouched, so tomorrow finds it again');

  console.log('\n[the admin\'s button does NOT publish]');
  // ⚠ THE PERMISSION LEAK THIS AVOIDS. "Run now" in the admin is gated on
  // canApprove — a registrations permission — and its own hint says it "only
  // updates what the queue says and tells the family". The activity half commits
  // to git and republishes live pages, which is an activities permission. Wiring
  // that button to run() would let an admin who may work the queue but may not
  // publish do exactly that, from a control saying it does something else.
  const admin = require(H.fnPath('admin-registrations'));
  const adminSrc = require('fs').readFileSync(H.fnPath('admin-registrations'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  H.ok(/sweep\.runRegistrations\(\)/.test(adminSrc), 'the admin calls runRegistrations()');
  H.ok(!/sweep\.run\(\)/.test(adminSrc), 'and never run(), which is the scheduled entry point');
  const scheduled = require('fs').readFileSync(H.fnPath('registration-sweep'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  H.ok(/run\(\)/.test(scheduled) && !/runRegistrations/.test(scheduled),
    'while the scheduled function calls run(), where no session exists for a permission to leak through');
  const before = github._commits.length;
  await sweep.runRegistrations(AT('2026-12-24T06:00:00Z'));
  H.eq(github._commits.length, before, 'and running the admin half commits nothing at all');

  console.log('\n[the sweep as a whole still reports both halves]');
  const full = await sweep.run(AT('2026-12-24T06:00:00Z'));
  H.ok('expired' in full && 'activities' in full, 'one result, both jobs');
  // `broken` is still due, and that is the correct state: it failed, so it stayed
  // `closed`, so tomorrow's run picks it up again. A retry that quietly stopped
  // retrying would be the worse bug.
  H.eq(full.activities.due, 1, 'the one that failed is found again');
  H.eq(full.activities.failed.length, 1, 'and fails again, rather than being forgotten');
  H.eq(full.activities.completed.length, 0, 'while nothing else is left to do');
  // NEITHER HALF IS LOAD-BEARING and this is what says so: the registration half
  // only writes down what holdsASpot() already decided, and the activity half
  // only writes down what the calendar already said. A missed night costs a
  // stale page, never a number.
  H.eq(typeof full.checked, 'number', 'and the registration half still ran');

  H.done();
})();
