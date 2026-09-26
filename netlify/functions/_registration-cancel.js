// Ending a registration and recording what it earned — the one function both
// cancel paths call.
//
// A guardian's cancellation and an admin's differ in exactly two things: who did
// it, and whether the hard cutoff stops them. Everything after that point is
// identical, and it is the half involving money, so it is written once. Two
// copies of "work out the credit, write the ledger entry, stamp the
// registration" is two copies that can round differently, and the difference
// surfaces when two families compare receipts.
//
// THE ORDER IS LEDGER FIRST, REGISTRATION SECOND, and it is the opposite of the
// email rule for the opposite reason. An email not sent is a person left
// waiting; a CREDIT not written is money quietly lost, and the family has no way
// to know. So if the ledger write fails the registration is left alone and the
// whole action fails — the family still has their place and can try again. The
// reverse order would cancel them and lose the credit.
//
// The cost is a possible double credit: the ledger entry lands, the registration
// write fails, and the action is retried. That is visible in the ledger, which
// is append-only and read by a person, and it is reversible with an adjustment.
// A silently missing credit is neither.
//
// ⚠ Arms the legal gate, correctly.

const credit = require('./_credit');
const ledger = require('./_credit-ledger');
const store = require('./_registration-store');
const attendance = require('./_session-attendance');
const waitlist = require('./_waitlist');
const LST = require('./_activity-listing');
const R = require('./_registration');

const REASON = {
  guardian: 'registration-cancelled-by-guardian',
  admin: 'registration-cancelled-by-admin'
};

// ⚠ ONE EVENING, GIVEN BACK — AND THIS WAS WRITTEN TWICE BEFORE IT WAS WRITTEN
// ONCE.
//
// This file opens by saying that the guardian's cancellation and the admin's
// are one function because two copies can round differently and the difference
// surfaces when two families compare receipts. That argument is
// about a TERM, and the per-evening version of the same arithmetic had quietly
// grown two copies of its own: the family's own `cancelSession` in
// account-registrations.js, and the loop below. The admin had none at all,
// which is the gap this closes — so the third caller is what forced the
// extraction rather than a tidy-up for its own sake.
//
// The order is the module's order: creditForSession(), the ledger, then the
// record. A credit not written is money lost with nobody able to tell.
//
// ⚠ IT REFUSES ANYTHING BUT `booked`, and the refusal is the safety rather than
// a validation. `cancelled` run through here a second time would credit a
// second time, into an append-only ledger, and nothing would say so; `attended`
// is a session that happened; and `waiting` holds no seat, owes nothing and had
// no price frozen, so there is nothing here to work out — leaving an evening's
// queue is not a cancellation and is handled where it is asked for.
//
// ⚠ AND THE SEAT IS ANNOUNCED HERE, WHICH THE LOOP BELOW NEVER DID. Cancelling
// a whole drop-in registration releases every evening ahead of it, each one a
// seat somebody may be queueing for, and not one of those queues was ever told
// — the family's own single-evening cancellation announced and this did not,
// which is precisely the kind of split one function exists to make impossible.
// Guarded, because _waitlist.js's own contract is that it is best effort and
// never blocks: the record is already saved by then, so a failure here costs an
// announcement and never a cancellation. The bare `await` at the old call site
// made that stated contract false.
async function cancelOneSession(att, { by, source, note, historyNote, now }) {
  if (!att || att.status !== 'booked') {
    throw Object.assign(new Error('Only a booked evening can be cancelled'),
      { reason: 'not-booked', status: att && att.status });
  }
  const at = now == null ? Date.now() : now;
  const owed = credit.creditForSession(att, at);
  let entry = null;
  if (owed.credit > 0) {
    entry = await ledger.append({
      accountId: att.accountId,
      type: 'credit',
      amountCents: owed.credit,
      reason: REASON[source] || REASON.admin,
      // ⚠ THE SAME KIND OF MONEY THAT WAS TAKEN. Giving back a rehearsal's €7 as
      // real credit would make a test activity a way of minting money, and giving
      // back real money as test credit would lose it. It comes off the frozen
      // block rather than off the activity, so a listing switched since the
      // booking cannot change which.
      mode: LST.modeOfRecord(att),
      relatedRegistrationKey: R.key(att.participantId, att.activityId),
      // Which evening, and what decided the figure. "credited 7.00" against a
      // term somebody has five bookings on answers nothing six weeks later.
      basis: { perSession: true, sessionDate: att.sessionDate,
               startsAt: att.frozen.startsAt, cancelHours: att.frozen.cancelHours,
               paidCents: att.payment.paidCents, reason: owed.reason },
      note: note || null, createdAt: at, createdBy: by || null
    });
  }
  const next = attendance.transition(att, {
    status: 'cancelled', by: by, note: historyNote || null
  });
  next.payment = Object.assign({}, next.payment, {
    creditedCents: (next.payment.creditedCents || 0) + owed.credit,
    creditedToAccountId: owed.credit > 0 ? att.accountId : next.payment.creditedToAccountId,
    status: owed.credit > 0 ? 'credited' : next.payment.status
  });
  await attendance.saveAttendance(next);
  // ⚠ THIS EVENING'S QUEUE, NOT THE ACTIVITY'S. Waiting for Tuesday says
  // nothing about Thursday — the room is per date and so is the list.
  try {
    await waitlist.seatOpened(att.activityId, att.sessionDate);
  } catch (e) { /* the seat is already free; the announcement is not the seat */ }
  return { session: next, credit: owed, entry: entry };
}

