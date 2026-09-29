// What this defends against:
//
// ⚠ MARKDOWN PASTED INTO THE ABOUT EDITOR SAT THERE AS `#` AND `**`.
//
// Reported as "what happened?" over a Russian body reading
// `# Взросление … ## О чём мы будем … ### Мой год …` — literal hashes and
// asterisks in one run-on paragraph — with "when I entered the EN text, in the
// same format, I didn't have an issue."
//
// ⚠ NOTHING WAS BROKEN AND NOTHING WAS LOST, which is the half worth keeping.
// `activities/bnei-mitzvah-2027.json` held proper HTML in all three languages and
// the live Russian page rendered real <h3>s. Quill has never understood Markdown
// and nothing in this admin converted it. The English differed because of what
// was on the CLIPBOARD rather than what was typed: copy from something rendered
// and it carries `text/html`, which Quill turns into real headings and bold; copy
// from a plain-text view — a .md file, a code block, a "copy raw" — and it
// carries only `text/plain`, so the characters arrive as characters.
//
// ⚠ IT RUNS ON A PASTE AND NEVER ON A STORED VALUE. That is the whole safety
// argument and it is the first thing asserted below. toEditorHtml() reads EVERY
// record on the way into the editor, and whatever it decides comes back out of
// `root.innerHTML` on the next save and BECOMES the record — which is exactly how
// a guess about leading tags ate three activities' bodies in eight language slots
// (see an-editor-that-escaped-what-it-could-not-recognise.js). A `#` at the start
// of a stored sentence must never be seen by any of this.
//
// ⚠ AND THE INTERESTING HALF IS WHAT IT REFUSES. The reported paste had lost its
// line breaks before it reached the clipboard: thousands of characters on one
// line beginning `#`, with `##` and `###` stranded mid-sentence. A line-based
// reader honours the first marker and wraps the WHOLE document in one heading,
// which is worse than leaving it alone.
//
// Verified in real Chrome over CDP with a real clipboard and a real Ctrl+V,
// because that is the only place a paste exists — and it found two faults no
// amount of reading could have: Quill's `matchSpacing` invents a blank line
// between a <p> and an <h2> by MEASURING them in a hidden div, and a document
// pasted at the end of a line merged its first heading into that line. The first
// is why this builds a Delta rather than handing Quill HTML; the second is the
// `lead` newline. What is executed here is the pure half: the rules that decide
// what becomes what, and what is left alone.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_helpers');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const ui = read('js/activities-admin.js');

// =========================================================================
console.log('[⚠ the paste is the ONLY door — a stored value never reaches it]');

