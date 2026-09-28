// What this defends against:
//
// Reported as "HTML in the admin area" — the About editor printing `<p>` and
// `<strong>` as literal text. It was live on the public site too: every visitor
// to /en/activities/beit-midrash was served `&lt;/strong&gt;` in the body copy.
//
// ⚠ AND THE RECORD WAS ALREADY DESTROYED. This was not a rendering fault that a
// fix could undo — `activities/beit-midrash.json` literally held
// `<p>The Bible, Big Questions and a Different Perspective&lt;p&gt;We are proud…`.
//
// The cause is one regex asked the wrong question. `RICH_START` tested whether a
// value STARTED with a block tag, to tell rich text from the plain text that
// predates the editor. That is wrong for a shape which turns up constantly: a
// pasted document whose first line is a bare title, then paragraphs. All six
// damaged values have exactly that shape, and the three undamaged ones start
// with `<h3>` or `<p>`.
//
// ⚠ THE SERVER'S COPY OF THE GUESS IS COSMETIC AND THE CLIENT'S IS FATAL, which
// is the part worth keeping. In _activity-template.js a wrong guess prints tags
// at a reader for one page load and the record is untouched. In
// js/activities-admin.js the escaped text is loaded into Quill, comes back out
// of `root.innerHTML` on the next save, and IS THE RECORD from then on. Three
// published activities lost their bodies in eight language slots that way.
//
// So the question is now "does this contain markup at all", which makes the
// escaping branch unreachable for anything there is to destroy. The twelve
// damaged values were repaired by an exact unescape — checked reversible, so the
// repair restores what the admin actually typed rather than a reconstruction.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const T = require(H.fnPath('_activity-template'));
const template = read('netlify/functions/_activity-template.js');
const client = read('js/activities-admin.js');

// ---------------------------------------------------------------------------
console.log('[the two copies of the rule are the same rule]');

// A browser cannot require a Netlify function, so this regex exists twice —
// like MIN_PASSWORD and the activities menu's status groups. The client's copy
// is the one that can destroy a record, so the pin is not a tidiness rule.
const grab = (src) => {
  const m = /RICH_MARKUP = (\/.*\/i);/.exec(src);
  return m ? m[1] : null;
};
const onServer = grab(template);
const onClient = grab(client);
H.ok(onServer, 'the template declares one');
H.ok(onClient, 'and so does the admin client');
H.eq(onClient, onServer, '⚠ character for character, or the editor and the page disagree');

// ⚠ AND IT LOOKS AT THE WHOLE VALUE. A rule anchored at the start is the bug,
// so this is checked by SHAPE rather than by matching the fix: an anchored
// regex is what escaped a document because of its first six characters.
H.ok(!/^\/\^/.test(onServer) && onServer.indexOf('(^') === -1,
  '⚠ not anchored — "starts with a tag" is the question that destroyed the records');

// ---------------------------------------------------------------------------
console.log('\n[what it decides, executed]');

// The shape that was damaged, and the shapes that must not start being damaged.
const MIXED = 'The Bible, Big Questions<p>We are proud to invite <strong>Yifat</strong>.</p>';
const cases = [
  ['a bare title then paragraphs', MIXED, true],
  ['clean rich text', '<h3>Title</h3><p>Body</p>', true],
  ['a lone link', 'See <a href="/x">here</a>', true],
  ['a lone break', 'line<br>break', true],
  ['plain prose in two paragraphs', 'One.\n\nTwo.', false],
  ['prose with a stray angle bracket', 'Ages 5<10 are welcome', false],
  ['prose comparing numbers', 'when x < y and y > z', false]
];
// richText() is not exported, so the decision is read off the rendered page —
// which is also the only place it matters. A value treated as markup appears
// VERBATIM; one treated as prose is rewritten into escaped paragraphs.
cases.forEach((c) => {
  const verbatim = renderAbout(c[1]).indexOf(c[1]) !== -1;
  H.eq(verbatim, c[2],
    c[0] + ': ' + (c[2] ? 'passes through as markup' : 'is rewritten as prose'));
});

