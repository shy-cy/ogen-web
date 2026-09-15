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
const { requireStore, optionalStore } = require('./_blobs');

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
  'admin-adjustment'
];

const key = (accountId, iso) =>
  PREFIX + accountId + '__' + iso + '__' + crypto.randomBytes(4).toString('hex');

function validate(entry) {
  if (!entry || !entry.accountId) throw new Error('A ledger entry needs an account');
  if (TYPES.indexOf(entry.type) === -1) throw new Error('A ledger entry is a credit or a debit');
  if (REASONS.indexOf(entry.reason) === -1) throw new Error(`Unknown ledger reason "${entry.reason}"`);
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
  const out = [];
  for (const b of blobs) {
    const e = await store.get(b.key, { type: 'json' });
    if (e) out.push(Object.assign({ key: b.key }, e));
  }
  return out.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

// SUMMED, NEVER STORED. Credits add, debits subtract, and the answer is a number
// that can always be re-derived from the lines above it.
function balanceOf(entries) {
  return (entries || []).reduce(
    (n, e) => n + (e.type === 'credit' ? e.amountCents : -e.amountCents), 0);
}

const balanceFor = async (accountId) => balanceOf(await entriesFor(accountId));

module.exports = {
  STORE, PREFIX, TYPES, REASONS, CURRENCY,
  append, entriesFor, balanceOf, balanceFor, validate
};
