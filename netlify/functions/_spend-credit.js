// Spending credit — the one place it happens, for a registration or for one
// session, and whoever is asking.
//
// ⚠ IT EXISTS BECAUSE THERE ARE TWO CALLERS NOW. An admin could apply a credit
// from the Roster since Phase 5; a family could not do anything with theirs at
// all. Cancelling in time wrote a line in the ledger, the dashboard showed a
// balance, and there was no action anywhere that could turn it back into a paid
// place — so "it comes back as credit" was true and useless.
//
// Two copies of this would be two copies that can round differently, cap
// differently, or write the two halves in a different order, and the difference
// surfaces when a family reads their balance to an admin reading theirs.
//
// ⚠ THE LEDGER IS WRITTEN FIRST, which is the opposite of the rule for a CREDIT
// and right for the same reason. A debit that lands without the payment is
// visible in an append-only record a person reads, and is reversible with an
// adjustment. A payment that lands without the debit is credit spent twice, and
// nothing anywhere says so.
//
// ⚠ It does NOT arm the legal gate, and that is right rather than an oversight:
// it opens no store of its own. The ledger, the registrations and the attendance
// register each arm it where they are declared, and this moves money between
// records they hold. Claiming it here would be a marker on a file that holds
// nobody's data — which is the same mistake five other files in this directory
// were making in the other direction, each asserting it armed a gate whose store
// list had never heard of them.

const ledger = require('./_credit-ledger');
const LST = require('./_activity-listing');
const R = require('./_registration');
const attendance = require('./_session-attendance');
const store = require('./_registration-store');

const owingOn = (record) => {
  const p = (record && record.payment) || {};
  return Math.max(0, (p.owedCents || 0) - (p.paidCents || 0));
};

// What may usefully be spent on this record: never more than is owed, and never
// more than the account holds.
//
// ⚠ CAPPED AT WHAT IS OWED, which the admin's version did not do. Credit paid
// beyond a debt is not a payment, it is credit deleted — it leaves the record
// reading "paid" by more than it cost and the balance lower with nothing to
// show for the difference. A genuine correction is `adjustCredit`, which writes
// a line saying what it was for.
function spendable(record, balanceCents) {
  return Math.min(owingOn(record), Math.max(0, balanceCents || 0));
}

// `kind` decides which store the record goes back to and nothing else: the two
// carry the same payment vocabulary deliberately, so everything between the
// ledger write and the save is shared.
async function spendCredit({ record, kind, cents, by, note }) {
  const amount = Math.round(Number(cents));
  if (!(amount > 0)) {
    throw Object.assign(new Error('An amount is a positive number of cents'), { reason: 'amount' });
  }
  // ⚠ CROSS-MODE SPENDING IS REFUSED BY CONSTRUCTION, NOT BY A CHECK.
  //
  // The mode is the RECORD'S — frozen onto it when the place was taken — and the
  // balance is asked for in that mode alone. So a rehearsal's €50 credit is not
  // in the balance a real registration is measured against, and there is no
  // branch anywhere that has to remember to exclude it. An account holding both
  // simply has two balances, and neither can pay the other's debt.
  //
  // The refusal an account meets is therefore the ordinary `insufficient` one,
  // carrying the balance IN THIS MODE — which is the honest figure: what is held
  // against this debt really is nothing.
  const mode = LST.modeOfRecord(record);
  const balance = await ledger.balanceFor(record.accountId, mode);
  if (amount > balance) {
    throw Object.assign(new Error('That is more than this account holds'),
      { reason: 'insufficient', balanceCents: balance, mode: mode });
  }
  const owed = owingOn(record);
  if (amount > owed) {
    throw Object.assign(new Error('That is more than is owed on this'),
      { reason: 'over-paying', owedCents: owed });
  }

  const key = R.key(record.participantId, record.activityId);
  const entry = await ledger.append({
    accountId: record.accountId, type: 'debit', amountCents: amount,
    reason: 'credit-applied', mode: mode,
    relatedRegistrationKey: key,
    // Which evening, when it is one. The ledger line is what a family is read
    // back six weeks later, and "credit applied" against a term they have five
    // bookings on answers nothing.
    basis: kind === 'session' ? { perSession: true, sessionDate: record.sessionDate } : null,
    note: note || null, createdBy: by
  });

  const paid = (record.payment.paidCents || 0) + amount;
  const transition = kind === 'session' ? attendance.transition : R.transition;
  const next = transition(record, {
    status: record.status, by: by, note: 'credit applied ' + amount + 'c'
  });
  next.payment = Object.assign({}, next.payment, {
    paidCents: paid,
    paidAt: new Date().toISOString(),
    // WHICH KIND OF MONEY HAS BEEN TAKEN ON THIS RECORD, stamped by every payment
    // path. It can only ever be the mode the record was sold in, which is why
    // there is nothing to check here — see paymentModeRefusal(), which the paths
    // that receive a mode from OUTSIDE (the webhook, the desk) do have to ask.
    mode: mode,
    // `owed` until it covers what was billed — the same rule every other payment
    // path follows, because a part payment reading as settled is a debt nobody
    // chases.
    status: next.payment.owedCents != null && paid >= next.payment.owedCents ? 'paid' : 'owed'
  });

  if (kind === 'session') await attendance.saveAttendance(next);
  else await store.saveRegistration(next);

  return { record: next, entry: entry, balanceCents: balance - amount,
           spentCents: amount, mode: mode };
}

module.exports = { spendCredit, spendable, owingOn };
