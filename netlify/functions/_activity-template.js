// The ONE copy of the activity page markup.
//
// renderActivityPage(activity, lang) is pure: record in, complete HTML
// document out. No network, no clock, no Blobs, no side effects. Preview and
// publish both go through it, so a preview cannot render differently from what
// gets committed.
//
// The markup here was extracted verbatim from the hand-authored
// activities/hebrew-for-kids.html that shipped earlier. From now on those page
// files are BUILD ARTIFACTS: hand-editing one works right up until the next
// admin save silently overwrites it. Fix the source JSON, not the HTML.
//
// Every user-facing string in a record is a { he, en, ru } object, never a
// bare string. Section headings and sidebar labels are NOT admin-editable —
// they are fixed per language and live in LABELS below.

const { sidebarGroups } = require('./_activity-facts');

// Sidebar group icons. Lucide, drawn white inside a solid circle, which is the
// site's icon rule. The circle is 34px rather than the 56px used for section
// eyebrows and offer cards: those sit in open space on a full-width section,
// this one sits beside two lines of text in a 320px column, and a 56px disc
// there is larger than the text it labels.
//
// One colour per group, taken from the offer-card rotation so the activity page
// and the homepage use the same three.
const GROUP_ICONS = {
  participants: {
    color: 'var(--olive)',
    svg: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M16 3.128a4 4 0 0 1 0 7.744"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/>'
  },
  schedule: {
    color: 'var(--terracotta)',
    svg: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/>'
  },
  practical: {
    color: 'var(--navy)',
    svg: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>'
  }
};

function groupIcon(key) {
  const icon = GROUP_ICONS[key];
  if (!icon) return '';
  return `<span class="sidebar-group-icon" style="background:${icon.color}">` +
    '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    icon.svg + '</svg></span>';
}

const SITE = 'https://www.ogen.cy';
const LANGS = ['he', 'en', 'ru'];
const STATUSES = ['draft', 'announcement', 'open', 'waitlist', 'closed', 'cancelled', 'completed'];
const MOTIFS = ['none', 'ring', 'scatter', 'hatch', 'leaf', 'wave', 'book'];
const CORNERS = ['tl', 'tr', 'bl', 'br'];

// Field-by-field fallback. Preview and publish share it, so a half-translated
// record can't preview with blank rows and publish with filled ones.
const FALLBACK = { he: ['he'], en: ['en', 'he'], ru: ['ru', 'en', 'he'] };

const LABELS = {
  he: {
    dir: 'rtl', sep: '&#8592;', home: 'בית', activities: 'פעילויות',
    siteName: 'מרכז עוגן', suffix: ' · מרכז עוגן',
    about: 'על החוג', programLength: 'אורך התוכנית',
    instructionLanguage: 'שפת ההוראה', prerequisites: 'דרישות קדם',
    whatToBring: 'מה להביא', faq: 'שאלות נפוצות',
    ages: 'גילאים', schedule: 'מועד', duration: 'משך', location: 'מיקום', address: 'כתובת',
    groupSize: 'גודל קבוצה', price: 'מחיר',
    // Group headings. Deliberately not the same word as any fact inside them:
    // the schedule group holds a fact already labelled "מועד", and a heading
    // repeating it would read as the same row twice.
    gParticipants: 'למי זה מתאים', gSchedule: 'לוח זמנים', gPractical: 'פרטים',
    indexTitle: 'הפעילויות שלנו', indexLead: 'מה אפשר למצוא במרכז עוגן',
    indexEmpty: 'בקרוב נפרסם כאן את הפעילויות.', more: 'לפרטים'
  },
  en: {
    dir: 'ltr', sep: '&#8594;', home: 'Home', activities: 'Activities',
    siteName: 'Ogen Center', suffix: ' · Ogen Center',
    about: 'About the class', programLength: 'Program Length',
    instructionLanguage: 'Language of instruction', prerequisites: 'Prerequisites',
    whatToBring: 'What to bring', faq: 'Frequently asked questions',
    ages: 'Ages', schedule: 'When', duration: 'Duration', location: 'Location', address: 'Address',
    groupSize: 'Group size', price: 'Price',
    gParticipants: 'Who it is for', gSchedule: 'Schedule', gPractical: 'Details',
    indexTitle: 'Our activities', indexLead: 'What you can find at Ogen Center',
    indexEmpty: 'Activities will be published here soon.', more: 'Details'
  },
  ru: {
    dir: 'ltr', sep: '&#8594;', home: 'Главная', activities: 'Занятия',
    siteName: 'Центр Оген', suffix: ' · Центр Оген',
    about: 'О занятиях', programLength: 'Длина программы',
    instructionLanguage: 'Язык преподавания', prerequisites: 'Требования к уровню',
    whatToBring: 'Что взять с собой', faq: 'Частые вопросы',
    ages: 'Возраст', schedule: 'Когда', duration: 'Продолжительность', location: 'Место', address: 'Адрес',
    groupSize: 'Размер группы', price: 'Цена',
    gParticipants: 'Для кого', gSchedule: 'Расписание', gPractical: 'Подробности',
    indexTitle: 'Наши занятия', indexLead: 'Что можно найти в центре Оген',
    indexEmpty: 'Занятия скоро появятся здесь.', more: 'Подробнее'
  }
};

