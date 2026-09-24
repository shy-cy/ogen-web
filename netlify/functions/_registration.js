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
const groups = require('./_activity-groups');

// Five, and deliberately five. `rejected` and `expired` and `cancelled` are all
// "does not hold a spot", but they are different things that happened and the
// record is kept for each — a cancellation is an event, not an absence.
// ⚠ SIX NOW, AND THE SIXTH HOLDS NOTHING. `waitlisted` is somebody who asked
// for a place that was already taken. It is the same record in the same key —
// one participant, one activity, one blob — because a family who waits and is
// then given a place is one story, and two rows for it would read as two
// children on two places.
//
// It is deliberately NOT counted by holdsASpot(), which is what makes the whole
// feature safe to add: capacity is counted and never decremented, so a status
// the count does not recognise cannot affect a number. Nothing else in the
// arithmetic changed.
const STATUSES = ['pending', 'approved', 'rejected', 'expired', 'cancelled', 'waitlisted'];

// How long a place claimed off a waiting list is held before it lapses.
//
// ⚠ IT IS SHORT ON PURPOSE, and shortness is the whole point of it. An ordinary
// registration holds its place for 45 days because nobody is queueing for it. A
// place claimed while other families are waiting is the opposite case: the
// reason this feature exists is that unpaid holds were keeping everyone else
// out, so handing the claimer the ordinary window would rebuild the problem one
// layer up.
//
// Lapsing needs no job. holdsASpot() reads the deadline, so the place is free
// the instant it passes — the nightly sweep only tidies the wording afterwards,
// exactly as it has always done for an ordinary expiry.
const CLAIM_HOURS = 48;

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

