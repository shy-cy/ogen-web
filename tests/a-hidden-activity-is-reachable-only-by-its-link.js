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
// ⚠ AND THEN THE THIRD ANSWER WAS A TICKBOX, WHICH ASKED ONE QUESTION AND
// ANSWERED TWO. `testActivity` meant "off every route to this page" AND "this is
// a rehearsal" — which was one fact only while there was one Stripe
// configuration. An activity nobody should stumble on and an activity whose
// payments are pretend are different things, and the first is perfectly
// ordinary: a closed group, a class filled by word of mouth, a page sent to one
// family. Under a tickbox, anything hidden had to be a rehearsal, so hiding a
// real class was not expressible at all.
//
// It is one select with three states now — `listed | unlisted | test` — and
// `unlisted` is the state that did not exist. What each removes:
//
//   listed     nothing. The ordinary activity.
//   unlisted   every route TO the page. Real money.
//   test       every route TO the page, and the payments move on the TEST keys.
//
// ⚠ AND THE TRAP IS THAT ONE READER OF THE INDEX MUST NOT FILTER.
//
// activities-index.json is not a shop window, it is the lookup that turns a slug
// into an activityId — which is how /account/activity?register=<slug> finds an
// activity at all, in the family area and in both registration handlers. Drop
// the row from that file and the one thing a hidden activity exists for becomes
// impossible, silently, with the page still serving. So the row stays and
// carries the state, and the readers that ARE shop windows — the three listing
// pages, the menu, the sitemap — each leave it out.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');
const tpl = require('../netlify/functions/_activity-template');
const idx = require('../netlify/functions/_activity-index');
const LST = require('../netlify/functions/_activity-listing');
const { migrate } = require('../netlify/functions/_activity-migrate');

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
const unlisted = base({ listing: 'unlisted' });
const test = base({ listing: 'test' });

console.log('[the old tickbox migrates, and reads correctly before anything is saved]');
// ⚠ ON READ, which is what makes it free. Every record in the repository still
// says `testActivity`, and listingOf() has to answer for them the moment this
// deploys rather than after somebody opens and saves each one.
H.eq(LST.listingOf({ testActivity: true }), 'test', 'testActivity: true is Test');
H.eq(LST.listingOf({ testActivity: false }), 'listed', 'testActivity: false is Listed');
H.eq(LST.listingOf({}), 'listed', 'and an absent flag is Listed — the ordinary activity');
H.eq(LST.listingOf({ listing: 'unlisted', testActivity: true }), 'unlisted',
  'the new field wins, so a migrated record that is then edited is not dragged back');
H.eq(LST.listingOf({ listing: 'nonsense' }), 'listed',
  'and an unknown value is not honoured — a typo must not hide a page');
// migrate() then stops the record carrying the old key, the way ctaUrl went.
const migrated = migrate({ slug: 's', activityId: 'act-1', testActivity: true });
H.eq(migrated.listing, 'test', 'migrate() writes the state');
H.ok(!('testActivity' in migrated), 'and drops the old key, so a save stops carrying it');
// ⚠ IDEMPOTENT, or migrate() could not run on every read: the second pass has no
// testActivity left to consult and must find what the first wrote.
H.eq(migrate(migrated).listing, 'test', 'a second pass finds what the first wrote');
H.eq(migrate({ slug: 's', activityId: 'act-1' }).listing, 'listed',
  'and a record that never had the flag comes out Listed');

console.log('\n[the page is real in all three states, and says so to a crawler]');
['he', 'en', 'ru'].forEach((lang) => {
  const html = tpl.renderActivityPage(test, lang);
  H.eq(robotsOf(html), 'noindex, nofollow', 'the ' + lang + ' test page is noindex, nofollow');
  H.ok(html.indexOf('Test four') !== -1 || html.indexOf('בדיקה') !== -1 || html.indexOf('Тест') !== -1,
    '   and it is otherwise an ordinary page — the file is written and served');
});
// ⚠ `nofollow` ONLY FOR A REHEARSAL. /about is 'noindex, follow' because its links
// are still worth crawling, and so are an unlisted real activity's — it is a real
// class, simply not advertised. Nothing on a rehearsal is.
H.eq(robotsOf(tpl.renderActivityPage(unlisted, 'he')), 'noindex, follow',
  'an UNLISTED activity is noindex and still worth following — it is a real class');
H.eq(robotsOf(tpl.renderActivityPage(base({ robots: 'noindex' }), 'he')), 'noindex, follow',
  'an ordinary noindex activity keeps the follow it always had');
H.eq(robotsOf(tpl.renderActivityPage(ordinary, 'he')), 'index, follow',
  'and a listed one is untouched');
// The state wins over the select, rather than the two having to be set together.
H.eq(robotsOf(tpl.renderActivityPage(base({ listing: 'test', robots: 'index' }), 'he')),
  'noindex, nofollow',
  'choosing Test is enough — it is not a second thing to remember beside the robots select');
