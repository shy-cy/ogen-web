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

// A DROP-IN COUNTS A ROOM ON ONE EVENING, not a term.
//
// "The room holds twenty on Tuesday, not twenty forever." A course's capacity is
// consumed by a registration that holds a spot for the whole term; a drop-in's
// is consumed by whoever is coming on the night, and is free again the next
// week. Same capacity figure from the same facts.groupSize, counted against a
// different list.
//
// It takes the attendance records rather than reading them, so this stays pure
// and testable with no fixtures — the same shape capacityReport() has.
function capacityForDate(activity, attendances, sessionDate) {
  const f = (((activity || {}).facts) || {}).groupSize || {};
  const capacity = facts.totalCapacity(f);
  const held = (attendances || []).filter(
    (a) => a && a.sessionDate === sessionDate && holdsASeat(a));
  const byGroup = Object.create(null);
  held.forEach((a) => { const g = a.groupId || ''; byGroup[g] = (byGroup[g] || 0) + 1; });

  return {
    sessionDate: sessionDate,
    capacity: capacity,
    taken: held.length,
    left: capacity == null ? null : capacity - held.length,
    over: capacity != null && held.length > capacity,
    byGroup: byGroup
  };
}

// Booked or already attended occupies a place on that evening; cancelled and
// no-show do not. A no-show is deliberately NOT counted — the question this
// answers is "is there room", and somebody who did not come is not in the room.
// Whether they still owe for it is a different question, answered by the payment
// on their own record.
const SEAT_STATUSES = ['booked', 'attended'];
const holdsASeat = (att) => !!att && SEAT_STATUSES.indexOf(att.status) !== -1;

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

// --- the registration fee, and the one case it is waived ---------------------

// THE ACADEMIC YEAR, NOT THE CALENDAR YEAR, and the distinction is the whole
// feature rather than a detail.
//
// The fee is annual. Ogen's autumn term runs October to December and its spring
// term January to June, so on a calendar year the two halves of one course fall
// either side of the boundary and a child returning in the spring would be
// charged again — which is the exact case the waiver exists to prevent. On an
// academic year they are one year, which is what "yearly registration fee"
// means to the family paying it.
//
// September, because that is when the school year starts in both Israel and
// Cyprus, and a term beginning in September belongs with the ones after it.
const ACADEMIC_YEAR_STARTS = 9;

function academicYearOf(isoDate) {
  const p = credit.parseDateParts(isoDate);
  if (p == null) return null;
  const start = p.mo >= ACADEMIC_YEAR_STARTS ? p.y : p.y - 1;
  return start + '/' + String((start + 1) % 100).padStart(2, '0');
}

// Measured from the ACTIVITY'S START DATE, not from the moment of submission. A
// family enrolling in August for a course beginning in October is enrolling for
// that course's year, and a registration taken on 31 August must not land in a
// different year from one taken on 1 September for the same term. Falls back to
// the submission moment only for an activity with no start date.
function feeYearOf(activity, now) {
  const start = ((((activity || {}).facts) || {}).duration || {}).startDate;
  const byStart = academicYearOf(start);
  if (byStart) return byStart;
  return academicYearOf(new Date(ms(now) == null ? Date.now() : ms(now)).toISOString().slice(0, 10));
}

// Which activity this is a term of. Defaults to the activity's own id, so every
// activity is a series of one until an admin links a second term.
const seriesOf = (activity) => (activity && (activity.seriesId || activity.activityId)) || null;

