// The only place a Netlify Blobs store is opened.
//
// Prefers explicit siteID + token over the automatic runtime context: the
// automatic context can resolve to a non-durable deploy-scoped store, which
// looks like it works and then loses everything on the next deploy.

// Every store name is prefixed with the project, so Ogen's admin data can
// never share a namespace with another project's.
//
// This is not hypothetical: during setup, the credentials configured here
// reached a store that already held another site's `admin-users`,
// `page-drafts` and `admin-audit` entries. Un-prefixed, that would have let
// that site's admin accounts sign into the Ogen admin and publish to the Ogen
// repo. Prefixing removes the possibility whatever the credentials resolve to.
const STORE_PREFIX = 'ogen-';

const SITE_ID = process.env.NETLIFY_BLOBS_SITE_ID || process.env.SITE_ID;
const TOKEN = process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN;

let getStore = null;
async function loadGetStore() {
  if (!getStore) ({ getStore } = await import('@netlify/blobs'));
  return getStore;
}

function opts(name) {
  const base = { name: STORE_PREFIX + name, consistency: 'strong' };
  if (SITE_ID && TOKEN) return Object.assign(base, { siteID: SITE_ID, token: TOKEN });
  return base;
}

// Use where a misconfiguration should surface loudly — i.e. writes.
async function requireStore(name) {
  if (!SITE_ID || !TOKEN) {
    // Fall through to the ambient context, but say so clearly if it also fails.
    try {
      const g = await loadGetStore();
      return g(opts(name));
    } catch (err) {
      throw new Error(
        `Blobs store "${name}" unavailable. Set NETLIFY_BLOBS_SITE_ID and ` +
        `NETLIFY_BLOBS_TOKEN (netlify env:set). Underlying error: ${err.message}`
      );
    }
  }
  const g = await loadGetStore();
  return g(opts(name));
}

// Use where the path should degrade quietly — reads, best-effort writes.
async function optionalStore(name) {
  try {
    return await requireStore(name);
  } catch (err) {
    console.warn(`[blobs] store "${name}" unavailable: ${err.message}`);
    return null;
  }
}

// ⚠ READING A LIST ONE BLOB AT A TIME IS THE SLOWEST WAY TO READ A LIST.
//
// Every store here has the same shape of query: list() the keys under a prefix,
// then open each one. Each open is a network round trip to the Blobs service,
// and each was being awaited before the next was asked for — so a family with
// three participants and two registrations each paid about fifteen round trips
// end to end, in series, on every load of their dashboard. Nothing was wrong
// with any one of them; they were simply queued behind each other.
//
// This is the same lesson `_github.js` already learned on the publish path —
// "don't reintroduce a per-file await in a loop here" — arriving one service
// later. The fix is the same: ask for several at once, with a cap.
//
// EIGHT, matching the spirit of _github.js's six. The cap is not about our
// patience, it is about not opening forty sockets from one function and being
// throttled for it; and a family's list is single figures anyway, so in the
// case this exists for the cap never binds.
const READ_CONCURRENCY = 8;

// ⚠ IT RETURNS ONE SLOT PER KEY, INCLUDING THE EMPTY ONES, and callers filter.
// Dropping them here would silently shorten the array and break any caller
// zipping it back against its keys — which the ledger does, because an entry
// carries the key it was written under.
//
// ⚠ AND A FAILED READ STILL THROWS. The loops this replaces dropped a MISSING
// blob and let a broken one take the request down, which is right: a store
// having a bad minute must not quietly hand a family a shorter list of their
// own registrations. Promise.all keeps that exactly — first rejection wins.
//
// `skipErrors` is the one exception and has exactly one caller: the email log,
// which would rather lose a single unreadable entry than lose the history. It
// is opt-in precisely BECAUSE it is the dangerous default — a family's list of
// their own registrations must never come back quietly short.
async function readMany(store, keys, opts) {
  const skip = !!(opts && opts.skipErrors);
  const out = new Array(keys.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= keys.length) return;
      out[i] = skip
        ? await store.get(keys[i], { type: 'json' }).catch(() => null)
        : await store.get(keys[i], { type: 'json' });
    }
  };
  const lanes = Math.min(READ_CONCURRENCY, keys.length);
  await Promise.all(new Array(lanes).fill(0).map(worker));
  return out;
}

// The same, for the deletes that follow a participant out of the system. Best
// effort per key, exactly as the loops it replaces were: one key that will not
// go must not leave the rest behind it.
async function deleteMany(store, keys) {
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= keys.length) return;
      await store.delete(keys[i]).catch(() => {});
    }
  };
  const lanes = Math.min(READ_CONCURRENCY, keys.length);
  await Promise.all(new Array(lanes).fill(0).map(worker));
  return keys.length;
}

module.exports = { requireStore, optionalStore, STORE_PREFIX, readMany, deleteMany, READ_CONCURRENCY };
