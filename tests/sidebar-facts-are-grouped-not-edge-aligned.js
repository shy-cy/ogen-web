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
const css = fs.readFileSync(path.join(R, 'shared.css'), 'utf8');
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
const block = css.slice(css.indexOf('.sidebar-group{'), css.indexOf('.sidebar-cta{'));
H.ok(block.length > 200, 'found the sidebar block in shared.css');
H.ok(block.indexOf('[dir=') === -1, 'no [dir=…] selector');
H.ok(!/text-align:\s*(left|right)/.test(block), 'no physical text-align');
H.ok(!/(^|[^-])\b(margin|padding)-(left|right)\s*:/.test(block), 'no physical margin or padding');
H.ok(!/\b(left|right)\s*:/.test(block), 'no physical left/right offsets');
// The old shape, in the exact form that kept breaking.
H.ok(block.indexOf('space-between') === -1, 'nothing is pushed to opposite edges');
H.ok(css.indexOf('.sidebar-row{') === -1, 'the old .sidebar-row rules are gone, not merely unused');

console.log('\n[what actually renders]');
['he', 'en', 'ru'].forEach((lang) => {
  const html = template.renderActivityPage(record, lang);
  const aside = (html.match(/<aside class="activity-sidebar">[\s\S]*?<\/aside>/) || [])[0] || '';
  H.ok(aside.length > 0, lang + ': the sidebar renders');
  H.ok(aside.indexOf('sidebar-row') === -1, lang + ': no label/value rows survive');

  // Every fact the record actually has must still be on the page. Compared
  // against sidebarRows rather than a hardcoded list, so a fact left blank on
  // this record does not read as a missing one.
  const expected = facts.sidebarRows(record, lang).map((r) => r.key);
  H.ok(expected.length >= 6, lang + ': the fixture carries enough facts to be worth checking');
  expected.forEach((key) => {
    H.ok(aside.indexOf('data-fact="' + key + '"') !== -1, lang + ': ' + key + ' is on the page');
  });
  H.eq((aside.match(/data-fact="/g) || []).length, expected.length,
    lang + ': and appears exactly once');

  // A group with no facts would render as an icon and a heading labelling
  // nothing. Every group present must carry at least one fact.
  const groups = aside.match(/<div class="sidebar-group"[\s\S]*?<\/ul>/g) || [];
  H.ok(groups.length > 0, lang + ': groups rendered');
  groups.forEach((g) => {
    const key = (g.match(/data-group="([a-z]+)"/) || [])[1];
    H.ok((g.match(/<li /g) || []).length > 0, lang + ': the ' + key + ' group is not empty');
    H.ok(/<span class="sidebar-group-icon"/.test(g), lang + ': the ' + key + ' group has an icon');
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
['participants', 'schedule', 'practical'].forEach((key) => {
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
bare.facts.schedule = {};
bare.facts.duration = {};
const bareGroups = facts.sidebarGroups(bare, 'en').map((g) => g.key);
H.ok(bareGroups.indexOf('schedule') === -1, 'the empty schedule group is dropped, not rendered blank');
H.ok(bareGroups.indexOf('participants') !== -1, 'the groups that still have facts stay');

H.done();
