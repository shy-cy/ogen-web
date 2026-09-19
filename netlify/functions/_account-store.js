// Guardian accounts. Two stores, and the split is the whole point.
//
//   ogen-accounts        acct-<accountId>              the record
//   ogen-account-emails  email-<encoded lowercased>    the entire login index
//
// IDENTITY IS AN ID, NOT AN EMAIL, and this diverges from the sister project on
// purpose. Shirat HaYam keys members by email — member-<encoded email> — and its
// own source says what that costs: "change my email address has never been
// safely buildable: it would mean moving one person's identity across every
// store atomically." There is a five-phase migration in progress there to reach
// an id. Ogen starts where that migration is trying to arrive.
//
// So an email change here is: write the new pointer, delete the old one, update
// the account. Three writes with no transaction, and the worst outcome is two
// pointers resolving to one account — recoverable by deleting one — rather than
// an identity split across seven stores. That asymmetry is the reason.
//
// bcryptjs at 12 rounds, matching _user-store.js. Plaintext is never stored,
// never logged, and never returned.
//
// ⚠ This file arms the legal gate (tests/registration-waits-for-real-legal-pages.js
// matches a filename starting with "account"), and it should: it is the first
// thing in this project that stores a person's name and email.

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { requireStore, optionalStore } = require('./_blobs');

const ROUNDS = 12;
const LANGS = ['he', 'en', 'ru'];

const ACCOUNTS = 'accounts';
const EMAILS = 'account-emails';

// a- so an account id is distinguishable at a glance from a participant's p-
// and an activity's act-, with no lookup needed to tell what a key refers to.
const mintAccountId = () => 'a-' + crypto.randomBytes(8).toString('hex');

const acctKey = (id) => 'acct-' + String(id);
// encodeURIComponent because an email can contain characters that break a key —
// the same reason _user-store.js does it.
const emailKey = (email) => 'email-' + encodeURIComponent(normaliseEmail(email));

function normaliseEmail(email) {
  return String(email == null ? '' : email).trim().toLowerCase();
}

// Deliberately loose. A stricter pattern rejects addresses that are valid, and
// the only thing that really proves an address works is sending to it.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const validEmail = (email) => EMAIL_RE.test(normaliseEmail(email));

// Eight characters, matching the admin rule. Long enough to matter, short
// enough that nobody writes it on a note beside the screen — and the real
// defence against guessing is the throttle below, not the length.
const MIN_PASSWORD = 8;

// NEVER LEAKS passwordHash, and never the throttle counters either: "your
// password has been wrong 4 times" is a fact about somebody else's typing that
// an attacker holding a stolen session should not be handed.
function publicAccount(a) {
  if (!a) return null;
  return {
    accountId: a.accountId,
    email: a.email,
    status: a.status || 'active',
    emailVerifiedAt: a.emailVerifiedAt || null,
    profile: {
      firstName: (a.profile && a.profile.firstName) || '',
      lastName: (a.profile && a.profile.lastName) || '',
      phone: (a.profile && a.profile.phone) || '',
      preferredLanguage: preferredLanguage(a)
    },
    termsAcceptedAt: a.termsAcceptedAt || null,
    createdAt: a.createdAt || null,
    isoUpdated: a.isoUpdated || null
  };
}

function preferredLanguage(a) {
  const l = a && a.profile && a.profile.preferredLanguage;
  return LANGS.indexOf(l) !== -1 ? l : 'he';
}

// --- reading ---------------------------------------------------------------

async function getAccount(accountId) {
  if (!accountId) return null;
  const store = await optionalStore(ACCOUNTS);
  if (!store) return null;
  return (await store.get(acctKey(accountId), { type: 'json' })) || null;
}

// Sign-in reads the pointer, then the account. Two reads rather than a scan,
// which is the entire reason the pointer store exists.
async function accountIdForEmail(email) {
  if (!validEmail(email)) return null;
  const store = await optionalStore(EMAILS);
  if (!store) return null;
  const row = await store.get(emailKey(email), { type: 'json' });
  return (row && row.accountId) || null;
}

async function getAccountByEmail(email) {
  const id = await accountIdForEmail(email);
  return id ? getAccount(id) : null;
}

