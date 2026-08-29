// The bug this defends against:
//
// Deleting an activity removed its pages and its record but left every image it
// had ever uploaded sitting in the repository, served from a public URL for
// good. Found by deleting a test activity and noticing its hero image still
// returned 200 afterwards.
//
// Nothing linked to those files, which is exactly what made it easy to miss and
// exactly what makes it wrong: an activity someone deliberately deleted went on
// serving its photographs — of children, for a children's programme — with no
// page anywhere to reveal that they were still there.
//
// Unpublish deliberately does NOT delete them. It returns the activity to a
// draft that still points at those paths and must be able to republish intact;
// deleting them would leave a draft referencing files that no longer exist.

const H = require('./_helpers');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const activity = (slug) => ({
  slug,
  status: 'open',
  title: { he: 'סדנה', en: 'Workshop', ru: '' },
  about: { he: 'תיאור', en: 'Description', ru: '' },
  heroImage: PNG,
  teachers: [{ id: 'tea-1', name: { he: 'דורית', en: 'Dorit', ru: '' }, photo: PNG }],
  sponsors: [{ id: 'spo-1', name: { he: 'קרן', en: 'Fund', ru: '' }, logo: PNG }],
  included: [], faq: [], facts: {}
});

(async () => {
  const blobs = H.makeBlobs();
  const github = H.makeGithub(H.seedRepo().files);
  const { 'activities-admin': fn } = H.loadWithStubs({ github, blobs, modules: ['activities-admin'] });
  const session = H.superAdminSession();
  await H.installSession(blobs, session);
  const auth = { token: session.token };

  const IMAGES = [
    'images/activities/purim-hero.png',
    'images/activities/purim-teachers-tea-1.png',
    'images/activities/purim-sponsors-spo-1.png'
  ];

  console.log('\n[publishing puts the images in the repo]');
  const pub = await H.call(fn.handler, Object.assign({ action: 'publish', activity: activity('purim') }, auth));
  H.eq(pub.status, 200, 'the publish succeeds');
  IMAGES.forEach((p) => H.ok(github._files.has(p), p + ' is committed'));

  console.log('\n[unpublishing keeps them — the draft still points at them]');
  const un = await H.call(fn.handler, Object.assign(
    { action: 'unpublish', slug: 'purim', baseUpdatedAt: pub.body.baseUpdatedAt }, auth));
  H.eq(un.status, 200, 'the unpublish succeeds');
  H.ok(!github._files.has('activities/purim.html'), 'the Hebrew page is gone');
  H.ok(!github._files.has('activities/purim.json'), 'the record file is gone');
  IMAGES.forEach((p) => H.ok(github._files.has(p), p + ' is still there for the draft to republish'));

  console.log('\n[republishing that draft works, because the files are still there]');
  const draft = await H.call(fn.handler, Object.assign({ action: 'load', slug: 'purim' }, auth));
  H.eq(draft.body.source, 'draft', 'it came back as a draft');
  const back = await H.call(fn.handler, Object.assign({
    action: 'publish',
    activity: Object.assign({}, draft.body.activity, { status: 'open' }),
    baseUpdatedAt: draft.body.baseUpdatedAt
  }, auth));
  H.eq(back.status, 200, 'it republishes');
  const html = github._files.get('activities/purim.html');
  H.ok(html.indexOf('/images/activities/purim-hero.png') !== -1, 'and still points at its hero');
  IMAGES.forEach((p) => H.ok(github._files.has(p), p + ' survived the round trip'));

  console.log('\n[deleting takes the photos with it]');
  const del = await H.call(fn.handler, Object.assign(
    { action: 'delete', slug: 'purim', confirmSlug: 'purim' }, auth));
  H.eq(del.status, 200, 'the delete succeeds');
  IMAGES.forEach((p) => H.ok(!github._files.has(p), p + ' is gone'));
  H.ok(!github._files.has('activities/purim.html'), 'and so is the page');
  H.ok(!github._files.has('activities/purim.json'), 'and the record');

  console.log('\n[one activity never takes another one\'s pictures]');
  // A prefix match on `images/activities/<slug>-` would have made "hebrew"
  // delete "hebrew-for-kids-hero.png". The paths come from the record instead.
  await H.call(fn.handler, Object.assign({ action: 'publish', activity: activity('hebrew-for-kids-extra') }, auth));
  const short = await H.call(fn.handler, Object.assign({ action: 'publish', activity: activity('hebrew') }, auth));
  H.eq(short.status, 200, 'a short-slug activity publishes alongside a longer one');
  await H.call(fn.handler, Object.assign({ action: 'delete', slug: 'hebrew', confirmSlug: 'hebrew' }, auth));
  H.ok(!github._files.has('images/activities/hebrew-hero.png'), 'its own hero is deleted');
  H.ok(github._files.has('images/activities/hebrew-for-kids-extra-hero.png'),
       'the other activity keeps its hero, despite sharing the prefix');
  H.ok(github._files.has('activities/hebrew-for-kids.html'), 'and its page is untouched');

  console.log('\n[replacing a picture takes the old file with it]');
  // Swapping a hero for one in a different format changes its filename, so the
  // old file would sit in the repository unreferenced and still served.
  const JPEG = 'data:image/jpeg;base64,' + Buffer.from([
    0xFF,0xD8,0xFF,0xE0,0x00,0x10,0x4A,0x46,0x49,0x46,0x00,0x01,0xFF,0xD9]).toString('base64');
  const first = await H.call(fn.handler, Object.assign({ action: 'publish', activity: activity('swap') }, auth));
  H.ok(github._files.has('images/activities/swap-hero.png'), 'the first hero is a PNG');
  const swapped = Object.assign(activity('swap'), { heroImage: JPEG });
  await H.call(fn.handler, Object.assign(
    { action: 'publish', activity: swapped, baseUpdatedAt: first.body.baseUpdatedAt }, auth));
  H.ok(github._files.has('images/activities/swap-hero.jpg'), 'the replacement is committed');
  H.ok(!github._files.has('images/activities/swap-hero.png'), 'and the file it replaced is gone');
  H.ok(github._files.has('images/activities/swap-teachers-tea-1.png'),
       'a picture that did not change is left alone');

  console.log('\n[deleting an activity that has no images at all still works]');
  const plain = Object.assign(activity('plain'), { heroImage: null, teachers: [], sponsors: [] });
  await H.call(fn.handler, Object.assign({ action: 'publish', activity: plain }, auth));
  const gone = await H.call(fn.handler, Object.assign(
    { action: 'delete', slug: 'plain', confirmSlug: 'plain' }, auth));
  H.eq(gone.status, 200, 'it deletes cleanly');
  H.ok(!github._files.has('activities/plain.html'), 'and the page is gone');

  H.done();
})();
