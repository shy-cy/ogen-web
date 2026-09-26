// The registration SETTINGS that belong to an activity. Not the registration
// system: there is no participant here, no account, no personal data of any
// kind. This is the configuration an activity carries so that a registration
// system, when it exists, has something to read.
//
// That distinction is why this file is called _activity-registration and not
// _registration-anything. tests/registration-waits-for-real-legal-pages.js arms
// the legal gate on a function file whose name STARTS with member / account /
// participant / guardian / registration, and it is right not to fire here: this
// module stores nobody's data and could ship to the live site on its own. Do not
// rename it to something that begins with "registration" — and if a file ever
// does need that name, it will be because it handles a person, and the gate
// firing will be correct.
//
// PURE. No stores, no network, and no clock: every function here takes the dates
// it needs as arguments. `defaultIfBlank` looks like it wants today's date and
// deliberately does not have it — it computes from the activity's own start date
// and session list, so the same record always produces the same answer.

const sessions = require('./_activity-sessions');
const groups = require('./_activity-groups');

// The only distinction between a semester course and a pay-per-session
// activity. A flag rather than a second content type: the two differ in how
// money is quoted, how it is collected, and what cancelling means, and are
// identical in every other respect the site has — same URL space, same
// template, same listing, same publish pipeline, same permissions.
const TYPES = ['course', 'dropin'];
const DEFAULT_TYPE = 'course';

// ⚠ LEGACY. These two were the whole cancellation policy: a mode, plus one
// closing date, and the arithmetic in _credit.js branched on the mode.
//
// That WAS a two-tier refund schedule and could not say so — 100% until the
// first session, then 50% or remaining÷total until the closing date, then
// nothing. The schedule is editable now (see the tier block below), and these
// survive for exactly one purpose: translating a record written before it into
// the new vocabulary. legacyTiers() is the only reader.
//
// Nothing writes them any more. normaliseRegistration() stops carrying them
// from a record's next save, the way migrate() dropped ctaUrl — and _credit.js
// never stops understanding them, because frozen blocks written last month are
// read forever.
const CANCELLATION_MODES = ['flat', 'prorated'];
const DEFAULT_MODE = 'flat';

// The floor, in code. resolveExpiryDays() prefers the activity's own value,
// then the site-wide env, then this.
//
// ⚠ FORTY-FIVE, AND THE REASON IS WHAT THE FAMILY WAS TOLD. It was 14, chosen
// while the confirmation promised an answer within that many days — the number
// and the sentence were one thing. The words changed: a family that signs a
// child up is told they are REGISTERED, because that is what they did, and the
// queue's waiting is ours. A registration released a fortnight later now
// contradicts the message that created it.
//
// Off is not the answer, and it is worth writing down why. Capacity is counted
// from `holdsASpot()`, so an unanswered pending registration that never expires
// holds a place on a capped activity FOREVER and the family is never told
// anything at all — limbo with no message beats no limbo, but it loses to an
// apology. The expiry is also the only thing that frees that place.
//
// So the pressure moves rather than disappearing: long enough that nobody meets
// it in the ordinary course of answering a queue, short enough that a place is
// not held for a term by a request somebody forgot. An activity that genuinely
// fills in a week still sets its own shorter value, which is what the
// per-activity field is for.
//
// Changing this is NOT retroactive: `expiresAt` is stamped at submission, so
// every registration already taken keeps the deadline it was given.
const DEFAULT_EXPIRY_DAYS = 45;
// Calendar days before the start date, not sessions and not working days.
const FEE_CUTOFF_DAYS = 14;
// The share of the course after which nothing is creditable. ceil, so the
// rounding goes to the family: ten sessions gives three, not two and a bit.
const CANCEL_FRACTION = 0.3;

// A cutoff is one field with three states, deliberately, rather than a date
// beside a "disabled" boolean:
//
//   "2026-09-30"  the cutoff applies at the end of that day
//   "none"        deliberately switched off. The checkbox writes this.
//   null          never configured
//
// Two fields can contradict each other and something then has to decide which
// wins. Here the contradiction is not representable. It also keeps one decision
// point: a past() check gains one line for "none" and nothing else in the
// system learns that a switch exists.
const OFF = 'none';

function cutoff(value) {
  if (value === OFF) return OFF;
  const v = String(value == null ? '' : value).trim();
  if (!v) return null;
  return sessions.parseISO(v) == null ? null : v;
}

const num = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// A whole number of days, or null. Zero is refused rather than kept: "expires
// after 0 days" is a registration that is dead on arrival, and it is far more
// likely to be a half-typed field than an intention.
function positiveInt(value) {
  const n = num(value);
  if (n == null) return null;
  const i = Math.floor(n);
  return i > 0 ? i : null;
}

