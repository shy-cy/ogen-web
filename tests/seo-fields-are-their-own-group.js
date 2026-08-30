// What this defends against:
//
// Meta title and meta description sat in the middle of the content fields,
// among the body copy. Read in that order they look like more body copy to
// write, which is how a meta description ends up being a paragraph. They are
// now their own group, rendered in their own panel at the foot of the form.
//
// Regrouping a field in a form built from a schema is the kind of change that
// looks purely cosmetic and is not. The form is a projection of the schema in
// three places, and they must move together:
//
//   - the client RENDERS each group into a container that has to exist
//   - the client READS THE FORM BACK from the same groups; a group missing here
//     is read as empty, and the next save silently blanks a meta description
//     that was on screen the whole time
//   - the server merges SIMPLE_KEYS; a key missing there is dropped on save
//
// The read-back is the dangerous one, because nothing about it looks wrong: the
// field renders, the admin types into it, the save succeeds, and the value is
// gone. So this suite checks a round trip rather than the schema alone.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');

const R = path.join(__dirname, '..');
const adminJs = fs.readFileSync(path.join(R, 'js/activities-admin.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(R, 'admin/activities.html'), 'utf8');
// Loaded through the stub loader like every other suite: activities-admin pulls
// in Blobs at require time, so requiring it bare gives an empty module.
const { 'activities-admin': fn } = H.loadWithStubs({
  github: H.makeGithub(H.seedRepo()),
  blobs: H.makeBlobs(),
  modules: ['activities-admin']
});
const SCHEMA = fn._internal.FIELD_SCHEMA;

const SEO_KEYS = ['metaTitle', 'metaDescription'];

console.log('[the schema has an SEO group]');
H.ok(Array.isArray(SCHEMA.seo), 'there is a seo group');
SEO_KEYS.forEach((k) => {
  H.ok(SCHEMA.seo.some((f) => f.key === k), k + ' is in it');
  H.ok(!SCHEMA.simple.some((f) => f.key === k), k + ' has left the content fields');
});
H.ok(SCHEMA.seo.every((f) => f.label), 'every SEO field is labelled');

console.log('\n[content fields kept theirs]');
['title', 'summary', 'about'].forEach((k) => {
  H.ok(SCHEMA.simple.some((f) => f.key === k), k + ' is still a content field');
});
// There is no `optional` group any anymore: it held only "What to bring", which
// is retired. An empty group would still need a container rendered for it, so
// it was removed rather than left as a hollow — and that removal has to reach
// the client's read-back and the server's SIMPLE_KEYS too, which is exactly the
// three-places problem this suite exists for.
H.ok(SCHEMA.optional === undefined, 'the optional group is gone, not left empty');
H.ok(!Object.keys(SCHEMA).some((g) => Array.isArray(SCHEMA[g]) &&
     SCHEMA[g].some((f) => f && f.key === 'whatToBring')), 'and no group still lists whatToBring');

console.log('\n[the server still saves them]');
// A field can be perfectly grouped in the form and still be dropped on save.
// SIMPLE_KEYS is what the merge walks; grouping is a question for the form only.
const keys = SCHEMA.simple.concat(SCHEMA.seo).map((f) => f.key);
SEO_KEYS.forEach((k) => {
  H.ok(keys.indexOf(k) !== -1, k + ' is among the translatable scalars');
});
const fnSrc = fs.readFileSync(path.join(R, 'netlify/functions/activities-admin.js'), 'utf8');
H.ok(/const SIMPLE_KEYS = FIELD_SCHEMA\.simple[\s\S]{0,160}FIELD_SCHEMA\.seo/.test(fnSrc),
  'SIMPLE_KEYS includes the SEO group, so a save merges it like any other field');

console.log('\n[the form renders it, in its own panel, at the end]');
H.ok(adminHtml.indexOf('id="seo-fields"') !== -1, 'the panel container exists');
H.ok(/<h2>Search &amp; sharing<\/h2>/.test(adminHtml), 'and is headed like every other section');
// Grouping is only real if it is at the end: a "Search & sharing" panel sitting
// above "What to bring" would be a heading, not a separation.
H.ok(adminHtml.indexOf('id="seo-panel"') > adminHtml.indexOf('id="list-faq-panel"'),
  'it comes after the content panels');
H.ok(adminHtml.indexOf('id="seo-panel"') < adminHtml.indexOf('class="action-bar"'),
  'and before the save buttons, so it is not below the fold of the form');
H.ok(/\$\('seo-fields'\)\.innerHTML = ''/.test(adminJs), 'the client draws into it');
H.ok(/\(S\.schema\.seo \|\| \[\]\)\.forEach/.test(adminJs),
  'from the schema, so adding an SEO field stays a one-line server change');

console.log('\n[and reads it back, which is the one that fails silently]');
H.ok(/S\.schema\.simple\.concat\(S\.schema\.seo \|\| \[\]\)/.test(adminJs),
  'readForm walks the SEO group too');
// The shape of the bug: rendering from more groups than are read back. This is
// the assertion that matters and it is written generically, so retiring the
// optional group could not slip past it.
const readForm = adminJs.slice(adminJs.indexOf('function readForm'));
const renderFields = adminJs.slice(adminJs.indexOf('function renderFields'), adminJs.indexOf('function renderCardImage'));
const renderedGroups = (renderFields.match(/S\.schema\.(simple|optional|seo)/g) || []).sort();
const readGroups = (readForm.slice(0, 900).match(/S\.schema\.(simple|optional|seo)/g) || []).sort();
H.eq(JSON.stringify(renderedGroups), JSON.stringify(readGroups),
  'exactly the groups that are drawn are the groups that are read back');

H.done();
