// Sidebar facts: structured data in, one line of display text out, per language.
//
// These were free text once — an admin typed "שתי קבוצות של 7 תלמידים" into a
// box. That meant every activity phrased the same fact differently, the English
// and Russian versions drifted from the Hebrew, and nothing could be computed
// from any of it (a price per hour cannot be derived from a sentence).
//
// So a fact is now numbers and dates, and the sentence is BUILT here, once per
// language. Everything in this file is pure: no clock, no network, no DOM. The
// page template and the tests both call it, so what the tests check is exactly
// what gets published.
//
// Legacy text is not thrown away. A fact that still has no structured values
// falls back to `legacyText`, the words the admin originally typed, so nothing
// regresses on the live site while records are migrated one at a time.

// Which calendar and which schedule a named group is on. It requires nothing
// itself, precisely so this file can require it — the rendering side has to ask
// it, and the other direction would be a cycle.
const groups = require('./_activity-groups');

const FALLBACK = { he: ['he'], en: ['en', 'he'], ru: ['ru', 'en', 'he'] };

function pick(field, lang) {
  if (field == null) return '';
  if (typeof field === 'string') return field.trim();
  for (const l of FALLBACK[lang] || [lang]) {
    const v = field[l];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

// A number that is really there. '' , null, undefined and NaN are all "unset",
// but 0 is a real answer and must survive.
function num(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// The languages a class can be taught in, and the levels it can be pitched at.
//
// A closed list rather than free text, so the three pages cannot disagree and so
// "Beginners" is spelled one way across every activity. Greek is here because
// the centre is in Cyprus; a class taught in two languages picks two.
const INSTRUCTION_LANGUAGES = ['he', 'en', 'ru', 'el'];
const LANGUAGE_NAMES = {
  he: { he: 'עברית', en: 'אנגלית', ru: 'רוסית', el: 'יוונית' },
  en: { he: 'Hebrew', en: 'English', ru: 'Russian', el: 'Greek' },
  ru: { he: 'иврит', en: 'английский', ru: 'русский', el: 'греческий' }
};

// מתחילים / ממשיכים / מתקדמים is the idiomatic Israeli triple for course
// levels, and "ממשיכים" is literally "continuing" rather than "intermediate" —
// the natural word in that language rather than a word-for-word translation,
// the same choice the schedule headings already make.
const LEVELS = ['beginner', 'intermediate', 'advanced'];
const LEVEL_NAMES = {
  he: { beginner: 'מתחילים', intermediate: 'ממשיכים', advanced: 'מתקדמים' },
  en: { beginner: 'Beginners', intermediate: 'Intermediate', advanced: 'Advanced' },
  ru: { beginner: 'Начинающие', intermediate: 'Средний уровень', advanced: 'Продвинутые' }
};

// --- language data ---------------------------------------------------------

const DAYS = {
  he: {
    one: ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'יום שבת'],
    many: ['ימי ראשון', 'ימי שני', 'ימי שלישי', 'ימי רביעי', 'ימי חמישי', 'ימי שישי', 'ימי שבת']
  },
  en: {
    one: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    many: ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']
  },
  ru: {
    one: ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'],
    many: ['по воскресеньям', 'по понедельникам', 'по вторникам', 'по средам', 'по четвергам',
           'по пятницам', 'по субботам']
  }
};

// Russian ordinals agree in gender with the weekday they qualify, and the stored
// weekday names use all three: воскресенье is NEUTER, which is the case a
// masculine/feminine pair would silently get wrong. Indexed by day number.
const RU_DAY_GENDER = ['n', 'm', 'm', 'f', 'm', 'f', 'f'];   // Sun..Sat

// Which week of the month a monthly activity meets in. "last" is the clamp: a
// month with only four of a weekday uses the last one rather than inventing a
// fifth, so it is a real option and not an error state.
const WEEK_ORDINALS = {
  // שבוע is masculine, so Hebrew needs one list and the day name in front of it
  // substitutes with nothing else changing. That is the advantage of the
  // week-based phrasing the reviewer approved over the literal "third Monday",
  // which in Hebrew collides with the weekday names, themselves ordinals:
  // "יום שני השני" says the same word twice.
  he: ['בשבוע הראשון', 'בשבוע השני', 'בשבוע השלישי', 'בשבוע הרביעי', 'בשבוע החמישי'],
  en: ['First', 'Second', 'Third', 'Fourth', 'Fifth'],
  ru: {
    m: ['первый', 'второй', 'третий', 'четвёртый', 'пятый'],
    f: ['первая', 'вторая', 'третья', 'четвёртая', 'пятая'],
    n: ['первое', 'второе', 'третье', 'четвёртое', 'пятое']
  }
};
const WEEK_LAST = { he: 'בשבוע האחרון', en: 'Last', ru: { m: 'последний', f: 'последняя', n: 'последнее' } };
const MONTH_OF = { he: 'של החודש', en: 'of each month', ru: 'каждого месяца' };

// The session table. The caption is a heading rather than a date range, and it
// is not a word-for-word translation in the three languages, because each
// language's natural heading for a table of dated meetings is its own. Russian
// is "Расписание занятий" on the reviewer's answer: for a planned schedule of
// lessons with dates, in a table, that is always the form, and "Даты занятий"
// reads as general information still to be detailed.
const SESSION_TABLE = {
  he: { caption: 'מועדי המפגשים', row: 'מפגש', cols: ['מפגש', 'יום', 'תאריך'] },
  en: { caption: 'Session dates', row: 'Session', cols: ['Session', 'Day', 'Date'] },
  ru: { caption: 'Расписание занятий', row: 'Занятие', cols: ['Занятие', 'День', 'Дата'] }
};

const MONTHS = {
  he: ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט',
       'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
       'September', 'October', 'November', 'December'],
  ru: ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август',
       'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
};

// Russian needs the genitive for "from September" / "until June".
const MONTHS_RU_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля',
                       'августа', 'сентября', 'октября', 'ноября', 'декабря'];

// Hebrew counts groups in the feminine: two groups is "שתי קבוצות", not "2".
const HE_FEM = ['', 'אחת', 'שתי', 'שלוש', 'ארבע', 'חמש', 'שש', 'שבע', 'שמונה', 'תשע', 'עשר'];

