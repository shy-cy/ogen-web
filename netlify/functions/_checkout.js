// ONE Stripe Checkout session, built in ONE place.
//
// There are two doors to the same payment now — the button on the family's own
// registration page, and a link in an email that needs no password — and they
// must charge the same amount, in the same currency, against the same metadata,
// with the same statement descriptor. Two copies of this would be two copies
// that can drift, and the way that drift surfaces is a family being charged a
// figure nobody on this side can explain.
//
// So neither door builds a session. They decide WHO is allowed through, which
// is the only thing they genuinely differ about, and then call this.
//
// ⚠ THE AMOUNT IS COMPUTED HERE, from the registration, and is never a
// parameter. An amount that can be passed in is an amount somebody can edit —
// and this function is reachable from an endpoint with no session at all.
// Stripe's own figure is then the authority on the way back in; see
// stripe-webhook.js.

const S = require('./_stripe');
const facts = require('./_activity-facts');
const { SITE } = require('./_email-shell');

// What is still owed on a registration. `creditedCents` is deliberately not
// subtracted: a credit is spent by an admin applying it, which writes both the
// ledger debit and the payment in one action, so by the time it affects this
// figure it is already in `paidCents`. Subtracting it here as well would take
// it off twice.
function dueCents(reg) {
  const p = (reg && reg.payment) || {};
  return ((p.owedCents || 0) - (p.paidCents || 0));
}

// ⚠ WHICH REGISTRATIONS MAY BE PAID FOR — one list, both doors.
//
// `pending` is in it, and that is a change worth stating plainly. It used to be
// `approved` only, on the reasoning that money must not move before a person has
// agreed to the place. What that produced on screen was a card reading
// "Still to pay  €500.00" with no button under it and the sentence "We will send
// you a payment link shortly" in its place — a debt shown to somebody, with the
// means to settle it withheld and a promise of a link that only exists once an
// admin gets round to it.
//
// It also contradicted the copy directly above it. `pending` and `approved` both
// read "registered" to a family by design — the queue's shape is ours, not
// theirs — so a family told they are registered and shown what they owe should
// be able to pay it.
//
// THE COST IS A REFUSAL AFTER A PAYMENT, and it is guarded rather than ignored:
// `decide()` in admin-registrations.js refuses to reject a registration carrying
// money that has not been given back, and names cancelling — which credits the
// family through the ledger — as the route that accounts for it. Without that
// guard this change would quietly convert "we cannot take your child" into money
// we are holding with nothing recording it.
//
// Not `rejected`, `expired` or `cancelled`: those have no place to pay for.
const PAYABLE_STATUSES = ['pending', 'approved'];
const isPayable = (reg) => PAYABLE_STATUSES.indexOf(reg && reg.status) !== -1;

// Where Stripe sends a family back: their own registration page, addressed by
// the registration's key in the spelling THE PAGE READS, and anchored on the
// cost card. This was `?participantId=…&activityId=…` once, which is the API's
// spelling and not the client's, so it returned somebody who had just paid to
// "that registration was not found".
function returnUrl(reg, lang) {
  const base = lang === 'he' ? '' : '/' + lang;
  return SITE + base + '/account/activity'
    + '?p=' + encodeURIComponent(reg.participantId)
    + '&a=' + encodeURIComponent(reg.activityId) + '#pay';
}

