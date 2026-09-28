// What this defends against:
//
// Reported as "the placement of the activity cards on /activities keeps
// changing". It did, and the cause was that the listing pages had NO SORT AT
// ALL — they rendered the set in whatever order it arrived. A publish hands that
// set over as `others.concat([activity])`, so THE ACTIVITY YOU JUST PUBLISHED
// MOVED TO THE END of the public listing. Measured on the live site before the
// fix: slug order, with beit-midrash — published that morning — last.
//
// ⚠ AND THE SAME SIX ACTIVITIES CAME OUT IN THREE DIFFERENT ORDERS. The index
// file sorted by slug, the listing pages sorted by nothing, and the menu sorted
// by TRANSLATED TITLE — so the Hebrew and English menus disagreed with each
// other as well as with the page. None of the three was anybody's intended
// order, because nothing anywhere stated one.
//
// `listingOrder` is that statement, and this suite is what stops the three
// surfaces drifting apart again. The sort UI is deliberately not built yet: the
// field is set on the record and is not writable through the API, which is why
// the save test below matters more than it looks.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');
const F = require('./_fixtures');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const IDX = require(H.fnPath('_activity-index'));
const nav = read('js/nav.js');

const act = (slug, order, over) => Object.assign(
  F.course({ slug: slug, activityId: 'act-' + slug.replace(/[^a-f0-9]/g, '0').padEnd(16, '0').slice(0, 16) }),
  { status: 'open', listingOrder: order }, over || {});

// ---------------------------------------------------------------------------
console.log('[the order is the record’s, not the reader’s]');

const shuffled = [act('c', 30), act('a', 10), act('b', 20)];
H.eq(IDX.inListingOrder(shuffled).map((a) => a.slug).join(','), 'a,b,c',
  'ascending by listingOrder, whatever order they arrive in');

// ⚠ THE PUBLISH SHAPE. This is the exact call generate() makes — the others,
// then the one being published — and it is what used to move a card.
const others = [act('a', 10), act('b', 20)];
const publishing = act('c', 30);
H.eq(IDX.inListingOrder(others.concat([publishing])).map((a) => a.slug).join(','), 'a,b,c',
  '⚠ and publishing one does not move it to the end');
H.eq(IDX.inListingOrder([act('c', 30)].concat([act('a', 10)])).map((a) => a.slug).join(','), 'a,c',
  'nor does publishing the first one move it either way');

// ---------------------------------------------------------------------------
console.log('\n[an activity with no number, and the answer is still total]');

// A new activity has no order yet. It goes last, predictably, rather than
// wherever the reader happened to put it — and ties break on slug so two of them
// cannot swap between two runs of the same build.
const mixed = [act('zebra', null), act('apple', null), act('named', 5)];
H.eq(IDX.inListingOrder(mixed).map((a) => a.slug).join(','), 'named,apple,zebra',
  'numbered first, then the rest by slug');
H.eq(IDX.inListingOrder(mixed.slice().reverse()).map((a) => a.slug).join(','), 'named,apple,zebra',
  '⚠ and the same answer from a different input order — the sort is total');

// A number of zero is a number, not a blank. `|| Infinity` would put the first
// activity in the list at the end of it.
H.eq(IDX.inListingOrder([act('b', 1), act('a', 0)]).map((a) => a.slug).join(','), 'a,b',
  '⚠ zero orders first, rather than reading as "no order"');

// ---------------------------------------------------------------------------
console.log('\n[the three surfaces agree]');

const all = [act('c', 30), act('a', 10), act('b', 20)];
const files = IDX.buildDerivedFiles(all);
const indexJson = JSON.parse(files.filter((f) => /activities-index\.json$/.test(f.path))[0].content);
H.eq(indexJson.map((e) => e.slug).join(','), 'a,b,c', 'the index file is written in order');

