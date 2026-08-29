// What this defends against:
//
// Two SEO fields were missing, and both failed quietly rather than loudly.
//
// ROBOTS. Every activity page was hardcoded 'index, follow'. There was no way to
// put up a page that is live but should not be found in search — a private
// group, or something being shared by link before it is announced. The trap is
// that a robots flag has a second half: /about is noindex AND absent from
// sitemap.xml, because a sitemap advertising a page that asks not to be indexed
// contradicts itself and the crawler is entitled to believe either one. So the
// meta tag and the sitemap have to move together, which is what gets forgotten.
//
// SHARE IMAGE. og:image was hardcoded to the site's own og-image.jpg, with
// og:image:width and og:image:height declared as 1200x630 beside it. Those two
// numbers were true only because every activity used the same file. The moment
// an activity can supply its own, they are a promise about a picture an admin
// chose — which is why the upload is CROPPED to that ratio rather than hinted
// at, and why the share slot goes through the same optimiser as everything else.
//
// Both are one answer for all three languages, so both are structure: a role
// that may only edit Russian must not be able to deindex the Hebrew page.

const H = require('./_helpers');
const tpl = require('../netlify/functions/_activity-template');
const idx = require('../netlify/functions/_activity-index');
const IO = require('../js/image-optimize.js');

const base = () => ({
  slug: 'purim-workshop', status: 'open',
  title: { he: 'סדנת פורים', en: 'Purim workshop', ru: 'Мастерская' },
  about: { he: 'תיאור', en: 'Description', ru: 'Описание' },
  facts: {}, teachers: [], sponsors: [], faq: []
});
const robotsOf = (html) => (/name="robots" content="([^"]+)"/.exec(html) || [])[1];
const ogImageOf = (html) => (/og:image" content="([^"]+)"/.exec(html) || [])[1];

console.log('[robots: indexed by default, and it still says so]');
H.eq(robotsOf(tpl.renderActivityPage(base(), 'he')), 'index, follow', 'the default is unchanged');
H.eq(robotsOf(tpl.renderActivityPage(Object.assign(base(), { robots: 'index' }), 'en')), 'index, follow',
     'an explicit index is the same thing');

console.log('\n[noindex matches the convention the site already uses]');
// /about is 'noindex, follow' — kept out of results, its links still followed.
const noi = Object.assign(base(), { robots: 'noindex' });
['he', 'en', 'ru'].forEach((lang) => {
  H.eq(robotsOf(tpl.renderActivityPage(noi, lang)), 'noindex, follow', 'the ' + lang + ' page is noindex, follow');
});
const about = require('fs').readFileSync(require('path').join(__dirname, '..', 'about.html'), 'utf8');
H.ok(about.indexOf('content="noindex, follow"') !== -1,
     'which is the same string /about uses, rather than a second convention');

console.log('\n[and the sitemap agrees with the meta tag]');
const locs = (a) => idx.buildSitemap([a]).split('\n').filter((l) => l.indexOf('<loc>') !== -1 && l.indexOf('purim') !== -1).length;
H.eq(locs(base()), 3, 'an indexed activity is listed in all three languages');
H.eq(locs(noi), 0, 'a noindex activity is listed in none');
// But it is not hidden from the site itself: robots is an instruction to search
// engines, not to visitors.
const listing = idx.buildDerivedFiles([noi]).find((f) => f.path === 'activities/index.html').content;
H.ok(listing.indexOf('purim-workshop') !== -1, 'it still appears on the activities listing');
H.ok(idx.buildIndex([noi]).length === 1, 'and still in activities-index.json');

console.log('\n[share image: the activity own, else the site one]');
H.eq(ogImageOf(tpl.renderActivityPage(base(), 'he')), 'https://www.ogen.cy/images/og-image.jpg',
     'with none of its own, a shared link still uses the branded site image');
const shared = Object.assign(base(), { shareImage: '/images/activities/purim-workshop-share.jpg' });
['he', 'en', 'ru'].forEach((lang) => {
  H.eq(ogImageOf(tpl.renderActivityPage(shared, lang)),
       'https://www.ogen.cy/images/activities/purim-workshop-share.jpg',
       'the ' + lang + ' page shares the activity own image');
});
// One picture for every language: the same URL in all three, never a per-language one.
const urls = ['he', 'en', 'ru'].map((l) => ogImageOf(tpl.renderActivityPage(shared, l)));
H.eq(new Set(urls).size, 1, 'and it is the same picture in every language');

console.log('\n[the declared 1200x630 is true, because the upload is cropped to it]');
const html = tpl.renderActivityPage(shared, 'he');
H.ok(html.indexOf('<meta property="og:image:width" content="1200">') !== -1, 'the width is still declared');
H.ok(html.indexOf('<meta property="og:image:height" content="630">') !== -1, 'and the height');
H.ok(!!IO.PROFILES.share, 'there is a share profile');
H.eq(IO.PROFILES.share.ratio, 1200 / 630, 'asking for exactly that ratio');
const big = IO.ratioCrop(2000, 1000, IO.PROFILES.share.ratio, IO.PROFILES.share.maxEdge);
H.eq(big.width, 1200, 'a 2000x1000 upload comes out 1200 wide');
H.eq(big.height, 630, 'and 630 tall');
H.ok(big.cropped, 'having been cropped, not squashed');
const already = IO.ratioCrop(1200, 630, IO.PROFILES.share.ratio, 1200);
H.ok(!already.cropped, 'a picture already at the ratio is not cropped');
H.ok(!already.scaled, 'nor scaled');
const tiny = IO.ratioCrop(600, 1200, IO.PROFILES.share.ratio, 1200);
H.eq(tiny.width, 600, 'a portrait upload is never scaled UP to fill the ratio');
H.eq(tiny.height, 315, 'it is cropped at its own size');

console.log('\n[both are structure, so a language-restricted role cannot touch them]');
const admin = require('fs').readFileSync(require.resolve('../netlify/functions/activities-admin'), 'utf8');
const merge = admin.slice(admin.indexOf('  if (full) {'));
H.ok(/if \(incoming\.shareImage !== undefined\) out\.shareImage/.test(merge), 'a full session may set the share image');
H.ok(/if \(incoming\.robots !== undefined\)/.test(merge), 'and the robots flag');
H.ok(merge.indexOf('incoming.shareImage !== undefined') < merge.indexOf('base.shareImage'),
     'and the restricted branch comes second, keeping what was there');
H.ok(/out\.robots = \(base && base\.robots\) \|\| 'index'/.test(merge),
     'a restricted role cannot deindex a page');
H.ok(/ROBOTS\.indexOf\(incoming\.robots\) !== -1/.test(merge),
     'and an unknown robots value is not written through');

console.log('\n[the share image is a file the record owns, so it is cleaned up]');
const { _internal } = require('../netlify/functions/activities-admin');
H.ok(admin.indexOf('take(activity.shareImage)') !== -1,
     'imagePathsOf counts it, so deleting an activity deletes it and a replaced one is not orphaned');
H.ok(/activity\.shareImage = take\(activity\.shareImage, 'share'\)/.test(admin),
     'and an upload goes through the shared optimiser at the share slot');
H.eq(JSON.stringify(_internal.FIELD_SCHEMA.robotsOptions), '["index","noindex"]',
     'the robots choices are on the schema root, beside statuses and motifs');
H.eq(JSON.stringify(_internal.FIELD_SCHEMA.seo.map((f) => f.key)), '["metaTitle","metaDescription"]',
     'and the SEO group stays the translatable fields only');

H.done();