// --- helpers ---------------------------------------------------------------

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Resolve a { he, en, ru } field for one language, following the fallback chain.
function pick(field, lang) {
  if (field == null) return '';
  if (typeof field === 'string') return field.trim();
  for (const l of FALLBACK[lang] || [lang]) {
    const v = field[l];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

const has = (field, lang) => pick(field, lang) !== '';

// A language is published only if it has its own title. Falling back to Hebrew
// under an /en/ URL would be worse than not having the page.
function langsPresent(activity) {
  return LANGS.filter((l) => {
    const t = activity && activity.title && activity.title[l];
    return typeof t === 'string' && t.trim() !== '';
  });
}

const pathFor = (slug, lang) =>
  lang === 'he' ? `/activities/${slug}` : `/${lang}/activities/${slug}`;
const filePathFor = (slug, lang) =>
  lang === 'he' ? `activities/${slug}.html` : `${lang}/activities/${slug}.html`;
const indexPathFor = (lang) => (lang === 'he' ? '/activities' : `/${lang}/activities`);
const indexFilePathFor = (lang) => (lang === 'he' ? 'activities/index.html' : `${lang}/activities/index.html`);
const homeFor = (lang) => (lang === 'he' ? '/' : `/${lang}`);

const GENERATED_NOTE = (source) =>
  `<!-- GENERATED FILE — do not edit by hand.\n` +
  `     Built from ${source} by netlify/functions/_activity-template.js.\n` +
  `     The next admin save overwrites anything changed here. -->`;

function head({ lang, title, description, canonical, alternates, image, robots }) {
  const alts = alternates
    .map((a) => `<link rel="alternate" hreflang="${a.lang}" href="${SITE}${a.path}">`)
    .concat([`<link rel="alternate" hreflang="x-default" href="${SITE}${alternates[0].path}">`])
    .join('\n');
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">

<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="${robots || 'index, follow'}">
<link rel="canonical" href="${SITE}${canonical}">

<!-- Language alternates -->
${alts}

<!-- Open Graph -->
<meta property="og:type" content="website">
<meta property="og:site_name" content="מרכז עוגן | Ogen Center">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${SITE}${canonical}">
<meta property="og:image" content="${SITE}${image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">

<link rel="icon" href="/images/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/images/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/images/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Mulish:wght@400;700;800&family=Heebo:wght@400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/shared.css">
</head>`;
}

// An optional block renders only when it has content. Absent means absent —
// no empty heading is emitted for js/activity.js to clean up afterwards.
function optionalBlock(heading, value) {
  if (!value) return '';
  return `
      <div data-optional>
        <h2>${heading}</h2>
        <p>${esc(value)}</p>
      </div>
`;
}

// --- the activity page -----------------------------------------------------

function renderActivityPage(activity, lang) {
  if (!activity || !activity.slug) throw new Error('renderActivityPage: activity.slug is required');
  if (LANGS.indexOf(lang) === -1) throw new Error(`renderActivityPage: unknown language "${lang}"`);

  const L = LABELS[lang];
  const slug = activity.slug;
  const present = langsPresent(activity);
  const alternates = (present.length ? present : ['he']).map((l) => ({ lang: l, path: pathFor(slug, l) }));

  const title = pick(activity.title, lang);
  const metaTitle = pick(activity.metaTitle, lang) || title + L.suffix;
  const metaDescription = pick(activity.metaDescription, lang) || pick(activity.about, lang).slice(0, 300);

  const motif = MOTIFS.indexOf(activity.motif) !== -1 ? activity.motif : 'ring';
  const corner = CORNERS.indexOf(activity.corner) !== -1 ? activity.corner : 'tl';
  const status = STATUSES.indexOf(activity.status) !== -1 ? activity.status : 'draft';

  const faqItems = (activity.faq || [])
    .filter((item) => item && has(item.q, lang))
    .map(
      (item) =>
        `        <div class="faq-item"><p><span class="faq-q">${esc(pick(item.q, lang))}</span> ${esc(pick(item.a, lang))}</p></div>`
    )
    .join('\n');

  const faqBlock = faqItems
    ? `
      <div data-optional>
        <h2>${L.faq}</h2>
${faqItems}
      </div>
`
    : '';

  // Teachers and sponsors are arrays at any count. The emitted JSON keeps the
  // exact shape js/activity.js already reads.
  const credits = {
    teachers: (activity.teachers || [])
      .filter((t) => t && has(t.name, lang))
      .map((t) => (t.photo ? { name: pick(t.name, lang), photo: t.photo } : { name: pick(t.name, lang) })),
    sponsors: (activity.sponsors || [])
      .filter((s) => s && has(s.name, lang))
      .map((s) => (s.logo ? { name: pick(s.name, lang), logo: s.logo } : { name: pick(s.name, lang) }))
  };
  const creditsBlock =
    credits.teachers.length || credits.sponsors.length
      ? `
      <div class="credit-block" data-credits></div>
      <script type="application/json" id="activity-credits">
${JSON.stringify(credits, null, 2)}
      </script>
`
      : '';

  // Facts are structured values now, turned into a sentence per language by
  // _activity-facts.js. Program length, language of instruction and
  // prerequisites used to be their own sections in the main column; they are
  // facts to scan, so they live here. data-fact-visibility is written out for
  // every row but nothing acts on it yet — see isPubliclyVisible() for the one
  // place that changes when registration ships.
  // Grouped blocks, not label/value rows. Each group is an icon, a heading and
  // a stack of facts, so nothing is pushed to an edge and nothing has to be told
  // which edge is which. The old .sidebar-row put the label at the start and the
  // value at the end with text-align:end, which is the shape that kept coming
  // out wrong in Hebrew.
  //
  // The heading is an h2 inside an <aside>: these are section labels, and giving
  // them real headings makes the facts box navigable rather than a run of spans.
  const factGroups = sidebarGroups(activity, lang)
    .map((group) => {
      const items = group.facts
        .map(
          (row) =>
            `          <li data-fact="${row.key}" data-fact-visibility="${row.visibility}">` +
            `<strong>${LABELS[lang][row.key]}</strong><span>${esc(row.value)}</span></li>`
        )
        .join('\n');
      return `      <div class="sidebar-group" data-group="${group.key}">
        ${groupIcon(group.key)}
        <div class="sidebar-group-body">
          <h2>${LABELS[lang]['g' + group.key.charAt(0).toUpperCase() + group.key.slice(1)]}</h2>
          <ul class="sidebar-facts">
${items}
          </ul>
        </div>
      </div>`;
    })
    .join('\n');

  // Per-language so the CTA lands in the reader's own tree (or an external
  // registration URL later). A plain string still works — pick() passes it through.
  const ctaUrl = pick(activity.ctaUrl, lang);
  const ctaAttr = ctaUrl ? ` data-cta-url="${esc(ctaUrl)}"` : '';

  return `${head({
    lang,
    title: metaTitle,
    description: metaDescription,
    canonical: pathFor(slug, lang),
    alternates,
    // An activity may carry its own share card. Without one, every activity
    // shares the site's branded image, which is a reasonable default and not a
    // reason to make each one source a picture. The 1200×630 in the head stays
    // true because the upload is cropped to that ratio, not merely hinted at.
    image: activity.shareImage || '/images/og-image.jpg',
    // 'noindex, follow' rather than a bare 'noindex', matching /about: the page
    // is kept out of search results, but the links on it are still worth
    // crawling. A noindex activity is also left out of sitemap.xml — listing a
    // page you have asked not to be indexed is a contradiction.
    robots: activity.robots === 'noindex' ? 'noindex, follow' : 'index, follow'
  })}
<body>
<div id="page" dir="${L.dir}">
${GENERATED_NOTE(`activities/${slug}.json`)}

<div class="page-header" data-motif="${motif}" data-corner="${corner}">
  <nav class="breadcrumb" aria-label="${esc(L.activities)}">
    <a href="${homeFor(lang)}">${L.home}</a><span class="sep">${L.sep}</span><a href="${indexPathFor(lang)}">${L.activities}</a><span class="sep">${L.sep}</span>${esc(title)}
  </nav>
  <h1>${esc(title)}</h1>
  <p data-status-badge></p>
</div>

<article class="activity" data-status="${status}"${ctaAttr}>
  <div class="activity-layout">
    <!-- The facts sidebar comes FIRST in the source on purpose. It belongs at
         the leading edge of the reading direction — the right in Hebrew, the
         left in English and Russian — and a flex row already places its first
         item there, per direction, with no per-language rule. Doing it with
         source order rather than the CSS order property also keeps visual, DOM and
         keyboard order identical, so the registration button is not reached
         last by a screen reader while appearing first on screen. -->
    <aside class="activity-sidebar">
${factGroups}
      <div data-status-cta></div>
    </aside>

    <div class="activity-main">
      <h2>${L.about}</h2>
      <p>${esc(pick(activity.about, lang))}</p>
${optionalBlock(
    L.whatToBring,
    pick(activity.whatToBring, lang)
  )}${faqBlock}${creditsBlock}    </div>
  </div>
</article>

<script src="/js/nav.js"></script>
<script src="/js/footer.js"></script>
<script src="/js/motifs.js"></script>
<script src="/js/activity.js"></script>
</div>
</body>
</html>
`;
}

// --- the activities listing page ------------------------------------------
// Deliberately minimal: cards that link out. It exists so activities are
// reachable without someone already holding the direct link.

function renderActivitiesIndexPage(activities, lang) {
  const L = LABELS[lang];
  const list = (activities || []).filter((a) => langsPresent(a).indexOf(lang) !== -1);

  const cards = list.length
    ? `  <div class="activity-cards">
${list
        .map((a) => {
          const title = pick(a.title, lang);
          const blurb = pick(a.summary, lang) || pick(a.about, lang).slice(0, 140);
          // A coloured band, not a picture: activities no longer carry an
          // image of their own. It is decorative, hence aria-hidden.
          const thumb = `      <span class="activity-card-thumb" aria-hidden="true"></span>`;
          return `    <a class="activity-card" href="${pathFor(a.slug, lang)}">
${thumb}
      <h2>${esc(title)}</h2>
      <p>${esc(blurb)}</p>
      <span class="activity-card-more">${L.more}</span>
    </a>`;
        })
        .join('\n')}
  </div>`
    : `  <p class="activity-empty">${L.indexEmpty}</p>`;

  return `${head({
    lang,
    title: L.indexTitle + L.suffix,
    description: L.indexLead,
    canonical: indexPathFor(lang),
    alternates: LANGS.map((l) => ({ lang: l, path: indexPathFor(l) })),
    image: '/images/og-image.jpg',
    robots: 'index, follow'
  })}
<body>
<div id="page" dir="${L.dir}">
${GENERATED_NOTE('activities/activities-index.json')}

<div class="page-header" data-motif="scatter" data-corner="tr">
  <nav class="breadcrumb" aria-label="${esc(L.activities)}">
    <a href="${homeFor(lang)}">${L.home}</a><span class="sep">${L.sep}</span>${L.activities}
  </nav>
  <h1>${L.indexTitle}</h1>
</div>

<div class="activity-index">
  <p class="activity-index-lead">${L.indexLead}</p>
${cards}
</div>

<script src="/js/nav.js"></script>
<script src="/js/footer.js"></script>
<script src="/js/motifs.js"></script>
</div>
</body>
</html>
`;
}

module.exports = {
  SITE, LANGS, STATUSES, MOTIFS, CORNERS, LABELS, FALLBACK,
  esc, pick, has, langsPresent,
  pathFor, filePathFor, indexPathFor, indexFilePathFor, homeFor,
  renderActivityPage, renderActivitiesIndexPage
};