// --- the refund schedule ---------------------------------------------------
//
// A LIST OF STEPS, EARLIEST FIRST, and the list order IS the policy order.
//
//   [ { until: 'start',      percent: 100 },
//     { until: '2026-11-04', percent: 50  } ]
//
// Each step says what comes back if a family cancels before its boundary. Past
// the LAST boundary nothing is creditable — which is what the single
// `cancellationCutoffDate` used to be, and the reason it is gone: a closing date
// beside a table of steps is two fields that can contradict each other, and
// something then has to decide which wins. Here the contradiction is not
// representable, exactly as it is not for a cutoff's three states.
//
// `until` reuses those three states and adds one token:
//
//   'start'       the moment the group's first session begins
//   '2026-11-04'  the end of that day in Asia/Nicosia
//   'none'        this rate never stops. Credit does not close.
//   null          never configured. Only meaningful on the LAST step, where
//                 defaultIfBlank() fills it and resolveTiers() computes it per
//                 group — the same thing the closing date has always done.
//
// `percent` is an integer 0-100, or 'remaining' for a step that credits the
// sessions a family has not had. That is proration, and it is a VALUE here
// rather than a mode, which is what makes a legacy record expressible: see
// legacyTiers() below.
const AT_START = 'start';
const PRORATED = 'remaining';

// ⚠ SIX, AND THE LIMIT IS THE FAMILY RATHER THAN THE STORAGE.
//
// Nothing structural caps this — the frozen copy is a few bytes and no metadata
// field is involved. What caps it is that the schedule has to be readable in
// three languages in an email with no stylesheet, and six steps is already five
// dates plus "nothing after that". Past that an admin is drawing a curve by
// hand, and the curve already has a name: a prorated last step is the unlimited
// case in one row. The refusal says so rather than only saying no.
const MAX_TIERS = 6;

function boundary(value) {
  if (value === AT_START) return AT_START;
  return cutoff(value);
}

function tierPercent(value) {
  if (value === PRORATED) return PRORATED;
  const n = num(value);
  if (n == null) return null;
  const i = Math.round(n);
  return i >= 0 && i <= 100 ? i : null;
}

// Nothing typed at all. An admin who pressed "+" and changed their mind has not
// made a mistake, so a wholly empty row is dropped in silence — where a row with
// a rate and no date is refused on save, because that one IS a mistake and
// dropping it quietly is how normaliseBundles() once let an activity publish
// with nothing on offer.
function tierIsBlank(t) {
  if (!t || typeof t !== 'object') return true;
  const hasUntil = t.until !== undefined && t.until !== null && String(t.until).trim() !== '';
  const hasPct = t.percent !== undefined && t.percent !== null && String(t.percent).trim() !== '';
  return !hasUntil && !hasPct;
}

// ⚠ A HALF-TYPED ROW IS KEPT, NOT DROPPED, AND THE REASON IS WHERE validate()
// RUNS. It is handed the MERGED record, which this function has already
// normalised — so anything dropped here is gone before there is anybody to refuse
// it, and an admin who typed a date and cleared the percentage would watch the
// step vanish on save with nothing said. That is the silent loss this codebase
// keeps meeting, in the one panel where the value is money.
//
// So the rate survives as null, validateTiers() refuses it, and bandFor() reads
// it the generous way. A wholly empty row is still dropped in silence: pressing
// "+" and changing your mind is not a mistake.
//
// The slice is a HARD CEILING rather than the policy cap, for the same reason:
// truncating at MAX_TIERS would silently discard a seventh step instead of
// refusing it. This bounds what a hostile client can commit to git and sits well
// above anything validation allows.
const TIER_CEILING = 50;

function normaliseTiers(raw) {
  const out = [];
  (Array.isArray(raw) ? raw : []).forEach((t) => {
    if (tierIsBlank(t)) return;
    out.push({ until: boundary(t.until), percent: tierPercent(t.percent) });
  });
  return out.slice(0, TIER_CEILING);
}

// ⚠ THE OLD POLICY, IN THE NEW VOCABULARY, and it is exact rather than
// approximate — which is the whole reason the schedule was designed as a
// generalisation of the mode rather than as a replacement for it.
//
// share(cents, 50, 100) and share(cents, 1, 2) agree on every cent value, so a
// flat activity translated this way credits the same figure it always did. A
// test asserts that across the whole range rather than trusting the algebra.
function legacyTiers(policy) {
  const p = policy || {};
  const mode = CANCELLATION_MODES.indexOf(p.mode) !== -1 ? p.mode : DEFAULT_MODE;
  return [
    { until: AT_START, percent: 100 },
    { until: cutoff(p.cancellationCutoffDate), percent: mode === 'prorated' ? PRORATED : 50 }
  ];
}

// ⚠ ABSENT AND EMPTY ARE DIFFERENT ANSWERS, and conflating them would either
// re-invent a policy an admin deleted or silently ignore one they never had.
//
//   no `tiers` key   a record written before the schedule existed -> translate
//   `tiers: []`      an admin deleted every step. Credit never closes and the
//                    whole of what was paid comes back, which is what a blank
//                    resolves to everywhere else in this system.
function tiersOf(policy) {
  const p = policy || {};
  return Array.isArray(p.tiers) ? normaliseTiers(p.tiers) : legacyTiers(p);
}

// The boundary past which nothing is creditable: the last step's. Null when
// there are no steps, which reads as "never closes" the way every blank here
// does — see past() in _credit.js, which is the one place that decides.
function closingBoundary(tiers) {
  const list = Array.isArray(tiers) ? tiers : [];
  return list.length ? list[list.length - 1].until : null;
}

