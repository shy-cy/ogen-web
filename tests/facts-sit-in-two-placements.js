// What this defends against:
//
// The facts were one panel in one column. They are four cards in THREE places
// now: "Who it is for" and "When & where" sit above the article, "Price" sits
// in the column beside the picture, and "Staff & sponsors" is a full-width band
// under everything.
//
// Splitting one thing into two is where content goes missing, so this pins
// which card lands where, and that the set is still complete.
//
// It also pins the two rules the split turns on, both of which look like
// details and are not:
//
//   - The picture appears ONCE in the markup. It sits under the hero on a
//     phone and at the head of the side column on a desktop, and the temptation
//     is to render it twice and hide one. Two copies drift, and the hidden one
//     is still downloaded.
//   - The article comes BEFORE the side column in the source. That is what puts
//     the article ahead of Price and Staff on a phone, and it is also why the
//     column sits at the trailing edge — left in Hebrew, right in English and
//     Russian. The two are the same fact and cannot be changed independently.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');

const R = path.join(__dirname, '..');
const template = require('../netlify/functions/_activity-template');
// Comments stripped. The rules this suite pins are explained by comments that
// NAME them — "No position:sticky here", "nothing is hidden with display:none" —
// so a naive search finds the prose and passes with the declaration present.
// That exact mistake got past a review earlier in this project.
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');
const css = stripComments(fs.readFileSync(path.join(R, 'shared.css'), 'utf8'));
const record = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/activity-record.json'), 'utf8'));

const LANGS = ['he', 'en', 'ru'];
const at = (html, needle) => html.indexOf(needle);

console.log('[each card lands in its own placement]');
LANGS.forEach((lang) => {
  const html = template.renderActivityPage(record, lang);
  const row = (html.match(/<div class="fact-row">[\s\S]*?\n    <\/div>/) || [])[0] || '';
  const aside = (html.match(/<div class="activity-aside">[\s\S]*?\n    <\/div>/) || [])[0] || '';
  const groupsIn = (chunk) => (chunk.match(/data-group="(\w+)"/g) || []).map((m) => m.slice(12, -1));

  const band = (html.match(/<div class="activity-credits">[\s\S]*?\n    <\/div>/) || [])[0] || '';

  H.eq(groupsIn(row).join(','), 'participants,schedule',
    lang + ': the top row is who it is for, then when & where');
  // Price is ALONE in the column, directly above the registration button, so
  // the column reads picture, price, act.
  H.eq(groupsIn(aside).join(','), 'price',
    lang + ': the side column is the price card and nothing else');
  H.eq(groupsIn(band).join(','), 'credits',
    lang + ': staff & sponsors is its own band');
  // The band is a SIBLING of the aside, not nested in it — nesting would put it
  // back in a 320px column while still passing a naive "is it present" check.
  H.ok(aside.indexOf('data-group="credits"') === -1,
    lang + ': and is not inside the column it left');
  H.ok(at(html, 'activity-aside') < at(html, 'activity-credits'),
    lang + ': it comes after the column in the source, which is its mobile order too');

  // Nothing lost in the split: every group the record has is somewhere.
  const all = (html.match(/data-group="(\w+)"/g) || []).length;
  H.eq(all, 4, lang + ': four cards, no more and no fewer');
});

console.log('\n[the picture exists once, and leads the source]');
// The pinned fixture carries no cardImage, so the picture is added here rather
// than asserted against a record that has none.
const withPic = Object.assign({}, record, { cardImage: '/images/activities/x-card-abc12345.jpg' });
LANGS.forEach((lang) => {
  const html = template.renderActivityPage(withPic, lang);
  H.eq((html.match(/activity-card-image/g) || []).length, 1,
    lang + ': one <figure>, not one per breakpoint');
  H.ok(at(html, 'activity-card-image') < at(html, 'fact-row'),
    lang + ': and it comes first, so it leads the page in a single column');
    H.ok(/aria-hidden="true"/.test((html.match(/<figure[^>]*>/) || [''])[0]),
    lang + ': it is decorative, which is what allows the grid to move it');
});
// The stacked grid, from area names alone. The desktop map is asserted further
// down, where the two rules it depends on are.
H.ok(/"pic"\s*\n\s*"row"\s*\n\s*"main"\s*\n\s*"aside"\s*\n\s*"credits"/.test(css),
  'the stacked grid puts the picture first and the credits band last');
// Scoped to the elements the layout places, not to a slice of the stylesheet:
// an unrelated `.status-badge:empty{display:none}` sits between them and made a
// broader check pass for the wrong reason.
const HIDEABLE = /\.(activity-card-image|fact-row|activity-aside|activity-main)[^{]*\{([^}]*)\}/g;
let hidden = null;
for (const m of css.matchAll(HIDEABLE)) if (/display:\s*none/.test(m[2])) hidden = m[0];
H.eq(hidden, null, 'no rule hides any of the placed elements to fake a second copy');

console.log('\n[the article precedes the side column — mobile order and edge are one fact]');
LANGS.forEach((lang) => {
  const html = template.renderActivityPage(record, lang);
  H.ok(at(html, 'activity-main') < at(html, 'activity-aside'),
    lang + ': article first, so Price and the button follow it on a phone');
});
// A flex/grid row places the first item at the leading edge, so article-first
// IS column-at-the-trailing-edge. No CSS may quietly undo it.
const body = css.slice(css.indexOf('.activity-body{'), css.indexOf('.sidebar-cta{'));
H.ok(!/\border\s*:\s*-?\d/.test(body), 'no CSS order property reshuffling the columns');
H.ok(!/row-reverse|column-reverse/.test(body), 'and no reversed flex direction doing it the other way');
H.ok(body.indexOf('[dir=') === -1, 'no directional selector anywhere in the layout');
H.ok(!/\b(margin|padding)-(left|right)\s*:/.test(body), 'no physical margin or padding');

