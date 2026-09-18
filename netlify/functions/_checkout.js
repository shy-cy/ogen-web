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

// One evening. The plural is the general case; this exists because two call
// sites read better with it, and it is the same builder underneath.
const createSessionCheckout = (att, activityTitle, lang, email) =>
  createSessionsCheckout([att], activityTitle, lang, email);

module.exports = {
  createCheckout, createSessionCheckout, createSessionsCheckout,
  dueCents, returnUrl, MAX_SESSION_LINES
};
