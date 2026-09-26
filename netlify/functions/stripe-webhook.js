// /api/stripe-webhook — Stripe telling us a family has paid.
//
// ⚠ TWO ENDPOINTS, ONE IMPLEMENTATION. There is a second file beside this one,
// stripe-webhook-test.js, which is three lines: it calls handlerFor('test'). The
// two modes are two complete Stripe configurations with their own keys and their
// own signing secrets, so they have to be two registered endpoints — and the mode
// of an arriving event is decided by WHICH SECRET VERIFIED IT, which is the only
// statement about it that cannot be forged.
//
// It is one implementation because everything below — the organisation check, the
// idempotency list, Stripe's figure being the authority, always answering 200 —
// is identical in both. A second copy is a second place the retry rule can drift,
// and the half that drifts is the half nobody is watching.
//
// ⚠ THIS ENDPOINT RECEIVES ANOTHER ORGANISATION'S PAYMENTS. Ogen's payments run
// through Shirat HaYam's Stripe account, and Stripe delivers every event on an
// account to every endpoint registered on it — filtered by event TYPE, never by
// metadata. So each of their donations and event registrations arrives here
// too, and each of Ogen's arrives at theirs. Nothing in the transport separates
// the two.
//
// `isOurs()` in _stripe.js is the only thing allowed to decide, and it reads the
// `organization` tag and nothing else. Never infer from the shape of a payload:
// the sister site ignores Ogen's payments today by looking up an event slug,
// finding nothing and returning null, which works and is an accident waiting for
// two payloads to resemble each other.
//
// THREE RULES, each of which is somebody's bug somewhere:
//
//   1. ALWAYS 200, unless the SIGNATURE itself fails. A 4xx or 5xx makes Stripe
//      retry for days and then disable the endpoint — and a retry here means a
//      family credited twice. An event we cannot make sense of is logged and
//      acknowledged, because it is nearly always an event that was never ours.
//
//   2. THE SIGNATURE IS CHECKED ON THE RAW BODY. Netlify hands `event.body` as
//      a string and may base64 it; parsing and re-serialising changes bytes and
//      the signature no longer matches. constructEvent gets the raw string.
//
//   3. STRIPE'S FIGURE IS THE AUTHORITY for what was taken. `amount_total` from
//      the session, never a number the browser sent and never one recomputed
//      here from the record — the record is what the payment is being checked
//      against, so deriving the amount from it would make the check circular.
//
// Idempotency is on the registration, as `payment.settledSessions`. Webhooks are
// at-least-once by design, and Blobs has no compare-and-swap, so the record
// itself refuses a repeat rather than a lock preventing one.

const S = require('./_stripe');
const LST = require('./_activity-listing');
const store = require('./_registration-store');
const attendance = require('./_session-attendance');
const bundles = require('./_bundle-store');
const R = require('./_registration');
const accounts = require('./_account-store');
const mail = require('./_registration-email');

const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});

exports.handler = async (event) => runWebhook(event, 'live');

// The mode is the ENDPOINT'S, baked in at the file that registers it rather than
// read off the request — a request cannot be allowed to say which configuration
// it would like to be settled under.
function handlerFor(mode) {
  return async (event) => runWebhook(event, mode);
}

