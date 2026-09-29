// What this defends against:
//
// ⚠ A HEADING THE EDITOR SHOWED WAS TURNED INTO ORDINARY PROSE ON SAVE.
//
// Reported as "we also need to add options for H3 and H4 in the wysiwyg", with a
// screenshot of the Russian About editor holding a properly formatted document —
// a large title, a section heading, a subsection — pasted from a rendered
// ChatGPT reply, so the clipboard carried real HTML and Quill converted it
// natively into <h1>, <h2> and <h3>.
//
// ⚠ AND sanitiseRich() WOULD HAVE EATEN TWO OF THE THREE. Its allowlist held h2
// and h3, and an unlisted tag is STRIPPED WITH ITS TEXT KEPT — right for a
// <span>, and silent destruction for a heading: the words survive as a bare text
// node and the page publishes somebody's section title as a sentence. Measured
// against the real function before anything changed:
//
//     h1 -> "Взросление, поиск себя"      (the tag, gone)
//     h4 -> "Подраздел"                   (the tag, gone)
//
// Nearly every document pasted into this editor opens with a `# Title`, which is
// an <h1> on the clipboard — so that was the commonest heading of all and the one
// certain to be thrown away. Invisible in the editor, because the editor shows it
// correctly right up until Save.
//
// ⚠ AND THE SECOND HALF WAS ALREADY LIVE. `.activity-main` styled ONLY h2, while
// FIVE published activities carried TWENTY-NINE <h3> headings between them —
// every one of them rendering at the browser's default size and colour in the
// middle of designed copy. A class nobody styled is a layout nobody designed,
// which this stylesheet had already paid for once.
//
// So three things that had agreed with each other all moved together: the
// allowlist clamps rather than filters, the page styles h2/h3/h4, and the
// toolbar offers all three. The Markdown converter stopped flattening every
// level onto h2 in the same pass — that half is pinned in
// markdown-arrives-on-the-clipboard-not-in-the-record.js.
//
// ⚠ THE CLAMP IS THE INTERESTING CHOICE. h1 becomes h2 rather than being allowed:
// rule 3 permits exactly one <h1> per page and .page-header already has it. h5
// and h6 become h4, the deepest level the page styles. A LEVEL is lost; a HEADING
// never is.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const { sanitiseRich, RICH_TAGS } = require(H.fnPath('_sanitise-rich'));
const { migrate } = require(H.fnPath('_activity-migrate'));

// =========================================================================
console.log('[⚠ no heading is ever demoted to prose]');

// The accepting half first: the levels the page can render survive untouched.
['h2', 'h3', 'h4'].forEach((t) => {
  H.eq(sanitiseRich('<' + t + '>Заголовок</' + t + '>'), '<' + t + '>Заголовок</' + t + '>',
    t + ' is kept exactly as written');
});

// And the ones it cannot render are CLAMPED, never dropped.
H.eq(sanitiseRich('<h1>Взросление</h1>'), '<h2>Взросление</h2>',
  '⚠ h1 BECOMES h2 — rule 3 allows one h1 per page and .page-header has it. It ' +
  'used to come back as the bare text "Взросление", which is the reported bug');
H.eq(sanitiseRich('<h5>D</h5>'), '<h4>D</h4>', 'h5 lands on the floor');
H.eq(sanitiseRich('<h6>E</h6>'), '<h4>E</h4>', 'and so does h6');

// ⚠ THE PROPERTY, rather than the six cases: nothing that arrived as a heading
// may come back without one. A seventh level added to HTML would inherit this.
['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].forEach((t) => {
  const out = sanitiseRich('<' + t + '>Слово</' + t + '>');
  H.ok(/^<h[234]>Слово<\/h[234]>$/.test(out),
    '⚠ ' + t + ' survives AS A HEADING: ' + out);
});

// The closing tag is renamed with the opening one, or the markup is broken in a
// way the page renders as a run-on.
H.eq(sanitiseRich('<h1>A</h1><h5>B</h5>'), '<h2>A</h2><h4>B</h4>',
  'open and close are clamped together');
H.eq(sanitiseRich('<h1>A<strong>b</strong></h1>'), '<h2>A<strong>b</strong></h2>',
  'and what is inside a clamped heading is untouched');

// ⚠ AND CLAMPING IS FOR HEADINGS ONLY. Everything else still loses its tag and
// keeps its text, which is what the allowlist is for.
H.eq(sanitiseRich('<span style="x">plain</span>'), 'plain', 'a span is still stripped');
H.eq(sanitiseRich('<div>d</div>'), 'd', 'and so is a div');
H.eq(sanitiseRich('<script>alert(1)</script>'), '', 'and a script goes whole');
H.ok(RICH_TAGS.indexOf('h4') !== -1, 'h4 is on the allowlist');
H.eq(RICH_TAGS.indexOf('h1'), -1, '⚠ and h1 is NOT — it is renamed, never admitted');
H.eq(RICH_TAGS.indexOf('h5'), -1, 'nor h5');

// =========================================================================
console.log('\n[⚠ the page styles every level it accepts]');