// Does a prior registration still count as having been charged the fee?
//
// LIVE AND FINISHED ARE DIFFERENT QUESTIONS, and collapsing them leaves a hole.
//
//   pending / approved   The registration stands, so the fee is billed on it and
//                        will be collected. It counts even if nothing has been
//                        paid yet — otherwise a family registering for both terms
//                        before paying anything would be billed the fee twice.
//
//   rejected / expired   The request never became a place, so nothing was ever
//                        owed. The fee applies to the next one.
//
//   cancelled            The registration is over, so "billed" is no longer a
//                        promise of anything. It counts only if the fee was
//                        actually PAID and not given back. Registering, not
//                        paying, cancelling and registering again must not be a
//                        way to never pay the fee at all — which is what reading
//                        `cancelled` as "charged" outright would have made it,
//                        and it is the kind of hole that is found by whoever
//                        discovers it rather than by whoever wrote it.
//
// And in every case, a registration whose own fee was waived proves nothing
// about a third one: `feeCharged === false` is not a payment.
const CHARGED_STATUSES = ['pending', 'approved', 'cancelled'];
const LIVE_STATUSES = ['pending', 'approved'];

function feeStandsOn(reg) {
  if (!reg) return false;
  const price = ((reg.frozen || {}).price) || {};
  // Absent reads as charged: a record written before the waiver existed was
  // charged, so nothing already stored changes meaning.
  if (price.feeCharged === false) return false;
  if (LIVE_STATUSES.indexOf(reg.status) !== -1) return true;
  if (reg.status !== 'cancelled') return false;

  const payment = reg.payment || {};
  // The fee portion of what was actually paid, against what was actually given
  // back. splitPaid is the same function the credit uses, so the two cannot
  // disagree about which euros were fee.
  const paidFee = credit.splitPaid(payment.paidCents, price.registrationFee, true).fee;
  return paidFee > (payment.feeCreditedCents || 0);
}

// THE WAIVER, in one place.
//
//   THE FEE IS SCOPED TO ONE PARTICIPANT, ONE ACTIVITY, ONE ACADEMIC YEAR.
//
//   same child, same activity, second term  -> not charged again
//   same child, a different activity        -> charged
//   a sibling, any activity                 -> charged
//
// It is answerable from this participant's own registrations and nothing else —
// a prefix scan of reg-<participantId>__, which is the cheap direction of the
// key. No account aggregate, no ledger, nothing to reconcile. That is a property
// of the SCOPE rather than of the implementation: a family-level rule would have
// had to resolve every participant on the account before it could price one
// registration.
function feeApplies(priorRegistrations, seriesId, feeYear) {
  if (!seriesId || !feeYear) return true;
  return !(priorRegistrations || []).some((r) =>
    ((r.frozen || {}).seriesId) === seriesId &&
    ((r.frozen || {}).feeYear) === feeYear &&
    feeStandsOn(r));
}

// What this registration is billed, in integer cents. Euros are a display
// concern; float arithmetic drifts, and a balance that drifts is a balance
// nobody can explain.
//
// A drop-in owes the fee and nothing else at submission: its sessions are billed
// as they are attended, which is Phase 7. A course owes the fee plus the term.
function owedCentsFor(activity, feeCharged) {
  const price = (((activity || {}).facts) || {}).price || {};
  const eur = (v) => (v == null || v === '' ? 0 : Math.max(0, Math.round(Number(v) * 100)) || 0);
  const fee = feeCharged ? eur(price.registrationFee) : 0;
  const course = (activity.type || 'course') === 'course' ? eur(price.fullPrice) : 0;
  return fee + course;
}

// --- what is frozen ---------------------------------------------------------