// ⚠ AN OPTIONAL EXPLANATION, IN THREE LANGUAGES, AND IT IS WORDS.
//
// Asked for alongside the schedule, for the case that looks like a bug and is
// not: a closing date BEFORE the course starts, because costs were committed on
// the family's behalf — materials, books, tickets bought in advance. A date like
// that cannot account for itself, and the schedule is where somebody reads it.
//
// Blank means nothing is shown anywhere. It is the only thing in the
// registration block that is words rather than structure, which is why
// mergeRegistration() takes the languages a session may edit — a role permitted
// to translate must be able to translate this, and must not be able to move a
// percentage. That gap is the one LANG_SUBKEYS was invented for, arriving in a
// block that had never had a word in it.
const NOTE_LANGS = ['he', 'en', 'ru'];
const NOTE_MAX = 400;
function noteBag(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  NOTE_LANGS.forEach((l) => {
    out[l] = String(src[l] == null ? '' : src[l]).replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX);
  });
  return out;
}
const noteIsEmpty = (bag) => NOTE_LANGS.every((l) => !(bag && bag[l]));

// The canonical shape, applied on every read and every save, exactly as
// normaliseFacts does for facts. An old client cannot reintroduce an old shape,
// and a record that has never carried a registration block gets the defaults
// rather than undefined.
function normaliseRegistration(raw, type) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const policy = r.cancellationPolicy && typeof r.cancellationPolicy === 'object'
    ? r.cancellationPolicy : {};
  const basis = r.defaultBasis && typeof r.defaultBasis === 'object' ? r.defaultBasis : null;

  const out = {
    autoApprove: r.autoApprove === true,
    pendingExpiryDays: positiveInt(r.pendingExpiryDays),
    registrationFeeCutoffDate: cutoff(r.registrationFeeCutoffDate),
    // ⚠ `mode` AND `cancellationCutoffDate` ARE NOT WRITTEN BACK. tiersOf()
    // translates them when they are the only thing a record carries, and the
    // canonical shape then holds the schedule alone — so the record stops
    // carrying the old pair from its next save and there is never a moment when
    // both are present and could disagree. The second pass finds what the first
    // wrote, which is the idempotence rule migrate() follows.
    cancellationPolicy: {
      tiers: tiersOf(policy),
      note: noteBag(policy.note)
    },
    // What the two dates above were computed FROM, the one time they were
    // computed. Kept so the form can NOTICE the inputs have changed and offer
    // to recompute — never so that anything recomputes on its own.
    defaultBasis: basis
      ? { startDate: sessions.parseISO(basis.startDate) ? basis.startDate : '',
          sessionCount: num(basis.sessionCount) }
      : null
  };

  // Drop-in only. A single evening has nothing to be part of, so there are no
  // modes and no proration: cancel this many hours before it starts and the
  // payment becomes credit, after that nothing. null means creditable right up
  // to the start, which is the generous reading every other date here takes.
  if (type === 'dropin') out.sessionCancelHours = positiveInt(r.sessionCancelHours);

  return out;
}

function normaliseType(value) {
  return TYPES.indexOf(value) !== -1 ? value : DEFAULT_TYPE;
}

// --- the two defaults ------------------------------------------------------

function minusDays(iso, days) {
  const t = sessions.parseISO(iso);
  return t == null ? null : sessions.toISO(t - days * 86400000);
}

// The date of session ceil(30% × count), counted in SESSIONS rather than in
// calendar days. The credit formula divides sessions remaining by sessions
// total, so a cutoff measured in days would have the two halves of one policy
// disagreeing about what "thirty percent through" means — and the disagreement
// would surface as an off-by-one in somebody's refund. It is also the measure a
// family recognises: "up to your third class" is a sentence that can go in the
// terms; "up to 4 November" is a date somebody has to look up.
//
// The calendar reading is kept as the fallback for an activity whose sessions
// do not resolve. It is a worse answer, and it is better than an empty field.
// ⚠ PER GROUP. It used to take one group's calendar and say why: every group met
// the same number of times, so the 30% POINT was the same session number for all
// of them and one date had to be picked. The equal-hours rule broke that — four
// meetings and six are both six hours, and the third session of one group is not
// the third session of the other — so the group is an argument now and the date
// is resolved at registration, onto the frozen block, from the calendar that
// family was actually sold.
function thirtyPercentPoint(activity, groupId) {
  const duration = groups.durationFor(activity, groupId);
  const rows = sessions.scheduled(duration.sessionDates);
  if (rows.length) {
    const n = Math.ceil(CANCEL_FRACTION * rows.length);
    const row = rows[Math.min(Math.max(n, 1), rows.length) - 1];
    return row ? row.date : null;
  }
  const from = sessions.parseISO(duration.startDate);
  const to = sessions.parseISO(duration.endDate);
  if (from == null || to == null || to < from) return null;
  const span = Math.round((to - from) / 86400000);
  return sessions.toISO(from + Math.round(span * CANCEL_FRACTION) * 86400000);
}

