// Derived files: the activities index, the three listing pages, and sitemap.xml.
//
// All of these are GENERATED. sitemap.xml in particular has to be, or a draft
// activity would linger in it after being unpublished — the sitemap is one of
// the places a "no longer published" page leaks from.
//
// Pure: activities in, file list out. No network, no clock.

const {
  LANGS, langsPresent, pick, pathFor, indexPathFor, indexFilePathFor,
  renderActivitiesIndexPage, SITE
} = require('./_activity-template');

// Only these ever reach the index, the listing pages or the sitemap.
// A draft has no files at all, so it can never appear.
const PUBLIC_STATUSES = ['announcement', 'open', 'waitlist', 'closed', 'cancelled', 'completed'];

const isPublic = (a) => a && PUBLIC_STATUSES.indexOf(a.status) !== -1;

// Static routes that are always in the sitemap. /about is deliberately absent:
// it is still placeholder copy and carries noindex.
//
// /privacy and /terms ARE here now. They carry real reviewed text, their
// noindex is gone, and the sitemap has to agree with the meta tag — a sitemap
// advertising a page that asks not to be indexed contradicts itself, which is
// the same pairing /about is still on the other side of.
const LEGAL_ALTS = (slug) => ({ he: '/' + slug, en: '/en/' + slug, ru: '/ru/' + slug });
const STATIC_ROUTES = [
  { path: '/', alts: { he: '/', en: '/en', ru: '/ru' } },
  { path: '/en', alts: { he: '/', en: '/en', ru: '/ru' } },
  { path: '/ru', alts: { he: '/', en: '/en', ru: '/ru' } },
  { path: '/privacy', alts: LEGAL_ALTS('privacy') },
  { path: '/en/privacy', alts: LEGAL_ALTS('privacy') },
  { path: '/ru/privacy', alts: LEGAL_ALTS('privacy') },
  { path: '/terms', alts: LEGAL_ALTS('terms') },
  { path: '/en/terms', alts: LEGAL_ALTS('terms') },
  { path: '/ru/terms', alts: LEGAL_ALTS('terms') }
];

// The index is a public file, so it carries only what a listing needs.
function indexEntry(a) {
  return {
    slug: a.slug,
    // The public registration form will know only the slug, from the URL, and
    // registrations key off the id. Publishing it here makes slug -> id a
    // lookup in a file the page already fetches rather than a round trip to a
    // function. It is an opaque identifier, not a secret: it names an activity
    // that is already public and grants nothing on its own.
    activityId: a.activityId || null,
    // Which activity this is a TERM of. Equal to activityId for every activity
    // that is a series of one, which is all of them until an admin links a
    // second term. Published here for the same reason activityId is: it is an
    // opaque identifier for something already public, and it saves a round trip
    // for anything that wants to show a course's terms together.
    seriesId: a.seriesId || a.activityId || null,
    // What KIND of activity, so a listing or a form can tell a semester course
    // from a pay-per-session one without opening the record.
    type: a.type || 'course',
    status: a.status,
    langs: langsPresent(a),
    title: a.title,
    summary: a.summary || null,
    cardImage: a.cardImage || null,
    // ⚠ UNLISTED, AND STILL IN THIS FILE — which looks like a contradiction and
    // is the whole design. A test activity is left out of the listing pages, the
    // sitemap and the menu, and it must NOT be left out of here: this index is
    // how a slug becomes an activityId, which is how the family area opens a
    // registration panel at all. Dropping the row would make the one thing a
    // test activity exists for — registering against it by direct link —
    // impossible.
    //
    // Publishing the flag costs nothing it protects. The file is public, the row
    // names an activity whose page is already served to anyone who asks for the
    // URL, and the flag is the instruction every reader of this file needs in
    // order to leave it out. What keeps a test activity out of sight is the
    // absence of a link to it, not the absence of a fact about it.
    testActivity: !!a.testActivity,
    isoUpdated: a.isoUpdated || null
  };
}

function buildIndex(activities) {
  return (activities || [])
    .filter(isPublic)
    .slice()
    .sort((a, b) => String(a.slug).localeCompare(String(b.slug)))
    .map(indexEntry);
}

function urlEntry(loc, alts) {
  const lines = Object.keys(alts).map(
    (l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${SITE}${alts[l]}"/>`
  );
  const first = alts.he || alts[Object.keys(alts)[0]];
  lines.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}${first}"/>`);
  return `  <url>\n    <loc>${SITE}${loc}</loc>\n${lines.join('\n')}\n  </url>`;
}

function buildSitemap(activities) {
  const blocks = STATIC_ROUTES.map((r) => urlEntry(r.path, r.alts));

  const listingAlts = { he: indexPathFor('he'), en: indexPathFor('en'), ru: indexPathFor('ru') };
  blocks.push('  <!-- Activities listing -->');
  LANGS.forEach((l) => blocks.push(urlEntry(indexPathFor(l), listingAlts)));

  // A noindex activity is still published and still listed on the site — that
  // flag is an instruction to search engines, not to visitors. But it must not
  // be advertised in the sitemap: the meta tag and the sitemap have to agree, or
  // the sitemap invites a crawler to a page that turns it away. /about already
  // pairs them the same way.
  const published = (activities || []).filter(isPublic)
    .filter((a) => a.robots !== 'noindex')
    // A test activity is never advertised anywhere. noindex and the sitemap have
    // to agree; here the page says 'noindex, nofollow' and there is no entry.
    .filter((a) => !a.testActivity);
  if (published.length) {
    blocks.push('  <!-- Activity pages. A draft activity has no files and never appears here. -->');
    published.forEach((a) => {
      const present = langsPresent(a);
      const alts = {};
      present.forEach((l) => { alts[l] = pathFor(a.slug, l); });
      present.forEach((l) => blocks.push(urlEntry(pathFor(a.slug, l), alts)));
    });
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- GENERATED FILE — rebuilt on every activity publish/unpublish.
     Edit netlify/functions/_activity-index.js, not this file. -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${blocks.join('\n')}
</urlset>
`;
}

// The full set of derived files, given the complete list of activities.
function buildDerivedFiles(activities) {
  const index = buildIndex(activities);
  const files = [
    {
      path: 'activities/activities-index.json',
      content: JSON.stringify(index, null, 2) + '\n',
      encoding: 'utf-8'
    },
    { path: 'sitemap.xml', content: buildSitemap(activities), encoding: 'utf-8' }
  ];
  const published = (activities || []).filter(isPublic);
  // ⚠ THE LISTING IS THE NARROWER LIST, AND THE INDEX IS NOT.
  //
  // buildIndex() above keeps every published activity, test ones included,
  // because that file is a lookup rather than a shop window. These three pages
  // ARE the shop window, and the menu is built from the index by a client that
  // applies the same filter — see js/nav.js. Two readers, one flag, and the one
  // that resolves ids must not be the one that hides rows.
  const listed = published.filter((a) => !a.testActivity);
  LANGS.forEach((lang) => {
    files.push({
      path: indexFilePathFor(lang),
      content: renderActivitiesIndexPage(listed, lang),
      encoding: 'utf-8'
    });
  });
  return files;
}

module.exports = { PUBLIC_STATUSES, isPublic, buildIndex, buildSitemap, buildDerivedFiles, indexEntry };
