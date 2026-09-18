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
async function createCheckout(reg, lang, email) {
  const due = dueCents(reg);
  if (!(due > 0)) throw Object.assign(new Error('Nothing outstanding'), { reason: 'nothing-due' });

  // The FROZEN title, not the activity's current one: a rename must not change
  // what a family sees on the payment they are making.
  const title = (reg.frozen && facts.pick(reg.frozen.activityTitle, lang)) || 'Ogen';
  const back = returnUrl(reg, lang);

  return S.stripe().checkout.sessions.create({
    mode: 'payment',
    customer_email: email || undefined,
    // Stripe Checkout has no Hebrew; 'auto' falls back to English.
    locale: lang === 'en' ? 'en' : 'auto',
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'eur',
        unit_amount: due,
        product_data: {
          name: title,
          description: (reg.frozen && reg.frozen.participantName) || undefined
        }
      }
    }],
    success_url: back + '&paid=1',
    cancel_url: back,
    // Tagged on the SESSION and mirrored onto the PaymentIntent. The account is
    // shared with another organisation, so an untagged object is
    // indistinguishable from theirs — and a session-only tag is invisible on
    // the PaymentIntent a dispute arrives attached to.
    metadata: S.meta({
      ogen_kind: 'registration',
      participant_id: reg.participantId,
      activity_id: reg.activityId,
      registration: 'reg-' + reg.participantId + '__' + reg.activityId,
      activity_slug: reg.frozen && reg.frozen.activitySlugAtSubmission
    }),
    payment_intent_data: {
      statement_descriptor_suffix: S.STATEMENT_DESCRIPTOR_SUFFIX,
      metadata: S.meta({
        ogen_kind: 'registration',
        participant_id: reg.participantId,
        activity_id: reg.activityId
      })
    }
  });
}

module.exports = { createCheckout, dueCents, returnUrl };
