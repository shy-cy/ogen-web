// A link that pays ONE registration and does nothing else.
//
//   ogen-pay-links   pay-<token>   { participantId, activityId, accountId, lang }
//
// ⚠ ITS OWN STORE, and that is the whole security argument.
//
// The obvious implementation is `createToken('pay', …)` in _member-session.js:
// same shape, same TTL machinery, no new file. It is refused for exactly the
// reason the admin and member SESSION stores are refused a merge — a token
// sitting beside password-reset tokens is one forgotten `purpose` check away
// from being redeemable as one. `consumeToken(token)` takes the purpose as an
// OPTIONAL argument; the call that forgets it turns a forwarded payment link
// into an account takeover. A store that does not contain the key cannot be
// talked into honouring it, and there is nothing to remember.
//
// What holding one lets you do, in full: start a Stripe Checkout for the amount
// outstanding on one approved registration. It reads nothing back to the
// holder — the endpoint's only successful answer is a 302 to Stripe — so a
// forwarded email discloses no more than the email itself already did.
//
// NOT SINGLE USE, deliberately, which is the one place it parts company with
// the reset and verify tokens. Those grant something once; this one names a
// debt, and a debt can legitimately be looked at twice — a family interrupted
// halfway through Checkout, or paying the balance a week after a part payment,
// must not find the link dead. It stops working when the debt does: the
// endpoint re-reads the registration every time, so a settled or cancelled one
// has nothing to charge for.
//
// ⚠ Arms the legal gate, correctly — a record here names a participant.

const crypto = require('crypto');
const { requireStore, optionalStore } = require('./_blobs');

const STORE = 'pay-links';

// Thirty days, matching a guardian invitation rather than a password reset. A
// reset is minutes of work by somebody sitting at a screen; a payment waits on
// a household, a payday and a conversation. Shorter than that and the link
// expires precisely for the family slowest to pay, who are the ones it is
// meant to help.
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

const key = (token) => 'pay-' + token;

// 32 bytes of CSPRNG, base64url, exactly as the session and reset tokens are
// made. It is a bearer secret and is never derived from anything about the
// registration — a token an admin could reconstruct from a participant id is
// not a secret.
const mintToken = () => crypto.randomBytes(32).toString('base64url');

// Minted per message rather than per registration, so a re-send does not
// invalidate the copy already in somebody's inbox. Several live tokens for one
// registration is harmless: each is scoped to the same single debt, and the
// debt is what decides whether any of them still does anything.
async function createPayLink(reg, lang) {
  const store = await requireStore(STORE);
  const record = {
    token: mintToken(),
    participantId: reg.participantId,
    activityId: reg.activityId,
    accountId: reg.accountId || null,
    lang: lang || 'he',
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + TTL_MS
  };
  await store.setJSON(key(record.token), record);
  return record;
}

// Read, never consume. Expiry is lazy, the same way an unaccepted guardian
// invitation expires: an expired token grants nothing, so there is nothing for
// a sweep to make safe.
async function readPayLink(token) {
  if (!token) return null;
  const store = await optionalStore(STORE);
  if (!store) return null;
  const record = await store.get(key(token), { type: 'json' });
  if (!record) return null;
  if (!record.expiresAt || record.expiresAt < Date.now()) return null;
  return record;
}

module.exports = { STORE, TTL_MS, createPayLink, readPayLink, mintToken, _key: key };
