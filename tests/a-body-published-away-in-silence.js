// What this defends against:
//
// ⚠ A PUBLISH BLANKED A LIVE PAGE'S ENTIRE BODY AND NOTHING SAID A WORD.
//
// Reported as "I refreshed and lost the HE copy", looking at an empty Hebrew
// About editor. The refresh revealed it rather than causing it. Git says what
// happened, to the second:
//
//     4e75751  14:56:21Z  hebrew4kids  about.he = 1614 characters
//     086510d  14:56:52Z  hebrew4kids  about.he = ""
//
// The same publish changed metaTitle.he and metaKeywords.he, so an admin was
// editing Hebrew wording at the time. The body came back empty in that save and
// NOTHING OBJECTED — `activities/hebrew4kids.html` was regenerated with an empty
// `<div class="activity-main">` and served to the public, and the text had to be
// recovered out of git.
//
// ⚠ AND THE ASTERISK WAS A PROMISE NOTHING KEPT. `about` is `required: true` in
// FIELD_SCHEMA; the client renders that as "About this activity *" and checks
// nothing; validate() has enforced `title` since it was written and had never
// once enforced this. Three statements of one rule and only one of them ran.
//
// ⚠ THE NAIVE FIX — a published language must have an About — WAS NOT AVAILABLE,
// and that is asserted here on the REAL records: test8, test10, test11 and
// test12 are published today with titles in all three languages and no About at
// all, so requiring one would make four live activities unpublishable by a rule
// they have never met. What is refused is the event that actually happened: a
// language that HAD a body being handed an empty one.
//
// ⚠ AND IT IS MEASURED AGAINST WHAT WAS PUBLISHED, never the working copy. A
// draft supersedes the published file in currentRecord(), so Save-then-Publish —
// the ordinary way this site is edited, and what the timestamps above describe —
// hands the comparison a record that is already blank. The suite drives exactly
// that sequence through the real handlers, because a source-level check cannot
// see it. Same trap `_publishedBefore` exists for in generate().
//
// ⚠ AND PLAIN TEXT GOES ON SAVING EVERYWHERE. Emptiness is TEXT, through the
// same plainText() the meta description and the listing blurb are built from, so
// a record written before the Quill editor — plain prose, no tags — is a body
// like any other, and Quill's own empty document (`<p><br></p>`, three tags and
// no words) is not.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const A = require(H.fnPath('activities-admin'))._internal;
const { migrate } = require(H.fnPath('_activity-migrate'));

// =========================================================================
console.log('[the rule itself: pure, and it takes BOTH records]');

const TITLES = { he: 'חוג', en: 'Class', ru: 'Кружок' };
const rec = (about, title) => ({ slug: 'x', title: title || TITLES, about: about });
const PUB = rec({ he: '<p>שלום</p>', en: 'plain prose, no tags at all', ru: '<h2>Привет</h2>' });
const langs = (next) => A.emptiedBodies(PUB, next).map((m) => m.split(':')[0]).join(',');

// ⚠ THE ACCEPTING HALF FIRST. "This is refused" on its own passes on a rule that
// refuses everything, and that failure is only ever found by an admin who can no
// longer publish.
H.eq(langs(PUB), '', 'republishing a record unchanged is refused nothing');
H.eq(langs(rec({ he: '<p>שלום שלום</p>', en: 'edited prose', ru: '<h2>Привет</h2>' })), '',
  'and editing the words is an ordinary save');
H.eq(A.emptiedBodies(null, PUB).length, 0,
  'a brand-new activity has no published copy and nothing to protect');
H.eq(A.emptiedBodies(rec({ he: '', en: '', ru: '' }), rec({ he: '', en: '', ru: '' })).length, 0,
  '⚠ AND AN ACTIVITY THAT NEVER HAD A BODY GOES ON PUBLISHING — which is four ' +
  'live records, and the whole reason this is not "an About is required"');

H.eq(langs(rec({ he: '', en: 'plain prose, no tags at all', ru: '<h2>Привет</h2>' })), 'Hebrew',
  '⚠ AND BLANKING ONE IS NAMED, by language');
