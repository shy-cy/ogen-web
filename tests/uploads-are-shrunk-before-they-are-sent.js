// What this defends against:
//
// An admin uploaded a 1.77MB sponsor logo and an 865KB hero, because nothing
// stopped them. Three things broke at once: the request carried ~3.5MB of
// base64 towards Netlify's 6MB limit, the function re-uploaded every byte of it
// to GitHub and ran past its 10-second ceiling, and the finished page made
// visitors download 2.6MB of pictures. The publish looked like a dead button.
//
// js/image-optimize.js resizes and re-encodes in the browser, before the bytes
// are ever sent. The decisions it makes are what this suite pins — the ones
// that are wrong in a way nobody notices until a specific file hits them:
//
//   - never scale an image UP (a 148×225 avatar must stay 148×225)
//   - never hand back something bigger than what was given (measured: a 52KB
//     partner logo re-encodes to 59KB, a 30KB GIF to 32KB)
//   - never flatten an animated GIF into a still
//   - never rasterise an SVG
//   - never write transparency into a JPEG
//
// The canvas work itself cannot run here — Node has no canvas and this repo
// installs nothing. It was measured in a real browser instead, and those
// numbers are in the comments above each expectation.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');
const IO = require('../js/image-optimize.js');

console.log('\n[sizing down, never up]');
// The hero is drawn at most ~730 CSS px wide in the activity layout, so 1600
// still covers a 2× screen; credit photos sit in a 40px circle.
H.eq(IO.PROFILES.hero.maxEdge, 1600, 'the hero target is 1600px on the long edge');
H.eq(IO.PROFILES.credit.maxEdge, 600, 'credit photos target 600px');

const big = IO.targetSize(4033, 3653, 600);
H.eq(big.width, 600, 'a 4033px-wide logo comes down to 600');
H.eq(big.height, 543, 'and keeps its aspect ratio');
H.ok(big.scaled, 'and is marked as scaled');

const small = IO.targetSize(148, 225, 600);
H.eq(small.width, 148, 'a small avatar keeps its width');
H.eq(small.height, 225, 'and its height');
H.ok(!small.scaled, 'and is not marked as scaled — upscaling would only add bytes');

const tall = IO.targetSize(400, 2000, 600);
H.eq(tall.height, 600, 'a tall image is capped on its LONG edge, not its width');
H.eq(tall.width, 120, 'and its width follows');
H.eq(IO.targetSize(0, 0, 600).width, 0, 'a zero-sized image does not divide by zero');
H.eq(IO.targetSize(1, 10000, 600).width, 1, 'and an extreme ratio never rounds a side to zero');

console.log('\n[transparency decides the format, the way the site already does]');
// Photographs on this site are JPEG (og-image.jpg, 1200×630, 72KB); logos with
// transparency are PNG (images/partners/*). JPEG cannot hold an alpha channel,
// so a transparent logo turned into a JPEG gains a black or white box.
H.eq(IO.chooseType('image/png', true), 'image/png', 'a transparent PNG stays a PNG');
H.eq(IO.chooseType('image/png', false), 'image/jpeg', 'an opaque PNG becomes a JPEG');
H.eq(IO.chooseType('image/jpeg', false), 'image/jpeg', 'a photo stays a photo');
H.eq(IO.chooseType('image/webp', true), 'image/png', 'and anything transparent lands on PNG');

console.log('\n[formats a canvas must not touch]');
H.ok(!!IO.isPassThrough('image/svg+xml', null), 'an SVG is passed through');
H.ok(/resolution-free/.test(IO.isPassThrough('image/svg+xml', null)), 'and says why');
H.eq(IO.isPassThrough('image/png', new Uint8Array([137, 80, 78, 71])), null, 'a PNG is processed');
H.eq(IO.isPassThrough('image/jpeg', new Uint8Array([255, 216, 255])), null, 'and a JPEG');

console.log('\n[animated GIFs keep their animation]');
// The marker is the Graphic Control Extension — 00 21 F9 04 — one per frame.
const gif = (frames) => {
  const head = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x10, 0x00, 0x10, 0x00];
  const out = head.slice();
  for (let i = 0; i < frames; i++) out.push(0x00, 0x21, 0xF9, 0x04, 0x00, 0x00, 0x00, 0x00);
  return new Uint8Array(out);
};
H.ok(IO.isAnimatedGif(gif(2)), 'two frames is animated');
H.ok(IO.isAnimatedGif(gif(9)), 'so is nine');
H.ok(!IO.isAnimatedGif(gif(1)), 'one frame is not');
H.ok(!IO.isAnimatedGif(gif(0)), 'nor is a GIF with no control extension at all');
H.ok(!IO.isAnimatedGif(new Uint8Array([137, 80, 78, 71, 13, 10])), 'a PNG is not a GIF');
H.ok(!IO.isAnimatedGif(new Uint8Array([])), 'and neither is nothing');
H.ok(!!IO.isPassThrough('image/gif', gif(3)), 'an animated GIF is passed through');
H.ok(/first frame/.test(IO.isPassThrough('image/gif', gif(3))), 'and says why');

// The real GIF in the repo is a still, so it must NOT be treated as animated —
// otherwise every static GIF would skip optimisation for no reason.
// Found rather than named: uploaded filenames carry a content hash now, so a
// hardcoded name stopped existing the first time that picture was replaced and
// these two checks silently skipped instead of failing.
const ACTIVITY_IMAGES = path.join(__dirname, '..', 'images', 'activities');
const REAL_GIF = (fs.existsSync(ACTIVITY_IMAGES) ? fs.readdirSync(ACTIVITY_IMAGES) : [])
  .filter((f) => f.endsWith('.gif'))
  .map((f) => path.join(ACTIVITY_IMAGES, f))[0];
if (REAL_GIF) {
  const bytes = new Uint8Array(fs.readFileSync(REAL_GIF));
  H.ok(!IO.isAnimatedGif(bytes), 'the still GIF committed in this repo is not read as animated');
  H.eq(IO.isPassThrough('image/gif', bytes), null, 'so it goes through the normal path');
}

console.log('\n[what the admin is told]');
// A saving that is not a saving is worse than silence: it invites someone to
// believe a file got smaller when it did not.
H.eq(IO.describe({ before: 886000, after: 27000, note: 'resized to 1600×703' }),
     '865 KB → 26 KB (97% smaller, resized to 1600×703)', 'a real saving is reported as one');
H.eq(IO.describe({ before: 53000, after: 53000, note: 'kept as it is — re-encoding made it bigger' }),
     '52 KB — kept as it is — re-encoding made it bigger', 'and no saving is reported honestly');

H.done();