// Fill a BLANK. Never overwrite a value that is there.
//
// Runs on save rather than on create, because at create time the dates these
// depend on have usually not been typed yet, and a default computed from
// nothing is a default that has to be recomputed later — which is the one
// behaviour this whole design avoids.
//
// `null` means never configured and is the only thing filled. An admin who
// switched a cutoff off wrote "none", which is a value, so it survives; that is
// the entire reason the field has three states rather than two.
//
// Returns a NEW registration object; the input is not mutated.
function defaultIfBlank(activity) {
  const type = normaliseType(activity && activity.type);
  const reg = normaliseRegistration(activity && activity.registration, type);
  let filled = false;

  // ⚠ FILLED ONLY WHEN EVERY GROUP AGREES ON THE ANSWER. Written into the record
  // it becomes one date for the whole activity, and on groups that start on
  // different days or meet a different number of times there is no such date —
  // storing one group's would quietly govern the other group's families. When
  // they disagree the field stays null and resolveCutoffs() answers per group at
  // registration, which is where the group is finally known.
  //
  // With one group — every activity on the site today — this is exactly the
  // behaviour it has always had: the date is computed on save and an admin can
  // see it and change it in the form.
  const agreed = (fn) => {
    const answers = groups.groupList(activity).map((g) => fn(g.groupId));
    if (!answers.length) answers.push(fn(undefined));
    return answers.every((a) => a === answers[0]) ? answers[0] : null;
  };

  if (reg.registrationFeeCutoffDate == null) {
    const d = agreed((gid) => minusDays(groups.durationFor(activity, gid).startDate, FEE_CUTOFF_DAYS) || null);
    if (d) { reg.registrationFeeCutoffDate = d; filled = true; }
  }
  // A drop-in has no term to withdraw from, so it has no closing date to
  // compute. Leaving it null keeps the step meaningless rather than filling it
  // with a date that governs nothing.
  //
  // ⚠ ONLY THE LAST STEP, and only when it was never configured. Every step
  // above it names a date an admin typed, and there is no formula for a boundary
  // in the middle of a schedule — which is why validateRegistration() refuses a
  // blank anywhere else. This is the same fill the single closing date has always
  // had, now addressed by position rather than by name.
  const tiers = reg.cancellationPolicy.tiers;
  const last = tiers.length ? tiers[tiers.length - 1] : null;
  if (type !== 'dropin' && last && last.until == null) {
    const d = agreed((gid) => thirtyPercentPoint(activity, gid));
    if (d) { last.until = d; filled = true; }
  }
  const duration = groups.durationFor(activity, groups.groupList(activity)[0]
    ? groups.groupList(activity)[0].groupId : undefined);

  // Stamp the inputs only when something was actually computed from them, and
  // only once. Re-stamping on every save would erase the record of what the
  // stored dates were derived from, which is the one thing basisChanged() has
  // to compare against.
  if (filled && !reg.defaultBasis) {
    reg.defaultBasis = {
      startDate: duration.startDate || '',
      sessionCount: sessions.scheduled(duration.sessionDates).length || num(duration.sessionCount)
    };
  }
  return reg;
}

// ⚠ THE CUTOFFS A PARTICULAR FAMILY IS HELD TO, resolved at the moment their
// terms are frozen and never afterwards.
//
// A stored date always wins, including the string "none", which is a value
// meaning the cutoff is switched off — that is the whole reason the field has
// three states rather than a date beside a boolean. Only `null`, which means
// nobody ever configured it, is computed here, and it is computed from THIS
// GROUP's calendar.
//
// This is where the equal-hours rule is paid for. Two groups sold the same six
// hours across four meetings and six have different third sessions and can
// begin on different days, so there is no one date that is fair to both — and
// picking one would have been invisible until two families compared receipts.
function resolveCutoffs(activity, groupId) {
  const type = normaliseType(activity && activity.type);
  const reg = normaliseRegistration(activity && activity.registration, type);
  return {
    registrationFeeCutoffDate: reg.registrationFeeCutoffDate != null
      ? reg.registrationFeeCutoffDate
      : (minusDays(groups.durationFor(activity, groupId).startDate, FEE_CUTOFF_DAYS) || null),
    // DERIVED from the schedule rather than stored beside it. The closing date is
    // the last step's boundary, so there is one value and nothing to reconcile —
    // and every existing caller (the publish fallout, the ledger basis, the
    // "credit window closed on" sentence) keeps reading the same field name.
    cancellationCutoffDate: closingBoundary(resolveTiers(activity, groupId))
  };
}

// ⚠ THE SCHEDULE A PARTICULAR FAMILY IS HELD TO, per group, at the one moment
// the group is known. Every step is exactly what the admin typed except a last
// boundary nobody configured, which is computed from THIS group's calendar — the
// same thing the single closing date has always done, and for the same reason:
// two groups sold the same hours across four meetings and six have different
// third sessions, so one activity-level date would govern the other group's
// families plausibly and invisibly.
function resolveTiers(activity, groupId) {
  const type = normaliseType(activity && activity.type);
  const reg = normaliseRegistration(activity && activity.registration, type);
  const tiers = (reg.cancellationPolicy || {}).tiers || [];
  return tiers.map((t, i) => {
    if (t.until != null) return { until: t.until, percent: t.percent };
    const isLast = i === tiers.length - 1;
    const computed = isLast && type !== 'dropin' ? thirtyPercentPoint(activity, groupId) : null;
    // Unresolvable stays null, which past() reads as "not reached" — the
    // generous direction every blank in this system falls in.
    return { until: computed, percent: t.percent };
  });
}

