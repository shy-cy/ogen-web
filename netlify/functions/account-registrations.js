// /api/account-registrations — what a signed-in guardian may do about places.
//
// Actions: activity | list | submit | cancel
//
// AUTHORISATION IS A LINK, CHECKED PER PARTICIPANT, exactly as in
// account-family.js: every action that names a participant starts by asking
// whether this account is one of its guardians. Owning one child grants nothing
// about any other, and the check is a helper called at the top of each branch
// rather than a middleware guessing which argument is an id.
//
// IT AUTHENTICATES THROUGH THE MEMBER STORE, which is why it is a separate file
// from admin-registrations.js and not a branch inside it. A guardian token
// handed to an admin function is not found, because it is not there — that
// arrangement is the security boundary, not a role check somebody can forget.
//
// ⚠ Arms the legal gate, correctly.

const { readJson } = require('./_github');
const { migrate } = require('./_activity-migrate');
const sessions = require('./_member-session');
const participants = require('./_participant-store');
const guardians = require('./_guardian-store');
const store = require('./_registration-store');
const R = require('./_registration');
const credit = require('./_credit');
const ledger = require('./_credit-ledger');
const { cancelAndCredit } = require('./_registration-cancel');
const facts = require('./_activity-facts');
const mail = require('./_registration-email');

const json = (statusCode, payload) => ({
  statusCode,
  // no-store on every response. These carry a child's name, and the frozen
  // block carries a date of birth.
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  body: JSON.stringify(payload)
});

const NOT_YOURS = 'No such participant.';

// READ FROM GITHUB, NEVER FROM THE DEPLOYED BUNDLE. The bundle trails a save by
// about a minute, and an activity whose capacity or age range changed a moment
// ago must not be registered against under its old terms. Same rule the
// optimistic-locking check already follows.
async function published(slug) {
  if (!slug) return null;
  const raw = await readJson('activities/' + slug + '.json');
  return raw ? migrate(raw) : null;
}

