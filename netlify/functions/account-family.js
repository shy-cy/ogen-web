// /api/account-family — what a signed-in guardian may do about their children.
//
// Actions: listParticipants | createParticipant | updateParticipant |
//          listGuardians | invite | resendInvite | revokeInvite |
//          inviteDetails | acceptInvite | leaveParticipant
//
// AUTHORISATION IS A LINK, CHECKED PER PARTICIPANT, and there is no other kind
// here. Every action that names a participant starts by asking whether this
// account is one of its guardians; owning one child grants nothing about any
// other. The check is a single helper called at the top of each branch rather
// than a middleware guessing which argument is an id, because the branch that
// forgets to call it is the branch that hands one family another family's
// record.
//
// SENDING AN INVITE IS THE PRIMARY GUARDIAN'S ALONE. A second guardian may see
// and act; they may not bring in a third, and they may not replace the first.
// That is what primaryAccountId on the participant authorises, and it is one
// field with one writer for exactly that reason.

const accounts = require('./_account-store');
const sessions = require('./_member-session');
const participants = require('./_participant-store');
const guardians = require('./_guardian-store');
const mail = require('./_account-email');
const E = require('./_family-errors');

const json = (statusCode, payload) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  body: JSON.stringify(payload)
});

// One sentence for "no such participant" and "not yours", deliberately. Telling
// the two apart confirms that a participant id exists, which is a fact about
// another family.
// ⚠ EVERY REFUSAL IS IN THE READER'S LANGUAGE — _family-errors.js holds all
// three. Only the wire-level strings below stay English: a non-POST, a body
// that is not JSON, an action that does not exist. Those mean the client is
// broken and no family can reach them.
//
// `no-such-participant` is deliberately the same answer for "there is no such
// record" and "that record is not yours", exactly as NOT_YOURS was: telling
// them apart would let anybody holding an id find out whether a participant
// exists.
const refuse = (lang) => (status, key, extra, params) =>
  json(status, E.body(key, lang, extra, params));

// A store throws with a code, never with a sentence for a person.
const codeOf = (err) => (err && err.code) || 'server-error';

// THE SESSION TOKEN IS `token`, AND AN INVITE TOKEN IS NEVER CALLED THAT.
//
// sessions.authenticate(body) reads body.token, so an invite action that also
// took its token from body.token would be handing the session token to
// acceptInvite() — which then compares a session token against a stored invite,
// finds nothing, and answers "that invitation link is not valid" for a link that
// is perfectly valid. Worse, the same collision on a server that looked the
// other token up first would authenticate a request with an invite token.
//
// One name, one meaning: `token` authenticates the caller, `inviteToken`
// identifies an invitation.
const inviteTokenOf = (body) => body.inviteToken;

const displayName = (account) => {
  const p = (account && account.profile) || {};
  return [p.firstName, p.lastName].filter(Boolean).join(' ') || account.email;
};

