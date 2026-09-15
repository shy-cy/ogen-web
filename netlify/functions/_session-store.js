// Sessions. Blobs store `admin-sessions`, keyed sess-<token>.
// authenticate() is the single entry point every admin function opens with.
//
// Auth travels in the request body, not a header, because every endpoint is
// already a POST carrying an action. (Noted as unconventional in the
// architecture this follows; kept for consistency with it.)

const crypto = require('crypto');
const { requireStore, optionalStore } = require('./_blobs');
const { getUser, anyUsersExist } = require('./_user-store');
const { permissionsFor, getRole } = require('./_roles');

// TWO LIMITS, AND THEY ANSWER DIFFERENT QUESTIONS.
//
// IDLE is how long a session survives being unused. It was effectively "until
// the tab closes", because the browser threw the token away — which is not a
// security property at all, it is a browser storage detail that happened to
// look like one. An admin who closed a tab was signed out; an admin who left
// the tab open all week was not. The wrong one of those was being enforced.
//
// ABSOLUTE is the backstop the idle window cannot give: a session that is
// touched every three hours forever never idles out, and publish rights should
// not be indefinite. Twelve hours means an admin signs in about once a day, and
// a session left running overnight is dead by morning however active the
// machine was.
//
// 4h idle is the number the guardian's 7-day window is deliberately NOT. These
// carry publish rights; that one is sized for a parent who visits monthly. A
// test asserts the admin's is the shorter of the two, so nobody can quietly
// unify them.
const IDLE_MS = 4 * 60 * 60 * 1000;
const ABSOLUTE_MS = 12 * 60 * 60 * 1000;
// Legacy name, kept because a test and the client both read it. It is the IDLE
// window, which is what "how long does this session last" meant when there was
// only one number.
const TTL_MS = IDLE_MS;

// Don't rewrite a blob to move a timestamp on every request. Below this, the
// slide is skipped — the same rule the member session follows, at a shorter
// interval because an admin's window is shorter.
const REFRESH_AFTER_MS = 5 * 60 * 1000;

const key = (token) => 'sess-' + token;

// Never later than the absolute cap, whatever the idle window says.
const expiryFor = (createdAt, lastSeenAt) =>
  Math.min(lastSeenAt + IDLE_MS, createdAt + ABSOLUTE_MS);

async function createSession(user) {
  const store = await requireStore('admin-sessions');
  const role = await getRole(user.adminRole);
  const now = Date.now();
  const session = {
    token: crypto.randomUUID(),
    email: user.email,
    name: user.name || user.email,
    role: user.adminRole,
    roleName: role ? role.name : user.adminRole,
    permissions: await permissionsFor(user.adminRole),
    createdAt: now,
    lastSeenAt: now,
    expiresAt: expiryFor(now, now)
  };
  await store.setJSON(key(session.token), session);
  return session;
}

// Re-validates on every call: token exists, not expired, and the underlying
// user still exists and is active. Expired/orphaned tokens are deleted on read
// (lazy cleanup, no sweeper job), so deactivating a user kills their session
// on their next request.
async function getSession(token) {
  if (!token) return null;
  const store = await optionalStore('admin-sessions');
  if (!store) return null;
  const session = await store.get(key(token), { type: 'json' });
  if (!session) return null;

  if (!session.expiresAt || session.expiresAt < Date.now()) {
    await store.delete(key(token)).catch(() => {});
    return null;
  }
  if (!session.legacy) {
    const user = await getUser(session.email);
    if (!user || user.active === false) {
      await store.delete(key(token)).catch(() => {});
      return null;
    }
  }

  // The slide, and it is deliberately AFTER every check above: a session that
  // was going to be refused must not have its clock moved forward on the way
  // out. A record written before this existed has no createdAt, so the absolute
  // cap is measured from now — which gives it a full twelve hours rather than
  // expiring it retroactively, and it is gone within a day either way.
  const now = Date.now();
  const createdAt = session.createdAt || now;
  if (now - (session.lastSeenAt || 0) > REFRESH_AFTER_MS) {
    session.createdAt = createdAt;
    session.lastSeenAt = now;
    session.expiresAt = expiryFor(createdAt, now);
    await store.setJSON(key(token), session).catch(() => {});
  }
  return session;
}

async function destroySession(token) {
  if (!token) return;
  const store = await optionalStore('admin-sessions');
  if (store) await store.delete(key(token)).catch(() => {});
}

// Bootstrap escape hatch. A freshly deployed site with an empty Blobs store
// still works from ADMIN_PASSWORD alone, long enough to create the first real
// account. The moment one user exists the password stops being accepted, so
// there is no chicken-and-egg and no seed script.
function legacySession() {
  return {
    token: 'legacy',
    email: 'legacy@ogen.cy',
    name: 'Setup',
    role: 'super-admin',
    roleName: 'Super Admin',
    legacy: true,
    permissions: {
      activities: { access: true, edit: ['he', 'en', 'ru'], publish: true },
      users: { access: true },
      roles: { access: true }
    },
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    expiresAt: Date.now() + IDLE_MS
  };
}

async function authenticate(body) {
  body = body || {};
  if (body.token) {
    const s = await getSession(body.token);
    if (s) return s;
  }
  if (body.password && process.env.ADMIN_PASSWORD) {
    if (body.password === process.env.ADMIN_PASSWORD && !(await anyUsersExist())) {
      return legacySession();
    }
  }
  return null;
}

// --- permission helpers, all null-safe -------------------------------------
const toolPerm = (session, tool) =>
  (session && session.permissions && session.permissions[tool]) || null;

function canAccess(session, tool) {
  const p = toolPerm(session, tool);
  return !!(p && p.access);
}
function canPublish(session, tool) {
  const p = toolPerm(session, tool);
  return !!(p && p.access && p.publish);
}
function editLangs(session, tool) {
  const p = toolPerm(session, tool);
  return p && Array.isArray(p.edit) ? p.edit.slice() : [];
}
function canEditLang(session, tool, lang) {
  return editLangs(session, tool).indexOf(lang) !== -1;
}
// The `registrations` tool's two extra axes. Written here beside canPublish
// rather than inline in the handler, because a permission test that lives at
// the call site is a permission test one call site can forget.
//
// Both require `access` as well as their own flag: a role that may not open the
// queue may not act on something in it either, however the client asked.
function canApprove(session) {
  const p = toolPerm(session, 'registrations');
  return !!(p && p.access && p.approve);
}
function canCancel(session) {
  const p = toolPerm(session, 'registrations');
  return !!(p && p.access && p.cancel);
}
function isSuperAdmin(session) {
  return !!(session && session.role === 'super-admin');
}

module.exports = {
  TTL_MS, IDLE_MS, ABSOLUTE_MS, REFRESH_AFTER_MS, expiryFor,
  createSession, getSession, destroySession, authenticate, legacySession,
  canAccess, canPublish, editLangs, canEditLang, canApprove, canCancel, isSuperAdmin
};
