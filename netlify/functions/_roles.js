// Roles. Built-ins are defined in code and cannot be deleted; custom roles
// live in the Blobs store `admin-roles`, keyed by roleId.
//
// The permission shape is three-axis per tool:
//   { access: bool, edit: ['he','en','ru'], publish: bool }
// which cleanly expresses "may open the tool, may only touch these languages,
// may not publish". Only `activities` exists today; the shape is the same one
// used across three tools on the project this is modelled on, so adding a
// second tool is a key, not a redesign.
//
// Only super-admin is granted right now. ru-reviewer is defined so that
// granting it later is a grant, not a code change.

const { optionalStore, requireStore } = require('./_blobs');

const ALL_LANGS = ['he', 'en', 'ru'];
const TOOLS = ['activities', 'users', 'roles'];

const BUILTIN_ROLES = [
  {
    id: 'super-admin',
    name: 'Super Admin',
    builtin: true,
    permissions: {
      activities: { access: true, edit: ALL_LANGS.slice(), publish: true },
      users: { access: true },
      roles: { access: true }
    }
  },
  {
    id: 'content-editor',
    name: 'Content Editor',
    builtin: true,
    permissions: {
      activities: { access: true, edit: ALL_LANGS.slice(), publish: true },
      users: { access: false },
      roles: { access: false }
    }
  },
  {
    // Defined but not granted. May open Activities, may only edit Russian
    // fields, may never publish — their work lands as a review draft.
    id: 'ru-reviewer',
    name: 'Russian Reviewer',
    builtin: true,
    permissions: {
      activities: { access: true, edit: ['ru'], publish: false },
      users: { access: false },
      roles: { access: false }
    }
  }
];

function builtinRoles() {
  return BUILTIN_ROLES.map((r) => JSON.parse(JSON.stringify(r)));
}

async function listRoles() {
  const roles = builtinRoles();
  const store = await optionalStore('admin-roles');
  if (!store) return roles;
  try {
    const { blobs } = await store.list();
    for (const b of blobs) {
      const custom = await store.get(b.key, { type: 'json' });
      if (custom && custom.id && !roles.some((r) => r.id === custom.id)) {
        roles.push(Object.assign({ builtin: false }, custom));
      }
    }
  } catch (err) {
    console.warn('[roles] could not list custom roles:', err.message);
  }
  return roles;
}

async function getRole(roleId) {
  const all = await listRoles();
  return all.find((r) => r.id === roleId) || null;
}

async function permissionsFor(roleId) {
  const role = await getRole(roleId);
  return role ? role.permissions : {};
}

async function saveRole(role) {
  if (BUILTIN_ROLES.some((r) => r.id === role.id)) {
    throw new Error(`Role "${role.id}" is built in and cannot be modified`);
  }
  const store = await requireStore('admin-roles');
  await store.setJSON(role.id, role);
  return role;
}

module.exports = { ALL_LANGS, TOOLS, builtinRoles, listRoles, getRole, permissionsFor, saveRole };
