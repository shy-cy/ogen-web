// What a registration IS, and every rule about it that needs no storage.
//
// PURE. No Blobs, no GitHub, no Date.now() of its own — every function that
// cares about time takes the moment as an argument. That is what makes the
// capacity count, the expiry rule and the auto-approve decision testable with
// no fixtures and reproducible a year later, the same property _credit.js sells.
//
// ⚠ Arms the legal gate, correctly: this file is the registration system.
//
// ONE RECORD PER PARTICIPANT PER ACTIVITY, keyed reg-<participantId>__<activityId>.
// Two siblings in the same activity are two blobs that know nothing about each
// other, so approving one is a write to one key. The alternative — one record
// per household with an attendees[] array — cannot express two outcomes, and on
// a store with no compare-and-swap two admins working the queue at once would
// silently undo each other. Separate keys make that impossible rather than
// unlikely.
//
// THE ID, NOT THE SLUG. A slug is a filename and a URL and can be renamed; the
// activityId cannot. That is the whole reason it was minted in Phase 1.

const facts = require('./_activity-facts');
const credit = require('./_credit');
const { ageFlag } = require('./_participant-store');
const REG = require('./_activity-registration');

// Five, and deliberately five. `rejected` and `expired` and `cancelled` are all
// "does not hold a spot", but they are different things that happened and the
// record is kept for each — a cancellation is an event, not an absence.
const STATUSES = ['pending', 'approved', 'rejected', 'expired', 'cancelled'];

// Provenance, NOT a second status. A guardian's cancellation and an admin's are
// the same thing to everything that reads one — capacity, the queue, reminders —
// and what differs is who did it. Splitting them into two statuses would make
// every consumer learn two words for one condition.
const CANCEL_SOURCES = ['guardian', 'admin'];

const CURRENCY = 'EUR';

const key = (participantId, activityId) => 'reg-' + participantId + '__' + activityId;

const ms = (v) => {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const t = Date.parse(v);
  return isNaN(t) ? null : t;
};

// --- the rule ---------------------------------------------------------------

// THE AUTHORITATIVE ANSWER TO "DOES THIS CONSUME A PLACE", and it is derived
// rather than stored.
//
// An expired hold stops consuming a spot the instant it expires, whether or not
// the nightly sweep has run. So the correctness half of the 14-day expiry needs
// no infrastructure at all: if the job never runs, nothing is wrong with the
// numbers — only with what a dashboard says, which is what the job is for.
//
// Capacity counting calls THIS, never reg.status.
function holdsASpot(reg, now) {
  if (!reg) return false;
  if (reg.status === 'approved') return true;
  if (reg.status !== 'pending') return false;
  const until = ms(reg.expiresAt);
  // A pending registration with no deadline is one nothing stamped. It holds
  // its spot rather than being silently released: an unstamped record is a bug
  // in the writer, and reading it as "already expired" would free a place a
  // family is waiting on.
  if (until == null) return true;
  return (ms(now) == null ? Date.now() : ms(now)) < until;
}

// Has a pending registration run out, as at a moment? The sweep's question, and
// exactly the negation of the clause above — written once so the two cannot
// disagree about the boundary.
const hasLapsed = (reg, now) =>
  !!reg && reg.status === 'pending' && ms(reg.expiresAt) != null &&
  (ms(now) == null ? Date.now() : ms(now)) >= ms(reg.expiresAt);

// --- capacity ---------------------------------------------------------------

// COUNTED, NEVER DECREMENTED, and that is the single decision the whole thing
// rests on. There is no hold to release and no counter to fix: writing
// `cancelled` makes the next count one lower, and rejection, expiry and
// cancellation are therefore one mechanism rather than three.
//
// A counter blob would have been cheaper to read and would have needed a
// decrement that can be lost without trace on a store with no compare-and-swap.
// "Cancelled twice" or "cancelled while an approval was in flight" would each
// have been a way to corrupt a number nobody could audit.
function countSpots(regs, now) {
  const byGroup = Object.create(null);
  let taken = 0;
  (regs || []).forEach((r) => {
    if (!holdsASpot(r, now)) return;
    taken++;
    const g = r.groupId || '';
    byGroup[g] = (byGroup[g] || 0) + 1;
  });
  return { taken: taken, byGroup: byGroup };
}

