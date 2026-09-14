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

const json = (statusCode, payload) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  body: JSON.stringify(payload)
});

// One sentence for "no such participant" and "not yours", deliberately. Telling
// the two apart confirms that a participant id exists, which is a fact about
// another family.
const NOT_YOURS = 'No such participant.';

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
  if (!found && !open) return json(401, { error: 'Not signed in' });
  const me = found ? found.account : null;

  try {
    switch (body.action) {
      // --- the children on this account ------------------------------------
      case 'listParticipants': {
        const ids = await guardians.participantIdsFor(me.accountId);
        const out = [];
        for (const id of ids) {
          const p = await participants.getParticipant(id);
          if (!p) continue;
          out.push(Object.assign(participants.publicParticipant(p), {
            // Age is derived on read, never stored — a written-down age is
            // wrong from the day after it is written.
            age: participants.ageAt(p.dateOfBirth),
            isPrimary: p.primaryAccountId === me.accountId
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
          return json(400, { error: err.message });
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
            addedBy: me.accountId
          });
        } catch (err) {
          await participants.deleteParticipant(created.participantId);
          return json(500, { error: 'Could not create that record. Please try again.' });
        }
        return json(201, { ok: true, participant: created });
      }

      case 'updateParticipant': {
        const p = await mustGuard(body.participantId, me.accountId);
        if (!p) return json(404, { error: NOT_YOURS });
        try {
          // Either guardian may edit. The primary/secondary distinction governs
          // who may bring somebody else in, not who may correct a spelling.
          const updated = await participants.updateParticipant(p.participantId, body.participant || {});
          return json(200, { ok: true, participant: updated });
        } catch (err) {
          return json(400, { error: err.message });
        }
      }

      // --- who else can see this child ---------------------------------------
      case 'listGuardians': {
        const p = await mustGuard(body.participantId, me.accountId);
        if (!p) return json(404, { error: NOT_YOURS });
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
        if (!p) return json(404, { error: NOT_YOURS });
        if (p.primaryAccountId !== me.accountId) {
          return json(403, { error: 'Only the guardian who created this record can invite someone else.' });
        }
        const email = accounts.normaliseEmail(body.email);
        if (!accounts.validEmail(email)) return json(400, { error: 'A valid email address is required' });
        if (email === accounts.normaliseEmail(me.email)) {
          return json(400, { error: 'That is your own address — you are already a guardian here.' });
        }

        const existing = await guardians.guardiansOf(p.participantId);
        if (existing.length >= guardians.MAX_GUARDIANS) {
          return json(409, { error: `This record already has ${guardians.MAX_GUARDIANS} guardians.` });
        }
        // An account already linked under that address does not need inviting,
        // and saying so beats sending a link that would fail on acceptance.
        const theirId = await accounts.accountIdForEmail(email);
        if (theirId && await guardians.isGuardian(p.participantId, theirId)) {
          return json(409, { error: 'That person is already a guardian here.' });
        }
        const live = (await guardians.invitesFor(p.participantId))
          .filter((i) => i.status === 'pending' && i.invitedEmail === email);
        if (live.length) {
          return json(409, { error: 'An invitation is already waiting at that address. Resend or withdraw it first.' });
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
        if (!p) return json(404, { error: NOT_YOURS });
        if (p.primaryAccountId !== me.accountId) {
          return json(403, { error: 'Only the guardian who created this record can manage invitations.' });
        }
        const old = await guardians.getInvite(inviteTokenOf(body));
        if (!old || old.participantId !== p.participantId) {
          return json(404, { error: 'No such invitation.' });
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
        if (!p) return json(404, { error: NOT_YOURS });
        if (p.primaryAccountId !== me.accountId) {
          return json(403, { error: 'Only the guardian who created this record can manage invitations.' });
        }
        const inv = await guardians.getInvite(inviteTokenOf(body));
        if (!inv || inv.participantId !== p.participantId) {
          return json(404, { error: 'No such invitation.' });
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
          return json(404, { error: 'That invitation link is not valid or has expired.' });
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
        if (!me) return json(401, { error: 'Sign in first, with the address the invitation was sent to.' });
        try {
          const link = await guardians.acceptInvite(inviteTokenOf(body), me);
          const p = await participants.getParticipant(link.participantId);
          return json(200, { ok: true, participant: participants.publicParticipant(p) });
        } catch (err) {
          const status = err.code === 'invite-wrong-account' ? 403
                       : err.code === 'max-guardians' ? 409
                       : err.code === 'already-linked' ? 409
                       : 400;
          return json(status, { error: err.message });
        }
      }

      // --- leaving ------------------------------------------------------------
      case 'leaveParticipant': {
        const p = await mustGuard(body.participantId, me.accountId);
        if (!p) return json(404, { error: NOT_YOURS });
        const links = await guardians.guardiansOf(p.participantId);
        // THE LAST GUARDIAN CANNOT LEAVE. It would leave a record no account can
        // see or edit — reachable only by an admin, invisible to the family it
        // is about. Refused here as it is refused on the admin path, and for the
        // same reason.
        if (links.length <= 1) {
          return json(409, {
            error: 'You are the only guardian on this record, so you cannot remove yourself. ' +
                   'Invite someone else first, or ask Ogen to remove the record.'
          });
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
    return json(500, { error: 'Something went wrong. Please try again.' });
  }
};