async function runWebhook(event, mode) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST' });

  const secret = S.webhookSecret(mode);
  if (!secret) {
    console.error('stripe-webhook[' + mode + ']: ' + S.WEBHOOK_ENV[mode] + ' is not set');
    return json(500, { error: 'Not configured' });
  }

  // The RAW body, exactly as sent. Netlify base64-encodes it for some content
  // types; decoding to the original string is fine, re-serialising JSON is not.
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');
  const sig = (event.headers || {})['stripe-signature'] || (event.headers || {})['Stripe-Signature'];

  let stripeEvent;
  try {
    stripeEvent = S.stripe(mode).webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    // The ONE case that is not a 200. An unverified body is not from Stripe.
    console.error('stripe-webhook: signature verification failed:', err.message);
    return json(400, { error: 'Bad signature' });
  }

  try {
    // ⚠ STRIPE'S OWN WORD ON WHICH KIND OF MONEY THIS WAS, checked against the
    // endpoint it arrived on. A verified signature already proves it came from
    // this endpoint's configuration, so a disagreement here means the endpoint
    // was registered in the wrong mode — a misconfiguration, not an event, and
    // exactly the sort that would otherwise be discovered by reconciling a
    // month of rehearsals filed as income. Nothing is settled and it is still
    // acknowledged: retries would not fix a dashboard setting.
    if (S.modeOfEvent(stripeEvent) !== mode) {
      console.error('stripe-webhook[' + mode + ']: a ' + S.modeOfEvent(stripeEvent) +
                    '-mode event arrived on the ' + mode + ' endpoint —', stripeEvent.id,
                    '— nothing settled');
      return json(200, { received: true });
    }
    if (stripeEvent.type === 'checkout.session.completed') {
      await settle(stripeEvent.data.object, mode);
    }
    // Every other type is fine to ignore, and most events on this account are
    // another organisation's. Not logged individually — that would be noise in
    // the place somebody looks during an incident.
  } catch (err) {
    // Swallowed on purpose. See rule 1: retries are worse than a missed
    // settlement, which an admin can record by hand from the Stripe dashboard.
    console.error('stripe-webhook: handling failed:', err && err.message);
  }

  return json(200, { received: true });
}

// One evening, on its own record. Deliberately a sibling of settle() rather
// than a branch inside it: the two read different blobs, write different
// vocabularies of the same field names, and the one thing they must share — the
// part-payment rule — is short enough to state twice and is pinned by a test.
// ⚠ ONE PAYMENT MAY COVER SEVERAL EVENINGS, and each is its own blob.
//
// A family choosing four dates pays once, so `amount_total` is the sum of four
// debts that have to be written down separately. The breakdown travels in the
// metadata — and is NOT trusted on its own: it is settled only if it adds up to
// the figure Stripe says was taken. If it does not, nothing is written and the
// mismatch is logged loudly, because splitting money across blobs by an unchecked
// figure is how a payment lands against the wrong debt, which is worse than a
// payment nobody can place: nobody goes looking for it.
async function settleSession(session, meta, mode) {
  // Stripe's figure, not ours.
  const total = Math.round(Number(session.amount_total) || 0);
  if (!(total > 0)) {
    console.error('stripe-webhook: session with no amount:', session.id);
    return;
  }

  const dates = String(meta.session_dates || meta.session_date || '')
    .split(',').map((d) => d.trim()).filter(Boolean);
  if (!dates.length) {
    console.error('stripe-webhook: a session payment named no evening:', session.id);
    return;
  }

  const amounts = String(meta.session_amounts || '')
    .split(',').map((a) => Math.round(Number(a) || 0)).filter((a) => a > 0);

  let parts;
  if (dates.length === 1) {
    // One evening: Stripe's total IS that evening's payment, and no breakdown is
    // needed. This is also the shape of a Checkout opened before the breakdown
    // existed, which must still settle.
    parts = [total];
  } else {
    if (amounts.length !== dates.length) {
      console.error('stripe-webhook: ' + dates.length + ' evenings and ' + amounts.length +
                    ' amounts on', session.id, '— nothing settled');
      return;
    }
    const sum = amounts.reduce((a, b) => a + b, 0);
    if (sum !== total) {
      console.error('stripe-webhook: breakdown ' + sum + 'c does not match Stripe\'s ' +
                    total + 'c on', session.id, '— nothing settled');
      return;
    }
    parts = amounts;
  }

  for (let i = 0; i < dates.length; i++) {
    await settleOneSession(session, meta, dates[i], parts[i], mode);
  }
}

async function settleOneSession(session, meta, date, cents, mode) {
  const att = await attendance.getAttendance(meta.participant_id, meta.activity_id, date);
  if (!att) {
    console.error('stripe-webhook: no booking for', meta.participant_id, date, session.id);
    return;
  }
  if (modeRefused(att, mode, session, 'evening ' + date)) return;
  const settled = (att.payment && att.payment.settledSessions) || [];
  if (settled.indexOf(session.id) !== -1) return;          // already counted

  const paid = (att.payment.paidCents || 0) + cents;
  const next = attendance.transition(att, {
    status: att.status, by: 'stripe', note: 'paid ' + cents + 'c · ' + session.id
  });
  next.payment = Object.assign({}, next.payment, {
    paidCents: paid,
    paidAt: new Date().toISOString(),
    // FROZEN ON THE PAYMENT, checked above against what the evening was sold in.
    mode: mode,
    status: next.payment.owedCents != null && paid >= next.payment.owedCents ? 'paid' : 'owed',
    settledSessions: settled.concat([session.id]),
    stripeSessionId: session.id
  });
  await attendance.saveAttendance(next);
}