// email is what Stripe prefills. It is the address the registration's account
// holds, never anything from a request — on the emailed path there is no
// request body to take it from, and on the signed-in path taking it from one
// would let a caller put somebody else's address on a receipt.
// The one place a Stripe session is built. Everything above decides WHAT is
// being charged for; this decides how a charge is made, once.
async function build({ lang, email, lines, back, meta }) {
  return S.stripe().checkout.sessions.create({
    mode: 'payment',
    customer_email: email || undefined,
    // Stripe Checkout has no Hebrew; 'auto' falls back to English.
    locale: lang === 'en' ? 'en' : 'auto',
    // ONE LINE PER THING BEING PAID FOR. A term is one line; four evenings
    // bought together are four, each named by its date — so the Checkout page,
    // the receipt and the card statement all say which evenings were paid for
    // rather than showing one lump a family cannot break down.
    line_items: lines.map((l) => ({
      quantity: 1,
      price_data: {
        currency: 'eur',
        unit_amount: l.amountCents,
        product_data: { name: l.name, description: l.description || undefined }
      }
    })),
    success_url: back + (back.indexOf('?') === -1 ? '?' : '&') + 'paid=1',
    cancel_url: back,
    // Tagged on the SESSION and mirrored onto the PaymentIntent. The account is
    // shared with another organisation, so an untagged object is
    // indistinguishable from theirs — and a session-only tag is invisible on
    // the PaymentIntent a dispute arrives attached to.
    metadata: S.meta(meta),
    payment_intent_data: {
      statement_descriptor_suffix: S.STATEMENT_DESCRIPTOR_SUFFIX,
      metadata: S.meta(meta)
    }
  });
}

async function createCheckout(reg, lang, email) {
  const due = dueCents(reg);
  if (!(due > 0)) throw Object.assign(new Error('Nothing outstanding'), { reason: 'nothing-due' });

  // The FROZEN title, not the activity's current one: a rename must not change
  // what a family sees on the payment they are making.
  const title = (reg.frozen && facts.pick(reg.frozen.activityTitle, lang)) || 'Ogen';
  const back = returnUrl(reg, lang);

  return build({
    lang: lang, email: email,
    lines: [{ name: title, description: (reg.frozen && reg.frozen.participantName) || undefined,
              amountCents: due }],
    back: back.slice(0, back.indexOf('#')) || back,
    meta: {
      ogen_kind: 'registration',
      participant_id: reg.participantId,
      activity_id: reg.activityId,
      registration: 'reg-' + reg.participantId + '__' + reg.activityId,
      activity_slug: reg.frozen && reg.frozen.activitySlugAtSubmission
    }
  });
}

// ⚠ EVENINGS, WHICH ARE A DIFFERENT DEBT FROM A TERM.
//
// A drop-in registration owes nothing — owedCentsFor() charges the yearly fee
// and, for a COURSE, the term price. The money on a pay-per-session activity
// lives on the attendance record for each evening, and until now a family could
// book one and had no way at all to settle it: `pay` reads a registration, and
// an evening is not one.
//
// It goes through the same builder, so the currency, the descriptor and the
// organisation tag cannot drift between the two — and the webhook tells them
// apart by `ogen_kind` plus the dates, which is what makes each settlement land
// on the right blob.
//
// ⚠ SEVERAL EVENINGS ARE ONE PAYMENT, NOT SEVERAL. A family choosing four dates
// and being sent through Checkout four times would abandon somewhere in the
// middle, and we would hold three paid evenings and a fourth booked and unpaid
// with nothing saying so. One session, one card entry, one receipt — and the
// breakdown carried in the metadata so the webhook can still settle each blob
// on its own.
//
// The cap is a real limit rather than a round number: Stripe allows 500
// characters per metadata value, and the breakdown below is roughly 18 per
// evening. Twelve is comfortably inside it and is already more evenings than a
// term holds.
const MAX_SESSION_LINES = 12;