// Have the inputs moved since the dates were computed? Detect it, offer it,
// never apply it. An activity postponed by a month keeps two cutoff dates
// computed from where it used to be, and both are then wrong in the direction
// that costs families money — but a formula that quietly re-evaluates is worse,
// because it would rewrite terms after they had been agreed.
function basisChanged(activity) {
  const reg = (activity && activity.registration) || {};
  const basis = reg.defaultBasis;
  if (!basis) return null;
  const first = groups.groupList(activity)[0];
  const duration = groups.durationFor(activity, first ? first.groupId : undefined);
  const now = {
    startDate: duration.startDate || '',
    sessionCount: sessions.scheduled(duration.sessionDates).length || num(duration.sessionCount)
  };
  const moved = String(basis.startDate || '') !== String(now.startDate || '') ||
                Number(basis.sessionCount || 0) !== Number(now.sessionCount || 0);
  return moved ? { was: basis, now: now } : null;
}

// Three levels, first one that answers wins. The per-activity field is what
// makes the site-wide value still useful: a short course that fills in a week
// can hold spots for three days without every other activity having to.
function resolveExpiryDays(activity, env) {
  const own = positiveInt(((activity && activity.registration) || {}).pendingExpiryDays);
  if (own != null) return { days: own, source: 'activity' };
  const site = positiveInt((env || {}).PENDING_EXPIRY_DAYS);
  if (site != null) return { days: site, source: 'env' };
  return { days: DEFAULT_EXPIRY_DAYS, source: 'default' };
}

// --- validation ------------------------------------------------------------

// Returns a list of messages, empty when the settings are usable. The caller
// decides what to do with them; validate() in activities-admin.js refuses the
// save — name the problem rather than accepting a value and dropping it
// silently later.
//
// (This used to point at the ctaUrl rule as the precedent for that shape. That
// field is gone, and the reason is worth carrying here: refusing loudly is
// right, but it only catches values that are the wrong SHAPE. ctaUrl was
// refused on save, by an allowlist, in two places — and both bugs it ever had
// were well-formed links pointing somewhere wrong, which no validator of that
// field could have caught. Settings that can be checked against each other,
// like these, are the case where validation genuinely helps.)
function validateRegistration(activity) {
  const errors = [];
  const type = activity && activity.type;
  if (type !== undefined && TYPES.indexOf(type) === -1) {
    errors.push(`Unknown activity type "${type}". It is either "course" or "dropin".`);
  }
  validateTiers(activity, errors);
  return errors;
}

// The first meeting, as a date. What `until: 'start'` resolves to for ordering —
// the calendar's own first session, falling back to the typed start date, which
// is the same precedence thirtyPercentPoint() uses.
function firstSessionDate(activity, groupId) {
  const duration = groups.durationFor(activity, groupId);
  const rows = sessions.scheduled(duration.sessionDates);
  if (rows.length) return rows[0].date;
  return sessions.parseISO(duration.startDate) != null ? duration.startDate : null;
}

// A sortable key for a boundary, resolved for one group. Infinity for a boundary
// that never passes, null for one that cannot be resolved at all.
//
// ⚠ 'start' SORTS BEFORE A DATE ON THE SAME DAY, and the half-day is not
// decoration: a date boundary passes at the END of its day in Asia/Nicosia,
// where 'start' passes the moment the session begins. Two steps ending on one
// day are ordered by that difference and nothing else.
function boundaryKey(until, activity, groupId) {
  if (until == null || until === OFF) return Infinity;
  const iso = until === AT_START ? firstSessionDate(activity, groupId) : until;
  const t = sessions.parseISO(iso);
  // ⚠ AN UNRESOLVABLE BOUNDARY IS "NOT REACHED", NOT AN ERROR — and refusing it
  // was a real bug for the length of one test run: 'start' on an activity with no
  // start date and no calendar is EVERY activity somebody has just created, and
  // this refused all of them.
  //
  // It resolves the generous way, and not as a concession: hasStarted() on an
  // empty session list is false, so the step never closes and the whole of what
  // was paid comes back. That is exactly what flat mode did on an unscheduled
  // activity, which is the reason flat was the default. The schedule inherits it
  // rather than needing a rule of its own.
  if (t == null) return Infinity;
  return t + (until === AT_START ? 0 : 0.5);
}

const stepName = (i, t) => 'step ' + (i + 1) +
  (t && t.percent === PRORATED ? ' (prorated)' : t ? ' (' + t.percent + '%)' : '');

