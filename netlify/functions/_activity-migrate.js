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
const sessionsModule = require('./_activity-sessions');
const registration = require('./_activity-registration');

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
  // The frequency list is taken FROM the calendar module rather than repeated
  // here. It was repeated, and it fell behind: biweekly and monthly could be
  // enumerated and rendered, and a save coerced either of them back to weekly,
  // silently changing what the page said the moment an admin pressed publish.
  schedule: (f) => {
    const out = {
      frequency: sessionsModule.FREQUENCIES.indexOf(f.frequency) !== -1 ? f.frequency : 'weekly',
      sessions: (Array.isArray(f.sessions) ? f.sessions : [])
        .map((s) => ({ day: num(s && s.day), time: String((s && s.time) || '').trim() }))
        .filter((s) => s.day != null || s.time)
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
    sessionDates: (Array.isArray(f.sessionDates) ? f.sessionDates : [])
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
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  }),
  // The override is WORDS, so it is a { he, en, ru } bag like every other
  // sentence on this site — the numbers beside it render in three languages and
  // the text replacing them has to as well. langObject() puts a bare string in
  // `he`, which is what a pre-trilingual override was: one line typed by a
  // Hebrew-first admin. The other two fall back to the computed sentence, which
  // is the honest reading of "this has not been translated yet".
  groupSize: (f) => {
    const out = { groups: num(f.groups), maxPerGroup: num(f.maxPerGroup),
                  overrideText: langObject(f.overrideText) };
    // Named groups are OPT-IN. Absent or empty means the pooled model, exactly
    // as before, and nothing anywhere asks about groups. Present, `groups` and
    // the capacity become derived from this list — see formatGroupSize().
    //
    // The name is a { he, en, ru } bag because it is words a family reads: a
    // role permitted to edit only Russian must be able to translate "Advanced"
    // and must not be able to change its capacity from ten to twenty. Putting
    // the list inside the fact draws that line by where the field sits rather
    // than by a rule someone has to remember.
    const named = (Array.isArray(f.named) ? f.named : [])
      .map((g) => ({
        groupId: String((g && g.groupId) || '').trim().slice(0, 40),
        name: langObject(g && g.name),
        capacity: num(g && g.capacity)
      }))
      .filter((g) => g.groupId);
    if (named.length) out.named = named;
    return out;
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
    showPerLesson: f.showPerLesson === true
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
  const preAddress = !(record.facts && record.facts.address);
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

  // These two were sections in the main column. They are facts to scan, so they
  // move to the sidebar — same text, new home.
  TEXT_FACTS.forEach((key) => {
    const inFacts = old[key];
    if (inFacts && hasAnyText(langObject(inFacts))) facts[key] = langObject(inFacts);
    else facts[key] = langObject(out[key]);
  });

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
  migrate, normaliseFacts, normaliseFact, normaliseVisibility,
  isLangObject, parseAgeRange, langObject, isoDate, SHAPES
};
