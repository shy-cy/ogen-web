// Admin accounts. Blobs store `admin-users`, keyed user-<encodeURIComponent(email)>.
// encodeURIComponent because an email can contain characters that break a key.
// Passwords are bcrypt-hashed at 12 rounds. Plaintext is never stored or logged.

const bcrypt = require('bcryptjs');
const { requireStore, optionalStore } = require('./_blobs');

const ROUNDS = 12;
const key = (email) => 'user-' + encodeURIComponent(String(email).trim().toLowerCase());

// Never leaks passwordHash. Every outward-facing path returns this shape.
function publicUser(u) {
  if (!u) return null;
  return {
    email: u.email, name: u.name, adminRole: u.adminRole,
    active: u.active !== false, createdAt: u.createdAt,
    createdBy: u.createdBy || null, lastLogin: u.lastLogin || null
  };
}

async function getUser(email) {
  if (!email) return null;
  const store = await optionalStore('admin-users');
  if (!store) return null;
  return (await store.get(key(email), { type: 'json' })) || null;
}

async function anyUsersExist() {
  const store = await optionalStore('admin-users');
  if (!store) return false;
  try {
    const { blobs } = await store.list();
    return blobs.length > 0;
  } catch (err) {
    console.warn('[users] list failed:', err.message);
    return false;
  }
}

async function listUsers() {
  const store = await optionalStore('admin-users');
  if (!store) return [];
  const { blobs } = await store.list();
  const out = [];
  for (const b of blobs) {
    const u = await store.get(b.key, { type: 'json' });
    if (u) out.push(publicUser(u));
  }
  return out.sort((a, b) => String(a.email).localeCompare(String(b.email)));
}

async function createUser({ email, name, adminRole, password, createdBy }) {
  const clean = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) throw new Error('A valid email is required');
  if (!password || String(password).length < 8) throw new Error('Password must be at least 8 characters');
  if (await getUser(clean)) throw new Error('An account with that email already exists');

  const store = await requireStore('admin-users');
  const record = {
    email: clean,
    passwordHash: bcrypt.hashSync(String(password), ROUNDS),
    name: name || clean,
    types: ['admin'],
    adminRole: adminRole || 'content-editor',
    active: true,
    createdAt: new Date().toISOString(),
    createdBy: createdBy || null,
    lastLogin: null
  };
  await store.setJSON(key(clean), record);
  return publicUser(record);
}

async function updateUser(email, patch) {
  const existing = await getUser(email);
  if (!existing) throw new Error('No such user');
  const store = await requireStore('admin-users');
  const next = Object.assign({}, existing);
  if (patch.name != null) next.name = patch.name;
  if (patch.adminRole != null) next.adminRole = patch.adminRole;
  if (patch.active != null) next.active = !!patch.active;
  if (patch.password) {
    if (String(patch.password).length < 8) throw new Error('Password must be at least 8 characters');
    next.passwordHash = bcrypt.hashSync(String(patch.password), ROUNDS);
  }
  await store.setJSON(key(email), next);
  return publicUser(next);
}

async function deleteUser(email) {
  const store = await requireStore('admin-users');
  await store.delete(key(email));
}

async function verifyPassword(user, password) {
  if (!user || !user.passwordHash || !password) return false;
  return bcrypt.compareSync(String(password), user.passwordHash);
}

async function noteLogin(email) {
  try {
    const u = await getUser(email);
    if (!u) return;
    const store = await requireStore('admin-users');
    u.lastLogin = new Date().toISOString();
    await store.setJSON(key(email), u);
  } catch (err) {
    console.warn('[users] could not record login:', err.message);
  }
}

module.exports = {
  publicUser, getUser, anyUsersExist, listUsers,
  createUser, updateUser, deleteUser, verifyPassword, noteLogin
};
