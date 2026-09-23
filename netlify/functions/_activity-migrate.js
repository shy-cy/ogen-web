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

const { FACT_ORDER, TEXT_FACTS, DEFAULT_VISIBILITY, num,
        INSTRUCTION_LANGUAGES, LEVELS,
        LANGUAGE_NAMES, LEVEL_NAMES } = require('./_activity-facts');
const sessionsModule = require('./_activity-sessions');
const registration = require('./_activity-registration');
// Which facts belong to a group and which to the activity. The list lives in
// _activity-groups.js because that module requires nothing, so importing it
// here cannot make a cycle — see the note at the top of it.
const groupsModule = require('./_activity-groups');
const { GROUP_FACTS, ACTIVITY_FACTS } = groupsModule;

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

// One calendar normaliser, used by the activity's own `duration.sessionDates`
// and by a named group's. Two copies would be two ways for a date to survive or
// not, and the difference would surface as a group whose calendar loses its
// times on save while the activity's keeps them.
function sessionRowsOf(list) {
  return (Array.isArray(list) ? list : [])
    .map((r) => {
      const date = isoDate(r && r.date);
      if (!date) return null;
      const row = { date: date, status: (r && r.status) === 'excluded' ? 'excluded' : 'scheduled' };
      const time = String((r && r.time) || '').trim();
      if (time) row.time = time;
      const reason = String((r && r.reason) || '').trim();
      if (reason) row.reason = reason.slice(0, 200);
      return row;
    })
    .filter(Boolean)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

const SHAPES = {
  ages: (f) => ({ min: num(f.min), max: num(f.max) }),
  // The frequency list is taken FROM the calendar module rather than repeated
  // here. It was repeated, and it fell behind: biweekly and monthly could be
  // enumerated and rendered, and a save coerced either of them back to weekly,
  // silently changing what the page said the moment an admin pressed publish.
  schedule: (f) => {
    const out = {
      frequency: sessionsModule.FREQUENCIES.indexOf(f.frequency) !== -1 ? f.frequency : 'weekly',
      // ⚠ `date` HAS TO BE LISTED HERE OR IT IS DELETED ON EVERY READ. This
      // shape runs on every load and every save, so a key it does not name is
      // gone by the next write — the same silent loss sessionDates suffered
      // before it was added, where a calendar could be generated, stored,
      // rendered, and wiped by the next save with nothing erroring.
      //
      // THE WEEKDAY IS DERIVED FROM THE DATE, never stored beside it as a
      // second answer. A row saying "Tuesday" and "14 October 2026" — a
      // Wednesday — is two claims that can disagree, and the one thing that
      // could not then be decided is which of them the reader should believe.
      // With a date present the weekday is computed, so they cannot.
      sessions: (Array.isArray(f.sessions) ? f.sessions : [])
        .map((s) => {
          const time = String((s && s.time) || '').trim();
          const date = sessionsModule.parseISO(s && s.date) == null
            ? null : String(s.date).trim();
          const day = date ? sessionsModule.isoWeekday(date) : num(s && s.day);
          const out = { day: day, time: time };
          if (date) out.date = date;
          return out;
        })
        .filter((s) => s.day != null || s.time || s.date)
    };
    // Which week of the month a monthly activity meets in. 'last' is a real
    // option rather than an error state: a month with only four of a weekday
    // uses the last one instead of inventing a fifth.
    if (out.frequency === 'monthly') {
      out.weekOfMonth = f.weekOfMonth === 'last' ? 'last' : (num(f.weekOfMonth) || 1);
    }
    return out;
  },
  duration: (f) => ({
    startDate: isoDate(f.startDate),
    endDate: isoDate(f.endDate),
    sessionCount: num(f.sessionCount),
    sessionMinutes: num(f.sessionMinutes),
    // THE CALENDAR SURVIVES A SAVE. This shape is applied to every record on
    // every read and every save, so a key missing from it is a key deleted the
    // next time an admin presses save. sessionDates was missing: the calendar
    // module could generate it, the facts module could render it, and any save
    // silently threw it away.
    //
    // `reason` is an admin note on an excluded date and is deliberately never
    // published — the page lists the sessions that are happening and nothing
    // else, so a reason has no reader on the public side.
    sessionDates: sessionRowsOf(f.sessionDates)
  }),
  // ⚠ WHAT IS LEFT OF THE GROUP SIZE FACT IS THE OVERRIDE, AND NOTHING ELSE.
  //
  // It used to hold `groups`, `maxPerGroup` and the `named[]` list — the whole
  // idea of a group, filed under a fact called "group size" because that is
  // where the first of them happened to fit. Groups are their own thing now
  // (see _activity-groups.js): a count is the length of activity.groups, a
  // capacity is a field on one of them, and a name is words a family picks by.
  //
  // The override survives because it is a different kind of statement: not
  // "how many and how big" but a sentence replacing the computed one outright,
  // for a grouping that is not "N groups of up to M" and never will be. It is
  // WORDS, so it is a { he, en, ru } bag; langObject() puts a bare string in
  // `he`, which is what a pre-trilingual override was.
  groupSize: (f) => ({ overrideText: langObject(f.overrideText) }),
  // ⚠ THE LAST TWO FREE-TEXT FACTS, STRUCTURED.
  //
  // Both were a Hebrew box, an English box and a Russian box holding whatever
  // somebody typed — the exact shape the rest of this file exists to replace.
  // An admin filling in one language published one language, three pages could
  // disagree about what a class required, and "Beginners" was spelled a
  // different way on every activity.
  //
  // A code and a level now, rendered per language in _activity-facts.js, with
  // the free text KEPT as an optional extra line. Nothing typed before this is
  // lost: an old value was a bare {he,en,ru} bag, and it lands in `text` exactly
  // as it was — the same promise legacyText makes for the facts that were
  // converted before these.
  instructionLanguage: (f) => {
    const codes = (Array.isArray(f.codes) ? f.codes : [])
      .filter((c) => INSTRUCTION_LANGUAGES.indexOf(c) !== -1);
    return {
      codes: codes,
      text: dropRestatement(langObject(f.text),
                            codes.map((c) => namesOf(LANGUAGE_NAMES, c)))
    };
  },
  prerequisites: (f) => {
    const level = LEVELS.indexOf(f.level) !== -1 ? f.level : null;
    return {
      level: level,
      text: dropRestatement(langObject(f.text),
                            level ? [namesOf(LEVEL_NAMES, level)] : [])
    };
  },
  location: (f) => ({ text: langObject(f.text) }),
  address: (f) => ({ text: langObject(f.text) }),
  price: (f) => ({
    registrationFee: num(f.registrationFee),
    fullPrice: num(f.fullPrice),
    perHourOverride: num(f.perHourOverride),
    // What one session costs on a pay-per-session activity. It is the drop-in
    // counterpart of fullPrice, not an extra line beside it: a course quotes
    // the term and derives the per-lesson cost, a drop-in quotes the session.
    perSessionPrice: num(f.perSessionPrice),
    // Absent means off. Normalised to a real boolean so the checkbox has
    // something to bind to and a save cannot write undefined back.
    showPerLesson: f.showPerLesson === true,
    // ⚠ SHAPES ARE APPLIED ON EVERY READ AND EVERY SAVE, so a key missing from
    // here is a key the next save DELETES. That is exactly how the session
    // calendar was silently lost for a while — generated, stored, rendered, and
    // gone on the following save. Both new fields are listed for that reason.
    //
    // Late drop-in pricing: absent means off, and `enabled: false` with the two
    // numbers kept means an admin who switches it off does not lose what they
    // typed. Same instinct as a cutoff an admin switched off staying off.
    lateDropIn: {
      enabled: (f.lateDropIn || {}).enabled === true,
      hoursBefore: num((f.lateDropIn || {}).hoursBefore),
      price: num((f.lateDropIn || {}).price)
    },
    // Bundles. A list, because "5 entries" and "10 entries" are two products on
    // one activity — and the empty list is the ordinary case, not a special one.
    bundles: (Array.isArray(f.bundles) ? f.bundles : []).map((b) => ({
      bundleId: String((b || {}).bundleId || '').trim(),
      entries: num((b || {}).entries),
      pricePerEntry: num((b || {}).pricePerEntry),
      validityDays: num((b || {}).validityDays)
    })).filter((b) => b.bundleId)
  })
};

function isoDate(value) {
  const v = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
}

// Coerce one fact into its canonical shape, carrying legacyText through.
// The two facts that used to BE a language bag and now hold one. An old record
// carries {he:'…', en:'…'} where the new shape expects {text:{he:'…'}}, so the
// bare bag is lifted into `text` on the way past. Detected by shape rather than
// by a version flag: a record with no `text`, `codes` or `level` and at least
// one language key is unambiguously the old form, and a record already
// converted has `text` and is left alone.
// ⚠ A NOTE THAT ONLY REPEATS THE LIST IS NOT A NOTE.
//
// `instructionLanguage` and `prerequisites` are a closed list plus an optional
// line, and the line exists to ADD to the list. The live hebrew4kids page was
// printing each of them twice:
//
//     Prerequisites             Language of instruction
//     Beginners                 Hebrew · English
//     Beginners                 Hebrew and English
//
// Nobody typed anything twice, and neither half was wrong. liftBareText() moved
// the old free-text fact into `text`, which is the only place those words could
// go; the admin then picked the level and the two languages from the controls
// that replaced it, which is exactly what they were for. It is the PAIR that is
// wrong, and nothing on either screen could have shown it — the form draws a
// filled-in box beside a filled-in select and neither knows about the other.
//
// So the words the structured half already prints are stripped out, in all
// three languages rather than the one being read: the Russian slot on that
// record holds the ENGLISH sentence, because the free text predates anybody
// translating it. If what is left holds no letters or digits, the line was only
// ever a restatement and goes.
//
// A line that says anything else is untouched — "Hebrew and English, some
// Greek" keeps "some Greek", which is the whole reason the free line exists.
// Idempotent, like everything here: once dropped there is nothing to drop.
const JOINERS = ['\u05d5', '\u05d5\u05d2\u05dd', 'and', '\u0438', '&', '+'];
const SPLIT_ON = /[\s,.;:\u00b7\u2022()\/\u2013\u2014-]+/;
const A_WORD = /[\p{L}\p{N}]/u;

function namesOf(table, key) {
  return ['he', 'en', 'ru'].map((lang) => (table[lang] || {})[key]).filter(Boolean);
}

// Case-insensitive and global. A name can appear more than once, and the Latin
// ones arrive capitalised or not depending on who typed them.
function stripAll(hay, needle) {
  if (!needle) return hay;
  const lowN = String(needle).toLowerCase();
  const lowH = hay.toLowerCase();
  let out = '', i = 0;
  while (i < hay.length) {
    if (lowH.substr(i, lowN.length) === lowN) { out += ' '; i += lowN.length; }
    else { out += hay[i]; i += 1; }
  }
  return out;
}

function restatesOnly(text, names) {
  const value = String(text == null ? '' : text);
  if (!value.trim() || !names.length) return false;
  let left = value;
  names.forEach((n) => { left = stripAll(left, n); });
  // ו is a PREFIX in Hebrew — "\u05e2\u05d1\u05e8\u05d9\u05ea \u05d5\u05d0\u05e0\u05d2\u05dc\u05d9\u05ea" is two names with the
  // conjunction glued to the second, so it only becomes a token of its own once
  // the names either side of it have been taken out.
  const rest = left.split(SPLIT_ON).filter(Boolean)
    .filter((w) => JOINERS.indexOf(w.toLowerCase()) === -1)
    .join('');
  return !A_WORD.test(rest);
}

function dropRestatement(text, nameGroups) {
  const names = [].concat.apply([], nameGroups || []);
  const out = {};
  ['he', 'en', 'ru'].forEach((lang) => {
    out[lang] = restatesOnly(text[lang], names) ? '' : text[lang];
  });
  return out;
}

const WAS_TEXT = { instructionLanguage: 1, prerequisites: 1 };
function liftBareText(key, raw) {
  if (!WAS_TEXT[key] || !raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  if (raw.text != null || raw.codes != null || raw.level != null) return raw;
  return hasAnyText(langObject(raw)) ? { text: raw } : raw;
}

function normaliseFact(key, raw) {
  if (TEXT_FACTS.indexOf(key) !== -1) return langObject(raw);
  raw = liftBareText(key, raw);
  const f = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = SHAPES[key] ? SHAPES[key](f) : {};
  const legacy = langObject(f.legacyText);
  if (hasAnyText(legacy)) out.legacyText = legacy;
  return out;
}

// ⚠ THE ACTIVITY'S OWN FACTS, WHICH IS NO LONGER ALL OF THEM. Seven of the nine
// moved onto the groups, so walking FACT_ORDER here would write an empty `ages`
// beside every group's real one — two answers to one question, on a record where
// only one of them is ever read. What is left is what is genuinely one answer
// for the whole activity: the grouping override and the price.
function normaliseFacts(rawFacts) {
  const facts = rawFacts && typeof rawFacts === 'object' ? rawFacts : {};
  const out = {};
  ACTIVITY_FACTS.forEach((key) => { out[key] = normaliseFact(key, facts[key]); });
  return out;
}

// One group's facts, through exactly the same shapes the activity's went
// through — so a group's calendar cannot normalise differently from the one it
// was copied out of, including the derived weekday and the surviving `date`.
function normaliseGroupFacts(rawFacts) {
  const facts = rawFacts && typeof rawFacts === 'object' ? rawFacts : {};
  const out = {};
  GROUP_FACTS.forEach((key) => { out[key] = normaliseFact(key, facts[key]); });
  return out;
}

// ⚠ THE GROUP LIST, AND IT IS APPLIED ON EVERY READ AND EVERY SAVE. A key this
// does not name is a key the next save deletes — the lesson sessionDates taught
// twice. teacherIds is listed for that reason, and so is the whole facts bag.
//
// The name is a { he, en, ru } bag because it is words a family picks by. The
// capacity beside it is not, and that split is what lets a translator rename a
// group without being able to resize it — see mergeGroups() in
// activities-admin.js.
function normaliseGroups(list) {
  return (Array.isArray(list) ? list : [])
    .map((g) => {
      const raw = g && typeof g === 'object' ? g : {};
      return {
        groupId: String(raw.groupId || '').trim().slice(0, 40),
        name: langObject(raw.name),
        capacity: num(raw.capacity),
        // Empty means the whole roster. See teachersFor() in _activity-groups.js:
        // teachers are REFERENCED rather than copied, so one photograph is one
        // file however many groups a person teaches.
        teacherIds: (Array.isArray(raw.teacherIds) ? raw.teacherIds : [])
          .map((id) => String(id || '').trim()).filter(Boolean),
        facts: normaliseGroupFacts(raw.facts)
      };
    })
    .filter((g) => g.groupId);
}

// `preAddress` marks a record written before the exact address existed — which
// is to say, before isPubliclyVisible() enforced anything.
//
// Those records carry members-only flags that were never acted on: hebrew4kids
// has Location AND Price flagged members, and both are on the live page right
// now. Enforcing without this would take two rows off a published page as a
// side effect of adding a field, which is precisely the kind of silent blanking
// the rest of this file exists to prevent.
//
// So a pre-changeover record is reset to what its page actually shows: public.
// The flag starts meaning something from the next save, and an admin who wants
// a fact private can now say so and be obeyed. `address` is exempt — it is new,
// empty, and members-only from birth.
function normaliseVisibility(raw, preAddress) {
  const given = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  FACT_ORDER.forEach((key) => {
    const v = given[key];
    const stated = v === 'public' || v === 'members' ? v : null;
    if (preAddress && key !== 'address') {
      out[key] = 'public';
      return;
    }
    out[key] = stated || DEFAULT_VISIBILITY[key] || 'public';
  });
  return out;
}

// ⚠ THE ONE-TIME BUILD: AN ACTIVITY'S FACTS BECOME ITS FIRST GROUP'S.
//
// Two shapes arrive here and neither loses anything.
//
//   A POOLED ACTIVITY — no named groups — becomes exactly ONE group, holding
//   what the activity held. Its name is blank, which is right: one group offers
//   no choice, so nothing is published and nobody is asked. Its capacity is the
//   product that used to be computed from `groups × maxPerGroup`, so an
//   activity holding twenty goes on holding twenty rather than silently
//   becoming one group of ten.
//
//   AN ACTIVITY WITH NAMED GROUPS keeps their ids — frozen registrations point
//   at them — and each group is SEEDED with the activity's shared facts as a
//   starting point, with its own schedule and calendar layered on top where it
//   had them. Seeding is deliberately a copy rather than a guess: two groups
//   that differ in language and teacher still shared an age range and a room,
//   and an admin adjusts from something true rather than from blank fields.
//
// `teacherIds` is empty on every seeded group, which MEANS the whole roster
// rather than meaning nobody — see teachersFor(). Writing the roster out would
// freeze it, so a teacher added to the activity next month would appear in the
// credits and in no group.
const SOLE_GROUP_ID = 'g-default';

function seedGroups(old, facts) {
  const size = old.groupSize && typeof old.groupSize === 'object' && !isLangObject(old.groupSize)
    ? old.groupSize : {};
  const named = (Array.isArray(size.named) ? size.named : []).filter((g) => g && g.groupId);

  // A fresh copy per group. Sharing one object would give two groups the same
  // calendar array, so editing one would edit the other — invisible until an
  // admin excluded a date for Beginners and took it off Advanced as well.
  const shared = () => {
    const out = {};
    GROUP_FACTS.forEach((k) => { out[k] = facts[k]; });
    return JSON.parse(JSON.stringify(out));
  };

  if (named.length) {
    return named.map((g) => {
      const f = shared();
      if (g.schedule && typeof g.schedule === 'object') f.schedule = g.schedule;
      if (Array.isArray(g.sessionDates) && g.sessionDates.length) {
        f.duration = Object.assign({}, f.duration, { sessionDates: g.sessionDates });
      }
      return { groupId: g.groupId, name: g.name, capacity: g.capacity, teacherIds: [], facts: f };
    });
  }

  const groups = num(size.groups);
  const per = num(size.maxPerGroup);
  const capacity = groups != null && per != null && groups > 0 && per > 0 ? groups * per : null;
  return [{ groupId: SOLE_GROUP_ID, name: emptyLang(), capacity: capacity,
            teacherIds: [], facts: shared() }];
}

// --- the migration ---------------------------------------------------------

// MINTING AN ID INSIDE A PURE FUNCTION, without making it impure.
//
// The design says migrate() mints an activityId for any record lacking one,
// idempotently. Those two words pull against each other: an id is random, and a
// function that invents a random value returns something different every time it
// is called on the same input, which is the opposite of idempotent — and this
// module's whole contract is that it is pure and safe to run on every read.
//
// So the randomness is injected. migrate(record) leaves a record without an id
// exactly as it found it; migrate(record, { mintId }) fills one in. The caller
// that saves passes a real minter, every other caller passes nothing, and
// running migrate twice over the SAME record is still a no-op because the second
// pass finds the id the first one wrote.
//
// Nothing reads activityId yet. It exists now because minting it while there are
// no registrations costs one field, and minting it afterwards costs a migration
// across every store that points at an activity.
function migrate(record, options) {
  if (!record || typeof record !== 'object') return record;
  const out = JSON.parse(JSON.stringify(record));
  const mintId = options && typeof options.mintId === 'function' ? options.mintId : null;

  // The slug is the filename, the URL and the sitemap entry, so today it is the
  // activity's identity — and renaming one would orphan everything attached to
  // it. This is the same failure email-as-identity causes on the sister project,
  // where it is being unpicked across five migration phases.
  //
  // Never editable and never regenerated: an existing id is left exactly as it
  // is, whatever an incoming request claims. Delete-and-recreate deliberately
  // produces a NEW id, because that is a different activity and old
  // registrations should not silently attach to it.
  const existingId = String(out.activityId || '').trim();
  if (existingId) out.activityId = existingId;
  else if (mintId) out.activityId = mintId();
  else delete out.activityId;

  // WHICH ACTIVITY THIS IS A TERM OF, and it defaults to the record's own id.
  //
  // A slug is one semester: hebrew4kids runs mid-October to mid-December and its
  // fullPrice is labelled "per semester", so the spring term is a second record
  // with its own dates, its own calendar and its own page. That is right for
  // everything the site publishes and wrong for exactly one question — the
  // registration fee, which is charged once a year per participant PER ACTIVITY,
  // and therefore has to be able to tell that two records are the same activity.
  //
  // Defaulting to the record's own id is what makes this free: every activity
  // that exists is a series of one, so nothing that reads it changes meaning,
  // and a record only stops being its own series when an admin says so. There is
  // no migration and no key change — the registration key is still one record
  // per participant per activity.
  //
  // Minted with no randomness of its own for the same reason: it is a POINTER to
  // an activityId, never a new identifier, so a series has the id of whichever
  // term was created first and the second term points at it.
  const existingSeries = String(out.seriesId || '').trim();
  if (existingSeries) out.seriesId = existingSeries;
  else if (out.activityId) out.seriesId = out.activityId;
  else delete out.seriesId;

  // One answer for all three languages, like robots and shareImage. Absent
  // means course, which is what every activity written before this field
  // existed was.
  out.type = registration.normaliseType(out.type);
  // Read from the RAW record, before normaliseFacts() gives every record an
  // (empty) address fact and the question becomes unanswerable.
  //
  // ⚠ AND IT HAS TO LOOK AT THE GROUPS TOO, or this function stops being
  // idempotent. The address fact moved onto the groups, so after one pass
  // `record.facts.address` is gone — and a second pass would read that as "this
  // record predates the address field", reset every visibility flag to public,
  // and quietly republish whatever an admin had marked members-only. The
  // question is "has this record ever seen an address field", and both places it
  // could live have to be asked.
  const preAddress = !(record.facts && record.facts.address) &&
    !(Array.isArray(record.groups) &&
      record.groups.some((g) => g && g.facts && g.facts.address));
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

  // The exact address is new. It starts empty for every existing record: the
  // words already in `location` are a general one ("לימסול"), and moving them
  // into the address field would claim an activity has an address nobody typed.
  facts.address = old.address;

  // duration is new. `programLength` fed it: in one record that was a date
  // range and in another a session length, which is exactly why it could not
  // be parsed and exactly why it is now four separate fields.
  if (old.duration && !isLangObject(old.duration)) {
    facts.duration = old.duration;
  } else {
    const from = langObject(out.programLength);
    facts.duration = hasAnyText(from) ? { legacyText: from } : {};
  }

  // ⚠ NAMED EXPLICITLY, NOT DRIVEN OFF TEXT_FACTS.
  //
  // This loop used to iterate TEXT_FACTS, which was exactly these two. Emptying
  // that list when they became structured therefore stopped copying them at all
  // — every record came back with a blank language and a blank level, and
  // nothing errored. A smoke test caught it; a list that is correct today and
  // becomes a silent deletion tomorrow is the shape to avoid, so the two keys
  // are written out.
  //
  // Three historical forms are carried: the structured fact, the free-text fact
  // that preceded it, and the top-level field that preceded that.
  // liftBareText() inside normaliseFact() moves a bare {he,en,ru} bag into
  // `text`, so nothing an admin typed is lost in either conversion.
  ['instructionLanguage', 'prerequisites'].forEach((key) => {
    facts[key] = old[key] != null ? old[key] : langObject(out[key]);
  });

  // ⚠ EVERY ACTIVITY HAS AT LEAST ONE GROUP, AND THIS IS WHERE THAT BECOMES
  // TRUE. Built when the record has none and left alone when it has some, so a
  // second pass finds what the first one wrote and does nothing — the same
  // shape activityId already has, and the reason migrate() can run on every
  // read rather than being a one-off nobody dares repeat.
  const carried = (Array.isArray(out.groups) ? out.groups : []).filter((g) => g && g.groupId);
  out.groups = normaliseGroups(carried.length ? carried : seedGroups(old, facts));

  out.facts = normaliseFacts(facts);
  out.factVisibility = normaliseVisibility(out.factVisibility, preAddress);

  // Registration settings. Normalised AFTER the facts, because the drop-in
  // branch of the shape reads `type` and nothing here may depend on a fact that
  // has not been canonicalised yet.
  out.registration = registration.normaliseRegistration(out.registration, out.type);

  // One source of truth: now that these live in facts, the top-level copies go,
  // or the next save would resurrect the old values.
  delete out.programLength;
  delete out.instructionLanguage;
  delete out.prerequisites;

  // Retired fields. `spots` was a places-left count an admin typed and then had
  // to remember to decrement — wrong the moment anyone registered — and comes
  // back computed once registration exists. `included` was a bullet list that
  // said what Schedule, Duration and Price now say properly. Dropping them here
  // means a record stops carrying them from its next save, rather than keeping
  // dead keys forever.
  delete out.spots;
  delete out.included;

  // "What to bring" goes the same way. It was one line on the one activity that
  // used it, and a whole optional section, editor and form group existed to
  // carry it. Dropping it here means a record stops holding it from its next
  // save rather than keeping a dead key forever; the words are in git history.
  delete out.whatToBring;

  // The registration button link goes too, and it is the clearest case in this
  // list. It existed because registration did not: the button needed somewhere
  // to point, so the field was an escape hatch, and Phase 6 built the real
  // target while leaving the hatch open. Every value it ever carried on this
  // site was a mistake — the button's own LABEL, which shipped as
  // <a href="Register Now"> and 404'd in three languages, and then the site
  // homepage, which sent parents away from the form they had come to find.
  //
  // Both passed validation, and that is the point rather than an aside: an
  // allowlist can tell a link from prose, and it CANNOT tell a right URL from a
  // wrong one. No amount of validating the field would have caught either. The
  // link is derived from the slug now, so there is nothing left to get wrong.
  //
  // If an activity ever genuinely registers somewhere else, the honest shape is
  // a deliberate setting saying so — not a free-text box on every activity that
  // is wrong by default.
  delete out.ctaUrl;

  // The hero image is gone too. Activities are described by their words and
  // their facts; the one picture on the page was a decorative band that every
  // activity would have needed sourcing for. `heroAlt` goes with it — there is
  // nothing left to describe. The share card falls back to the site's own
  // og-image, and the listing cards keep their coloured band.
  delete out.heroImage;
  delete out.heroAlt;

  return out;
}

module.exports = {
  migrate, normaliseFacts, normaliseFact, normaliseGroups, normaliseGroupFacts,
  normaliseVisibility, SOLE_GROUP_ID,
  isLangObject, parseAgeRange, langObject, isoDate, SHAPES
};