// 1 группа / 2 группы / 5 групп — Russian picks the form from the last digits.
function ruPlural(n, one, few, many) {
  const abs = Math.abs(n) % 100;
  if (abs >= 11 && abs <= 14) return many;
  const last = abs % 10;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

const CURRENCY = '€';

// An "academic hour" is 45 minutes. It is the basis Israeli and Cypriot
// programmes price by, so a 90-minute session is two hours, not one and a half.
const ACADEMIC_MINUTES = 45;

// --- the facts -------------------------------------------------------------
// Order is the sidebar order, top to bottom. The CTA button is appended by
// js/activity.js after these.

const FACT_ORDER = [
  'ages', 'schedule', 'duration', 'groupSize',
  'instructionLanguage', 'prerequisites', 'location', 'address', 'price'
];

// ⚠ EMPTY, AND THAT IS THE POINT. Every fact on this site is now structured.
//
// `instructionLanguage` and `prerequisites` were the last two free-text facts —
// a Hebrew box, an English box and a Russian box, each holding whatever somebody
// typed. That is the shape this whole module exists to replace: an admin who
// fills in one language publishes one language, three pages can disagree about
// what a class requires, and "Beginners" is spelled four ways across four
// activities.
//
// They are a code and a level now, chosen from a list and rendered per language
// here, with an OPTIONAL free-text line for anything the list cannot say. The
// list answers the question; the sentence adds to it.
//
// The constant is kept rather than deleted: factText() still branches on it, and
// an empty list is a truthful statement that nothing is free text any more.
const TEXT_FACTS = [];

// ⚠ WHICH FACTS BELONG TO A GROUP. The two lists live in _activity-groups.js —
// the module that requires nothing — and are re-exported here so a caller with
// the facts module in hand does not need a second import. The assertion is the
// point: a fact added to FACT_ORDER and to neither list would render nowhere,
// and a fact in both would be asked of two records that can disagree.
const { GROUP_FACTS, ACTIVITY_FACTS } = groups;

(function assertEveryFactBelongsSomewhere() {
  const seen = GROUP_FACTS.concat(ACTIVITY_FACTS);
  const missing = FACT_ORDER.filter((k) => seen.indexOf(k) === -1);
  const extra = seen.filter((k) => FACT_ORDER.indexOf(k) === -1);
  const twice = seen.filter((k, i) => seen.indexOf(k) !== i);
  if (missing.length || extra.length || twice.length) {
    throw new Error('GROUP_FACTS + ACTIVITY_FACTS is out of step with FACT_ORDER: ' +
      JSON.stringify({ missing, extra, twice }));
  }
})();

const STRUCTURED_FACTS = ['ages', 'schedule', 'duration', 'groupSize',
                          'instructionLanguage', 'prerequisites', 'location', 'address', 'price'];

// Where an activity happens is two different facts with two different answers.
// "Limassol" tells a family whether it is near them and belongs on a public
// page. The street address is where children will physically be at a known
// hour, and belongs only to people who have registered.
//
// So they are separate facts rather than one fact with a flag: a single field
// forced a choice between publishing an address and publishing nothing, which
// is why Location used to default to members-only and then get shown anyway.
const DEFAULT_VISIBILITY = { address: 'members' };

const visibilityOf = (activity, key) =>
  ((activity && activity.factVisibility) || {})[key] || DEFAULT_VISIBILITY[key] || 'public';

// MEMBERS-ONLY IS NOW ENFORCED, AND THIS IS STILL THE ONLY PLACE IT IS DECIDED.
//
// It used to return true for everything, deliberately: Location was the only
// members-only fact, there was nobody who could be a "member", and hiding the
// one location fact would have hidden it from the families who needed it.
//
// The exact address makes that trade-off unnecessary. The general location is
// its own public fact now, so enforcing costs a reader nothing — and an address
// is the one thing that must never be published by accident.
//
// Enforcing means OMITTING the row from the generated HTML, which is why this
// is a filter in the render path rather than a CSS class. The file is public
// and anyone can read it: rendering a private fact and hiding it visually would
// publish it. When a members area exists, the private rows are served by that
// authenticated view — they still never enter this file.
function isPubliclyVisible(visibility) {
  return visibility !== 'members';
}

// The same decision, asked about a fact of a particular activity. Two readers
// need it — the published rows and the per-group breakdown under them — and a
// second `isPubliclyVisible(visibilityOf(...))` in either of them would be a
// second place the rule is spelled out. It is spelled out here, once.
const isPublicFact = (activity, key) => isPubliclyVisible(visibilityOf(activity, key));

// --- the map pin -----------------------------------------------------------
//
// A direct Google Maps link, stored beside the exact address and governed by the
// same visibility flag — see the note on SHAPES.address in _activity-migrate.js
// for why it lives there and nowhere else.
//
// ⚠ THE VALUE IS CHECKED AGAIN AT EVERY POINT OF USE, never trusted from the
// record. It is about to become an href in somebody's mail client, and the
// sister project's own map handling says the same thing for the same reason.
// The storage check can only have been true when it was written; an old record,
// a hand-edited JSON file and a restored backup are all ways for it to stop
// being true without anybody saving anything.
//
// ⚠ AND THE HOST IS CHECKED, WHICH IS STRICTER THAN THE SISTER PROJECT IS. That
// is this repository's own scar: `ctaUrl` was a free-text URL box, every value
// it ever held was a mistake, and it is gone. An allowlist cannot tell a right
// URL from a wrong one — the second bad ctaUrl was a well-formed https link on
// this very domain — so this is not claimed as a guarantee that the pin is
// correct. What it buys is narrower and real: `javascript:` cannot be stored, a
// half-pasted string is refused at the moment it is typed rather than mailed to
// a family, and the message can name what to paste instead.
//
// `maps.app.goo.gl` is first because it is what the Share button actually
// produces on a phone, which is where an admin standing in the room will get it.
const MAP_HOSTS = /^https:\/\/(?:maps\.app\.goo\.gl\/|goo\.gl\/maps\/|maps\.google\.[a-z.]{2,6}\/|(?:www\.)?google\.[a-z.]{2,6}\/maps)/i;

// The stored spelling: trimmed, or '' — never null, so a cleared box and an
// absent one read the same downstream.
const mapUrlText = (v) => String(v == null ? '' : v).trim();

// What a screen may link to. Anything that does not pass is treated as absent
// rather than rendered, because a broken pin in a confirmation email is worse
// than no pin: it reads as the centre not knowing where its own class is.
function mapUrlOf(fact) {
  const u = mapUrlText(fact && fact.mapUrl);
  return MAP_HOSTS.test(u) ? u : '';
}

// Why a typed value is refused, or null. Shown at the moment it is typed.
function mapUrlProblem(value) {
  const u = mapUrlText(value);
  if (!u) return null;
  if (MAP_HOSTS.test(u)) return null;
  return 'The map link has to be a Google Maps address beginning https:// — open the place in '
    + 'Google Maps, press Share, and Copy link. Leave it blank and the address alone is used.';
}

// ⚠ A LABELLED LINK, NEVER A BARE URL. A goo.gl string in the middle of a
// confirmation email reads as something to be suspicious of, which is the
// opposite of what a family needs from the line telling them where to bring a
// child. It is appended to the address rather than given a line of its own,
// because it is the same fact: where this is, and how to get there.
const MAP_LABEL = {
  he: '\u05d4\u05d5\u05e8\u05d0\u05d5\u05ea \u05d4\u05d2\u05e2\u05d4',
  en: 'Get directions',
  ru: '\u041a\u0430\u043a \u0434\u043e\u0431\u0440\u0430\u0442\u044c\u0441\u044f'
};
const mapLabel = (lang) => MAP_LABEL[lang] || MAP_LABEL.en;

// Where a family actually goes, for one group. Language-free ON PURPOSE.
//
// ⚠ THE BAGS TRAVEL, NOT THE PICKED TEXT. An email is written in the language of
// the ACCOUNT and a screen in the language of the PAGE, and a handler resolving
// this for a message would hand it whichever one it happens to be running in —
// which is the bug the group-move message already had, where an admin's screen
// language reached a family's inbox.
//
// It reads the GROUP's address, because two groups under the equal-hours rule
// can be in different places, and a family being sent to the other group's room
// is the same class of mistake as being told about a place in a group they
// cannot attend.
//
// ⚠ AND IT IS NOT FROZEN ONTO THE REGISTRATION, which every other fact in a
// confirmation is. The price and the terms are frozen because they are what a
// family AGREED to and an admin's later edit must not rewrite them. An address
// is not an agreement — it is where to turn up on Tuesday — so a room that moves
// has to reach the family, and a frozen copy would go on sending them to the
// old one. Read live, every time.
function whereFor(activity, groupId) {
  const fact = groups.factFor(activity, 'address', groupId) || {};
  const bag = (fact && fact.text) || {};
  const any = ['he', 'en', 'ru'].some((l) => String(bag[l] || '').trim());
  if (!any) return null;
  return { address: { he: bag.he || '', en: bag.en || '', ru: bag.ru || '' },
           mapUrl: mapUrlOf(fact) };
}

// --- formatters ------------------------------------------------------------
// Each returns display text for one language, or '' if there is nothing to say.

function formatAges(f, lang) {
  const min = num(f.min);
  const max = num(f.max);
  if (min != null && max != null) return `${min}-${max}`;
  if (min != null) {
    return lang === 'he' ? `מגיל ${min}` : lang === 'ru' ? `от ${min} лет` : `From age ${min}`;
  }
  if (max != null) {
    return lang === 'he' ? `עד גיל ${max}` : lang === 'ru' ? `до ${max} лет` : `Up to age ${max}`;
  }
  return '';
}

// Which grammatical number the weekday takes is NOT a property of the frequency
// alone, which is the trap in adding biweekly. English and Hebrew take the
// SINGULAR day ("Every other Wednesday", "אחת לשבועיים, יום רביעי"); Russian
// takes the PLURAL ("раз в две недели, по средам"), because the natural Russian
// for a recurring weekday is the "по + dative plural" form the table already
// stores, and "раз в две недели, среда" is not how anyone says it. So this is a
// lookup on (frequency, language), not on frequency.
const PLURAL_DAY = {
  he: { weekly: true, 'twice-weekly': true },
  en: { weekly: true, 'twice-weekly': true },
  ru: { weekly: true, 'twice-weekly': true, biweekly: true }
};

function weekOrdinal(nth, lang, day) {
  const last = nth === 'last' || nth === 'Last';
  const idx = Number(nth) - 1;
  if (lang === 'ru') {
    const g = RU_DAY_GENDER[day] || 'm';
    return last ? WEEK_LAST.ru[g] : (WEEK_ORDINALS.ru[g][idx] || WEEK_ORDINALS.ru[g][0]);
  }
  const table = WEEK_ORDINALS[lang] || WEEK_ORDINALS.en;
  return last ? (WEEK_LAST[lang] || WEEK_LAST.en) : (table[idx] || table[0]);
}

// "14 October" / "14 \u05D1\u05D0\u05D5\u05E7\u05D8\u05D5\u05D1\u05E8" / "14 \u043E\u043A\u0442\u044F\u0431\u0440\u044F", from an ISO date. Lifted out of
// sessionRows() when a custom schedule started naming its dates, because two
// copies of this are two places Hebrew's \u05D1 prefix or Russian's genitive can be
// forgotten. Returns '' for anything that is not a date, so a caller can test it.
function dayAndMonth(iso, lang) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  if (!m) return '';
  const months = MONTHS[lang] || MONTHS.en;
  const mi = +m[2] - 1;
  if (mi < 0 || mi > 11) return '';
  const dayNum = String(+m[3]);
  // Hebrew prefixes the month with \u05D1; Russian needs the genitive.
  return lang === 'he' ? `${dayNum} \u05D1${months[mi]}`
       : lang === 'ru' ? `${dayNum} ${MONTHS_RU_GEN[mi]}`
       : `${dayNum} ${months[mi]}`;
}

