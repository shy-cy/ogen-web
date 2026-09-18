// ogen-bundles — one record per bundle a family has bought.
//
//   bun-<participantId>__<activityId>__<ISO>
//
// ⚠ THE PARTICIPANT AND THE ACTIVITY ARE BOTH IN THE KEY, and that is how "not
// shareable" and "not usable on another activity" are enforced. They are not
// checks somebody has to remember at each call site: a lookup for a different
// participant or a different activity simply does not find the record. Same
// argument as the two session stores, whose separation is a key prefix rather
// than a role on a record.
//
// The timestamp is third so one family's bundles for one activity are a prefix
// scan in purchase order — which is also the order they are spent in, oldest
// first, so the one closest to expiring is used before the one that is not.
//
// MORE THAN ONE IS ORDINARY. A family can buy a second bundle when the first
// runs out, and both can be live at once.
//
// ⚠ Arms the legal gate, correctly — a record here names a participant.

const { requireStore, optionalStore } = require('./_blobs');
const B = require('./_bundle');

const STORE = 'bundles';
const PREFIX = 'bun-';

const prefixFor = (participantId, activityId) => PREFIX + participantId + '__' + activityId + '__';

async function saveBundle(bundle) {
  const store = await requireStore(STORE);
  bundle.isoUpdated = new Date().toISOString();
  await store.setJSON(prefixFor(bundle.participantId, bundle.activityId) + bundle.purchasedAt, bundle);
  return bundle;
}

// One bundle by its own key. The purchase timestamp is the third part of the
// key, so this is what makes settling a payment idempotent: a redelivered Stripe
// event finds the record already there and writes nothing over a bundle whose
// entries may since have been spent.
async function getBundle(participantId, activityId, purchasedAt) {
  const store = await optionalStore(STORE);
  if (!store || !participantId || !activityId || !purchasedAt) return null;
  return store.get(prefixFor(participantId, activityId) + purchasedAt, { type: 'json' });
}

// Every bundle this participant holds for this activity, oldest first.
async function forParticipant(participantId, activityId) {
  const store = await optionalStore(STORE);
  if (!store || !participantId || !activityId) return [];
  const { blobs } = await store.list({ prefix: prefixFor(participantId, activityId) });
  const out = [];
  for (const b of blobs.sort((x, y) => x.key.localeCompare(y.key))) {
    const rec = await store.get(b.key, { type: 'json' });
    if (rec) out.push(rec);
  }
  return out;
}

// Every bundle for an activity, which is what the nightly pass and the admin
// roster read. A list()-and-filter, the same shape forActivity() already uses
// for attendance.
async function forActivity(activityId) {
  const store = await optionalStore(STORE);
  if (!store || !activityId) return [];
  const { blobs } = await store.list({ prefix: PREFIX });
  const out = [];
  for (const b of blobs) {
    if (b.key.indexOf('__' + activityId + '__') === -1) continue;
    const rec = await store.get(b.key, { type: 'json' });
    if (rec) out.push(rec);
  }
  return out;
}

// The bundle an entry should be spent from for one evening: the OLDEST that
// still covers it. Oldest first because a bundle has a window, and spending the
// one closest to expiring first is the only order that does not strand entries.
async function spendableFor(participantId, activityId, sessionDate) {
  const all = await forParticipant(participantId, activityId);
  return all.filter((b) => B.covers(b, sessionDate))[0] || null;
}

// FROZEN AT PURCHASE, like everything else a family agrees to. An admin editing
// the bundle's price or its window in March cannot change what somebody bought
// in January — the record carries its own terms and nothing reads the activity
// to find them again.
function newBundle({ participantId, activityId, accountId, bundle, coveredDates, purchasedAt, paymentRef }) {
  const iso = new Date(purchasedAt).toISOString();
  return {
    bundleId: bundle.bundleId,
    participantId: participantId,
    activityId: activityId,
    accountId: accountId,
    purchasedAt: iso,
    frozen: {
      entries: bundle.entries,
      pricePerEntry: bundle.pricePerEntry,
      validityDays: bundle.validityDays,
      totalCents: B._eur(bundle.pricePerEntry) * bundle.entries,
      // The deadline as an instant, frozen — so a reschedule six weeks later is
      // bounded by the window that was sold rather than by one recomputed from
      // a validityDays somebody has edited since.
      validUntil: new Date(purchasedAt).getTime() + bundle.validityDays * B.DAY_MS
    },
    coveredDates: coveredDates.slice(),
    usedDates: [],
    status: 'active',
    paymentRef: paymentRef || null,
    shortfallCreditedCents: 0,
    history: [{ iso: iso, action: 'purchased', by: accountId, note: null }],
    isoUpdated: iso
  };
}

module.exports = { STORE, PREFIX, saveBundle, getBundle, forParticipant, forActivity, spendableFor, newBundle,
                   _keys: { prefixFor } };