console.log('\n[the two rules that fail as a gap rather than an error]');
// 1. The fact row spans the first TWO grid rows. That span is what lets the two
//    columns behave as independent stacks: row 1 is sized by the picture alone,
//    so the price card starts directly beneath it rather than waiting for the
//    cards to finish.
const areas = (body.match(/grid-template-areas:([\s\S]*?);/) || [])[1] || '';
H.ok(/"row\s+pic"/.test(areas), 'the picture shares row 1 with the fact cards');
H.ok(/"row\s+aside"/.test(areas), 'and the fact row spans into row 2, where the aside starts');
H.ok(/"main\s+aside"/.test(areas), 'the article sits below the cards, beside the aside');
H.ok(/"credits\s+credits"/.test(areas), 'and the credits band spans both columns');

// 2. Without pinning the first two tracks, CSS grid shares a spanning item
//    EQUALLY across auto tracks — which inflates row 2 and opens a 117px hole
//    under the picture. Nothing overflows and nothing errors; there is just a
//    gap. So the value is pinned here, on comment-stripped CSS, because the
//    comment above the rule says the words this searches for.
H.ok(/grid-template-rows:\s*min-content min-content auto auto/.test(body),
  'the first two grid rows are pinned to min-content');

// 3. The fact row WRAPS from a per-card basis instead of switching direction at
//    a viewport width. That is what keeps the two cards side by side on a
//    tablet, which a 939px switch to column had been preventing.
const factRow = css.slice(css.indexOf('.fact-row{'), css.indexOf('.activity-main h2{'));
H.ok(/flex-wrap:\s*wrap/.test(factRow), 'the fact row wraps');
H.ok(/flex:\s*1 1 320px/.test(factRow), 'from a 320px basis per card, not from a breakpoint');
const stacked = css.slice(css.indexOf('@media (max-width:939px)'));
H.ok(!/\.fact-row\s*\{[^}]*flex-direction/.test(stacked),
  'and no media query forces it back into a column');

console.log('\n[the cards are one plain surface, told apart by their icon]');
const card = css.slice(css.indexOf('.fact-card{'), css.indexOf('.fact-card-head{'));
H.ok(/background:\s*var\(--paper\)/.test(card), 'one paper ground for all four');
H.ok(/border:1px solid var\(--stone\)/.test(card), 'separated by a stone border');
// The tinted version was tried and dropped: four tinted panels read as four
// states of one thing rather than four kinds of information. So a per-card rule
// may never touch the SURFACE — no background, border, shadow or text colour.
// This used to forbid every per-card selector, which is a blunter rule than the
// one it was defending and started failing the day one card earned a layout
// override.
const perCard = css.match(/\.fact-card\[data-group="[a-z]+"\][^{]*\{[^}]*\}/g) || [];
perCard.forEach((rule) => {
  const key = (rule.match(/data-group="([a-z]+)"/) || [])[1];
  H.ok(!/(background|border|box-shadow|(^|[^-])\bcolor)\s*:/.test(rule),
    'the ' + key + ' card does not tint itself');
});
// And exactly one card overrides anything at all, so a second is a decision
// rather than a drift. The price is four numbers that ADD UP, so it stays one
// column at every width and the total sits under the figures it sums; every
// other card holds facts a reader scans in any order.
H.eq(perCard.map((r) => (r.match(/data-group="([a-z]+)"/) || [])[1]).join(','), 'price',
  'the price is the only card that asks for anything');
H.ok(/grid-template-columns:\s*1fr/.test(perCard[0] || ''), 'and what it asks for is a single column');
['olive', 'terracotta', 'navy', 'gold'].forEach((c) => {
  H.ok(new RegExp("color: 'var\\(--" + c + "\\)'")
    .test(fs.readFileSync(path.join(R, 'netlify/functions/_activity-template.js'), 'utf8')),
    'the icon rotation still includes ' + c);
});

console.log('\n[an empty group takes its card with it]');
const bare = Object.assign({}, record, { facts: {}, teachers: [], sponsors: [] });
const bareHtml = template.renderActivityPage(bare, 'he');
H.eq((bareHtml.match(/data-group="/g) || []).length, 0, 'no facts and no credits: no cards at all');
H.ok(bareHtml.indexOf('fact-row') === -1, 'and no empty row left behind');
H.ok(bareHtml.indexOf('data-status-cta') !== -1, 'the status CTA still renders');

console.log('\n[credits stay client-rendered — the shell only]');
// Deliberately NOT server-rendered: that changes a markup contract and needs
// its own decision. The template emits the card and the JSON; js/activity.js
// fills it.
LANGS.forEach((lang) => {
  const html = template.renderActivityPage(record, lang);
  H.ok(/<div class="credit-block" data-credits><\/div>/.test(html),
    lang + ': the slot is empty in the HTML');
  H.ok(/id="activity-credits"/.test(html), lang + ': and the JSON block is there for the JS');
});
const js = fs.readFileSync(path.join(R, 'js/activity.js'), 'utf8');
H.ok(/closest\('\.fact-card'\)/.test(js),
  'and an empty credits card is removed whole, not left as a heading labelling nothing');
H.ok(/credit-logo/.test(js) && /credit-logo\{/.test(css),
  'sponsor marks are contained in a tile rather than cropped into a circle');

console.log('\n[the inert sticky rule is gone]');
H.ok(!/position:sticky/.test(css.slice(css.indexOf('.activity-body{'), css.indexOf('.sidebar-cta{'))),
  'no position:sticky on the column — it stopped engaging when the column passed the viewport height');

H.done();
