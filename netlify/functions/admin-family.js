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
const registrations = require('./_registration-store');
const attendance = require('./_session-attendance');
const { recordAudit } = require('./_audit');

// The family tool, not the activities one. An admin who may publish pages is
// not thereby an admin who may see a child's date of birth, and the permission
// has to be able to say so.
const TOOL = 'family';

// What may happen to an unpaid registration when the guardian who submitted it
// is removed. Two answers, both of which somebody has to choose: move it to the
// remaining guardian, or write it off. There is deliberately no third option
// meaning "leave it" — a debt owed by an account that can no longer see the
// participant is a debt nobody will ever be asked about.
const DISPOSITIONS = ['reassign', 'write-off'];

const json = (statusCode, payload) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  body: JSON.stringify(payload)
});

const displayName = (account) => {
  const p = (account && account.profile) || {};
  return [p.firstName, p.lastName].filter(Boolean).join(' ') || (account && account.email) || '';
};

// Unlinking a guardian who still owes money is a question, not a rule: the admin
// is shown what is owed and must choose to reassign it to the remaining guardian
// or write it off, with no default and no "skip".
//
// Registrations now exist, so this reads them — but MONEY does not, so it still
// returns nothing. payment.owedCents is null on every record until Phase 5 can
// say what a registration is billed, which is not a property of the activity
// alone: the registration fee is scoped to one participant, one activity, one
// year, so the same child in the same activity next semester owes the course
// price and not the fee. A debt cannot be reported before something can say what
// it is.
//
// Note the scope is per PARTICIPANT, which is also why this filters by account
// rather than aggregating one: a guardian being unlinked owes for the
// registrations they submitted, and a sibling's fee was never theirs to share.
//
// Reading the registrations anyway, rather than returning [] unconditionally, is
// what makes the shape right: the filter is already the one Phase 5 needs, and
// the ORDER is already right — see unlinkGuardian, where the last-guardian
// refusal deliberately comes first, so an admin is never shown a debt prompt for
// an action that was never going to complete.
async function debtsFor(participantId, accountId) {
  const regs = await registrations.forParticipant(participantId);
  return regs
    .filter((r) => r.accountId === accountId)
    .filter((r) => r.payment && r.payment.status === 'owed')
    .map((r) => ({
      key: r.participantId + '__' + r.activityId,
      activityId: r.activityId,
      title: r.frozen.activityTitle,
      status: r.status,
      owedCents: r.payment.owedCents,
      paidCents: r.payment.paidCents
    }))
    .filter((r) => r.owedCents != null && r.owedCents > r.paidCents);
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
        if (owed.length && DISPOSITIONS.indexOf(body.debtDisposition) === -1) {
          // A question, not a rule. No default and no "skip": the response says
          // what is owed and waits to be told what to do with it. Nothing about
          // money happens in the background.
          return json(409, {
            requires: 'debtDisposition',
            options: DISPOSITIONS,
            owed: owed,
            total: owed.reduce((n, r) => n + (r.owedCents - r.paidCents), 0),
            remainingGuardian: remaining ? remaining.accountId : null,
            error: 'This guardian has unpaid registrations. Choose what happens to them.'
          });
        }

        // Applied BEFORE the unlink, so a failure here leaves the guardian
        // linked and the debt where it was rather than half-moved.
        for (const debt of owed) {
          const reg = await registrations.getRegistration(p.participantId, debt.activityId);
          if (!reg) continue;
          if (body.debtDisposition === 'reassign') {
            // The remaining guardian becomes the one who owes. `reassignedFrom`
            // is kept because the person being asked to pay did not submit it,
            // and will ask why they are being asked.
            reg.payment = Object.assign({}, reg.payment, { reassignedFrom: reg.accountId });
            reg.accountId = remaining.accountId;
          } else {
            reg.payment = Object.assign({}, reg.payment, {
              status: 'written-off',
              writtenOffAt: new Date().toISOString(),
              writtenOffBy: session.email
            });
          }
          reg.history = (reg.history || []).concat([{
            iso: new Date().toISOString(),
            action: 'debt-' + body.debtDisposition,
            by: session.email,
            note: 'on unlinking ' + body.accountId
          }]);
          await registrations.saveRegistration(reg);
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
        // The registrations go too. One left behind is a row in an approval
        // queue that resolves to nothing — and it carries a child's name and
        // date of birth in its frozen block, which is the half that matters.
        await registrations.removeForParticipant(p.participantId);
        // The per-session bookings too. A booking pointing at a participant that
        // is gone is a name on a register that resolves to nothing.
        await attendance.removeForParticipant(p.participantId);
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