H.eq(langs(rec({ he: '<p>שלום</p>', en: '', ru: '<h2>Привет</h2>' })), 'English',
  'whichever language it is');
H.eq(langs(rec({})), 'Hebrew,English,Russian',
  'and three at once is three sentences — fixing one and republishing must not ' +
  'turn up the next two one at a time');

const one = A.emptiedBodies(PUB, rec({ he: '', en: 'x', ru: '<h2>П</h2>' }))[0];
H.ok(/^Hebrew: /.test(one), 'the language is the first word: ' + one);
H.ok(/still on the live page/.test(one),
  '⚠ and it says the text is not lost, because at that moment it genuinely is not');
H.ok(/clear its title/.test(one),
  'and it names the way to take a page down, rather than leaving it to be found');

// =========================================================================
console.log('\n[⚠ emptiness is TEXT, not markup]');

const blanks = ['', '   ', '<p></p>', '<p><br></p>', '<p>&nbsp;</p>', '<h2></h2>\n<p><br></p>'];
blanks.forEach((v) => {
  H.eq(langs(rec({ he: v, en: 'x', ru: '<h2>П</h2>' })), 'Hebrew',
    JSON.stringify(v) + ' has no words in it, so it is a blank body');
});
// ⚠ AND PLAIN TEXT IS A BODY. Every record written before the Quill editor holds
// prose with no tags, and the escaping branch in richText() still renders it —
// reading it as empty would refuse every one of those saves.
const bodies = ['Hello', 'שלום', '5 < 10 is true', 'a\n\nb', '<p>x</p>'];
bodies.forEach((v) => {
  H.eq(langs(rec({ he: v, en: 'x', ru: '<h2>П</h2>' })), '',
    JSON.stringify(v) + ' is a body and saves exactly as it does today');
});

// =========================================================================
console.log('\n[⚠ a language being TAKEN DOWN is not a language being emptied]');
// A page is published only while it has its own title, and generate() DELETES
// the file for one that loses it. So clearing a title and its body together
// removes that page rather than gutting it, which is the honest way to retire a
// translation and must not be refused.
H.eq(langs(rec({ he: '<p>שלום</p>', en: '', ru: '<h2>П</h2>' }, { he: 'חוג', en: '', ru: 'Кружок' })), '',
  'the English page is going away, so its empty body is not a blanked body');
H.eq(langs(rec({ he: '', en: '', ru: '' }, { he: 'חוג', en: '', ru: '' })), 'Hebrew',
  'and the languages that REMAIN are still checked in the same save');

// =========================================================================
console.log('\n[the wiring: one helper, and the published record is read for it]');

const admin = read('netlify/functions/activities-admin.js');
const mf = admin.slice(admin.indexOf('async function mergeFor(record, incoming, session)'),
                       admin.indexOf('// ⚠ THE SECOND RECORD'));
H.ok(/bodiesEmptied = await emptiedBodiesFor\(merged\)/.test(mf),
  '⚠ mergeFor() gathers it, so saveDraft, preview and publish all inherit the rule');

const gather = admin.slice(admin.indexOf('async function emptiedBodiesFor(merged)'),
                           admin.indexOf('// ⚠ REMOVING A GROUP SOMEBODY IS REGISTERED TO'));
H.ok(gather.length > 60, 'the gathering step is in activities-admin.js');
H.ok(/emptiedBodies\(await getPublished\(merged\.slug\), merged\)/.test(gather),
  '⚠ THE BEFORE IS getPublished(), never `record` — which is the working copy, ' +
  'and a draft supersedes the published file in currentRecord()');
H.ok(/return \[\];\n\s*return emptiedBodies/.test(gather.replace(/\n\s*\/\/[^\n]*/g, '')) ||
     gather.indexOf('return [];') < gather.indexOf('getPublished'),
  '⚠ AND GITHUB IS ASKED ONLY WHEN A BLANK IS PRESENT — a save whose every ' +
  'published language has something to read pays nothing for this rule');