async function mustGuard(participantId, accountId) {
  if (!participantId) return null;
  if (!(await guardians.isGuardian(participantId, accountId))) return null;
  return participants.getParticipant(participantId);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    return json(400, { error: 'Body must be JSON' });
  }

  // inviteDetails is the one action a signed-out person may call: the page
  // behind an invitation link has to be able to say who it is from and for whom
  // before asking anybody to sign in or sign up.
  const open = body.action === 'inviteDetails';
  const found = await sessions.authenticate(body);
  const me = found ? found.account : null;
  // The page's language, falling back to the account's for a caller that does
  // not send one. js/member-session.js sends it on every request.
  const no = refuse(E.readerLang(body, me));
  if (!found && !open) return no(401, 'not-signed-in');

  try {
    switch (body.action) {
      // --- the children on this account ------------------------------------
      case 'listParticipants': {
        const ids = await guardians.participantIdsFor(me.accountId);
        const out = [];
        for (const id of ids) {
          const p = await participants.getParticipant(id);
          if (!p) continue;
          // The link, not just its existence: it carries whether this
          // participant is the reader themselves, which is what lets the screen
          // say "that is you" and stop offering "remove myself from this
          // record" on a record that IS the person reading it.
          const link = await guardians.getLink(id, me.accountId);
          out.push(Object.assign(participants.publicParticipant(p), {
            // Age is derived on read, never stored — a written-down age is
            // wrong from the day after it is written.
            age: participants.ageAt(p.dateOfBirth),
            isPrimary: p.primaryAccountId === me.accountId,
            isSelf: !!(link && link.isSelf)
          }));
        }
        out.sort((a, b) => String(a.firstName).localeCompare(String(b.firstName)));
        return json(200, { ok: true, participants: out });
      }

      case 'createParticipant': {
        let created;
        try {
          created = await participants.createParticipant(body.participant || {}, me.accountId);
        } catch (err) {
          return no(400, codeOf(err));
        }
        // The creator's link is written immediately, and if that write fails the
        // participant is deleted rather than left behind. A participant with no
        // guardian is invisible to the family it is about and reachable only by
        // an admin — the same state the last-guardian unlink refusal exists to
        // prevent, and it must not be creatable by accident either.
        try {
          await guardians.addLink({
            participantId: created.participantId,
            accountId: me.accountId,
            addedVia: 'creator',
            addedBy: me.accountId,
            // "Add myself" rather than "add someone". It is the client saying
            // which of the two buttons was pressed; nothing authorises on it and
            // nothing else behaves differently, so a client that lies about it
            // has only mislabelled its own screen.
            isSelf: body.isSelf === true
          });
        } catch (err) {
          await participants.deleteParticipant(created.participantId);
          return no(500, 'participant-not-created');
        }
        return json(201, { ok: true, participant: created });
      }

      case 'updateParticipant': {
        const p = await mustGuard(body.participantId, me.accountId);
        if (!p) return no(404, 'no-such-participant');
        try {
          // Either guardian may edit. The primary/secondary distinction governs
          // who may bring somebody else in, not who may correct a spelling.
          const updated = await participants.updateParticipant(p.participantId, body.participant || {});
          return json(200, { ok: true, participant: updated });
        } catch (err) {
          return no(400, codeOf(err));
        }
      }

      // --- who else can see this child ---------------------------------------
      case 'listGuardians': {
        const p = await mustGuard(body.participantId, me.accountId);
        if (!p) return no(404, 'no-such-participant');
        const links = await guardians.guardiansOf(p.participantId);
        const out = [];
        for (const l of links) {
          const a = await accounts.getAccount(l.accountId);
          out.push({
            accountId: l.accountId,
            email: a ? a.email : null,
            name: a ? displayName(a) : null,
            addedVia: l.addedVia,
            addedAt: l.addedAt,
            isPrimary: p.primaryAccountId === l.accountId
          });
        }
        const invites = (await guardians.invitesFor(p.participantId))
          .filter((i) => i.status === 'pending')
          .map((i) => ({ token: i.token, invitedEmail: i.invitedEmail, expiresAt: i.expiresAt }));
        return json(200, {
          ok: true, guardians: out, pendingInvites: invites,
          maxGuardians: guardians.MAX_GUARDIANS,
          iAmPrimary: p.primaryAccountId === me.accountId
        });
      }

      // --- inviting the second guardian --------------------------------------
      case 'invite': {
        const p = await mustGuard(body.participantId, me.accountId);
        if (!p) return no(404, 'no-such-participant');
        if (p.primaryAccountId !== me.accountId) {
          return no(403, 'invite-not-primary');
        }
        const email = accounts.normaliseEmail(body.email);
        if (!accounts.validEmail(email)) return no(400, 'email-invalid');
        if (email === accounts.normaliseEmail(me.email)) {
          return no(400, 'invite-own-address');
        }

        const existing = await guardians.guardiansOf(p.participantId);
        if (existing.length >= guardians.MAX_GUARDIANS) {
          return no(409, 'max-guardians', null, { max: guardians.MAX_GUARDIANS });
        }
        // An account already linked under that address does not need inviting,
        // and saying so beats sending a link that would fail on acceptance.
        const theirId = await accounts.accountIdForEmail(email);
        if (theirId && await guardians.isGuardian(p.participantId, theirId)) {
          return no(409, 'already-guardian');
        }
        const live = (await guardians.invitesFor(p.participantId))
          .filter((i) => i.status === 'pending' && i.invitedEmail === email);
        if (live.length) {
          return no(409, 'invite-already-waiting');
        }

        const invite = await guardians.createInvite({
          participantId: p.participantId,
          invitedEmail: email,
          invitedByAccountId: me.accountId
        });
        await mail.sendGuardianInvite(invite, displayName(me), p.firstName,
          accounts.preferredLanguage(me));
        return json(201, {
          ok: true, invite: { token: invite.token, invitedEmail: email, expiresAt: invite.expiresAt }
        });
      }

      case 'resendInvite': {
        const p = await mustGuard(body.participantId, me.accountId);
        if (!p) return no(404, 'no-such-participant');
        if (p.primaryAccountId !== me.accountId) {
          return no(403, 'invites-not-primary');
        }
        const old = await guardians.getInvite(inviteTokenOf(body));
        if (!old || old.participantId !== p.participantId) {
          return no(404, 'no-such-invitation');
        }
        // A NEW token, and the old one revoked. Re-sending the same link would
        // leave a forwarded copy of it working; this kills it.
        await guardians.revokeInvite(old.token, me.accountId);
        const invite = await guardians.createInvite({
          participantId: p.participantId,
          invitedEmail: old.invitedEmail,
          invitedByAccountId: me.accountId
        });
        await mail.sendGuardianInvite(invite, displayName(me), p.firstName,
          accounts.preferredLanguage(me));
        return json(200, {
          ok: true, invite: { token: invite.token, invitedEmail: invite.invitedEmail, expiresAt: invite.expiresAt }
        });
      }

      case 'revokeInvite': {
        const p = await mustGuard(body.participantId, me.accountId);
        if (!p) return no(404, 'no-such-participant');
        if (p.primaryAccountId !== me.accountId) {
          return no(403, 'invites-not-primary');
        }
        const inv = await guardians.getInvite(inviteTokenOf(body));
        if (!inv || inv.participantId !== p.participantId) {
          return no(404, 'no-such-invitation');
        }
        await guardians.revokeInvite(inv.token, me.accountId);
        return json(200, { ok: true });
      }

      // --- accepting one -----------------------------------------------------
      case 'inviteDetails': {
        // Deliberately open, and deliberately thin: who it is from and whose
        // record it is, and nothing else. The token is a bearer secret, so the
        // answer must be worth no more than the link itself already is.
        const inv = await guardians.getInvite(inviteTokenOf(body));
        if (!inv || inv.status !== 'pending') {
          return no(404, 'invite-link-dead');
        }
        const p = await participants.getParticipant(inv.participantId);
        const from = await accounts.getAccount(inv.invitedByAccountId);
        return json(200, {
          ok: true,
          invite: {
            invitedEmail: inv.invitedEmail,
            expiresAt: inv.expiresAt,
            participantFirstName: p ? p.firstName : '',
            invitedByName: from ? displayName(from) : '',
            // So the page can say "sign in" or "create an account" without a
            // second round trip, and without revealing anything the invited
            // person does not already know about their own address.
            hasAccount: !!(await accounts.accountIdForEmail(inv.invitedEmail))
          }
        });
      }

      case 'acceptInvite': {
        if (!me) return no(401, 'invite-sign-in-first');
        try {
          const link = await guardians.acceptInvite(inviteTokenOf(body), me);
          const p = await participants.getParticipant(link.participantId);
          return json(200, { ok: true, participant: participants.publicParticipant(p) });
        } catch (err) {
          const status = err.code === 'invite-wrong-account' ? 403
                       : err.code === 'max-guardians' ? 409
                       : err.code === 'already-linked' ? 409
                       : 400;
          return no(status, codeOf(err));
        }
      }

      // --- leaving ------------------------------------------------------------
      case 'leaveParticipant': {
        const p = await mustGuard(body.participantId, me.accountId);
        if (!p) return no(404, 'no-such-participant');
        const links = await guardians.guardiansOf(p.participantId);
        // THE LAST GUARDIAN CANNOT LEAVE. It would leave a record no account can
        // see or edit — reachable only by an admin, invisible to the family it
        // is about. Refused here as it is refused on the admin path, and for the
        // same reason.
        if (links.length <= 1) {
          return no(409, 'last-guardian');
        }
        // Primacy moves with the same write. There is only one possible answer,
        // so it is not a prompt — but it must not be forgotten, because primacy
        // is what authorises sending invitations.
        if (p.primaryAccountId === me.accountId) {
          const other = links.find((l) => l.accountId !== me.accountId);
          p.primaryAccountId = other.accountId;
          await participants.saveParticipant(p);
        }
        await guardians.removeLink(p.participantId, me.accountId);
        return json(200, { ok: true });
      }

      default:
        return json(400, { error: `Unknown action "${body.action}"` });
    }
  } catch (err) {
    console.error('[account-family] ' + (err && err.stack || err));
    return no(500, 'server-error');
  }
};
