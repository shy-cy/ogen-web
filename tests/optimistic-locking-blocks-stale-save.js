// The bug this defends against:
//
// On the project this architecture came from, two admins editing the same
// record silently overwrote each other. The records carried isoUpdated and
// nothing checked it, so the second save just won and the first person's work
// vanished with no error, no warning and no conflict. It happened for real.
//
// Here every write sends back the isoUpdated it loaded. The server re-reads the
// current record and refuses if it has moved. This suite drives two admins
// through an actual conflicting edit and asserts the second one is BLOCKED —
// and, importantly, that the first admin's text is still in the repository
// afterwards.

const H = require('./_helpers');

(async () => {
  const seed = H.seedRepo();
  const github = H.makeGithub(seed.files);
  const blobs = H.makeBlobs();
  const { 'activities-admin': admin } = H.loadWithStubs({
    github, blobs, modules: ['activities-admin']
  });

  const michal = await H.installSession(blobs, H.superAdminSession());
  const dana = await H.installSession(blobs, H.superAdminSession({
    token: 'dana-token', email: 'dana@ogen.cy', name: 'Dana'
  }));
  const asMichal = { token: michal.token };
  const asDana = { token: dana.token };

  console.log('\n[both admins open the same activity]');
  const michalLoad = await H.call(admin.handler,
    Object.assign({ action: 'load', slug: 'hebrew-for-kids' }, asMichal));
  const danaLoad = await H.call(admin.handler,
    Object.assign({ action: 'load', slug: 'hebrew-for-kids' }, asDana));

  H.eq(michalLoad.status, 200, 'Michal loads the activity');
  H.eq(danaLoad.status, 200, 'Dana loads the same activity');
  H.eq(michalLoad.body.baseUpdatedAt, danaLoad.body.baseUpdatedAt,
       'both hold the same baseUpdatedAt');

  const staleBase = danaLoad.body.baseUpdatedAt;

  console.log('\n[Michal saves first, and wins]');
  const michalEdit = Object.assign({}, michalLoad.body.activity);
  michalEdit.about = { he: 'הטקסט של מיכל', en: "Michal's text", ru: '' };
  const first = await H.call(admin.handler, Object.assign({
    action: 'publish', baseUpdatedAt: michalLoad.body.baseUpdatedAt, activity: michalEdit
  }, asMichal));
  H.eq(first.status, 200, "Michal's publish succeeds");
  H.ok(github._files.get('activities/hebrew-for-kids.html').includes('הטקסט של מיכל'),
       "Michal's text is live");

  console.log('\n[Dana saves with the timestamp she loaded — and is blocked]');
  const danaEdit = Object.assign({}, danaLoad.body.activity);
  danaEdit.about = { he: 'הטקסט של דנה', en: "Dana's text", ru: '' };
  const commitsBefore = github._commits.length;

  const second = await H.call(admin.handler, Object.assign({
    action: 'publish', baseUpdatedAt: staleBase, activity: danaEdit
  }, asDana));

  H.eq(second.status, 409, 'the stale save is rejected with 409 Conflict');
  H.eq(second.body.error, 'conflict', 'the response names the failure');
  H.eq(github._commits.length, commitsBefore, 'nothing was committed');
  H.ok(github._files.get('activities/hebrew-for-kids.html').includes('הטקסט של מיכל'),
       "Michal's text is STILL live — this is the data loss that used to happen");
  H.ok(!github._files.get('activities/hebrew-for-kids.html').includes('הטקסט של דנה'),
       "Dana's text did not overwrite it");

  console.log('\n[the conflict tells Dana what she needs to know]');
  const c = second.body.conflict;
  H.eq(c.slug, 'hebrew-for-kids', 'which activity');
  H.eq(c.yourBase, staleBase, 'the timestamp she was working from');
  H.ok(c.currentUpdatedAt && c.currentUpdatedAt !== staleBase, 'the timestamp it has now');
  H.eq(c.lastEditedBy, 'Michal', 'who moved it');

  console.log('\n[she can reload and then save on top]');
  const reload = await H.call(admin.handler,
    Object.assign({ action: 'load', slug: 'hebrew-for-kids' }, asDana));
  const retry = await H.call(admin.handler, Object.assign({
    action: 'publish', baseUpdatedAt: reload.body.baseUpdatedAt,
    activity: Object.assign({}, reload.body.activity, {
      about: { he: 'הטקסט של דנה', en: "Dana's text", ru: '' }
    })
  }, asDana));
  H.eq(retry.status, 200, 'after reloading, her save goes through');
  H.ok(github._files.get('activities/hebrew-for-kids.html').includes('הטקסט של דנה'),
       'and her text is now live');

  console.log('\n[an explicit overwrite is possible, but never silent]');
  const thirdBase = 'definitely-stale';
  const forced = await H.call(admin.handler, Object.assign({
    action: 'publish', baseUpdatedAt: thirdBase, overwrite: true,
    activity: Object.assign({}, reload.body.activity, {
      about: { he: 'דריסה מכוונת', en: 'Deliberate overwrite', ru: '' }
    })
  }, asMichal));
  H.eq(forced.status, 200, 'overwrite:true is honoured — a second, deliberate click');
  H.ok(github._files.get('activities/hebrew-for-kids.html').includes('Deliberate overwrite') ||
       github._files.get('en/activities/hebrew-for-kids.html').includes('Deliberate overwrite'),
       'the forced text landed');

  console.log('\n[a new slug cannot be created twice]');
  const a = await H.call(admin.handler, Object.assign({
    action: 'publish', baseUpdatedAt: null,
    activity: { slug: 'race', status: 'open', title: { he: 'א' }, about: { he: 'x' } }
  }, asMichal));
  H.eq(a.status, 200, 'the first create succeeds');
  const b = await H.call(admin.handler, Object.assign({
    action: 'publish', baseUpdatedAt: null,
    activity: { slug: 'race', status: 'open', title: { he: 'ב' }, about: { he: 'y' } }
  }, asDana));
  H.eq(b.status, 409, 'a second create of the same slug conflicts instead of clobbering');

  console.log('\n[drafts are locked the same way]');
  const d1 = await H.call(admin.handler, Object.assign({
    action: 'saveDraft', baseUpdatedAt: null,
    activity: { slug: 'draft-lock', status: 'draft', title: { he: 'ג' }, about: { he: 'z' } }
  }, asMichal));
  H.eq(d1.status, 200, 'the draft saves');
  const d2 = await H.call(admin.handler, Object.assign({
    action: 'saveDraft', baseUpdatedAt: null,
    activity: { slug: 'draft-lock', status: 'draft', title: { he: 'ד' }, about: { he: 'w' } }
  }, asDana));
  H.eq(d2.status, 409, 'a stale draft save is rejected too');

  H.done();
})();