function formatSchedule(f, lang) {
  const sessions = Array.isArray(f.sessions) ? f.sessions : [];
  const freq = String(f.frequency || '').trim();
  const names = DAYS[lang] || DAYS.en;
  const plural = !!((PLURAL_DAY[lang] || PLURAL_DAY.en)[freq]);

  const parts = sessions
    .map((s) => {
      const day = num(s && s.day);
      const time = String((s && s.time) || '').trim();

      // ⚠ A DATED ROW NAMES ITS DATE. A custom schedule can say "Wednesday, 14
      // October, 16:00" rather than only "Wednesday, 16:00" — which on an
      // activity meeting a handful of times was the whole question a reader
      // had. The weekday still leads, because it is how somebody checks the
      // date against their own week; it is DERIVED from the date on save, so
      // the two cannot disagree. Never plural here whatever the frequency: one
      // date is one meeting, and "Wednesdays, 14 October" is not a sentence.
      const dated = dayAndMonth(s && s.date, lang);
      if (dated) {
        const head = day == null || day < 0 || day > 6
          ? dated : `${names.one[day]}, ${dated}`;
        return time ? `${head}, ${time}` : head;
      }

      if (day == null || day < 0 || day > 6) return time;
      const name = plural ? names.many[day] : names.one[day];

      if (freq === 'monthly') {
        const ord = weekOrdinal(f.weekOfMonth == null || f.weekOfMonth === '' ? 1 : f.weekOfMonth, lang, day);
        // Hebrew puts the day first and the week second, per review:
        // "יום רביעי, בשבוע השני של החודש". English and Russian lead with the
        // ordinal, which is where the gender agreement lands in Russian.
        const phrase = lang === 'he'
          ? `${name}, ${ord} ${MONTH_OF.he}`
          : `${ord} ${name} ${MONTH_OF[lang] || MONTH_OF.en}`;
        return time ? `${phrase}, ${time}` : phrase;
      }

      if (freq === 'biweekly') {
        const phrase = lang === 'he' ? `אחת לשבועיים, ${name}`
                     : lang === 'ru' ? `раз в две недели, ${name}`
                     : `Every other ${name}`;
        return time ? `${phrase}, ${time}` : phrase;
      }

      return time ? `${name}, ${time}` : name;
    })
    .filter(Boolean);
  return parts.join(' · ');
}

// ⚠ THE SCHEDULE FACT WHEN THE GROUPS DIFFER. Beginners on Mondays and Advanced
// on Wednesdays is one activity with two answers, and the card has to give both
// — a single line would be right for at most one of the groups reading it.
//
// One line per group, named, joined with a NEWLINE: `.sidebar-facts span` is
// already `white-space:pre-line` and several facts on this site are more than
// one line, so this needs no new markup and no new CSS. A group with no schedule
// of its own shows the activity's, which is what it meets on.
//
// Falls straight through to the single-line form when no group has its own,
// which is every activity on the site today.
function scheduleText(activity, lang) {
  return aggregateText(activity, 'schedule', lang);
}