// ⚠ THE ONE GATE BETWEEN TEST MONEY AND A REAL RECORD, asked before every write
// on this endpoint and nowhere else decided. paymentModeRefusal() compares the
// mode this payment arrived in against the mode the record was SOLD in — off its
// own frozen block, never off the activity, so a listing switched since does not
// move it.
//
// It settles nothing and logs loudly, and it does not throw: a 200 still goes
// back, because a retry cannot fix a mismatch and Stripe would disable the
// endpoint trying. Somebody has to look at it, which is what the log is for.
function modeRefused(record, mode, session, what) {
  const refusal = LST.paymentModeRefusal(record, mode);
  if (!refusal) return false;
  console.error('stripe-webhook[' + mode + ']: ' + refusal.reason + ' on ' + what +
                ' — sold in ' + refusal.expected + ', paid in ' + refusal.got +
                ' —', session.id, '— nothing settled');
  return true;
}

// ⚠ THE BUNDLE IS CREATED HERE, and this is the only place it is created.
//
// Everything else in this file settles a debt on a record that already exists. A
// bundle has no record until it is paid for — see createBundleCheckout — so the
// terms arrive in the metadata and the record is written on the way back in.
//
// Idempotent by KEY rather than by a settled-sessions list, because there is no
// record yet to keep a list on. The purchase timestamp is the third part of the
// key, so a redelivered event resolves to the same blob and finds it there. That
// matters more here than elsewhere: by the time Stripe retries, entries may have
// been spent, and rewriting the record would hand them back.
async function settleBundle(session, meta, mode) {
  const cents = Math.round(Number(session.amount_total) || 0);
  if (!(cents > 0)) {
    console.error('stripe-webhook: bundle payment with no amount:', session.id);
    return;
  }
  const purchasedAt = String(meta.purchased_at || '');
  const dates = String(meta.covered_dates || '').split(',').map((d) => d.trim()).filter(Boolean);
  const entries = Number(meta.bundle_entries);
  if (!purchasedAt || !dates.length || !(entries > 0)) {
    console.error('stripe-webhook: a bundle payment was missing its terms:', session.id);
    return;
  }
  const existing = await bundles.getBundle(meta.participant_id, meta.activity_id, purchasedAt);
  if (existing) return;

  const rec = bundles.newBundle({
    participantId: meta.participant_id,
    activityId: meta.activity_id,
    accountId: meta.account_id,
    groupId: meta.group_id || null,
    bundle: {
      bundleId: meta.bundle_id,
      entries: entries,
      pricePerEntry: Number(meta.bundle_price_per_entry),
      validityDays: Number(meta.bundle_validity_days)
    },
    coveredDates: dates,
    purchasedAt: purchasedAt,
    paymentRef: session.id,
    // ⚠ THE ONE RECORD WITH NOTHING TO CHECK AGAINST, because a bundle does not
    // exist until it is paid for — so the endpoint's own mode is what is frozen
    // onto it, rather than compared with something. The session's `ogen_mode`
    // was already checked against this endpoint in settle() above, which is the
    // comparison that would otherwise be missing here.
    paymentMode: mode
  });
  await bundles.saveBundle(rec);
}

