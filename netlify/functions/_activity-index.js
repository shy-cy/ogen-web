// Derived files: the activities index, the three listing pages, and sitemap.xml.
//
// All of these are GENERATED. sitemap.xml in particular has to be, or a draft
// activity would linger in it after being unpublished — the sitemap is one of
// the places a "no longer published" page leaks from.
//
// Pure: activities in, file list out. No network, no clock.

const {
  LANGS, langsPresent, pick, pathFor, indexPathFor, indexFilePathFor,
  renderActivitiesIndexPage, SITE,
  calendarPathFor, calendarFilePathFor, renderCalendarPage
} = require('./_activity-template');
const CAL = require('./_activity-calendar');
// Which of the three listing states this activity is in, and what that tells a
// crawler. One function, so the meta tag and the sitemap cannot disagree.
const LISTING = require('./_activity-listing');

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
    // ⚠ HIDDEN, AND STILL IN THIS FILE — which looks like a contradiction and is
    // the whole design. An unlisted or test activity is left out of the listing
    // pages, the sitemap and the menu, and it must NOT be left out of here: this
    // index is how a slug becomes an activityId, which is how the family area
    // opens a registration panel at all. Dropping the row would make the one
    // thing a hidden activity exists for — registering against it by direct link
    // — impossible.
    //
    // Publishing the state costs nothing it protects. The file is public, the row
    // names an activity whose page is already served to anyone who asks for the
    // URL, and the state is the instruction every reader of this file needs in
    // order to leave it out. What keeps it out of sight is the absence of a link
    // to it, not the absence of a fact about it.
    //
    // ⚠ AND `testActivity` IS GONE FROM HERE RATHER THAN KEPT BESIDE IT. Two
    // machine-readable statements of one fact are two statements that can
    // disagree; js/nav.js reads `listing` and falls back to the old key only for
    // an index file deployed before this change, which one publish replaces.
    listing: LISTING.listingOf(a),
    isoUpdated: a.isoUpdated || null
  };
}

// ⚠ ONE ORDER, AND UNTIL THIS THERE WERE THREE.
//
// Reported as "the placement of the activity cards keeps changing". It did, and
// the cause is that the listing pages had NO SORT AT ALL — they rendered the set
// in whatever order it arrived, and a publish hands that set over as
// `others.concat([activity])`, so the activity you just published moved to the
// END of the public listing. Measured on the live site: slug order, with
// beit-midrash (published that morning) last.
//
// The index file was sorted by slug, the listing pages were sorted by nothing,
// and the menu sorted by translated title — so the same six activities came out
// in three different orders, one of which changed every time anybody pressed
// Publish. None of the three was anybody's intended order, because nothing
// anywhere stated one.
//
// `listingOrder` is that statement: a number on the record, ascending, and
// everything without one after everything with one, then by slug so the answer
// is total rather than merely mostly-decided. A new activity therefore lands at
// the end predictably instead of wherever the reader happened to put it.
//
// ⚠ IT IS THE FILE'S ORDER THAT IS PUBLISHED, NOT THE NUMBER. The menu reads
// activities-index.json and keeps the order it finds, so there is one answer
// rather than a field every client re-implements a sort on — and `Array#sort`
// is stable, which is what lets the menu group by status and still preserve it.
//
// ⚠ AND IT IS NOT WRITABLE THROUGH THE API YET, deliberately. There is no
// control for it on the form, so nothing sends it; mergeByPermission() copies
// the stored record and overwrites only the keys it names, so the value survives
// every save by construction rather than by the client echoing it back. That is
// the undrawn-field trap answered the one way that cannot be got wrong, and it
// holds until the ordering UI is built. It is structure either way — one answer
// for all three trees — so a Russian-only role could never have written it.
// ⚠ A BLANK IS NOT A ZERO. `Number(null)` and `Number('')` are both 0, so the
// obvious one-liner would sort every activity that has no order to the FRONT of
// the listing — the opposite of what "no order yet" means, and invisible until
// somebody publishes a new activity and finds it leading the page. Same trap
// capacity has in the other direction, where a missing group size must read as
// uncapped rather than as nought.
const orderOf = (a) => {
  const v = a ? a.listingOrder : null;
  if (v === null || v === undefined || v === '') return Infinity;
  const n = Number(v);
  return Number.isFinite(n) ? n : Infinity;
};

function inListingOrder(activities) {
  return (activities || []).slice().sort((a, b) =>
    orderOf(a) - orderOf(b) || String(a.slug).localeCompare(String(b.slug)));
}