// The inputs to the decision, captured at submission, so a later edit to the
// activity or to the participant cannot rewrite history. This is the one place
// a Blobs record depends on the shape of a git record, and freezing is what
// keeps that dependency from being live: an admin changing a price or an age
// range in March changes the activity, and every registration already taken
// keeps the terms it was taken under.
function freeze(activity, participant, groupId, flag, fee) {
  const f = ((activity || {}).facts) || {};
  const price = f.price || {};
  const group = facts.namedGroups(f.groupSize || {})
    .filter((g) => g.groupId === groupId)[0] || null;

  return {
    // Which activity and which year the fee was judged against. Frozen so the
    // decision can be re-derived and explained without reading the activity
    // back — and so moving an activity into a different series later cannot
    // retroactively change what an earlier family was billed.
    seriesId: (fee && fee.seriesId) || null,
    feeYear: (fee && fee.feeYear) || null,
    // WHICH KIND OF ACTIVITY THIS WAS WHEN THEY REGISTERED, frozen for the same
    // reason the price is. creditFor() reads it to refuse the course arithmetic
    // outright for a drop-in — and an admin switching an activity's type in
    // March must not change what a January family's cancellation is worth.
    type: (activity && activity.type) || 'course',
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
      currency: CURRENCY,
      // WHETHER THE FEE WAS BILLED ON THIS REGISTRATION, which is not derivable
      // from the fee itself. splitPaid() in _credit.js reads it: on a waived
      // registration nothing paid is fee, and taking it off the top anyway would
      // credit back the first €50 of a course payment as a fee.
      feeCharged: !!(fee && fee.charged)
    },
    // Frozen for the same reason the price is: a group renamed from "Advanced"
    // to "Level 3" in March must not rewrite what a family chose in January. The
    // groupId is what counts capacity; this is what a receipt says.
    groupName: group ? (group.name || null) : null,
    // Built by _credit.js, beside the function that reads it, so the two shapes
    // cannot drift. It carries only the sessions that are actually happening.
    //
    // ⚠ THE GROUP DECIDES WHICH SESSIONS THOSE ARE. Prorated credit divides the
    // sessions remaining by the sessions total, and where Beginners meet on
    // Mondays and Advanced on Wednesdays those are two different lists. Frozen
    // here, at submission, from the group the family actually chose — so a
    // cancellation in March is judged against the term they were sold.
    cancellation: credit.freezeCancellation(activity, groupId || null)
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
function newRegistration({ activity, participant, accountId, groupId, now, env, priorRegistrations }) {
  const at = ms(now) == null ? Date.now() : ms(now);
  const iso = new Date(at).toISOString();
  const expiry = REG.resolveExpiryDays(activity, env || process.env);
  const flag = flagFor(activity, participant, at);
  const auto = autoApproves(activity, flag);

  // Decided ONCE, here, from this participant's own prior registrations — and
  // then frozen. An admin who links this activity into another series next month
  // must not change what this family was billed today.
  const fee = {
    seriesId: seriesOf(activity),
    feeYear: feeYearOf(activity, at),
    charged: false
  };
  fee.charged = feeApplies(priorRegistrations, fee.seriesId, fee.feeYear);

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
    frozen: freeze(activity, participant, groupId || null, flag, fee),
    // ADVISORY ONLY. It annotates the queue and nothing branches on it except
    // autoApproves above, which reads it to decide whether to stand aside.
    ageFlag: flag,
    payment: {
      // Computed at submission, with the fee already decided — see feeApplies
      // above for the scope, and frozen.price.feeCharged for what was concluded
      // about this one.
      owedCents: owedCentsFor(activity, fee.charged),
      paidCents: 0,
      currency: CURRENCY,
      paidAt: null,
      status: 'owed',
      writtenOffAt: null,
      writtenOffBy: null,
      reassignedFrom: null,
      creditedCents: 0,
      // The FEE portion of whatever was credited back, kept separately because
      // the waiver reads it: a family refunded the fee and registering again is
      // paying it again. The course portion needs no such field — nothing asks
      // it a second question.
      feeCreditedCents: 0,
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
  STATUSES, CANCEL_SOURCES, CURRENCY, key, CHARGED_STATUSES, LIVE_STATUSES,
  ACADEMIC_YEAR_STARTS,
  academicYearOf, feeYearOf, seriesOf, feeStandsOn, feeApplies, owedCentsFor,
  holdsASpot, hasLapsed, countSpots, capacityReport, hasRoom,
  capacityForDate, holdsASeat, SEAT_STATUSES,
  ageCheckMoment, flagFor, autoApproves,
  freeze, submissionErrors, newRegistration, transition
};
