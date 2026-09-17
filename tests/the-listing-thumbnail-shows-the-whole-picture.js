// What this defends against:
//
// The card image is uploaded and STORED square — js/image-optimize.js crops the
// `card` profile to `ratio: 1` at 800px, and refuses its own bail-out whenever
// anything was cut away, so a card image is square by contract rather than by
// luck. The listing then rendered it in a fixed `height:150px` band with
// object-fit:cover, which threw away the top and bottom: on a 290px-wide card,
// 53% of the picture, centred.
//
// That is not a framing quibble. These are TITLED graphics — the activity's
// name is typeset into the artwork, near the top — so the half being discarded
// was the half that named the activity. The live site showed "עברית" sliced
// through the middle and "Hebrew for kids" gone entirely.
//
// CLAUDE.md records the IDENTICAL bug on the activity page, fixed by capping
// the figure's width and never touching the image rule. The listing thumb was
// written separately and kept the flaw, so the lesson had to be learned twice.
//
// The second half of this is the trap that fix carries. `width` and `height`
// ATTRIBUTES on the <img> are presentational hints, and `height="800"` BEATS
// aspect-ratio. So `height:auto` and `aspect-ratio` have to travel together —
// restate one without the other and the picture renders 800px tall. The same
// pairing is already pinned for .activity-card-image; this pins it for the
// thumb, and pins that there is exactly ONE rule for each so the pair cannot be
// split across a media query.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');

const R = path.join(__dirname, '..');
// Comment-stripped: the prose above each rule names the properties this
// searches for, and a naive match finds them in the explanation and passes
// whether or not the declaration is still there. That has happened three times
// in this directory.
const css = fs.readFileSync(path.join(R, 'shared.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

const rulesFor = (sel) => {
  const out = [];
  const re = new RegExp('(^|[\\s})])' + sel.replace(/[.\-]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'g');
  let m;
  while ((m = re.exec(css))) out.push(m[2].replace(/\s+/g, ' ').trim());
  return out;
};

console.log('[the thumbnail is square, because the upload already is]');
const thumb = rulesFor('.activity-card-thumb');
H.eq(thumb.length, 1, 'there is exactly ONE .activity-card-thumb rule, so the pair cannot be split');
const t = thumb[0];
H.ok(/aspect-ratio:\s*1\s*\/\s*1/.test(t), 'it declares aspect-ratio:1/1');
H.ok(/height:\s*auto/.test(t), 'and height:auto IN THE SAME RULE — the attribute wins without it');
H.ok(!/height:\s*\d+px/.test(t), 'and no fixed pixel height, which is what was cropping the artwork');
H.ok(/object-fit:\s*cover/.test(t),
  'object-fit:cover stays — harmless on a square source, and it is what keeps a ' +
  'non-square upload filling the frame rather than letterboxed');

console.log('\n[the activity page keeps the same pairing]');
const big = rulesFor('.activity-card-image img');
H.eq(big.length, 1, 'exactly one .activity-card-image img rule');
H.ok(/aspect-ratio:\s*1\s*\/\s*1/.test(big[0]) && /height:\s*auto/.test(big[0]),
  'and it carries both halves together too');

console.log('\n[the upload really is square, so nothing is being cropped here]');
const opt = fs.readFileSync(path.join(R, 'js/image-optimize.js'), 'utf8');
H.ok(/card:\s*\{[^}]*ratio:\s*1\b/.test(opt.replace(/\s+/g, ' ')),
  'the card profile crops to ratio 1 — the square is a contract, not a coincidence');

console.log('\n[and the generated listing actually uses the class]');
const listing = fs.readFileSync(path.join(R, 'activities/index.html'), 'utf8');
H.ok(/class="activity-card-thumb"/.test(listing), 'the committed listing renders the thumb');
const img = (listing.match(/<img class="activity-card-thumb"[^>]*>/) || [''])[0];
if (img) {
  H.ok(/width="800"\s+height="800"/.test(img),
    'with square attributes — which is exactly why height:auto is load-bearing');
}

H.done();
