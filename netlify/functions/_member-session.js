// Guardian sessions and single-use tokens.
//
//   ogen-member-sessions  msess-<token>   a signed-in guardian
//   ogen-member-tokens    mtok-<token>    one-time links: verify, reset
//
// A STORE COMPLETELY SEPARATE FROM ogen-admin-sessions, and that separation is
// the security boundary this file exists for. A guardian token can never
// authenticate an admin function, and an admin token can never authenticate a
// guardian one — not because each side checks a role, but because each side
// looks in a different store and simply does not find the other's token. A role
// check can be forgotten at one call site; a store that does not contain the
// key cannot be.
//
// Admin sessions stay at 8 hours because they carry publish rights. These run
// for 7 days on a SLIDING window: long enough for a parent who visits once a
// month not to be signed out mid-term, short enough that a session left open on
// a shared family laptop dies within a week.
//
// ⚠ Arms the legal gate, correctly — these sessions belong to people.

const crypto = require('crypto');
const { requireStore, optionalStore, readMany, deleteMany } = require('./_blobs');
const accounts = require('./_account-store');

const SESSIONS = 'member-sessions';
const TOKENS = 'member-tokens';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Long enough to walk to a computer and read an email, short enough that a
// forwarded message stops working before it reaches an inbox it was not meant
// for. Verification is looser than a reset because it grants nothing on its own.
const RESET_TTL_MS = 60 * 60 * 1000;
const VERIFY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const sessKey = (token) => 'msess-' + token;
const tokKey = (token) => 'mtok-' + token;

// 32 bytes of CSPRNG, base64url. These are bearer secrets: whoever holds one is
// the account until it expires, so they are generated the same way a password
// reset link is and never derived from anything about the person.
const mintToken = () => crypto.randomBytes(32).toString('base64url');

// --- sessions --------------------------------------------------------------

async function createSession(account, meta) {
  const store = await requireStore(SESSIONS);
  const now = Date.now();
  const session = {
    token: mintToken(),
    accountId: account.accountId,
    createdAt: new Date(now).toISOString(),
    lastSeenAt: new Date(now).toISOString(),
    expiresAt: now + SESSION_TTL_MS,
    // Recorded for a future "signed in from" list, and for nothing else today.
    userAgent: String((meta && meta.userAgent) || '').slice(0, 200)
  };
  await store.setJSON(sessKey(session.token), session);
  return session;
}

// Re-validates on EVERY call: the token exists, has not expired, and the
// account behind it still exists and is still active. A suspended account stops
// being able to act immediately rather than at the end of its session.
//
// THE WINDOW SLIDES HERE. Each validated read pushes the expiry out another
// seven days, so the clock measures time since the last visit rather than time
// since signing in. The write is skipped unless the session is more than an hour
// old, because otherwise every request rewrites a blob to move a timestamp by
// a few seconds.
async function getSession(token) {
  if (!token) return null;
  const store = await optionalStore(SESSIONS);
  if (!store) return null;

  const session = await store.get(sessKey(token), { type: 'json' });
  if (!session) return null;

  const now = Date.now();
  if (!session.expiresAt || session.expiresAt < now) {
    await store.delete(sessKey(token)).catch(() => {});
    return null;
  }

  const account = await accounts.getAccount(session.accountId);
  if (!account || account.status !== 'active') {
    await store.delete(sessKey(token)).catch(() => {});
    return null;
  }

  const lastSeen = Date.parse(session.lastSeenAt || session.createdAt || 0) || 0;
  if (now - lastSeen > 60 * 60 * 1000) {
    session.lastSeenAt = new Date(now).toISOString();
    session.expiresAt = now + SESSION_TTL_MS;
    await store.setJSON(sessKey(token), session).catch(() => {});
  }

  return { session: session, account: account };
}

async function destroySession(token) {
  if (!token) return;
  const store = await optionalStore(SESSIONS);
  if (store) await store.delete(sessKey(token)).catch(() => {});
}

// Every session belonging to one account. Used when a password changes: a reset
// exists because somebody may have lost control of the account, so every other
// session has to go with it — otherwise the reset locks out the owner and
// leaves whoever took it signed in.
async function destroyAllSessions(accountId, exceptToken) {
  const store = await optionalStore(SESSIONS);
  if (!store) return 0;
  let removed = 0;
  try {
    const { blobs } = await store.list({ prefix: 'msess-' });
    // A reset ends every other session, so this runs while somebody waits at a
    // form. Read them together, then delete the matches together.
    const keys = blobs.map((b) => b.key);
    const rows = await readMany(store, keys);
    const doomed = keys.filter((k, i) => {
      const s = rows[i];
      if (!s || s.accountId !== accountId) return false;
      return !(exceptToken && s.token === exceptToken);
    });
    await deleteMany(store, doomed);
    removed = doomed.length;
  } catch (e) {
    console.warn('[member-session] could not clear sessions: ' + e.message);
  }
  return removed;
}

// The shape every guardian-facing endpoint starts with. Mirrors the admin's
// authenticate(body) so the two read alike, while looking in a different store.
async function authenticate(body) {
  const token = body && body.token;
  if (!token) return null;
  return getSession(token);
}

// --- one-time tokens -------------------------------------------------------

// The token IS the key, so validating a link is one read with no scan. Single
// use: consume() deletes before it returns, so a link that is followed twice —
// by a person and then by their mail client's link scanner — works once.
async function createToken(purpose, accountId, extra) {
  const store = await requireStore(TOKENS);
  const ttl = purpose === 'reset' ? RESET_TTL_MS : VERIFY_TTL_MS;
  const record = Object.assign({
    token: mintToken(),
    purpose: purpose,
    accountId: accountId,
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + ttl
  }, extra || {});
  await store.setJSON(tokKey(record.token), record);
  return record;
}

// Reads, checks, DELETES, then returns. Deleting before returning is what makes
// it single-use even if the caller throws afterwards — the alternative, deleting
// once the caller has finished, leaves a usable token behind on every error.
async function consumeToken(token, purpose) {
  if (!token) return null;
  const store = await optionalStore(TOKENS);
  if (!store) return null;
  const record = await store.get(tokKey(token), { type: 'json' });
  if (!record) return null;
  await store.delete(tokKey(token)).catch(() => {});
  if (purpose && record.purpose !== purpose) return null;
  if (!record.expiresAt || record.expiresAt < Date.now()) return null;
  return record;
}

// Look without consuming, so a page can say "this link has expired" before
// asking for a new password rather than after.
async function peekToken(token, purpose) {
  if (!token) return null;
  const store = await optionalStore(TOKENS);
  if (!store) return null;
  const record = await store.get(tokKey(token), { type: 'json' });
  if (!record) return null;
  if (purpose && record.purpose !== purpose) return null;
  if (!record.expiresAt || record.expiresAt < Date.now()) return null;
  return record;
}

module.exports = {
  SESSIONS, TOKENS, SESSION_TTL_MS, RESET_TTL_MS, VERIFY_TTL_MS,
  mintToken, createSession, getSession, destroySession, destroyAllSessions,
  authenticate, createToken, consumeToken, peekToken,
  _keys: { sessKey, tokKey }
};
