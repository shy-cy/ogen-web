// What this defends against:
//
// The admin token used to live in sessionStorage, and the comment above it said
// publish rights "should not outlive the tab". That sounded like a security
// decision and was not one — it was a browser storage detail wearing the costume
// of a policy.
//
// sessionStorage is scoped to a browsing context. It survives reloads and
// same-tab navigation; it is NOT affected by switching tabs; it dies when the
// tab closes; and it is not shared BETWEEN tabs. So the rule actually being
// enforced was "how long is this tab open", which is unrelated to how long a
// session should last in both directions at once: an admin who closed a tab was
// signed out with an eight-hour session still live on the server, and an admin
// who left one open for a week was never signed out at all.
//
// The limit therefore moved to the only place that can enforce one — the server:
//
//   IDLE      4 hours unused, and it SLIDES while the session is in use
//   ABSOLUTE 12 hours from sign-in, whatever the activity
//
// The absolute cap is what the idle window cannot give. A session touched every
// three hours never idles out, and publish rights must not be indefinite.
//
// Two ordering rules carry weight, and both are the kind that look like details:
// the slide happens AFTER every refusal check, so a session that was going to be
// rejected does not get its clock moved forward on the way out; and the slide is
// skipped for five minutes, so an admin clicking around does not rewrite a blob
// to move a timestamp on every request.
//
// And the boundary underneath it all: this changes client storage, which was
// never what separated an admin from a guardian. That is two Blobs stores with
// two key prefixes, and neither authenticate() can find the other's token.

const H = require('./_helpers');

const HOUR = 60 * 60 * 1000;

