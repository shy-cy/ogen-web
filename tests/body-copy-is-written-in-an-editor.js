// What this defends against:
//
// "About this activity" was three narrow textareas side by side, and a plain
// string. Two things were wrong with that. Prose written a paragraph at a time
// does not belong in a third of the width — the short fields are a comparison
// task, body copy is not. And a plain string cannot hold a heading, a list or a
// link, so the only formatting available was blank lines.
//
// It is Quill now, the same editor and version the Shirat HaYam admin uses, with
// the three languages STACKED. That makes the stored value HTML, and the page
// prints it as markup rather than escaping it — which is the dangerous part, and
// what most of this suite is about:
//
//   - the server sanitises to a fixed tag allowlist on EVERY save, because the
//     value arrives as a string in a request body like any other field;
//   - places that take text and not markup (meta description, og:description,
//     the listing blurb) must strip the tags, or a search result reads
//     "&lt;p&gt;במרכז עוגן…";
//   - records written before the editor existed hold plain text, and must go on
//     rendering exactly as they did, with nothing migrated.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');

process.env.GITHUB_TOKEN = 'x'; process.env.GITHUB_REPO = 'a/b'; process.env.GITHUB_BRANCH = 'main';
const { sanitiseRich, RICH_KEYS, FIELD_SCHEMA, mergeByPermission } =
  require('../netlify/functions/activities-admin')._internal;
const tpl = require('../netlify/functions/_activity-template');
const idx = require('../netlify/functions/_activity-index');

const R = path.join(__dirname, '..');
const adminJs = fs.readFileSync(path.join(R, 'js/activities-admin.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(R, 'admin/activities.html'), 'utf8');

const activity = (about, bring) => ({
  slug: 'purim', status: 'open',
  title: { he: 'כותרת', en: 'Title', ru: '' },
  about: { he: about, en: '', ru: '' },
  whatToBring: bring ? { he: bring, en: '', ru: '' } : undefined,
  facts: {}, teachers: [], sponsors: [], faq: []
});

console.log('[which fields are rich comes from the schema]');
H.eq(JSON.stringify(RICH_KEYS), '["about","whatToBring"]', 'about and what to bring, and nothing else');
H.ok(FIELD_SCHEMA.simple.concat(FIELD_SCHEMA.optional).filter((f) => f.rich).length === 2,
     'marked on the descriptors, so the client learns it from the schema like everything else');
H.ok(!FIELD_SCHEMA.simple.filter((f) => f.key === 'title')[0].rich, 'a title is not rich — it is one line');

console.log('\n[the server sanitises on every save, because the page prints it raw]');
H.eq(sanitiseRich('<p>Hello <strong>world</strong></p>'), '<p>Hello <strong>world</strong></p>',
     'the editor output survives untouched');
H.eq(sanitiseRich('<script>alert(1)</script><p>ok</p>'), '<p>ok</p>',
     'a script is removed WITH its text — keeping the text would paste the code into the page');
H.eq(sanitiseRich('<p onclick="steal()">x</p>'), '<p>x</p>', 'attributes are dropped');
H.eq(sanitiseRich('<a href="javascript:alert(1)">x</a>'), '<a>x</a>', 'a javascript: href is not a link');
H.eq(sanitiseRich('<a href="data:text/html,<script>">x</a>'), '<a>x</a>', 'nor a data: one');
H.eq(sanitiseRich('<a href="https://ogen.cy">x</a>'), '<a href="https://ogen.cy" rel="noopener">x</a>',
     'a real link keeps its href');
H.eq(sanitiseRich('<a href="/activities">x</a>'), '<a href="/activities" rel="noopener">x</a>', 'and a relative one');
H.eq(sanitiseRich('<img src=x onerror=y>'), '', 'an image is not on the allowlist');
H.eq(sanitiseRich('<h2>H</h2><ul><li>a</li></ul>'), '<h2>H</h2><ul><li>a</li></ul>', 'headings and lists are');
H.eq(sanitiseRich(null), '', 'and nothing is nothing');

console.log('\n[and it runs through the merge, not only where the client is polite]');
const merged = mergeByPermission(null, activity('<p onclick="x">hi</p>'),
  { permissions: { activities: { access: true, edit: ['he', 'en', 'ru'], publish: true } } });
H.eq(merged.about.he, '<p>hi</p>', 'a hostile request body is cleaned server-side');

console.log('\n[the page prints the markup]');
const rich = tpl.renderActivityPage(activity('<p>שלום</p><h2>כותרת</h2><ul><li>פריט</li></ul>', '<p>מחברת</p>'), 'he');
H.ok(rich.indexOf('<h2>כותרת</h2>') !== -1, 'a heading is a heading');
H.ok(rich.indexOf('<li>פריט</li>') !== -1, 'a list item is a list item');
H.ok(rich.indexOf('&lt;p&gt;') === -1, 'and nothing is escaped into visible tags');
H.ok(rich.indexOf('<p>מחברת</p>') !== -1, 'what to bring is rich too');

console.log('\n[a record written before the editor still reads as it did]');
// Nothing was migrated. Plain text is recognised by not starting with a tag.
const legacy = tpl.renderActivityPage(activity('פסקה ראשונה.\n\nפסקה שנייה.'), 'he');
H.ok(legacy.indexOf('<p>פסקה ראשונה.</p>') !== -1, 'blank lines still become paragraphs');
H.ok(legacy.indexOf('<p>פסקה שנייה.</p>') !== -1, 'both of them');
const dangerous = tpl.renderActivityPage(activity('a < b & c'), 'he');
H.ok(dangerous.indexOf('a &lt; b &amp; c') !== -1, 'and plain text is still ESCAPED, not printed as markup');

console.log('\n[places that take text strip the markup]');
const withMarkup = activity('<p>במרכז עוגן אנחנו מזמינים ילדים</p><h2>מה לומדים</h2>');
const page = tpl.renderActivityPage(withMarkup, 'he');
const desc = /name="description" content="([^"]*)"/.exec(page)[1];
H.eq(desc, 'במרכז עוגן אנחנו מזמינים ילדים מה לומדים',
     'the meta description is readable text, not escaped tags');
