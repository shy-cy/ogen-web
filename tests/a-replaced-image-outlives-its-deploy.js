// The bug this defends against:
//
// A teacher's photo showed a broken image icon on the live site, permanently,
// in one person's browser and nobody else's. A hard reload fixed it.
//
// Two things combined. netlify.toml served /images/* with `max-age=31536000,
// immutable`, and Netlify applies path headers to error responses too — so a
// 404 for an image was cached for a YEAR and never revalidated. And publishing
// deleted a replaced picture in the same commit that stopped referencing it.
//
// A deploy does not reach every edge at the same instant, and a reader can be
// holding the previous HTML. For about a minute after a replacement, a page
// still asking for the old file met a tree that no longer had it. That 404 stuck
// in the browser and the picture was broken there for good — after the file
// existed again, after any number of ordinary reloads, because the browser had
// stopped asking.
//
// So a replaced picture is now RETIRED, not deleted, and removed one publish
// later. By then the deploy that referenced it is two deploys old. This suite
// pins that, and the two things that make it safe to do: the retired list is
// recomputed rather than appended to, so it cannot grow; and deleting an
// activity still takes its retired files with it, so nothing leaks.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');

const png = (seed) => 'data:image/png;base64,' + Buffer.from(
  [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A].concat(
    Array.from({ length: 24 }, (_, i) => (seed * 37 + i * 11) % 251))
).toString('base64');

const activity = (photo) => ({
  slug: 'purim', status: 'open',
  title: { he: 'סדנה', en: 'Workshop', ru: '' },
  about: { he: 'תיאור', en: 'About', ru: '' },
  teachers: [{ id: 'tea-1', name: { he: 'דורית', en: 'Dorit', ru: '' }, photo }],
  sponsors: [], faq: [], facts: {}
});

(async () => {
  const blobs = H.makeBlobs();
  const github = H.makeGithub(H.seedRepo().files);
  const { 'activities-admin': fn } = H.loadWithStubs({ github, blobs, modules: ['activities-admin'] });
  const session = H.superAdminSession();
  await H.installSession(blobs, session);
  const auth = { token: session.token };

  const rec = () => JSON.parse(github._files.get('activities/purim.json'));
  const photoPath = () => rec().teachers[0].photo.slice(1);
  const retired = () => rec().retiredImages || [];
  const files = () => Array.from(github._files.keys()).filter((p) => p.indexOf('images/activities/purim-') === 0).sort();
  const publish = async (photo, base) => {
    const r = await H.call(fn.handler, Object.assign(
      { action: 'publish', activity: activity(photo), baseUpdatedAt: base }, auth));
    H.eq(r.status, 200, 'publish succeeds');
    return r.body.baseUpdatedAt;
  };

  console.log('[a replaced picture is retired, not deleted]');
  let base = await publish(png(1));
  const one = photoPath();
  base = await publish(png(2), base);
  const two = photoPath();
  H.ok(two !== one, 'the replacement has a new URL');
  H.ok(github._files.has(two), 'the new file is committed');
  H.ok(github._files.has(one), 'AND the old file is still served — this is the whole point');
  H.eq(JSON.stringify(retired()), JSON.stringify([one]), 'the record lists it as retired');

  console.log('\n[the next publish removes it]');
  base = await publish(png(3), base);
  const three = photoPath();
  H.ok(!github._files.has(one), 'the picture retired two publishes ago is gone');
  H.ok(github._files.has(two), 'the one retired by THIS publish is still there');
  H.eq(JSON.stringify(retired()), JSON.stringify([two]), 'and it is the one now listed');
  H.ok(github._files.has(three), 'alongside the current picture');

  console.log('\n[the list is recomputed, so it cannot grow]');
  // Appending instead of replacing would turn this into an ever-growing list
  // that eventually deletes something still in use.
  for (let i = 4; i <= 9; i++) base = await publish(png(i), base);
  H.eq(retired().length, 1, 'after nine replacements exactly one picture is retired');
  H.eq(files().length, 2, 'and the repo holds two: the current one and the retired one');

  console.log('\n[a picture that comes back is un-retired, not deleted]');
  // Restoring the previous image gives the same bytes, so the same hash and the
  // same filename. It is referenced again, so it must not be swept up.
  const current = photoPath();
  base = await publish(png(9), base);          // same bytes as the last publish
  H.eq(photoPath(), current, 'the same bytes keep the same URL');
  H.ok(github._files.has(current), 'and the file is still there');
  H.ok(retired().indexOf(current) === -1, 'a referenced picture is never on the retired list');

  console.log('\n[deleting the activity takes the retired files too]');
  base = await publish(png(20), base);          // retire the current one
  const pending = retired();
  H.eq(pending.length, 1, 'there is a retired picture waiting');
  H.ok(github._files.has(pending[0]), 'and it is in the repo');
  const del = await H.call(fn.handler, Object.assign(
    { action: 'delete', slug: 'purim', confirmSlug: 'purim' }, auth));
  H.eq(del.status, 200, 'the delete succeeds');
  H.ok(!github._files.has(pending[0]), 'the retired picture is deleted with the activity, not left behind');
  H.eq(files().length, 0, 'no image of this activity survives it');

  console.log('\n[and the header that made a 404 permanent is gone]');
  const toml = fs.readFileSync(path.join(__dirname, '..', 'netlify.toml'), 'utf8');
  const block = (pattern) => {
    const at = toml.indexOf('for = "' + pattern + '"');
    return at === -1 ? null : toml.slice(at, at + 300);
  };
  const uploads = block('/images/activities/*');
  H.ok(!!uploads, '/images/activities/* has its own header rule');
  H.ok(!/immutable/.test(uploads.split('[[headers]]')[0]),
       'uploads are NOT immutable — a 404 there must be able to expire');
  const maxAge = /max-age=(\d+)/.exec(uploads.split('[[headers]]')[0]);
  H.ok(!!maxAge, 'they still carry a max-age, so this is a shorter cache and not no cache at all');
  H.ok(Number(maxAge[1]) <= 3600,
       'and it is short enough to self-heal, got ' + maxAge[1] + 's');

  H.done();
})();
