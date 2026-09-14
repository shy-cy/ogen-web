// /api/account-auth — everything a guardian can do before they have anything.
//
// Actions: signup | signin | signout | me | requestReset | resetPassword |
//          verifyEmail | resendVerification | updateProfile | changePassword
//
// There is no interface in front of this yet, by design: the whole flow is
// testable end to end with no page at all, and building it that way is what
// keeps the family-facing area a rendering job rather than a place where policy
// gets re-decided.
//
// TWO RULES RUN THROUGH ALL OF IT.
//
// 1. NOTHING HERE REVEALS WHETHER AN EMAIL HAS AN ACCOUNT. Sign-in answers the
//    same way for a wrong password and an address nobody has used; a reset
//    request answers the same way whether or not it sent anything. On the admin
//    this would be tidiness. Here it is not: an attacker learning that
//    dana@example.com has an Ogen account has learned that she has children
//    attending, and roughly where they are on a Wednesday afternoon.
//
// 2. AN EMAIL FAILURE NEVER BLOCKS THE ACTION IT ACCOMPANIES. The account is
//    created, the password is changed, and the message about it is best effort —
//    settle() in _account-email.js. A person left unable to sign up because a
//    mail provider is down is worse than a person who has to ask for the link
//    again.

const accounts = require('./_account-store');
const sessions = require('./_member-session');
const mail = require('./_account-email');

const json = (statusCode, payload) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  body: JSON.stringify(payload)
});

// One sentence, one shape, for every way signing in can fail. See rule 1.
const SIGNIN_FAILED = 'That email address and password do not match an account.';

// The answer a reset request always gives, whether or not anything was sent.
const RESET_SENT = 'If that address has an account, a reset link is on its way.';

