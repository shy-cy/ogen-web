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

// The only distinction between a semester course and a pay-per-session
// activity. A flag rather than a second content type: the two differ in how
// money is quoted, how it is collected, and what cancelling means, and are
// identical in every other respect the site has — same URL space, same
// template, same listing, same publish pipeline, same permissions.
const TYPES = ['course', 'dropin'];
const DEFAULT_TYPE = 'course';

// flat is the default because it works on an activity nobody has finished
// scheduling. Prorated divides by the session list, so it is refused on save
// unless that list resolves — see validateRegistration().
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
    cancellationPolicy: {
      mode: CANCELLATION_MODES.indexOf(policy.mode) !== -1 ? policy.mode : DEFAULT_MODE,
      cancellationCutoffDate: cutoff(policy.cancellationCutoffDate)
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
function thirtyPercentPoint(activity) {
  const duration = ((activity && activity.facts) || {}).duration || {};
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
  const duration = ((activity && activity.facts) || {}).duration || {};
  let filled = false;

  if (reg.registrationFeeCutoffDate == null && duration.startDate) {
    const d = minusDays(duration.startDate, FEE_CUTOFF_DAYS);
    if (d) { reg.registrationFeeCutoffDate = d; filled = true; }
  }
  // A drop-in has no term to withdraw from, so it has no cancellation cutoff to
  // compute. Leaving it null keeps the field meaningless rather than filling it
  // with a date that governs nothing.
  if (type !== 'dropin' && reg.cancellationPolicy.cancellationCutoffDate == null) {
    const d = thirtyPercentPoint(activity);
    if (d) { reg.cancellationPolicy.cancellationCutoffDate = d; filled = true; }
  }

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

// Have the inputs moved since the dates were computed? Detect it, offer it,
// never apply it. An activity postponed by a month keeps two cutoff dates
// computed from where it used to be, and both are then wrong in the direction
// that costs families money — but a formula that quietly re-evaluates is worse,
// because it would rewrite terms after they had been agreed.
function basisChanged(activity) {
  const reg = (activity && activity.registration) || {};
  const basis = reg.defaultBasis;
  if (!basis) return null;
  const duration = ((activity && activity.facts) || {}).duration || {};
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
  const reg = normaliseRegistration(activity && activity.registration, normaliseType(type));
  const raw = (activity && activity.registration) || {};
  const rawPolicy = raw.cancellationPolicy || {};
  if (rawPolicy.mode !== undefined && CANCELLATION_MODES.indexOf(rawPolicy.mode) === -1) {
    errors.push(`Unknown cancellation mode "${rawPolicy.mode}". It is either "flat" or "prorated".`);
  }

  // Prorated divides sessions remaining by sessions total. Without a resolved
  // calendar the formula divides by a number that is not there, at the moment a
  // family is cancelling — which is the worst possible moment to discover a
  // configuration gap. Flat has no such requirement, which is a second reason
  // it is the default.
  if (reg.cancellationPolicy.mode === 'prorated') {
    const duration = ((activity && activity.facts) || {}).duration || {};
    if (!sessions.scheduled(duration.sessionDates).length) {
      errors.push('Prorated cancellation needs a session calendar to divide by, and this activity has none. ' +
        'Generate the sessions on the Activity facts panel, or use flat cancellation.');
    }
  }

  // A drop-in has no term price to prorate and no term to withdraw from, so a
  // cancellation policy on one is a setting that governs nothing. Refused
  // rather than ignored: a mode saved and never read is a mode somebody will
  // later believe is in force.
  if (normaliseType(type) === 'dropin' && rawPolicy.mode === 'prorated') {
    errors.push('A drop-in activity has no course to prorate. Use the per-session cancellation window instead.');
  }
  return errors;
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
      hint: 'One date, the same for every family however late they registered. Pre-filled to ' +
            FEE_CUTOFF_DAYS + ' days before the start date.' },
    { key: 'cancellationPolicy.mode', kind: 'mode', types: ['course'],
      label: 'How a cancellation is credited',
      hint: 'Flat credits a fixed share. Prorated divides the sessions remaining by the sessions total, and needs a session calendar.' },
    { key: 'cancellationPolicy.cancellationCutoffDate', kind: 'cutoff', types: ['course'],
      label: 'Nothing is creditable after',
      hint: 'Pre-filled to the date of session ' + Math.round(CANCEL_FRACTION * 100) + '% of the way through.' },
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
function mergeRegistration(base, incoming, type) {
  const t = normaliseType(type);
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
  price: { fullPrice: ['course'], perSessionPrice: ['dropin'] }
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
  normaliseType, normaliseRegistration, validateRegistration,
  defaultIfBlank, basisChanged, resolveExpiryDays,
  thirtyPercentPoint, minusDays, cutoff,
  FIELDS, draws, mergeRegistration, keepUndrawnFactKeys, TYPE_SCOPED_FACT_KEYS
};