H.ok(/langsPresent\(merged\)\.some\(\(l\) => plainText\(now\[l\]\) === ''\)/.test(gather),
  'and the cheap test is the same one the pure rule applies');

['preview', 'saveDraft', 'publish'].forEach((a) => {
  const at = admin.indexOf("case '" + a + "': {");
  H.ok(at !== -1, a + ' is a case');
  const body = admin.slice(at, admin.indexOf('\n      case ', at + 10));
  H.ok(/bodiesEmptied/.test(body), a + ' reads the answer rather than dropping it');
});
H.ok(/if \(bodiesEmptied\.length\) refuse\(bodiesEmptied\)/.test(
  admin.slice(admin.indexOf("case 'publish': {"))),
  'publish refuses');
H.ok(/bodiesEmptied\.forEach\(\(m\) => warnings\.push\(m\)\)/.test(admin),
  '⚠ and a draft is TOLD in the same string — one rule, not two accounts of it');

// =========================================================================
console.log('\n[⚠ on the REAL records: every published activity still publishes]');
// The intent is the data. A rule that made a live activity unpublishable would
// surface as somebody pressing Publish on an unrelated edit and being refused.
let noAbout = 0;
fs.readdirSync(path.join(R, 'activities'))
  .filter((f) => f.endsWith('.json') && f !== 'activities-index.json')
  .forEach((f) => {
    const r = migrate(JSON.parse(read('activities/' + f)));
    H.eq(A.emptiedBodies(r, r).length, 0, f + ' republishes unchanged with nothing refused');
    if (!['he', 'en', 'ru'].some((l) => String((r.about || {})[l] || '').trim())) noAbout++;
  });
H.ok(noAbout >= 4,
  '⚠ and ' + noAbout + ' of them carry NO About in any language — the reason the ' +
  'obvious rule was not the one built');

// =========================================================================
console.log('\n[executed: the real handlers, and the Save-then-Publish that did it]');

