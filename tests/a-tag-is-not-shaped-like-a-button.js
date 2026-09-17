// What this defends against:
//
// The status badge was a solid fill, white text, font-weight:800 and
// border-radius:999px. So is .sidebar-cta. For the `open` status the fill was
// also the SAME COLOUR, var(--terracotta) — so the most common state on the
// site rendered a tag that was, property for property, the button underneath
// it. A reader pressed the tag, nothing happened, and the page looked broken.
//
// Rule 5 in CLAUDE.md reserves terracotta for things you can press. It was
// reserving the COLOUR while the SHAPE gave the game away, so the rule read as
// satisfied while the confusion it exists to prevent was live on the site.
//
// Two things are pinned here. First, a tag and a button must not share the
// pressable shape — solid fill plus a full pill. Second, every one of the seven
// status tags must reach 4.5:1 against its own tinted ground, because five of
// the seven tokens were CHOSEN as backgrounds behind white text and fail badly
// as foregrounds: --muted-warm is 1.70:1 on paper, --camel 2.30, --muted 2.71,
// --gold 3.05. Reusing the token as text colour is the obvious move and it is
// the wrong one, so the contrast is computed here rather than eyeballed.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');

const R = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(R, 'shared.css'), 'utf8');
// Strip comments first. This file's own prose names the properties it forbids,
// and a naive search finds them in the explanation and passes either way —
// which has happened three times in this directory already.
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');

const ruleFor = (sel) => {
  const i = bare.indexOf(sel + '{');
  H.ok(i !== -1, 'found ' + sel);
  return bare.slice(i, bare.indexOf('}', i) + 1).replace(/\s+/g, ' ');
};

console.log('[the button still looks like a button]');
const cta = ruleFor('.sidebar-cta');
H.ok(/border-radius:\s*999px/.test(cta), '.sidebar-cta is a full pill');
H.ok(/font-weight:\s*800/.test(cta), 'and heavy');

console.log('\n[the tag does not]');
const badge = ruleFor('.status-badge');
H.ok(!/border-radius:\s*999px/.test(badge),
  '.status-badge is NOT a full pill — that shape means pressable');
H.ok(/border-radius:\s*6px/.test(badge), 'it has a small radius instead');
H.ok(/background:\s*transparent/.test(badge),
  'and no solid fill of its own; each status tints its own ground');
H.ok(/border:\s*1px solid/.test(badge), 'it is outlined');
H.ok(!/font-weight:\s*800/.test(badge), 'and lighter than the button');

console.log('\n[no status paints itself white-on-solid any more]');
const STATUSES = ['draft', 'announcement', 'open', 'waitlist', 'closed', 'cancelled', 'completed'];
STATUSES.forEach((s) => {
  const r = ruleFor('.status-badge.is-' + s);
  H.ok(!/color:\s*#fff/i.test(r), s + ': no white text');
  H.ok(!/background:\s*var\(--[a-z-]+\)\s*;/.test(r), s + ': no flat token fill');
  H.ok(/color-mix\(in srgb/.test(r), s + ': tints its ground from its own hue');
});

console.log('\n[and every tag is readable — computed, not eyeballed]');
// WCAG relative luminance. Small text needs 4.5:1.
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const rgb = (hex) => {
  const h = hex.replace('#', '');
  const f = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16));
};
const lum = (hex) => { const [r, g, b] = rgb(hex).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => {
  const la = lum(a), lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};
const mix = (a, b, pct) => '#' + rgb(a).map((c, i) =>
  Math.round(c * pct + rgb(b)[i] * (1 - pct)).toString(16).padStart(2, '0')).join('');

// The tokens, read from :root so this cannot drift from the stylesheet.
const root = bare.slice(bare.indexOf(':root{'), bare.indexOf('}', bare.indexOf(':root{')));
const token = (name) => {
  const m = root.match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{3,6})'));
  H.ok(m, 'token --' + name + ' is defined');
  return m[1];
};
const PAPER = token('paper');

STATUSES.forEach((s) => {
  const rule = ruleFor('.status-badge.is-' + s);
  // the text colour: either a literal or a token
  const lit = rule.match(/color:\s*(#[0-9a-fA-F]{3,6})/);
  const tok = rule.match(/color:\s*var\(--([a-z-]+)\)/);
  const text = lit ? lit[1] : token(tok[1]);
  // the ground: paper with this status's hue mixed in at the declared percent
  const bg = rule.match(/background:\s*color-mix\(in srgb,\s*var\(--([a-z-]+)\)\s*(\d+)%/);
  H.ok(bg, s + ': declares a tinted ground');
  const ground = mix(token(bg[1]), PAPER, parseInt(bg[2], 10) / 100);
  const r = ratio(text, ground);
  H.ok(r >= 4.5, s + ': ' + text + ' on ' + ground + ' = ' + r.toFixed(2) + ':1');
  // and it must still hold on bare paper, since the tint is translucent
  const rp = ratio(text, PAPER);
  H.ok(rp >= 4.5, s + ': and ' + r.toFixed(2) + ':1 holds on paper too (' + rp.toFixed(2) + ':1)');
});

H.done();
