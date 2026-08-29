// What this defends against:
//
// netlify.toml serves /images/* with `max-age=31536000, immutable`. `immutable`
// tells a browser the bytes at this URL will never change, so it does not
// revalidate — not after a deploy, not on a reload, for a year.
//
// That was true when /images/ held only hand-placed files. The admin made it a
// lie. A teacher's photo is named <slug>-teachers-<itemId>.<ext>, the item id is
// stable, so re-uploading in the same format wrote different bytes to the SAME
// URL. Everyone who had already seen the old picture kept it and could not be
// sent the new one. One sponsor logo on hebrew4kids served three different
// files — 1.8MB, then 137KB, then 109KB — under a single URL.
//
// The filename now carries a hash of the picture, which makes the header honest
// rather than weakening it. Two properties have to hold together:
//
//   1. different bytes => different URL, or the cache is stale again;
//   2. the same bytes => the SAME URL, or every publish busts every cache and
//      re-uploads files that did not change;
//
// and the third is the one that makes it safe to do repeatedly: replacing a
// picture DELETES the file it replaced. Without that, each replacement leaves
// another orphan in the repository, served forever and referenced by nothing.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');

// Opaque bytes as far as the server is concerned — it hashes what it is given.
const png = (seed) => 'data:image/png;base64,' + Buffer.from(
  [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A].concat(
    Array.from({ length: 24 }, (_, i) => (seed * 31 + i * 7) % 251))
).toString('base64');

const activity = (photo, logo) => ({
  slug: 'purim', status: 'open',
  title: { he: 'סדנה', en: 'Workshop', ru: '' },
  about: { he: 'תיאור', en: 'About', ru: '' },
  teachers: [{ id: 'tea-1', name: { he: 'דורית', en: 'Dorit', ru: '' }, photo }],
  sponsors: [{ id: 'spo-1', name: { he: 'קרן', en: 'Fund', ru: '' }, logo }],
  faq: [], facts: {}
});

(async () => {
  const blobs = H.makeBlobs();
  const github = H.makeGithub(H.seedRepo().files);
  const { 'activities-admin': fn } = H.loadWithStubs({ github, blobs, modules: ['activities-admin'] });
  const session = H.superAdminSession();
  await H.installSession(blobs, session);
  const auth = { token: session.token };

  const photoOf = () => JSON.parse(github._files.get('activities/purim.json')).teachers[0].photo;
  const logoOf = () => JSON.parse(github._files.get('activities/purim.json')).sponsors[0].logo;
  // Every activity image file in the repo for this slug, whoever put it there.
  const filesForSlug = () => Array.from(github._files.keys())
    .filter((p) => p.indexOf('images/activities/purim-') === 0).sort();

  console.log('[the name carries a hash of the picture]');
  let res = await H.call(fn.handler, Object.assign({ action: 'publish', activity: activity(png(1), png(9)) }, auth));
  H.eq(res.status, 200, 'the first publish succeeds');
  const first = photoOf();
  const logoFirst = logoOf();
  H.ok(/^\/images\/activities\/purim-teachers-tea-1-[0-9a-f]{8}\.png$/.test(first),
       'the teacher photo is <slug>-teachers-<id>-<hash8>.png, got ' + first);
  H.ok(github._files.has(first.slice(1)), 'and the file is committed under that name');
  let base = res.body.baseUpdatedAt;

  console.log('\n[the same picture keeps the same URL, so nothing churns]');
  // Re-publishing an unchanged record must not invent a new filename: that
  // would bust every visitor's cache and re-upload a file that did not change.
  res = await H.call(fn.handler, Object.assign(
    { action: 'publish', activity: activity(png(1), png(9)), baseUpdatedAt: base }, auth));
  H.eq(res.status, 200, 'it republishes');
  H.eq(photoOf(), first, 'the URL is unchanged');
  H.eq(filesForSlug().length, 2, 'and no extra file appeared');
  base = res.body.baseUpdatedAt;

  console.log('\n[a different picture gets a different URL]');
  res = await H.call(fn.handler, Object.assign(
    { action: 'publish', activity: activity(png(2), png(9)), baseUpdatedAt: base }, auth));
  H.eq(res.status, 200, 'the replacement publishes');
  const second = photoOf();
  H.ok(second !== first, 'the URL changed with the bytes');
  H.ok(github._files.has(second.slice(1)), 'the new file is committed');
  // NOT deleted yet — see tests/a-replaced-image-outlives-its-deploy.js. It is
  // retired now and removed on the next publish, so a reader still holding the
  // previous HTML cannot meet a 404.
  H.ok(github._files.has(first.slice(1)), 'the file it replaced survives this publish');
  const retired = JSON.parse(github._files.get('activities/purim.json')).retiredImages || [];
  H.eq(JSON.stringify(retired), JSON.stringify([first.slice(1)]), 'and the record says it is retired');
  H.eq(logoOf(), logoFirst, 'a sibling image that did not change keeps its URL');
  H.ok(github._files.has(logoFirst.slice(1)), 'and its file is left alone');
  base = res.body.baseUpdatedAt;

  console.log('\n[replacing it many times leaves exactly one file behind]');
  // The question that matters for a real admin: does this accumulate? Each pass
  // is a different picture, so each gets a new name and the previous one must go.
  for (let i = 3; i <= 8; i++) {
    const r = await H.call(fn.handler, Object.assign(
      { action: 'publish', activity: activity(png(i), png(9)), baseUpdatedAt: base }, auth));
    H.eq(r.status, 200, 'replacement ' + i + ' publishes');
    base = r.body.baseUpdatedAt;
  }
  const left = filesForSlug();
  // Three, not eight: the current photo, the sponsor logo, and exactly ONE
  // retired file awaiting the next publish. The deferral costs one file, and
  // that cost does not grow however many times a picture is replaced.
  H.eq(left.length, 3, 'after eight uploads the repo holds three images, not eight: ' + left.join(', '));
  H.ok(left.indexOf(photoOf().slice(1)) !== -1, 'the one the record points at is there');
  H.ok(left.indexOf(logoOf().slice(1)) !== -1, 'alongside the sponsor logo it never changed');
  H.eq((JSON.parse(github._files.get('activities/purim.json')).retiredImages || []).length, 1,
       'and exactly one picture is waiting to be removed');

  // One more publish with no image change collects it.
  const settle = await H.call(fn.handler, Object.assign(
    { action: 'publish', activity: activity(png(8), png(9)), baseUpdatedAt: base }, auth));
  H.eq(settle.status, 200, 'a quiet publish succeeds');
  H.eq(filesForSlug().length, 2, 'and sweeps the retired file up, leaving two');
  H.ok(!JSON.parse(github._files.get('activities/purim.json')).retiredImages,
       'with nothing left retired');

  console.log('\n[and the header this exists to justify is still set]');
  const toml = fs.readFileSync(path.join(__dirname, '..', 'netlify.toml'), 'utf8');
  H.ok(/for = "\/images\/\*"/.test(toml), '/images/* still has its own header block');
  H.ok(/immutable/.test(toml),
       'still served immutable — the hash is what makes that true, so it is kept rather than weakened');

  H.done();
})();
