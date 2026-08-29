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
const STATIC_ROUTES = [
  { path: '/', alts: { he: '/', en: '/en', ru: '/ru' } },
  { path: '/en', alts: { he: '/', en: '/en', ru: '/ru' } },
  { path: '/ru', alts: { he: '/', en: '/en', ru: '/ru' } }
];

// The index is a public file, so it carries only what a listing needs.
function indexEntry(a) {
  return {
    slug: a.slug,
    status: a.status,
    langs: langsPresent(a),
    title: a.title,
    summary: a.summary || null,
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

  const published = (activities || []).filter(isPublic);
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
  LANGS.forEach((lang) => {
    files.push({
      path: indexFilePathFor(lang),
      content: renderActivitiesIndexPage(published, lang),
      encoding: 'utf-8'
    });
  });
  return files;
}

module.exports = { PUBLIC_STATUSES, isPublic, buildIndex, buildSitemap, buildDerivedFiles, indexEntry };