// What the registration form needs, and nothing it does not. It is deliberately
// a COUNT and never a list: how many places are left is public-ish information,
// who is in them is not.
function activityView(activity, report, lang) {
  return {
    activityId: activity.activityId,
    slug: activity.slug,
    type: activity.type || 'course',
    status: activity.status,
    title: activity.title,
    capacity: report.capacity,
    taken: report.taken,
    left: report.left,
    full: !R.hasRoom(report, null) && !report.named,
    groups: report.named
      ? report.named.map((g) => ({
          groupId: g.groupId,
          name: g.name,
          label: facts.namedGroupLine({ name: g.name, capacity: g.capacity }, lang || 'he'),
          capacity: g.capacity,
          left: g.left,
          full: g.left != null && g.left <= 0
        }))
      : null
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    return json(400, { error: 'Body must be JSON' });
  }

  const found = await sessions.authenticate(body);
  if (!found) return json(401, { error: 'Not signed in' });
  const me = found.account;
  const lang = (me.profile && me.profile.preferredLanguage) || 'he';

  const mustGuard = async (participantId) => {
    if (!participantId) return null;
    if (!(await guardians.isGuardian(participantId, me.accountId))) return null;
    return participants.getParticipant(participantId);
  };

  try {
    switch (body.action) {
      // --- what is on offer ------------------------------------------------
      case 'activity': {
        const activity = await published(body.slug);
        if (!activity) return json(404, { error: 'No such activity.' });
        const regs = await store.forActivity(activity.activityId);
        return json(200, { ok: true, activity: activityView(activity, R.capacityReport(activity, regs), lang) });
      }

      // --- this account's registrations ------------------------------------
      case 'list': {
        const ids = await guardians.participantIdsFor(me.accountId);
        const out = [];
        for (const id of ids) {
          const p = await participants.getParticipant(id);
          for (const reg of await store.forParticipant(id)) {
            out.push({
              participantId: reg.participantId,
              participantName: p ? [p.firstName, p.lastName].filter(Boolean).join(' ') : reg.frozen.participantName,
              activityId: reg.activityId,
              slug: reg.frozen.activitySlugAtSubmission,
              title: reg.frozen.activityTitle,
              groupId: reg.groupId,
              groupName: reg.frozen.groupName,
              status: reg.status,
              // The DERIVED answer, not the stored status. A pending
              // registration whose deadline passed an hour ago is already not
              // holding a place, whether or not the nightly sweep has run.
              holdsASpot: R.holdsASpot(reg),
              submittedAt: reg.submittedAt,
              expiresAt: reg.expiresAt,
              // What this registration is billed, and whether the yearly fee was
              // part of it. A family looking at a second term should be able to
              // see that it is 300 rather than 350, and why.
              owedCents: reg.payment.owedCents,
              paidCents: reg.payment.paidCents,
              feeCharged: reg.frozen.price.feeCharged,
              feeYear: reg.frozen.feeYear,
              // What cancelling would do, computed from the terms frozen onto
              // this registration — so the answer shown is the answer that will
              // be applied, and both come from the same function.
              cancellation: credit.creditFor(reg)
            });
          }
        }
        return json(200, { ok: true, registrations: out });
      }

      // --- ask for a place --------------------------------------------------
      case 'submit': {
        const participant = await mustGuard(body.participantId);
        if (!participant) return json(404, { error: NOT_YOURS });
        const activity = await published(body.slug);
        if (!activity) return json(404, { error: 'No such activity.' });

        const groupId = body.groupId || null;
        const errors = R.submissionErrors(activity, participant, groupId);
        if (errors.length) return json(400, { error: errors[0], errors: errors });

        const existing = await store.getRegistration(participant.participantId, activity.activityId);
        if (existing && R.holdsASpot(existing)) {
          return json(409, {
            error: existing.status === 'approved'
              ? 'This participant already has a place in this activity.'
              : 'There is already a request for this participant, waiting for an answer.',
            status: existing.status
          });
        }

        const regs = await store.forActivity(activity.activityId);
        const report = R.capacityReport(activity, regs);
        if (!R.hasRoom(report, groupId)) {
          // No waitlist yet. The design flagged one and did not build it: a
          // waitlist has to choose who gets a freed place, tell them, and give
          // them a deadline before it moves on again, and none of that is
          // decided. Today the place is simply gone and the next submission
          // takes it, first come.
          return json(409, { error: 'This activity is full.', full: true, capacity: report.capacity });
        }

        const reg = R.newRegistration({
          activity: activity, participant: participant, accountId: me.accountId, groupId: groupId,
          // THIS PARTICIPANT'S OWN registrations, and nothing else. The fee is
          // scoped to one participant, one activity, one academic year, so the
          // waiver is answerable from a prefix scan of their own key space — no
          // sibling lookup, no account aggregate, no ledger.
          priorRegistrations: await store.forParticipant(participant.participantId)
        });

        // A record already existed for this pair — rejected, expired or
        // cancelled — and the key is one per participant per activity, so the
        // new request lands in the same blob. ITS HISTORY IS CARRIED FORWARD
        // rather than overwritten: a refusal is something that happened, and an
        // admin looking at a second request should be able to see the first.
        if (existing) reg.history = (existing.history || []).concat(reg.history);

        await store.saveRegistration(reg);
        // Best effort, and after the write. An email that fails must not undo a
        // registration that succeeded.
        if (reg.status === 'approved') await mail.sendApproved(reg, me);
        else await mail.sendReceived(reg, me);
        return json(200, { ok: true, registration: reg });
      }

      // --- give a place back ------------------------------------------------
      case 'cancel': {
        const participant = await mustGuard(body.participantId);
        if (!participant) return json(404, { error: NOT_YOURS });
        const reg = await store.getRegistration(body.participantId, body.activityId);
        if (!reg) return json(404, { error: 'No such registration.' });
        if (reg.status === 'cancelled') return json(200, { ok: true, registration: reg });
        if (reg.status !== 'pending' && reg.status !== 'approved') {
          return json(409, { error: 'This registration is already ' + reg.status + '.' });
        }

        const owed = credit.creditFor(reg);

        // THE HARD CUTOFF GOVERNS ENTITLEMENT, and here it also closes the
        // guardian's own button — with the date, so the refusal can name it. An
        // ADMIN cancelling after this date still goes through and credits
        // nothing: a child has to be removable in week nine for a reason that is
        // not about money.
        if (owed.guardianMayCancel === false) {
          return json(409, {
            error: 'Cancellation for this activity closed on ' + owed.closedOn + '. Please contact us.',
            reason: owed.reason, closedOn: owed.closedOn
          });
        }

        // Nothing to release. The place is free the moment the cancellation is
        // written, because capacity is counted and holdsASpot() is already false
        // for a cancelled record — there is no hold to give back and no counter
        // to decrement, and so no window in which the number is wrong.
        //
        // The credit is written FIRST, inside cancelAndCredit. A ledger entry
        // that fails must take the whole action down with it: the family keeps
        // their place and can try again, which is recoverable, where cancelling
        // and losing the credit is not.
        const done = await cancelAndCredit(reg, {
          by: me.accountId, source: 'guardian',
          note: body.reason ? String(body.reason).slice(0, 500) : null
        });
        return json(200, {
          ok: true, registration: done.registration, credit: done.credit,
          entry: done.entry, balance: await ledger.balanceFor(me.accountId)
        });
      }

      // What this account is owed, and every line behind it. Summed from the
      // entries rather than read off a cached total: two representations of one
      // number on a store with no transaction is how a balance quietly stops
      // matching its own history.
      case 'balance': {
        const entries = await ledger.entriesFor(me.accountId);
        return json(200, {
          ok: true,
          balanceCents: ledger.balanceOf(entries),
          currency: ledger.CURRENCY,
          entries: entries
        });
      }

      default:
        return json(400, { error: `Unknown action "${body.action}"` });
    }
  } catch (err) {
    console.error('[account-registrations] ' + (err && err.stack || err));
    return json(500, { error: 'Something went wrong. Please try again.' });
  }
};