const code = ui.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
// toEditorHtml() is the function that reads every record into the editor. It may
// not call any of this, now or after somebody tidies up.
// ⚠ TO ITS OWN CLOSING BRACE, not to the next function. The markdown helpers sit
// between toEditorHtml and editorHtml in the file, so slicing between the two
// names swallows all of them and the check below passes on anything.
const tStart = code.indexOf('function toEditorHtml(value)');
const toEditor = code.slice(tStart, code.indexOf('\n  }\n', tStart));
H.ok(toEditor.length > 40, 'toEditorHtml is still there');
['mdBlocks', 'mdRuns', 'mdDelta', 'wireMarkdownPaste'].forEach((fn) => {
  H.eq(toEditor.indexOf(fn), -1,
    '⚠ toEditorHtml does not call ' + fn + ' — a heuristic on a STORED value is ' +
    'the one that round-trips through Quill and becomes the record');
});
H.eq((code.match(/mdBlocks\(/g) || []).length, 2,
  'mdBlocks is defined once and called once');
const caller = code.slice(code.indexOf('function wireMarkdownPaste'),
                          code.indexOf('function withHelp'));
H.ok(/addEventListener\('paste'/.test(caller),
  '⚠ and its one caller is a paste handler');
H.ok(/getData\('text\/plain'\)/.test(caller),
  'reading the clipboard, which is the only place unstored text comes from');
H.eq((code.match(/wireMarkdownPaste\(/g) || []).length, 2,
  'wired in exactly one place');
H.ok(/if \(spec\.editable\) wireMarkdownPaste/.test(code),
  '⚠ and only on an editable editor — a read-only one takes no paste, and wiring ' +
  'it would be a second place the readOnly decision has to be remembered');

// ⚠ CAPTURE, ON THE CONTAINER. Quill binds its own paste handler to q.root at
// construction and opens with `if (e.defaultPrevented) return;` — but two
// listeners on the SAME node fire in registration order whatever their capture
// flag says, and Quill's was registered first. A capture listener on the parent
// runs before any listener on the target, which is what lets preventDefault()
// reach it at all.
H.ok(/host\.addEventListener\('paste', function \(e\) \{[\s\S]*?\}, true\);/.test(caller),
  '⚠ registered in the CAPTURE phase, or Quill has already consumed the event');
H.ok(/wireMarkdownPaste\(q, spec\.host\)/.test(code),
  'on the container rather than on q.root, which is where Quill\'s own listener is');

// =========================================================================
console.log('\n[the rules, executed]');

const slice = (name) => {
  const at = ui.indexOf('  function ' + name + '(');
  if (at === -1) throw new Error('no function ' + name);
  return ui.slice(at, ui.indexOf('\n  }\n', at) + 4);
};
const vars = ui.slice(ui.indexOf('  var MD_HEAD ='), ui.indexOf('  function mdRuns'));
const ctx = { out: null };
vm.createContext(ctx);
vm.runInContext(vars + slice('mdTag') + slice('mdRuns') + slice('mdBlocks') +
  '\nout = { mdBlocks: mdBlocks, mdRuns: mdRuns, MD_HEAD_MAX: MD_HEAD_MAX };', ctx);
const md = ctx.out.mdBlocks;
const shape = (blocks) => (blocks || []).map((b) =>
  b.tag + ':' + b.runs.map((r) => (r.bold ? '*' : '') + r.text).join('|')).join(' / ');

H.eq(shape(md('# Title')), 'h2:Title', 'a heading');

// ⚠ THE LEVEL SURVIVES THE PASTE, WHERE IT USED TO BE FLATTENED. Every heading
// became an h2, because the toolbar offered one level, sanitiseRich() allowed h2
// and h3, and .activity-main styled only h2 — three constraints that agreed with
// each other and threw away the hierarchy of every document pasted in. All three
// moved together, so the mapping is asserted here AND the three things it
// depends on are asserted below, or this quietly becomes a lie again.
H.eq(shape(md('## Section')), 'h3:Section', '`##` is one level down');
H.eq(shape(md('### Deep')), 'h4:Deep', 'and `###` one more');
H.eq(shape(md('#### Deeper')), 'h4:Deeper',
  '⚠ AND h4 IS THE FLOOR rather than a refusal — a deeper level is a real thing ' +
  'to write and the page has nowhere to put it, so it is clamped exactly as ' +
  'sanitiseRich() clamps h5 and h6');
H.eq(shape(md('###### Six')), 'h4:Six', 'six hashes land on the floor too');
H.eq(shape(md('# A\n\n## B\n\n### C')), 'h2:A / h3:B / h4:C',
  'and a whole document keeps its shape');
H.eq(md('#NoSpace'), null, 'a hash with no space after it is not a heading');
H.eq(shape(md('# T\n\nbody')), 'h2:T / p:body', 'a heading and a paragraph');
H.eq(shape(md('# T\n\n- a\n- b')), 'h2:T / li:a / li:b', 'bullets');
H.eq(shape(md('* a\n+ b\n- c')), 'li:a / li:b / li:c', 'in any of the three markers');
H.eq(shape(md('# T\n\nsome **bold** here')), 'h2:T / p:some |*bold| here',
  'bold inside a paragraph, split into runs');
H.eq(shape(md('# **Bold title**')), 'h2:*Bold title', 'and inside a heading');
H.eq(shape(md('a **one** b **two** c')), 'p:a |*one| b |*two| c',
  'more than one bold run on a line');

// ⚠ A SINGLE NEWLINE INSIDE A PARAGRAPH IS A SPACE, which is what Markdown says
// and deliberately NOT what toEditorHtml() does with a stored value: there a lone
// newline is a break an admin typed on purpose, here it is where the prose
// happened to be wrapped when it was copied.
H.eq(shape(md('# T\n\nline one\nline two')), 'h2:T / p:line one line two',
  'a wrapped paragraph is rejoined');
H.eq(shape(md('# T\n\none\n\n\n\ntwo')), 'h2:T / p:one / p:two',
  'and any number of blank lines is one break');
H.eq(shape(md('  ## Indented')), 'h3:Indented', 'up to three spaces of indent is still a marker');

console.log('\n[⚠ and what it refuses, which is the half that matters]');
H.eq(md(''), null, 'nothing');
H.eq(md('   \n  '), null, 'whitespace');
H.eq(md('Just a sentence.'), null,
  '⚠ ORDINARY PROSE IS LEFT TO QUILL — no marker, no conversion, and today\'s ' +
  'behaviour is untouched for every paste that is not Markdown');
H.eq(md('One paragraph.\n\nAnother one.'), null, 'and so is ordinary prose in paragraphs');
H.eq(md('5 * 3 is 15'), null, 'a lone asterisk mid-sentence is arithmetic, not a bullet');
H.eq(md('a ** b'), null, 'and a lone double asterisk with no closing pair is not bold');

// ⚠ THE REPORTED PASTE. A document whose line breaks were lost before it reached
// the clipboard: one line beginning `#`, with the other markers stranded
// mid-sentence. Honouring the first marker would wrap the whole thing in one
// heading, which is worse than leaving it alone — so the answer is
// whole-document "nothing converted" rather than a half-converted body somebody
// has to unpick.
const flat = '# Взросление, поиск себя и своего места в мире Бар- и Бат-мицва ' +
  'становятся важным событием в жизни подростка. '.repeat(20) +
  '## О чём мы будем говорить? ### Мой год Бар-мицвы';
H.ok(flat.length > 800, 'the flattened fixture is a whole document on one line');
H.eq(md(flat), null,
  '⚠ A FLATTENED DOCUMENT IS REFUSED WHOLE — the first marker would otherwise ' +
  'swallow every word after it into a single heading');
H.eq(shape(md('# ' + 'x'.repeat(ctx.out.MD_HEAD_MAX - 2))).indexOf('h2:'), 0,
  'a heading right up to the limit still converts');
H.eq(md('# ' + 'x'.repeat(ctx.out.MD_HEAD_MAX + 5)), null, 'one past it does not');
H.eq(md('# Short\n\nbody\n\n# ' + 'x'.repeat(ctx.out.MD_HEAD_MAX + 5)), null,
  '⚠ and ONE over-long heading refuses the WHOLE paste — a half-converted ' +
  'document is worse than an unconverted one, because nobody can see which half');

console.log('\n[⚠ the text is text, and stays text]');
// These become Delta INSERTS, which carry text. Escaping here would publish
// `5 &lt; 10` — the exact damage an-editor-that-escaped-what-it-could-not-
// recognise.js is named for, arriving from the other end.
H.eq(shape(md('# 5 < 10 & rising')), 'h2:5 < 10 & rising',
  'angle brackets and ampersands are characters, never escaped on the way in');
H.eq(shape(md('# T\n\na **5 < 10** b')), 'h2:T / p:a |*5 < 10| b',
  '⚠ INSIDE A BOLD RUN TOO — a bite-check found this suite checking only the ' +
  'plain half, so an escape added to the bold branch alone went unseen');
const runs = ctx.out.mdRuns;
H.eq(JSON.stringify(runs('<p>hello</p>')), JSON.stringify([{ text: '<p>hello</p>', bold: false }]),
  'and nothing here writes markup');
H.eq(JSON.stringify(runs('**<b>x</b>**')), JSON.stringify([{ text: '<b>x</b>', bold: true }]),
  'in either branch');

console.log('\n[⚠ a rich clipboard wins, which is what kept the English working]');
const richRe = new RegExp(
  ui.slice(ui.indexOf('var MD_RICH_HTML = /') + 'var MD_RICH_HTML = /'.length,
           ui.indexOf('/i;\n', ui.indexOf('var MD_RICH_HTML = /'))), 'i');
H.ok(richRe.test('<p>a <strong>real</strong> doc</p>'), 'real formatting is recognised');
H.ok(richRe.test('<h3>heading</h3>'), 'a heading is');
H.ok(richRe.test('<meta charset="utf-8"><b style="font-weight:normal"><span>x</span></b>'),
  'and so is the shape a word processor pastes');
H.eq(richRe.test('<div><span style="color:#000">#&nbsp;Title</span></div>'), false,
  '⚠ while a plain-text copy\'s HTML flavour — <div>s and <span style>s carrying ' +
  'no formatting at all — is NOT, so the Markdown in the plain flavour is read');
H.eq(richRe.test('<p>plain</p><br>'), false,
  'p and br alone say nothing the plain flavour does not');
// ⚠ AND THE HANDLER HAS TO ASK IT. A bite-check deleting this one line left
// every assertion above passing: a regex nothing consults is a rule nobody keeps,
// and the paste would have overridden the rich flavour the English relies on.
H.ok(/if \(MD_RICH_HTML\.test\(rich\)\) return;/.test(caller),
  '⚠ and the paste handler RETURNS on it, before it looks at the plain text');
H.ok(caller.indexOf('MD_RICH_HTML') < caller.indexOf("getData('text/plain')"),
  'asked before the plain flavour is even read');

console.log('\n[⚠ and the Delta is built, not handed to Quill as HTML]');
const delta = code.slice(code.indexOf('function mdDelta(blocks)'),
                         code.indexOf('var MD_RICH_HTML'));
H.eq(code.indexOf('dangerouslyPasteHTML'), -1,
  '⚠ NOTHING CALLS dangerouslyPasteHTML. Handing Quill a string runs it back ' +
  'through matchSpacing, which decides whether two blocks were separated in the ' +
  'source by MEASURING them — and invented an empty paragraph between every <p> ' +
  'and the <h2> after it. Read out of a browser: `<p>a</p><h2>B</h2>` converts ' +
  'to `a\\n\\n` plus the heading');
H.ok(/header:/.test(delta) && /list: 'bullet'/.test(delta),
  'the block attributes are named outright');

// ⚠ AND THE DELTA IS EXECUTED, not read. This assertion used to match the
// literal `header: 2` in the source — which was true, and was also exactly the
// flattening that threw away every pasted document's hierarchy, so the check
// agreed with the bug. A stub Delta records what the function actually inserts.
function FakeDelta() { this.ops = []; }
FakeDelta.prototype.insert = function (text, attrs) {
  this.ops.push({ text: text, attrs: attrs || {} });
  return this;
};
const dctx = vm.createContext({ window: { Quill: { import: () => FakeDelta } } });
vm.runInContext(vars + slice('mdTag') + slice('mdRuns') + slice('mdBlocks') + slice('mdDelta') +
  '\nout = { mdBlocks: mdBlocks, mdDelta: mdDelta };', dctx);
const levels = (text) => dctx.out.mdDelta(dctx.out.mdBlocks(text)).ops
  .filter((o) => o.text === '\n')
  .map((o) => (o.attrs.header ? 'h' + o.attrs.header
             : o.attrs.list ? o.attrs.list : 'p')).join(' ');

H.eq(levels('# A\n\nbody\n\n## B\n\n### C\n\n- x'), 'h2 p h3 h4 bullet',
  '⚠ THE DELTA CARRIES THREE DIFFERENT HEADER LEVELS — the thing the old ' +
  'source-matching assertion could never have seen');
H.eq(levels('#### D\n\n###### F'), 'h4 h4', 'and clamps at four');
H.ok(/bold: true/.test(delta), 'and so is bold');
H.ok(/q\.getLength\(\) <= 1/.test(caller),
  '⚠ an EMPTY editor is setContents\'d rather than inserted into, or Quill\'s own ' +
  'document terminator is left behind as a trailing empty paragraph — which ' +
  'sanitiseRich keeps and the page renders as dead space');
H.ok(/q\.getText\(range\.index - 1, 1\) === '\\n'/.test(caller),
  '⚠ and a paste that is not at a line start gets a leading newline, or the first ' +
  'block merges into the line the cursor was in: "## Added" at the end of ' +
  '"Existing." produced the single heading "Existing.Added"');

console.log('\n[the pasted markup survives the server untouched]');
const { sanitiseRich } = require(H.fnPath('_sanitise-rich'));
// ⚠ THE TAGS COME FROM mdTag ITSELF, not from a fixture somebody typed. The
// hardcoded version held only an h2, so when the converter learned h3 and h4 it
// went on passing while h4 was still being stripped to bare text on save.
const produced = [1, 2, 3, 4, 5, 6].map((n) => dctx.out.mdBlocks('#'.repeat(n) + ' X')[0].tag);
H.eq(produced.join(','), 'h2,h3,h4,h4,h4,h4', 'the converter produces exactly these');
const fromEditor = produced.filter((t, i) => produced.indexOf(t) === i)
  .map((t) => '<' + t + '>З</' + t + '>').join('') +
  '<p>Текст <strong>жирный</strong>.</p><ul><li>раз</li><li>два</li></ul>';
H.eq(sanitiseRich(fromEditor), fromEditor,
  'every tag this can produce is on the allowlist, so nothing is stripped on save');

H.done();
