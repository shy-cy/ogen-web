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

const { sidebarGroups, sidebarRows, factPriceRows, sessionTables, SESSION_TABLE,
        groupChoice } = require('./_activity-facts');

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

// The recommended length of a listing card's summary. See the note above the
// card builder: it is the figure the admin counts against AND the slice taken
// off `about` when nobody wrote a summary, so the two cannot drift.
//
// ⚠ IT HAS TO BE THE NUMBER THE CLAMP ACTUALLY HOLDS, AND IT WAS 140.
//
// The counter said 140/140 in olive and the card then cut the sentence off
// mid-word, which is the count and the clamp making two different promises
// about one box. Neither was wrong on its own -- the clamp guarantees the
// layout in every language whatever is stored, and that is exactly why it is
// the half that cannot move -- so the count is what had to come to it.
//
// Three lines of 14.5px at line-height 1.6 in a 320px card, less the 22px
// gutters, is 274px a line: about 34 characters of Heebo and about 37 of
// Mulish, less roughly a tenth to ragged word wrapping. That is a little over a
// hundred in Hebrew and a little under it in Russian, whose words are the
// longest of the three. 100 is the figure that fits in all three rather than in
// the most compact one.
const SUMMARY_CHARS = 100;
const LANGS = ['he', 'en', 'ru'];
const STATUSES = ['draft', 'announcement', 'open', 'waitlist', 'closed', 'cancelled', 'completed'];

// THE THREE GROUPS OF THE LISTING, and the split the nav menu uses too.
//
//   OPEN      registration is open, or about to be, or full and still taking
//             interest — there is something a family can do right now.
//   RUNNING   past registration and underway. `closed` is the whole group.
//   ARCHIVED  over, one way or the other.
//
// `waitlist` is in OPEN. The brief that settled this mapping listed only
// `announcement` and `open` there and left `waitlist` with no group at all,
// which the require-time assertion below would have refused — and its own
// earlier definition of the group was "anything still accepting or about to
// accept registration interest", which is exactly what a waitlist is.
//
// `draft` is in none of them, and cannot be: a draft has no files at all, so it
// never reaches the index these are applied to.
//
// IT IS STATUS ALONE, NEVER A DATE. Every other part of this site decides
// display from the declared status — js/activity.js renders the badge and the
// CTA from `data-status` and asks no clock — and a listing page that
// second-guessed it would be the only thing here overriding an admin. It would
// also rot: these pages are static build artifacts, regenerated only when
// somebody publishes, so a date comparison baked into one is right on the day it
// is written and wrong afterwards with nothing to notice.
//
// The drift that reasoning leaves — an activity `closed` in October and never
// flipped to `completed` — is closed at the other end instead, by
// _activity-autocomplete.js in the nightly sweep. The status stays the single
// source of truth; something else keeps it true.
// The order OPEN_STATUSES is written in is the order the menu lists them, and it
// is deliberate: what is open comes before what is only announced, which comes
// before a waitlist. Nothing else depends on it, so a test pins it rather than a
// comment asking nicely.
const OPEN_STATUSES = ['open', 'announcement', 'waitlist'];
const RUNNING_STATUSES = ['closed'];
const ARCHIVED_STATUSES = ['completed', 'cancelled'];

// In listing order, so a caller loops over one thing rather than knowing three
// names and the sequence they go in.
const STATUS_GROUPS = [
  { key: 'open', statuses: OPEN_STATUSES },
  { key: 'running', statuses: RUNNING_STATUSES },
  { key: 'archived', statuses: ARCHIVED_STATUSES }
];