// ⚠ A DROP-IN'S SCHEDULE IS INERT AND IS NOT CHECKED, which is a deliberate
// change of answer rather than an omission.
//
// The old rule refused a prorated MODE on a drop-in, because "a mode saved and
// never read is a mode somebody will later believe is in force". That was right
// about the danger and produced a trap: the form does not draw the policy on a
// drop-in, and mergeRegistration() keeps it across a type switch on purpose — so
// a prorated course switched to a drop-in could not be published, and there was
// no control anywhere to fix it.
//
// Keeping a value across a switch and refusing to save it are incompatible, and
// the value genuinely governs nothing here: creditFor() returns at the top on
// `frozen.type === 'dropin'`, which is a property of the code rather than a rule
// anybody has to remember. So the schedule rides along unread, and what a
// drop-in's cancellation actually obeys — sessionCancelHours — is validated as
// the positive integer it is.
function validateTiers(activity, errors) {
  const type = normaliseType(activity && activity.type);
  if (type === 'dropin') return;

  const rawPolicy = ((activity && activity.registration) || {}).cancellationPolicy || {};
  // Read off the RAW request, not the canonical shape: normaliseTiers() drops a
  // half-typed row to keep the stored shape clean, and a drop that is right on
  // read is silent on save. That is how normaliseBundles() once let an activity
  // publish with nothing on offer while the form still showed what was typed.
  // ⚠ CHECKED ON THE CANONICAL SHAPE, not on the raw request. validate() is handed
  // the merged record, so a rule that could only read the raw body would never
  // fire in the one place it matters — which is how the first draft of this
  // function passed while refusing nothing.
  const tiers = (normaliseRegistration(activity && activity.registration, type)
                  .cancellationPolicy || {}).tiers || [];
  if (!tiers.length) return;

  if (tiers.length > MAX_TIERS) {
    errors.push('A refund schedule of more than ' + MAX_TIERS + ' steps is one no family will read. ' +
      'For a sliding scale, make the last step prorated — it credits the sessions still to come, ' +
      'which is every step at once.');
  }

  tiers.forEach((t, i) => {
    if (t.percent == null) {
      errors.push('Refund step ' + (i + 1) + ' has no percentage. It is a whole number from 0 to 100, ' +
        'or prorated.');
    }
  });

  tiers.forEach((t, i) => {
    const last = i === tiers.length - 1;
    // A boundary that never passes makes everything below it unreachable, and a
    // blank one has no formula except on the last step, where it is the closing
    // date the system has always computed.
    if (!last && t.until === OFF) {
      errors.push('Refund ' + stepName(i, t) + ' never stops, so the steps after it can never apply. ' +
        'Give it a date, or make it the last step.');
    }
    if (!last && t.until == null) {
      errors.push('Refund ' + stepName(i, t) + ' needs a date. Only the last step can be left blank, ' +
        'and that one is filled in when you save.');
    }
    if (t.percent === PRORATED) {
      if (!last) {
        errors.push('Only the last refund step can be prorated: it already decreases to nothing on its ' +
          'own, so a step after it would be a jump in the middle of a slope.');
      }
      // ⚠ AND IT MAY ONLY FOLLOW STEPS THAT CREDIT IN FULL. Prorated credits the
      // sessions still to come, which just after its band opens is nearly all of
      // them — so after a 50% step the credit would RISE, which is the one thing
      // the ordering rule below exists to forbid. Today's prorated mode is
      // exactly [100% until it starts, prorated], so nothing in use is affected.
      if (tiers.slice(0, i).some((p) => p.percent !== 100)) {
        errors.push('A prorated step credits the sessions still to come, which as it opens is nearly ' +
          'all of them — so it can only follow steps that credit in full.');
      }
    }
  });

  // ⚠ CREDIT MAY NEVER RISE BY WAITING. A later step crediting more than an
  // earlier one rewards delay and makes the sentence above it false: "cancel by
  // the 30th for the whole of it" cannot be true if the 15th of November is
  // worth more. Equal is allowed — two steps crediting the same amount are
  // redundant rather than contradictory, and refusing redundancy is a form
  // fighting somebody who is halfway through an edit.
  for (let i = 1; i < tiers.length; i++) {
    const before = tiers[i - 1].percent;
    const after = tiers[i].percent;
    if (before === PRORATED || after === PRORATED) continue;
    if (Number(after) > Number(before)) {
      errors.push('Refund ' + stepName(i, tiers[i]) + ' credits more than ' + stepName(i - 1, tiers[i - 1]) +
        ' before it. A family cannot get more back by cancelling later.');
    }
  }

  // Per group, because both of these resolve per group: 'start' is that group's
  // first meeting, and proration divides by the calendar that group was sold.
  // Two groups under the equal-hours rule can meet four times and six.
  const list = groups.groupList(activity);
  const ids = list.length ? list.map((g) => g.groupId) : [undefined];
  const named = (gid) => {
    const g = list.filter((x) => x.groupId === gid)[0];
    const n = g && g.name ? (g.name.he || g.name.en || g.name.ru) : '';
    return list.length > 1 ? ' (' + (n || gid) + ')' : '';
  };

  if (tiers.some((t) => t.percent === PRORATED)) {
    const without = ids.filter(
      (gid) => !sessions.scheduled(groups.durationFor(activity, gid).sessionDates).length);
    if (!list.length || without.length) {
      errors.push('A prorated refund step needs a session calendar to divide by, and this activity has ' +
        'none. Generate the sessions on the Schedule panel, or give that step a percentage instead.');
    }
  }

  ids.forEach((gid) => {
    const resolved = resolveTiers(activity, gid);
    let prev = -Infinity;
    let prevIdx = -1;
    resolved.forEach((t, i) => {
      const k = boundaryKey(t.until, activity, gid);
      if (k <= prev) {
        errors.push('Refund ' + stepName(i, t) + ' ends before ' + stepName(prevIdx, resolved[prevIdx]) +
          ' above it' + named(gid) + '. The schedule runs earliest first.');
      }
      if (k !== Infinity) { prev = k; prevIdx = i; }
    });
  });
}

