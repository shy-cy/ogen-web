// /api/admin-registrations — the approval queue.
//
// Actions: queue | approve | reject | cancel | moveGroup | sweep
//
// IT AUTHENTICATES THROUGH THE ADMIN STORE, which is the only reason it is a
// separate function from account-registrations.js. One handler serving both
// would hold two authentication paths a few lines apart, and the failure mode is
// a parent's cookie reaching an approval branch.
//
// THE PERMISSION IS `registrations`, WITH THREE AXES. Opening the queue means
// reading children's names and dates of birth, so `access` is its own gate —
// an admin who may publish pages is not thereby an admin who may read the queue.
// `approve` covers approve, reject and moving a child between groups: all three
// cost nothing and are undoable by doing the other one. `cancel` is separate
// because cancelling moves money — it writes a credit a family can spend, and
// cannot be undone at all, only compensated.
//
// NOTHING HERE IS DECIDED BY A MACHINE. The age flag annotates; auto-approve
// stands aside when it cannot confirm an age; every `rejected` in the store is a
// person's decision. That is what makes the binary approval model genuinely
// binary and why there are no reason codes to carry.
//
// ⚠ Arms the legal gate, correctly.

const { authenticate, canAccess, canApprove, canCancel } = require('./_session-store');
const { readJson } = require('./_github');
const { migrate } = require('./_activity-migrate');
const accounts = require('./_account-store');
const participants = require('./_participant-store');
const store = require('./_registration-store');
const R = require('./_registration');
const credit = require('./_credit');
const { recordAudit } = require('./_audit');
const mail = require('./_registration-email');
const sweep = require('./_registration-sweep');

const TOOL = 'registrations';

const json = (statusCode, payload) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  body: JSON.stringify(payload)
});

async function published(slug) {
  if (!slug) return null;
  const raw = await readJson('activities/' + slug + '.json');
  return raw ? migrate(raw) : null;
}

// One row of the queue. The age flag is RECOMPUTED against the activity as it
// stands now, beside the one frozen at submission — an admin looking at a
// request today wants to know what the range says today, and the frozen copy is
// what the decision was taken under. Showing one without the other hides which
// of the two moved.
async function row(reg) {
  const account = await accounts.getAccount(reg.accountId);
  const participant = await participants.getParticipant(reg.participantId);
  return {
    participantId: reg.participantId,
    activityId: reg.activityId,
    name: reg.frozen.participantName,
    dateOfBirth: reg.frozen.dateOfBirth,
    stillExists: !!participant,
    accountId: reg.accountId,
    accountEmail: account ? account.email : null,
    groupId: reg.groupId,
    groupName: reg.frozen.groupName,
    status: reg.status,
    holdsASpot: R.holdsASpot(reg),
    lapsed: R.hasLapsed(reg),
    submittedAt: reg.submittedAt,
    expiresAt: reg.expiresAt,
    expiryDays: reg.expiryDays,
    expirySource: reg.expirySource,
    autoApproved: reg.autoApproved,
    decidedAt: reg.decidedAt,
    decidedBy: reg.decidedBy,
    ageFlagAtSubmission: reg.ageFlag,
    payment: reg.payment,
    history: reg.history
  };
}

// Which states each decision may be taken FROM, written as a table because the
// interesting entries are the ones an inequality would get wrong:
//
//   rejected -> approved  is allowed. An admin who rejects by mistake has to be
//     able to undo it, and "approving is undone by rejecting" only holds if it
//     holds both ways.
//   expired  -> approved  is allowed. The request lapsed because WE did not
//     answer it; an admin getting to it late and saying yes is the right
//     outcome, not a state error.
//   cancelled -> anything is refused. The family withdrew. Reinstating them
//     without their asking is not an admin's to do — they register again, which
//     also re-reads the terms and re-freezes them.
//
// Capacity is deliberately NOT checked here. Approving past the limit is the
// "23 / 20 — over capacity" case the queue reports rather than prevents: an
// admin who does it on purpose has a reason, and one who does it by accident can
// see it on the line above.
const ACTABLE = {
  approved: ['pending', 'approved', 'rejected', 'expired'],
  rejected: ['pending', 'approved', 'rejected', 'expired'],
  cancelled: ['pending', 'approved']
};

