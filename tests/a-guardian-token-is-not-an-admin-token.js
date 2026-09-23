// What this defends against:
//
// This is the first thing Ogen has ever built that stores a person's name, and
// the people are guardians of children. Two failures matter more than the rest,
// and neither of them looks like a bug while it is being written.
//
// 1. ONE TOKEN AUTHENTICATING THE WRONG SYSTEM. A guardian session and an admin
//    session are both "a token in a Blobs store", and the tempting shape is one
//    store with a role on the record. Then the boundary is a check, and a check
//    can be forgotten at one call site out of thirty — and the call site that
//    forgets is a publish endpoint being authenticated by a parent's cookie.
//
//    So they are separate STORES. ogen-admin-sessions is keyed sess-<token>;
//    ogen-member-sessions is keyed msess-<token>. An admin token handed to a
//    guardian endpoint is not found, because it is not there. That is a
//    property of the arrangement rather than a rule anybody has to remember,
//    and this suite is what stops the two being merged later by somebody
//    tidying up.
//
// 2. THE ENDPOINT ANSWERING "does this email have an account?" On the admin that
//    would be untidiness. Here it is not: an attacker who learns that
//    dana@example.com has an Ogen account has learned she has children
//    attending, and roughly where they are on a Wednesday afternoon. So
//    sign-in answers identically for a wrong password and an address nobody has
//    used, and a reset request answers identically whether or not it sent
//    anything.
//
// The rest is the ordinary ways an auth flow leaks or locks somebody out: a
// hash reaching a response, a reset that leaves the thief signed in, a one-time
// link that works twice, a suspended account whose session keeps working.

const H = require('./_helpers');

// _email.js reads FROM at load time and refuses to send without it, so this has
// to be set before the module is required rather than inside the test.
process.env.RESEND_FROM = 'Merkaz Ogen <noreply@ogen.cy>';