// ⚠ ONE TABLE PER GROUP when the groups keep their own calendars, because a
// family in one of them reading the other's dates is the whole bug this exists
// to fix. `title` is null when there is one table, so the single-calendar page —
// which is every page on the site today — renders exactly as it did.
function sessionTables(activity, lang) {
  const list = groups.groupList(activity);
  if (!list.length) {
    const rows = sessionRows(((activity && activity.facts) || {}).duration || {}, lang);
    return rows.length ? [{ groupId: null, title: null, rows: rows }] : [];
  }

  const tables = list.map((g) => ({
    groupId: g.groupId,
    title: pick(g.name, lang) || null,
    rows: sessionRows({ sessionDates: groups.calendarFor(activity, g.groupId) }, lang)
  }));

  // ⚠ ONE UNTITLED TABLE WHEN THE GROUPS MEET ON THE SAME DATES, which is every
  // published page today. Every activity has groups now, so keying the shape off
  // "does it have groups" would have put a caption on pages that have never had
  // one and split a single timetable into two identical copies. The question is
  // whether the groups actually DIFFER — which is the same question every fact
  // on this page asks of itself.
  const first = JSON.stringify(tables[0].rows);
  if (tables.every((t) => JSON.stringify(t.rows) === first)) {
    return tables[0].rows.length
      ? [{ groupId: list.length === 1 ? list[0].groupId : null, title: null, rows: tables[0].rows }]
      : [];
  }
  return tables.filter((t) => t.rows.length);
}

// One row per session that actually happens. Excluded dates are not rendered as
// "no class" rows, they are simply absent: the exclusion is an admin concept
// from end to end, and a reader has no use for a meeting that is not happening.
function sessionRows(f, lang) {
  const rows = Array.isArray(f && f.sessionDates) ? f.sessionDates : [];
  const names = (DAYS[lang] || DAYS.en).one;
  const months = MONTHS[lang] || MONTHS.en;
  const label = (SESSION_TABLE[lang] || SESSION_TABLE.en).row;
  const out = [];
  rows.forEach((r) => {
    if (!r || !r.date || r.status === 'excluded') return;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(r.date);
    if (!m) return;
    const day = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();
    out.push({ n: out.length + 1, label: `${label} ${out.length + 1}`, day: names[day],
               date: dayAndMonth(r.date, lang), year: m[1] });
  });
  // No year in the rows, because the date range is already on the page two
  // blocks up as the duration fact, and a second place to print the same two
  // dates is a second place for one of them to be wrong. The exception is a
  // course running December into January, where a bare "6 January" genuinely
  // does not say which year — so the year appears only when the sessions span
  // more than one.
  const years = out.map((r) => r.year).filter((y, i, a) => a.indexOf(y) === i);
  if (years.length > 1) out.forEach((r) => { r.date = `${r.date} ${r.year}`; });
  out.forEach((r) => { delete r.year; });
  return out;
}

function monthYear(iso, lang) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(String(iso || '').trim());
  if (!m) return '';
  const year = m[1];
  const idx = Number(m[2]) - 1;
  if (idx < 0 || idx > 11) return '';
  return `${(MONTHS[lang] || MONTHS.en)[idx]} ${year}`;
}

function monthYearGenitive(iso, lang) {
  if (lang !== 'ru') return monthYear(iso, lang);
  const m = /^(\d{4})-(\d{2})/.exec(String(iso || '').trim());
  if (!m) return '';
  const idx = Number(m[2]) - 1;
  if (idx < 0 || idx > 11) return '';
  return `${MONTHS_RU_GEN[idx]} ${m[1]}`;
}

function formatDuration(f, lang) {
  const parts = [];
  let dateRange = false;

  const from = monthYear(f.startDate, lang);
  const to = monthYear(f.endDate, lang);
  // A plain hyphen, not an en dash: one less character that renders
  // unpredictably beside Hebrew numerals, and the same joiner the age range
  // has always used.
  if (from && to) { parts.push(`${from} - ${to}`); dateRange = true; }
  else if (from) {
    parts.push(lang === 'he' ? `החל מ${from}` :
               lang === 'ru' ? `с ${monthYearGenitive(f.startDate, lang)}` : `From ${from}`);
    dateRange = true;
  } else if (to) {
    parts.push(lang === 'he' ? `עד ${to}` :
               lang === 'ru' ? `до ${monthYearGenitive(f.endDate, lang)}` : `Until ${to}`);
    dateRange = true;
  }

  const count = num(f.sessionCount);
  if (count != null && count > 0) {
    parts.push(
      lang === 'he' ? (count === 1 ? 'מפגש אחד' : `${count} מפגשים`) :
      lang === 'ru' ? `${count} ${ruPlural(count, 'занятие', 'занятия', 'занятий')}` :
      `${count} ${count === 1 ? 'session' : 'sessions'}`
    );
  }

  const minutes = num(f.sessionMinutes);
  if (minutes != null && minutes > 0) {
    parts.push(
      lang === 'he' ? `${minutes} דקות` :
      lang === 'ru' ? `${minutes} мин` :
      `${minutes} min`
    );
  }

  // The date range gets its own line; how often and how long stay together on
  // the next. They answer different questions, and as one ·-joined run they
  // wrapped arbitrarily in a narrow column.
  const range = parts.length && dateRange ? parts.shift() : null;
  const rest = parts.join(' · ');
  return [range, rest].filter(Boolean).join('\n');
}

// ⚠ THE GROUPS AN ACTIVITY HAS, AND THERE IS ALWAYS AT LEAST ONE. This used to
// take the groupSize FACT and return an opt-in list that was usually empty. It
// takes the ACTIVITY now and the list is the model — see _activity-groups.js.
function namedGroups(activity) {
  return groups.groupList(activity);
}

// "Beginners, up to 7". A group with no capacity is still named — the name is
// the part a family chooses by, and an unfilled number should not delete it.
function namedGroupLine(g, lang) {
  const name = pick(g.name, lang);
  if (!name) return '';
  const cap = num(g.capacity);
  if (cap == null || cap <= 0) return name;
  if (lang === 'he') return `${name}, עד ${cap} תלמידים`;
  if (lang === 'ru') return `${name}, до ${cap} ${ruPlural(cap, 'ученика', 'учеников', 'учеников')}`;
  return `${name}, up to ${cap} ${cap === 1 ? 'student' : 'students'}`;
}

// The one group's size, with no name and no count in front of it. One group is
// not a grouping, so "1 group / up to 20 students" says the same thing twice and
// the first half of it says nothing at all.
function soleGroupLine(g, lang) {
  const cap = num(g.capacity);
  if (cap == null || cap <= 0) return '';
  if (lang === 'he') return `עד ${cap} תלמידים`;
  if (lang === 'ru') return `до ${cap} ${ruPlural(cap, 'ученика', 'учеников', 'учеников')}`;
  return `Up to ${cap} ${cap === 1 ? 'student' : 'students'}`;
}

// How many places an activity has in total — the sum of its groups' capacities.
// The arithmetic lives in _activity-groups.js beside the list it sums; this is
// the name the rest of the codebase already calls it by.
function totalCapacity(activity) {
  return groups.totalCapacity(activity);
}