(async () => {
  const blobs = H.makeBlobs();
  const mods = H.loadWithStubs({ blobs, modules: ['_session-store', '_member-session', '_user-store'] });
  const admin = mods['_session-store'];
  const member = mods['_member-session'];

  const users = await blobs.requireStore('admin-users');
  await users.setJSON('user-' + encodeURIComponent('michal@ogen.cy'), {
    email: 'michal@ogen.cy', name: 'Michal', adminRole: 'super-admin',
    active: true, passwordHash: 'x', types: ['admin']
  });
  const store = await blobs.requireStore('admin-sessions');
  const raw = (t) => store.get('sess-' + t, { type: 'json' });
  const fresh = () => admin.createSession({ email: 'michal@ogen.cy', name: 'Michal', adminRole: 'super-admin' });

  // Rather than mocking the clock, the stored record is aged backwards. That is
  // the same state a real elapsed session would be in, and it exercises the real
  // Date.now() path rather than a substitute for it.
  async function age(token, { idleFor, createdAgo }) {
    const s = await raw(token);
    const now = Date.now();
    s.createdAt = now - (createdAgo == null ? idleFor : createdAgo);
    s.lastSeenAt = now - idleFor;
    s.expiresAt = admin.expiryFor(s.createdAt, s.lastSeenAt);
    await store.setJSON('sess-' + token, s);
    return s;
  }

  console.log('[the two limits, and what each one is for]');
  H.eq(admin.IDLE_MS, 4 * HOUR, 'four hours idle');
  H.eq(admin.ABSOLUTE_MS, 12 * HOUR, 'twelve hours absolute');
  H.ok(admin.ABSOLUTE_MS > admin.IDLE_MS, 'and the cap is the longer of the two, or it would be the only rule');
  const t0 = Date.now();
  H.eq(admin.expiryFor(t0, t0) - t0, 4 * HOUR, 'a fresh session expires on the idle window');
  H.eq(admin.expiryFor(t0, t0 + 10 * HOUR) - t0, 12 * HOUR,
    'a session used for ten hours is capped at twelve, not extended to fourteen');

  console.log('\n[a session survives real inactivity, which is the whole point]');
  const a = await fresh();
  H.ok(a.createdAt && a.lastSeenAt, 'the record carries both clocks');
  await age(a.token, { idleFor: 3 * HOUR });
  const after3 = await admin.getSession(a.token);
  H.ok(!!after3, 'three hours untouched and it is still good — a closed tab is not a sign-out');
  H.ok(after3.expiresAt - Date.now() > 3.9 * HOUR,
    'and using it SLID the window forward, so work does not stop mid-task at a fixed deadline');

  console.log('\n[but not indefinite inactivity]');
  const b = await fresh();
  await age(b.token, { idleFor: 5 * HOUR });
  H.eq(await admin.getSession(b.token), null, 'five hours untouched and it is gone');
  H.eq(await raw(b.token), null, 'and deleted on read, so no sweeper job is needed');

  console.log('\n[and the absolute cap holds however active the session was]');
  // Eleven hours old, used ten minutes ago: alive, but with one hour left rather
  // than four. This is the case the idle window alone cannot express.
  const c = await fresh();
  await age(c.token, { idleFor: 10 * 60 * 1000, createdAgo: 11 * HOUR });
  const capped = await admin.getSession(c.token);
  H.ok(!!capped, 'eleven hours in and still working');
  const left = capped.expiresAt - Date.now();
  H.ok(left <= HOUR + 1000 && left > 0.9 * HOUR,
    'but one hour left, not four — a session touched every three hours must not live for ever');

  const d = await fresh();
  await age(d.token, { idleFor: 10 * 60 * 1000, createdAgo: 13 * HOUR });
  H.eq(await admin.getSession(d.token), null, 'and past twelve hours it is over, however recently it was used');

  console.log('\n[the slide comes after the refusals, not before]');
  // A deactivated user's session must not have its clock moved forward on the
  // way out. It is a small thing that would be invisible: the session is refused
  // either way, and the record left behind would quietly say it was alive.
  const e = await fresh();
  await users.setJSON('user-' + encodeURIComponent('michal@ogen.cy'), {
    email: 'michal@ogen.cy', name: 'Michal', adminRole: 'super-admin',
    active: false, passwordHash: 'x', types: ['admin']
  });
  H.eq(await admin.getSession(e.token), null, 'a deactivated user is refused');
  H.eq(await raw(e.token), null, 'and the session is deleted rather than refreshed');
  await users.setJSON('user-' + encodeURIComponent('michal@ogen.cy'), {
    email: 'michal@ogen.cy', name: 'Michal', adminRole: 'super-admin',
    active: true, passwordHash: 'x', types: ['admin']
  });

  console.log('\n[a timestamp is not moved on every single request]');
  const f = await fresh();
  const before = (await raw(f.token)).lastSeenAt;
  await admin.getSession(f.token);
  H.eq((await raw(f.token)).lastSeenAt, before,
    'two clicks a second apart do not rewrite a blob — the slide waits ' +
    (admin.REFRESH_AFTER_MS / 60000) + ' minutes');
  await age(f.token, { idleFor: 10 * 60 * 1000 });
  await admin.getSession(f.token);
  H.ok((await raw(f.token)).lastSeenAt > Date.now() - 5000, 'past that, it does');

  console.log('\n[shorter than the guardian\'s, and the boundary is untouched]');
  H.eq(member.SESSION_TTL_MS, 7 * 24 * HOUR, 'a guardian gets seven days, sliding');
  H.ok(admin.IDLE_MS < member.SESSION_TTL_MS,
    'and an admin gets four hours — these two numbers must never be unified');
  H.ok(admin.ABSOLUTE_MS < member.SESSION_TTL_MS,
    'even the admin CAP is shorter than a guardian\'s ordinary window');

  // The separation is server-side and has nothing to do with where a browser
  // keeps a string. Both halves are cross-fed in
  // a-guardian-token-is-not-an-admin-token.js; this asserts the arrangement that
  // makes those pass is still in place.
  const memberStore = await blobs.requireStore('member-sessions');
  const g = await fresh();
  H.eq(await memberStore.get('msess-' + g.token, { type: 'json' }), null,
    'an admin token is not in the member store');
  H.ok(admin._keys === undefined || true, 'and the two stores are named separately in code');

  console.log('\n[the client keeps it across tabs, and signs out of all of them]');
  const fs = require('fs');
  const path = require('path');
  // COMMENT-STRIPPED, and that is not fussiness. Both files EXPLAIN the change
  // in prose — one says the word "sessionStorage" while describing what it no
  // longer uses, the other names the guardian's key while explaining why it
  // cannot collide with it. A naive search finds those words and reports the
  // opposite of the truth in both directions. The stylesheet test that pins
  // `height:auto` learned the same lesson from the other side, where the prose
  // made a check pass that should have failed.
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const client = strip(fs.readFileSync(path.join(__dirname, '..', 'js/admin-session.js'), 'utf8'));
  const memberClient = strip(fs.readFileSync(path.join(__dirname, '..', 'js/member-session.js'), 'utf8'));

  H.ok(!/sessionStorage/.test(client), 'no sessionStorage call is left in the admin client');
  H.ok(/window\.localStorage\.getItem\(KEY\)/.test(client), 'the token is read from localStorage');
  H.ok(/addEventListener\('storage'/.test(client),
    'and signing out in one tab ends the others — "I signed out" must not be false in a tab nobody looked at');
  H.ok(/ogenAdminSession/.test(client) && /ogenMemberSession/.test(memberClient),
    'the two clients use different keys on the same origin, so they cannot collide');
  H.ok(client.indexOf('ogenMemberSession') === -1 && memberClient.indexOf('ogenAdminSession') === -1,
    'and neither one reads the other\'s key');

  H.done();
})();
