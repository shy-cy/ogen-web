// The bug this defends against:
//
// Upload a picture, press Publish, and it turned into a broken image icon for
// about a minute — then, thanks to the cache, for five.
//
// Publishing commits the file and rewrites the record to the path it will have.
// Netlify takes about a minute to deploy. The admin, on a successful publish,
// reloads the record; fillForm() clears the pending upload, and the panel
// redraws from the record — so it swapped the bytes it was already showing for
// a URL that was not being served yet. The 404 that followed was then cached,
// and the picture stayed broken well after the deploy landed.
//
// The bytes are in hand, so they are kept until the real URL answers. Three
// things have to hold, and each was a way to get this wrong:
//
//   1. the pending uploads are captured BEFORE the reload that forgets them;
//   2. they are remembered BEFORE load(), because fillForm redraws inside it;
//   3. the swap to the real URL patches the <img> rather than redrawing the
//      form, which would throw away anything typed since the publish.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'activities-admin.js'), 'utf8');
const body = (name) => {
  const start = src.indexOf('function ' + name + '(');
  H.ok(start !== -1, name + ' exists');
  const next = src.indexOf('\n  function ', start + 1);
  return src.slice(start, next === -1 ? src.length : next);
};

console.log('[the uploaded bytes are captured before anything can forget them]');
const pub = body('doPublish');
const capturedAt = pub.indexOf('var pending = {');
const sentAt = pub.indexOf("send({ action: 'publish'");
H.ok(capturedAt !== -1, 'doPublish captures what was uploaded');
H.ok(capturedAt < sentAt, 'and does it BEFORE the request, not from state the reload has cleared');
H.ok(/items: Object\.assign\(\{\}, S\.images\)/.test(pub),
     'including the per-item uploads, copied rather than referenced');

console.log('\n[and remembered before the reload redraws the form]');
const rememberAt = pub.indexOf('rememberFreshBytes(');
const loadAt = pub.indexOf('load(S.slug)');
H.ok(rememberAt !== -1, 'the publish remembers them against the committed paths');
H.ok(rememberAt < loadAt, 'BEFORE load(), because fillForm redraws the pictures inside it');
H.ok(/rememberFreshBytes\(res\.data\.activity, pending\)/.test(pub),
     'pairing what we uploaded with the paths the server actually saved');

console.log('\n[every slot is covered, from the schema rather than by name]');
const remember = body('rememberFreshBytes');
H.ok(/keep\(saved\.cardImage/.test(remember), 'the card image');
H.ok(/keep\(saved\.shareImage/.test(remember), 'the share image');
H.ok(/S\.schema\.lists \|\| \[\]/.test(remember), 'and teachers and sponsors, read from the schema');
H.ok(/spec\.image/.test(remember), 'by whichever field that list calls its picture');
H.ok(/indexOf\('data:'\) === 0/.test(remember), 'only real uploaded bytes are kept, never a path');

console.log('\n[the swap patches the element, it does not redraw]');
const adopt = body('adoptDeployed');
H.ok(/querySelectorAll\('\[data-fresh-path=/.test(adopt), 'it finds the images by the path they are standing in for');
H.ok(/img\.src = path/.test(adopt), 'and points them at the real file');
H.ok(!/renderFields\(|renderLists\(|fillForm\(/.test(adopt),
     'and redraws nothing — a redraw here would discard anything typed since the publish');
H.ok(/delete S\.freshBytes\[path\]/.test(adopt), 'and stops standing in for it');

console.log('\n[the check is bounded and does not trust a stale 404]');
const confirm = body('confirmFreshBytes');
H.ok(/cache: 'reload'/.test(confirm),
     "cache:'reload', or the 404 collected a moment ago would answer for the file");
H.ok(/Date\.now\(\) - started < \d+/.test(confirm), 'it gives up rather than polling for ever');
H.ok(/if \(S\.freshTimer \|\|/.test(confirm), 'and only one poller runs at a time');

console.log('\n[the pictures prefer what we hold, in the right order]');
const slot = body('imageSlotRow');
H.ok(/var current = cfg\.pending \|\| fresh \|\| stored;/.test(slot),
     'a pending upload first, then bytes held for the stored path, then the path');
H.ok(/img\.setAttribute\('data-fresh-path', stored\)/.test(slot),
     'and it marks which path it is standing in for');
H.ok(/S\.images\[item\.id\] \|\| freshSrc \|\| storedSrc/.test(src),
     'teacher and sponsor thumbnails follow the same order');

console.log('\n[held bytes belong to one activity]');
const load = body('load');
H.ok(/if \(slug !== S\.slug\) S\.freshBytes = \{\};/.test(load),
     'opening a different activity drops them — but the reload after a publish, which asks for the same slug, keeps them');

console.log('\n[the record still holds the path, not the bytes]');
// The whole point is that this is display only. A data URL reaching the record
// would be committed into activities/<slug>.json as megabytes of base64.
const readForm = body('readForm');
H.ok(/rec\.cardImage = S\.cardImage !== undefined \? S\.cardImage : \(S\.record\.cardImage \|\| null\)/.test(readForm),
     'readForm still sends the pending upload or the stored path');
H.ok(!/freshBytes/.test(readForm), 'and never the bytes being held for display');

H.done();