(function assertEveryPublicStatusIsInExactlyOneGroup() {
  const all = [].concat(...STATUS_GROUPS.map((g) => g.statuses));
  const twice = all.filter((s, i) => all.indexOf(s) !== i);
  const unknown = all.filter((s) => STATUSES.indexOf(s) === -1);
  const missed = STATUSES.filter((s) => s !== 'draft' && all.indexOf(s) === -1);
  if (twice.length || unknown.length || missed.length) {
    throw new Error('STATUS_GROUPS is out of step with STATUSES: ' +
      JSON.stringify({ twice, unknown, missed }));
  }
})();
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
    groups: 'קבוצות', gGroups: 'הקבוצות',
    chooseGroup: 'בוחרים קבוצה בהרשמה', chooseShort: 'בוחרים בהרשמה',
    indexTitle: 'הפעילויות שלנו', indexLead: 'מה אפשר למצוא במרכז עוגן',
    indexEmpty: 'בקרוב נפרסם כאן את הפעילויות.', more: 'לפרטים',
    indexOpen: 'פתוח להרשמה', indexRunning: 'פעיל', indexArchived: 'ארכיון'
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
    groups: 'Groups', gGroups: 'The groups',
    chooseGroup: 'Choose your group when you register', chooseShort: 'choose at registration',
    indexTitle: 'Our activities', indexLead: 'What you can find at Ogen Center',
    indexEmpty: 'Activities will be published here soon.', more: 'Details',
    indexOpen: 'Open for registration', indexRunning: 'Currently Running', indexArchived: 'Archived'
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
    indexEmpty: 'Занятия скоро появятся здесь.', more: 'Подробнее',
    indexOpen: 'Открыта запись', indexRunning: 'Активные', indexArchived: 'Архив'
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

  // ⚠ THE GROUPS, SPELLED OUT — and only the facts they actually DISAGREE on.
  //
  // The fact cards above answer "is this for us" with an aggregate: a union age
  // range, the distinct cities, every language anybody is taught in. That is the
  // right answer for somebody deciding whether to read on, and it is the wrong
  // answer for somebody deciding WHICH — "6-13" across a 6-9 group and a 10-13
  // one does not mean a nine-year-old may join either.
  //
  // So this is the chooser's half. It repeats nothing the groups agree on,
  // because two identical lists under two names bury the one line that differs,
  // and it says out loud that the choice is made at registration rather than
  // leaving a reader to infer it from a heading.
  //
  // It sits in the ARTICLE, not in a new grid area: the grid's areas and its
  // row list have to move together or a 117px hole opens under the picture, and
  // this is prose a reader works through rather than a fact they scan. On a
  // phone that puts it after About and before the price, which is the order the
  // question is asked in.
  const choice = groupChoice(activity, lang);
  const groupsBlock = choice
    ? `
      <div class="activity-groups">
        <h2>${L.gGroups}</h2>
        <p class="groups-choose">${esc(L.chooseGroup)}</p>
${choice.groups.map((g) => `        <div class="group-card">
          <h3>${esc(g.name)}</h3>${g.facts.length ? `
          <ul class="sidebar-facts">
${g.facts.map((f) => `            <li data-fact="${esc(f.key)}"><strong>${LABELS[lang][f.key]}</strong><span>${esc(f.value)}</span></li>`).join('\n')}
          </ul>` : ''}
        </div>`).join('\n')}
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

  // TWO placements. The two cards a reader scans first — who it is for, and
  // when and where — sit above the article. The other two share the column
  // beside the picture: price directly above the registration button, teachers
  // and sponsors directly below it. The column reads see the activity, see the
  // cost, act, and then who is behind it.
  //
  // Credits used to close the page as a full-width band, where the measure let
  // their two groups lay out across instead of stacking. The session calendar
  // then landed between the article and that band, and a table running to
  // eleven rows put the teachers past the fold on every screen. A wider block
  // nobody scrolls to is worth less than a narrower one they see.
  //
  // A group with no facts is already dropped by sidebarGroups, so an activity
  // that has filled in neither of the top two gets no row at all rather than an
  // empty one.
  const topCards = [cards.participants, cards.schedule].filter(Boolean).join('\n');
  const factRow = topCards ? `    <div class="fact-row">\n${topCards}\n    </div>\n` : '';
  const asideCards = [cards.price].filter(Boolean).join('\n');
  // Rendered AFTER the status CTA inside .activity-aside, so the reading order
  // in the source is the reading order on the page in both directions and at
  // every width. js/activity.js needs no change: it finds [data-credits] by
  // attribute, never by position.
  const creditsAside = creditsCard ? `\n      <div class="activity-credits">\n${creditsCard}\n      </div>` : '';

  // THE SESSION CALENDAR. The schedule card says "Wednesdays, 16:00" and goes on
  // saying it; what it cannot say is WHICH Wednesdays, and a family planning a
  // term needs the dates.
  //
  // One source, two readers: this is the same facts.duration.sessionDates the
  // cancellation arithmetic divides by, so the table cannot disagree with what a
  // refund is priced against. There is no second calculation anywhere.
  //
  // Excluded dates are not here at all — no marked row, no "no class", no gap
  // acknowledged. The page says when the class meets, not when it does not, and
  // that also makes this list EXACTLY the one the credit arithmetic uses: if
  // nothing skipped is shown, nothing skipped can take a number, so session 3 is
  // the third row and the third meeting with no rule saying so.
  //
  // An activity with no calendar renders no table, the same as the card image
  // and for the same reason: an empty frame is worse than no frame. A one-off,
  // a custom schedule written as prose, or an activity nobody has finished
  // configuring all fall through to the summary in the fact card.
  //
  // ⚠ ONE TABLE PER GROUP where the groups keep their own calendars. A family in
  // Beginners reading the Advanced dates is the bug the whole per-group calendar
  // exists to fix, and it would have survived everything else if the page still
  // printed one list. `title` is null when there is one table, and then this
  // renders byte-for-byte what it always did.
  //
  // The caption carries the group's name rather than a second heading above the
  // table: a caption IS the table's name, and two tables each captioned
  // "Session dates" would be two lists a reader has to tell apart by their
  // contents.
  const tables = sessionTables(activity, lang);
  const T = SESSION_TABLE[lang] || SESSION_TABLE.en;
  const oneTable = (t) => `          <table class="session-table">
            <caption>${esc(t.title ? `${T.caption} · ${t.title}` : T.caption)}</caption>
            <thead><tr>${T.cols.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead>
            <tbody>
${t.rows.map((r) => `              <tr><td>${esc(String(r.n))}</td><td>${esc(r.day)}</td><td>${esc(r.date)}</td></tr>`).join('\n')}
            </tbody>
          </table>`;
  const sessionsBand = tables.length
    ? `    <div class="activity-sessions">
      <div class="fact-card session-columns" data-group="sessions">
        <div class="session-split">
${tables.map(oneTable).join('\n')}
        </div>
      </div>
    </div>
`
    : '';

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

<article class="activity" data-status="${status}">
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
${groupsBlock}${faqBlock}    </div>

    <div class="activity-aside">
${asideCards}
      <div data-status-cta></div>${creditsAside}
    </div>
${sessionsBand}  </div>
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

// --- what a card can answer at a glance ------------------------------------
//
// A card was a picture, a title and a blurb, which answers "what is this" and
// none of the questions a parent actually filters on. Standing in front of a
// grid, they are deciding whether to open a page at all, and they decide on
// four things: is it for my child, what language is it taught in, when does it
// meet, what does it cost. That is the same order — and the same four leading
// facts — as the activity page's own cards, which is deliberate: the card is a
// preview of that page, not a second description of the activity.
//
// Everything here is read through sidebarRows(), the SAME builder the page
// uses, so a card cannot start describing an activity differently from the
// page it links to. Reading through it also filters members-only facts for
// free: the exact address is not on a card for exactly the reason it is not on
// the page, and that is a property of the code rather than a rule this
// function has to remember.
//
// And it adds no copy. All four labels are already in LABELS in three
// languages, because the page's own fact rows use them.
// ⚠ `groups` LEADS, and it is not a fact. It frames everything under it: "Ages
// 6-13" on an activity with two groups is a union, and read without knowing
// there is a choice it says a nine-year-old may join either one. It appears
// ONLY when there are two or more groups, so every card on the site today is
// unchanged.
const CARD_TAGS = ['groups', 'ages', 'instructionLanguage', 'schedule', 'price'];

function cardTags(activity, lang) {
  const L = LABELS[lang];
  const byKey = {};
  sidebarRows(activity, lang).forEach((r) => { byKey[r.key] = r.value; });
  // The SAME builder the page's own groups section reads, so a card cannot
  // advertise a choice the page does not offer, or a different number of them.
  const choice = groupChoice(activity, lang);

  return CARD_TAGS.map((key) => {
    if (key === 'groups') {
      return choice ? { key, label: L.groups, value: `${choice.countText} · ${L.chooseShort}` } : null;
    }
    // ONE figure, and it is the one activities are compared by — the term
    // price, or the per-session price on a drop-in. Never the registration fee,
    // which is charged once a year and would read as the cost of the course,
    // and never the per-lesson rate, which is a division of two numbers that
    // are both already on the page. The row brings its own label, so a drop-in
    // chip says "per session" and a course chip says "per semester" without
    // this having to know which it is looking at.
    if (key === 'price') {
      const head = factPriceRows(activity, lang)
        .filter((r) => r.key === 'term' || r.key === 'perSession')[0];
      // esc() here and nowhere else in this function: a price label is plain
      // text out of _activity-facts.js, where every LABELS value in this file
      // is authored as HTML and interpolated raw.
      return head ? { key, label: esc(head.label), value: head.value } : null;
    }

    const value = byKey[key];
    if (!value) return null;

    // ⚠ A SCHEDULE OF MORE THAN ONE LINE IS MORE THAN ONE GROUP, and then no
    // single line is true of the reader. scheduleText() renders "Beginners:
    // Monday, 16:00" and "Advanced: Wednesday, 16:00"; a chip showing the first
    // tells half of them a day they do not attend, and does it in the one place
    // on the site meant to be scanned rather than read. The chip is dropped and
    // the page, which prints every group's line, is one click away. A card that
    // says nothing beats a card that is confidently wrong, and this is the
    // cheapest place to be wrong about the most consequential fact.
    if (key === 'schedule' && value.indexOf('\n') !== -1) return null;

    // The remaining multi-line case is the opposite and is not a hazard: a
    // language list and a level each carry an OPTIONAL note on a second line,
    // and the first line is a complete answer on its own. So it is truncated
    // rather than dropped.
    return { key, label: L[key], value: value.split('\n')[0] };
  }).filter(Boolean);
}

function renderActivitiesIndexPage(activities, lang) {
  const L = LABELS[lang];
  const list = (activities || []).filter((a) => langsPresent(a).indexOf(lang) !== -1);

  // One card. `level` is the heading tag, and it is a parameter because the page
  // has one shape or two: with nothing past there are no group headings and a
  // card title is the page's h2, exactly as before this existed. With a past
  // group, the two group headings become the h2s and the card titles drop to h3
  // — the levels follow the outline rather than being fixed to a tag.
  // ⚠ THE CARD SUMMARY IS CLAMPED TO THREE LINES IN CSS, and this is the number
  // the admin counts against so a writer is told before publishing rather than
  // finding an ellipsis afterwards. It is also the slice taken off `about` when
  // no summary was written, so the two cannot drift: the recommended length and
  // the generated fallback are one figure.
  //
  // It is a RECOMMENDATION, not a refusal. Summaries are words, and a form that
  // refuses a save over one character is a form people fight; the clamp is what
  // actually guarantees the layout, in every language, whatever is stored.
  const card = (a, level) => {
    const title = pick(a.title, lang);
    // Same reason as the meta description: the body is markup now, and a
    // listing card blurb is text.
    const blurb = pick(a.summary, lang) || plainText(pick(a.about, lang)).slice(0, SUMMARY_CHARS);
    // The activity's square picture when it has one, and the coloured band
    // when it does not — so a listing with a mix of both still reads as a
    // grid. Decorative either way: the card's own heading names the
    // activity, so the alt is empty rather than a repeat of it.
    const thumb = a.cardImage
      ? `      <img class="activity-card-thumb" src="${esc(a.cardImage)}" alt="" width="800" height="800" loading="lazy">`
      : `      <span class="activity-card-thumb" aria-hidden="true"></span>`;
    // The tags sit between the blurb and "Details" rather than under the title,
    // because they are what a reader checks AFTER the name has interested them
    // — and because the blurb carries `flex:1`, so putting them below it keeps
    // every card's tag row and link aligned across a row of unequal blurbs.
    const tags = cardTags(a, lang);
    const tagList = !tags.length ? '' : `
      <ul class="activity-card-tags">
${tags.map((t) => `        <li><span>${t.label}</span> ${esc(t.value)}</li>`).join('\n')}
      </ul>`;
    return `    <a class="activity-card" href="${pathFor(a.slug, lang)}">
${thumb}
      <${level}>${esc(title)}</${level}>
      <p>${esc(blurb)}</p>${tagList}
      <span class="activity-card-more">${L.more}</span>
    </a>`;
  };
  const grid = (rows, level) => `  <div class="activity-cards">
${rows.map((a) => card(a, level)).join('\n')}
  </div>`;

  // THREE GROUPS, EACH ONLY WHEN IT HAS SOMETHING IN IT. A parent looking for
  // the activity their child was in needs somewhere to look that is not the same
  // grid as what is on offer now; an empty heading is worse than no heading, and
  // with a single group there are no headings at all — which is how this page
  // rendered before groups existed and how it still renders today.
  //
  // The ids are the menu's jump targets. They sit on the headings rather than on
  // wrappers so a reader lands on the words, and they do not move if the grid
  // under them is restyled.
  const groups = STATUS_GROUPS
    .map((g) => ({
      key: g.key,
      heading: L['index' + g.key.charAt(0).toUpperCase() + g.key.slice(1)],
      rows: list.filter((a) => g.statuses.indexOf(a.status) !== -1)
    }))
    .filter((g) => g.rows.length);

  const cards = !list.length
    ? `  <p class="activity-empty">${L.indexEmpty}</p>`
    : groups.length === 1
      ? grid(groups[0].rows, 'h2')
      : groups
          .map((g) => `  <h2 class="activity-group" id="${g.key}">${g.heading}</h2>\n${grid(g.rows, 'h3')}`)
          .join('\n');

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
  SUMMARY_CHARS, SITE, LANGS, STATUSES, OPEN_STATUSES, RUNNING_STATUSES, ARCHIVED_STATUSES, STATUS_GROUPS,
  MOTIFS, CORNERS, LABELS, FALLBACK,
  esc, pick, has, langsPresent,
  pathFor, filePathFor, indexPathFor, indexFilePathFor, homeFor,
  renderActivityPage, renderActivitiesIndexPage
};