async function createSessionsCheckout(atts, activityTitle, lang, email) {
  const list = (atts || []).filter(Boolean);
  if (!list.length) throw Object.assign(new Error('Nothing to pay for'), { reason: 'nothing-due' });
  if (list.length > MAX_SESSION_LINES) {
    throw Object.assign(new Error('Too many evenings in one payment'), { reason: 'too-many' });
  }

  const dues = list.map((att) => {
    const p = att.payment || {};
    return (p.owedCents || 0) - (p.paidCents || 0);
  });
  if (dues.some((d) => !(d > 0))) {
    throw Object.assign(new Error('Nothing outstanding'), { reason: 'nothing-due' });
  }

  const title = facts.pick(activityTitle, lang) || 'Ogen';
  const base = lang === 'he' ? '' : '/' + lang;
  const first = list[0];
  const back = SITE + base + '/account/activity'
    + '?p=' + encodeURIComponent(first.participantId)
    + '&a=' + encodeURIComponent(first.activityId);

  return build({
    lang: lang, email: email,
    // The DATE on every line, because a family paying for one evening out of ten
    // needs the receipt to say which. Lines reading only "Folk dancing" are four
    // identical charges on a statement.
    lines: list.map((att, i) => ({
      name: title, description: att.sessionDate, amountCents: dues[i]
    })),
    back: back,
    meta: {
      ogen_kind: 'session',
      participant_id: first.participantId,
      activity_id: first.activityId,
      // `session_date` stays for one evening so a Checkout opened before this
      // existed still settles; `session_dates` is what the webhook reads first.
      session_date: list.length === 1 ? first.sessionDate : undefined,
      session_dates: list.map((a) => a.sessionDate).join(','),
      // OUR BREAKDOWN, which Stripe's total then has to agree with. The webhook
      // refuses to settle anything if the two disagree — see settleSession —
      // because splitting a payment across blobs by a figure nobody checked is
      // how money lands against the wrong debt.
      session_amounts: dues.join(','),
      attendance: list.length === 1
        ? 'att-' + first.participantId + '__' + first.activityId + '__' + first.sessionDate
        : undefined
    }
  });
}

// ⚠ A BUNDLE IS PAID FOR BEFORE IT EXISTS, which is the opposite of everything
// else here and is deliberate.
//
// A term and an evening are debts on records that already exist: the family has
// a place, and the payment settles what it costs. A bundle is a purchase — there
// is nothing to owe until it is bought — so the obvious shape, writing the
// record and then charging for it, would leave an unpaid bundle sitting in the
// store with entries in it. `covers()` would have to learn a fourth status, and
// the one place that could go wrong is the one place it must not.
//
// So NOTHING IS WRITTEN UNTIL STRIPE SAYS IT WAS PAID, and the terms travel in
// the metadata: the entries, the rate, the window, and THE DATES THEMSELVES.
//
// Carrying the dates rather than recomputing them on the way back matters more
// than it looks. Coverage is computed from the calendar as it stands, and an
// admin can edit that calendar in the seconds a card takes to clear — so
// recomputing would hand a family a bundle covering dates other than the ones
// they were shown when they chose it. What they saw is what they get, and the
// nightly reconcile repairs it afterwards if the calendar really has moved.
async function createBundleCheckout({ activity, bundle, coveredDates, participantId,
                                      accountId, purchasedAt, lang, email, participantName }) {
  const perEntry = Math.max(0, Math.round(Number(bundle.pricePerEntry) * 100)) || 0;
  const total = perEntry * bundle.entries;
  if (!(total > 0)) throw Object.assign(new Error('A free bundle is not a purchase'), { reason: 'nothing-due' });

  const title = facts.pick(activity.title, lang) || 'Ogen';
  const base = lang === 'he' ? '' : '/' + lang;
  const back = SITE + base + '/account/activity'
    + '?p=' + encodeURIComponent(participantId)
    + '&a=' + encodeURIComponent(activity.activityId);

  return build({
    lang: lang, email: email,
    lines: [{
      name: title,
      // The size of the bundle, because a family holding two receipts needs to
      // tell the five from the ten.
      description: bundle.entries + ' × ' + (participantName || ''),
      amountCents: total
    }],
    back: back,
    meta: {
      ogen_kind: 'bundle',
      participant_id: participantId,
      activity_id: activity.activityId,
      account_id: accountId,
      bundle_id: bundle.bundleId,
      bundle_entries: String(bundle.entries),
      bundle_price_per_entry: String(bundle.pricePerEntry),
      bundle_validity_days: String(bundle.validityDays),
      covered_dates: coveredDates.join(','),
      purchased_at: new Date(purchasedAt).toISOString()
    }
  });
}

// One evening. The plural is the general case; this exists because two call
// sites read better with it, and it is the same builder underneath.
const createSessionCheckout = (att, activityTitle, lang, email) =>
  createSessionsCheckout([att], activityTitle, lang, email);

module.exports = {
  createCheckout, createSessionCheckout, createSessionsCheckout, createBundleCheckout,
  dueCents, returnUrl, isPayable, PAYABLE_STATUSES, MAX_SESSION_LINES
};
