// POST /api/admin-users — admin account CRUD. Blobs only, never touches git.
// Gated on the `users` permission, i.e. Super Admin.

const { authenticate, canAccess } = require('./_session-store');
const { listUsers, createUser, updateUser, deleteUser, getUser } = require('./_user-store');
const { listRoles } = require('./_roles');
const { recordAudit } = require('./_audit');

const json = (statusCode, payload) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  body: JSON.stringify(payload)
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (err) { return json(400, { error: 'Body must be JSON' }); }

  const session = await authenticate(body);
  if (!session) return json(401, { error: 'Unauthorized' });
  if (!canAccess(session, 'users')) return json(403, { error: 'Only a Super Admin can manage accounts' });

  try {
    switch (body.action) {
      case 'list':
        return json(200, { ok: true, users: await listUsers(), roles: await listRoles() });

      case 'create': {
        const user = await createUser({
          email: body.email, name: body.name,
          adminRole: body.adminRole, password: body.password,
          createdBy: session.email
        });
        await recordAudit(session, 'create-user', user.email, 'ok', { role: user.adminRole });
        return json(200, { ok: true, user });
      }

      case 'update': {
        const user = await updateUser(body.email, {
          name: body.name, adminRole: body.adminRole,
          active: body.active, password: body.password
        });
        await recordAudit(session, 'update-user', user.email, 'ok');
        return json(200, { ok: true, user });
      }

      case 'delete': {
        const target = String(body.email || '').trim().toLowerCase();
        if (target === session.email) return json(400, { error: 'You cannot delete your own account' });
        if (!(await getUser(target))) return json(404, { error: 'No such user' });
        await deleteUser(target);
        await recordAudit(session, 'delete-user', target, 'ok');
        return json(200, { ok: true });
      }

      default:
        return json(400, { error: `Unknown action "${body.action}"` });
    }
  } catch (err) {
    console.error('[admin-users]', err);
    return json(400, { error: err.message });
  }
};
