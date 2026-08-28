// Bringing old records forward to the structured facts, without losing a word.
//
// Facts used to be free text: `facts.ages = { he: '6-10', en: '6-10' }`. They
// are structured values now. The rule for the change-over is that migrating
// must never blank a live page and must never silently discard something an
// admin wrote.
//
// So: anything that parses unambiguously is converted (an age range really is
// two integers and nothing else). Anything that does not is kept verbatim in
// `legacyText` and goes on being published exactly as before, until someone
// fills in the structured fields — at which point the built sentence takes
// over. Nothing is deleted on the way through.
//
// Everything here is pure. migrate() is idempotent: running it on an
// already-migrated record returns the same record.

const { FACT_ORDER, TEXT_FACTS, DEFAULT_VISIBILITY, num } = require('./_activity-facts');

const LANGS = ['he', 'en', 'ru'];

const emptyLang = () => ({ he: '', en: '', ru: '' });

function langObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { he: String(value.he || ''), en: String(value.en || ''), ru: String(value.ru || '') };
  }
  if (typeof value === 'string') return { he: value, en: '', ru: '' };
  return emptyLang();
}

const hasAnyText = (l) => LANGS.some((k) => String(l[k] || '').trim() !== '');

// A legacy fact is a { he, en, ru } bag and nothing else. A structured one has
// its own keys, so the presence of any other key means it has already moved.
function isLangObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.keys(value).every((k) => LANGS.indexOf(k) !== -1);
}

// "6-10" is two integers and can only mean one thing. Anything else — "6 ומעלה",
// "from 6", a range with a note after it — is left alone for a human.
function parseAgeRange(langObj) {
  for (const l of LANGS) {
    const m = /^\s*(\d{1,2})\s*[-–—]\s*(\d{1,2})\s*$/.exec(String(langObj[l] || ''));
    if (m) {
      const min = Number(m[1]);
      const max = Number(m[2]);
      if (min <= max) return { min, max };
    }
  }
  return null;
}

// --- canonical shapes ------------------------------------------------------
// One place that says what a fact looks like, used both by the migration and by
// every save, so a record written by an old client cannot reintroduce the old
// shape.

const SHAPES = {
  ages: (f) => ({ min: num(f.min), max: num(f.max) }),
  schedule: (f) => ({
    frequency: ['one-time', 'weekly', 'twice-weekly', 'custom'].indexOf(f.frequency) !== -1
      ? f.frequency : 'weekly',
    sessions: (Array.isArray(f.sessions) ? f.sessions : [])
      .map((s) => ({ day: num(s && s.day), time: String((s && s.time) || '').trim() }))
      .filter((s) => s.day != null || s.time)
  }),
  duration: (f) => ({
    startDate: isoDate(f.startDate),
    endDate: isoDate(f.endDate),
    sessionCount: num(f.sessionCount),
    sessionMinutes: num(f.sessionMinutes)
  }),
  groupSize: (f) => ({ groups: num(f.groups), maxPerGroup: num(f.maxPerGroup) }),
  location: (f) => ({ text: langObject(f.text) }),
  price: (f) => ({
    registrationFee: num(f.registrationFee),
    fullPrice: num(f.fullPrice),
    perHourOverride: num(f.perHourOverride)
  })
};

function isoDate(value) {
  const v = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
}

// Coerce one fact into its canonical shape, carrying legacyText through.
function normaliseFact(key, raw) {
  if (TEXT_FACTS.indexOf(key) !== -1) return langObject(raw);
  const f = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = SHAPES[key] ? SHAPES[key](f) : {};
  const legacy = langObject(f.legacyText);
  if (hasAnyText(legacy)) out.legacyText = legacy;
  return out;
}

function normaliseFacts(rawFacts) {
  const facts = rawFacts && typeof rawFacts === 'object' ? rawFacts : {};
  const out = {};
  FACT_ORDER.forEach((key) => { out[key] = normaliseFact(key, facts[key]); });
  return out;
}

function normaliseVisibility(raw) {
  const given = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  FACT_ORDER.forEach((key) => {
    const v = given[key];
    out[key] = v === 'public' || v === 'members'
      ? v
      : (DEFAULT_VISIBILITY[key] || 'public');
  });
  return out;
}

// --- the migration ---------------------------------------------------------

function migrate(record) {
  if (!record || typeof record !== 'object') return record;
  const out = JSON.parse(JSON.stringify(record));
  const old = out.facts || {};
  const facts = {};

  // ages — the one field that converts cleanly.
  if (isLangObject(old.ages)) {
    const parsed = parseAgeRange(langObject(old.ages));
    facts.ages = parsed || {};
    if (!parsed && hasAnyText(langObject(old.ages))) facts.ages.legacyText = langObject(old.ages);
  } else {
    facts.ages = old.ages;
  }

  // schedule, groupSize, price — a sentence cannot be taken apart safely, so
  // the words are kept and go on being published until someone fills the
  // fields in. Guessing here would quietly change what a family reads.
  ['schedule', 'groupSize', 'price'].forEach((key) => {
    if (isLangObject(old[key])) {
      facts[key] = hasAnyText(langObject(old[key])) ? { legacyText: langObject(old[key]) } : {};
    } else {
      facts[key] = old[key];
    }
  });

  // location keeps being text; it just moves inside the fact.
  if (isLangObject(old.location)) facts.location = { text: langObject(old.location) };
  else facts.location = old.location;

  // duration is new. `programLength` fed it: in one record that was a date
  // range and in another a session length, which is exactly why it could not
  // be parsed and exactly why it is now four separate fields.
  if (old.duration && !isLangObject(old.duration)) {
    facts.duration = old.duration;
  } else {
    const from = langObject(out.programLength);
    facts.duration = hasAnyText(from) ? { legacyText: from } : {};
  }

  // These two were sections in the main column. They are facts to scan, so they
  // move to the sidebar — same text, new home.
  TEXT_FACTS.forEach((key) => {
    const inFacts = old[key];
    if (inFacts && hasAnyText(langObject(inFacts))) facts[key] = langObject(inFacts);
    else facts[key] = langObject(out[key]);
  });

  out.facts = normaliseFacts(facts);
  out.factVisibility = normaliseVisibility(out.factVisibility);

  // One source of truth: now that these live in facts, the top-level copies go,
  // or the next save would resurrect the old values.
  delete out.programLength;
  delete out.instructionLanguage;
  delete out.prerequisites;

  return out;
}

module.exports = {
  migrate, normaliseFacts, normaliseFact, normaliseVisibility,
  isLangObject, parseAgeRange, langObject, isoDate, SHAPES
};