function formatGroupSize(activity, lang) {
  const f = ((activity && activity.facts) || {}).groupSize || {};
  // A filled-in override replaces the computed sentence outright, the same shape
  // perHourOverride already has on price: some groupings are not "N groups of up
  // to M" and no amount of number-formatting makes them so. Blank falls through
  // to the computed form, so this costs nothing when it is not used.
  // pick() rather than a bare string: the override is per-language and follows
  // the same FALLBACK chain every other sentence does, so an override typed in
  // Hebrew alone shows in Hebrew on all three pages until it is translated.
  // That is deliberately NOT "fall back to the computed line" — untranslated
  // text says the same thing in the wrong language, whereas the computed line
  // would have the English page making a different claim about the grouping
  // than the Hebrew one, which is the failure this override exists to avoid.
  const override = pick(f.overrideText, lang);
  if (override) return override;

  // The computed sentence is now read off the GROUP LIST rather than off two
  // numbers that had to be kept in step with it. `groups` and `maxPerGroup` are
  // gone: a count is the length of the list and a size is a field on one of its
  // entries, so the sentence and the capacity check can no longer disagree.
  const list = groups.groupList(activity);
  if (!list.length) return '';
  if (list.length === 1) return soleGroupLine(list[0], lang);
  return list.map((g) => namedGroupLine(g, lang)).filter(Boolean).join('\n');
}

// Total teaching hours a course is worth, in academic (45-minute) hours.
// Returns null when either half of the sum is missing — a price per hour
// invented from half the data is worse than no price per hour.
// HOW MANY SESSIONS AN ACTIVITY ACTUALLY HAS.
//
// The calendar when there is one, the typed number when there is not. Two
// editable fields for one fact is what produced the discrepancy this project
// carried for months — hebrew4kids said ten sessions across a span holding
// eleven — and the answer is not to validate them against each other but to
// stop having two.
//
// Deriving it was deliberately NOT done when the calendar was introduced,
// because pricePerHour() divides by it and changing a denominator silently
// changes a published price. It is done now because both numbers say eleven, so
// this changes nothing that anyone can see — which is the only safe moment for
// a change like this, and it does not come round again.
function sessionTotal(duration) {
  const scheduled = (Array.isArray(duration && duration.sessionDates) ? duration.sessionDates : [])
    .filter((r) => r && r.date && r.status !== 'excluded');
  if (scheduled.length) return scheduled.length;
  return num(duration && duration.sessionCount);
}

function academicHours(duration) {
  const count = sessionTotal(duration);
  const minutes = num(duration && duration.sessionMinutes);
  if (count == null || minutes == null || count <= 0 || minutes <= 0) return null;
  return (count * minutes) / ACADEMIC_MINUTES;
}

// Price per academic hour. An explicit override always wins — some activities
// are priced by arrangement and the arithmetic simply does not describe them.
// Returns { value, source: 'override' | 'computed' } or null.
function pricePerHour(price, duration) {
  const override = num(price && price.perHourOverride);
  if (override != null) return { value: override, source: 'override' };
  // A drop-in has no term price, so the academic-hour cost comes from the
  // session price instead. Same function, one more source: the arithmetic is
  // "what one meeting costs, divided by the lessons in it" either way, and the
  // only thing that differs is which figure was typed and which was derived.
  const full = num(price && price.fullPrice);
  const per = num(price && price.perSessionPrice);
  const hours = full != null && full > 0 ? academicHours(duration) : lessonsPerSession(duration);
  const basis = full != null && full > 0 ? full : per;
  if (basis == null || basis <= 0 || hours == null || hours <= 0) return null;
  const raw = basis / hours;
  // Two decimals at most, and no trailing ".00" on a round number.
  return { value: Math.round(raw * 100) / 100, source: 'computed' };
}

function money(value) {
  return `${value} ${CURRENCY}`;
}

// A "lesson" is the 45-minute academic hour, which is also what pricePerHour has
// always computed — the label changed, the arithmetic did not. A "session" is
// one meeting, so a 90-minute session is two lessons.
function lessonsPerSession(duration) {
  const minutes = num(duration && duration.sessionMinutes);
  if (minutes == null || minutes <= 0) return null;
  const lessons = minutes / ACADEMIC_MINUTES;
  // Only when it divides cleanly. A 60-minute session is 1.33 lessons, and
  // "10 sessions of 1.33 lessons" is arithmetic, not a sentence.
  return Number.isInteger(lessons) && lessons > 0 ? lessons : null;
}

// Four ROWS, one number each, because that is what a parent compares. It was a
// single ·-joined sentence once, which made the registration fee and the course
// price look like one figure and hid that they add up.
//
// Rows rather than four lines in one value, because the price is its own card
// now: a card headed "Price" whose single fact is also labelled "Price" reads as
// the same row twice, which is exactly what the group-heading rule forbids. Each
// row is a label, an optional italic qualifier, and one number — the same shape
// every other fact in every other card uses.
//
// Every row is conditional on the data behind it, so this is the shape for
// EVERY activity, not a layout that only fits this one: an activity with just a
// full price renders one row. The total appears only when there are two numbers
// to add — otherwise it would repeat the row above it.
//
// Nothing here is typed. registrationFee and fullPrice are fields; per-lesson is
// fullPrice ÷ academic hours (or perHourOverride); the "N sessions × M lessons"
// qualifier and the total are both derived. Change either field and all four
// rows stay consistent.
// Default OFF. An absent key is off, so no existing record starts showing a row
// it was never configured for; only an explicit true opts in.
function showPerLesson(price) { return (price && price.showPerLesson) === true; }