// Capacity from the fields that already exist — facts.groupSize — and nothing
// new. null capacity means UNCAPPED, deliberately not zero: defaulting a missing
// number to zero would silently refuse every registration for an activity
// nobody had finished filling in. Same direction as every other blank in this
// codebase, which resolves towards the family.
function capacityReport(activity, regs, now) {
  const f = (((activity || {}).facts) || {}).groupSize || {};
  const named = facts.namedGroups(f);
  const counts = countSpots(regs, now);
  const capacity = facts.totalCapacity(f);

  // Registrations taken while the activity was pooled carry groupId null, so
  // they land under '' and appear in `taken` without belonging to any named
  // row. That is the honest reading — the place is occupied and nobody knows by
  // which group — and it is why the totals are counted separately rather than
  // summed from the rows.
  const rows = named.map((g) => {
    const cap = g.capacity == null || g.capacity === '' ? null : Number(g.capacity);
    const has = cap != null && isFinite(cap) && cap > 0 ? cap : null;
    const taken = counts.byGroup[g.groupId] || 0;
    return {
      groupId: g.groupId,
      name: g.name || null,
      capacity: has,
      taken: taken,
      left: has == null ? null : has - taken,
      over: has != null && taken > has
    };
  });

  return {
    capacity: capacity,
    taken: counts.taken,
    left: capacity == null ? null : capacity - counts.taken,
    // Stated plainly rather than pretended impossible. Two submissions arriving
    // together both read "one spot left" and both write; the window is a few
    // hundred milliseconds and there is no atomic increment to close it. The
    // admin list says "23 / 20 — over capacity" and an admin rejects the
    // surplus, which is a smaller problem than a lost counter update.
    over: capacity != null && counts.taken > capacity,
    unassigned: counts.byGroup[''] || 0,
    named: rows.length ? rows : null
  };
}

// Is there room for one more, in the group they asked for?
function hasRoom(report, groupId) {
  if (report.named) {
    const row = report.named.filter((r) => r.groupId === groupId)[0];
    if (!row) return false;
    return row.left == null || row.left > 0;
  }
  return report.left == null || report.left > 0;
}

// --- the age flag, and what auto-approve does with it ------------------------

// Measured at the ACTIVITY'S START where there is one, not at submission. A
// child who turns seven the week before a seven-to-ten class begins is seven for
// that class, and a family registering in August should not be told otherwise.
// Falls back to the submission moment when an activity has no start date, which
// is the drop-in case.
function ageCheckMoment(activity, now) {
  const start = ((((activity || {}).facts) || {}).duration || {}).startDate;
  const t = credit.parseDateParts(start) ? credit.resolveLocal(start, '', credit.TZ) : null;
  return t == null
    ? { at: ms(now) == null ? Date.now() : ms(now), against: 'submission' }
    : { at: t, against: 'activity-start' };
}

function flagFor(activity, participant, now) {
  const when = ageCheckMoment(activity, now);
  const ages = (((activity || {}).facts) || {}).ages || {};
  return Object.assign(ageFlag(participant, ages, when.at), { checkedAgainst: when.against });
}

// AUTO-APPROVE STOPS AT AN AGE IT CANNOT CONFIRM, not only at one it can refuse.
//
// The design settled that an out-of-range age falls through to manual review:
// autoApprove means "this activity has no gate a human needs to apply", and an
// out-of-range age is precisely a case where a human has something to decide.
// The flag is not overriding auto-approve; it is saying this one is not routine.
//
// The case the design did not name is an age it cannot check at all — a record
// with no usable date of birth, on an activity that states a range. That is
// treated the same way, and the rule is written as "a stated range must be
// positively satisfied" rather than as "inRange must not be false". Reading a
// blank as a pass would let the one case nobody can verify be the one case
// nobody looks at.
//
// An activity with no stated range has nothing to satisfy, so auto-approve
// applies in full — that is not an exception, there is simply nothing to check.
// Nothing here rejects anything: falling through means waiting for a person, and
// the person may well say yes.
function autoApproves(activity, flag) {
  if (((activity || {}).registration || {}).autoApprove !== true) return false;
  const stated = flag && (flag.min != null || flag.max != null);
  if (stated && flag.inRange !== true) return false;
  return true;
}

