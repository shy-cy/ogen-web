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
const ledger = require('./_credit-ledger');
const { cancelAndCredit } = require('./_registration-cancel');
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
    // Whether the yearly fee was billed on THIS term, and which year it was
    // judged against. An admin looking at a 300 beside a 350 needs to be able to
    // see why without opening the other term.
    feeCharged: reg.frozen.price.feeCharged,
    feeYear: reg.frozen.feeYear,
    seriesId: reg.frozen.seriesId,
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
      // Who am I and what may I do. The client mirrors these to grey controls
      // out; the server re-checks every one of them on every action and assumes
      // the client is hostile.
      case 'auth':
        return json(200, {
          ok: true, email: session.email, name: session.name, roleName: session.roleName,
          canApprove: canApprove(session), canCancel: canCancel(session)
        });

      // The activities there could be a queue for. Read from the published index
      // rather than listing registrations, so an activity nobody has registered
      // for still appears — otherwise a new term is invisible until the first
      // family finds it, which is exactly when an admin wants to be watching.
      case 'activities': {
        const index = (await readJson('activities/activities-index.json')) || [];
        return json(200, {
          ok: true,
          activities: index.map((a) => ({
            slug: a.slug, title: a.title, status: a.status,
            type: a.type || 'course', activityId: a.activityId || null,
            seriesId: a.seriesId || a.activityId || null
          }))
        });
      }

      // The queue for one activity, with the capacity line above it.
      case 'queue': {
        const activity = await published(body.slug);
        if (!activity) return json(404, { error: 'No such activity.' });
        // Read ONCE. The capacity line and the rows are two views of the same
        // list, and reading it twice is both a wasted round trip and a way for
        // the count above the table to disagree with the table under it.
        const all = await store.forActivity(activity.activityId);
        let regs = all;
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
          // Always from the FULL list, never the filtered one: filtering to
          // "pending" must not make the activity look emptier than it is.
          capacity: R.capacityReport(activity, all),
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

        if (ACTABLE.cancelled.indexOf(reg.status) === -1) {
          return json(409, { error: 'This registration is ' + reg.status + '.' });
        }

        // AN ADMIN CANCELLATION IS NOT SUBJECT TO THE HARD CUTOFF, and that is
        // deliberate. The cutoff decides what a family is OWED, not whether a
        // child can be removed: something can come to light in week nine, and a
        // policy about money must not be the thing that prevents acting on it.
        // So creditFor()'s `guardianMayCancel: false` becomes `entitled: false`
        // here — the cancellation goes through and credits nothing — rather than
        // a refusal.
        const owed = credit.creditFor(reg);
        const done = await cancelAndCredit(reg, {
          by: session.email, source: 'admin',
          note: body.note ? String(body.note).slice(0, 500) : null,
          entitled: owed.guardianMayCancel !== false
        });
        await recordAudit(session, 'registrations.cancel',
          body.participantId + '__' + body.activityId, 'ok',
          { detail: reg.frozen.participantName +
                    (done.entry ? ' · credited ' + done.entry.amountCents + 'c' : ' · no credit') +
                    (body.note ? ' · ' + body.note : '') });
        return json(200, {
          ok: true, registration: done.registration, credit: done.credit, entry: done.entry
        });
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

      // --- money ------------------------------------------------------------
      //
      // All three sit behind the CANCEL axis rather than approve, because that
      // is the axis that exists to mean "may move money". Approving costs
      // nothing and is undone by rejecting; everything below writes a figure a
      // family is billed or can spend.

      // Money in from outside — a bank transfer, cash at the desk. It ADDS
      // rather than sets, so two part payments are two calls and the record
      // keeps both in its history.
      case 'recordPayment': {
        if (!canCancel(session)) return json(403, { error: 'Your role may not record payments' });
        const reg = await store.getRegistration(body.participantId, body.activityId);
        if (!reg) return json(404, { error: 'No such registration.' });
        const cents = Math.round(Number(body.amountCents));
        if (!(cents > 0)) return json(400, { error: 'A payment is a positive number of cents.' });

        const paid = (reg.payment.paidCents || 0) + cents;
        const next = R.transition(reg, {
          status: reg.status, by: session.email,
          note: 'paid ' + cents + 'c' + (body.note ? ' · ' + body.note : '')
        });
        next.payment = Object.assign({}, next.payment, {
          paidCents: paid,
          paidAt: new Date().toISOString(),
          // `owed` until it covers what was billed. Deliberately not "paid" at
          // the first cent: a part payment that reads as settled is a debt
          // nobody chases.
          status: next.payment.owedCents != null && paid >= next.payment.owedCents ? 'paid' : 'owed'
        });
        await store.saveRegistration(next);
        await recordAudit(session, 'registrations.recordPayment',
          body.participantId + '__' + body.activityId, 'ok', { detail: cents + 'c' });
        return json(200, { ok: true, registration: next });
      }

      // Money from the family's own credit, which is a DEBIT on the ledger and a
      // payment on the registration — one action, because doing either alone
      // leaves the two disagreeing about the same euros.
      case 'applyCredit': {
        if (!canCancel(session)) return json(403, { error: 'Your role may not move credit' });
        const reg = await store.getRegistration(body.participantId, body.activityId);
        if (!reg) return json(404, { error: 'No such registration.' });
        const cents = Math.round(Number(body.amountCents));
        if (!(cents > 0)) return json(400, { error: 'An amount is a positive number of cents.' });
        const balance = await ledger.balanceFor(reg.accountId);
        if (cents > balance) {
          return json(409, { error: 'That is more than this account holds.', balanceCents: balance });
        }
        // Ledger first, for the same reason the cancellation writes it first: a
        // debit that lands without the payment is visible and reversible, and a
        // payment that lands without the debit is credit spent twice.
        const entry = await ledger.append({
          accountId: reg.accountId, type: 'debit', amountCents: cents,
          reason: 'credit-applied',
          relatedRegistrationKey: R.key(reg.participantId, reg.activityId),
          note: body.note || null, createdBy: session.email
        });
        const paid = (reg.payment.paidCents || 0) + cents;
        const next = R.transition(reg, {
          status: reg.status, by: session.email, note: 'credit applied ' + cents + 'c'
        });
        next.payment = Object.assign({}, next.payment, {
          paidCents: paid,
          paidAt: new Date().toISOString(),
          status: next.payment.owedCents != null && paid >= next.payment.owedCents ? 'paid' : 'owed'
        });
        await store.saveRegistration(next);
        await recordAudit(session, 'registrations.applyCredit',
          body.participantId + '__' + body.activityId, 'ok', { detail: cents + 'c' });
        return json(200, { ok: true, registration: next, entry: entry,
                           balanceCents: balance - cents });
      }

      // A correction, and it is an ENTRY rather than an edit. The ledger is
      // append-only: a mistake is fixed by writing the opposite line, which
      // leaves both in the record. That is the point — the question a family
      // asks is not what their balance is but why.
      case 'adjustCredit': {
        if (!canCancel(session)) return json(403, { error: 'Your role may not move credit' });
        const account = await accounts.getAccount(body.accountId);
        if (!account) return json(404, { error: 'No such account.' });
        const cents = Math.round(Number(body.amountCents));
        if (!(cents > 0)) return json(400, { error: 'An amount is a positive number of cents.' });
        if (!body.note) return json(400, { error: 'An adjustment needs a note saying why.' });
        const entry = await ledger.append({
          accountId: account.accountId,
          type: body.type === 'debit' ? 'debit' : 'credit',
          amountCents: cents, reason: 'admin-adjustment',
          note: String(body.note).slice(0, 500), createdBy: session.email
        });
        await recordAudit(session, 'registrations.adjustCredit', account.accountId, 'ok',
          { detail: entry.type + ' ' + cents + 'c · ' + entry.note });
        return json(200, { ok: true, entry: entry,
                           balanceCents: await ledger.balanceFor(account.accountId) });
      }

      // Reading the ledger is `access`, not `cancel`. Seeing what a family is
      // owed is part of answering their question about it.
      case 'ledger': {
        const account = await accounts.getAccount(body.accountId);
        if (!account) return json(404, { error: 'No such account.' });
        const entries = await ledger.entriesFor(account.accountId);
        return json(200, { ok: true, accountId: account.accountId, email: account.email,
                           balanceCents: ledger.balanceOf(entries), entries: entries });
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
