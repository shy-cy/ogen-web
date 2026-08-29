// The bug this defends against:
//
// "No images are rendering." Every picture an admin had just chosen showed as a
// broken image in the preview — hero, teacher photos, sponsor logos alike.
//
// The cause was structural, not a typo. extractImages() takes the base64 the
// browser uploaded and rewrites it in the record to the path the file WILL have
// once committed, so that the rendered HTML is the real thing. Preview goes
// through the same generate() and gets the same rewrite — but preview does not
// commit, so /images/activities/<slug>-hero.png does not exist yet and the
// iframe asks the live site for a file that is not there. Publish worked all
// along, which is why the published page looked fine and the preview did not.
//
// The fix must not fork the render: a preview that renders through different
// code is a preview that can lie, and tests/preview-matches-publish.js exists
// to stop exactly that. So the HTML is left alone and the data URLs come back
// BESIDE it, to be put back in the iframe's DOM after it loads.
//
// (The hero image has since been removed from activities altogether, so what is
// left to cover is the teacher and sponsor photos. The mechanism is the same.)

const H = require('./_helpers');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function activity() {
  return {
    slug: 'purim-workshop',
    status: 'open',
    title: { he: 'סדנת פורים', en: 'Purim workshop', ru: '' },
    about: { he: 'תיאור', en: 'Description', ru: '' },
    teachers: [{ id: 'tea-1', name: { he: 'דורית', en: 'Dorit', ru: '' }, photo: PNG }],
    sponsors: [{ id: 'spo-1', name: { he: 'קרן', en: 'Fund', ru: '' }, logo: PNG }],
    included: [], faq: [], facts: {}
  };
}

(async () => {
  const blobs = H.makeBlobs();
  const github = H.makeGithub(H.seedRepo().files);
  const { 'activities-admin': fn } = H.loadWithStubs({
    github, blobs, modules: ['activities-admin']
  });
  const session = H.superAdminSession();
  await H.installSession(blobs, session);
  const auth = { token: session.token };

  console.log('\n[preview hands back the data URL for every image it rewrote]');
  const prev = await H.call(fn.handler,
    Object.assign({ action: 'preview', activity: activity() }, auth));
  H.eq(prev.status, 200, 'the preview succeeds');
  const map = prev.body.imagePreview || {};
  const keys = Object.keys(map).sort();
  H.eq(keys.length, 2, 'both uploads are in the map');
  H.ok(keys.indexOf('/images/activities/purim-workshop-teachers-tea-1.png') !== -1, 'the teacher photo is there');
  H.ok(keys.indexOf('/images/activities/purim-workshop-sponsors-spo-1.png') !== -1, 'the sponsor logo is there');
  keys.forEach((k) => H.eq(map[k], PNG, 'the map returns the original data URL for ' + k));

  console.log('\n[every image the page references can be resolved]');
  // This is the assertion that would have failed before the fix: a src that
  // neither exists in the repo nor has a data URL to stand in. Since the hero
  // was removed, every activity image now reaches the page through the credits
  // block below rather than as markup.
  const html = prev.body.html.he;
  H.ok(html.indexOf('data:image') === -1, 'nothing is inlined into the page itself');
  // Teacher and sponsor photos are drawn by js/activity.js from this block.
  const credits = JSON.parse(/id="activity-credits">([\s\S]*?)<\/script>/.exec(html)[1]);
  const creditSrcs = credits.teachers.map((t) => t.photo).concat(credits.sponsors.map((s) => s.logo));
  H.eq(creditSrcs.length, 2, 'both credit images are declared');
  creditSrcs.forEach((src) => H.ok(!!map[src], 'the credit image ' + src + ' can be shown too'));

  console.log('\n[the HTML itself is untouched — no base64 leaks into the page]');
  H.ok(credits.teachers[0].photo === '/images/activities/purim-workshop-teachers-tea-1.png',
       'the credits block carries the real path, not the data URL');

  console.log('\n[publish does not carry the data URLs back]');
  // They are megabytes, and by then the files exist. Sending them would be waste.
  const pub = await H.call(fn.handler,
    Object.assign({ action: 'publish', activity: activity() }, auth));
  H.eq(pub.status, 200, 'the publish succeeds');
  H.ok(pub.body.imagePreview === undefined, 'no image map comes back from a publish');
  H.ok(github._files.has('images/activities/purim-workshop-teachers-tea-1.png'), 'the teacher photo is committed');
  H.ok(github._files.has('images/activities/purim-workshop-sponsors-spo-1.png'), 'the sponsor logo is committed');

  console.log('\n[a record with no new uploads has an empty map, not a missing one]');
  const again = await H.call(fn.handler, Object.assign({
    action: 'preview',
    activity: Object.assign(activity(), { teachers: [], sponsors: [] })
  }, auth));
  H.eq(JSON.stringify(again.body.imagePreview), '{}', 'an already-committed image needs no substitution');

  H.done();
})();
