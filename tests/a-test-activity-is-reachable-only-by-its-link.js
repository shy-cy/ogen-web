// What this defends against:
//
// ⚠ THERE WAS NO WAY TO REHEARSE A REGISTRATION ON THE LIVE SITE.
//
// Everything that moves money here — the price frozen at submission, Checkout,
// the webhook that settles a record, the emails — only really runs against the
// deployed site, because Blobs is unreliable locally and Stripe redirects to a
// real URL. So testing it means publishing an activity, which until now meant
// publishing it TO THE PUBLIC: on the listing page, in the hamburger menu, in
// sitemap.xml, and offered to a crawler. A family could register for "test4" and
// be charged for a class that does not exist.
//
// The two things that already existed were both the wrong shape for it:
//
//   - `draft` has NO FILES AT ALL. There is no page, so there is nothing to
//     register against. That is the whole point of a draft and must not change.
//   - `robots: noindex` keeps a page out of SEARCH and deliberately leaves it on
//     the site — the flag is an instruction to a crawler, not to a visitor, and
//     the listing and the menu still carry it.
//
// `testActivity` is the third answer: published for real, behaving exactly like
// an open activity in every code path a family touches, with every ROUTE to it
// removed. Registration and payment must rehearse the real thing, or they
// rehearse something else.
//
// ⚠ AND THE TRAP IS THAT ONE READER OF THE INDEX MUST NOT FILTER.
//
// activities-index.json is not a shop window, it is the lookup that turns a slug
// into an activityId — which is how /account/activity?register=<slug> finds an
// activity at all, in the family area and in both registration handlers. Drop
// the row from that file and the one thing a test activity exists for becomes
// impossible, silently, with the page still serving. So the row stays and
// carries the flag, and the readers that ARE shop windows — the three listing
// pages, the menu, the sitemap — each leave it out.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');
const tpl = require('../netlify/functions/_activity-template');
const idx = require('../netlify/functions/_activity-index');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');

const base = (over) => Object.assign({
  slug: 'test4', status: 'open', activityId: 'act-abc',
  title: { he: 'בדיקה', en: 'Test four', ru: 'Тест' },
  about: { he: 'תיאור', en: 'Description', ru: 'Описание' },
  facts: {}, groups: [], teachers: [], sponsors: [], faq: []
}, over || {});
const robotsOf = (html) => (/name="robots" content="([^"]+)"/.exec(html) || [])[1];

const ordinary = base();
const test = base({ testActivity: true });

console.log('[the page is real, and tells a crawler to leave it alone]');
['he', 'en', 'ru'].forEach((lang) => {
  const html = tpl.renderActivityPage(test, lang);
  H.eq(robotsOf(html), 'noindex, nofollow', 'the ' + lang + ' page is noindex, nofollow');
  H.ok(html.indexOf('Test four') !== -1 || html.indexOf('בדיקה') !== -1 || html.indexOf('Тест') !== -1,
    '   and it is otherwise an ordinary page — the file is written and served');
});
// ⚠ STRICTER THAN `noindex`, ON PURPOSE. /about is 'noindex, follow' because its
// links are still worth crawling. Nothing about a test activity is.
H.eq(robotsOf(tpl.renderActivityPage(base({ robots: 'noindex' }), 'he')), 'noindex, follow',
  'an ordinary noindex activity keeps the follow it always had');
H.eq(robotsOf(tpl.renderActivityPage(ordinary, 'he')), 'index, follow',
  'and an ordinary one is untouched');
// The flag wins over the select, rather than the two having to be set together.
H.eq(robotsOf(tpl.renderActivityPage(base({ testActivity: true, robots: 'index' }), 'he')),
  'noindex, nofollow',
  'ticking the box is enough — it is not a second thing to remember beside the robots select');

console.log('\n[no route to it: not the sitemap, not the listing, not the menu]');
const locs = (a) => idx.buildSitemap([a]).split('\n')
  .filter((l) => l.indexOf('<loc>') !== -1 && l.indexOf('test4') !== -1).length;
H.eq(locs(ordinary), 3, 'an ordinary activity is in the sitemap in all three languages');
H.eq(locs(test), 0, 'a test activity is in none');