H.ok(desc.indexOf('&lt;') === -1 && desc.indexOf('<') === -1, 'with no markup in it at all');
const og = /og:description" content="([^"]*)"/.exec(page)[1];
H.eq(og, desc, 'og:description matches it');
const listing = idx.buildDerivedFiles([withMarkup]).find((f) => f.path === 'activities/index.html').content;
H.ok(/<p>במרכז עוגן אנחנו מזמינים ילדים מה לומדים<\/p>/.test(listing),
     'and the listing card blurb is text too');

console.log('\n[an empty editor is empty, not an empty paragraph]');
// Quill writes <p><br></p> for an empty editor; storing that would give an
// optional section a heading and a blank line instead of leaving it out.
H.ok(/html === '<p><br><\/p>'/.test(adminJs), 'the client treats it as empty');
H.eq(tpl.renderActivityPage(activity('<p>x</p>'), 'he').indexOf('data-optional'), -1,
     'so what to bring with nothing in it publishes no section');

console.log('\n[three editors, stacked, one per language]');
H.ok(/RICH_TOOLBAR/.test(adminJs), 'there is one toolbar definition');
['bold', 'italic', 'underline', 'header', 'list', 'link', 'clean'].forEach((tool) => {
  H.ok(adminJs.indexOf("'" + tool + "'") !== -1 || adminJs.indexOf(tool + ':') !== -1,
       'the toolbar offers ' + tool);
});
H.ok(/class: 'rich-stack'/.test(adminJs), 'the languages go in a stack');
const css = fs.readFileSync(path.join(R, 'admin/admin.css'), 'utf8');
H.ok(/\.rich-stack\{[^}]*flex-direction:column/.test(css), 'and the stack is vertical, not a row');
H.ok(/quill\.snow\.min\.css/.test(adminHtml) && /quill\.min\.js/.test(adminHtml), 'Quill is loaded');

console.log('\n[a CDN that does not load costs formatting, not editing]');
H.ok(/descriptor\.rich && window\.Quill/.test(adminJs),
     'without Quill a rich field falls back to the plain textarea it used to be');

console.log('\n[the editor is where the value is read from]');
H.ok(/if \(S\.editors\[id\]\) \{ out\[lang\] = editorHtml\(S\.editors\[id\]\); return; \}/.test(adminJs),
     'readLangField asks the editor, not an input that does not exist');
H.ok(/S\.editors = \{\};/.test(adminJs), 'and the registry is rebuilt with the form, never stale');

H.done();
