// What this defends against:
//
// The facts sidebar was eight label/value rows: the label at one edge, the value
// at the other, via justify-content:space-between and text-align:end. A shape
// like that has to be told which edge is which, and in a site that renders the
// same markup right-to-left and left-to-right that instruction kept being wrong.
// It was fixed more than once and came back each time, because every new rule
// was another place the two directions could disagree.
//
// It is now three grouped blocks — an icon, a heading, and its facts stacked
// underneath — ported from the Shirat HaYam event sidebar. Nothing is pushed to
// an edge: a flex row puts the icon at the leading edge per direction on its
// own, and stacked text is start-aligned, which is what `direction` already
// means. So this suite pins the two things that would bring the bug back:
//
//   - no directional override anywhere in the sidebar CSS
//   - every fact still reaches the page, in exactly one group
//
// Plus the ordinary ways a regrouping loses something: a fact left out of every
// group, a fact listed in two, a group heading that repeats a fact label inside
// it, and an empty group rendering as a lone icon with a heading and no facts.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');

const R = path.join(__dirname, '..');
const facts = require('../netlify/functions/_activity-facts.js');
const template = require('../netlify/functions/_activity-template.js');
// COMMENTS STRIPPED. The rules below are explained by comments that name the
// very words they search for — "nothing is pushed to an edge", "two columns,
// not auto-fit" — so a naive search finds the prose and passes whether or not
// the declaration is still there. That mistake got past a review three times on
// this project.
const css = fs.readFileSync(path.join(R, 'shared.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const record = require('../activities/hebrew4kids.json');

console.log('[every fact is grouped exactly once]');
const grouped = [].concat(...facts.FACT_GROUPS.map((g) => g.facts));
facts.FACT_ORDER.forEach((key) => {
  H.ok(grouped.indexOf(key) !== -1, key + ' belongs to a group');
});
H.eq(grouped.length, facts.FACT_ORDER.length, 'no fact is grouped twice and none is invented');
// _activity-facts.js asserts this at require time too. That is the real guard;
// this is the one that names the fact when it fails.
H.ok(grouped.every((k) => facts.FACT_ORDER.indexOf(k) !== -1), 'no group lists a fact that does not exist');

console.log('\n[the sidebar CSS has no directional override]');
// The groups are cards in two placements now — two in a row above the article,
// two in a column beside it — but the shape inside each is unchanged, and so is
// the reason this suite exists.
const block = css.slice(css.indexOf('.fact-card{'), css.indexOf('.sidebar-cta{'));
H.ok(block.length > 200, 'found the fact-card block in shared.css');
H.ok(block.indexOf('[dir=') === -1, 'no [dir=…] selector');
H.ok(!/text-align:\s*(left|right)/.test(block), 'no physical text-align');
H.ok(!/(^|[^-])\b(margin|padding)-(left|right)\s*:/.test(block), 'no physical margin or padding');
H.ok(!/\b(left|right)\s*:/.test(block), 'no physical left/right offsets');
// The old shape, in the exact form that kept breaking.
H.ok(block.indexOf('space-between') === -1, 'nothing is pushed to opposite edges');
H.ok(css.indexOf('.sidebar-row{') === -1, 'the old .sidebar-row rules are gone, not merely unused');

console.log('\n[a wide card is two columns, and that is what places two facts]');
// This one declaration does two things that look unrelated, which is why it is
// pinned rather than left to read as a taste choice:
//
//   - "Who it is for" holds four facts. auto-fit packs as many 140px tracks as
//     fit — three at the ~500px of a top-row card — so the fourth landed alone
//     beside two empty tracks.
//   - "When & where" holds three. With a fixed pair they flow so that Location
//     sits UNDER When, and Duration keeps half the card, which is the width its
//     date range needs to stay on one line.
//
// The 500px threshold is measured, not judged: half a card must hold the date
// range on one line, which needs 490px of card in English, 470 in Russian, 410
// in Hebrew. Lower it and two columns become a downgrade — the date range wraps
// to a third line, which is what splitting Location out of it was meant to fix.
//
// Put auto-fit back and both regress silently: nothing overflows, nothing
// errors, the cards just go ragged and Duration wraps to three lines.
const cqAt = css.indexOf('@container (min-width:500px)');
const cq = css.slice(cqAt, css.indexOf('\n.sidebar-facts{', cqAt));
H.ok(cq.length > 60, 'found the container query at 500px, the measured English minimum');
H.ok(/grid-template-columns:\s*repeat\(2,\s*1fr\)/.test(cq), 'a wide card is exactly two columns');
H.ok(cq.indexOf('auto-fit') === -1, 'not auto-fit, which gave three and left a ragged shelf');
// The card decides from ITS OWN width, so one component serves the ~500px row
// and the 320px column with no variant and no viewport breakpoint of its own.
H.ok(css.indexOf('container-type:inline-size') !== -1, 'and it is the card that decides, not the viewport');

console.log('\n[the price qualifier is a quiet line, not a label]');
// "(10 sessions x 2 lessons)" is neither the label nor the number. Given the
// label's weight it reads as a second label; given the number's size it reads
// as part of the figure.
const note = css.slice(css.indexOf('.fact-note{'), css.indexOf('}', css.indexOf('.fact-note{')));
H.ok(note.length > 20, 'found the .fact-note rule');
H.ok(/font-style:\s*italic/.test(note), 'it is italic');
H.ok(/display:\s*block/.test(note), 'and on its own line, between the two');
H.ok(!/font-weight:\s*[6-9]00|font-weight:\s*bold/.test(note), 'and never bold, which would make it a second label');

console.log('\n[what actually renders]');
['he', 'en', 'ru'].forEach((lang) => {
  const html = template.renderActivityPage(record, lang);
  // Both placements together: the facts must all still be on the page, wherever
  // the card holding them ended up.
  const aside = (html.match(/<div class="activity-body">[\s\S]*?<\/article>/) || [])[0] || '';
  H.ok(aside.length > 0, lang + ': the page body renders');
  H.ok(aside.indexOf('sidebar-row') === -1, lang + ': no label/value rows survive');

  // Every fact the record actually has must still be on the page. Compared
  // against sidebarRows rather than a hardcoded list, so a fact left blank on
  // this record does not read as a missing one.
  const expected = facts.sidebarRows(record, lang).map((r) => r.key);
  H.ok(expected.length >= 6, lang + ': the fixture carries enough facts to be worth checking');
  expected.forEach((key) => {
    H.ok(aside.indexOf('data-fact="' + key + '"') !== -1, lang + ': ' + key + ' is on the page');
  });
  const rendered = (aside.match(/data-fact="([a-zA-Z]+)"/g) || [])
    .map((m) => m.slice(11, -1));
  H.eq(Array.from(new Set(rendered)).sort().join(','), expected.slice().sort().join(','),
    lang + ': and nothing else appears');
  // One fact is one row, with ONE exception: the price is four numbers a family
  // compares, so it renders its derived rows individually. Asserted rather than
  // tolerated, so a second multi-row fact has to be a decision.
  const multi = rendered.filter((k, i) => rendered.indexOf(k) !== i);
  H.eq(Array.from(new Set(multi)).join(','), 'price',
    lang + ': and the price is the only fact that renders as more than one row');
  H.eq(rendered.filter((k) => k === 'price').length, 4, lang + ': as four rows');

  // A group with no facts would render as an icon and a heading labelling
  // nothing. Every group present must carry at least one fact.
  const groups = aside.match(/<div class="fact-card" data-group="(?!credits)[\s\S]*?<\/ul>/g) || [];
  H.ok(groups.length > 0, lang + ': groups rendered');
  groups.forEach((g) => {
    const key = (g.match(/data-group="([a-z]+)"/) || [])[1];
    H.ok((g.match(/<li /g) || []).length > 0, lang + ': the ' + key + ' group is not empty');
    H.ok(/<span class="fact-card-icon"/.test(g), lang + ': the ' + key + ' group has an icon');
    H.ok(/<h2>[^<]+<\/h2>/.test(g), lang + ': the ' + key + ' group has a heading');
  });

  // A heading repeating a label inside its own group reads as the same row
  // twice. This caught "When" sitting above a fact also called "When".
  groups.forEach((g) => {
    const heading = (g.match(/<h2>([^<]+)<\/h2>/) || [])[1];
    const labels = (g.match(/<strong>([^<]+)<\/strong>/g) || [])
      .map((s) => s.replace(/<\/?strong>/g, ''));
    H.ok(labels.indexOf(heading) === -1,
      lang + ': "' + heading + '" does not repeat a label inside its own group');
  });
});

console.log('\n[groups are labelled in every language]');
['participants', 'schedule', 'price'].forEach((key) => {
  const seen = {};
  ['he', 'en', 'ru'].forEach((lang) => {
    const html = template.renderActivityPage(record, lang);
    const g = (html.match(new RegExp('data-group="' + key + '"[\\s\\S]*?<h2>([^<]+)</h2>')) || [])[1];
    H.ok(!!g, key + ' has a heading in ' + lang);
    seen[lang] = g;
  });
  H.ok(seen.he !== seen.en, key + ': Hebrew is not the English string');
  H.ok(seen.ru !== seen.en, key + ': Russian is not the English string');
});

console.log('\n[an activity with nothing to say drops the group whole]');
const bare = JSON.parse(JSON.stringify(record));
// Every fact the card holds, not just the two it is named for — Location moved
// in here when Details was retired, and a card with only a location left is not
// an empty card.
bare.facts.schedule = {};
bare.facts.duration = {};
bare.facts.location = {};
bare.facts.address = {};
const bareGroups = facts.sidebarGroups(bare, 'en').map((g) => g.key);
H.ok(bareGroups.indexOf('schedule') === -1, 'the empty schedule group is dropped, not rendered blank');
H.ok(bareGroups.indexOf('participants') !== -1, 'the groups that still have facts stay');

H.done();