const listingOf = (a, lang) => idx.buildDerivedFiles([a])
  .find((f) => f.path === (lang === 'he' ? 'activities/index.html' : lang + '/activities/index.html')).content;
['he', 'en', 'ru'].forEach((lang) => {
  H.ok(listingOf(ordinary, lang).indexOf('test4') !== -1, 'the ' + lang + ' listing carries an ordinary one');
  H.ok(listingOf(test, lang).indexOf('test4') === -1, '   and not a test one');
});

console.log('\n[but it IS in activities-index.json, and that is the design]');
const entries = idx.buildIndex([test]);
H.eq(entries.length, 1, 'the row is there');
H.eq(entries[0].testActivity, true, 'carrying the flag every other reader filters on');
H.eq(entries[0].activityId, 'act-abc',
  '⚠ and the activityId, which is the ONLY reason the row has to stay: slug -> id ' +
  'is how the family area opens a registration panel');
H.eq(idx.buildIndex([ordinary])[0].testActivity, false,
  'an ordinary activity says so rather than saying nothing, so the flag is never undefined');

// The three handlers that resolve a slug through that file must not have grown a
// filter of their own. This is the half that would fail silently: registering
// would answer "no such activity" on an activity whose page is live.
['account-registrations.js', 'admin-registrations.js', 'activities-admin.js'].forEach((f) => {
  const src = read('netlify/functions/' + f).replace(/^\s*\/\/.*$/gm, '');
  H.ok(!/testActivity/.test(src.slice(src.indexOf('activities-index.json'))) ||
       f === 'activities-admin.js',
    f + ' does not filter the index it uses as a lookup');
});

console.log('\n[the menu filters it, in the client that reads that file]');
const nav = read('js/nav.js');
H.ok(/if \(!a \|\| a\.testActivity\) return false;/.test(nav),
  'js/nav.js drops a test activity before anything else it asks');
// Executed rather than read, in the suite that owns the menu.
H.ok(/testActivity/.test(read('tests/the-menu-names-the-activities.js')),
  'and the menu suite runs it against a real index rather than trusting this line');

console.log('\n[it is structure, so a Russian-only role cannot unhide it]');
const admin = read('netlify/functions/activities-admin.js');
H.ok(/if \(incoming\.testActivity !== undefined\) out\.testActivity = !!incoming\.testActivity;/.test(admin),
  'the merge takes it only on the full-permission branch');
const restricted = admin.slice(admin.indexOf('  } else {', admin.indexOf('out.robots = ROBOTS')));
H.ok(/out\.testActivity = !!\(base && base\.testActivity\);/.test(restricted),
  'and a restricted role keeps the stored value');
const SIMPLE = admin.slice(admin.indexOf('const SIMPLE_KEYS'), admin.indexOf('const RICH_KEYS'));
H.ok(!/testActivity/.test(SIMPLE),
  'it is never a translatable scalar — one answer for all three trees, like robots');

console.log('\n[the form draws it and reads it back]');
const ui = read('js/activities-admin.js');
H.ok(/id: 'f-test'/.test(ui), 'the checkbox exists');
H.ok(/rec\.testActivity = \$\('f-test'\) \? \$\('f-test'\)\.checked : !!S\.record\.testActivity;/.test(ui),
  '⚠ and a MISSING box keeps the stored value rather than reading as unticked — ' +
  'the undrawn-field trap, which here would publish a test activity to the world');
H.ok(/renderSettings/.test(ui.slice(0, ui.indexOf("id: 'f-test'"))),
  'it is drawn in Settings, beside Status');
// It is not a status, and must not become one: a test activity has to run
// through the same open-activity code a family meets.
const STATUSES = require('../netlify/functions/_activity-template').STATUS_GROUPS;
H.ok(!JSON.stringify(STATUSES || {}).includes('test'),
  'and it is not a status — those decide what the page OFFERS, and a rehearsal must offer what the real thing does');

console.log('\n[and the admin picker is the one screen that can see it]');
H.ok(/testActivity: !!a\.testActivity,/.test(admin), 'the list action reports it');
H.ok(/a\.testActivity \? el\('span', \{ class: 'pill test'/.test(ui), 'and the picker marks it');
H.ok(/\.pill\.test\{/.test(read('admin/admin.css')),
  'with a rule in the stylesheet — a class nobody styled is a layout nobody designed');

H.done();