// ⚠ EVERY ACCOUNT, AND THE ONLY SCAN IN THIS FILE.
//
// Nothing in the signed-in area ever needs it: a family reads their own record
// through a pointer, which is the whole reason the pointer store exists. This is
// for ONE screen — the admin's list of family accounts — and it is a scan
// because there is no other question being asked. "Show me everyone" has no
// index that would make it cheaper.
//
// It is deliberately not filtered or searched here. The list is small (a
// community centre, not a mailing list) and the alternative is a query language
// on a Blobs store; the screen filters what it is given, and the day this stops
// fitting in one response is the day it needs paging rather than a smarter scan.
async function allAccounts() {
  const store = await optionalStore(ACCOUNTS);
  if (!store) return [];
  const { blobs } = await store.list({ prefix: 'acct-' });
  const out = [];
  for (const b of blobs) {
    const rec = await store.get(b.key, { type: 'json' });
    if (rec) out.push(rec);
  }
  return out.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

// --- creating --------------------------------------------------------------

// Throws with a message meant for a person. The one case it deliberately does
// NOT distinguish is handled by the caller: see createAccount's note on
// enumeration.
function validateNew({ email, password, termsAccepted }) {
  if (!validEmail(email)) throw new Error('A valid email address is required');
  if (!password || String(password).length < MIN_PASSWORD) {
    throw new Error(`Password must be at least ${MIN_PASSWORD} characters`);
  }
  // The account cannot exist without this. /privacy and /terms are published,
  // linked from the footer and final, so there is a document to point at — and
  // the moment somebody's name is stored, when they agreed has to be a fact on
  // the record rather than an assumption about the flow that created it.
  if (termsAccepted !== true) throw new Error('The terms and the privacy policy have to be accepted');
}

async function createAccount(input) {
  const email = normaliseEmail(input && input.email);
  validateNew({ email: email, password: input && input.password,
                termsAccepted: input && input.termsAccepted });

  // Not atomic, and it does not need to be: the pointer is written LAST, so a
  // crash between the two leaves an account nobody can sign in to rather than a
  // pointer to an account that does not exist. The first is invisible and
  // harmless; the second is a sign-in that reads null and has to guess why.
  if (await accountIdForEmail(email)) {
    const err = new Error('An account with that email already exists');
    err.code = 'email-taken';
    throw err;
  }

  const now = new Date().toISOString();
  const record = {
    accountId: mintAccountId(),
    // Duplicated here for display. The pointer store is the index; this is what
    // a page prints without a second read.
    email: email,
    passwordHash: bcrypt.hashSync(String(input.password), ROUNDS),
    status: 'active',
    emailVerifiedAt: null,
    profile: {
      firstName: String((input.profile && input.profile.firstName) || '').trim().slice(0, 80),
      lastName: String((input.profile && input.profile.lastName) || '').trim().slice(0, 80),
      phone: String((input.profile && input.profile.phone) || '').trim().slice(0, 40),
      preferredLanguage: LANGS.indexOf(input.profile && input.profile.preferredLanguage) !== -1
        ? input.profile.preferredLanguage : 'he'
    },
    // A stub until Stripe exists. Named now so that adding payments is a field
    // being filled rather than a shape being changed.
    payment: { provider: null, customerRef: null },
    termsAcceptedAt: now,
    // NO cached balance, now or later. The sister project caches walletBalance
    // on the member and reconciles it against the ledger; that cache is the one
    // thing in its wallet that can drift, and it exists to make a members list
    // cheap to draw. Ogen has no such list, so a balance is summed from the
    // ledger on read and the drift is impossible rather than corrected.
    failedSignIns: 0,
    lockedUntil: null,
    createdAt: now,
    isoUpdated: now
  };

  const accounts = await requireStore(ACCOUNTS);
  await accounts.setJSON(acctKey(record.accountId), record);
  const emails = await requireStore(EMAILS);
  await emails.setJSON(emailKey(email), { accountId: record.accountId });

  return publicAccount(record);
}

// --- updating --------------------------------------------------------------

async function saveAccount(record) {
  const store = await requireStore(ACCOUNTS);
  record.isoUpdated = new Date().toISOString();
  await store.setJSON(acctKey(record.accountId), record);
  return record;
}

async function updateProfile(accountId, patch) {
  const account = await getAccount(accountId);
  if (!account) throw new Error('No such account');
  const p = account.profile || {};
  const next = patch || {};
  account.profile = {
    firstName: next.firstName != null ? String(next.firstName).trim().slice(0, 80) : (p.firstName || ''),
    lastName: next.lastName != null ? String(next.lastName).trim().slice(0, 80) : (p.lastName || ''),
    phone: next.phone != null ? String(next.phone).trim().slice(0, 40) : (p.phone || ''),
    preferredLanguage: LANGS.indexOf(next.preferredLanguage) !== -1
      ? next.preferredLanguage : preferredLanguage(account)
  };
  await saveAccount(account);
  return publicAccount(account);
}

// Write the new pointer, delete the old one, update the account. In that order:
// the new pointer first means a failure halfway leaves the address working from
// both sides rather than from neither.
async function changeEmail(accountId, newEmail) {
  const email = normaliseEmail(newEmail);
  if (!validEmail(email)) throw new Error('A valid email address is required');
  const account = await getAccount(accountId);
  if (!account) throw new Error('No such account');
  if (account.email === email) return publicAccount(account);

  const taken = await accountIdForEmail(email);
  if (taken && taken !== accountId) {
    const err = new Error('An account with that email already exists');
    err.code = 'email-taken';
    throw err;
  }

  const emails = await requireStore(EMAILS);
  await emails.setJSON(emailKey(email), { accountId: accountId });
  const old = account.email;
  account.email = email;
  // A new address has not been proved to work, so it starts unverified however
  // verified the old one was.
  account.emailVerifiedAt = null;
  await saveAccount(account);
  if (old && old !== email) await emails.delete(emailKey(old)).catch(() => {});
  return publicAccount(account);
}

async function setPassword(accountId, password) {
  if (!password || String(password).length < MIN_PASSWORD) {
    throw new Error(`Password must be at least ${MIN_PASSWORD} characters`);
  }
  const account = await getAccount(accountId);
  if (!account) throw new Error('No such account');
  account.passwordHash = bcrypt.hashSync(String(password), ROUNDS);
  // Changing a password clears a lockout: the person has proved, by another
  // route, that the account is theirs.
  account.failedSignIns = 0;
  account.lockedUntil = null;
  await saveAccount(account);
  return publicAccount(account);
}

async function markEmailVerified(accountId) {
  const account = await getAccount(accountId);
  if (!account) return null;
  if (!account.emailVerifiedAt) {
    account.emailVerifiedAt = new Date().toISOString();
    await saveAccount(account);
  }
  return publicAccount(account);
}

// --- signing in ------------------------------------------------------------

// A throttle rather than a lockout ladder, and it is BEST EFFORT by
// construction. Netlify Blobs has no compare-and-swap, so two simultaneous
// failures can write the same counter and one of them is lost. That makes this
// slightly weaker than the number suggests; it does not make it useless, and a
// counter that can undercount is better than no cost at all on guessing a
// password that protects a child's date of birth.
//
// The real answer, when it is wanted, is rate limiting at the edge — which is
// Cloudflare, already in front of this site.
const MAX_FAILED = 8;
const LOCK_MS = 15 * 60 * 1000;

function isLocked(account, now) {
  const until = account && account.lockedUntil;
  return !!(until && (now || Date.now()) < Date.parse(until));
}

// Returns the account record on success and null on every kind of failure.
//
// ONE ANSWER FOR EVERY FAILURE, deliberately. No account, wrong password,
// suspended, locked — the caller cannot tell them apart, so the endpoint cannot
// be used to discover which addresses are registered. That matters more here
// than on the admin: an attacker learning that dana@example.com has an Ogen
// account has learned she has children attending, and where.
async function verifyPassword(email, password) {
  const account = await getAccountByEmail(email);
  const supplied = String(password == null ? '' : password);

  if (!account) {
    // Hash anyway, against a throwaway value. Without it, a missing account
    // answers in a millisecond and a real one takes the ~200ms bcrypt needs,
    // and the difference is measurable over a few hundred requests — which is
    // the same enumeration leak by a slower route.
    bcrypt.compareSync(supplied, '$2a$12$' + 'x'.repeat(53));
    return null;
  }
  if (account.status !== 'active') return null;
  if (isLocked(account)) return null;

  const ok = account.passwordHash && bcrypt.compareSync(supplied, account.passwordHash);
  if (!ok) {
    account.failedSignIns = (Number(account.failedSignIns) || 0) + 1;
    if (account.failedSignIns >= MAX_FAILED) {
      account.lockedUntil = new Date(Date.now() + LOCK_MS).toISOString();
      account.failedSignIns = 0;
    }
    await saveAccount(account).catch(() => {});
    return null;
  }

  if (account.failedSignIns || account.lockedUntil) {
    account.failedSignIns = 0;
    account.lockedUntil = null;
    await saveAccount(account).catch(() => {});
  }
  return account;
}

module.exports = {
  allAccounts,
  ACCOUNTS, EMAILS, ROUNDS, MIN_PASSWORD, MAX_FAILED, LOCK_MS,
  mintAccountId, normaliseEmail, validEmail, publicAccount, preferredLanguage,
  getAccount, getAccountByEmail, accountIdForEmail,
  createAccount, updateProfile, changeEmail, setPassword, markEmailVerified,
  verifyPassword, isLocked, saveAccount,
  _keys: { acctKey, emailKey }
};