// Cancelling a DROP-IN registration credits nothing and instead releases the
// evenings that have not happened yet, each judged on its own deadline.
//
// There is no upfront commitment to unwind: a family that stops coming has
// cancelled nothing and simply owes nothing further. What they may still be owed
// is money for sessions they booked and paid for and are now giving back in
// time — which is a per-session question, not a per-term one, so it is asked
// once per booking rather than answered once for the lot.
//
// Only `booked` sessions are touched. One already `attended` is not undone by a
// registration ending, and one already `cancelled` must not be cancelled twice —
// which on an append-only ledger would mean crediting it twice.
async function releaseFutureSessions(reg, { by, source, at, note }) {
  const rows = (await attendance.forParticipant(reg.participantId, reg.activityId))
    .filter((a) => a.status === 'booked');
  const out = [];
  for (const att of rows) {
    const done = await cancelOneSession(att, {
      by: by, source: source, note: note, historyNote: 'registration ended', now: at
    });
    out.push({ sessionDate: att.sessionDate, credit: done.credit.credit, entry: done.entry });
  }
  return out;
}

// ⚠ THERE IS NO `entitled` PARAMETER ANY MORE, and its removal is the rule.
//
// It let the caller zero a credit, and existed because the two paths genuinely
// differed: past the hard cutoff a guardian could not cancel AT ALL, while an
// admin could and credited nothing. The cutoff now ends the credit for both and
// stops neither — a family who is not coming back has to be able to say so, and
// the per-evening path has always worked that way. So `entitled` had one
// possible value, and a parameter that can only be true is a policy nobody can
// read. The zero comes from creditFor(), which is the only thing that should
// ever have been deciding it.
async function cancelAndCredit(reg, { by, source, note, now }) {
  const at = now == null ? Date.now() : now;
  // ⚠ THE YEAR'S FEE OUTLIVES ONE TERM OF IT, so the credit needs one fact that
  // is not on this record: whether another term of this academic year is still
  // standing on the fee that was paid here. The scan is the cheap direction of
  // the key — reg-<participantId>__ — and it is the same one the waiver itself
  // makes at submission.
  //
  // It is the CALLER'S to supply for the same reason the clock is: _credit.js
  // reads one record and one timestamp and opens no store.
  const siblings = await store.forParticipant(reg.participantId);
  const opts = { feeHeldElsewhere: R.feeHeldByLiveTerm(reg, siblings) };
  const owed = credit.creditFor(reg, at, opts);
  const basis = credit.basisFor(reg, at, opts);
  const total = owed.total;

  // THE DROP-IN PATH, and it is a branch here rather than a second function so
  // that "one function both cancel paths call" stays true — the guardian's
  // cancellation and the admin's still differ in exactly two things, and the
  // type is not one of them.
  //
  // creditFor() has already refused the course arithmetic for a drop-in and
  // returned zero, so `total` is zero below and no term-level ledger entry is
  // written. What money moves, moves one evening at a time.
  let sessions = null;
  if ((reg.frozen || {}).type === 'dropin') {
    sessions = await releaseFutureSessions(reg, { by: by, source: source, at: at, note: note });
  }

  let entry = null;
  if (total > 0) {
    // The account that SUBMITTED, which is the one the record names as owing and
    // therefore the one that paid. Not the guardian doing the cancelling: a
    // second guardian ending a registration does not thereby acquire its credit.
    entry = await ledger.append({
      accountId: reg.accountId,
      type: 'credit',
      amountCents: total,
      reason: REASON[source] || REASON.admin,
      mode: LST.modeOfRecord(reg),
      relatedRegistrationKey: R.key(reg.participantId, reg.activityId),
      basis: basis,
      note: note || null,
      createdAt: at,
      createdBy: by || null
    });
  }

  const next = R.transition(reg, { status: 'cancelled', by: by, source: source, note: note, now: at });
  next.payment = Object.assign({}, next.payment, {
    creditedCents: ((next.payment || {}).creditedCents || 0) + total,
    // The FEE portion, kept apart because the waiver reads it: a family refunded
    // the fee and registering again for the same activity is paying it again.
    feeCreditedCents: ((next.payment || {}).feeCreditedCents || 0) + owed.feeCredit,
    creditedToAccountId: total > 0 ? reg.accountId : ((next.payment || {}).creditedToAccountId || null),
    status: total > 0 ? 'credited' : (next.payment || {}).status
  });
  await store.saveRegistration(next);
  return { registration: next, credit: owed, entry: entry, basis: basis, sessions: sessions };
}

module.exports = { cancelAndCredit, releaseFutureSessions, cancelOneSession, REASON };
