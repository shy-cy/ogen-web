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

const { sidebarGroups, factPriceRows } = require('./_activity-facts');

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
  // Price keeps the navy the old "Details" card had, so regrouping did not move
  // a colour: the set is still olive / terracotta / navy / gold in card order.
  price: {
    color: 'var(--navy)',
    svg: '<rect width="20" height="12" x="2" y="6" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01"/><path d="M18 12h.01"/>'
  },
  // The fourth card is the teaching staff and sponsors. Gold is the one colour
  // in the offer-card rotation this page was not already using, so it joins
  // without moving any of the three that were here.
  credits: {
    color: 'var(--gold)',
    svg: '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>'
  }
};

function groupIcon(key) {
  const icon = GROUP_ICONS[key];
  if (!icon) return '';
  return `<span class="fact-card-icon" style="background:${icon.color}">` +
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
    faq: 'שאלות נפוצות',
    ages: 'גילאים', schedule: 'מועד', duration: 'משך', location: 'מיקום', address: 'כתובת',
    groupSize: 'גודל קבוצה', price: 'מחיר',
    // Group headings. Deliberately not the same word as any fact inside them —
    // which is also why the price card renders its four derived rows rather than
    // one row labelled "מחיר" under a heading saying the same thing.
    gParticipants: 'למי זה מתאים', gSchedule: 'מתי ואיפה', gPrice: 'מחיר', gCredits: 'צוות וחסות',
    indexTitle: 'הפעילויות שלנו', indexLead: 'מה אפשר למצוא במרכז עוגן',
    indexEmpty: 'בקרוב נפרסם כאן את הפעילויות.', more: 'לפרטים'
  },
  en: {
    dir: 'ltr', sep: '&#8594;', home: 'Home', activities: 'Activities',
    siteName: 'Ogen Center', suffix: ' · Ogen Center',
    about: 'About the class', programLength: 'Program Length',
    instructionLanguage: 'Language of instruction', prerequisites: 'Prerequisites',
    faq: 'Frequently asked questions',
    ages: 'Ages', schedule: 'When', duration: 'Duration', location: 'Location', address: 'Address',
    groupSize: 'Group size', price: 'Price',
    gParticipants: 'Who it is for', gSchedule: 'When &amp; where', gPrice: 'Price', gCredits: 'Staff &amp; sponsors',
    indexTitle: 'Our activities', indexLead: 'What you can find at Ogen Center',
    indexEmpty: 'Activities will be published here soon.', more: 'Details'
  },
  ru: {
    dir: 'ltr', sep: '&#8594;', home: 'Главная', activities: 'Занятия',
    siteName: 'Центр Оген', suffix: ' · Центр Оген',
    about: 'О занятиях', programLength: 'Длина программы',
    instructionLanguage: 'Язык преподавания', prerequisites: 'Требования к уровню',
    faq: 'Частые вопросы',
    ages: 'Возраст', schedule: 'Когда', duration: 'Продолжительность', location: 'Место', address: 'Адрес',
    groupSize: 'Размер группы', price: 'Цена',
    gParticipants: 'Для кого', gSchedule: 'Когда и где', gPrice: 'Цена', gCredits: 'Педагоги и партнёры',
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

// Is this value plainly a link? The registration button's target is free text in
// the admin, and what got typed into it once was the button's own LABEL —
// "Register Now" — which became <a href="Register Now"> and resolved, relative
// to the page, to a 404 that still SAID "Register interest". It looked right and
// only failed on click.
//
// So a value is used only when a browser could follow it: an absolute http(s)
// URL, a path on this site, a fragment, or mail/phone. Anything else is dropped
// and the button falls back to the contact section, which is where it pointed
// before the field was filled in at all. A dead end is worse than the default.
//
// This is an allowlist, not a blocklist, because the value is printed into an
// href: `javascript:` and `data:` are excluded by never being matched, rather
// than by being remembered. Whitespace is rejected outright — every shape below
// is a single token, and a value with a space in it is prose.
const LINKISH = /^(?:https?:\/\/\S+|\/\S*|#\S*|mailto:\S+|tel:\S+)$/i;
function isLinkish(value) {
  const s = String(value == null ? '' : value).trim();
  return s !== '' && LINKISH.test(s);
}

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

// Body copy from the WYSIWYG, printed as the markup it is.
//
// The admin writes these in Quill, so the stored value is HTML — headings,
// lists, links, emphasis. It is emitted UNESCAPED, which is only safe because
// the server sanitises it to a fixed tag allowlist on every save
// (sanitiseRich() in activities-admin.js). That is the contract: escaping here
// instead would print the tags at the reader.
//
// Records written before the editor existed hold plain text with blank lines
// between paragraphs. They are recognised by NOT starting with a block tag, and
// still converted the way they always were, so nothing had to be migrated and
// an unedited activity reads exactly as it did.
const RICH_START = /^\s*<(?:p|h[1-6]|ul|ol|li|blockquote|strong|em|u|s|b|i|a|br)[\s>/]/i;

// Markup down to a single line of readable text, for the places that take text
// and not HTML: the meta description, og:description, the listing card blurb.
function plainText(value) {
  return String(value || '')
    .replace(/<\/(p|h[1-6]|li|ul|ol|blockquote)\s*>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function richText(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  if (RICH_START.test(s)) return s;
  return s.split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `        <p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
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
  // Falling back to the body means falling back to MARKUP now that About is
  // written in the editor, and a meta description is plain text — a search
  // result would otherwise read "&lt;p&gt;במרכז עוגן…". Tags out, entities
  // decoded back to characters, whitespace collapsed to one line.
  const metaDescription = pick(activity.metaDescription, lang)
    || plainText(pick(activity.about, lang)).slice(0, 300);

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
  // Facts are structured values now, turned into a sentence per language by
  // _activity-facts.js. Program length, language of instruction and
  // prerequisites used to be their own sections in the main column; they are
  // facts to scan, so they live here. data-fact-visibility is written out for
  // every row but nothing acts on it yet — see isPubliclyVisible() for the one
  // place that changes when registration ships.
  //
  // Each group is a card: an icon, a heading and a stack of facts. Nothing is
  // pushed to an edge and nothing has to be told which edge is which. The old
  // .sidebar-row put the label at the start and the value at the end with
  // text-align:end, which is the shape that kept coming out wrong in Hebrew.
  //
  // The heading is an h2: these are section labels, and giving them real
  // headings makes the facts navigable rather than a run of spans.
  const factCard = (key, heading, inner) =>
    `      <div class="fact-card" data-group="${key}">
        <div class="fact-card-head">${groupIcon(key)}<h2>${heading}</h2></div>
${inner}
      </div>`;

  // One fact is one <li>: its label, then its value under it. The exception is
  // the price, which is four numbers a family compares rather than one value —
  // so it renders its derived rows individually, each with the same label/value
  // shape. The "N sessions × M lessons" qualifier is not part of the label and
  // not part of the number, so it gets its own quiet italic line between them.
  const factItem = (row) => {
    const open = `            <li data-fact="${row.key}" data-fact-visibility="${row.visibility}">`;
    if (row.key === 'price') {
      const rows = factPriceRows(activity, lang);
      if (rows.length) {
        return rows
          .map(
            (r) =>
              open + `<strong>${esc(r.label)}</strong>` +
              (r.note ? `<em class="fact-note">${esc(r.note)}</em>` : '') +
              `<span>${esc(r.value)}</span></li>`
          )
          .join('\n');
      }
      // No structured numbers: factText() fell back to the words an admin typed,
      // and that is a sentence, so it prints as an ordinary fact.
    }
    return open + `<strong>${LABELS[lang][row.key]}</strong><span>${esc(row.value)}</span></li>`;
  };

  const cards = {};
  sidebarGroups(activity, lang).forEach((group) => {
    const items = group.facts.map(factItem).join('\n');
    const heading = LABELS[lang]['g' + group.key.charAt(0).toUpperCase() + group.key.slice(1)];
    cards[group.key] = factCard(group.key, heading,
      `        <ul class="sidebar-facts">\n${items}\n        </ul>`);
  });

  // Teachers and sponsors are a card in the same set, and the only one whose
  // contents are still drawn by js/activity.js from the JSON block below. The
  // SHELL is rendered here, and only when there is something to put in it, so
  // an activity with neither gets no card rather than an empty gold heading.
  const creditsCard =
    credits.teachers.length || credits.sponsors.length
      ? factCard('credits', L.gCredits,
          `        <div class="credit-block" data-credits></div>
        <script type="application/json" id="activity-credits">
${JSON.stringify(credits, null, 2)}
        </script>`)
      : '';

  // THREE placements. The two cards a reader scans first — who it is for, and
  // when and where — sit above the article; price sits in the column beside the
  // picture, directly above the registration button, so the column reads see
  // the activity, see the cost, act. Teachers and sponsors close the page as a
  // band under everything, where the full measure lets them lay out across.
  //
  // A group with no facts is already dropped by sidebarGroups, so an activity
  // that has filled in neither of the top two gets no row at all rather than an
  // empty one.
  const topCards = [cards.participants, cards.schedule].filter(Boolean).join('\n');
  const factRow = topCards ? `    <div class="fact-row">\n${topCards}\n    </div>\n` : '';
  const asideCards = [cards.price].filter(Boolean).join('\n');
  const creditsBand = creditsCard ? `    <div class="activity-credits">\n${creditsCard}\n    </div>\n` : '';

  // The activity's own picture, at the head of the aside column with the facts
  // panel beneath it — two stacked cards rather than one. It is the same square
  // image the listing cards use, so an activity is recognisable from the listing
  // to its own page without asking an admin for a second picture.
  //
  // Decorative: the alt is empty and it is aria-hidden, because the heading
  // right above it already names the activity and a screen reader announcing
  // "Hebrew for children" twice is noise, not information.
  const cardImageBlock = activity.cardImage
    ? `      <figure class="activity-card-image" aria-hidden="true">
        <img src="${esc(activity.cardImage)}" alt="" width="800" height="800" loading="lazy">
      </figure>
`
    : '';

  // Per-language so the CTA lands in the reader's own tree (or an external
  // registration URL later). A plain string still works — pick() passes it through.
  //
  // A value that is not plainly a link is dropped rather than published: see
  // isLinkish. The attribute simply does not appear, and js/activity.js falls
  // back to '#register', the contact section.
  const ctaRaw = pick(activity.ctaUrl, lang);
  const ctaUrl = isLinkish(ctaRaw) ? ctaRaw : '';
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
  <!-- Source order IS the order this reads in on a phone: picture, the two
       cards a reader scans first, the article, then the rest. One CSS grid
       holds all four, and above 939px it only renames the areas — the article
       takes a column and the picture moves to the head of the one beside it.

       The picture is the single thing whose visual position differs from its
       place in the source, and it is allowed to because it is decorative:
       aria-hidden with an empty alt, so it is in neither the accessibility tree
       nor the tab order. Nothing readable moves. Everything else here is placed
       by source order alone, which is what keeps visual, DOM and keyboard order
       identical — and it is why the side column sits at the TRAILING edge (left
       in Hebrew, right in English and Russian): the article comes first. -->
  <div class="activity-body">
${cardImageBlock}${factRow}    <div class="activity-main">
      <h2>${L.about}</h2>
${richText(pick(activity.about, lang))}
${faqBlock}    </div>

    <div class="activity-aside">
${asideCards}
      <div data-status-cta></div>
    </div>
${creditsBand}  </div>
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
          // Same reason as the meta description: the body is markup now, and a
          // listing card blurb is text.
          const blurb = pick(a.summary, lang) || plainText(pick(a.about, lang)).slice(0, 140);
          // The activity's square picture when it has one, and the coloured band
          // when it does not — so a listing with a mix of both still reads as a
          // grid. Decorative either way: the card's own heading names the
          // activity, so the alt is empty rather than a repeat of it.
          const thumb = a.cardImage
            ? `      <img class="activity-card-thumb" src="${esc(a.cardImage)}" alt="" width="800" height="800" loading="lazy">`
            : `      <span class="activity-card-thumb" aria-hidden="true"></span>`;
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
  esc, pick, has, langsPresent, isLinkish,
  pathFor, filePathFor, indexPathFor, indexFilePathFor, homeFor,
  renderActivityPage, renderActivitiesIndexPage
};
