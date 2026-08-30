// What this defends against:
//
// The privacy policy and terms of use exist as PLACEHOLDER pages. They were
// added early so the routes are real and linkable while the member and
// registration system is designed — and a placeholder that renders, has a
// breadcrumb, sits at a proper URL and carries the site's own typography looks
// finished. That is the whole risk: the reason the pages were created is the
// reason nobody would notice they are still empty.
//
// Ogen has never stored a person's name before. The registration system stores
// a MINOR's name and date of birth, in the EU. Shipping that against
// "[content needed]" is not a documentation gap, it is collecting a child's
// data with no lawful basis published.
//
// So this suite refuses to let the two ship out of order. It passes quietly
// today, because there is no registration code. The day somebody adds any of
// the signals below, it starts demanding that every legal page has been flipped
// to "final" — and it fails the build until they have been.
//
// It also holds the four things that must move TOGETHER when they are flipped:
// the status meta tag, the noindex, the visible draft banner, and the sitemap.
// Flipping one is how a page ends up claiming to be reviewed while still
// carrying placeholder copy, or asking not to be indexed while the sitemap
// invites a crawler in. /about already pairs robots and sitemap the same way.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');

const LEGAL_PAGES = [
  'privacy.html', 'en/privacy.html', 'ru/privacy.html',
  'terms.html', 'en/terms.html', 'ru/terms.html'
];
const PLACEHOLDER_TEXT = '[content needed]';
const STATUS_RE = /<meta name="ogen-legal-status" content="(placeholder|final)">/;

console.log('[the six pages exist and declare a status]');
const status = {};
LEGAL_PAGES.forEach((p) => {
  H.ok(fs.existsSync(path.join(R, p)), p + ' exists');
  const m = STATUS_RE.exec(read(p));
  H.ok(!!m, p + ' declares ogen-legal-status');
  status[p] = m ? m[1] : null;
});

// One document in three languages is one document. A reviewed English privacy
// policy beside an untranslated Hebrew one is not "partly done" — the Hebrew
// speaker is the one who cannot read what they agreed to, and Hebrew is this
// site's default language.
console.log('\n[all six move together, or none of them do]');
const distinct = Array.from(new Set(Object.values(status)));
H.eq(distinct.length, 1,
  'every legal page carries the same status (found: ' + distinct.join(', ') + ')');
const FINAL = distinct.length === 1 && distinct[0] === 'final';

console.log('\n[a page is only "final" if nothing about it is still a draft]');
LEGAL_PAGES.forEach((p) => {
  const src = read(p);
  const hasPlaceholderCopy = src.indexOf(PLACEHOLDER_TEXT) !== -1;
  const hasDraftBanner = /class="status-banner is-draft"/.test(src);
  const isNoindex = /<meta name="robots" content="noindex/.test(src);
  if (status[p] === 'final') {
    H.ok(!hasPlaceholderCopy, p + ': no "' + PLACEHOLDER_TEXT + '" left in a final page');
    H.ok(!hasDraftBanner, p + ': the draft banner is gone');
    H.ok(!isNoindex, p + ': a finished legal page is indexable');
  } else {
    // The placeholder state has to stay honest too: a placeholder that has lost
    // its banner or its noindex is a page quietly presenting itself as real.
    H.ok(hasDraftBanner, p + ': placeholder still shows the draft banner');
    H.ok(isNoindex, p + ': placeholder is noindex');
  }
});

console.log('\n[the sitemap agrees with the meta tag]');
// Generated from STATIC_ROUTES, so that list is what is asserted — sitemap.xml
// itself is a build artifact and is rebuilt on the next activity publish.
const indexSrc = read('netlify/functions/_activity-index.js');
const routes = (indexSrc.match(/const STATIC_ROUTES = \[[\s\S]*?\];/) || [''])[0];
['privacy', 'terms'].forEach((slug) => {
  const listed = routes.indexOf("'/" + slug + "'") !== -1;
  if (FINAL) H.ok(listed, '/' + slug + ' is in STATIC_ROUTES now that it is final');
  else H.ok(!listed, '/' + slug + ' is out of the sitemap while it is a placeholder');
});

console.log('\n[does a registration system exist yet?]');
// Deliberately broad. A false positive costs somebody reading this comment and
// finishing the legal pages; a false negative costs a child's data going into a
// system with no published policy. The asymmetry decides the sensitivity.
//
// tests/ and CLAUDE.md are excluded because they NAME these things in order to
// describe them — this file would otherwise trip over its own explanation.
const FN_DIR = path.join(R, 'netlify/functions');
const fnFiles = fs.existsSync(FN_DIR) ? fs.readdirSync(FN_DIR).filter((f) => f.endsWith('.js')) : [];

const NAME_RE = /^_?(member|account|participant|guardian|registration)/i;
// An actual store OPEN, not a bare word. The first draft matched any quoted
// "participants" and tripped on FACT_GROUPS in _activity-facts.js, where
// `participants` is the key of the "Who it is for" card. Matching the call is
// both narrower and more honest about what it is looking for.
const STORE_RE = /(?:requireStore|optionalStore)\(\s*['"](accounts|participants|guardian-links|guardian-invites|registrations|member-sessions|member-tokens)['"]/;
const TOOLS_RE = /TOOLS\s*=\s*\[[^\]]*registrations/;

const signals = [];
fnFiles.forEach((f) => {
  if (NAME_RE.test(f)) signals.push('netlify/functions/' + f + ' (filename)');
  const src = read('netlify/functions/' + f);
  if (STORE_RE.test(src)) signals.push('netlify/functions/' + f + ' (opens a people/registration store)');
  if (TOOLS_RE.test(src)) signals.push('netlify/functions/' + f + ' (registrations permission tool)');
});

if (!signals.length) {
  console.log('  ..   no registration surface found — the gate is armed but not firing');
  H.ok(true, 'nothing to gate yet');
} else {
  console.log('  ..   FOUND: ' + signals.join('\n       '));
  H.ok(FINAL,
    'a registration system exists, so every legal page must be reviewed and marked final BEFORE it can collect anyone\'s data');
}

H.done();
