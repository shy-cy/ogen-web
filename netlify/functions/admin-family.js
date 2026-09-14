// /api/admin-family — the admin's way into a family record.
//
// Actions: findAccount | participant | linkGuardian | unlinkGuardian | deleteParticipant
//
// IT AUTHENTICATES THROUGH THE ADMIN STORE, and that is the only reason it is a
// separate function from account-family.js rather than a branch inside it. One
// handler serving both would hold two authentication paths a few lines apart,
// and the failure mode is a guardian's token reaching an admin branch. Separate
// files, separate stores, separate sessions: _session-store.js here,
// _member-session.js there, and neither can find the other's token.
//
// This exists for the two cases the invite flow deliberately cannot serve:
// lost access, and a guardian whose account is under a different address from
// the one the invitation was sent to. The invite is bound to its address on
// purpose, and this is the escape hatch that binding assumes.
//
// ⚠ Arms the legal gate, correctly.

const { authenticate, canAccess } = require('./_session-store');
const accounts = require('./_account-store');
const participants = require('./_participant-store');
const guardians = require('./_guardian-store');
const { recordAudit } = require('./_audit');

// The family tool, not the activities one. An admin who may publish pages is
// not thereby an admin who may see a child's date of birth, and the permission
// has to be able to say so.
const TOOL = 'family';

const json = (statusCode, payload) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  body: JSON.stringify(payload)
});

const displayName = (account) => {
  const p = (account && account.profile) || {};
  return [p.firstName, p.lastName].filter(Boolean).join(' ') || (account && account.email) || '';
};

// PHASE 5 SEAM. Unlinking a guardian who still owes money is a question, not a
// rule: the admin is shown what is owed and must choose to reassign it to the
// remaining guardian or write it off, with no default and no "skip".
//
// Registrations do not exist yet, so there is nothing to owe and this returns
// an empty list. It is written as a function rather than left out so that the
// ORDER is already right — see unlinkGuardian, where the last-guardian refusal
// deliberately comes first.
async function debtsFor(/* participantId, accountId */) {
  return [];
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    return json(400, { error: 'Body must be JSON' });
  }

  const session = await authenticate(body);
  if (!session) return json(401, { error: 'Unauthorized' });
  if (!canAccess(session, TOOL)) {
    return json(403, { error: 'Your role does not have access to family records' });
  }

  try {
    switch (body.action) {
      // Look up a guardian by address, so an admin can link an account they
      // have just been told about over the phone.
      case 'findAccount': {
        const account = await accounts.getAccountByEmail(body.email);
        if (!account) return json(404, { error: 'No account with that address.' });
        return json(200, { ok: true, account: accounts.publicAccount(account) });
      }

      // One participant, with its guardians. The admin view of a family record.
      case 'participant': {
        const p = await participants.getParticipant(body.participantId);
        if (!p) return json(404, { error: 'No such participant.' });
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
        return json(200, {
          ok: true,
          participant: Object.assign(participants.publicParticipant(p), {
            age: participants.ageAt(p.dateOfBirth)
          }),
          guardians: out
        });
      }

      // The override. No invitation, no acceptance, no binding to an address —
      // which is exactly what makes it the escape hatch, and exactly why it is
      // audited.
      case 'linkGuardian': {
        const p = await participants.getParticipant(body.participantId);
        if (!p) return json(404, { error: 'No such participant.' });
        const account = await accounts.getAccountByEmail(body.email)
          || await accounts.getAccount(body.accountId);
        if (!account) return json(404, { error: 'No account with that address.' });

        try {
          await guardians.addLink({
            participantId: p.participantId,
            accountId: account.accountId,
            addedVia: 'admin',
            addedBy: session.email
          });
        } catch (err) {
          return json(409, { error: err.message });
        }
        await recordAudit(session, 'family.linkGuardian', p.participantId, 'ok', { detail: account.email });
        return json(200, { ok: true });
      }

      case 'unlinkGuardian': {
        const p = await participants.getParticipant(body.participantId);
        if (!p) return json(404, { error: 'No such participant.' });
        if (!(await guardians.isGuardian(p.participantId, body.accountId))) {
          return json(404, { error: 'That account is not a guardian here.' });
        }
        const links = await guardians.guardiansOf(p.participantId);

        // THE LAST-GUARDIAN REFUSAL COMES FIRST, and the ordering is the point.
        //
        // Reading every registration for a participant only to refuse the
        // request is wasted work — and worse, it would show the admin a debt
        // prompt for an action that was never going to complete.
        //
        // It also dissolves the other edge. "Reassign has no target when there
        // is only one guardian" cannot arise: if the unlink is permitted at all,
        // a remaining guardian exists by definition, so reassign always has
        // somewhere to go. One refusal removed a branch instead of adding one.
        if (links.length <= 1) {
          return json(409, {
            error: 'That is the only guardian on this record, so they cannot be removed. ' +
                   'It would leave a participant nobody can see. Link the new guardian first, ' +
                   'or delete the participant.'
          });
        }

        const remaining = links.find((l) => l.accountId !== body.accountId);
        const owed = await debtsFor(p.participantId, body.accountId);
        if (owed.length && !body.debtDisposition) {
          // A question, not a rule. No default and no "skip": the response says
          // what is owed and waits to be told what to do with it.
          return json(409, {
            requires: 'debtDisposition',
            owed: owed,
            total: owed.reduce((n, r) => n + (r.owedCents || 0), 0),
            remainingGuardian: remaining ? remaining.accountId : null,
            error: 'This guardian has unpaid registrations. Choose what happens to them.'
          });
        }

        // Primacy moves in the same write, before the link goes. There is only
        // one possible answer so it is not a prompt, but it must not be
        // forgotten: primacy is what authorises sending invitations, and a
        // participant whose primary account is no longer linked can never have
        // a second guardian invited again.
        if (p.primaryAccountId === body.accountId && remaining) {
          p.primaryAccountId = remaining.accountId;
          await participants.saveParticipant(p);
        }

        await guardians.removeLink(p.participantId, body.accountId);
        await recordAudit(session, 'family.unlinkGuardian', p.participantId, 'ok', { detail: body.accountId + (body.debtDisposition ? ' · ' + body.debtDisposition : '') });
        return json(200, { ok: true, primaryAccountId: p.primaryAccountId });
      }

      // Deleting takes the links with it. A link pointing at a participant that
      // is gone is a row in every guardian's list that resolves to nothing.
      case 'deleteParticipant': {
        const p = await participants.getParticipant(body.participantId);
        if (!p) return json(404, { error: 'No such participant.' });
        // Typing the name back, the same shape the activity delete already has.
        // This record is a child's name and date of birth; it should not go on
        // a misclick.
        if (String(body.confirmName || '').trim() !== p.firstName) {
          return json(400, { error: 'Type the participant\'s first name to confirm.' });
        }
        await guardians.removeAllLinks(p.participantId);
        await participants.deleteParticipant(p.participantId);
        await recordAudit(session, 'family.deleteParticipant', p.participantId, 'ok', { detail: p.firstName + ' ' + (p.lastName || '') });
        return json(200, { ok: true });
      }

      default:
        return json(400, { error: `Unknown action "${body.action}"` });
    }
  } catch (err) {
    console.error('[admin-family] ' + (err && err.stack || err));
    return json(500, { error: 'Something went wrong. Please try again.' });
  }
};