H.eq(robotsOf(tpl.renderActivityPage(base({ listing: 'unlisted', robots: 'index' }), 'he')),
  'noindex, follow', 'and the same for Unlisted');
// ⚠ ONE FUNCTION DECIDES IT, and both halves of the pairing read it. Asserting the
// meta tag and the sitemap separately is how they come to disagree.
const bareTpl = read('netlify/functions/_activity-template.js').replace(/^\s*\/\/.*$/gm, '');
H.ok(/robots: LISTING\.robotsFor\(activity\)/.test(bareTpl),
  'the template asks robotsFor() rather than deciding for itself');
const bareIdx = read('netlify/functions/_activity-index.js').replace(/^\s*\/\/.*$/gm, '');
H.ok(/LISTING\.robotsFor\(a\)\.indexOf\('noindex'\) === -1/.test(bareIdx),
  '⚠ and the sitemap advertises exactly what the page does not refuse — one ' +
  'function, so the meta tag and the sitemap cannot drift apart');

console.log('\n[no route to it: not the sitemap, not the listing, not the menu]');
const locs = (a) => idx.buildSitemap([a]).split('\n')
  .filter((l) => l.indexOf('<loc>') !== -1 && l.indexOf('test4') !== -1).length;
H.eq(locs(ordinary), 3, 'a listed activity is in the sitemap in all three languages');
H.eq(locs(unlisted), 0, 'an unlisted one is in none');
H.eq(locs(test), 0, 'and neither is a test one');
H.eq(locs(base({ robots: 'noindex' })), 0, 'nor a listed-but-noindex one, as before');

const listingPage = (a, lang) => idx.buildDerivedFiles([a])
  .find((f) => f.path === (lang === 'he' ? 'activities/index.html' : lang + '/activities/index.html')).content;
['he', 'en', 'ru'].forEach((lang) => {
  H.ok(listingPage(ordinary, lang).indexOf('test4') !== -1,
    'the ' + lang + ' listing carries a listed one');
  H.ok(listingPage(unlisted, lang).indexOf('test4') === -1, '   and not an unlisted one');
  H.ok(listingPage(test, lang).indexOf('test4') === -1, '   and not a test one');
});
// ⚠ AND `noindex` STILL DOES NOT HIDE IT FROM VISITORS. That flag is an
// instruction to a search engine, and confusing the two is exactly what the new
// Unlisted state exists to stop anybody having to do.
H.ok(listingPage(base({ robots: 'noindex' }), 'he').indexOf('test4') !== -1,
  'a listed-but-noindex activity is still ON the listing — robots speaks to crawlers');

console.log('\n[but it IS in activities-index.json, and that is the design]');
[['unlisted', unlisted], ['test', test]].forEach(([name, a]) => {
  const entries = idx.buildIndex([a]);
  H.eq(entries.length, 1, 'the ' + name + ' row is there');
  H.eq(entries[0].listing, name, '   carrying the state every other reader filters on');
  H.eq(entries[0].activityId, 'act-abc',
    '   and the activityId, which is the ONLY reason the row has to stay: slug -> id ' +
    'is how the family area opens a registration panel');
});
H.eq(idx.buildIndex([ordinary])[0].listing, 'listed',
  'a listed activity says so rather than saying nothing, so the field is never undefined');
// ⚠ AND THE OLD KEY IS GONE FROM THE FILE rather than kept beside the new one.
// Two machine-readable statements of one fact are two that can disagree.
H.ok(!('testActivity' in idx.buildIndex([test])[0]),
  'and testActivity is not published alongside it');

// The three handlers that resolve a slug through that file must not have grown a
// filter of their own. This is the half that would fail silently: registering
// would answer "no such activity" on an activity whose page is live.
['account-registrations.js', 'admin-registrations.js'].forEach((f) => {
  const src = read('netlify/functions/' + f).replace(/^\s*\/\/.*$/gm, '');
  H.ok(!/\blisting\b|testActivity/.test(src.slice(src.indexOf('activities-index.json'))),
    f + ' does not filter the index it uses as a lookup');
});

console.log('\n[the menu filters it, in the client that reads that file]');
const nav = read('js/nav.js');
H.ok(/var listing = a\.listing \|\| \(a\.testActivity \? 'test' : 'listed'\);/.test(nav),
  'js/nav.js reads the state');
H.ok(/if \(listing !== 'listed'\) return false;/.test(nav),
  'and keeps only the listed ones — so a state added later is hidden until somebody decides otherwise');
// ⚠ THE FALLBACK IS LOAD-BEARING AND IS NOT TIDINESS. This script reads the
// DEPLOYED activities-index.json, and that file is whatever the last publish
// wrote — so between this deploying and the next publish rebuilding the index,
// every row still says `testActivity` and none says `listing`. Reading only the
// new field there would put every test activity into the public menu for the
// length of that window.
H.ok(/a\.testActivity \? 'test'/.test(nav),
  '⚠ including the legacy flag, because the index on the live site is the one the ' +
  'last publish wrote and it has no `listing` in it yet');
