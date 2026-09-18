// The QR code's other half: one token, one activity, one evening.
//
//   ogen-checkin-tokens   chk-<token>   { activityId, sessionDate, expiresAt }
//
// ⚠ ITS OWN STORE, for the reason _pay-link.js gives at length and for one more
// of its own. A token that can be photographed off a wall must not be filed
// beside anything that grants more than it does — and this one is weaker than a
// pay link, which is weaker than a session. Three capabilities, three stores,
// and none of them can be mistaken for another by a lookup that forgot an
// argument.
//
// REUSABLE, AND DELIBERATELY SO. Twenty people scan the same poster. Single use
// is the wrong shape here in a way it is not for a reset link; what bounds this
// one is the DAY it names, not the number of times it is read.
//
// ⚠ IT DIES WHEN ITS SESSION'S DAY ENDS, in Asia/Nicosia, through the same
// endOfDay() the cancellation cutoffs use rather than a second timezone. That is
// the guard that stops a photographed QR code becoming a standing key to a
// register: it is a key to ONE evening, and by the following morning it opens
// nothing. A UTC day-end would kill it two or three hours early, which on a
// Tuesday-evening class is the class itself.
//
// One token per activity per date, not per print. Re-opening the admin panel
// must show the SAME code as the sheet already pinned to the wall, or a printed
// poster silently stops working the next time somebody looks at the screen — so
// the key is derived from the pair and the token is minted once.
//
// ⚠ Arms the legal gate, correctly — what a token opens is a list of children.

const crypto = require('crypto');
const { requireStore, optionalStore } = require('./_blobs');
const credit = require('./_credit');

const STORE = 'checkin-tokens';

const key = (token) => 'chk-' + token;
// The pointer that makes minting idempotent. Its own prefix so a list() over
// tokens never trips over one.
const pointerKey = (activityId, date) => 'for-' + activityId + '__' + date;

const mintToken = () => crypto.randomBytes(32).toString('base64url');

// The end of the session's own day, in Cyprus. `endOfDay` returns the instant;
// `past()` is what compares it, and both come from _credit.js so there is one
// answer on this site to "when does a day end".
const expiryFor = (sessionDate) => credit.endOfDay(sessionDate, credit.TZ);

// Minted once per (activity, date) and returned unchanged afterwards, so the
// code on the wall and the code on the screen are the same code.
// THE TITLE AND SLUG ARE FROZEN ONTO THE TOKEN, which is what lets the public
// endpoint answer without reading the repository at all. A public handler that
// opens GitHub to render a poster is a public handler with a credential in
// reach of it, for a string that was printed weeks ago and cannot change on the
// wall anyway. Same instinct as the frozen block on a registration: what was
// agreed is what is shown.
async function codeFor(activity, sessionDate) {
  const activityId = activity.activityId;
  const store = await requireStore(STORE);
  const ptr = await store.get(pointerKey(activityId, sessionDate), { type: 'json' });
  if (ptr && ptr.token) {
    const existing = await store.get(key(ptr.token), { type: 'json' });
    if (existing) return existing;
  }
  const record = {
    token: mintToken(),
    activityId: activityId,
    slug: activity.slug,
    title: activity.title,
    sessionDate: sessionDate,
    createdAt: new Date().toISOString(),
    expiresAt: expiryFor(sessionDate)
  };
  await store.setJSON(key(record.token), record);
  // The pointer second: a crash between the two costs one orphaned token and
  // mints another next time, where the other order would leave a pointer at
  // nothing and a panel that shows no code at all.
  await store.setJSON(pointerKey(activityId, sessionDate), { token: record.token });
  return record;
}

// Expiry is lazy and read-side, as everywhere else here. `expiresAt` is null
// only for a record whose date could not be parsed, which is a bug in the
// writer — and reading it as "never expires" would be the wrong direction for
// the one token on this site that is designed to be photographed.
async function readCode(token, now) {
  if (!token) return null;
  const store = await optionalStore(STORE);
  if (!store) return null;
  const record = await store.get(key(token), { type: 'json' });
  if (!record) return null;
  const at = now == null ? Date.now() : now;
  if (!record.expiresAt || at > record.expiresAt) return null;
  return record;
}

module.exports = { STORE, codeFor, readCode, mintToken, expiryFor, _keys: { key, pointerKey } };