function renderAbout(about) {
  const F = require('./_fixtures');
  const a = F.course({ slug: 'x', activityId: 'act-0000000000000abc' });
  a.about = { he: about, en: about, ru: about };
  return T.renderActivityPage(a, 'en');
}

// ⚠ AND PROSE STILL BECOMES PARAGRAPHS. The escaping branch is not dead code —
// every record written before the editor existed goes through it, and dropping
// it would publish a wall of text with the blank lines gone.
H.ok(/<p>One\.<\/p>/.test(renderAbout('One.\n\nTwo.')),
  'plain text is still split into paragraphs the way it always was');

// ---------------------------------------------------------------------------
console.log('\n[⚠ the round trip, which is where the damage happened]');

// The client converts on the way IN to Quill and Quill hands back
// `root.innerHTML` on the way out — so a value the conversion rewrites is a
// value the next save overwrites. Nothing about that is visible on a screen.
// The guarantee is therefore not "the guess is better" but "the branch that
// rewrites cannot reach anything holding markup".
const toEditorHtml = extractToEditorHtml();
H.eq(toEditorHtml(MIXED), MIXED,
  '⚠ markup goes into the editor untouched, so a save cannot escape it');
H.eq(toEditorHtml('<h3>T</h3><p>B</p>'), '<h3>T</h3><p>B</p>', 'and so does clean rich text');
H.eq(toEditorHtml('One.\n\nTwo.'), '<p>One.</p><p>Two.</p>',
  'while genuine prose is still converted');
H.eq(toEditorHtml('5 < 10'), '<p>5 &lt; 10</p>',
  'and prose with an angle bracket is escaped, which is correct for prose');

// The function is inside an IIFE in a browser script, so it is lifted out with
// its own regex rather than re-implemented — re-implementing it here would test
// this file's idea of the rule instead of the one that ships.
function extractToEditorHtml() {
  const at = client.indexOf('function toEditorHtml(');
  H.ok(at !== -1, 'the client has one conversion');
  const body = client.slice(at, client.indexOf('\n  }', at) + 4);
  return new Function('RICH_MARKUP', body + '; return toEditorHtml;')(eval(onClient));
}

// ---------------------------------------------------------------------------
console.log('\n[⚠ and no record holds escaped markup any more]');

// The data assertion, which is the one that would have caught this at all. An
// `&lt;p&gt;` in a stored body is the bug by definition: nobody types that.
const slugs = fs.readdirSync(path.join(R, 'activities'))
  .filter((f) => f.endsWith('.json') && f !== 'activities-index.json');
H.ok(slugs.length > 5, slugs.length + ' published records to check');
const bad = [];
slugs.forEach((f) => {
  const rec = JSON.parse(read('activities/' + f));
  Object.keys(rec.about || {}).forEach((lang) => {
    if (/&lt;\/?(p|h[1-6]|strong|em|ul|ol|li|br|a)[\s&>]/i.test(rec.about[lang] || '')) {
      bad.push(f + ' ' + lang);
    }
  });
});
H.eq(bad.length, 0, '⚠ no stored About holds an escaped tag' + (bad.length ? ': ' + bad.join(', ') : ''));

// And the same, on what a reader is actually served.
const pages = [];
['', 'en/', 'ru/'].forEach((tree) => {
  const dir = path.join(R, tree + 'activities');
  fs.readdirSync(dir).filter((f) => f.endsWith('.html') && f !== 'index.html')
    .forEach((f) => pages.push(tree + 'activities/' + f));
});
const leaking = pages.filter((p) => /&lt;\/?(p|h[1-6]|strong|em|ul|ol|li|br)[\s&>]/i.test(read(p)));
H.eq(leaking.length, 0,
  '⚠ and no generated page prints a tag at the reader' +
  (leaking.length ? ': ' + leaking.slice(0, 4).join(', ') : ''));

H.done();