// --- the Registration panel ------------------------------------------------
//
// The panel descriptor lives HERE rather than in activities-admin.js, because
// two things need to agree about which fields a type draws: the form, and the
// merge that protects the fields it did not draw. Two lists would be one list
// that falls out of step, and the way it would fail is silent — see
// mergeRegistration below.
//
// `types` absent means every type draws it.
const FIELDS = [
    { key: 'autoApprove', kind: 'check', label: 'Approve registrations automatically',
      hint: 'Off means every request waits for an admin. An out-of-range age always waits, whatever this says.' },
    { key: 'pendingExpiryDays', kind: 'days', label: 'Unanswered registrations are released after',
      unit: 'days',
      hint: 'Counted from each family\'s own submission, and the family is told and apologised to. ' +
            'They were told they are registered, so keep this long enough that answering the queue ' +
            'always beats it. Leave blank for the site default (' + DEFAULT_EXPIRY_DAYS + ' days).' },
    { key: 'registrationFeeCutoffDate', kind: 'cutoff', types: ['course'],
      label: 'Registration fee stops being creditable on',
      hint: 'One date, the same for every family however late they registered. Leave it blank ' +
            'and it is filled in WHEN YOU SAVE, ' + FEE_CUTOFF_DAYS + ' days before the start ' +
            'date \u2014 so it stays empty until then, and needs a start date to compute from.' },
    { key: 'cancellationPolicy.tiers', kind: 'tiers', types: ['course'],
      label: 'What a cancellation credits',
      hint: 'A step says what comes back if a family cancels before its date, and the list runs ' +
            'earliest first. Past the LAST date nothing is creditable \u2014 that step is the closing ' +
            'date. Leave the last date blank and it is filled in WHEN YOU SAVE, to the date of ' +
            'session ' + Math.round(CANCEL_FRACTION * 100) + '% of the way through. A prorated step ' +
            'credits the sessions still to come instead of a fixed share, and needs a session ' +
            'calendar. At most ' + MAX_TIERS + ' steps: past that, use prorated. ' +
            'Cancelling itself is always allowed \u2014 this is only what it is worth.' },
    { key: 'cancellationPolicy.note', kind: 'langtext',
      label: 'Why these dates (optional)',
      hint: 'Shown to families wherever the cancellation terms are \u2014 the registration form, their ' +
            'own page, and the confirmation emails. For a date that cannot account for itself: a ' +
            'closing date before the course starts, because materials or tickets were bought in ' +
            'advance. Leave it blank and nothing is shown anywhere.' },
    { key: 'sessionCancelHours', kind: 'days', types: ['dropin'], unit: 'hours',
      label: 'A session can be cancelled up to',
      hint: 'Before it starts. Leave blank to allow cancelling right up to the start time.' }
  ];

// Does this type draw this field?
const draws = (field, type) => !field.types || field.types.indexOf(normaliseType(type)) !== -1;

// Which stored keys a field owns. The two nested ones are written with a dotted
// key so the form can address them; this is the one place that mapping lives.
function fieldPath(key) { return String(key).split('.'); }

function getPath(obj, key) {
  return fieldPath(key).reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, key, value) {
  const parts = fieldPath(key);
  let node = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!node[parts[i]] || typeof node[parts[i]] !== 'object') node[parts[i]] = {};
    node = node[parts[i]];
  }
  node[parts[parts.length - 1]] = value;
}

