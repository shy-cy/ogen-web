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

// ⚠ TWO COMPLETE CONFIGURATIONS, AND NOTHING IS SHARED BETWEEN THEM.
//
// An activity's listing state decides which one its payments run through — see
// paymentModeOf() in _activity-listing.js — and "complete" is the word that
// matters: its own secret key, its own webhook endpoint, its own signing secret.
// A half-shared pair is the shape that produces a test card charging real money,
// because the piece that was shared is the piece nobody checked.
//
// The mode vocabulary is NOT redeclared here. It belongs to the select that
// produces it, and two lists of two strings is two lists that can drift.
const { PAYMENT_MODES, normaliseMode } = require('./_activity-listing');

const SECRET_ENV = { live: 'STRIPE_SECRET_KEY', test: 'STRIPE_TEST_SECRET_KEY' };
const WEBHOOK_ENV = { live: 'STRIPE_WEBHOOK_SECRET', test: 'STRIPE_TEST_WEBHOOK_SECRET' };

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

// ⚠ THE SUFFIX IS LIVE-ONLY, and it is the one thing about the two modes that is
// genuinely asymmetric rather than merely duplicated. A statement descriptor is
// what a CARDHOLDER READS ON A BANK STATEMENT, and a test payment never reaches
// one — so on a rehearsal it is a value with no reader. It is also the half of
// this file that depends on a setting the OTHER organisation owns, and a
// rehearsal is precisely where we do not want to be exercising that dependency.
const descriptorSuffixFor = (mode) =>
  (normaliseMode(mode) === 'live' ? STATEMENT_DESCRIPTOR_SUFFIX : null);

const cached = { live: null, test: null };

// ⚠ THE KEY'S OWN PREFIX IS CHECKED AGAINST THE MODE ASKED FOR, before a single
// request is made. Stripe keys say which mode they are — `sk_live_…` against
// `sk_test_…` — so the one misconfiguration that would be catastrophic and silent
// is also the one that is trivially detectable: a test key pasted into
// STRIPE_SECRET_KEY would build "live" sessions that are actually test ones, and
// every real payment on the site would quietly stop arriving. Refusing at
// construction turns that into a loud failure on the first payment attempt
// rather than a reconciliation nobody does until a family asks where their money
// went.
const KEY_SHAPE = { live: /^[a-z]+_live_/, test: /^[a-z]+_test_/ };

function stripe(mode) {
  const m = normaliseMode(mode);
  if (cached[m]) return cached[m];
  const key = process.env[SECRET_ENV[m]];
  if (!key) throw new Error(SECRET_ENV[m] + ' is not set');
  if (!KEY_SHAPE[m].test(key)) {
    throw new Error(SECRET_ENV[m] + ' does not hold a ' + m + '-mode key');
  }
  cached[m] = new (require('stripe'))(key);
  return cached[m];
}

// The signing secret for ONE mode's endpoint. Two endpoints, two secrets: the
// mode of an incoming event is decided by which secret verified it, which is the
// only statement about it that cannot be forged.
const webhookSecret = (mode) => process.env[WEBHOOK_ENV[normaliseMode(mode)]] || null;

// ⚠ WHAT STRIPE ITSELF SAYS THE MODE WAS. Every event carries `livemode`, so an
// endpoint can check that the money it is about to write down is the kind of
// money it was registered for. Absent reads as live, like every other blank in
// this pair — a missing flag must never downgrade real money to a rehearsal.
const modeOfEvent = (event) => (event && event.livemode === false ? 'test' : 'live');

// ⚠ THE ORGANISATION TAG IS WRITTEN IN BOTH MODES, and the reason is worth
// stating because the brief said a rehearsal does not need it.
//
// It is not a statement-descriptor-shaped nicety: it is the ONLY thing that tells
// an Ogen event from Shirat HaYam's, and a Stripe account is shared in test mode
// exactly as it is in live mode — the other organisation's developers press test
// cards too. Dropping the tag on rehearsals would mean isOurs() had to accept
// untagged events on one endpoint, and "accept untagged" is the single
// relaxation this file exists to forbid. It costs one metadata key.
//
// `ogen_mode` travels beside it so a human reading the Stripe dashboard can see
// which configuration a session was built for, and so a webhook can refuse a
// session that was built for the other one.
//
// Stripe caps a metadata value at 500 characters and silently keeps whatever
// fits, so a long value becomes a quietly wrong value. Cut it here rather than
// discovering it in a reconciliation.
function meta(extra, mode) {
  const out = { organization: ORGANIZATION, ogen_mode: normaliseMode(mode) };
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

// Which configuration a session was BUILT for, off the object itself. Absent is
// live, for the same reason every other blank here is.
const modeOfObject = (obj) => normaliseMode(((obj && obj.metadata) || {}).ogen_mode);

module.exports = {
  ORGANIZATION, STATEMENT_DESCRIPTOR_SUFFIX, PAYMENT_MODES,
  SECRET_ENV, WEBHOOK_ENV,
  stripe, meta, isOurs, registrationRef,
  descriptorSuffixFor, webhookSecret, modeOfEvent, modeOfObject, normaliseMode,
  // A test seam, the same one _email.js carries and for the same reason: the
  // code that decides what a family is CHARGED should be runnable without a
  // network and without a key. Static analysis can assert that a descriptor
  // suffix is set; only executing it catches an endpoint that builds a session
  // for the wrong registration.
  //
  // ⚠ PER MODE, because a test that installed one fake client for both would be
  // unable to see a path picking the wrong configuration — which is the whole
  // thing worth testing here.
  _internal: { setClient: (c, mode) => { cached[normaliseMode(mode)] = c; } }
};