// --- what is frozen ---------------------------------------------------------

// The inputs to the decision, captured at submission, so a later edit to the
// activity or to the participant cannot rewrite history. This is the one place
// a Blobs record depends on the shape of a git record, and freezing is what
// keeps that dependency from being live: an admin changing a price or an age
// range in March changes the activity, and every registration already taken
// keeps the terms it was taken under.
function freeze(activity, participant, groupId, flag) {
  const f = ((activity || {}).facts) || {};
  const price = f.price || {};
  const group = facts.namedGroups(f.groupSize || {})
    .filter((g) => g.groupId === groupId)[0] || null;

  return {
    participantName: [participant.firstName, participant.lastName].filter(Boolean).join(' '),
    dateOfBirth: participant.dateOfBirth || null,
    activityTitle: activity.title || null,
    // Audit only. NOTHING keys off this — if it later disagrees with the
    // activity's current slug, that is a rename having worked.
    activitySlugAtSubmission: activity.slug || null,
    ageAtCheck: flag ? flag.age : null,
    ageCheckedAgainst: flag ? flag.checkedAgainst : null,
    ageRange: { min: flag ? flag.min : null, max: flag ? flag.max : null },
    price: {
      registrationFee: price.registrationFee == null ? null : Number(price.registrationFee),
      fullPrice: price.fullPrice == null ? null : Number(price.fullPrice),
      perSessionPrice: price.perSessionPrice == null ? null : Number(price.perSessionPrice),
      currency: CURRENCY
    },
    // Frozen for the same reason the price is: a group renamed from "Advanced"
    // to "Level 3" in March must not rewrite what a family chose in January. The
    // groupId is what counts capacity; this is what a receipt says.
    groupName: group ? (group.name || null) : null,
    // Built by _credit.js, beside the function that reads it, so the two shapes
    // cannot drift. It carries only the sessions that are actually happening.
    cancellation: credit.freezeCancellation(activity)
  };
}

// --- building one -----------------------------------------------------------

function submissionErrors(activity, participant, groupId) {
  const errors = [];
  if (!activity) { errors.push('No such activity.'); return errors; }
  if (!participant) { errors.push('No such participant.'); return errors; }
  if (activity.status !== 'open') {
    errors.push('Registration for this activity is not open.');
  }
  const named = facts.namedGroups((((activity.facts) || {}).groupSize) || {});
  if (named.length) {
    if (!groupId) errors.push('This activity runs several groups, so one has to be chosen.');
    else if (!named.some((g) => g.groupId === groupId)) errors.push('No such group on this activity.');
  } else if (groupId) {
    errors.push('This activity runs one pool, so there is no group to choose.');
  }
  return errors;
}