// Read, act, write — with the two checks that are easy to leave out: the
// registration must exist, and it must be in a state the action makes sense from.
async function decide(body, session, status, source) {
  const reg = await store.getRegistration(body.participantId, body.activityId);
  if (!reg) return { code: 404, payload: { error: 'No such registration.' } };
  if (reg.status === status) return { code: 200, payload: { ok: true, registration: reg } };

  if (ACTABLE[status].indexOf(reg.status) === -1) {
    return { code: 409, payload: { error: 'This registration is ' + reg.status + '.' } };
  }
  const next = R.transition(reg, {
    status: status, by: session.email, source: source,
    note: body.note ? String(body.note).slice(0, 500) : null
  });
  await store.saveRegistration(next);
  return { code: 200, payload: { ok: true, registration: next } };
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
    return json(403, { error: 'Your role does not have access to registrations' });
  }

  try {
    switch (body.action) {
      // The queue for one activity, with the capacity line above it.
      case 'queue': {
        const activity = await published(body.slug);
        if (!activity) return json(404, { error: 'No such activity.' });
        let regs = await store.forActivity(activity.activityId);
        if (body.status) regs = regs.filter((r) => r.status === body.status);
        if (body.groupId) regs = regs.filter((r) => r.groupId === body.groupId);
        const rows = [];
        for (const reg of regs) rows.push(await row(reg));
        return json(200, {
          ok: true,
          activity: { activityId: activity.activityId, slug: activity.slug, title: activity.title, type: activity.type },
          // Says "23 / 20 — over capacity" plainly rather than pretending it
          // cannot happen. Two submissions arriving together can both pass the
          // check; there is no atomic increment to close that window, and an
          // extra visible record is a smaller problem than a lost counter.
          capacity: R.capacityReport(activity, await store.forActivity(activity.activityId)),
          registrations: rows
        });
      }

      case 'approve':
      case 'reject': {
        if (!canApprove(session)) {
          return json(403, { error: 'Your role may open the queue but not decide on it' });
        }
        const status = body.action === 'approve' ? 'approved' : 'rejected';
        const out = await decide(body, session, status, null);
        if (out.code === 200 && out.payload.registration && out.payload.registration.status === status) {
          const account = await accounts.getAccount(out.payload.registration.accountId);
          if (account) {
            if (status === 'approved') await mail.sendApproved(out.payload.registration, account);
            else await mail.sendRejected(out.payload.registration, account);
          }
          await recordAudit(session, 'registrations.' + body.action,
            body.participantId + '__' + body.activityId, 'ok', { detail: out.payload.registration.frozen.participantName });
        }
        return json(out.code, out.payload);
      }

      case 'cancel': {
        if (!canCancel(session)) {
          return json(403, { error: 'Your role may approve but not cancel' });
        }
        const reg = await store.getRegistration(body.participantId, body.activityId);
        if (!reg) return json(404, { error: 'No such registration.' });

        // AN ADMIN CANCELLATION IS NOT SUBJECT TO THE HARD CUTOFF, and that is
        // deliberate. The cutoff decides what a family is OWED, not whether a
        // child can be removed: something can come to light in week nine, and a
        // policy about money must not be the thing that prevents acting on it.
        // So creditFor()'s `guardianMayCancel: false` is read as "credits
        // nothing" here rather than as a refusal.
        const owed = credit.creditFor(reg);
        const credits = owed.guardianMayCancel === false ? 0 : owed.total;
        if (credits > 0) {
          // Same Phase 5 seam as the guardian's own path, and unreachable for
          // the same reason: nothing collects money yet, so paidCents is zero
          // everywhere. It refuses rather than silently cancelling without
          // writing the credit.
          return json(409, {
            requires: 'credit-ledger', owed: owed,
            error: 'This cancellation earns a credit, and crediting is not built yet.'
          });
        }
        const out = await decide(body, session, 'cancelled', 'admin');
        if (out.code === 200) {
          await recordAudit(session, 'registrations.cancel',
            body.participantId + '__' + body.activityId, 'ok',
            { detail: reg.frozen.participantName + (body.note ? ' · ' + body.note : '') });
        }
        return json(out.code, Object.assign({ credit: owed }, out.payload));
      }

      // Moving a child between groups is an admin action, never a family one.
      // It re-checks the destination's capacity and lands in the history; the
      // FROZEN NAME MOVES WITH IT, because a receipt should say the group the
      // child is actually in.
      case 'moveGroup': {
        if (!canApprove(session)) {
          return json(403, { error: 'Your role may open the queue but not decide on it' });
        }
        const activity = await published(body.slug);
        if (!activity) return json(404, { error: 'No such activity.' });
        const reg = await store.getRegistration(body.participantId, activity.activityId);
        if (!reg) return json(404, { error: 'No such registration.' });

        const regs = await store.forActivity(activity.activityId);
        const report = R.capacityReport(activity, regs.filter(
          (r) => !(r.participantId === reg.participantId && r.activityId === reg.activityId)));
        if (!R.hasRoom(report, body.groupId)) {
          return json(409, { error: 'That group is full.', full: true });
        }
        const target = require('./_activity-facts')
          .namedGroups(((activity.facts || {}).groupSize) || {})
          .filter((g) => g.groupId === body.groupId)[0];
        if (!target) return json(400, { error: 'No such group on this activity.' });

        const next = R.transition(reg, {
          status: reg.status, by: session.email,
          note: 'moved to ' + body.groupId
        });
        next.groupId = body.groupId;
        next.frozen = Object.assign({}, next.frozen, { groupName: target.name || null });
        await store.saveRegistration(next);
        await recordAudit(session, 'registrations.moveGroup',
          body.participantId + '__' + activity.activityId, 'ok', { detail: body.groupId });
        return json(200, { ok: true, registration: next });
      }

      // "Run now", because the scheduled function cannot be triggered from a
      // browser — Netlify's edge answers 403 to every external HTTP request to
      // one. So the admin calls run() directly rather than the endpoint.
      case 'sweep': {
        if (!canApprove(session)) {
          return json(403, { error: 'Your role may open the queue but not decide on it' });
        }
        const result = await sweep.run();
        await recordAudit(session, 'registrations.sweep', 'all', 'ok',
          { detail: result.expired + ' expired' });
        return json(200, Object.assign({ ok: true }, result));
      }

      default:
        return json(400, { error: `Unknown action "${body.action}"` });
    }
  } catch (err) {
    console.error('[admin-registrations] ' + (err && err.stack || err));
    return json(500, { error: 'Something went wrong. Please try again.' });
  }
};
