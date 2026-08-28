// POST /api/admin-login — { action: 'login' | 'logout' | 'session' }

const { getUser, verifyPassword, noteLogin, anyUsersExist } = require('./_user-store');
const { createSession, destroySession, authenticate, legacySession } = require('./_session-store');
const { recordAudit } = require('./_audit');

const json = (statusCode, payload) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  body: JSON.stringify(payload)
});

const publicSession = (s) => ({
  token: s.token, name: s.name, email: s.email,
  role: s.role, roleName: s.roleName,
  permissions: s.permissions, expiresAt: s.expiresAt, legacy: !!s.legacy
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST' });

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (err) { return json(400, { error: 'Body must be JSON' }); }

  try {
    if (body.action === 'logout') {
      await destroySession(body.token);
      return json(200, { ok: true });
    }

    if (body.action === 'session') {
      const s = await authenticate(body);
      return s ? json(200, { ok: true, session: publicSession(s) }) : json(401, { error: 'Unauthorized' });
    }

    if (body.action !== 'login') return json(400, { error: `Unknown action "${body.action}"` });

    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    // Bootstrap: with no accounts yet, ADMIN_PASSWORD alone gets a Super Admin
    // session — just long enough to create the first real one. The moment a
    // user exists this stops being accepted.
    if (!(await anyUsersExist())) {
      if (process.env.ADMIN_PASSWORD && password === process.env.ADMIN_PASSWORD) {
        const s = legacySession();
        await recordAudit(s, 'login', 'legacy', 'ok');
        return json(200, { ok: true, session: publicSession(s), setupMode: true });
      }
      return json(401, { error: 'Incorrect password' });
    }

    const user = await getUser(email);
    if (!user || user.active === false || !(await verifyPassword(user, password))) {
      // Deliberately identical for unknown email and wrong password.
      await recordAudit(null, 'login', email, 'failed');
      return json(401, { error: 'Incorrect email or password' });
    }

    const session = await createSession(user);
    await noteLogin(email);
    await recordAudit(session, 'login', email, 'ok');
    return json(200, { ok: true, session: publicSession(session) });
  } catch (err) {
    console.error('[admin-login]', err);
    return json(500, { error: err.message });
  }
};