// Executed rather than read, in the suite that owns the menu.
H.ok(/listing: 'test'/.test(read('tests/the-menu-names-the-activities.js')),
  'and the menu suite runs it against a real index rather than trusting these lines');

console.log('\n[it is structure, so a Russian-only role cannot unhide it or move its money]');
const admin = read('netlify/functions/activities-admin.js');
H.ok(/if \(incoming\.listing !== undefined\) \{[\s\S]{0,180}LST\.LISTINGS\.indexOf\(incoming\.listing\)/.test(admin),
  'the merge takes it only on the full-permission branch, and only a known value');
const restricted = admin.slice(admin.indexOf('  } else {', admin.indexOf('out.robots = ROBOTS')));
H.ok(/out\.listing = LST\.listingOf\(base\);/.test(restricted),
  'and a restricted role keeps the stored state');
const SIMPLE = admin.slice(admin.indexOf('const SIMPLE_KEYS'), admin.indexOf('const RICH_KEYS'));
H.ok(!/listing/.test(SIMPLE),
  'it is never a translatable scalar — one answer for all three trees, like robots');
// ⚠ AND IT MATTERS MORE THAN ROBOTS DOES NOW. This field decides which Stripe
// keys the activity's payments move on, so a restricted role able to write it
// would be a restricted role able to turn a rehearsal into real money.
H.eq(LST.paymentModeOf(test), 'test', 'Test is the test configuration');
H.eq(LST.paymentModeOf(unlisted), 'live', 'and Unlisted is REAL money — it is a real class');
H.eq(LST.paymentModeOf(ordinary), 'live', 'as is Listed');

console.log('\n[the form draws one select and reads it back]');
const ui = read('js/activities-admin.js');
H.ok(/id: 'f-listing'/.test(ui), 'the select exists');
H.ok(!/id: 'f-test'/.test(ui), 'and the tickbox is gone rather than left beside it');
H.ok(/rec\.listing = \(\$\('f-listing'\) && \$\('f-listing'\)\.value\) \|\| listingOf\(S\.record\);/.test(ui),
  '⚠ and a MISSING select keeps the stored state rather than reading as Listed — ' +
  'the undrawn-field trap, which here would publish a rehearsal to the world');
H.ok(/renderSettings/.test(ui.slice(0, ui.indexOf("id: 'f-listing'"))),
  'it is drawn in Settings, beside Status');
// ⚠ THE OPTIONS ARE SENT, NOT WRITTEN TWICE, so the client cannot offer a state
// the server will refuse.
H.ok(/listings: LST\.LISTINGS,/.test(admin), 'the schema sends the list');
H.ok(/\(S\.schema\.listings \|\| \['listed'\]\)\.forEach/.test(ui), 'and the form draws from it');
// The client's own copy of listingOf() exists because a browser cannot require a
// Netlify function. It has to agree with the server's, INCLUDING the legacy
// fallback — a record saved before this field existed must open on Test.
const clientListingOf = new Function('rec', ui.slice(ui.indexOf('var LISTINGS = ['),
  ui.indexOf('var $ = function')) + '\nreturn listingOf(rec);');
[{ testActivity: true }, { testActivity: false }, {}, { listing: 'unlisted' },
 { listing: 'test' }, { listing: 'listed' }, { listing: 'nonsense' },
 { listing: 'unlisted', testActivity: true }].forEach((rec) => {
  H.eq(clientListingOf(rec), LST.listingOf(rec),
    'the client agrees with the server on ' + JSON.stringify(rec));
});
// It is not a status, and must not become one: a hidden activity has to run
// through the same open-activity code a family meets.
const STATUSES = require('../netlify/functions/_activity-template').STATUS_GROUPS;
H.ok(!JSON.stringify(STATUSES || {}).includes('test') &&
     !JSON.stringify(STATUSES || {}).includes('unlisted'),
  'and neither state is a status — those decide what the page OFFERS, and a ' +
  'rehearsal must offer what the real thing does');

console.log('\n[and the admin picker is the one screen that can see it]');
H.ok(/listing: LST\.listingOf\(a\),/.test(admin), 'the list action reports it');
H.ok(/listingOf\(a\) !== 'listed'/.test(ui) && /class: 'pill ' \+ listingOf\(a\)/.test(ui),
  'and the picker marks anything that is not listed');
const css = read('admin/admin.css');
['test', 'unlisted'].forEach((k) => {
  H.ok(new RegExp('\\.pill\\.' + k + '\\{').test(css),
    '.pill.' + k + ' has a rule — a class nobody styled is a layout nobody designed');
});

H.done();