// A GROUP THE FORM DID NOT DRAW IS NOT READ BACK AND IS NOT MERGED.
//
// This is the trap conditional panels bring, and it is a new version of one this
// codebase already documents: the field renders, the admin types into it, the
// save succeeds, and the value is gone. Here it is worse, because nobody typed
// anything — switch an activity from course to drop-in, and the term cutoff
// dates sit in a panel the form no longer draws, so the read-back sends nothing
// for them and "nothing" would be merged as "cleared".
//
// Absent must mean "this type did not send it", never "the admin emptied it" —
// the same distinction cardImage already draws, where a cleared image travels as
// null and an unsent one is simply absent. Decided from the TYPE server-side
// rather than from a list the client sends, so it needs no trust.
//
// Switch a course to a drop-in and back, and the term settings are still there.
function mergeRegistration(base, incoming, type, langs) {
  const t = normaliseType(type);

  // ⚠ ONE WORD IN A BLOCK OF STRUCTURE, AND IT HAS TO BE TRANSLATABLE.
  //
  // Everything else here is a number, a date or a flag: one answer for all three
  // languages, so a role permitted to edit only Russian keeps the stored value
  // and sends nothing. The explanation note is copy a family reads, and a
  // translator who cannot reach it is the exact gap LANG_SUBKEYS was invented to
  // close for facts and mergeGroups() for a group's name — arriving in the one
  // block that had never held a word.
  //
  // So a restricted session keeps the schedule, the cutoffs and every flag
  // exactly as stored, and may write the note in the languages it is allowed.
  const allowed = Array.isArray(langs) ? langs : NOTE_LANGS;
  if (!NOTE_LANGS.every((l) => allowed.indexOf(l) !== -1)) {
    const kept = normaliseRegistration(base, t);
    const sent = noteBag((((incoming || {}).cancellationPolicy) || {}).note);
    allowed.forEach((l) => { if (NOTE_LANGS.indexOf(l) !== -1) kept.cancellationPolicy.note[l] = sent[l]; });
    return kept;
  }

  const from = normaliseRegistration(base, t);
  const to = normaliseRegistration(incoming, t);
  const out = normaliseRegistration(base, t);

  // ⚠ AN UNDRAWN FIELD IS READ FROM THE RAW STORED RECORD, NOT FROM `from`.
  //
  // `from` is the base normalised TO THE TARGET TYPE, and normalising is exactly
  // what drops the other type's fields — so reading the value to carry across
  // from a copy that has already had it removed carries across nothing. The loop
  // looked like it was protecting the field and was quietly writing undefined
  // over it.
  //
  // Only one field has the asymmetry today (a course has no sessionCancelHours;
  // normaliseRegistration writes the cutoffs whatever the type), which is why
  // five of the six were protected by coincidence and the sixth was not. Reading
  // the raw record makes the protection the rule.
  const raw = base || {};
  const kept = (key) => {
    const normalised = getPath(from, key);
    if (normalised !== undefined && normalised !== null) return normalised;
    return getPath(raw, key);
  };

  FIELDS.forEach((f) => {
    if (draws(f, t)) setPath(out, f.key, getPath(to, f.key));
    else setPath(out, f.key, kept(f.key));
  });
  // Not a form field: it is stamped by defaultIfBlank and only ever read.
  out.defaultBasis = from.defaultBasis || to.defaultBasis || null;

  // ⚠ THE FINAL NORMALISE WOULD OTHERWISE UNDO HALF OF THE WORK ABOVE, and the
  // asymmetry is easy to miss because only one field has it.
  //
  // normaliseRegistration() builds the canonical shape FOR A TYPE, and a course
  // has no sessionCancelHours — so a drop-in configured with a 24-hour window,
  // switched to course to fix something and switched back, silently came back
  // with no window at all. That is the exact failure this whole mechanism exists
  // to prevent, in the one direction nobody had tested: nothing was typed, the
  // save succeeded, and the policy quietly became more generous than the one
  // that was agreed.
  //
  // It went unnoticed because the course-only fields survive a drop-in save for
  // an unrelated reason — normaliseRegistration writes the cutoffs whatever the
  // type — so five of the six fields were protected by accident rather than by
  // this rule. Carrying every UNDRAWN field across explicitly makes the
  // protection the rule rather than a coincidence, and covers the next
  // type-scoped field without anyone remembering to.
  const result = normaliseRegistration(out, t);
  FIELDS.forEach((f) => {
    if (draws(f, t)) return;
    const kept = getPath(out, f.key);
    if (kept !== undefined && kept !== null) setPath(result, f.key, kept);
  });
  return result;
}

// The same rule, for the two price fields that are type-scoped. A course quotes
// the term and a drop-in quotes the session, so the form draws one of them —
// and the other has to survive being undrawn exactly as the cutoffs do.
const TYPE_SCOPED_FACT_KEYS = {
  // Four now, and the two new ones matter MORE than the first pair rather than
  // less. A term price is one number an admin can retype; a bundle list is
  // several products with their own ids, and a family's purchase points at one
  // of those ids. Losing the list to a type switch would leave live bundles
  // whose terms the activity no longer describes.
  price: {
    fullPrice: ['course'], perSessionPrice: ['dropin'],
    lateDropIn: ['dropin'], bundles: ['dropin']
  }
};

// Patch an incoming fact with the stored value of anything this type does not
// draw, before the canonical shape is applied.
function keepUndrawnFactKeys(factKey, current, incoming, type) {
  const scoped = TYPE_SCOPED_FACT_KEYS[factKey];
  if (!scoped) return incoming;
  const t = normaliseType(type);
  const out = Object.assign({}, incoming || {});
  Object.keys(scoped).forEach((k) => {
    if (scoped[k].indexOf(t) === -1) out[k] = (current || {})[k];
  });
  return out;
}

module.exports = {
  TYPES, DEFAULT_TYPE, CANCELLATION_MODES, DEFAULT_MODE,
  DEFAULT_EXPIRY_DAYS, FEE_CUTOFF_DAYS, CANCEL_FRACTION, OFF,
  AT_START, PRORATED, MAX_TIERS, NOTE_LANGS, NOTE_MAX,
  normaliseType, normaliseRegistration, validateRegistration,
  defaultIfBlank, basisChanged, resolveExpiryDays,
  thirtyPercentPoint, minusDays, cutoff,
  normaliseTiers, legacyTiers, tiersOf, closingBoundary, noteBag, noteIsEmpty,
  firstSessionDate, boundaryKey,
  FIELDS, draws, mergeRegistration, keepUndrawnFactKeys, TYPE_SCOPED_FACT_KEYS,
  resolveCutoffs, resolveTiers
};
