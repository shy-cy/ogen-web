// ogen-account-credits — what an account is owed, and why.
//
//   cred-<accountId>__<ISO>__<random>
//
// APPEND-ONLY. An entry is never edited and never deleted: a ledger that can be
// rewritten is not a ledger. A mistake is corrected by writing the opposite
// entry, which leaves both in the record — that is the point, because the
// question a family asks is not "what is my balance" but "why is it that".
//
// THERE IS NO CACHED BALANCE, now or by default ever. A stored total and a list
// of entries are two representations of one fact on a store with no transaction
// to keep them agreeing, and the sister project's own wallet warns that the
// failure is silent and loses money. The balance is summed from the entries, and
// Ogen's scale is tens of entries per account.
//
// ACCOUNT, THEN TIMESTAMP, THEN A RANDOM TAIL. The account prefix makes a
// balance one scan; the timestamp keeps a person's entries in time order without
// sorting on a field; and the random tail stops two entries written in the same
// millisecond overwriting each other — which matters more here than it would
// elsewhere, because there is no compare-and-swap to fall back on.
//
// INTEGER CENTS EVERYWHERE, and amountCents is ALWAYS POSITIVE — the sign lives
// in `type`. Euros are a display concern; float arithmetic drifts, and a balance
// that drifts is a balance nobody can explain.
//
// ⚠ Arms the legal gate, correctly.

const crypto = require('crypto');
const { requireStore, optionalStore, readMany } = require('./_blobs');
// The mode vocabulary belongs to the select that produces it — an activity's
// listing state — and is not redeclared here. Two lists of two strings is two
// lists that can drift, and this one decides whether money is real.
const { PAYMENT_MODES, normaliseMode } = require('./_activity-listing');

const STORE = 'account-credits';
const PREFIX = 'cred-';
const CURRENCY = 'EUR';

const TYPES = ['credit', 'debit'];

// A CLOSED LIST, so the ledger can be grouped and explained later and so a typo
// cannot invent a category. Adding one is a line here, deliberately.
const REASONS = [
  'registration-cancelled-by-guardian',
  'registration-cancelled-by-admin',
  'credit-applied',        // debit: spent on a later registration
  'admin-adjustment',
  // A bundle we could not honour in full. Written by the nightly pass, only
  // once the activity is genuinely over, at the rate the family PAID — see
  // reconcileBundles() in _registration-sweep.js. It is its own reason rather
  // than an adjustment because nobody adjusted anything: the calendar ran out.
  'bundle-shortfall'
];

const key = (accountId, iso) =>
  PREFIX + accountId + '__' + iso + '__' + crypto.randomBytes(4).toString('hex');

function validate(entry) {
  if (!entry || !entry.accountId) throw new Error('A ledger entry needs an account');
  if (TYPES.indexOf(entry.type) === -1) throw new Error('A ledger entry is a credit or a debit');
  if (REASONS.indexOf(entry.reason) === -1) throw new Error(`Unknown ledger reason "${entry.reason}"`);
  // ⚠ REQUIRED, NOT DEFAULTED, and that is the whole guard against a rehearsal's
  // credit being spent on a real class. A default would read as `live`, which is
  // the right answer for every entry written before modes existed and the WRONG
  // one for every entry a caller forgot — so the caller that cannot say which
  // kind of money this is writes nothing. It is the clock lesson from _credit.js,
  // where five call sites omitted an argument that was optional in syntax and not
  // in meaning; a test scans every append() for a mode.
  if (PAYMENT_MODES.indexOf(entry.mode) === -1) {
    throw new Error('A ledger entry says which payment mode its money is: ' +
                    PAYMENT_MODES.join(' or '));
  }
  const cents = Math.round(Number(entry.amountCents));
  // Zero is refused rather than ignored. A zero entry is a line in a financial
  // record that means nothing and still has to be explained to whoever reads it
  // later — the caller that has nothing to write should write nothing.
  if (!(cents > 0)) throw new Error('A ledger entry is always a positive amount; the sign lives in `type`');
  return cents;
}

async function append(entry) {
  const cents = validate(entry);
  const iso = new Date(entry.createdAt || Date.now()).toISOString();
  const record = {
    accountId: entry.accountId,
    type: entry.type,
    amountCents: cents,
    currency: entry.currency || CURRENCY,
    // ⚠ WHICH KIND OF MONEY. Test-mode credit and real credit sit in the same
    // store under the same account prefix — separate stores were the other option
    // and they would split one person's history in two, which is the thing this
    // ledger exists not to do. What must not mix is the SUMS, and that is
    // balanceOf()'s job below.
    mode: entry.mode,
    reason: entry.reason,
    relatedRegistrationKey: entry.relatedRegistrationKey || null,
    // WHY THIS AMOUNT AND NOT ANOTHER. A family credited 150 out of 350 will
    // ask, and the answer has to be in the record rather than in somebody's
    // memory of what the policy used to be. basisFor() in _credit.js builds it.
    basis: entry.basis || null,
    note: entry.note || null,
    createdAt: iso,
    createdBy: entry.createdBy || null
  };
  const store = await requireStore(STORE);
  const k = key(record.accountId, iso);
  await store.setJSON(k, record);
  return Object.assign({ key: k }, record);
}

async function entriesFor(accountId) {
  const store = await optionalStore(STORE);
  if (!store || !accountId) return [];
  const { blobs } = await store.list({ prefix: PREFIX + accountId + '__' });
  // ⚠ ZIPPED BACK AGAINST ITS KEYS, which is why readMany keeps an empty slot
  // rather than dropping it: an entry carries the key it was written under.
  const keys = blobs.map((b) => b.key);
  const out = (await readMany(store, keys))
    .map((e, i) => (e ? Object.assign({ key: keys[i] }, e) : null))
    .filter(Boolean);
  return out.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

// SUMMED, NEVER STORED. Credits add, debits subtract, and the answer is a number
// that can always be re-derived from the lines above it.
//
// ⚠ ONE BALANCE PER MODE, AND `mode` IS REQUIRED HERE TOO. A single balance
// across both is what would let a €50 rehearsal credit settle a real €50 term —
// so the two are never added together anywhere, and a caller that does not say
// which one it is asking about is asking a question with no answer. Cross-mode
// spending is then refused BY CONSTRUCTION rather than by a check somebody has to
// remember: a live record's spender is handed the live balance, and a test credit
// is simply not in it.
//
// ⚠ AN ENTRY WITH NO MODE IS LIVE. Every entry written before this field existed
// was written when there was one Stripe key, and that key was the real one.
function balanceOf(entries, mode) {
  const want = normaliseMode(mode);
  if (PAYMENT_MODES.indexOf(mode) === -1) {
    throw new Error('A balance is per payment mode: ' + PAYMENT_MODES.join(' or '));
  }
  return (entries || [])
    .filter((e) => normaliseMode(e && e.mode) === want)
    .reduce((n, e) => n + (e.type === 'credit' ? e.amountCents : -e.amountCents), 0);
}

const balanceFor = async (accountId, mode) => balanceOf(await entriesFor(accountId), mode);

module.exports = {
  STORE, PREFIX, TYPES, REASONS, CURRENCY, PAYMENT_MODES,
  append, entriesFor, balanceOf, balanceFor, validate
};
