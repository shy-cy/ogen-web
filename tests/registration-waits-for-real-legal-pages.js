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
// Two ways a people store gets opened, because the first one is not enough.
// A call site passing a LITERAL is caught by the first pattern; one passing a
// constant — `optionalStore(ACCOUNTS)`, which is how _account-store.js actually
// does it — is invisible to it, and was. Both signals now fire, and the second
// catches the name wherever it is declared.
const PEOPLE_STORES = 'accounts|participants|guardian-links|guardian-invites|registrations|member-sessions|member-tokens';
const STORE_RE = new RegExp(
  '(?:requireStore|optionalStore)\\(\\s*[\'"](?:' + PEOPLE_STORES + ')[\'"]' +
  '|=\\s*[\'"](?:' + PEOPLE_STORES + ')[\'"]\\s*;');
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

console.log('\n[the review that is still owed]');
// THE SECOND GATE, and the reason it exists.
//
// The six pages were flipped to "final" to unblock development — the text is
// real and reviewed in Hebrew and English, and holding the whole registration
// system closed behind one outstanding translation review was the wrong trade.
// That was a deliberate decision, taken knowingly, and it is recorded here so
// that it stays a decision rather than becoming something everyone forgot.
//
// What is still owed: a NATIVE SPEAKER has never read the Russian text, nor the
// two price labels the activity pages publish. Russian is not a courtesy
// language on this site — it is one of three equals, and a Russian-speaking
// parent agreeing to terms nobody fluent has checked is the exact situation the
// first gate exists to prevent, one language down.
//
// So the first gate governs whether registration can be BUILT, and this one
// governs whether it can be OPENED to the public. The distinction is the whole
// point: development continues, and the door does not open.
const REVIEW_RE = /<meta name="ogen-legal-review" content="(pending|complete)">/;
const review = {};
LEGAL_PAGES.forEach((p) => {
  const m = REVIEW_RE.exec(read(p));
  H.ok(!!m, p + ' declares ogen-legal-review');
  review[p] = m ? m[1] : null;
});
const reviewStates = Array.from(new Set(Object.values(review)));
H.eq(reviewStates.length, 1,
  'every page carries the same review state (found: ' + reviewStates.join(', ') + ')');
const REVIEWED = reviewStates.length === 1 && reviewStates[0] === 'complete';

// A PUBLIC registration surface: something a family can reach. The admin is
// deliberately not one — it is staff-only and noindex, and building the admin
// side of registration is exactly what this gate is meant to allow.
const PUBLIC_SIGNALS = [];
const rootHtml = fs.readdirSync(R).filter((f) => f.endsWith('.html'));
['en', 'ru'].forEach((l) => {
  const dir = path.join(R, l);
  if (fs.existsSync(dir)) {
    fs.readdirSync(dir).filter((f) => f.endsWith('.html')).forEach((f) => rootHtml.push(l + '/' + f));
  }
});
const PAGE_RE = /(register|registration|signup|sign-up|account|my-children|members?)\.html$/i;
rootHtml.forEach((f) => { if (PAGE_RE.test(f)) PUBLIC_SIGNALS.push(f + ' (public page)'); });

const JS_DIR = path.join(R, 'js');
const JS_RE = /^(member|account|register|registration|signup|participant|guardian)/i;
if (fs.existsSync(JS_DIR)) {
  fs.readdirSync(JS_DIR).filter((f) => f.endsWith('.js') && JS_RE.test(f))
    .forEach((f) => PUBLIC_SIGNALS.push('js/' + f + ' (public script)'));
}

if (!PUBLIC_SIGNALS.length) {
  if (REVIEWED) {
    console.log('  ..   Russian review complete — this gate has nothing left to hold');
  } else {
    console.log('  ..   STILL OWED: a native speaker has not read the Russian legal text,');
    console.log('       nor the price labels Годовой регистрационный взнос / Стоимость семестра.');
    console.log('       Nothing public depends on it yet. Do it before registration OPENS.');
  }
  H.ok(true, 'no public registration surface yet, so the review is a reminder rather than a blocker');
} else {
  console.log('  ..   FOUND: ' + PUBLIC_SIGNALS.join('\n       '));
  H.ok(REVIEWED,
    'registration is about to be public, so the Russian legal text and the price labels ' +
    'must have been read by a native speaker first — flip ogen-legal-review to "complete" ' +
    'on all six pages when that is done');
}

H.done();