// ⚠ `mode` IS REQUIRED AND IS THE ENDPOINT'S. It decides whether what is about
// to be written down is real money, so there is no default that could be right —
// the same reason build() in _checkout.js takes one. A test scans every settle()
// call for it.
async function settle(session, mode) {
  // THE ORGANISATION CHECK, FIRST AND UNCONDITIONALLY.
  if (!S.isOurs(session)) return;

  // ⚠ AND THEN WHICH CONFIGURATION THIS SESSION WAS BUILT FOR. isOurs() answers
  // "is this Ogen's"; this answers "is this Ogen's REAL money", which on a shared
  // account is a second question rather than a refinement of the first. It cannot
  // normally disagree — the session was created with this mode's key and Stripe
  // delivers it to this mode's endpoint — so a disagreement means a key is set to
  // the wrong mode, which is the one misconfiguration that would silently relabel
  // every payment on the site.
  if (S.modeOfObject(session) !== mode) {
    console.error('stripe-webhook[' + mode + ']: a session built for ' +
                  S.modeOfObject(session) + ' arrived here —', session.id, '— nothing settled');
    return;
  }

  // ⚠ WHICH KIND OF DEBT THIS SETTLES, decided before anything is read.
  //
  // A pay-per-session activity charges per evening, on its own attendance blob,
  // and those payments carry `ogen_kind: 'session'` with the date. Settling one
  // against the REGISTRATION would credit a term that owes nothing and leave the
  // evening unpaid — money in the right account against the wrong debt, which is
  // worse than money nobody can place, because nobody goes looking for it.
  const meta = (session && session.metadata) || {};
  if (meta.ogen_kind === 'session') return settleSession(session, meta, mode);
  if (meta.ogen_kind === 'bundle') return settleBundle(session, meta, mode);

  const ref = S.registrationRef(session);
  if (!ref) {
    // Ours, but unattributable. Worth a loud log: somebody paid Ogen and the
    // money cannot be matched to a family without a person looking.
    console.error('stripe-webhook: an Ogen payment carried no registration ref:', session.id);
    return;
  }

  const reg = await store.getRegistration(ref.participantId, ref.activityId);
  if (!reg) {
    console.error('stripe-webhook: no registration for', ref.participantId, ref.activityId, session.id);
    return;
  }

  // BEFORE THE AMOUNT AND BEFORE THE IDEMPOTENCY LIST: a payment in the wrong
  // mode must not even be recorded as counted, or a retry on the right endpoint
  // would find it already settled.
  if (modeRefused(reg, mode, session, 'registration ' + R.key(reg.participantId, reg.activityId))) return;

  const settled = (reg.payment && reg.payment.settledSessions) || [];
  if (settled.indexOf(session.id) !== -1) return;   // already counted

  // Stripe's figure, not ours. Nothing derived from the record being updated.
  const cents = Math.round(Number(session.amount_total) || 0);
  if (!(cents > 0)) {
    console.error('stripe-webhook: session with no amount:', session.id);
    return;
  }

  const paid = (reg.payment.paidCents || 0) + cents;
  const next = R.transition(reg, {
    status: reg.status, by: 'stripe', note: 'paid ' + cents + 'c · ' + session.id
  });
  next.payment = Object.assign({}, next.payment, {
    paidCents: paid,
    paidAt: new Date().toISOString(),
    // FROZEN ON THE PAYMENT, checked above against what the registration was sold
    // in. It is what stops a second payment in the other mode being added to this
    // figure — see paymentModeRefusal(), which reads it back.
    mode: mode,
    // `owed` until it covers what was billed — the same rule the admin's
    // recordPayment follows, and for the same reason: a part payment reading as
    // settled is a debt nobody chases. Stated here rather than shared because
    // the two write different provenance; the RULE must not drift, which is
    // what the test pins.
    status: next.payment.owedCents != null && paid >= next.payment.owedCents ? 'paid' : 'owed',
    settledSessions: settled.concat([session.id]),
    stripeSessionId: session.id,
    stripePaymentIntentId: typeof session.payment_intent === 'string'
      ? session.payment_intent
      : (session.payment_intent && session.payment_intent.id) || null
  });
  await store.saveRegistration(next);

  // THE RECORD IS WRITTEN FIRST, THE EMAIL SENT SECOND, and settle() swallows a
  // failure. The rule this project already follows for money: an email not sent
  // leaves a person wondering, a payment not recorded loses money nobody can
  // trace. So the receipt is best effort and the settlement is not.
  //
  // The outstanding figure is computed here rather than inside the message, so
  // what a family reads and what the registration holds cannot disagree.
  try {
    const account = await accounts.getAccount(next.accountId);
    if (account) {
      const owedCents = next.payment.owedCents;
      const outstanding = owedCents == null ? 0 : Math.max(0, owedCents - paid);
      await mail.sendPaid(next, account, cents, outstanding);
    }
  } catch (err) {
    console.error('stripe-webhook: receipt not sent for', session.id, err && err.message);
  }
}

module.exports.settle = settle;
// What stripe-webhook-test.js is built from.
module.exports.handlerFor = handlerFor;
