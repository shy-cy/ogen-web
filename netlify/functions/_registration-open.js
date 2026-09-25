const R = require('./_registration');
const store = require('./_registration-store');

// What a registration IS the moment it is opened -- and the ONE place one is
// created.
//
// It was a private function in account-registrations.js, called by `submit` and
// by the drop-in's one-step `bookAndPay`, with a comment saying why there is
// only one: "two copies would be two places the fee waiver, the capacity rule
// and the carried-forward history could quietly drift apart."
//
// ⚠ IT IS OUT HERE BECAUSE THE ADMIN NOW OPENS ONE TOO. Giving somebody a
// place off the waiting list is the same act a family performs by claiming
// one -- the terms are re-frozen, the fee waiver and the age check are
// re-decided, the room is checked again, and the hold is HOURS rather than
// weeks. Written a second time in the admin handler, every one of those could
// have been got subtly wrong in a way that only shows up when two families
// compare receipts. Requiring account-registrations.js from the admin instead
// was the other option and is worse: it pulls in Stripe, Checkout, the bundle
// store and the mailer, into a handler with ten seconds to answer in.
//
// It opens the registration store, so it arms the legal gate, correctly.

// Three callers now: `submit`, the drop-in's `bookAndPay`, and the admin's
// `givePlace`.
//
// It returns the record rather than a response, because the two callers answer
// differently about the ONE case they genuinely disagree on: a registration
// that already holds a place is a refusal to `submit` and is simply the
// registration to book against for `bookAndPay`.
// ⚠ `waitlist` SAYS WHAT TO DO IF IT IS FULL, not what to do. A family pressing
// "join the waiting list" on an activity where a place has appeared in the
// meantime wants the place, so they get it — the flag chooses between a refusal
// and a queue, and never between a place and a queue.
//
// ⚠ AND CLAIMING IS NOT AN ACTION. Whether this is somebody taking a place off
// the waiting list is read from the record that is already there, rather than
// from anything the client sends: a family who was queueing and is now
// registering IS claiming, by definition. So there is no claim endpoint to
// forget, no flag a hostile client can set to buy itself the ordinary 45-day
// hold, and the emailed link can simply point at the page with the Register
// button already on it.
async function openRegistration({ activity, participant, accountId, groupId, waitlist }) {
  // ⚠ KEYS, NOT SENTENCES. This function has no language — it is called from
  // two actions and knows nothing about who is reading — so it names the
  // refusal and the handler renders it. `errors` still travels whole, because
  // a form showing every problem at once beats one showing them one at a time.
  const errors = R.submissionErrors(activity, participant, groupId);
  if (errors.length) return { status: 400, key: errors[0], extra: { errors: errors } };

  const existing = await store.getRegistration(participant.participantId, activity.activityId);
  if (existing && R.holdsASpot(existing)) return { reg: existing, already: true };
  const claiming = R.isWaiting(existing);

  // ⚠ A DROP-IN REGISTRATION IS NOT CAPPED BY THE SIZE OF THE ROOM.
  //
  // For a course the two are the same question: a place is held for the whole
  // term, so registrations and seats are one count. For a drop-in they are not.
  // The room holds twenty on Tuesday; forty families can be registered and eight
  // turn up. Counting registrations against the room refused the twenty-first
  // family from ever registering, on an activity that was never more than half
  // full on the night — and the refusal read as "this activity is full", which
  // was untrue of every actual evening.
  //
  // The capacity that matters for a drop-in is per date, and it is checked where
  // it belongs: in bookSession and in bookAndPay.
  const regs = await store.forActivity(activity.activityId);
  const report = R.capacityReport(activity, regs);
  const full = activity.type !== 'dropin' && !R.hasRoom(report, groupId);
  if (full && !waitlist) {
    // ⚠ THE REFUSAL NOW OFFERS SOMETHING. It used to be the end of the road, and
    // the comment here said why: a waiting list has to choose who gets a freed
    // place, tell them, and give them a deadline, and none of that was decided.
    // It is now — everyone waiting is told, and the first to come back takes it.
    return {
      status: 409, key: 'activity-full',
      extra: { full: true, capacity: report.capacity, canWaitlist: !claiming }
    };
  }

  const reg = R.newRegistration({
    activity: activity, participant: participant, accountId: accountId, groupId: groupId,
    // THIS PARTICIPANT'S OWN registrations, and nothing else. The fee is scoped
    // to one participant, one activity, one academic year, so the waiver is
    // answerable from a prefix scan of their own key space — no sibling lookup,
    // no account aggregate, no ledger.
    priorRegistrations: await store.forParticipant(participant.participantId),
    waiting: full,
    // ⚠ RE-FROZEN, WHICH IS THE POINT OF RUNNING THIS BUILDER AGAIN. A waiting
    // entry froze a price when they joined the queue, and joining a queue is not
    // agreeing to a price — so a family who waited from September to December is
    // quoted December's terms at the moment they are actually offered a place.
    // The fee waiver and the age check are re-decided here too, for the same
    // reason: they are facts about the day a place was taken.
    claim: claiming && !full
  });

  // A record already existed for this pair — rejected, expired or cancelled —
  // and the key is one per participant per activity, so the new request lands in
  // the same blob. ITS HISTORY IS CARRIED FORWARD rather than overwritten: a
  // refusal is something that happened, and an admin looking at a second request
  // should be able to see the first.
  if (existing) reg.history = (existing.history || []).concat(reg.history);

  await store.saveRegistration(reg);
  return { reg: reg, created: true };
}

module.exports = { openRegistration };
