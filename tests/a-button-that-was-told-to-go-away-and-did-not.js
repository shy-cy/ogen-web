// What this defends against:
//
// A family opened /account/activity?register=<slug> for a child who was ALREADY
// REGISTERED, and read a panel saying so — the option marked "כבר רשום/ה", the
// tinted block explaining there is nothing to do here, the link to the
// registration they already have — with a live terracotta REGISTER BUTTON
// underneath it. Reported from a phone: "if the child is already registered,
// why is there a registration button?"
//
// ⚠ THE CLIENT WAS RIGHT AND HAD BEEN ALL ALONG. syncWho() does exactly what it
// says: `go.setAttribute('hidden', 'hidden')`. The button carried the attribute
// on the live site. What put it back on screen was the STYLESHEET.
//
// `[hidden]{display:none}` is the BROWSER's rule and lives in the user-agent
// origin, which loses to every author rule whatever its specificity. So
// `.btn-primary{display:inline-block}` — one line, written for the hero button
// years earlier — quietly made that element unhideable, everywhere on the site,
// by the attribute whose entire meaning is "this is not relevant".
//
// ⚠ AND IT HAD BEEN PATCHED TWICE ALREADY, per class: .lang-menu carried its own
// `[hidden]{display:none}` and so did .activity-sticky, each written the day
// that element first needed hiding. Two patches for one trap is a discipline,
// and a discipline is what the third case broke — the third element to be
// hidden was the one nobody thought to patch, and it was a button on a screen
// about a child's place. One rule now, with `!important`, because `hidden` is
// not a style to be weighed against other styles.
//
// ⚠ AND THE SUITE FOR THE REPORTED BUG ASSERTED THE FIX AND PASSED THROUGH IT.
// a-form-offered-to-somebody-already-registered.js checks that the client
// contains `go.setAttribute('hidden', 'hidden')` — true, and true the whole
// time the button was visible. Reading one side proves that side is
// self-consistent and can never prove the two agree, which is this project's
// oldest lesson about tests. So this one does not match a string: it RESOLVES
// THE CASCADE for the three elements that are actually hidden, the way a
// browser would, and asserts each computes to display:none.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');

const R = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(R, 'shared.css'), 'utf8');
const client = fs.readFileSync(path.join(R, 'js/member-account.js'), 'utf8');
const activityJs = fs.readFileSync(path.join(R, 'js/activity.js'), 'utf8');
const navJs = fs.readFileSync(path.join(R, 'js/nav.js'), 'utf8');

// Comments first. This stylesheet explains itself at length, and the words
// "display:none" appear in the prose either side of the rules that do it — the
// .activity-card-image lesson, where a naive search found the explanation and
// passed whether or not the declaration was still there.
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');

// ---------------------------------------------------------------------------
// A cascade, small enough to be obviously right.
//
// Every `display` declaration in the stylesheet, with what a browser decides
// between them: importance first, then specificity, then source order. Rules
// inside @media are kept with the query text, so a caller says which widths it
// is asking about rather than this guessing.
function displayRules(source) {
  const out = [];
  // ⚠ ORDER IS THE CHARACTER OFFSET IN THE FILE, never a counter incremented
  // per pass. Scanning the base rules first and the @media blocks afterwards
  // would say a media rule always comes later, and this stylesheet has both
  // orders in it — .activity-sticky is declared above its query and the nav
  // wrapper below one, which is the cascade bug the nav row already shipped.
  const take = (sel, body, query, at) => {
    const d = /(^|;)\s*display\s*:\s*([^;!]+?)\s*(!important)?\s*(;|$)/.exec(body);
    if (!d) return;
    sel.split(',').forEach((one) => {
      out.push({ sel: one.trim(), value: d[2].trim(), important: !!d[3],
                 query: query, order: at });
    });
  };
  const re = /@media([^{]+)\{((?:[^{}]|\{[^{}]*\})*)\}|([^{}@]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(source))) {
    if (m[3] !== undefined) { take(m[3].trim(), m[4], null, m.index); continue; }
    const query = m[1].trim();
    const inner = /([^{}@]+)\{([^{}]*)\}/g;
    let r;
    while ((r = inner.exec(m[2]))) take(r[1].trim(), r[2], query, m.index + r.index);
  }
  return out;
}

const RULES = displayRules(bare);

// Specificity of the simple selectors this checker understands. Anything with a
// combinator, a pseudo-class or an id is refused rather than approximated — see
// `matches` below, which fails the suite instead of guessing.
function parse(sel) {
  const bits = sel.match(/\[[^\]]+\]|\.[A-Za-z0-9_-]+|^[A-Za-z][A-Za-z0-9]*|:[A-Za-z-]+/g) || [];
  if (bits.join('') !== sel) return null;        // combinators, spaces, commas
  let cls = [], attrs = [], tags = [];
  for (const b of bits) {
    if (b[0] === '.') cls.push(b.slice(1));
    else if (b[0] === '[') attrs.push(b);
    else if (b[0] === ':') return null;          // states are not what we model
    else tags.push(b);
  }
  return { cls: cls, attrs: attrs, tags: tags,
           spec: (cls.length + attrs.length) * 10 + tags.length };
}