// The public card cannot know who is reading it, so it prices the ACTIVITY, not
// a person: the standard yearly registration fee and the semester fee, always,
// as two separate numbers. There is deliberately no waiver logic here. "Already
// paid this year" is a fact about one participant, knowable only after login,
// and this page is a static file served to everyone identically -- so a card
// that tried to reflect it could only ever be wrong for somebody. That check
// belongs to the registration flow, applied to a known participant's own
// charge. See Phase 4; do not reintroduce it here.
function priceRows(f, lang, duration) {
  const rows = [];
  const fee = num(f.registrationFee);
  const full = num(f.fullPrice);
  const hasFee = fee != null && fee > 0;
  const hasFull = full != null && full > 0;

  const L = {
    he: { fee: 'דמי הרשמה', lesson: 'עלות לשיעור', term: 'עלות לסמסטר', perSession: 'עלות למפגש',
          late: 'הרשמה מאוחרת',
          session: ['מפגש', 'מפגשים'], unit: ['שיעור', 'שיעורים'] },
    en: { fee: 'Registration fee', lesson: 'Cost per lesson', term: 'Cost per semester',
          perSession: 'Cost per session', late: 'Late booking',
          session: ['session', 'sessions'], unit: ['lesson', 'lessons'] },
    ru: { fee: 'Регистрационный взнос', lesson: 'Стоимость урока', term: 'Стоимость семестра',
          perSession: 'Стоимость занятия', late: 'Поздняя запись' }
  }[lang] || null;
  if (!L) return [];
  // ⚠ THE KEY IS WHAT THE ROW IS, and it is here so that a caller wanting ONE of
  // these rows can say which one. The listing card wants the headline figure —
  // the term price, or the per-session price on a drop-in — and picking it by
  // matching the label would mean matching three translations of it, and would
  // break silently the next time one is reworded.
  const row = (key, label, value, note) => ({ key, label, note: note || '', value });

  // ⚠ "REGISTRATION FEE", NOT "YEARLY REGISTRATION FEE". The label carried the
  // scope for a while, on the argument that annual-ness is the one thing about
  // the fee a family cannot infer from the number. It is still the one thing
  // they cannot infer — but a three-word label on a card of two-word labels was
  // reading as clutter rather than as information, and the scope is now carried
  // where it is actually needed: the waived line on the family's own cost card,
  // which appears exactly when a returning child is NOT being charged it again.
  // That is the moment the question "why is this 300 and not 350" is asked.
  //
  // The scope itself is unchanged and is enforced in feeApplies(): one
  // participant, one activity, one ACADEMIC year.
  if (hasFee) rows.push(row('fee', L.fee, money(fee)));

  // Cost per lesson is OFF unless the activity opts in. It was the one row that
  // invited arithmetic rather than answering a question, and a teacher reading
  // the card does not price a course by the academic hour.
  const per = showPerLesson(f) ? pricePerHour(f, duration) : null;
  if (per) rows.push(row('lesson', L.lesson, money(per.value)));

  // A pay-per-session activity quotes the meeting. It is the drop-in
  // counterpart of the term price rather than an extra line beside one, so it
  // sits in the same slot and carries no "(N sessions × M lessons)" qualifier:
  // that hangs off fullPrice, which a drop-in does not have, so it disappears
  // on its own without being told to.
  //
  // Nothing here asks what TYPE the activity is. The row is conditional on the
  // figure behind it, exactly like every other row, so an activity renders
  // whichever prices it actually carries. That is why a second content type was
  // not needed: the price card was already built this way.
  const perSession = num(f.perSessionPrice);
  if (perSession != null && perSession > 0) rows.push(row('perSession', L.perSession, money(perSession)));

  // ⚠ AND THE LATE RATE, BESIDE THE ORDINARY ONE, because a card quoting one
  // price on an activity that charges two is a card that will be contradicted.
  //
  // Reported three times from one QA round, each time as a different screen:
  // the picker said €10 under a card saying €7; the evenings table said €10
  // under a card saying €7; and finally, plainly — "under Price it says 7 EUR
  // and under what to pay it shows 10 EUR. We must write under Price: regular
  // 7, late 10." The first two were fixed where they were noticed, which is
  // how a card that never mentioned the second rate survived both.
  //
  // This is the fix at the source: the price card is where a family reads what
  // an activity costs, and until now it could not say that the answer depends
  // on when you book. The other two screens explain a FIGURE they are charging;
  // this explains the ACTIVITY, and it is the only one a reader sees before
  // they have chosen anything.
  //
  // Conditional on its own figure like every other row here, so an activity
  // with no late pricing renders exactly as it did before.
  const late = f.lateDropIn || {};
  const lateHours = Number(late.hoursBefore);
  const latePrice = num(late.price);
  if (late.enabled && latePrice != null && latePrice > 0) {
    // The note is WHEN, which is the half a figure cannot carry. Without it
    // "Late booking €10" invites the question it was meant to answer.
    let when = '';
    if (Number.isFinite(lateHours) && lateHours > 0) {
      when = lang === 'he'
        ? (lateHours === 1 ? '(פחות משעה לפני המפגש)' : `(פחות מ-${lateHours} שעות לפני המפגש)`)
        : lang === 'ru'
        ? `(менее чем за ${lateHours} ${ruPlural(lateHours, 'час', 'часа', 'часов')} до занятия)`
        : (lateHours === 1 ? '(within an hour of the session)'
                           : `(within ${lateHours} hours of the session)`);
    }
    rows.push(row('lateSession', L.late, money(latePrice), when));
  }

  if (hasFull) {
    const sessions = sessionTotal(duration);
    const lessons = lessonsPerSession(duration);
    let note = '';
    // ⚠ THE QUALIFIER IS A CLAIM ABOUT ONE GROUP'S TERM, and on an activity
    // whose groups meet six times for two hours and twelve times for one, there
    // is no single true version of it. The price above it survives, because the
    // equal-hours rule means every group is sold the same teaching — see
    // pricingDuration() in _activity-groups.js, which is what sets this flag.
    if (duration && duration.qualify === false) {
      // nothing: the figure is right for everybody, the sentence is not
    } else if (sessions != null && sessions > 0 && lessons != null) {
      // A multiplication sign, because that is the arithmetic: N meetings each
      // worth M academic hours. "of" / "של" / "по" read as prose and needed
      // three translations to say one operator.
      note = lang === 'he'
        ? `(${sessions} ${sessions === 1 ? L.session[0] : L.session[1]} × ${lessons} ${lessons === 1 ? L.unit[0] : L.unit[1]})`
        : lang === 'ru'
        ? `(${sessions} ${ruPlural(sessions, 'занятие', 'занятия', 'занятий')} × ${lessons} ${ruPlural(lessons, 'урок', 'урока', 'уроков')})`
        : `(${sessions} ${sessions === 1 ? L.session[0] : L.session[1]} × ${lessons} ${lessons === 1 ? L.unit[0] : L.unit[1]})`;
    }
    rows.push(row('term', L.term, money(full), note));
  }

  // There is deliberately NO total. The two numbers are on different cycles --
  // the registration fee is charged once a YEAR, per participant per activity,
  // and the course fee once a semester -- so adding them produces a figure
  // nobody is ever billed. A child returning for the spring pays 300, not 350,
  // having paid the fee for this activity in the autumn. The sum was only ever
  // right for a first-semester registration, which is the one case where a
  // reader can also do the addition themselves.
  return rows;
}

// The same rows as one string. This is what factText() returns, so it is still
// what decides whether the price fact is empty and what a caller with no room
// for rows prints. It is DERIVED from priceRows rather than built beside it —
// two builders would drift, and a page and a test would disagree about the
// price.
function formatPrice(f, lang, duration) {
  return priceRows(f, lang, duration)
    .map((r) => `${r.label}${r.note ? ' ' + r.note : ''} - ${r.value}`)
    .join('\n');
}


// --- the one entry point ---------------------------------------------------

// The languages a class is taught in, named in the reader's own language, with
// an optional line of detail under them.
//
// The detail is a SECOND LINE rather than a continuation of the first: the list
// answers "which languages", and anything else is a different sentence. Multi-
// line fact values are already the house style — group size splits the count
// from the size, duration puts the date range above the sessions — and
// `.sidebar-facts span` carries white-space:pre-line for exactly this.
function formatInstructionLanguage(f, lang) {
  const names = LANGUAGE_NAMES[lang] || LANGUAGE_NAMES.en;
  const codes = (Array.isArray(f.codes) ? f.codes : [])
    .filter((c) => INSTRUCTION_LANGUAGES.indexOf(c) !== -1);
  // Written order, not the order somebody happened to tick: the same activity
  // reads the same way on all three pages.
  const listed = INSTRUCTION_LANGUAGES.filter((c) => codes.indexOf(c) !== -1).map((c) => names[c]);
  return [listed.join(' · '), pick(f.text, lang)].filter(Boolean).join('\n');
}