(async () => {
  const blobs = H.makeBlobs();
  const sent = [];

  const { 'account-auth': auth, '_account-store': store, '_member-session': member } =
    H.loadWithStubs({ blobs, modules: ['account-auth', '_account-store', '_member-session'] });

  // The one send path, stubbed at the TRANSPORT rather than at _account-email:
  // going through the real send() is what makes "every account message is
  // logged" true in this suite as well as in production. Set after the reload,
  // on the instance the reloaded modules actually hold.
  require(H.fnPath('_email'))._internal.setTransport({
    emails: { send: async (args) => { sent.push(args); return { data: { id: 'test-' + sent.length } }; } }
  });

  const call = (body) => H.call(auth.handler, body);
  const GOOD = { email: 'dana@example.com', password: 'correct-horse', termsAccepted: true,
                 profile: { firstName: 'Dana', preferredLanguage: 'en' } };

  console.log('[an account cannot exist without the terms being accepted]');
  const noTerms = await call(Object.assign({ action: 'signup' }, GOOD, { termsAccepted: false }));
  H.eq(noTerms.status, 400, 'signing up without accepting is refused');
  // The CODE, not the words. The words are trilingual now and this call names
  // no language, so asserting on English would be asserting on the default.
  H.eq(noTerms.body.code, 'terms-required', 'and says why');
  // /privacy and /terms are published, linked from the footer and final, so
  // there is a document to point at. The moment a person's name is stored, WHEN
  // they agreed has to be a fact on the record rather than an assumption about
  // the flow that created it.
  const created = await call(Object.assign({ action: 'signup' }, GOOD));
  H.eq(created.status, 201, 'accepting them creates the account');
  H.ok(!!created.body.account.termsAcceptedAt, 'and the moment of acceptance is stored');

  const memberToken = created.body.token;
  const accountId = created.body.account.accountId;
  H.ok(/^a-[0-9a-f]{16}$/.test(accountId), 'the id is a- prefixed, so it is recognisable at a glance');

  console.log('\n[nothing ever returns a password hash]');
  const bodies = JSON.stringify(created.body);
  H.ok(bodies.indexOf('passwordHash') === -1, 'not from signup');
  H.ok(bodies.indexOf('$2a$') === -1 && bodies.indexOf('$2b$') === -1, 'not in any form');
  const me = await call({ action: 'me', token: memberToken });
  H.ok(JSON.stringify(me.body).indexOf('passwordHash') === -1, 'not from me');
  H.ok(JSON.stringify(me.body).indexOf('failedSignIns') === -1,
    'nor the failure counter — "wrong 4 times" is a fact about somebody else\'s typing');

  console.log('\n[THE BOUNDARY: the two session stores do not see each other]');
  // An admin session, created through the real admin store, in the same Blobs.
  const admin = await H.installSession(blobs, H.superAdminSession());
  const adminStore = require(H.fnPath('_session-store'));

  // Cross-feed the tokens. Neither side should find the other's.
  H.eq(await member.getSession(admin.token), null,
    'an ADMIN token does not authenticate a guardian endpoint');
  const asAdmin = await adminStore.getSession(memberToken);
  H.eq(asAdmin, null, 'and a GUARDIAN token does not authenticate the admin');

  // Through the real HTTP surface, which is where it would actually matter.
  const meAsAdmin = await call({ action: 'me', token: admin.token });
  H.eq(meAsAdmin.status, 401, 'the guardian endpoint refuses an admin token outright');

  // Asserted structurally as well, because the failure this guards against is
  // somebody merging the two stores while keeping both tests passing by adding
  // a role check. Different store, different key prefix.
  H.ok(member.SESSIONS !== 'admin-sessions', 'the stores are different names');
  H.eq(member.SESSIONS, 'member-sessions', 'guardians live in member-sessions');
  H.ok(member._keys.sessKey('x') !== 'sess-x', 'and under a different key prefix');
  H.eq(member._keys.sessKey('x'), 'msess-x', 'msess-, so the two cannot collide in one namespace');

  console.log('\n[sign-in says the same thing however it fails]');
  const wrongPassword = await call({ action: 'signin', email: GOOD.email, password: 'nope' });
  const noSuchAccount = await call({ action: 'signin', email: 'nobody@example.com', password: 'nope' });
  H.eq(wrongPassword.status, noSuchAccount.status, 'same status');
  H.eq(wrongPassword.body.error, noSuchAccount.body.error, 'and the same words, exactly');
  H.eq(wrongPassword.status, 401, 'both 401');
  H.ok(!/exist|unknown|found|registered/i.test(wrongPassword.body.error),
    'and the message never hints that the address is or is not known');

  const good = await call({ action: 'signin', email: GOOD.email, password: GOOD.password });
  H.eq(good.status, 200, 'the right password works');
  H.ok(!!good.body.token, 'and hands back a session');
  H.ok(good.body.token !== memberToken, 'a new one, not the one from signup');

  console.log('\n[a reset request answers the same way whether or not it sent anything]');
  const before = sent.length;
  const real = await call({ action: 'requestReset', email: GOOD.email });
  const fake = await call({ action: 'requestReset', email: 'nobody@example.com' });
  H.eq(real.status, fake.status, 'same status');
  H.eq(real.body.message, fake.body.message, 'and the same words');
  H.eq(sent.length, before + 1, 'but only one email actually went');
  H.eq(sent[sent.length - 1].to[0], GOOD.email, 'to the address that exists');

  console.log('\n[a reset link works once, and takes every other session with it]');
  // Three sessions on the account, standing in for a phone, a laptop and
  // whoever else may be holding one.
  const s1 = (await call({ action: 'signin', email: GOOD.email, password: GOOD.password })).body.token;
  const s2 = (await call({ action: 'signin', email: GOOD.email, password: GOOD.password })).body.token;
  H.ok(!!(await member.getSession(s1)) && !!(await member.getSession(s2)), 'both are live');

  const resetToken = await grabResetToken(blobs);
  H.ok(!!resetToken, 'the reset token was stored');

  // ⚠ A PASSWORD TOO SHORT MUST NOT SPEND THE LINK, and it used to. The token
  // was consumed before the password was looked at, so a typo under the minimum
  // killed the only way back into the account — and every retry, including the
  // tabs somebody already had open, answered that the link was dead. QA reported
  // exactly that: three tabs, three dead links, no password accepted.
  const tooShort = await call({ action: 'resetPassword', token: resetToken, password: 'short' });
  H.eq(tooShort.status, 400, 'a password under the minimum is refused');
  H.eq(tooShort.body.code, 'reset-password-short', 'naming the rule rather than the link');

  const done = await call({ action: 'resetPassword', token: resetToken, password: 'a-brand-new-one' });
  H.eq(done.status, 200, 'and the SAME link still works, which is the whole point');
  // A reset exists because somebody may have LOST CONTROL of the account.
  // Leaving other sessions alive would lock out the owner and leave whoever
  // took it signed in — the exact opposite of what a reset is for.
  H.eq(await member.getSession(s1), null, 'every other session is gone');
  H.eq(await member.getSession(s2), null, 'all of them');
  H.ok(!!(await member.getSession(done.body.token)), 'except the new one it just issued');

  // Long enough to clear the length check, or this would be testing that rule
  // over again rather than testing that a spent link stays spent.
  const reused = await call({ action: 'resetPassword', token: resetToken, password: 'another-good-one' });
  H.eq(reused.status, 400, 'the link cannot be used twice');
  H.eq(reused.body.code, 'reset-link-dead', 'and says so plainly');

  const oldPassword = await call({ action: 'signin', email: GOOD.email, password: GOOD.password });
  H.eq(oldPassword.status, 401, 'the old password no longer works');
  const newPassword = await call({ action: 'signin', email: GOOD.email, password: 'a-brand-new-one' });
  H.eq(newPassword.status, 200, 'the new one does');
  H.ok(sent.some((m) => /changed|שונתה|изменён/i.test(m.subject)),
    'and the owner is told the password changed, which is how they find out if it was not them');

  console.log('\n[a verification link is single use too]');
  const verifyToken = await grabToken(blobs, 'verify');
  H.ok(!!verifyToken, 'signup created one');
  const v1 = await call({ action: 'verifyEmail', token: verifyToken });
  H.eq(v1.status, 200, 'it verifies');
  H.ok(!!v1.body.account.emailVerifiedAt, 'and stamps when');
  const v2 = await call({ action: 'verifyEmail', token: verifyToken });
  H.eq(v2.status, 400, 'and cannot be replayed');

  console.log('\n[the session slides, and dies with the account]');
  const live = await member.getSession(newPassword.body.token);
  H.ok(!!live, 'a fresh session validates');
  H.ok(live.session.expiresAt > Date.now() + 6 * 24 * 3600e3, 'and runs about seven days');
  H.eq(member.SESSION_TTL_MS, 7 * 24 * 60 * 60 * 1000, 'seven days exactly');
  // Long enough for a parent who visits once a month not to be signed out
  // mid-term; short enough that a session left on a shared family laptop dies
  // within a week. Admin sessions stay at 8 hours because they carry publish
  // rights, and the two numbers must not be unified.
  H.ok(member.SESSION_TTL_MS > require(H.fnPath('_session-store')).TTL_MS,
    'and deliberately longer than an admin session, which carries publish rights');

  // Suspending the account ends every session on the next request, rather than
  // at the end of whatever window each one had left.
  const rec = await store.getAccount(accountId);
  rec.status = 'suspended';
  await store.saveAccount(rec);
  H.eq(await member.getSession(newPassword.body.token), null,
    'a suspended account cannot use a session it already had');
  H.eq((await call({ action: 'me', token: newPassword.body.token })).status, 401,
    'and the endpoint refuses it');

  console.log('\n[the email pointer IS the login index]');
  rec.status = 'active';
  await store.saveAccount(rec);
  H.eq(await store.accountIdForEmail('DANA@Example.com '), accountId,
    'lookup is case and whitespace insensitive, or one person has two accounts');
  await store.changeEmail(accountId, 'dana.new@example.com');
  H.eq(await store.accountIdForEmail('dana.new@example.com'), accountId, 'the new pointer resolves');
  H.eq(await store.accountIdForEmail('dana@example.com'), null, 'and the old one is gone');
  const moved = await store.getAccount(accountId);
  H.eq(moved.accountId, accountId, 'the ACCOUNT ID never changed, which is the whole point');
  H.eq(moved.emailVerifiedAt, null,
    'and the new address starts unverified, however verified the old one was');

  H.done();

  // Reach into the token store directly. A test that read the link out of the
  // email body would be testing the copy, and the copy is the part still
  // awaiting a Russian review.
  async function grabToken(b, purpose) {
    const s = b._stores.get('member-tokens');
    if (!s) return null;
    for (const [, v] of s) {
      const r = typeof v === 'string' ? JSON.parse(v) : v;
      if (r && r.purpose === purpose) return r.token;
    }
    return null;
  }
  async function grabResetToken(b) { return grabToken(b, 'reset'); }
})();
