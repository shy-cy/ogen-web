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
const E = require('./_family-errors');

const json = (statusCode, payload) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  body: JSON.stringify(payload)
});

// The answer a reset request always gives, whether or not anything was sent.
// The client says its own words on success; this is for a direct caller.
const RESET_SENT = 'If that address has an account, a reset link is on its way.';

// ⚠ EVERY REFUSAL IS IN THE READER'S LANGUAGE. A family on the Hebrew page,
// filling in a Hebrew form under a Hebrew heading, was told "An account with
// that email already exists". _family-errors.js holds all three languages; the
// only strings still hard-coded in English here are the wire-level ones — a
// non-POST, a body that is not JSON, an action that does not exist — which mean
// the client is broken and are unreachable from the site.
const refuse = (lang) => (status, key, extra, params) =>
  json(status, E.body(key, lang, extra, params));

// A store throws with a code on it, never with a sentence for a person. An
// unrecognised one falls through to the generic apology rather than leaking an
// internal message onto a family's screen.
const codeOf = (err) => (err && err.code) || 'server-error';

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

  // The language the PAGE is in, which js/member-session.js sends on every
  // request. Most actions here happen before there is an account to read a
  // preference off — signing up, signing in, following a reset link — so this
  // is the only thing that can answer, and it is also the right thing: a
  // sentence appearing under a form somebody is looking at belongs in the
  // language of that form.
  const no = refuse(E.readerLang(body));

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
          if (err.code === 'email-taken') return no(409, 'email-taken');
          return no(400, codeOf(err), null, { min: accounts.MIN_PASSWORD });
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
        if (!account) return no(401, 'signin-failed');
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
        if (!found) return no(401, 'not-signed-in');
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

      // ⚠ IS THIS LINK STILL GOOD? Asked on LOAD, so a dead one says so instead
      // of drawing a password form that refuses after it has been filled in.
      // Reported from QA exactly that way: "I was able to access the page and
      // only when entering a new pass, I got a message that this link cannot be
      // used — maybe it's more correct that once we reuse the link, we get the
      // error message."
      //
      // It reveals nothing. Whoever holds the token can learn the same thing by
      // submitting; this only moves the answer to before the typing. It names no
      // account and, crucially, does NOT consume — peekToken, never
      // consumeToken, or opening the page would spend the link.
      case 'resetLive': {
        const record = await sessions.peekToken(body.token, 'reset');
        return json(200, { ok: true, live: !!record });
      }

      case 'resetPassword': {
        // ⚠ THE PASSWORD IS CHECKED BEFORE THE TOKEN IS SPENT, and that ordering
        // is the whole of this block. It ran the other way round, on the argument
        // that a token surviving a failed attempt was the more dangerous shape.
        // That argument does not hold: whoever holds a reset link already has
        // everything the link grants, so letting them type a second password
        // costs nothing — and a password too short is not an attack, it is the
        // form failing to say what the minimum was.
        //
        // What the old order cost was real, and QA found it. A password under the
        // minimum spent the link, and every retry — including the tabs already
        // open — answered "that link has expired or has already been used". The
        // reported symptom was three tabs, three dead links, and no password
        // accepted, on an account that could then only be recovered by asking for
        // another mail from a screen that still would not say what was wrong.
        //
        // The form states the minimum now as well, and this is the other half:
        // the client is hostile by assumption, so the rule cannot live only there.
        if (!body.password || String(body.password).length < accounts.MIN_PASSWORD) {
          return no(400, 'reset-password-short', null, { min: accounts.MIN_PASSWORD });
        }
        const record = await sessions.consumeToken(body.token, 'reset');
        if (!record) {
          return no(400, 'reset-link-dead');
        }
        try {
          await accounts.setPassword(record.accountId, body.password);
        } catch (err) {
          // Nothing reaching here is about the password's length any more — that
          // was settled above, while the link was still good.
          return no(400, codeOf(err), null, { min: accounts.MIN_PASSWORD });
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
        if (!found) return no(401, 'not-signed-in');
        // The current password is required even though the session proves who
        // they are. A session on a shared laptop is not the same evidence as
        // knowing the password, and this is the action that would lock the
        // owner out.
        const ok = await accounts.verifyPassword(found.account.email, body.currentPassword);
        if (!ok) return no(403, 'wrong-current-password');
        try {
          await accounts.setPassword(found.account.accountId, body.newPassword);
        } catch (err) {
          return no(400, codeOf(err), null, { min: accounts.MIN_PASSWORD });
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
          return no(400, 'verify-link-dead');
        }
        const account = await accounts.markEmailVerified(record.accountId);
        return json(200, { ok: true, account: account });
      }

      case 'resendVerification': {
        const found = await requireSession(body);
        if (!found) return no(401, 'not-signed-in');
        if (found.account.emailVerifiedAt) {
          return json(200, { ok: true, message: 'That address is already confirmed.' });
        }
        const token = await sessions.createToken('verify', found.account.accountId);
        await mail.sendVerify(found.account, token.token);
        return json(200, { ok: true, message: 'A new confirmation link is on its way.' });
      }

      case 'updateProfile': {
        const found = await requireSession(body);
        if (!found) return no(401, 'not-signed-in');
        const account = await accounts.updateProfile(found.account.accountId, body.profile || {});
        return json(200, { ok: true, account: account });
      }

      default:
        return json(400, { error: `Unknown action "${body.action}"` });
    }
  } catch (err) {
    console.error('[account-auth] ' + (err && err.stack || err));
    return no(500, 'server-error');
  }
};