// The level, from the list, plus whatever else a family needs to know.
//
// Either half alone is a complete answer: an activity can say "Beginners" and
// nothing more, or say nothing about level and carry a sentence about what to
// bring to it. An activity with neither renders nothing and its card drops the
// row, which is what every empty fact here does.
function formatPrerequisites(f, lang) {
  const names = LEVEL_NAMES[lang] || LEVEL_NAMES.en;
  const level = LEVELS.indexOf(f.level) !== -1 ? names[f.level] : '';
  return [level, pick(f.text, lang)].filter(Boolean).join('\n');
}

// Display text for one fact in one language. Falls back to the words an admin
// typed before this field was structured, so migrating a record is something
// that can happen later without the page going blank in the meantime.
// One fact, one group, one language. `f` is already the right group's copy — the
// resolving happened in _activity-groups.js, which is the only place that knows
// how.
function formatOne(activity, key, f, lang) {
  if (!f || typeof f !== 'object') return '';
  let text = '';
  if (key === 'ages') text = formatAges(f, lang);
  else if (key === 'schedule') text = formatSchedule(f, lang);
  else if (key === 'duration') text = formatDuration(f, lang);
  else if (key === 'groupSize') text = formatGroupSize(activity, lang);
  else if (key === 'instructionLanguage') text = formatInstructionLanguage(f, lang);
  else if (key === 'prerequisites') text = formatPrerequisites(f, lang);
  else if (key === 'location' || key === 'address') text = pick(f.text, lang);
  // The price is sold against HOURS, and every group has the same number of
  // them — so any group's session length and count give the right figure, and
  // pricingDuration() is what decides whether the "(N × M)" qualifier under it
  // is still a true sentence.
  else if (key === 'price') text = formatPrice(f, lang, groups.pricingDuration(activity));

  return text || pick(f.legacyText, lang);
}

// ⚠ WHAT THE WHOLE ACTIVITY SAYS ABOUT A FACT ITS GROUPS MAY DISAGREE ON.
//
// When they agree — which is every published page today, and every activity that
// has only one group — the answer is that value, rendered exactly as it was
// before groups existed. Nothing about the model change reaches the page until
// an admin actually makes two groups differ.
//
// When they differ, each group answers for itself and says which one it is. A
// single line would be right for at most one of the families reading it, which
// is the bug this whole restructuring exists to fix.
function aggregateText(activity, key, lang) {
  const across = groups.factAcross(activity, key);
  const lines = across.map((row) => ({
    name: row.group ? pick(row.group.name, lang) : '',
    text: formatOne(activity, key, row.value, lang)
  }));

  const first = lines[0] ? lines[0].text : '';
  if (lines.every((l) => l.text === first)) return first;

  const agg = aggregateOf(key, across, lines, lang);
  if (agg) return agg;

  return lines
    .filter((l) => l.text)
    // The name on the same line for a one-line value and on its own line above a
    // multi-line one. `.sidebar-facts span` is already `white-space:pre-line`,
    // so both render as written with no new markup.
    .map((l) => (!l.name ? l.text
      : l.text.indexOf('\n') === -1 ? `${l.name}: ${l.text}` : `${l.name}:\n${l.text}`))
    .join('\n');
}

// ⚠ THREE FACTS HAVE A TRUE SHORT ANSWER ACROSS GROUPS, and the rest do not.
//
// Returns '' when there is no honest aggregate, and the caller falls back to a
// line per group. That is the important direction: a made-up summary on the one
// card a parent decides from is worse than three lines they have to read.
function aggregateOf(key, across, lines, lang) {
  // ⚠ THE UNION RANGE, and it says LESS than it looks like it says. "6-13"
  // across a 6-9 group and a 10-13 one means a nine-year-old has somewhere to
  // go, not that they may join either — which is exactly why the groups section
  // under it spells out which, and why "choose your group" is on the page
  // rather than implied. A bound is aggregated only when EVERY group states it:
  // one group with no upper limit makes the activity's upper limit unknown, and
  // taking the highest stated one would invent a ceiling nobody set.
  if (key === 'ages') {
    const mins = across.map((r) => num(r.value.min)).filter((v) => v != null);
    const maxs = across.map((r) => num(r.value.max)).filter((v) => v != null);
    return formatAges({
      min: mins.length === across.length ? Math.min.apply(null, mins) : null,
      max: maxs.length === across.length ? Math.max.apply(null, maxs) : null
    }, lang);
  }

  // ⚠ THE DISTINCT CITIES, JOINED — "Limassol, Nicosia". Computed on the PICKED
  // text rather than on the stored bag, because pick() falls back across
  // languages: two groups sharing a Hebrew city name and differing in English
  // would otherwise report one city on one page and two on another, about the
  // same activity on the same day.
  if (key === 'location' || key === 'address') {
    const seen = [];
    lines.forEach((l) => { if (l.text && seen.indexOf(l.text) === -1) seen.push(l.text); });
    return seen.join(', ');
  }

  // Every language anybody is taught in, in written order — the same order one
  // group's own list is rendered in, so the aggregate cannot read as a different
  // kind of statement. The optional free-text note is dropped: it belongs to one
  // group and there is no union of two sentences.
  if (key === 'instructionLanguage') {
    const names = LANGUAGE_NAMES[lang] || LANGUAGE_NAMES.en;
    const all = [];
    across.forEach((r) => (Array.isArray(r.value.codes) ? r.value.codes : [])
      .forEach((c) => { if (all.indexOf(c) === -1) all.push(c); }));
    return INSTRUCTION_LANGUAGES.filter((c) => all.indexOf(c) !== -1).map((c) => names[c]).join(' · ');
  }

  // schedule, duration and prerequisites have no union worth printing. "January
  // to June and February to May" is not a date range, and "Beginners and
  // Advanced" is not a level.
  return '';
}

// "2 groups" / "2 קבוצות" / "2 группы".
function groupCountText(n, lang) {
  if (lang === 'he') return n === 1 ? 'קבוצה אחת' : `${n} קבוצות`;
  if (lang === 'ru') return `${n} ${ruPlural(n, 'группа', 'группы', 'групп')}`;
  return `${n} ${n === 1 ? 'group' : 'groups'}`;
}

// ⚠ THE ONE BUILDER BOTH SURFACES READ. The listing card and the activity page
// ask the same function what an activity's groups are, so a card cannot start
// describing a choice the page under it does not offer — the same rule that
// already makes the card's tags come out of sidebarRows().
//
// Null when there is no choice to describe, which is one group: nothing is
// published, nobody is asked, and every page on the site today renders as it
// always has.
//
// `facts` on each row is only what that group does NOT share with the others.
// Repeating the agreed facts under every name would make two identical lists
// and bury the one line that differs, which is the whole thing a reader is
// there to compare.
function groupChoice(activity, lang) {
  const list = groups.groupList(activity);
  if (list.length < 2) return null;

  const differing = groups.GROUP_FACTS.filter((key) => {
    if (!isPublicFact(activity, key)) return false;
    const texts = groups.factAcross(activity, key)
      .map((r) => formatOne(activity, key, r.value, lang));
    return texts.some((t) => t !== texts[0]);
  });

  return {
    count: list.length,
    countText: groupCountText(list.length, lang),
    differing: differing,
    groups: list.map((g) => ({
      groupId: g.groupId,
      name: pick(g.name, lang),
      capacity: num(g.capacity),
      facts: differing
        .map((key) => ({ key: key, value: factText(activity, key, lang, g.groupId) }))
        .filter((f) => f.value)
    }))
  };
}

