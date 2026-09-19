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
// ⚠ SIX FILES SAID "Arms the legal gate, correctly" AND NONE OF THEM DID.
//
// Every phase after the first added a store that names a participant, wrote the
// marker comment at the top, and did not appear in this list — so the attendance
// register, the bundles, the check-in tokens, the pay links and the credit
// ledger were all invisible to the gate while each file claimed otherwise.
//
// It fired anyway, because the files that DO match are enough to arm it, which
// is exactly why nobody noticed: a gate that is already armed cannot tell you
// what it is failing to see. The list is the thing that has to be complete, not
// the count of signals.
const PEOPLE_STORES = 'accounts|participants|guardian-links|guardian-invites|registrations|' +
  'member-sessions|member-tokens|session-attendance|bundles|checkin-tokens|pay-links|account-credits';
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
// THE SECOND GATE, AND IT NO LONGER ASKS THE QUESTION IT USED TO.
//
// It used to ask "has every language been reviewed", because every language was
// equally binding — a Russian-speaking parent agreeing to terms nobody fluent
// had checked was agreeing to those Russian words. A governing-language clause
// changed what is true: English is the binding version, and the other two are
// courtesy translations that say so, in their own language, at the top of the
// page where the reader meets them first.
//
// So the gate asks the two questions that now decide it:
//
//   1. IS THE BINDING VERSION REVIEWED? Whichever language ogen-legal-binding
//      names must be `complete` on both of its pages. That is the hard one — if
//      the version that governs has not been read, nothing else matters.
//
//   2. DOES EVERY PAGE CARRY THE CLAUSE? A `courtesy` page is only honest while
//      it says it is a courtesy translation. Remove the clause from one language
//      and that page silently becomes an unreviewed text a family is agreeing to
//      with no notice at all — which is the exact thing this gate exists to
//      stop. So the clause is checked on ALL SIX, including the binding
//      language's own pages, because a reader of the Hebrew has to be told which
//      version governs just as much as a reader of the Russian.
//
// Russian is `courtesy`, not `complete`. Flattening it would have made the
// marker a lie to get the gate to pass, and the marker is the only machine-
// readable thing standing between this system and a family agreeing to terms
// nobody checked. A third state costs one word and keeps the truth writable.
const REVIEW_RE = /<meta name="ogen-legal-review" content="(pending|complete|courtesy)">/;
const BINDING_RE = /<meta name="ogen-legal-binding" content="([a-z]{2})">/;
// The machine-readable half of the clause. An attribute rather than a phrase,
// because matching the prose would mean matching it in three languages and
// would break on any rewording — and the clause is meant to be reworded.
const CLAUSE_RE = /data-governing-language="([a-z]{2})"/;

const review = {};
const binding = {};
LEGAL_PAGES.forEach((p) => {
  const src = read(p);
  const m = REVIEW_RE.exec(src);
  H.ok(!!m, p + ' declares ogen-legal-review');
  review[p] = m ? m[1] : null;

  const b = BINDING_RE.exec(src);
  H.ok(!!b, p + ' declares which language governs');
  binding[p] = b ? b[1] : null;

  // The clause a person actually reads, and it must agree with the meta tag.
  // Two machine-readable statements of one fact are two statements that can
  // disagree, so the check is that they do not.
  const c = CLAUSE_RE.exec(src);
  H.ok(!!c, p + ' carries the governing-language clause in its body');
  H.ok(!c || !b || c[1] === b[1],
    p + ': the clause and the meta tag name the SAME binding language');
});

const bindingLangs = Array.from(new Set(Object.values(binding)));
H.eq(bindingLangs.length, 1,
  'all six pages agree on which language governs (found: ' + bindingLangs.join(', ') + ')');
const GOVERNS = bindingLangs.length === 1 ? bindingLangs[0] : null;

// Which pages ARE the binding version. The Hebrew tree is at the root, so a page
// belongs to `en` or `ru` by its directory and to `he` by having neither.
const langOfPage = (p) => (p.indexOf('/') === -1 ? 'he' : p.split('/')[0]);
const bindingPages = LEGAL_PAGES.filter((p) => langOfPage(p) === GOVERNS);
H.eq(bindingPages.length, 2, 'the binding language has both of its pages here');

const REVIEWED = !!GOVERNS && bindingPages.every((p) => review[p] === 'complete');
LEGAL_PAGES.forEach((p) => {
  if (langOfPage(p) === GOVERNS) {
    H.eq(review[p], 'complete',
      p + ' is the BINDING version, so "reviewed" is not optional for it');
  } else {
    H.ok(review[p] === 'complete' || review[p] === 'courtesy',
      p + ' is a non-binding version: reviewed, or a declared courtesy translation');
  }
});

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

// Scripts are matched by NAME, which is a proxy for "a family can reach this"
// and deliberately a loose one: a file that exists but is not wired up yet still
// counts, because the point is to catch a surface appearing rather than a
// surface finishing.
//
// The one false positive that proxy produces is an ADMIN script, and the admin
// is exactly what this gate is meant to allow — /admin/*.html is already outside
// the scan for that reason. So a script is exempt only when it is PROVEN to be
// admin-only: referenced by at least one page under /admin/ and by no page
// outside it. That is mechanical and checkable, and it is stricter than a naming
// convention would be — a public page loading an "-admin" script still trips.
const JS_DIR = path.join(R, 'js');
const JS_RE = /^(member|account|register|registration|signup|participant|guardian)/i;

const scriptsIn = (files, base) => {
  const out = new Set();
  files.forEach((f) => {
    const src = read(base ? base + '/' + f : f);
    const re = /<script[^>]+src="\/js\/([^"]+)"/g;
    let m;
    while ((m = re.exec(src))) out.add(m[1]);
  });
  return out;
};
const ADMIN_DIR = path.join(R, 'admin');
const adminPages = fs.existsSync(ADMIN_DIR)
  ? fs.readdirSync(ADMIN_DIR).filter((f) => f.endsWith('.html')) : [];
const usedByAdmin = scriptsIn(adminPages, 'admin');
const usedByPublic = scriptsIn(rootHtml);

if (fs.existsSync(JS_DIR)) {
  fs.readdirSync(JS_DIR).filter((f) => f.endsWith('.js') && JS_RE.test(f)).forEach((f) => {
    if (usedByAdmin.has(f) && !usedByPublic.has(f)) return;
    PUBLIC_SIGNALS.push('js/' + f + ' (public script)');
  });
}

const courtesy = LEGAL_PAGES.filter((p) => review[p] === 'courtesy');

if (PUBLIC_SIGNALS.length) console.log('  ..   FOUND: ' + PUBLIC_SIGNALS.join('\n       '));
H.ok(REVIEWED,
  'the BINDING version (' + GOVERNS + ') has been reviewed — everything else is a courtesy ' +
  'translation that says so on its own page');

if (courtesy.length) {
  // Not a failure. A standing note, because the thing it describes is real and
  // easy to stop thinking about once the gate goes green.
  console.log('  ..   STILL A COURTESY TRANSLATION: ' + courtesy.join(', '));
  console.log('       Nobody fluent has read that text, nor the price labels');
  console.log('       Годовой регистрационный взнос / Стоимость семестра, nor the account');
  console.log('       and registration emails. The clause makes that HONEST rather than');
  console.log('       hidden — it does not make it good, and it does not reach GDPR Art. 12,');
  console.log('       which asks for intelligible information in the reader\'s own language.');
  console.log('       Worth doing. No longer blocking.');
}
H.ok(true, 'and every page says, in its own language, which version governs');

H.done();
