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
const spend = require('./_spend-credit');
const { cancelAndCredit } = require('./_registration-cancel');
const attendance = require('./_session-attendance');
const groups = require('./_activity-groups');
const facts = require('./_activity-facts');
const B = require('./_bundle');
const bundleStore = require('./_bundle-store');
const { recordAudit } = require('./_audit');
const mail = require('./_registration-email');
const { sanitiseRich } = require('./_sanitise-rich');
const codes = require('./_checkin-token');
const { strip, SITE } = require('./_email-shell');
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

// ⚠ A REFUSAL MUST NOT WALK AWAY FROM MONEY.
//
// A family can pay while their registration is still `pending` — see isPayable()
// in _checkout.js, and the cost card that showed a €500 balance with no button
// under it, which is why. That makes one state reachable that was not before: a
// PAID registration an admin then wants to say no to.
//
// Rejecting it would leave us holding the money with nothing in the record
// saying we owe it back — the family has no place, so nothing bills it and
// nothing ever asks. So it is refused, and the refusal names the route that does
// account for it: CANCELLING writes the credit through the ledger and sends the
// message, which is the same arithmetic in the same place.
//
// Cancel rather than reject is a real loss of meaning — "we could not take your
// child" and "this registration ended" are different events — and it is the
// honest trade until there is a refund path. `cancelSource` still records that
// an admin did it, and the reason is typed in.
//
// creditedCents comes OFF, because credit already given back is money no longer
// held. That is the opposite of dueCents(), where it is deliberately NOT
// subtracted, because there it is already inside paidCents.
//
// Asked in TWO places: here, where it is the rule, and by `rejectPreview`, so an
// admin learns before writing a paragraph rather than after.
const heldCents = (reg) => ((reg.payment && reg.payment.paidCents) || 0)
                         - ((reg.payment && reg.payment.creditedCents) || 0);

function paidRefusal(reg) {
  const held = heldCents(reg);
  if (!(held > 0)) return null;
  return {
    error: 'This registration has been paid (' + (held / 100).toFixed(2)
         + ' €) and rejecting it would leave that money unaccounted for. '
         + 'Cancel it instead — that credits the family through the ledger — '
         + 'or record a refund first.',
    reason: 'paid-not-refunded', amountCents: held
  };
}

