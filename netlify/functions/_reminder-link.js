// A link that stops the reminders for ONE class and does nothing else.
//
//   ogen-reminder-links   rl-<token>   { accountId, activityId, title, lang }
//
// ⚠ ITS OWN STORE, for the reason _pay-link.js gives at length: a token filed
// beside tokens that mean something else is one forgotten argument away from
// being redeemable as one of them. A store that does not contain the key cannot
// be talked into honouring it, and there is nothing for a call site to remember.
//
// ⚠ THE SCOPE IS STRUCTURAL, NOT CHECKED. The record names exactly one
// activityId and the handler writes exactly one opt-out key from it. There is no
// parameter saying which class, no list, and no path that could reach another
// activity or another kind of email — the same property that makes _checkout.js
// safe to expose with no session: it computes the amount itself rather than
// taking one. "It must not unsubscribe them from anything else" is therefore not
// a rule anybody has to keep.
//
// What holding one lets you do, in full: see one activity's title, and switch
// that activity's session reminders off or on for the account it was issued to.
// It reads back no name, no date of birth, no balance and no other class.
//
// NOT SINGLE USE and long-lived, like the pay link and unlike a reset. A course
// runs for a year, following the link twice must be idempotent, and a family who
// changes their mind needs the same link to put it back.
//
// ⚠ THE TITLE IS FROZEN ONTO THE TOKEN so the endpoint reads NO REPOSITORY. A
// public handler holding a GitHub credential is a different class of thing, for
// a string that only has to name the class somebody is looking at — the same
// decision the check-in token already makes.
//
// ⚠ Arms the legal gate, correctly — a record here names an account.

const crypto = require('crypto');
const { requireStore, optionalStore } = require('./_blobs');

const STORE = 'reminder-links';
const key = (token) => 'rl-' + token;

// 32 bytes from the CSPRNG. It has to be unguessable rather than merely unique:
// a token an admin could reconstruct from an account id is not a secret.
const mintToken = () => crypto.randomBytes(32).toString('base64url');

// ⚠ MINTED PER ACCOUNT AND ACTIVITY, NOT PER MESSAGE.
//
// The pay link mints per message so a re-send does not kill the copy already in
// an inbox. This is the opposite case: a family gets one of these on EVERY
// reminder, twenty-four times over a year, and a token per message would be
// twenty-four live secrets for one switch — all equivalent, none revocable
// without finding the rest. One stable token per (account, activity) is one
// thing to reason about, and every copy in every message is the same link.
async function linkFor(accountId, activityId, title, lang) {
  const store = await requireStore(STORE);
  const existing = await findFor(accountId, activityId);
  if (existing) return existing;
  const record = {
    token: mintToken(),
    accountId: accountId,
    activityId: activityId,
    title: title || null,
    lang: lang || 'he',
    createdAt: new Date().toISOString()
  };
  await store.setJSON(key(record.token), record);
  // A pointer, so the next message finds the same token without scanning a store
  // that holds every family's. Written AFTER the record, so a crash leaves a
  // token nobody can find rather than a pointer to nothing.
  await store.setJSON(ptr(accountId, activityId), { token: record.token });
  return record;
}

const ptr = (accountId, activityId) =>
  'for-' + encodeURIComponent(String(accountId || '')) + '__' +
  encodeURIComponent(String(activityId || ''));

async function findFor(accountId, activityId) {
  const store = await optionalStore(STORE);
  if (!store) return null;
  const p = await store.get(ptr(accountId, activityId), { type: 'json' });
  if (!p || !p.token) return null;
  return await store.get(key(p.token), { type: 'json' });
}

async function readLink(token) {
  if (!token) return null;
  const store = await optionalStore(STORE);
  if (!store) return null;
  return await store.get(key(token), { type: 'json' });
}

module.exports = { STORE, mintToken, linkFor, readLink, findFor, _keys: { key, ptr } };