const listing = files.filter((f) => f.path === 'en/activities/index.html')[0].content;
const cards = (listing.match(/href="\/en\/activities\/([a-z0-9-]+)"/g) || [])
  .map((m) => m.replace(/.*activities\//, '').replace('"', ''));
H.eq(cards.join(','), 'a,b,c', '⚠ and the listing page draws its cards in the same order');

// Both trees, because a per-language sort is what the menu had.
const he = files.filter((f) => f.path === 'activities/index.html')[0].content;
const heCards = (he.match(/href="\/activities\/([a-z0-9-]+)"/g) || [])
  .map((m) => m.replace(/.*activities\//, '').replace('"', ''));
H.eq(heCards.join(','), cards.join(','),
  '⚠ and every language draws them in the SAME order — the menu used to sort by '
  + 'translated title, so Hebrew and English disagreed about what came second');

// ---------------------------------------------------------------------------
console.log('\n[the menu keeps the file’s order]');

// It still groups by status — what you can join now before what is only
// announced — and Array#sort is stable, so grouping preserves the order the
// index file was written in. A title tiebreak would undo that in one line.
const sortBlock = nav.slice(nav.indexOf('open.sort('), nav.indexOf('open.sort(') + 200);
H.ok(/OPEN\.indexOf\(a\.status\) - OPEN\.indexOf\(b\.status\)/.test(sortBlock),
  'the menu still groups by status');
H.ok(!/localeCompare/.test(sortBlock),
  '⚠ and does not fall back to the title, which is what made it a third order');

// ---------------------------------------------------------------------------
console.log('\n[⚠ a save must not wipe it, because nothing sends it]');

// There is no control for this on the form yet, so the client sends nothing for
// it — which is the undrawn-field trap this codebase keeps meeting. The answer
// here is the one that cannot be got wrong: mergeByPermission() copies the
// stored record and overwrites only the keys it names, so the field survives by
// construction rather than by the client echoing it back.
const admin = read('netlify/functions/activities-admin.js');
const merge = admin.slice(admin.indexOf('function mergeByPermission('),
                          admin.indexOf('\nfunction ', admin.indexOf('function mergeByPermission(') + 10));
H.ok(/const out = base \? Object\.assign\(\{\}, base\)/.test(merge),
  'the merge starts from the stored record');
H.ok(merge.indexOf('listingOrder') === -1,
  '⚠ and never names listingOrder, so no request can write or clear it');

// Driven rather than read, because "the merge copies base" is a claim about
// code and this is a claim about what comes out of the handler.
(async () => {
  const blobs = H.makeBlobs();
  const stored = act('kept', 42);
  const github = H.makeGithub({
    'activities/kept.json': JSON.stringify(stored),
    'activities/activities-index.json': JSON.stringify([{ slug: 'kept',
      activityId: stored.activityId, status: 'open', langs: ['he', 'en', 'ru'],
      title: stored.title }])
  });
  const mods = H.loadWithStubs({ blobs, github, modules: ['activities-admin'] });
  const api = mods['activities-admin'];
  await H.installSession(blobs, H.superAdminSession());

  // A save that says nothing about the order, which is every save there is.
  const sending = JSON.parse(JSON.stringify(stored));
  delete sending.listingOrder;
  const res = await H.call(api.handler, { action: 'saveDraft', token: 'test-token',
    activity: sending, baseUpdatedAt: stored.isoUpdated });
  H.eq(res.status, 200, 'the draft saves');
  H.eq((res.body.activity || {}).listingOrder, 42,
    '⚠ and the order is still on the record the handler hands back');

  // And a hostile one that tries to write it.
  const hostile = JSON.parse(JSON.stringify(stored));
  hostile.listingOrder = 1;
  const res2 = await H.call(api.handler, { action: 'saveDraft', token: 'test-token',
    activity: hostile, baseUpdatedAt: (res.body.activity || {}).isoUpdated });
  H.eq(res2.status, 200, 'a save naming it is accepted');
  H.eq((res2.body.activity || {}).listingOrder, 42,
    '⚠ and the value is ignored — it is not editable through the API until the '
    + 'ordering UI exists, exactly as activityId is not editable at all');

  // -------------------------------------------------------------------------
  console.log('\n[the order the site is actually published in]');

  // The six live records, in the order that was asked for. Pinned on the real
  // records rather than a fixture, because the intent is the data.
  const WANT = ['hebrew4kids', 'bnei-mitzvah-2027', 'folk-dance',
                'beit-midrash', 'intro-into-judaism', 'beit-midrash-ayeka'];
  const live = fs.readdirSync(path.join(R, 'activities'))
    .filter((f) => f.endsWith('.json') && f !== 'activities-index.json')
    .map((f) => JSON.parse(read('activities/' + f)))
    .filter((a) => WANT.indexOf(a.slug) !== -1);
  H.eq(live.length, WANT.length, 'all six are there');
  H.eq(IDX.inListingOrder(live).map((a) => a.slug).join(','), WANT.join(','),
    '⚠ in the order that was asked for');
  live.forEach((a) => H.ok(Number.isFinite(Number(a.listingOrder)),
    a.slug + ' carries a number (' + a.listingOrder + ')'));

  // And the file that ships is in that order too.
  const shipped = JSON.parse(read('activities/activities-index.json')).map((e) => e.slug);
  H.eq(shipped.slice(0, WANT.length).join(','), WANT.join(','),
    '⚠ and so is the deployed index, which is what the menu reads');

  H.done();
})();