function buildIndex(activities) {
  return inListingOrder((activities || []).filter(isPublic)).map(indexEntry);
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
  // The calendar is a real page about real activities and is worth indexing.
  // A MAP KEYED BY LANGUAGE, the shape urlEntry() reads — it does Object.keys()
  // over this, so an array of {lang, path} yields hreflang="0" and an href of
  // "[object Object]". Caught by generating the file and reading it, not by the
  // suite, which is why the sitemap is now asserted on its rendered output.
  const calAlts = { he: calendarPathFor('he'), en: calendarPathFor('en'), ru: calendarPathFor('ru') };
  LANGS.forEach((l) => blocks.push(urlEntry(calendarPathFor(l), calAlts)));

  // A noindex activity is still published and still listed on the site — that
  // flag is an instruction to search engines, not to visitors. But it must not
  // be advertised in the sitemap: the meta tag and the sitemap have to agree, or
  // the sitemap invites a crawler to a page that turns it away. /about already
  // pairs them the same way.
  // ⚠ ASKED THROUGH robotsFor(), WHICH IS WHAT THE PAGE'S OWN META TAG IS BUILT
  // FROM. The pairing has to hold across three listing states and the robots
  // select on top of them, and the only way it cannot drift is for both halves to
  // read one function: anything the page tells a crawler not to index is
  // something this file may not advertise.
  const published = (activities || []).filter(isPublic)
    .filter((a) => LISTING.robotsFor(a).indexOf('noindex') === -1);
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

// One row per session, per language, ready for the page to print. Built here
// rather than in the template because the price comes from _activity-facts.js
// and the template is handed finished strings everywhere else.
//
// ⚠ THE AUDIENCE IS `public`, so an `unlisted` activity is absent — it is off
// the listing, out of the hamburger and out of sitemap.xml, and a what's-on page
// listing it would undo exactly that. The admin's own calendar passes `admin`
// and sees it, because a real class occupies a real room.
//
// ⚠ NO PRICE, ANYWHERE ON THIS PAGE, and it is a decision rather than an
// omission. A calendar answers WHEN; the activity page answers what it costs,
// and the listing card already carries the one comparable figure. Printing a
// term price on one row beside a per-session price on the next invites exactly
// the comparison the price card was rebuilt to stop making — €300 next to €7
// reads as one being cheap, when they buy different things. A reader who wants
// the cost is one tap from the page that explains it properly.
function calendarRows(activities, lang) {
  const bySlug = {};
  (activities || []).forEach((a) => { bySlug[a.slug] = a; });
  return CAL.timetable(activities, 'public')
    .filter((s) => {
      const a = bySlug[s.slug];
      return a && langsPresent(a).indexOf(lang) !== -1;
    })
    .map((s) => {
      const a = bySlug[s.slug];
      return {
        date: s.date,
        time: s.time || '',
        endsAt: s.endsAt || '',
        slug: s.slug,
        title: pick(a.title, lang),
        href: pathFor(s.slug, lang),
        type: s.type,
        // The GENERAL area only. The exact address is members-only and is
        // filtered by isPubliclyVisible() everywhere else; a public grid naming
        // where a child will be at 16:00 next Tuesday is the worst place on the
        // site to leak it, so it is never read here at all.
        where: pick(s.location, lang) || ''
      };
    });
}

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
  // buildIndex() above keeps every published activity, hidden ones included,
  // because that file is a lookup rather than a shop window. These three pages
  // ARE the shop window, and the menu is built from the index by a client that
  // applies the same filter — see js/nav.js. Two readers, one field, and the one
  // that resolves ids must not be the one that hides rows.
  // ⚠ IN THE SAME ORDER THE INDEX IS IN. This line used to hand the renderer
  // the set exactly as it arrived, which is why the card you published last sat
  // at the end of the public listing.
  const listed = inListingOrder(published.filter(LISTING.isListed));
  LANGS.forEach((lang) => {
    files.push({
      path: indexFilePathFor(lang),
      content: renderActivitiesIndexPage(listed, lang),
      encoding: 'utf-8'
    });
    // The month calendar, built from the SAME published set. It filters to
    // `listed` itself, through _activity-calendar.js, rather than being handed
    // the narrowed list — one predicate, in the module that owns it.
    files.push({
      path: calendarFilePathFor(lang),
      content: renderCalendarPage(calendarRows(published, lang), lang),
      encoding: 'utf-8'
    });
  });
  return files;
}

module.exports = { PUBLIC_STATUSES, isPublic, buildIndex, buildSitemap, buildDerivedFiles, calendarRows,
                   indexEntry, inListingOrder };
