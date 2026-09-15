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
const R = require('./_registration');

const REASON = {
  guardian: 'registration-cancelled-by-guardian',
  admin: 'registration-cancelled-by-admin'
};

// `entitled` is the caller's decision, not this function's. A guardian past the
// hard cutoff cannot cancel at all; an ADMIN past it still can, and credits
// nothing — a child has to be removable in week nine for a reason that is not
// about money. Passing it in keeps that policy where the two paths differ.
async function cancelAndCredit(reg, { by, source, note, now, entitled }) {
  const at = now == null ? Date.now() : now;
  const owed = credit.creditFor(reg, at);
  const basis = credit.basisFor(reg, at);
  const total = entitled === false ? 0 : owed.total;

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
    feeCreditedCents: ((next.payment || {}).feeCreditedCents || 0) +
      (entitled === false ? 0 : owed.feeCredit),
    creditedToAccountId: total > 0 ? reg.accountId : ((next.payment || {}).creditedToAccountId || null),
    status: total > 0 ? 'credited' : (next.payment || {}).status
  });
  await store.saveRegistration(next);
  return { registration: next, credit: owed, entry: entry, basis: basis };
}

module.exports = { cancelAndCredit, REASON };