// Display text for one fact in one language. Falls back to the words an admin
// typed before this field was structured, so migrating a record is something
// that can happen later without the page going blank in the meantime.
//
// ⚠ `groupId` IS OPTIONAL AND ITS ABSENCE MEANS SOMETHING. Given one, this is
// what that group is told. Left out, it is what the ACTIVITY says — the shared
// value when the groups agree and the per-group breakdown when they do not. The
// public page leaves it out; the family area, which knows which group somebody
// is in, passes it.
function factText(activity, key, lang, groupId) {
  const facts = (activity && activity.facts) || {};
  if (TEXT_FACTS.indexOf(key) !== -1) return pick(facts[key], lang);
  if (!groups.isGroupFact(key)) return formatOne(activity, key, facts[key], lang);
  if (groupId === undefined) return aggregateText(activity, key, lang);
  return formatOne(activity, key, groups.factFor(activity, key, groupId), lang);
}

// The price fact, as rows, for the one card that renders them individually.
// Returns [] when there are no structured numbers — which is also when
// factText() falls back to the words an admin typed, and that fallback is a
// sentence, not rows, so the caller renders it as an ordinary fact.
function factPriceRows(activity, lang) {
  const facts = (activity && activity.facts) || {};
  const f = facts.price;
  if (!f || typeof f !== 'object') return [];
  return priceRows(f, lang, groups.pricingDuration(activity));
}

// The sidebar, in order, with empty rows dropped. `groupId` is passed straight
// through to factText(): absent means the activity's own answer, present means
// one group's.
function sidebarRows(activity, lang, groupId) {
  return FACT_ORDER
    .map((key) => ({ key, visibility: visibilityOf(activity, key),
                     value: factText(activity, key, lang, groupId) }))
    .filter((row) => row.value)
    .filter((row) => isPublicFact(activity, row.key));
}

// The facts are four cards, each with an icon and a label, rather than nine
// label/value rows. The rows put the label at one edge and the value at the
// other, which is a shape that has to be told which edge is which, and that is
// what kept breaking in Hebrew. A card stacks its facts instead, so nothing is
// pushed to an edge and the direction is simply inherited.
//
// The grouping answers the three questions a parent asks in the order they ask
// them — is this for my child, when and where is it, what does it cost — and
// then who teaches it. It replaced a "Details" card that was the leftovers of
// the other three: Location, Language of instruction and Price had nothing in
// common except not fitting elsewhere. Language of instruction moved to "Who it
// is for" (it is a prerequisite in practice), Location to "When & where" (a
// reader asking when also asks where), and Price became its own card, because a
// number a family decides on should not be the last line of a mixed list.
//
// Each card lists its facts in the order they should READ, which is not
// FACT_ORDER: Location comes after Duration here so that a wide card, which
// lays its facts out in two columns, puts Location under When and leaves
// Duration the width to hold its date range on one line. FACT_ORDER stays the
// canonical list of what a fact IS, and the assertion below ties the two
// together, so a fact can neither appear twice nor vanish by being left out of
// every card.
const FACT_GROUPS = [
  { key: 'participants', facts: ['ages', 'groupSize', 'prerequisites', 'instructionLanguage'] },
  { key: 'schedule',     facts: ['schedule', 'duration', 'location', 'address'] },
  { key: 'price',        facts: ['price'] }
];

(function assertEveryFactIsGroupedExactlyOnce() {
  const seen = [].concat(...FACT_GROUPS.map((g) => g.facts));
  const missing = FACT_ORDER.filter((k) => seen.indexOf(k) === -1);
  const extra = seen.filter((k) => FACT_ORDER.indexOf(k) === -1);
  const twice = seen.filter((k, i) => seen.indexOf(k) !== i);
  if (missing.length || extra.length || twice.length) {
    throw new Error('FACT_GROUPS is out of step with FACT_ORDER: ' +
      JSON.stringify({ missing, extra, twice }));
  }
})();

// Groups with their facts resolved, ready to render. A group whose facts are all
// empty or all members-only is dropped whole, so an activity that has not filled
// in its schedule gets no empty "When & where" heading with an icon beside it.
// ⚠ THE AUTHENTICATED VIEW, and it is a SECOND DOOR ONTO ONE BUILDER rather
// than a second builder.
//
// This file has said since the flag was written that "when a members area
// exists, the private rows are served by that authenticated view — they still
// never enter this file". This is that view. isPubliclyVisible() keeps its exact
// meaning and its one caller; what changes is whether the filter is asked at
// all, and only a caller that has already established WHO is asking may skip it.
//
// Two separate exported names rather than an options flag, so the published
// template cannot reach the private rows by forgetting an argument — the same
// reason `published()` and `publishedForDisplay()` are two names for one read. A
// test asserts _activity-template.js never mentions this one.
function memberSidebarRows(activity, lang, groupId) {
  return FACT_ORDER
    .map((key) => ({ key, visibility: visibilityOf(activity, key),
                     value: factText(activity, key, lang, groupId) }))
    .filter((row) => row.value);
}

function memberSidebarGroups(activity, lang, groupId) {
  return groupsOf(memberSidebarRows(activity, lang, groupId));
}

function sidebarGroups(activity, lang, groupId) {
  return groupsOf(sidebarRows(activity, lang, groupId));
}

function groupsOf(rows) {
  const byKey = {};
  rows.forEach((r) => { byKey[r.key] = r; });
  return FACT_GROUPS
    .map((group) => ({
      key: group.key,
      facts: group.facts.map((k) => byKey[k]).filter(Boolean)
    }))
    .filter((group) => group.facts.length);
}

module.exports = {
  INSTRUCTION_LANGUAGES, LANGUAGE_NAMES, LEVELS, LEVEL_NAMES,
  formatInstructionLanguage, formatPrerequisites,
  namedGroups, namedGroupLine, soleGroupLine, totalCapacity,
  GROUP_FACTS, ACTIVITY_FACTS, aggregateText, groupChoice, groupCountText,
  FACT_ORDER, TEXT_FACTS, STRUCTURED_FACTS, DEFAULT_VISIBILITY,
  ACADEMIC_MINUTES, CURRENCY,
  num, pick, ruPlural, monthYear, sessionTotal, dayAndMonth,
  formatAges, formatSchedule, scheduleText, formatDuration, sessionRows, sessionTables,
  weekOrdinal, showPerLesson,
  SESSION_TABLE, WEEK_ORDINALS, RU_DAY_GENDER, formatGroupSize, formatPrice,
  priceRows, factPriceRows,
  academicHours, pricePerHour,
  visibilityOf, isPubliclyVisible, factText, sidebarRows,
  memberSidebarRows, memberSidebarGroups,
  mapUrlOf, mapUrlProblem, mapUrlText, mapLabel, MAP_LABEL, whereFor,
  FACT_GROUPS, sidebarGroups
};
