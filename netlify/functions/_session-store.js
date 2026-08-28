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

const TTL_MS = 8 * 60 * 60 * 1000;   // 8h — these sessions carry publish rights
const key = (token) => 'sess-' + token;

async function createSession(user) {
  const store = await requireStore('admin-sessions');
  const role = await getRole(user.adminRole);
  const session = {
    token: crypto.randomUUID(),
    email: user.email,
    name: user.name || user.email,
    role: user.adminRole,
    roleName: role ? role.name : user.adminRole,
    permissions: await permissionsFor(user.adminRole),
    expiresAt: Date.now() + TTL_MS
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
    expiresAt: Date.now() + TTL_MS
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
function isSuperAdmin(session) {
  return !!(session && session.role === 'super-admin');
}

module.exports = {
  TTL_MS, createSession, getSession, destroySession, authenticate, legacySession,
  canAccess, canPublish, editLangs, canEditLang, isSuperAdmin
};