(async () => {
  const seed = H.seedRepo();
  const gh = H.makeGithub(seed.files);
  const bl = H.makeBlobs();
  const mods = H.loadWithStubs({ blobs: bl, github: gh, modules: ['activities-admin'] });
  const api = mods['activities-admin'];
  const session = await H.installSession(bl, H.superAdminSession());
  const as = { token: session.token };

  const loaded = await H.call(api.handler, Object.assign({ action: 'load', slug: 'hebrew-for-kids' }, as));
  H.eq(loaded.status, 200, 'the seeded activity loads');
  const live = loaded.body.activity;
  H.ok(String(live.about.he).trim() !== '', 'and it has a Hebrew body to lose');

  const blank = (base) => {
    const next = JSON.parse(JSON.stringify(base));
    next.about = Object.assign({}, next.about, { he: '' });
    return next;
  };

  // ⚠ AN ORDINARY EDIT FIRST. This is the half that must keep working.
  const worded = JSON.parse(JSON.stringify(live));
  worded.about.he = 'נוסח חדש לגמרי לגוף העמוד.';
  const fine = await H.call(api.handler, Object.assign({ action: 'publish',
    activity: worded, baseUpdatedAt: live.isoUpdated }, as));
  H.eq(fine.status, 200, 'rewriting the Hebrew body publishes');
  H.ok(gh._files.get('activities/hebrew-for-kids.html').includes('נוסח חדש'),
    'and reaches the page');
  const now = fine.body.activity;

  // The publish that used to go through in silence.
  const refused = await H.call(api.handler, Object.assign({ action: 'publish',
    activity: blank(now), baseUpdatedAt: now.isoUpdated }, as));
  H.eq(refused.status, 500, '⚠ AND BLANKING IT IS REFUSED, where it used to answer 200');
  H.ok(/^Hebrew: /.test(refused.body.error), 'naming the language: ' + refused.body.error);
  H.eq((refused.body.validation || []).length, 1,
    'through the same channel a missing title or a removed group uses');

  // ⚠ NOTHING WAS WRITTEN. A refusal that had already committed the pages would
  // be the bug with an error message on top of it.
  H.ok(gh._files.get('activities/hebrew-for-kids.html').includes('נוסח חדש'),
    '⚠ and the live Hebrew page still has its body');

  // Preview refuses too: a preview that renders what a publish would not is a
  // preview that lies, which is the one thing preview-matches-publish forbids.
  const prev = await H.call(api.handler, Object.assign({ action: 'preview',
    activity: blank(now) }, as));
  H.eq(prev.status, 500, 'preview refuses on the same rule');

  // A draft saves whatever is in it — and is told.
  const draft = await H.call(api.handler, Object.assign({ action: 'saveDraft',
    activity: blank(now), baseUpdatedAt: now.isoUpdated }, as));
  H.eq(draft.status, 200, '⚠ THE DRAFT STILL SAVES — work in progress is not fought with');
  H.ok((draft.body.warnings || []).some((w) => /^Hebrew: /.test(w)),
    'and the warning is the publish refusal, word for word');
  H.eq((draft.body.warnings || []).filter((w) => /^Hebrew: /.test(w))[0], refused.body.error,
    'one validate(), one string, two moments');

  // =====================================================================
  // ⚠ THE SEQUENCE THAT ACTUALLY HAPPENED, and the one a source read cannot see.
  //
  // The blank is now the DRAFT, and currentRecord() prefers a draft — so a rule
  // comparing against the working copy would find a blank against a blank, say
  // nothing had moved, and publish the empty page. This is the second press.
  //
  // ⚠ AND IT IS SENT WITH A PUBLISHABLE STATUS. saveDraft stamps `draft`, and a
  // draft is refused several lines earlier with "Set a status other than Draft" —
  // so leaving it would make this assertion pass on a build where the rule had
  // been reverted entirely. A bite-check is what said so.
  const second = blank(draft.body.activity);
  second.status = 'open';
  const after = await H.call(api.handler, Object.assign({ action: 'publish',
    activity: second, baseUpdatedAt: draft.body.baseUpdatedAt }, as));
  H.eq(after.status, 500,
    '⚠ SAVE-THEN-PUBLISH IS STILL REFUSED — the comparison is against what was ' +
    'PUBLISHED, not the draft that already carries the blank');
  H.ok(/^Hebrew: /.test(after.body.error), 'naming the same language: ' + after.body.error);
  H.ok(gh._files.get('activities/hebrew-for-kids.html').includes('נוסח חדש'),
    'and the page is untouched a second time');

  // And putting the words back publishes, which is what the message asked for.
  const fixed = JSON.parse(JSON.stringify(draft.body.activity));
  fixed.status = 'open';   // saveDraft stamps `draft`, and a draft is never committed
  fixed.about.he = 'הטקסט חזר.';
  const ok = await H.call(api.handler, Object.assign({ action: 'publish',
    activity: fixed, baseUpdatedAt: draft.body.baseUpdatedAt }, as));
  H.eq(ok.status, 200, 'pasting the text back publishes');
  H.ok(gh._files.get('activities/hebrew-for-kids.html').includes('הטקסט חזר'),
    'and the body is on the page');

  // ⚠ AND A PAGE BEING RETIRED IS NOT REFUSED. Clearing a title removes that
  // language's file; clearing its body at the same time is part of the same act.
  const retire = JSON.parse(JSON.stringify(ok.body.activity));
  retire.title = Object.assign({}, retire.title, { en: '' });
  retire.about = Object.assign({}, retire.about, { en: '' });
  const down = await H.call(api.handler, Object.assign({ action: 'publish',
    activity: retire, baseUpdatedAt: ok.body.activity.isoUpdated }, as));
  H.eq(down.status, 200, '⚠ taking the English page down goes through');
  H.ok((down.body.deletes || []).indexOf('en/activities/hebrew-for-kids.html') !== -1,
    'and the file is deleted rather than emptied');

  H.done();
})().catch((err) => { console.error(err); process.exit(1); });