// expiresAt is STAMPED HERE, at submission, never computed on read.
//
// Computing submittedAt + N at read time would make every change to the number
// retroactive: lowering it would expire a batch of live registrations the moment
// it deployed, and raising it would revive ones already released. So a change to
// the activity or the env affects new registrations only, and everything in
// flight keeps the deadline it was given.
//
// The record also keeps WHICH number produced it and WHERE IT CAME FROM. Without
// those, "why did this one expire in three days and that one in fourteen" is
// unanswerable a month later.
function newRegistration({ activity, participant, accountId, groupId, now, env }) {
  const at = ms(now) == null ? Date.now() : ms(now);
  const iso = new Date(at).toISOString();
  const expiry = REG.resolveExpiryDays(activity, env || process.env);
  const flag = flagFor(activity, participant, at);
  const auto = autoApproves(activity, flag);

  return {
    participantId: participant.participantId,
    activityId: activity.activityId,
    // WHO OWES. The account that submitted, not the participant and not the
    // primary guardian — a second guardian who registers a child is the one the
    // bill and the credit belong to.
    accountId: accountId,
    groupId: groupId || null,
    status: auto ? 'approved' : 'pending',
    submittedAt: iso,
    expiresAt: new Date(at + expiry.days * 24 * 60 * 60 * 1000).toISOString(),
    expiryDays: expiry.days,
    expirySource: expiry.source,
    decidedAt: auto ? iso : null,
    decidedBy: null,
    autoApproved: auto,
    expiredAt: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelSource: null,
    frozen: freeze(activity, participant, groupId || null, flag),
    // ADVISORY ONLY. It annotates the queue and nothing branches on it except
    // autoApproves above, which reads it to decide whether to stand aside.
    ageFlag: flag,
    payment: {
      // PHASE 5 FILLS THIS, and it is null rather than a number on purpose.
      //
      // What a registration is billed is not a property of the activity alone,
      // because the registration fee is waived in one case and one case only:
      //
      //   THE FEE IS SCOPED TO ONE PARTICIPANT, ONE ACTIVITY, ONE YEAR.
      //
      //   same child, same activity, second semester  -> NOT charged again
      //   same child, a different activity            -> charged
      //   a sibling, any activity                     -> charged
      //
      // Not per family and not per account: two children in the same activity
      // pay two fees, and one child in two activities pays two fees. The only
      // thing that suppresses it is that this participant has already paid it
      // for THIS activity this year.
      //
      // That scope is what makes the waiver answerable HERE rather than from a
      // ledger: it is a question about this participant's own registrations for
      // this activity, which is a prefix scan of reg-<participantId>__ — no
      // account aggregate, no cross-store join, nothing to reconcile. The rule
      // is strictly cheaper than a family-level one would have been.
      //
      // ⚠ WHAT IT STILL WAITS ON is not the ledger, it is a TERM. The key is
      // reg-<participantId>__<activityId>, one record per pair with no semester
      // in it, so the one case the waiver exists for — the same child in the
      // same activity next semester — has nowhere to go. See the Phase 5 note in
      // CLAUDE.md; that has to be settled before owedCents can be computed.
      //
      // ⚠ AND IT CHANGES splitPaid() in _credit.js, which takes the fee off the
      // top of whatever was paid. On a waived registration nothing paid is fee,
      // so the first 50 euros of a course payment would be credited as one. The
      // frozen block has to record whether the fee was CHARGED on this
      // registration, not only what the fee was.
      owedCents: null,
      paidCents: 0,
      currency: CURRENCY,
      paidAt: null,
      status: 'owed',
      writtenOffAt: null,
      writtenOffBy: null,
      reassignedFrom: null,
      creditedCents: 0,
      creditedToAccountId: null
    },
    history: [{ iso: iso, action: auto ? 'auto-approved' : 'submitted', by: accountId, note: null }],
    isoUpdated: iso
  };
}

// Every state change goes through here, so the history is written by the same
// code that writes the status and cannot be forgotten at one call site.
function transition(reg, { status, by, source, note, now }) {
  const at = ms(now) == null ? Date.now() : ms(now);
  const iso = new Date(at).toISOString();
  const next = Object.assign({}, reg, { status: status, isoUpdated: iso });

  if (status === 'approved' || status === 'rejected') {
    next.decidedAt = iso;
    next.decidedBy = by || null;
    next.autoApproved = false;
  }
  if (status === 'cancelled') {
    next.cancelledAt = iso;
    next.cancelledBy = by || null;
    next.cancelSource = CANCEL_SOURCES.indexOf(source) !== -1 ? source : 'admin';
  }
  if (status === 'expired') next.expiredAt = iso;

  next.history = (reg.history || []).concat([{
    iso: iso, action: status, by: by || null, note: note || null
  }]);
  return next;
}

module.exports = {
  STATUSES, CANCEL_SOURCES, CURRENCY, key,
  holdsASpot, hasLapsed, countSpots, capacityReport, hasRoom,
  ageCheckMoment, flagFor, autoApproves,
  freeze, submissionErrors, newRegistration, transition
};
