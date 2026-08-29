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

// Facts that are plain translated text rather than structured values. They moved
// out of the main column into the sidebar: they are things to scan, not to read.
const TEXT_FACTS = ['instructionLanguage', 'prerequisites'];

const STRUCTURED_FACTS = ['ages', 'schedule', 'duration', 'groupSize', 'location', 'address', 'price'];

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

function formatSchedule(f, lang) {
  const sessions = Array.isArray(f.sessions) ? f.sessions : [];
  const once = f.frequency === 'one-time';
  const names = DAYS[lang] || DAYS.en;
  const parts = sessions
    .map((s) => {
      const day = num(s && s.day);
      const time = String((s && s.time) || '').trim();
      const dayName = day != null && day >= 0 && day <= 6 ? (once ? names.one[day] : names.many[day]) : '';
      if (dayName && time) return `${dayName}, ${time}`;
      return dayName || time;
    })
    .filter(Boolean);
  return parts.join(' · ');
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
  if (from && to) { parts.push(`${from} – ${to}`); dateRange = true; }
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

function formatGroupSize(f, lang) {
  const groups = num(f.groups);
  const per = num(f.maxPerGroup);
  const hasGroups = groups != null && groups > 0;
  const hasPer = per != null && per > 0;
  if (!hasGroups && !hasPer) return '';

  // Two lines, not one sentence: "how many groups" and "how big is a group" are
  // separate numbers a reader compares, and joining them with "of" made a
  // 320px column wrap them mid-phrase. NEWLINE, not <br> — the value is escaped
  // text and stays text; .sidebar-facts span carries white-space:pre-line.
  //
  // Hebrew takes the numeral here rather than the HE_FEM word form. On its own
  // line "2 קבוצות" reads as the data point it is, which is what the rest of
  // the card does.
  let g = '';
  let pr = '';
  if (lang === 'he') {
    if (hasGroups) g = groups === 1 ? 'קבוצה אחת' : `${groups} קבוצות`;
    if (hasPer) pr = hasGroups ? `עד ${per} תלמידים בקבוצה` : `עד ${per} תלמידים`;
  } else if (lang === 'ru') {
    if (hasGroups) g = `${groups} ${ruPlural(groups, 'группа', 'группы', 'групп')}`;
    const students = `${per} ${ruPlural(per, 'ученика', 'учеников', 'учеников')}`;
    if (hasPer) pr = hasGroups ? `до ${students} в группе` : `до ${students}`;
  } else {
    if (hasGroups) g = `${groups} ${groups === 1 ? 'group' : 'groups'}`;
    const students = `up to ${per} ${per === 1 ? 'student' : 'students'}`;
    if (hasPer) pr = hasGroups ? `${students} per group` : students.charAt(0).toUpperCase() + students.slice(1);
  }
  return [g, pr].filter(Boolean).join('\n');
}


// Total teaching hours a course is worth, in academic (45-minute) hours.
// Returns null when either half of the sum is missing — a price per hour
// invented from half the data is worse than no price per hour.
function academicHours(duration) {
  const count = num(duration && duration.sessionCount);
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
  const full = num(price && price.fullPrice);
  const hours = academicHours(duration);
  if (full == null || full <= 0 || hours == null || hours <= 0) return null;
  const raw = full / hours;
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

// Four lines, one number each, because that is what a parent compares. It was a
// single ·-joined sentence, which made the registration fee and the course price
// look like one figure and hid that they add up.
//
// Every line is conditional on the data behind it, so this is the shape for
// EVERY activity, not a layout that only fits this one: an activity with just a
// full price renders one line. The total appears only when there are two
// numbers to add — otherwise it would repeat the line above it.
//
// Nothing here is typed. registrationFee and fullPrice are fields; per-lesson is
// fullPrice ÷ academic hours (or perHourOverride); the "N sessions of M lessons"
// qualifier and the total are both derived. Change either field and all four
// lines stay consistent.
function formatPrice(f, lang, duration) {
  const lines = [];
  const fee = num(f.registrationFee);
  const full = num(f.fullPrice);
  const hasFee = fee != null && fee > 0;
  const hasFull = full != null && full > 0;

  const L = {
    he: { fee: 'דמי הרשמה', lesson: 'עלות לשיעור', term: 'עלות לסמסטר', total: 'סה״כ לסמסטר' },
    en: { fee: 'Registration fee', lesson: 'Cost per lesson', term: 'Cost per semester', total: 'Total for the semester' },
    ru: { fee: 'Регистрационный взнос', lesson: 'Стоимость урока', term: 'Стоимость семестра', total: 'Итого за семестр' }
  }[lang] || null;
  if (!L) return '';
  const line = (label, value) => `${label} – ${value}`;

  if (hasFee) lines.push(line(L.fee, money(fee)));

  const per = pricePerHour(f, duration);
  if (per) lines.push(line(L.lesson, money(per.value)));

  if (hasFull) {
    const sessions = num(duration && duration.sessionCount);
    const lessons = lessonsPerSession(duration);
    let term = L.term;
    if (sessions != null && sessions > 0 && lessons != null) {
      const detail =
        lang === 'he'
          ? `${sessions} ${sessions === 1 ? 'מפגש' : 'מפגשים'} של ${lessons} ${lessons === 1 ? 'שיעור' : 'שיעורים'}`
          : lang === 'ru'
          ? `${sessions} ${ruPlural(sessions, 'занятие', 'занятия', 'занятий')} по ${lessons} ${ruPlural(lessons, 'урок', 'урока', 'уроков')}`
          : `${sessions} ${sessions === 1 ? 'session' : 'sessions'} of ${lessons} ${lessons === 1 ? 'lesson' : 'lessons'}`;
      term = `${L.term}: ${detail}`;
    }
    lines.push(line(term, money(full)));
  }

  // Computed, never typed, so it cannot drift from the two numbers above it.
  if (hasFee && hasFull) lines.push(line(L.total, money(fee + full)));

  return lines.join('\n');
}


// --- the one entry point ---------------------------------------------------

// Display text for one fact in one language. Falls back to the words an admin
// typed before this field was structured, so migrating a record is something
// that can happen later without the page going blank in the meantime.
function factText(activity, key, lang) {
  const facts = (activity && activity.facts) || {};
  const f = facts[key];

  if (TEXT_FACTS.indexOf(key) !== -1) return pick(f, lang);
  if (!f || typeof f !== 'object') return '';

  let text = '';
  if (key === 'ages') text = formatAges(f, lang);
  else if (key === 'schedule') text = formatSchedule(f, lang);
  else if (key === 'duration') text = formatDuration(f, lang);
  else if (key === 'groupSize') text = formatGroupSize(f, lang);
  else if (key === 'location' || key === 'address') text = pick(f.text, lang);
  else if (key === 'price') text = formatPrice(f, lang, facts.duration);

  return text || pick(f.legacyText, lang);
}

// The sidebar, in order, with empty rows dropped.
function sidebarRows(activity, lang) {
  return FACT_ORDER
    .map((key) => ({ key, visibility: visibilityOf(activity, key), value: factText(activity, key, lang) }))
    .filter((row) => row.value)
    .filter((row) => isPubliclyVisible(row.visibility));
}

// The sidebar is three groups, each with an icon and a label, rather than eight
// label/value rows. The rows put the label at one edge and the value at the
// other, which is a shape that has to be told which edge is which, and that is
// what kept breaking in Hebrew. A group stacks its facts instead, so nothing is
// pushed to an edge and the direction is simply inherited.
//
// Each group lists its facts in the order they should read, which is not
// FACT_ORDER: Location comes before Language of instruction here because a
// reader scanning "Practical" wants the place first. FACT_ORDER stays the
// canonical list of what a fact IS, and the assertion below ties the two
// together, so a fact can neither appear twice nor vanish by being left out of
// every group.
const FACT_GROUPS = [
  { key: 'participants', facts: ['ages', 'groupSize', 'prerequisites'] },
  { key: 'schedule',     facts: ['schedule', 'duration'] },
  { key: 'practical',    facts: ['location', 'address', 'instructionLanguage', 'price'] }
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
// in its schedule gets no empty "Schedule" heading with an icon beside it.
function sidebarGroups(activity, lang) {
  const rows = sidebarRows(activity, lang);
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
  FACT_ORDER, TEXT_FACTS, STRUCTURED_FACTS, DEFAULT_VISIBILITY,
  ACADEMIC_MINUTES, CURRENCY,
  num, pick, ruPlural, monthYear,
  formatAges, formatSchedule, formatDuration, formatGroupSize, formatPrice,
  academicHours, pricePerHour,
  visibilityOf, isPubliclyVisible, factText, sidebarRows,
  FACT_GROUPS, sidebarGroups
};