function matches(sel, elCls, elTag, elHidden) {
  const p = parse(sel);
  if (!p) {
    // ⚠ A selector this checker cannot read is only safe if it cannot reach the
    // element. If it names one of the element's classes, the check would be
    // under-approximating — which is the failure mode of a test, not a pass.
    const touches = elCls.some((c) => sel.indexOf('.' + c) !== -1);
    if (touches) throw new Error('cannot resolve a rule that reaches .' +
      elCls.join('.') + ': ' + sel);
    return false;
  }
  if (p.tags.length && p.tags.some((t) => t !== elTag)) return false;
  if (p.cls.some((c) => elCls.indexOf(c) === -1)) return false;
  for (const a of p.attrs) {
    if (a === '[hidden]') { if (!elHidden) return false; }
    else return false;
  }
  return true;
}

function displayOf(elCls, elTag, elHidden, query) {
  let best = null;
  for (const r of RULES) {
    // Base rules apply at every width; a media block's rules join them when
    // the caller is asking about that width, and come later in the file.
    if (r.query !== null && r.query !== query) continue;
    if (!matches(r.sel, elCls, elTag, elHidden)) continue;
    const p = parse(r.sel);
    if (!best) { best = { r: r, spec: p.spec }; continue; }
    const winsOn = r.important !== best.r.important ? r.important
      : p.spec !== best.spec ? p.spec > best.spec
      : r.order > best.r.order;
    if (winsOn) best = { r: r, spec: p.spec };
  }
  return best ? best.r.value : null;
}

// ---------------------------------------------------------------------------
console.log('[the three elements this site actually hides]');

// Every one of them is a real `hidden` in a real client, and each was written
// on a different day by somebody who could not see the other two.
H.ok(/go\.setAttribute\('hidden', 'hidden'\)/.test(client),
  'the register panel takes its Register button away');
H.ok(/bar\.hidden = /.test(activityJs) || /hidden = true/.test(activityJs),
  'the activity page hides its sticky bar while the real button is in view');
H.ok(/hidden/.test(navJs) && /lang-menu/.test(navJs),
  'the nav hides the language list until the globe is pressed');

const cases = [
  ['a hidden .btn-primary — the reported bug', ['btn-primary'], 'button', null],
  ['a hidden .lang-menu', ['lang-menu'], 'div', null],
  ['a hidden .activity-sticky, at a phone width', ['activity-sticky'], 'div',
   '(max-width:939px)']
];

cases.forEach((c) => {
  const shown = displayOf(c[1], c[2], false, c[3]);
  H.ok(shown && shown !== 'none', c[0] + ': renders as ' + shown + ' when shown');
  H.eq(displayOf(c[1], c[2], true, c[3]), 'none',
    '⚠ ' + c[0] + ': and computes to display:none when hidden');
});

// ---------------------------------------------------------------------------
console.log('\n[⚠ and !important is what does it, not source order]');

// The global sits at the top of the stylesheet, beside the other resets, which
// is where it belongs and is also the worst place for it: every `display` in
// the 1700 lines below it is a later rule at equal specificity, and at equal
// specificity the LATER one wins. Without `!important` the answer would be
// whichever rule happened to be written last — which is not a rule at all.
const global = RULES.filter((r) => r.sel === '[hidden]' && r.query === null)[0];
H.ok(global, 'there is one global [hidden] rule');
H.eq(global.value, 'none', 'and it says display:none');
H.eq(global.important, true, '⚠ !important, because `hidden` is not a style to be weighed');

const later = RULES.filter((r) => r.query === null && r.order > global.order &&
  parse(r.sel) && parse(r.sel).spec >= 10 && r.value !== 'none' && !r.important);
H.ok(later.length > 0,
  later.length + ' rules below it would otherwise win on source order alone — '
  + 'first: ' + later[0].sel);

// ---------------------------------------------------------------------------
console.log('\n[one answer, not one per class]');

// The two patches that were there are gone with the global, deliberately. A
// redundant rule is a rule the next reader has to decide about, and the shape
// that produced this bug was exactly "somebody remembered, twice, and then did
// not". A per-class patch coming back is the trap being reopened.
const perClass = (bare.match(/[^\s,{}]+\[hidden\][^{]*\{/g) || [])
  .map((s) => s.replace(/\s*\{$/, ''))
  .filter((s) => s !== '[hidden]');
H.eq(perClass.length, 0,
  '⚠ no element patches `[hidden]` for itself' +
  (perClass.length ? ': ' + perClass.join(', ') : ''));

H.done();
