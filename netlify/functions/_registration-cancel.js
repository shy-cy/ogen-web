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
const R = require('./_registration');

const REASON = {
  guardian: 'registration-cancelled-by-guardian',
  admin: 'registration-cancelled-by-admin'
};

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
    const owed = credit.creditForSession(att, at);
    let entry = null;
    if (owed.credit > 0) {
      entry = await ledger.append({
        accountId: att.accountId,
        type: 'credit',
        amountCents: owed.credit,
        reason: REASON[source] || REASON.admin,
        relatedRegistrationKey: R.key(reg.participantId, reg.activityId),
        basis: { perSession: true, sessionDate: att.sessionDate,
                 startsAt: att.frozen.startsAt, cancelHours: att.frozen.cancelHours,
                 paidCents: att.payment.paidCents, reason: owed.reason },
        note: note || null, createdAt: at, createdBy: by || null
      });
    }
    const next = attendance.transition(att, {
      status: 'cancelled', by: by, note: 'registration ended'
    });
    next.payment = Object.assign({}, next.payment, {
      creditedCents: (next.payment.creditedCents || 0) + owed.credit,
      creditedToAccountId: owed.credit > 0 ? att.accountId : next.payment.creditedToAccountId,
      status: owed.credit > 0 ? 'credited' : next.payment.status
    });
    await attendance.saveAttendance(next);
    out.push({ sessionDate: att.sessionDate, credit: owed.credit, entry: entry });
  }
  return out;
}

async function cancelAndCredit(reg, { by, source, note, now }) {
  const at = now == null ? Date.now() : now;
  const owed = credit.creditFor(reg, at);
  const basis = credit.basisFor(reg, at);
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

module.exports = { cancelAndCredit, releaseFutureSessions, REASON };
