// What this defends against:
//
// Activities gained a square picture for listing and homepage cards. The whole
// value of a fixed ratio is that a grid of tiles is a grid: one 4:3 tile beside
// a 16:9 one is exactly what it exists to prevent. So "square" cannot be a hint
// in the admin that an admin is trusted to honour — it has to be true of the
// bytes, whatever was uploaded.
//
// The trap is in js/image-optimize.js. Every other slot may hand back the
// ORIGINAL file when re-encoding produced something larger, which is right: a
// 52KB partner logo becomes 59KB, and returning the bigger one while reporting a
// saving would be worse than doing nothing. But the original of a 1000×600
// upload is 1000×600, and handing that back silently breaks the one promise the
// square profile makes. The size check must not be allowed to undo the crop.
//
// Also pinned: the record's own plumbing. A card image is one file per activity
// and one picture for every language, so it is structure a restricted role
// cannot touch, it must be listed among the files an activity owns (or deleting
// the activity leaves the photograph on a public URL), and a cleared field has
// to travel as null rather than vanishing, or "remove this image" and "this role
// did not send one" become the same request.
//
// The canvas work itself cannot run here — Node has no canvas and this repo
// installs nothing — so the geometry is tested directly and the encode path is
// tested by reading the decision it makes.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');
const IO = require('../js/image-optimize.js');

const R = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(R, 'js/image-optimize.js'), 'utf8');
const adminFn = fs.readFileSync(path.join(R, 'netlify/functions/activities-admin.js'), 'utf8');
const adminJs = fs.readFileSync(path.join(R, 'js/activities-admin.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(R, 'admin/activities.html'), 'utf8');

console.log('[the profile exists and asks for a square]');
H.ok(!!IO.PROFILES.card, 'there is a card profile');
H.eq(IO.PROFILES.card.square, true, 'it is marked square');
H.ok(IO.PROFILES.card.maxEdge > 0, 'it has a maximum edge');
H.ok(!IO.PROFILES.hero.square && !IO.PROFILES.credit.square,
  'and the other slots are untouched by it');

console.log('\n[the crop is a centred square, whatever came in]');
// Landscape: take the middle, lose the sides equally.
let c = IO.squareCrop(1000, 600, 800);
H.eq(c.width, c.height, 'landscape comes out square');
H.eq(c.sSide, 600, 'the square is the SHORT edge, so nothing is invented');
H.eq(c.sx, 200, 'centred horizontally');
H.eq(c.sy, 0, 'nothing cropped vertically');
H.eq(c.cropped, true, 'reported as cropped');

// Portrait: the same, the other way round.
c = IO.squareCrop(600, 1000, 800);
H.eq(c.sSide, 600, 'portrait uses the short edge too');
H.eq(c.sx, 0, 'nothing cropped horizontally');
H.eq(c.sy, 200, 'centred vertically');

// Already square and already small: left at its own size, never scaled up.
c = IO.squareCrop(300, 300, 800);
H.eq(c.width, 300, 'a small square is not scaled up');
H.eq(c.cropped, false, 'and is not reported as cropped');
H.eq(c.scaled, false, 'nor as resized');

// Big square: scaled down to the cap.
c = IO.squareCrop(2000, 2000, 800);
H.eq(c.width, 800, 'a large square is capped');
H.eq(c.scaled, true, 'and reported as resized');
H.eq(c.cropped, false, 'but nothing was cut away');

// Odd numbers must not produce a half pixel.
c = IO.squareCrop(1001, 605, 800);
H.ok(Number.isInteger(c.sx) && Number.isInteger(c.sy), 'offsets are whole pixels');
H.ok(Number.isInteger(c.width) && Number.isInteger(c.height), 'dimensions are whole pixels');
H.eq(c.width, c.height, 'and it is still square');

console.log('\n[the size check cannot undo the crop]');
// The specific line. If the bail-out ever stops excluding a cropped square, a
// non-square original is handed back and the ratio silently stops holding.
H.ok(/mustKeepCanvas\s*=\s*profile\.square\s*&&\s*size\.cropped/.test(src),
  'a cropped square refuses the "return the original" path');
H.ok(/if \(blob\.size >= file\.size && !muchTooBig && !mustKeepCanvas\)/.test(src),
  'and the size check honours it');
// A source that was already square may still bail out, because the original is
// square too, so nothing is lost by keeping the smaller file.
H.ok(src.indexOf('size.cropped') !== -1, 'the decision is made on whether anything was cut');

console.log('\n[the record plumbing]');
H.ok(/activity\.cardImage[\s\S]{0,120}startsWith\('data:'\)/.test(adminFn),
  'an uploaded data URL is turned into a committed file');
H.ok(/take\(val, `\$\{key\}-\$\{item\.id\}`\)/.test(adminFn),
  'and list images still work the way they did');
H.ok(/take\(activity\.cardImage\)/.test(adminFn),
  'the card image counts among the files an activity owns');
// Deleting an activity must take its pictures with it; imagePathsOf is what
// that walks. A card image missing from it stays on a public URL for good.
const pathsOf = adminFn.slice(adminFn.indexOf('function imagePathsOf'));
H.ok(pathsOf.indexOf('cardImage') !== -1 &&
     pathsOf.indexOf('cardImage') < pathsOf.indexOf('teachers'),
  'imagePathsOf lists it alongside the teacher and sponsor photos');

console.log('\n[one picture for every language is structure, not words]');
// A role that may only edit Russian can translate a location; it must not be
// able to change the image all three languages show.
const merge = adminFn.slice(adminFn.indexOf('  if (full) {'));
H.ok(/if \(incoming\.cardImage !== undefined\) out\.cardImage/.test(merge),
  'a full-access session may set it');
H.ok(/out\.cardImage = \(base && base\.cardImage\) \|\| null/.test(merge),
  'a restricted session keeps whatever was there');
H.ok(merge.indexOf('incoming.cardImage !== undefined') < merge.indexOf('base.cardImage'),
  'and the two branches are the right way round');

console.log('\n[cleared has to be distinguishable from absent]');
H.ok(/S\.cardImage !== undefined \? S\.cardImage : \(S\.record\.cardImage \|\| null\)/.test(adminJs),
  'the form sends null for a removed image and the stored path otherwise');
H.ok(/S\.cardImage = undefined;/.test(adminJs),
  'loading another activity forgets a pending upload rather than carrying it across');
H.ok(/optimize\(file, slot\)/.test(adminJs) === false || /readImage\(input, 'card'/.test(adminJs),
  'the upload goes through the shared optimiser at the card slot');

console.log('\n[the admin shows it]');
H.ok(adminHtml.indexOf('id="card-image"') !== -1, 'there is a place for it in the form');
H.ok(/renderCardImage/.test(adminJs), 'and something that draws it');
H.ok(/aspect-ratio:1\/1/.test(fs.readFileSync(path.join(R, 'admin/admin.css'), 'utf8')),
  'the preview frame is a real square, so the admin sees the actual crop');

console.log('\n[the activity page still has no image of its own]');
const tpl = fs.readFileSync(path.join(R, 'netlify/functions/_activity-template.js'), 'utf8');
H.ok(tpl.indexOf('cardImage') === -1,
  'the activity page does not render it: this field is for listing cards');
H.ok(tpl.indexOf("image: '/images/og-image.jpg'") !== -1,
  'and shared links still use the site share image');

H.done();
