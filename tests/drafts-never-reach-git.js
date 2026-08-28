// The bug this defends against:
//
// In the first version of the activity template, "draft" was a display status
// on a page that had already been committed. js/activity.js redirected drafts
// to /404, but the HTML file still existed and anyone who requested the URL
// directly got the whole unpublished page. That is not access control, it is a
// redirect you can decline to follow.
//
// The fix is structural: a draft has NO files. It lives only in the Blobs
// draft store. This suite asserts that saving a draft writes nothing to the
// repository, that a draft never appears in the index, listing pages or
// sitemap, and that unpublishing an activity actually deletes its files again.

const H = require('./_helpers');

(async () => {
  const seed = H.seedRepo();
  const github = H.makeGithub(seed.files);
  const blobs = H.makeBlobs();
  const { 'activities-admin': admin } = H.loadWithStubs({
    github, blobs, modules: ['activities-admin']
  });
  const session = await H.installSession(blobs, H.superAdminSession());
  const auth = { token: session.token };

  console.log('\n[a draft is saved to Blobs and nothing else]');
  const filesBefore = new Set(github._files.keys());
  const commitsBefore = github._commits.length;

  const draft = await H.call(admin.handler, Object.assign({
    action: 'saveDraft',
    baseUpdatedAt: null,
    activity: {
      slug: 'secret-workshop',
      status: 'draft',
      title: { he: 'סדנה סודית', en: 'Secret workshop', ru: '' },
      about: { he: 'טיוטה', en: 'A draft', ru: '' }
    }
  }, auth));

  H.eq(draft.status, 200, 'saveDraft succeeds');
  H.eq(github._commits.length, commitsBefore, 'no commit was made');

  const added = [...github._files.keys()].filter((p) => !filesBefore.has(p));
  H.eq(added.length, 0, 'no file was added to the repository');
  H.ok(!github._files.has('activities/secret-workshop.html'), 'no Hebrew page exists');
  H.ok(!github._files.has('en/activities/secret-workshop.html'), 'no English page exists');
  H.ok(!github._files.has('activities/secret-workshop.json'), 'not even the source JSON is committed');

  const draftStore = blobs._stores.get('activity-drafts');
  H.ok(draftStore && draftStore.has('activity-secret-workshop'), 'the draft is in the Blobs draft store');

  console.log('\n[a draft cannot be published while it is still a draft]');
  const attempt = await H.call(admin.handler, Object.assign({
    action: 'publish',
    baseUpdatedAt: JSON.parse(draftStore.get('activity-secret-workshop')).isoUpdated,
    activity: { slug: 'secret-workshop', status: 'draft', title: { he: 'סדנה סודית' }, about: { he: 'x' } }
  }, auth));
  H.eq(attempt.status, 400, 'publishing with status=draft is refused');
  H.ok(!github._files.has('activities/secret-workshop.html'), 'still no page on disk after the refused publish');

  console.log('\n[a draft never appears in any derived file]');
  const index = JSON.parse(github._files.get('activities/activities-index.json'));
  H.ok(!index.some((e) => e.slug === 'secret-workshop'), 'not in activities-index.json');

  // Publish it for real, then check the derived files again.
  const live = await H.call(admin.handler, Object.assign({
    action: 'publish',
    baseUpdatedAt: JSON.parse(draftStore.get('activity-secret-workshop')).isoUpdated,
    activity: {
      slug: 'secret-workshop', status: 'open',
      title: { he: 'סדנה', en: 'Workshop', ru: '' },
      about: { he: 'על הסדנה', en: 'About', ru: '' }
    }
  }, auth));
  H.eq(live.status, 200, 'publishing with a real status succeeds');
  H.ok(github._files.has('activities/secret-workshop.html'), 'now the Hebrew page exists');
  H.ok(github._files.has('activities/secret-workshop.json'), 'now the source JSON is committed');
  H.ok(!draftStore.has('activity-secret-workshop'), 'the draft blob is cleared — git is the source of truth now');

  const sitemap = github._files.get('sitemap.xml');
  H.ok(sitemap.includes('/activities/secret-workshop'), 'a published activity IS in the sitemap');

  console.log('\n[unpublish deletes the files again]');
  const published = JSON.parse(github._files.get('activities/secret-workshop.json'));
  const un = await H.call(admin.handler, Object.assign({
    action: 'unpublish', slug: 'secret-workshop', baseUpdatedAt: published.isoUpdated
  }, auth));
  H.eq(un.status, 200, 'unpublish succeeds');
  H.ok(!github._files.has('activities/secret-workshop.html'), 'the Hebrew page is gone');
  H.ok(!github._files.has('en/activities/secret-workshop.html'), 'the English page is gone');
  H.ok(!github._files.has('activities/secret-workshop.json'), 'the source JSON is gone');
  H.ok(!github._files.get('sitemap.xml').includes('/activities/secret-workshop'),
       'and it is out of the sitemap — no stale URL is left advertised');
  H.ok(draftStore.has('activity-secret-workshop'),
       'the record is back in the draft store, still editable');

  console.log('\n[hard delete removes the record entirely]');
  await H.call(admin.handler, Object.assign({
    action: 'saveDraft', baseUpdatedAt: JSON.parse(draftStore.get('activity-secret-workshop')).isoUpdated,
    activity: { slug: 'secret-workshop', status: 'draft', title: { he: 'ס' }, about: { he: 'x' } }
  }, auth));
  const del = await H.call(admin.handler, Object.assign({
    action: 'delete', slug: 'secret-workshop', confirmSlug: 'secret-workshop'
  }, auth));
  H.eq(del.status, 200, 'delete succeeds');
  H.ok(!draftStore.has('activity-secret-workshop'), 'the draft blob is gone too — unlike unpublish');

  H.done();
})();