// Is this family in the queue rather than in the class? One word, in one place,
// so no screen has to remember which status string means waiting.
const isWaiting = (reg) => !!reg && reg.status === 'waitlisted';

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
// ⚠ AND A DROP-IN HAS NO ACTIVITY-LEVEL CAPACITY AT ALL, which is a rule about
// the ROOM rather than a rule about the screen.
//
// Registering for a drop-in is deliberately uncapped — `submit` guards on
// `activity.type !== 'dropin'` before it asks hasRoom(), because counting
// registrations against the room once refused the twenty-first family on an
// activity that was never more than half full on the night, with a refusal
// reading "this activity is full" that was untrue of every actual evening.
// Forty can be registered and eight turn up.
//
// So the number stored in facts.groupSize governs capacityForDate() and nothing
// else here. Reporting it beside a count that is deliberately uncapped produced
// "4 of 3 places — Over capacity" on the admin roster: the count was right, the
// limit was right, and putting them in one sentence was wrong. It looked like a
// policy being ignored and was a screen asking a course's question.
//
// Answered in the module that owns the rule rather than by each reader, for the
// same reason offersAChoice() is: activityView() was already writing
// `type === 'dropin' ? null : report.capacity` at its own call site, and one
// copy of a rule is how the other copy comes to disagree.
function capacityReport(activity, regs, now) {
  const named = groups.groupList(activity);
  const counts = countSpots(regs, now);
  const perSession = (activity && activity.type) === 'dropin';
  const capacity = perSession ? null : groups.totalCapacity(activity);

  // ⚠ WITH ONE GROUP, A REGISTRATION THAT NAMES NO GROUP BELONGS TO IT.
  //
  // Every registration taken while an activity was pooled carries `groupId:
  // null`. Once every activity has a group, bucketing strictly by id would file
  // all of them under "unassigned" and show the one group at nought taken — a
  // class that is full reporting as empty, with nothing erroring and nobody
  // finding out until somebody turned up to a room with no chair. With exactly
  // one group there is only one honest answer, so they are counted into it.
  //
  // With two or more there is not: nobody knows which group they are in, and
  // inventing one would be worse than leaving the row short. Those stay in
  // `unassigned`, appear in `taken`, and belong to no row — which is why the
  // rows deliberately do not sum to the total.
  const sole = groups.soleGroup(activity);
  const unassigned = counts.byGroup[''] || 0;

  const rows = named.map((g) => {
    const cap = perSession || g.capacity == null || g.capacity === '' ? null : Number(g.capacity);
    const has = cap != null && isFinite(cap) && cap > 0 ? cap : null;
    const taken = (counts.byGroup[g.groupId] || 0) +
                  (sole && sole.groupId === g.groupId ? unassigned : 0);
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
    // Which question this report is answering, said out loud rather than left
    // for a reader to infer from a null. A screen showing a drop-in has to say
    // something different from "no limit set", which on a course means somebody
    // never finished filling the activity in — here it is the design.
    perSession: perSession,
    // Stated plainly rather than pretended impossible. Two submissions arriving
    // together both read "one spot left" and both write; the window is a few
    // hundred milliseconds and there is no atomic increment to close it. The
    // admin list says "23 / 20 — over capacity" and an admin rejects the
    // surplus, which is a smaller problem than a lost counter update.
    over: capacity != null && counts.taken > capacity,
    // Counted into the sole group above, so there is nothing left over to
    // report. Kept as a field because the multi-group case still has some.
    unassigned: sole ? 0 : unassigned,
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
function capacityForDate(activity, attendances, sessionDate, now) {
  const capacity = groups.totalCapacity(activity);
  const held = (attendances || []).filter(
    (a) => a && a.sessionDate === sessionDate && holdsASeat(a, now));
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
// on their own record. `waiting` is somebody in the queue for that evening, and
// holds nothing at all.
const SEAT_STATUSES = ['booked', 'attended'];

// ⚠ A SEAT CLAIMED OFF A WAITING LIST IS HELD ONLY WHILE ITS CLOCK IS RUNNING,
// and this is the one genuinely new counting rule the waiting list needed.
//
// An evening can free up thirty minutes before the class, and the queue for it
// then has minutes rather than days. No job can release a seat fifteen minutes
// from now — the sweep runs nightly — but nothing has to, because a seat is
// COUNTED and never decremented: the moment the deadline passes the record
// stops being counted, and the seat is genuinely free, with nothing having run.
//
// That is exactly the shape holdsASpot() has had since Phase 4 for a pending
// registration, at a different speed, and the three details are the same three:
//
//   - no deadline stamped means an ORDINARY booking, which holds its seat. Only
//     a claim carries one, so absent must not read as lapsed;
//   - anything PAID holds its seat for good. The deadline exists to stop an
//     unpaid claim sitting on a place other families are queueing for, and once
//     the money is in there is nothing left to enforce;
//   - `attended` is above all of it. Somebody who came was in the room, whatever
//     any clock says now.
function holdsASeat(att, now) {
  if (!att) return false;
  if (att.status === 'attended') return true;
  if (att.status !== 'booked') return false;
  const until = ms(att.claimExpiresAt);
  if (until == null) return true;
  if (((att.payment || {}).paidCents || 0) > 0) return true;
  return (ms(now) == null ? Date.now() : ms(now)) < until;
}

// How long a seat claimed off an evening's waiting list is held.
//
// ⚠ FIFTEEN, NOT FIVE, and the asymmetry is the argument. Checkout with a
// mistyped card or a bank's 3-D Secure prompt takes a couple of minutes, and
// the worst outcome this rule can produce is an honest payer losing their seat
// WHILE TYPING THEIR CARD NUMBER. Too long merely delays the next family.
const CLAIM_MINUTES = 15;

// ⚠ AND NEVER PAST THE START. A seat freeing six minutes before the class gives
// six minutes, not fifteen: holding it into the lesson would keep the room shut
// against a family who could still walk in, which is the whole thing this
// feature exists to stop happening.
function sessionClaimDeadline(startsAt, now, minutes) {
  const at = ms(now) == null ? Date.now() : ms(now);
  const mins = minutes == null ? CLAIM_MINUTES : Number(minutes);
  const window = at + Math.max(0, mins) * 60 * 1000;
  const starts = ms(startsAt);
  return new Date(starts == null ? window : Math.min(window, starts)).toISOString();
}

// Is there room for one more, in the group they asked for?
function hasRoom(report, groupId) {
  if (report.named) {
    // ⚠ ONE ROW ANSWERS FOR A CALLER THAT NAMED NO GROUP. Every activity has a
    // group now, so `report.named` is always populated and a strict id match
    // would refuse every registration that did not name one — which on a
    // single-group activity is every registration, because the family was never
    // asked. With one row there is one answer; with several, a caller that named
    // nothing is refused, which is what submissionErrors already told them.
    const row = report.named.filter((r) => r.groupId === groupId)[0] ||
                (report.named.length === 1 ? report.named[0] : null);
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
// ⚠ THE START DATE AND THE AGE RANGE ARE BOTH THE GROUP'S NOW. Two groups under
// one activity can genuinely begin on different days and be pitched at different
// ages — that is the whole point of the restructuring — so an age checked
// against "the activity's" range is an age checked against nobody's. The group
// is resolved the way everything else resolves it: named, or the sole group when
// there is one, or (on a multi-group activity with no group chosen, which
// submissionErrors refuses anyway) nothing to check.
function ageCheckMoment(activity, now, groupId) {
  const start = (groups.factFor(activity, 'duration', groupId) || {}).startDate;
  const t = credit.parseDateParts(start) ? credit.resolveLocal(start, '', credit.TZ) : null;
  return t == null
    ? { at: ms(now) == null ? Date.now() : ms(now), against: 'submission' }
    : { at: t, against: 'activity-start' };
}

function flagFor(activity, participant, now, groupId) {
  const when = ageCheckMoment(activity, now, groupId);
  const ages = groups.factFor(activity, 'ages', groupId) || {};
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
function feeYearOf(activity, now, groupId) {
  const start = (groups.factFor(activity, 'duration', groupId) || {}).startDate;
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
//   THE FEE IS SCOPED TO ONE PARTICIPANT AND ONE SERIES. The academic year is
//   the boundary for a SINGLE activity, and is not a boundary between two terms
//   an admin deliberately linked.
//
//   same child, same activity, second term of one year  -> not charged again
//   same child, a LINKED later term, ANY year           -> not charged again
//   same child, the same activity again in a new year   -> charged
//   same child, a different activity                    -> charged
//   a sibling, any activity                             -> charged
//
// ⚠ WHY THE YEAR SURVIVES FOR ONE ACTIVITY AND NOT BETWEEN TWO.
//
// Asked for as "if a course is marked that it is part of another course,
// whether it's the same year or another year, the registration fee should be
// omitted". The marking is what triggers it, and the marking is `seriesId` —
// the "Part of" select, which points one term at another.
//
// So the test is not a flag on the record being registered for. `seriesOf()`
// DEFAULTS to the activity's own id, so every activity is a series of one and
// "does this carry a seriesId" cannot tell a linked first term from an unlinked
// one — the first term of a series is usually the pointer TARGET and carries
// nothing itself. What is reliably true is the pair: two DIFFERENT activityIds
// resolving to one seriesId can only have got there because somebody linked
// them. That is "marked as part of another course", read off the registrations
// rather than off a field that means two things.
//
// Same activity, a second year, is therefore still charged: nobody marked it as
// part of anything, and re-running one course next year is a new year of it.
//
// It is answerable from this participant's own registrations and nothing else —
// a prefix scan of reg-<participantId>__, which is the cheap direction of the
// key. No account aggregate, no ledger, nothing to reconcile. That is a property
// of the SCOPE rather than of the implementation: a family-level rule would have
// had to resolve every participant on the account before it could price one
// registration.
function feeApplies(priorRegistrations, seriesId, feeYear, activityId) {
  if (!seriesId) return true;
  return !(priorRegistrations || []).some((r) => {
    if (((r.frozen || {}).seriesId) !== seriesId) return false;
    if (!feeStandsOn(r)) return false;
    // A DIFFERENT term of the same series: linked on purpose, so the year is not
    // a boundary. This is the whole of the change.
    if (activityId && r.activityId && r.activityId !== activityId) return true;
    // The same activity again. Absent either year the answer is "a different
    // year", which charges — the one place in this file where a blank resolves
    // AWAY from the family, and it does so because the alternative is waiving a
    // fee on the strength of a field nobody filled in.
    return !!feeYear && ((r.frozen || {}).feeYear) === feeYear;
  });
}

// ⚠ AND THE WAIVER ONLY EVER LOOKED BACKWARDS.
//
// feeStandsOn() asks, of a NEW registration, whether this child has already been
// charged the fee for this series this year. That half is right and it already
// closes the mirror-image hole: refund the fee and a third term is charged
// again, because `cancelled` counts only while the fee was paid and not given
// back.
//
// Nothing looked FORWARDS from a cancellation at the registrations that were
// waived because of it. So:
//
//   autumn  registered, fee charged, paid
//   spring  registered, fee WAIVED — autumn stands
//   autumn  cancelled before its cutoffs -> the fee comes back in full
//
// and the family attends the spring term having paid no registration fee at all
// for that academic year. The waiver was decided once, at submission, and the
// condition it rested on disappeared afterwards with nothing watching.
//
// This is the question the other direction: is the fee this registration paid
// still doing its job for a term the family is STILL IN? If it is, cancelling
// this one must not hand it back — the fee is charged once a year for this
// activity, and the year is still live.
//
// Three conditions, and each one is load-bearing:
//
//   - this registration must be the one the fee was billed on. A registration
//     whose own fee was waived has no fee to withhold — splitPaid() already
//     returns nought for it — and asking anyway would be a flag that means
//     nothing.
//   - the other registration must be LIVE. A cancelled or expired sibling is
//     not relying on anything.
//   - ⚠ and the other registration's own fee must have been WAIVED. Two live
//     terms each charged their own fee is not this situation: that sibling
//     carries its own, so withholding here would take €50 from a family who
//     owes nothing. It arises the moment a refunded fee is charged again on a
//     third term, which is exactly the case feeStandsOn() already handles.
//
// Deliberately NOT a rule about who caused what. A year with three terms, one
// charged and two waived, answers the same way for each of the two: while any
// waived term is still standing, the fee that covers it stays paid.
// ⚠ AND IT ASKS NO YEAR, BECAUSE IT ONLY EVER LOOKS AT A DIFFERENT TERM.
//
// `r.activityId !== reg.activityId` is already in the test, so every sibling
// this can find is a linked term — exactly the case feeApplies() now waives
// across years. Leaving a feeYear condition here would put the two halves of
// one rule out of step in the direction that costs a family money: a spring
// term waived on the strength of last autumn's fee, the autumn then cancelled,
// and the fee handed back in full while the spring term goes on leaning on it.
// That is the loophole this function exists to close, moved one year over.
function feeHeldByLiveTerm(reg, siblings) {
  const frozen = (reg || {}).frozen || {};
  if (((frozen.price || {}).feeCharged) === false) return false;
  const seriesId = frozen.seriesId;
  // A registration written before the waiver existed has no series, and nothing
  // about it can be relying on anything.
  if (!seriesId) return false;
  return (siblings || []).some((r) =>
    r &&
    r.activityId !== reg.activityId &&
    ((r.frozen || {}).seriesId) === seriesId &&
    ((((r.frozen || {}).price) || {}).feeCharged) === false &&
    LIVE_STATUSES.indexOf(r.status) !== -1);
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
  const group = groups.resolveGroup(activity, groupId);

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

// ⚠ KEYS, NOT SENTENCES. This returned English prose, which put one language's
// copy inside a pure rule module. This module has no reader — it is given an
// activity and a participant and asked what is wrong — so there is nothing here
// that could know which language to answer in, and the prose was English
// because whoever wrote it was. It names the refusal; whoever asked renders it,
// out of _family-errors.js, in the language of the page that asked.
function submissionErrors(activity, participant, groupId) {
  const errors = [];
  if (!activity) { errors.push('no-such-activity'); return errors; }
  if (!participant) { errors.push('no-such-participant'); return errors; }
  if (activity.status !== 'open') {
    errors.push('registration-not-open');
  }
  // ⚠ THE COUNT DECIDES WHETHER A FAMILY IS ASKED, not whether the groups are
  // named. Every activity has at least one group now, so the old test — "does
  // this activity name any groups" — would put a one-option picker in front of
  // every family on the site and refuse every submission that did not answer it.
  //
  // With one group there is nothing to choose and the group is assigned
  // silently. With two or more the family picks, and a pick that names no group
  // of this activity is refused rather than quietly reassigned.
  const list = groups.groupList(activity);
  if (list.length > 1) {
    if (!groupId) errors.push('group-required');
    else if (!list.some((g) => g.groupId === groupId)) errors.push('no-such-group');
  } else if (groupId && !list.some((g) => g.groupId === groupId)) {
    errors.push('no-groups-to-choose');
  }
  return errors;
}

// The group a submission is actually recorded against. With one group the family
// was never asked, so the answer is that group rather than the null they sent —
// which is what keeps the capacity count, the frozen calendar and the roster all
// pointing at the same thing from the first registration onwards.
function groupIdFor(activity, groupId) {
  if (groupId) return groupId;
  const sole = groups.soleGroup(activity);
  return sole ? sole.groupId : null;
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
// ⚠ `waiting` AND `claim` ARE THE TWO WAYS IN THAT ARE NOT AN ORDINARY
// SUBMISSION, and both go through this one builder rather than beside it.
//
//   waiting  the activity was full, so this is an expression of interest. It
//            holds no place, owes nothing and never lapses.
//   claim    a place has opened and this family got to it first. An ordinary
//            registration in every respect except the deadline, which is hours
//            rather than weeks.
//
// A waiting entry still freezes, and that is worth saying because it looks
// wasteful: the admin's list needs the name, the date of birth and the age flag
// to be of any use, and those are exactly what freeze() captures. What it must
// NOT do is let a family agree to a price months before they are offered a
// place — so a claim runs this builder AGAIN, over the same record, and the
// terms that bind are the ones true at the moment the place was taken.
function newRegistration({ activity, participant, accountId, groupId, now, env,
                           priorRegistrations, waiting, claim }) {
  const at = ms(now) == null ? Date.now() : ms(now);
  const iso = new Date(at).toISOString();
  const expiry = claim
    ? { days: CLAIM_HOURS / 24, source: 'waitlist-claim' }
    : REG.resolveExpiryDays(activity, env || process.env);
  // ⚠ RESOLVED ONCE, HERE, AND USED FOR EVERYTHING AFTER IT. With one group the
  // family was never asked, so the null they sent becomes that group's id before
  // anything is frozen against it — the age range, the start date, the calendar
  // and the capacity count are all per-group now, and a registration that knows
  // its group from the first line cannot end up freezing one group's terms under
  // another group's roster.
  const gid = groupIdFor(activity, groupId);
  const flag = flagFor(activity, participant, at, gid);
  const auto = autoApproves(activity, flag);

  // Decided ONCE, here, from this participant's own prior registrations — and
  // then frozen. An admin who links this activity into another series next month
  // must not change what this family was billed today.
  const fee = {
    seriesId: seriesOf(activity),
    feeYear: feeYearOf(activity, at, gid),
    charged: false
  };
  fee.charged = feeApplies(priorRegistrations, fee.seriesId, fee.feeYear,
                           activity.activityId);

  return {
    participantId: participant.participantId,
    activityId: activity.activityId,
    // WHO OWES. The account that submitted, not the participant and not the
    // primary guardian — a second guardian who registers a child is the one the
    // bill and the credit belong to.
    accountId: accountId,
    groupId: gid,
    status: waiting ? 'waitlisted' : auto ? 'approved' : 'pending',
    submittedAt: iso,
    // ⚠ NULL WHILE WAITING, and that is not the same as "no deadline stamped".
    // holdsASpot() reads an unstamped deadline on a PENDING record as "hold the
    // place", because an unstamped record is a bug in the writer. A waitlisted
    // record never reaches that line at all — it is not pending — so null here
    // means what it says: nothing is being held, so nothing has to run out.
    expiresAt: waiting
      ? null
      : new Date(at + expiry.days * 24 * 60 * 60 * 1000).toISOString(),
    expiryDays: expiry.days,
    expirySource: expiry.source,
    decidedAt: auto ? iso : null,
    decidedBy: null,
    autoApproved: auto,
    expiredAt: null,
    cancelledAt: null,
    cancelledBy: null,
    cancelSource: null,
    frozen: freeze(activity, participant, gid, flag, fee),
    // ADVISORY ONLY. It annotates the queue and nothing branches on it except
    // autoApproves above, which reads it to decide whether to stand aside.
    ageFlag: flag,
    // When this family joined the queue, which is the order the admin's list is
    // read in and the only thing a waiting entry is really about. Kept on the
    // record after a claim, so "waited three weeks" survives getting a place.
    waitingSince: waiting ? iso : null,
    payment: {
      // Computed at submission, with the fee already decided — see feeApplies
      // above for the scope, and frozen.price.feeCharged for what was concluded
      // about this one. ⚠ NOUGHT WHILE WAITING: a queue is not a bill, and an
      // admin's roster showing "€0.00 / €55.00 OWED" against somebody who has
      // no place would be the screen inventing a debt.
      owedCents: waiting ? 0 : owedCentsFor(activity, fee.charged),
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
  CLAIM_HOURS, isWaiting,
  ACADEMIC_YEAR_STARTS,
  academicYearOf, feeYearOf, seriesOf, feeStandsOn, feeApplies, feeHeldByLiveTerm,
  owedCentsFor,
  holdsASpot, hasLapsed, countSpots, capacityReport, hasRoom,
  capacityForDate, holdsASeat, SEAT_STATUSES, CLAIM_MINUTES, sessionClaimDeadline,
  ageCheckMoment, flagFor, autoApproves,
  freeze, submissionErrors, groupIdFor, newRegistration, transition
};
