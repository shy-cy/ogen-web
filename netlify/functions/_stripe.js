// THE ONE PLACE STRIPE IS TALKED TO, and the one place that knows this account
// is shared with another organisation.
//
// Ogen's payments run through Shirat HaYam's Stripe account rather than an
// account of Ogen's own. That is a deliberate decision with real consequences,
// and every one of them is handled here so no caller has to remember them:
//
//   - EVERY object Ogen creates is tagged `organization: "ogen"`. Not for
//     tidiness: Stripe delivers webhook events to every endpoint registered on
//     an account, filtered by event TYPE and never by metadata, so Ogen's
//     webhook receives Shirat HaYam's donations and registrations too. The tag
//     is what tells them apart, and `isOurs()` below is the only thing allowed
//     to decide.
//
//   - The tag is written on the Checkout Session AND mirrored onto the
//     PaymentIntent. A session-only tag is invisible on the Payments list and
//     on the PaymentIntent a dispute arrives attached to — which are exactly
//     the two places somebody looks when they need to know whose payment this
//     was. The sister site already mirrors its metadata for the same reason.
//
//   - `organization` alone answers "is this ours", which is a filter. It does
//     not answer "which registration is this", so the join keys travel with it.
//     Reconciling a payment to a family should never need a guess.
//
// ⚠ WHAT THIS FILE CANNOT DO. Metadata separates payments; it does not separate
// money. Payouts, the balance, Stripe's fees and the year-end tax documents are
// all account-level, so Ogen's takings settle into Shirat HaYam's balance and
// pay out to Shirat HaYam's bank. Splitting that stays a manual accounting job.
// Nothing in this repository can change that, and no amount of tagging implies
// otherwise.

const ORGANIZATION = 'ogen';

// The dynamic suffix, appended by Stripe to the ACCOUNT'S prefix to form what a
// cardholder reads: `<prefix>* <suffix>`, capped at 22 characters including the
// separator.
//
// ⚠ `statement_descriptor` IS NOT USABLE HERE. Setting it on a card charge
// returns an error — Stripe's own words — and every payment Ogen takes is a
// card charge. The override that the brief originally asked for does not exist
// for cards; this suffix is the whole of the control we have.
//
// "Ogen CTR" is 8 characters, well inside the 17 a 3-character account prefix
// leaves. It is short on purpose: the prefix belongs to the account and can be
// changed by the other organisation without anybody here being told, so the
// suffix should not be sized to a budget we do not own.
const STATEMENT_DESCRIPTOR_SUFFIX = 'Ogen CTR';

let cached = null;
function stripe() {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
  cached = new (require('stripe'))(key);
  return cached;
}

// Stripe caps a metadata value at 500 characters and silently keeps whatever
// fits, so a long value becomes a quietly wrong value. Cut it here rather than
// discovering it in a reconciliation.
function meta(extra) {
  const out = { organization: ORGANIZATION };
  Object.keys(extra || {}).forEach((k) => {
    const v = extra[k];
    if (v === undefined || v === null || v === '') return;
    out[k] = String(v).slice(0, 500);
  });
  return out;
}

// THE ONLY THING ALLOWED TO DECIDE WHETHER AN EVENT IS OURS.
//
// It reads the tag and nothing else — never the shape of the payload, never
// "does this look like one of ours". The sister site's webhook ignores Ogen's
// payments today by falling off the end of an event-slug lookup and returning
// null, which works and is an accident; a rule that can only be satisfied by an
// explicit tag cannot go wrong the day two payloads happen to resemble each
// other.
//
// Absent is NOT ours. Every Shirat HaYam object predates this tag and carries
// no `organization` at all, so treating a missing tag as ours would claim the
// entire history of the other organisation's payments.
function isOurs(obj) {
  const m = (obj && obj.metadata) || {};
  return m.organization === ORGANIZATION;
}

// Pulls the join keys back off a Stripe object. Returns null unless BOTH are
// present: a payment that cannot name its registration must be looked at by a
// person, not guessed at by matching on an amount.
function registrationRef(obj) {
  const m = (obj && obj.metadata) || {};
  if (!m.participant_id || !m.activity_id) return null;
  return { participantId: m.participant_id, activityId: m.activity_id };
}

module.exports = {
  ORGANIZATION, STATEMENT_DESCRIPTOR_SUFFIX,
  stripe, meta, isOurs, registrationRef,
  // A test seam, the same one _email.js carries and for the same reason: the
  // code that decides what a family is CHARGED should be runnable without a
  // network and without a key. Static analysis can assert that a descriptor
  // suffix is set; only executing it catches an endpoint that builds a session
  // for the wrong registration.
  _internal: { setClient: (c) => { cached = c; } }
};