const css = read('shared.css').replace(/\/\*[\s\S]*?\*\//g, '');
['h2', 'h3', 'h4'].forEach((t) => {
  const rules = css.match(new RegExp('\\.activity-main ' + t + '\\s*\\{[^}]*\\}', 'g')) || [];
  H.eq(rules.length, 1,
    '⚠ exactly ONE .activity-main ' + t + ' rule — so the three cannot be split ' +
    'across a media query and the size ladder cannot come apart');
  H.ok(/font-size:\s*\d/.test(rules[0]), t + ' is given a size: ' + rules[0].trim());
  H.ok(/color:/.test(rules[0]), 'and a colour, or it falls back to the body ink');
});

// The ladder descends. Equal sizes would make the toolbar offer a distinction
// nobody can see on the page.
const sizeOf = (t) => Number(
  /font-size:\s*(\d+(?:\.\d+)?)px/.exec(
    css.match(new RegExp('\\.activity-main ' + t + '\\s*\\{[^}]*\\}'))[0])[1]);
H.ok(sizeOf('h2') > sizeOf('h3'), 'h2 is larger than h3 (' + sizeOf('h2') + ' > ' + sizeOf('h3') + ')');
H.ok(sizeOf('h3') > sizeOf('h4'), 'h3 is larger than h4 (' + sizeOf('h3') + ' > ' + sizeOf('h4') + ')');
// And h4 must still read as a heading rather than as a bold sentence.
const bodySize = Number(/\.activity-main p\{[^}]*font-size:\s*(\d+)px/.exec(css)[1]);
H.ok(sizeOf('h4') >= bodySize, 'h4 is not smaller than body text (' + sizeOf('h4') + ' >= ' + bodySize + ')');

// =========================================================================
console.log('\n[⚠ and the editor shows the same three levels]');
// A toolbar offering a distinction the writer cannot see is worse than not
// offering it: they pick a level, nothing visibly changes, and they pick again.
const admin = read('admin/admin.css').replace(/\/\*[\s\S]*?\*\//g, '');
['h2', 'h3', 'h4'].forEach((t) => {
  H.ok(new RegExp('\\.quill-wrap \\.ql-editor ' + t + '\\s*\\{[^}]*font-size').test(admin),
    'the editor sizes ' + t);
});
const eSize = (t) => Number(/font-size:\s*(\d+(?:\.\d+)?)px/.exec(
  admin.match(new RegExp('\\.quill-wrap \\.ql-editor ' + t + '\\s*\\{[^}]*\\}'))[0])[1]);
H.ok(eSize('h2') > eSize('h3') && eSize('h3') > eSize('h4'),
  'in the same descending order as the page, so the editor does not lie');

// =========================================================================
console.log('\n[⚠ the toolbar offers all three, and only these three]');
const ui = read('js/activities-admin.js');
const bar = ui.slice(ui.indexOf('var RICH_TOOLBAR = ['), ui.indexOf('var PLACEHOLDER'));
[2, 3, 4].forEach((n) => {
  H.ok(new RegExp('\\{ header: ' + n + ' \\}').test(bar), 'H' + n + ' is on the toolbar');
});
H.eq(/\{ header: 1 \}/.test(bar), false,
  '⚠ and H1 is not offered — the page already has its one h1 in .page-header');
H.eq(/\{ header: 5 \}/.test(bar) || /\{ header: 6 \}/.test(bar), false,
  'nor a level the page does not style');

// ⚠ THE TOOLBAR AND THE ALLOWLIST MUST AGREE. A level a writer can press and the
// server then clamps is the reported bug with the button added.
const offered = (bar.match(/\{ header: (\d) \}/g) || []).map((m) => 'h' + m.match(/\d/)[0]);
offered.forEach((t) => {
  H.ok(RICH_TAGS.indexOf(t) !== -1, t + ' is offered AND allowed through unchanged');
  H.eq(sanitiseRich('<' + t + '>x</' + t + '>'), '<' + t + '>x</' + t + '>',
    'and survives the server as itself');
});

// =========================================================================
console.log('\n[⚠ the email renders them too]');
// sanitiseRich has a second caller: the rejection draft, whose markup reaches an
// inbox with no stylesheet, so the shell applies the spacing. A level it does not
// know renders at the mail client's default in the middle of ours.
const shell = read('netlify/functions/_email-shell.js');
const styled = shell.slice(shell.indexOf('const EMAIL_STYLE'), shell.indexOf('};', shell.indexOf('const EMAIL_STYLE')));
['h2', 'h3', 'h4'].forEach((t) => {
  H.ok(new RegExp('\\b' + t + ':').test(styled), 'the email shell styles ' + t);
});

// =========================================================================
console.log('\n[⚠ on the REAL records: the headings that were already live]');
// The point of the CSS half. These were on the site, unstyled, before any of
// this — so the count is asserted on the repository rather than on a fixture.
let h3s = 0;
let files = 0;
fs.readdirSync(path.join(R, 'activities'))
  .filter((f) => f.endsWith('.json') && f !== 'activities-index.json')
  .forEach((f) => {
    const r = migrate(JSON.parse(read('activities/' + f)));
    const n = ['he', 'en', 'ru']
      .reduce((a, l) => a + (String((r.about || {})[l] || '').match(/<h3\b/g) || []).length, 0);
    if (n) { h3s += n; files += 1; }
  });
H.ok(h3s >= 20 && files >= 4,
  '⚠ ' + h3s + ' <h3> headings across ' + files + ' published activities were ' +
  'rendering at the browser default until this — which is why the rule matters ' +
  'more than the toolbar button that prompted it');

// And every heading any published record holds is one the page now styles.
const styledLevels = ['h2', 'h3', 'h4'];
fs.readdirSync(path.join(R, 'activities'))
  .filter((f) => f.endsWith('.json') && f !== 'activities-index.json')
  .forEach((f) => {
    const r = migrate(JSON.parse(read('activities/' + f)));
    ['he', 'en', 'ru'].forEach((l) => {
      const found = String((r.about || {})[l] || '').match(/<(h[1-6])\b/g) || [];
      found.forEach((m) => {
        const t = m.slice(1);
        H.ok(styledLevels.indexOf(t) !== -1,
          f + ' (' + l + ') holds a ' + t + ', which the page styles');
      });
    });
  });

H.done();
