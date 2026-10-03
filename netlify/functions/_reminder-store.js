// What was reminded, and who has asked us to stop.
//
//   ogen-reminders   sent-<accountId>__<activityId>__<YYYY-MM-DD>   it went out
//                    off-<accountId>__<activityId>                  stop sending
//
// ⚠ Arms the legal gate, correctly — a key here names an account, which is a
// person, and says which class they are interested in.
//
// ⚠ ONE BLOB PER REMINDER, NOT A LIST ON THE REGISTRATION. A `remindedDates: []`
// growing by one entry a week would make the registration a hot blob rewritten
// on a schedule, on a store with no compare-and-swap, while the whole admin
// writes to the same record — the exact shape _session-attendance.js was split
// out to avoid. A key per fact cannot lose a write to a concurrent one, and
// "have we already sent this" becomes a read of a key we can name rather than a
// scan of anything.
//
// ⚠ THE OPT-OUT IS KEYED BY ACCOUNT AND ACTIVITY, NOT BY REGISTRATION. The
// registration key is participant + activity, so a family with two children in
// one course would have to switch the reminders off twice — and the second
// registration would go on mailing them about a session they had already
// silenced. One email per account per session means one switch per account per
// course.
//
// Sent marks and the opt-out share a store because they share a subject and
// there is no boundary between them: both are facts about one account and one
// activity, and neither authorises anything. The unsubscribe TOKEN does not
// share it — see _reminder-link.js, which repeats the pay link's argument.

const { requireStore, optionalStore, readMany } = require('./_blobs');

const STORE = 'reminders';
const SENT = 'sent-';
const OFF = 'off-';

const enc = (s) => encodeURIComponent(String(s || ''));
const sentKey = (accountId, activityId, date) =>
  SENT + enc(accountId) + '__' + enc(activityId) + '__' + String(date || '');
const offKey = (accountId, activityId) =>
  OFF + enc(accountId) + '__' + enc(activityId);

// ⚠ WRITTEN BEFORE THE SEND, WHICH INVERTS _email.js's OWN RULE.
//
// That rule — send first, log second — is right where the log is a record of
// what happened: losing the record is worse than not sending. Here the mark is
// not a record, it is the thing that stops the loop. A mark with no send costs
// one missed reminder, which is reported. A send with no mark costs the family
// a duplicate EVERY NIGHT until the session passes, because this pass runs again
// tomorrow and finds nothing saying it already went. The recoverable direction
// wins, the same way the ledger is written before the registration.
async function markSent(accountId, activityId, date, extra) {
  const store = await requireStore(STORE);
  await store.setJSON(sentKey(accountId, activityId, date), Object.assign({
    accountId: accountId, activityId: activityId, sessionDate: date,
    at: new Date().toISOString()
  }, extra || {}));
}

async function wasSent(accountId, activityId, date) {
  const store = await optionalStore(STORE);
  if (!store) return false;
  const got = await store.get(sentKey(accountId, activityId, date), { type: 'json' });
  return !!got;
}

// Several at once, in the order asked, because the pass checks one per family
// per session and a loop of awaits is what _blobs.js exists to stop.
async function sentMany(pairs) {
  const store = await optionalStore(STORE);
  if (!store) return pairs.map(() => false);
  const keys = pairs.map((p) => sentKey(p.accountId, p.activityId, p.date));
  // No skipErrors: a store having a bad minute must take the pass down rather
  // than read as "we never told them", which would mail a family twice.
  const got = await readMany(store, keys);
  return got.map((x) => !!x);
}

// ⚠ ABSENT MEANS REMINDERS ARE ON. A family who has never pressed anything has
// not asked for silence, and reading a missing key as "off" would ship a feature
// that mails nobody — which looks exactly like a feature that does not work.
async function isOff(accountId, activityId) {
  const store = await optionalStore(STORE);
  if (!store) return false;
  const got = await store.get(offKey(accountId, activityId), { type: 'json' });
  return !!(got && got.off);
}

async function offMany(pairs) {
  const store = await optionalStore(STORE);
  if (!store) return pairs.map(() => false);
  const keys = pairs.map((p) => offKey(p.accountId, p.activityId));
  // No skipErrors here above all: an unreadable opt-out read as "not opted out"
  // mails somebody who asked us to stop.
  const got = await readMany(store, keys);
  return got.map((x) => !!(x && x.off));
}

// ⚠ TURNING THEM BACK ON WRITES `off: false` RATHER THAN DELETING THE KEY. The
// record of having asked is worth keeping — an admin looking at a family who say
// they get no reminders needs to see that they switched them off and back on,
// and a deleted key says nothing ever happened.
async function setOff(accountId, activityId, off, by) {
  const store = await requireStore(STORE);
  const key = offKey(accountId, activityId);
  const prev = (await store.get(key, { type: 'json' })) || {};
  await store.setJSON(key, Object.assign({}, prev, {
    accountId: accountId, activityId: activityId,
    off: !!off, by: by || 'guardian', at: new Date().toISOString()
  }));
  return { off: !!off };
}

module.exports = {
  STORE, SENT, OFF,
  markSent, wasSent, sentMany, isOff, offMany, setOff,
  _keys: { sentKey, offKey }
};
