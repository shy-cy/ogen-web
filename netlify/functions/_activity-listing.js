// WHO CAN FIND THIS ACTIVITY, AND WHOSE MONEY ITS PAYMENTS ARE. One field, one
// dropdown, three states — PURE, requires nothing, opens no store, asks no
// clock.
//
//   listed     the ordinary activity: on the listing pages, in the menu, in
//              sitemap.xml, indexable, and paid for with REAL money.
//   unlisted   published and reachable by its own URL, and off every route to
//              it. Real money: an unlisted activity is a real activity that is
//              simply not advertised — a closed group, a class filled by word of
//              mouth, a page sent to one family.
//   test       the same, and its payments run through the TEST Stripe
//              configuration instead. A rehearsal.
//
// ⚠ IT REPLACES `testActivity`, AND THE TICKBOX WAS THE SMALLER HALF OF WHAT IT
// SAID. That flag conflated two independent questions — "is this advertised" and
// "is this real money" — because while there was only one Stripe configuration
// the second question had only one answer. An activity nobody should stumble on
// and an activity whose payments are pretend are different things: the first is
// ordinary and happens for real reasons, the second is staff rehearsing. A
// tickbox cannot say both, so anything hidden had to be a rehearsal.
//
// ⚠ AND IT IS DELIBERATELY NOT A STATUS. A rehearsal has to run through the same
// open-activity code every family meets, or it rehearses something else. What
// this field removes is every ROUTE TO the page and, for `test`, which keys the
// money moves on. `draft` remains the way to have no page at all.
//
// ⚠ THE PAYMENT MODE IS DERIVED FROM IT AND IS NEVER A SECOND FIELD. Two fields
// saying "this is a rehearsal" are two fields that can disagree, and the
// disagreement would surface as a test card charging real money or the reverse.
// paymentModeOf() is the one derivation, and `modeOfRecord()` below is how every
// payment path reads the answer back off the record it was frozen onto.

const LISTINGS = ['listed', 'unlisted', 'test'];
const DEFAULT_LISTING = 'listed';

// The two complete Stripe configurations. The vocabulary is owned here rather
// than in _stripe.js because this select is where a mode comes FROM: _stripe.js
// maps a mode to a key, _credit-ledger.js tags an entry with one, and neither
// should hold its own copy of the list.
const PAYMENT_MODES = ['live', 'test'];
const DEFAULT_MODE = 'live';

// ⚠ ABSENT READS AS `live`, EVERYWHERE, and that is the safe direction here
// rather than the generous one. Every payment and every ledger entry written
// before this field existed was made with the one key that existed, which was the
// live one. Reading a blank as `test` would relabel the whole history of real
// money as pretend — and, worse, make it spendable against a test activity.
const normaliseMode = (v) => (PAYMENT_MODES.indexOf(v) !== -1 ? v : DEFAULT_MODE);

// ⚠ THE MIGRATION LIVES HERE, ON READ, and it is one line rather than a pass
// somebody has to run: `testActivity: true` becomes `test`, and anything else —
// `false`, or the key absent altogether — becomes `listed`. Every record written
// before this field existed answers correctly without being touched, which is
// what lets _activity-migrate.js drop the old key on the next save.
function listingOf(activity) {
  const named = String((activity && activity.listing) || '').trim();
  if (LISTINGS.indexOf(named) !== -1) return named;
  if (activity && activity.testActivity === true) return 'test';
  return DEFAULT_LISTING;
}

const isListed = (activity) => listingOf(activity) === 'listed';
const isTest = (activity) => listingOf(activity) === 'test';

// WHICH STRIPE CONFIGURATION THIS ACTIVITY'S PAYMENTS RUN THROUGH.
const paymentModeOf = (activity) => (listingOf(activity) === 'test' ? 'test' : 'live');

// ⚠ ONE FUNCTION DECIDES THE META TAG, so the tag and sitemap.xml cannot
// disagree — a sitemap advertising a page that asks not to be indexed
// contradicts itself, and that pairing has to hold for three listing states and
// the robots select on top of them.
//
// `nofollow` only for `test`. An unlisted activity's links are as worth crawling
// as /about's, which is the same reason an ordinary `noindex` activity gets
// `follow`; nothing on a rehearsal is.
//
// The listing state WINS over the robots select rather than being a second thing
// to remember beside it. A listed activity is the only one the select governs,
// which is the case it was written for: on the listing pages, out of search.
function robotsFor(activity) {
  const state = listingOf(activity);
  if (state === 'test') return 'noindex, nofollow';
  if (state === 'unlisted') return 'noindex, follow';
  return (activity && activity.robots) === 'noindex' ? 'noindex, follow' : 'index, follow';
}

// --- what a payment record says about itself ---------------------------------

// ⚠ FROZEN, AND READ BACK FROM THE RECORD RATHER THAN FROM THE ACTIVITY. The
// mode is captured onto the frozen block when a registration is taken and onto
// an evening when it is booked, for the same reason `frozen.type` is: an admin
// switching a listing in March must not change whether money already taken in
// January was real. It also means the one endpoint with no session at all —
// /pay — can pick the right Stripe key from the registration alone, with no
// repository read.
const modeOfRecord = (record) =>
  normaliseMode(((record && record.frozen) || {}).paymentMode);

// ⚠ THE ONE GUARD EVERY PAYMENT PATH ASKS, so "test money never lands on a real
// record" is a property of the code rather than a rule five call sites remember.
// Returns null when the payment may proceed.
//
// Two ways it refuses, and they are not the same fault:
//
//   mode-mismatch  the mode being paid in is not the mode this record was sold
//                  in. A test Checkout settling a live registration, or a live
//                  one settling a rehearsal.
//   mode-frozen    this record has already taken money in the OTHER mode. It can
//                  only arise from a hand-edited frozen block, and it is the one
//                  state that must never be added to: a paidCents that is part
//                  real and part pretend is a figure nobody can unpick.
function paymentModeRefusal(record, mode) {
  const paying = normaliseMode(mode);
  const sold = modeOfRecord(record);
  if (paying !== sold) return { reason: 'mode-mismatch', expected: sold, got: paying };
  const taken = ((record && record.payment) || {}).mode;
  if (taken && normaliseMode(taken) !== paying) {
    return { reason: 'mode-frozen', expected: normaliseMode(taken), got: paying };
  }
  return null;
}

module.exports = {
  LISTINGS, DEFAULT_LISTING, PAYMENT_MODES, DEFAULT_MODE,
  listingOf, isListed, isTest, paymentModeOf, robotsFor,
  normaliseMode, modeOfRecord, paymentModeRefusal
};