async function requireSession(body) {
  const found = await sessions.authenticate(body);
  return found || null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    return json(400, { error: 'Body must be JSON' });
  }

  const agent = (event.headers && (event.headers['user-agent'] || event.headers['User-Agent'])) || '';

  try {
    switch (body.action) {
      // --- creating an account --------------------------------------------
      case 'signup': {
        let account;
        try {
          account = await accounts.createAccount({
            email: body.email,
            password: body.password,
            termsAccepted: body.termsAccepted,
            profile: body.profile
          });
        } catch (err) {
          // The ONE place this endpoint knowingly leaks that an address is
          // taken, and it is unavoidable: a sign-up form that accepts a
          // duplicate silently has created nothing and told the person their
          // account is ready. The mitigation is that sign-up is the loudest,
          // slowest, most rate-limitable action here, not that the leak is
          // pretended away.
          if (err.code === 'email-taken') return json(409, { error: err.message });
          return json(400, { error: err.message });
        }

        // A fresh session immediately: making somebody sign in again with the
        // password they typed ten seconds ago is a step that exists only
        // because it was easier to build.
        const full = await accounts.getAccount(account.accountId);
        const session = await sessions.createSession(full, { userAgent: agent });

        const token = await sessions.createToken('verify', account.accountId);
        await mail.sendVerify(full, token.token);

        return json(201, {
          ok: true, token: session.token, expiresAt: session.expiresAt, account: account
        });
      }

      // --- signing in -------------------------------------------------------
      case 'signin': {
        const account = await accounts.verifyPassword(body.email, body.password);
        // verifyPassword returns null for every kind of failure — no account,
        // wrong password, suspended, locked — so there is nothing here to
        // accidentally distinguish between them.
        if (!account) return json(401, { error: SIGNIN_FAILED });
        const session = await sessions.createSession(account, { userAgent: agent });
        return json(200, {
          ok: true, token: session.token, expiresAt: session.expiresAt,
          account: accounts.publicAccount(account)
        });
      }

      case 'signout': {
        await sessions.destroySession(body.token);
        // Always 200. Signing out a token that was already dead is not an error
        // from the caller's point of view — they wanted to be signed out, and
        // they are.
        return json(200, { ok: true });
      }

      case 'me': {
        const found = await requireSession(body);
        if (!found) return json(401, { error: 'Not signed in' });
        return json(200, {
          ok: true,
          account: accounts.publicAccount(found.account),
          expiresAt: found.session.expiresAt
        });
      }

      // --- passwords --------------------------------------------------------
      case 'requestReset': {
        const account = await accounts.getAccountByEmail(body.email);
        if (account && account.status === 'active') {
          const token = await sessions.createToken('reset', account.accountId);
          await mail.sendReset(account, token.token);
        }
        // Same answer either way, and the same 200. See rule 1.
        return json(200, { ok: true, message: RESET_SENT });
      }

      case 'resetPassword': {
        const record = await sessions.consumeToken(body.token, 'reset');
        if (!record) {
          return json(400, { error: 'That reset link has expired or has already been used. Ask for a new one.' });
        }
        try {
          await accounts.setPassword(record.accountId, body.password);
        } catch (err) {
          // The token is already consumed at this point, which is deliberate —
          // see consumeToken. A weak password means asking for a new link, and
          // that is the safe direction: the alternative is a token that survives
          // repeated attempts.
          return json(400, { error: err.message + '. Ask for a new reset link and try again.' });
        }

        // EVERY OTHER SESSION GOES. A reset exists because somebody may have
        // lost control of the account; leaving other sessions alive would lock
        // out the owner and leave whoever took it signed in.
        await sessions.destroyAllSessions(record.accountId);

        const account = await accounts.getAccount(record.accountId);
        await mail.sendPasswordChanged(account);

        // Signed in on the new password, on a session minted after the purge.
        const session = await sessions.createSession(account, { userAgent: agent });
        return json(200, {
          ok: true, token: session.token, expiresAt: session.expiresAt,
          account: accounts.publicAccount(account)
        });
      }

      case 'changePassword': {
        const found = await requireSession(body);
        if (!found) return json(401, { error: 'Not signed in' });
        // The current password is required even though the session proves who
        // they are. A session on a shared laptop is not the same evidence as
        // knowing the password, and this is the action that would lock the
        // owner out.
        const ok = await accounts.verifyPassword(found.account.email, body.currentPassword);
        if (!ok) return json(403, { error: 'That is not your current password.' });
        try {
          await accounts.setPassword(found.account.accountId, body.newPassword);
        } catch (err) {
          return json(400, { error: err.message });
        }
        // Every session except this one: the person is standing here and should
        // not be signed out of the device they are using.
        await sessions.destroyAllSessions(found.account.accountId, found.session.token);
        const account = await accounts.getAccount(found.account.accountId);
        await mail.sendPasswordChanged(account);
        return json(200, { ok: true, account: accounts.publicAccount(account) });
      }

      // --- the address ------------------------------------------------------
      case 'verifyEmail': {
        const record = await sessions.consumeToken(body.token, 'verify');
        if (!record) {
          return json(400, { error: 'That link has expired or has already been used.' });
        }
        const account = await accounts.markEmailVerified(record.accountId);
        return json(200, { ok: true, account: account });
      }

      case 'resendVerification': {
        const found = await requireSession(body);
        if (!found) return json(401, { error: 'Not signed in' });
        if (found.account.emailVerifiedAt) {
          return json(200, { ok: true, message: 'That address is already confirmed.' });
        }
        const token = await sessions.createToken('verify', found.account.accountId);
        await mail.sendVerify(found.account, token.token);
        return json(200, { ok: true, message: 'A new confirmation link is on its way.' });
      }

      case 'updateProfile': {
        const found = await requireSession(body);
        if (!found) return json(401, { error: 'Not signed in' });
        const account = await accounts.updateProfile(found.account.accountId, body.profile || {});
        return json(200, { ok: true, account: account });
      }

      default:
        return json(400, { error: `Unknown action "${body.action}"` });
    }
  } catch (err) {
    console.error('[account-auth] ' + (err && err.stack || err));
    return json(500, { error: 'Something went wrong. Please try again.' });
  }
};