// Read, act, write — with the two checks that are easy to leave out: the
// registration must exist, and it must be in a state the action makes sense from.
async function decide(body, session, status, source) {
  const reg = await store.getRegistration(body.participantId, body.activityId);
  if (!reg) return { code: 404, payload: { error: 'No such registration.' } };
  if (reg.status === status) return { code: 200, payload: { ok: true, registration: reg } };

  if (ACTABLE[status].indexOf(reg.status) === -1) {
    return { code: 409, payload: { error: 'This registration is ' + reg.status + '.' } };
  }

  // ⚠ A REFUSAL MUST NOT WALK AWAY FROM MONEY.
  //
  // A family can pay while their registration is still `pending` — see
  // isPayable() in _checkout.js, and the card that showed a €500 balance with no
  // button under it, which is why. That makes one new state reachable that was
  // not before: a paid registration an admin then wants to say no to.
  //
  // Rejecting it would leave us holding the money with nothing in the record
  // saying we owe it back — the family has no place, so nothing bills it, and
  // nothing ever asks. So it is refused, and the refusal names the route that
  // does account for it: CANCELLING writes the credit through the ledger and
  // sends the message, which is the same arithmetic in the same place.
  //
  // Cancel rather than reject is a real loss of meaning — "we could not take
  // your child" and "this registration ended" are different events — and it is
  // the honest trade until there is a refund path. `cancelSource` still says an
  // admin did it, and the reason is typed in.
  //
  // creditedCents is subtracted because credit already given back is money no
  // longer held. Same reason dueCents() does NOT subtract it: there it is
  // already inside paidCents, here it is what came out.
  if (status === 'rejected') {
    const refusal = paidRefusal(reg);
    if (refusal) return { code: 409, payload: refusal };
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

      // WHAT THE REFUSAL WILL SAY, BEFORE IT SAYS IT.
      //
      // Approval is binary and carries no reason code, by design, so the
      // generated message cannot explain itself — it opens a door instead
      // ("reply and we will talk it through"). An admin who already knows what
      // to say should be able to say it here rather than in a second email the
      // family has to connect to the first.
      //
      // ⚠ IT ANSWERS IN THE FAMILY'S LANGUAGE, and says which. An admin
      // rejecting a Russian-reading family is handed Russian to edit. That is
      // awkward and is not hidden: the screen names the language, and sending
      // the generated text untouched is the default.
      //
      // Reads only. It writes nothing and decides nothing, so opening the
      // preview and closing it again leaves the registration exactly as it was.
      case 'rejectPreview': {
        if (!canApprove(session)) {
          return json(403, { error: 'Your role may open the queue but not decide on it' });
        }
        const reg = await store.getRegistration(body.participantId, body.activityId);
        if (!reg) return json(404, { error: 'No such registration.' });
        // Before the draft, not after it. The send is refused either way, but an
        // admin told at the top has not yet written a paragraph explaining a
        // decision they are about to be prevented from taking.
        const paid = paidRefusal(reg);
        if (paid) return json(409, paid);
        const account = await accounts.getAccount(reg.accountId);
        if (!account) return json(404, { error: 'That registration has no account behind it.' });
        return json(200, Object.assign({ ok: true, to: account.email }, mail.rejectedDraft(reg, account)));
      }

      case 'approve':
      case 'reject': {
        if (!canApprove(session)) {
          return json(403, { error: 'Your role may open the queue but not decide on it' });
        }
        const status = body.action === 'approve' ? 'approved' : 'rejected';

        // ⚠ SANITISED HERE, ALWAYS, AND BEFORE ANYTHING IS DECIDED. The markup
        // arrives in a request body like every other field and is printed into
        // an inbox unescaped, so the client is assumed hostile exactly as it is
        // for the About field — same allowlist, same module. Doing it before
        // decide() also means a body that sanitises to nothing is refused while
        // the registration is still untouched, rather than after it has been
        // rejected with no message to send.
        let override = null;
        if (status === 'rejected' && body.message) {
          const bodyHtml = sanitiseRich(body.message.bodyHtml);
          const subject = String(body.message.subject || '').replace(/\s+/g, ' ').trim().slice(0, 200);
          // An empty edit is a mistake, not an instruction to send a blank
          // refusal. strip() rather than a length check on the markup: '<p></p>'
          // is four tags and no words.
          if (!strip(bodyHtml).trim() || !subject) {
            return json(400, { error: 'A rejection message needs a subject and something to say.' });
          }
          override = { subject: subject, bodyHtml: bodyHtml };
        }

        const out = await decide(body, session, status, null);
        if (out.code === 200 && out.payload.registration && out.payload.registration.status === status) {
          const account = await accounts.getAccount(out.payload.registration.accountId);
          let emailed = null;
          if (account) {
            // settle() answers whether it went. The DECISION stands either way —
            // that rule is not being touched — but an admin who has just written
            // a message by hand must be told if it did not leave, or they will
            // believe a family has been told something nobody has told them.
            emailed = status === 'approved'
              ? await mail.sendApproved(out.payload.registration, account)
              : await mail.sendRejected(out.payload.registration, account, override);
          }
          out.payload.emailed = emailed;
          await recordAudit(session, 'registrations.' + body.action,
            body.participantId + '__' + body.activityId, 'ok',
            { detail: out.payload.registration.frozen.participantName +
                      (override ? ' · message edited by hand' : '') });
        }
        return json(out.code, out.payload);
      }

      // WHAT THE CANCELLATION WILL SAY, and what it will credit.
      //
      // Same shape as rejectPreview: reads only, decides nothing, and answers in
      // the FAMILY's language. The difference is that this draft carries a
      // figure, so it also carries the figure it was built from — see the
      // re-check in `cancel`.
      case 'cancelPreview': {
        if (!canCancel(session)) {
          return json(403, { error: 'Your role may approve but not cancel' });
        }
        const reg = await store.getRegistration(body.participantId, body.activityId);
        if (!reg) return json(404, { error: 'No such registration.' });
        const account = await accounts.getAccount(reg.accountId);
        if (!account) return json(404, { error: 'That registration has no account behind it.' });
        // What the cancellation WOULD credit, from the same pure function the
        // cancellation itself will use a moment later.
        const owed = credit.creditFor(reg);
        const entitled = owed.guardianMayCancel !== false;
        return json(200, Object.assign(
          { ok: true, to: account.email },
          mail.cancelledDraft(reg, account, entitled ? owed.total : 0)));
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
        const entitled = owed.guardianMayCancel !== false;

        // ⚠ THE DRAFT'S FIGURE MUST STILL BE THE TRUE FIGURE.
        //
        // A reviewed message is an editable box with money in it, in front of an
        // action that cannot be undone — only compensated. creditFor() is pure
        // and reads a frozen block, so the only input that moves between opening
        // the panel and pressing send is the clock; but the cutoffs are days, so
        // a panel opened at 23:59 and sent at 00:01 can straddle one. Then the
        // family would be told a number nobody credited them.
        //
        // So the client sends back the figure it drafted against and it is
        // compared here, BEFORE anything is cancelled — the same shape as the
        // optimistic lock on an activity record, and the same answer: 409, with
        // the new figure, and nothing touched.
        let override = null;
        if (body.message) {
          const want = entitled ? owed.total : 0;
          if (Number(body.message.basedOnCreditCents) !== want) {
            return json(409, {
              error: 'What this cancellation credits has changed since the message was drafted. ' +
                     'Re-open it and check the figure.',
              reason: 'credit-moved', creditCents: want
            });
          }
          // Sanitised here, always, and BEFORE the cancellation: the markup
          // arrives in a request body and is printed into an inbox unescaped,
          // and a body that sanitises to nothing must be refused while the
          // registration is still standing.
          const bodyHtml = sanitiseRich(body.message.bodyHtml);
          const subject = String(body.message.subject || '').replace(/\s+/g, ' ').trim().slice(0, 200);
          if (!strip(bodyHtml).trim() || !subject) {
            return json(400, { error: 'A cancellation message needs a subject and something to say.' });
          }
          override = { subject: subject, bodyHtml: bodyHtml };
        }

        const done = await cancelAndCredit(reg, {
          by: session.email, source: 'admin',
          note: body.note ? String(body.note).slice(0, 500) : null,
          entitled: entitled
        });

        // After the ledger, never before, and with the figure the ENTRY
        // recorded rather than the one predicted above.
        let emailed = null;
        const account = await accounts.getAccount(reg.accountId);
        if (account) {
          emailed = await mail.sendCancelled(done.registration, account,
            (done.entry && done.entry.amountCents) || 0, override);
        }
        await recordAudit(session, 'registrations.cancel',
          body.participantId + '__' + body.activityId, 'ok',
          { detail: reg.frozen.participantName +
                    (done.entry ? ' · credited ' + done.entry.amountCents + 'c' : ' · no credit') +
                    (body.note ? ' · ' + body.note : '') });
        return json(200, {
          ok: true, registration: done.registration, credit: done.credit, entry: done.entry,
          sessions: done.sessions, emailed: emailed
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
        const target = groups.groupById(activity, body.groupId);
        if (!target) return json(400, { error: 'No such group on this activity.' });

        // ⚠ THE HISTORY NAMES THE GROUPS, NOT THEIR IDS, and it names BOTH.
        // This read `moved to grp-1f3a9c`, which is the one spelling nobody
        // reading a history months later can resolve — the frozen groupName
        // exists precisely because an id is not for people. And "moved to
        // Advanced" with no "from" is half a record: the question asked about a
        // move is almost always which way it went.
        //
        // The name is taken from the FROZEN one on the way out and the
        // activity's current one on the way in, which is correct rather than
        // inconsistent: what they were in is what they agreed to, and what they
        // are moving into is what it is called today.
        const from = (reg.frozen && reg.frozen.groupName) || null;
        const name = (v) => facts.pick(v, 'en');
        const moved = (name(from) || '\u2014') + ' \u2192 ' + (name(target.name) || body.groupId);

        const next = R.transition(reg, {
          status: reg.status, by: session.email,
          note: 'moved group: ' + moved
        });
        next.groupId = body.groupId;
        next.frozen = Object.assign({}, next.frozen, { groupName: target.name || null });
        await store.saveRegistration(next);
        await recordAudit(session, 'registrations.moveGroup',
          body.participantId + '__' + activity.activityId, 'ok',
          { detail: reg.frozen.participantName + ' \u00B7 ' + moved });
        return json(200, { ok: true, registration: next });
      }

      // --- the register, for a pay-per-session activity -----------------------

      // One evening, and who is on it. This is the screen an admin opens on the
      // night, so it is a list of people rather than a count — the privacy rule
      // that keeps the family-facing endpoint to a number does not apply to the
      // person running the room.
      case 'register': {
        const activity = await published(body.slug);
        if (!activity) return json(404, { error: 'No such activity.' });
        if (activity.type !== 'dropin') {
          return json(400, { error: 'This activity runs by the term, so it has a queue rather than a register.' });
        }
        const date = body.sessionDate;
        // ⚠ EVERY EVENING, NOT JUST THE ONE ASKED FOR, because the date strip
        // above the table has to say how full each one is — and `forActivity`
        // narrowed by date would count only the date already chosen, so every
        // other chip would read nought taken. Counting them in the browser was
        // the alternative and is a second implementation of capacityForDate() in
        // a place that cannot see the calendar; the rule stays server-side, the
        // same way the family's own picker gets its list.
        const all = await attendance.forActivity(activity.activityId);
        const rows = [];
        for (const att of all.filter((a) => !date || a.sessionDate === date)) {
          const account = await accounts.getAccount(att.accountId);
          const p = await participants.getParticipant(att.participantId);
          rows.push({
            participantId: att.participantId, sessionDate: att.sessionDate,
            name: p ? [p.firstName, p.lastName].filter(Boolean).join(' ') : att.participantId,
            accountId: att.accountId, accountEmail: account ? account.email : null,
            groupId: att.groupId, status: att.status, payment: att.payment,
            startsAt: att.frozen.startsAt, history: att.history
          });
        }
        return json(200, {
          ok: true,
          activity: { activityId: activity.activityId, slug: activity.slug, title: activity.title },
          // ⚠ EACH DATE WITH ITS OWN ROOM. This was a list of date strings, which
          // is what the check-in codes need and not what a register needs: the
          // question an admin opens this screen with is "is tonight full", and a
          // bare date cannot answer it. capacityForDate() counts `booked` and
          // `attended` only — a no-show is not in the room, whatever they still
          // owe for the evening.
          //
          // Past evenings are included deliberately. bookableDates() is the
          // whole calendar rather than what is still to come, and last Tuesday's
          // register is exactly what somebody reconciling attendance wants.
          dates: attendance.bookableDates(activity, groups.ANY)
            .map((d) => R.capacityForDate(activity, all, d)),
          sessionDate: date || null,
          capacity: date ? R.capacityForDate(activity, all, date) : null,
          // How many hold a REGISTRATION, which is a different question from how
          // many are in the room on any evening and is deliberately uncapped.
          registered: (await store.forActivity(activity.activityId))
            .filter((r) => R.holdsASpot(r)).length,
          register: rows
        });
      }

      // THE CODES ON THE WALL. One per bookable evening, minted once and
      // returned unchanged afterwards — so re-opening this panel shows the same
      // code as the sheet already pinned up, rather than silently retiring it.
      //
      // `access` rather than `approve`: a code opens a list of names, which is
      // what `access` already gates on this tool. Marking the register is the
      // action, and that stays behind `approve`.
      //
      // It returns the URL and not an image. Rendering a QR is a picture of a
      // string, and a picture is the one thing a browser can make without this
      // handler doing anything — while a server-side renderer would be a
      // dependency, a content type and a cache header to get wrong.
      case 'checkinCodes': {
        const activity = await published(body.slug);
        if (!activity) return json(404, { error: 'No such activity.' });
        if (activity.type !== 'dropin') {
          return json(400, { error: 'This activity runs by the term, so it has a queue rather than a register.' });
        }
        // ANY, and said out loud: one code per EVENING, covering whoever is
        // coming to it. A code is pinned to a wall and the wall does not know
        // which group is in the room.
        const dates = attendance.bookableDates(activity, groups.ANY);
        const out = [];
        for (const date of dates) {
          const code = await codes.codeFor(activity, date);
          out.push({ sessionDate: date, url: SITE + '/checkin?t=' + encodeURIComponent(code.token) });
        }
        return json(200, { ok: true, activity: { slug: activity.slug, title: activity.title }, codes: out });
      }

      // ⚠ WHAT HAS BEEN BOUGHT IN ADVANCE, which the queue could not show.
      //
      // The queue is registrations, and a bundle is not one: it is a purchase
      // against an activity, and a family can hold two. An admin looking at an
      // evening where half the room owes nothing needs to be able to see why,
      // and "they have a bundle" is only findable if something shows it.
      //
      // `access` rather than `approve`: reading what a family bought is part of
      // answering their question about it, and it moves nothing.
      //
      // ⚠ IT GOES THROUGH bundleView(), THE SAME BUILDER THE FAMILY'S OWN CARD
      // USES. Two builders would be two screens that can disagree about how many
      // entries somebody has left — and the family would be reading one of them
      // out to the admin reading the other.
      case 'bundles': {
        const activity = await published(body.slug);
        if (!activity) return json(404, { error: 'No such activity.' });
        if (activity.type !== 'dropin') {
          return json(400, { error: 'This activity runs by the term, so nothing is bought in advance.' });
        }
        const now = Date.now();
        const held = await bundleStore.forActivity(activity.activityId);
        const att = await attendance.forActivity(activity.activityId);
        const rows = [];
        for (const bundle of held) {
          const byDate = {};
          att.filter((a) => a.participantId === bundle.participantId)
             .forEach((a) => { byDate[a.sessionDate] = a; });
          const participant = await participants.getParticipant(bundle.participantId);
          rows.push(Object.assign(B.bundleView(bundle, byDate, now), {
            participantName: participant
              ? [participant.firstName, participant.lastName].filter(Boolean).join(' ')
              : bundle.participantId
          }));
        }
        // Newest purchase first: an admin opening this is almost always asking
        // about something that has just happened.
        rows.sort((a, b) => String(b.purchasedAt).localeCompare(String(a.purchasedAt)));
        return json(200, { ok: true, bundles: rows });
      }

      // Marking the register. `approve` rather than `cancel`: recording who
      // turned up moves no money on its own — what they owe was decided when the
      // evening was booked, and a no-show still owes it.
      case 'markAttendance': {
        if (!canApprove(session)) {
          return json(403, { error: 'Your role may open the register but not mark it' });
        }
        const att = await attendance.getAttendance(
          body.participantId, body.activityId, body.sessionDate);
        if (!att) return json(404, { error: 'No such booking.' });
        if (['attended', 'no-show'].indexOf(body.status) === -1) {
          return json(400, { error: 'A register is marked "attended" or "no-show".' });
        }
        const next = attendance.transition(att, {
          status: body.status, by: session.email,
          note: body.note ? String(body.note).slice(0, 500) : null
        });
        await attendance.saveAttendance(next);
        await recordAudit(session, 'registrations.markAttendance',
          body.participantId + '__' + body.activityId + '__' + body.sessionDate, 'ok',
          { detail: body.status });
        return json(200, { ok: true, session: next });
      }

      // Money for ONE evening. Its own action rather than a flag on
      // recordPayment, because the two settle different records: one clears a
      // term, the other clears a Tuesday.
      case 'recordSessionPayment': {
        if (!canCancel(session)) return json(403, { error: 'Your role may not record payments' });
        const att = await attendance.getAttendance(
          body.participantId, body.activityId, body.sessionDate);
        if (!att) return json(404, { error: 'No such booking.' });
        const cents = Math.round(Number(body.amountCents));
        if (!(cents > 0)) return json(400, { error: 'A payment is a positive number of cents.' });

        const paid = (att.payment.paidCents || 0) + cents;
        const next = attendance.transition(att, {
          status: att.status, by: session.email, note: 'paid ' + cents + 'c'
        });
        next.payment = Object.assign({}, next.payment, {
          paidCents: paid, paidAt: new Date().toISOString(),
          status: next.payment.owedCents != null && paid >= next.payment.owedCents ? 'paid' : 'owed'
        });
        await attendance.saveAttendance(next);
        await recordAudit(session, 'registrations.recordSessionPayment',
          body.participantId + '__' + body.activityId + '__' + body.sessionDate, 'ok',
          { detail: cents + 'c' });
        return json(200, { ok: true, session: next });
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
        // ONE SPENDER, two callers. A family can spend their own credit now, and
        // two implementations would be two that can cap differently or write the
        // two halves in a different order — which surfaces when a family reads
        // their balance to the admin reading theirs.
        let done;
        try {
          done = await spend.spendCredit({
            record: reg, kind: 'registration',
            cents: body.amountCents, by: session.email, note: body.note || null
          });
        } catch (err) {
          const code = err.reason === 'amount' ? 400 : 409;
          return json(code, { error: err.message, reason: err.reason,
                              balanceCents: err.balanceCents, owedCents: err.owedCents });
        }
        await recordAudit(session, 'registrations.applyCredit',
          body.participantId + '__' + body.activityId, 'ok', { detail: done.spentCents + 'c' });
        return json(200, { ok: true, registration: done.record, entry: done.entry,
                           balanceCents: done.balanceCents });
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
      // one. So the admin calls the sweep directly rather than the endpoint.
      //
      // ⚠ runRegistrations(), NOT run(). The nightly job has a second half that
      // completes finished activities, and that half commits to git and
      // republishes live pages — an ACTIVITIES permission. This button is gated
      // on canApprove, which is a registrations one, and tells the admin it
      // "only updates what the queue says". Calling run() here would let an
      // admin who may work the queue but may not publish do exactly that, from a
      // button that says it does something else.
      case 'sweep': {
        if (!canApprove(session)) {
          return json(403, { error: 'Your role may open the queue but not decide on it' });
        }
        const result = await sweep.runRegistrations();
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
