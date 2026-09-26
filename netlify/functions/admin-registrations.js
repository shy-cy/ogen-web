// /api/admin-registrations — the approval queue.
//
// Actions: queue | approve | reject | cancel | moveGroup | givePlace | register |
//          markAttendance | cancelSession | mail | checkinCodes | bundles |
//          recordPayment | applyCredit | adjustCredit | recordSessionPayment |
//          ledger | sweep
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
const { cancelAndCredit, cancelOneSession } = require('./_registration-cancel');
const { openRegistration } = require('./_registration-open');
const attendance = require('./_session-attendance');
const groups = require('./_activity-groups');
const facts = require('./_activity-facts');
const B = require('./_bundle');
const bundleStore = require('./_bundle-store');
const { recordAudit } = require('./_audit');
const mail = require('./_registration-email');
const emailLog = require('./_email-log');
const waitlist = require('./_waitlist');
const { sanitiseRich } = require('./_sanitise-rich');
const codes = require('./_checkin-token');
const { strip, SITE } = require('./_email-shell');
const sweep = require('./_registration-sweep');

const TOOL = 'registrations';

// How many addresses one `mail` request reads for. Every one costs a prefix
// listing plus up to a dozen reads, and this function has ten seconds. Sixty is
// far above any roster this centre runs and still leaves the request well inside
// its budget — and going over is named rather than trimmed away.
const MAX_MAIL_ADDRESSES = 60;

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
    // When they joined the queue. Kept after a place is taken, so a row can
    // still say the family waited three weeks for it.
    waitingSince: reg.waitingSince || null,
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
        // ⚠ WAITING IS NOT A QUEUE ENTRY, so it is its own list rather than a
        // sixth pill in the table. Nothing in the table's row applies to it:
        // there is no place to approve, nothing to reject, no money owed and no
        // deadline running. Mixed in, every one of those columns would be blank
        // and the two decision buttons would be offering to decide something
        // that has not been asked.
        //
        // In JOIN ORDER, which is the only order a list like this has. It is not
        // a promise — a freed place is announced to everybody at once and goes
        // to whoever takes it first — but it is what an admin is looking at when
        // somebody phones to ask how long they have been waiting.
        let regs = all.filter((r) => !R.isWaiting(r));
        if (body.status) regs = regs.filter((r) => r.status === body.status);
        if (body.groupId) regs = regs.filter((r) => r.groupId === body.groupId);
        const rows = [];
        for (const reg of regs) rows.push(await row(reg));
        const waitingRows = [];
        for (const reg of all.filter(R.isWaiting)
          .sort((a, b) => String(a.waitingSince || '').localeCompare(String(b.waitingSince || '')))) {
          waitingRows.push(await row(reg));
        }
        return json(200, {
          waiting: waitingRows,
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

      // ⚠ GIVING SOMEBODY A PLACE OFF THE WAITING LIST.
      //
      // This file used to say, in the comment above the waiting list, that the
      // admin gets "a list, not a sixth kind of queue row", with NO controls on
      // it — because "a give this one a place button would be a second, quieter
      // rule running beside the announced race, and the two would disagree the
      // first time somebody used it."
      //
      // That reasoning is still true and the conclusion was wrong, and the case
      // that shows it is the ordinary one: a place opens, everybody waiting is
      // emailed, and nobody claims it. Somebody phones instead. Somebody is not
      // reading email. The race is what happens when families act; it was never
      // meant to be the only thing that can happen, and with no control at all
      // the only route was to ask the family to go and press a button — or, if
      // they could not, nothing.
      //
      // ⚠ SO IT IS THE SAME ACT, NOT A SECOND RULE. It goes through
      // openRegistration(), which is what a family claiming their own place goes
      // through: the terms are re-frozen at today's price, the fee waiver and
      // the age check are re-decided, the room is checked again, and the hold is
      // CLAIM_HOURS rather than the ordinary window. That is the whole reason
      // that function was lifted into its own module. The two cannot disagree
      // because there is only one of them.
      //
      // ⚠ AND IT IS REFUSED WHEN THE GROUP IS FULL, by openRegistration rather
      // than by a check here. An admin handing out a place that does not exist
      // is the disabled full-group option's mistake from the other side, and it
      // would put a family in a room with no chair. Over capacity is something
      // that HAPPENS, from two families submitting in the same half-second; it
      // is not something to offer a button for.
      case 'givePlace': {
        if (!canApprove(session)) {
          return json(403, { error: 'Your role may open the queue but not decide on it' });
        }
        const activity = await published(body.slug);
        if (!activity) return json(404, { error: 'No such activity.' });
        const reg = await store.getRegistration(body.participantId, activity.activityId);
        if (!reg) return json(404, { error: 'No such registration.' });
        // Asked of the RECORD, not of the request. A row that has already been
        // given a place — by this button a moment ago, or by the family getting
        // there first — must not be opened a second time.
        if (!R.isWaiting(reg)) {
          return json(409, { error: 'That registration is ' + reg.status + ', not waiting.' });
        }
        const participant = await participants.getParticipant(reg.participantId);
        if (!participant) return json(404, { error: 'That participant no longer exists.' });

        const opened = await openRegistration({
          activity: activity, participant: participant, accountId: reg.accountId,
          groupId: reg.groupId || null,
          // ⚠ FALSE, WHICH IS THE WHOLE POINT. `waitlist` says what to do if
          // there is no room, and here the answer is to refuse and say so — with
          // it true the family would be quietly put back in the queue they are
          // already in and the screen would look like the place had been given.
          waitlist: false
        });
        if (opened.status) {
          return json(opened.status, {
            error: opened.key === 'activity-full'
              ? 'That group is full — there is no place to give.'
              : 'That registration cannot be opened (' + opened.key + ').',
            full: opened.key === 'activity-full'
          });
        }
        const next = opened.reg;

        // Best effort and after the write, like every other message here. Which
        // one is decided the same way `submit` decides it, because it is the
        // same two outcomes: a place, or a place a person still has to confirm.
        let emailed = null;
        const account = await accounts.getAccount(next.accountId);
        if (account) {
          emailed = next.status === 'approved'
            ? await mail.sendApproved(next, account, null, facts.whereFor(activity, next.groupId))
            : await mail.sendReceived(next, account,
                                      (activity.registration || {}).sessionCancelHours,
                                      facts.whereFor(activity, next.groupId));
        }
        await recordAudit(session, 'registrations.givePlace',
          next.participantId + '__' + next.activityId, 'ok',
          { detail: next.frozen.participantName + ' \u00b7 off the waiting list' });
        return json(200, { ok: true, registration: await row(next), emailed: emailed });
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
            // ⚠ THE ADDRESS IS READ LIVE, and only for the message that says
            // yes. A rejection must never carry it: telling somebody with no
            // place where the place is, in the one message that takes something
            // away, is the worst possible pairing. It is loaded here rather than
            // by decide(), which is deliberately about the status table alone.
            const reg2 = out.payload.registration;
            const act2 = status === 'approved' ? await published(reg2.slug || body.slug) : null;
            emailed = status === 'approved'
              ? await mail.sendApproved(reg2, account, null,
                                        act2 ? facts.whereFor(act2, reg2.groupId) : null)
              : await mail.sendRejected(reg2, account, override);
          }
          out.payload.emailed = emailed;
          // ⚠ A REJECTION FREES A PLACE, which is easy to forget because it is
          // the one decision here that does not feel like one. It is the same
          // mechanism as a cancellation to everything that counts: holdsASpot()
          // stopped counting the record the moment `rejected` was written.
          if (status === 'rejected') {
            await waitlist.placeOpened(body.activityId,
              out.payload.registration.groupId || null);
          }
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
        // cancellation itself will use a moment later — and ⚠ WITH THE CLOCK,
        // which this omitted. _credit.js never asks the time, so `creditFor(reg)`
        // reads every threshold as not yet reached: the draft named the whole of
        // what was paid, and cancelAndCredit() — which does pass a timestamp —
        // wrote the real figure. The family was told a number nobody credited
        // them, which is the exact thing the guard below exists to prevent.
        // ⚠ AND WITH THE SIBLINGS, for the same class of reason. The yearly fee
        // does not come back while another term of that year is still standing
        // on it, so a draft built without asking names a figure €50 above what
        // the ledger will write — and the guard in `cancel` below would then
        // refuse the admin's own draft with a 409 nobody could explain.
        const siblings = await store.forParticipant(reg.participantId);
        const owed = credit.creditFor(reg, Date.now(),
          { feeHeldElsewhere: R.feeHeldByLiveTerm(reg, siblings) });
        return json(200, Object.assign(
          { ok: true, to: account.email, feeHeldElsewhere: owed.feeHeldElsewhere },
          mail.cancelledDraft(reg, account, owed.total)));
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

        // NEITHER SIDE IS SUBJECT TO THE HARD CUTOFF ANY MORE, and there used to
        // be an `entitled` flag here saying so.
        //
        // It existed because the cutoff refused a GUARDIAN outright while an
        // admin went through and credited nothing, so the two paths genuinely
        // differed and the caller had to say which it was. The cutoff now ends
        // the credit for both — creditFor() returns zero past it, whoever is
        // asking — so the flag had exactly one possible value and a parameter
        // that can only be true is a rule nobody can read. The zero comes from
        // the arithmetic, which is where it was always coming from.
        // ⚠ WITH THE CLOCK, for the reason cancelPreview carries above: without
        // it `owed.total` is always the most generous figure, so the check below
        // compared two copies of one wrong number and agreed with itself. And
        // with the siblings, so the figure compared is the one cancelAndCredit()
        // is about to write rather than a second opinion of it.
        const owed = credit.creditFor(reg, Date.now(),
          { feeHeldElsewhere: R.feeHeldByLiveTerm(reg, await store.forParticipant(reg.participantId)) });

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
          const want = owed.total;
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
          note: body.note ? String(body.note).slice(0, 500) : null
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
        await waitlist.placeOpened(body.activityId, reg.groupId || null);
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

        // ⚠ AND THE FAMILY IS TOLD, which for a release they were not.
        //
        // This is the only change an admin can make to a registration that
        // alters what the family has to DO — the groups can meet on a different
        // day, at a different hour, in a different room, with a different
        // teacher — and it was the one change that wrote to nobody. The names
        // travel as their {he,en,ru} bags rather than picked, because the
        // language of this request is the language of the ADMIN'S screen and
        // the message is written in the language of the ACCOUNT.
        //
        // Live rows only. A cancelled or expired registration is not a class
        // anybody is attending, so a note about which group it is filed under
        // would be news about nothing. The client already refuses to draw the
        // select on one; this is the same rule server-side, where it counts.
        //
        // After the save, and never blocking it: the move stands whether or not
        // the message goes, exactly as an approval does. `emailed` says which.
        let emailed = null;
        if (R.LIVE_STATUSES.indexOf(next.status) !== -1) {
          const account = await accounts.getAccount(reg.accountId);
          if (account) emailed = await mail.sendMoved(next, account, from, target.name || null);
        }
        await recordAudit(session, 'registrations.moveGroup',
          body.participantId + '__' + activity.activityId, 'ok',
          { detail: reg.frozen.participantName + ' \u00B7 ' + moved });
        return json(200, { ok: true, registration: next, emailed: emailed });
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
        // ⚠ ONE CLOCK FOR THE WHOLE TABLE. creditForSession() measures against a
        // deadline in hours, so reading Date.now() per row would let two rows of
        // one register straddle the same boundary and disagree.
        const now = Date.now();
        for (const att of all.filter((a) => !date || a.sessionDate === date)) {
          const account = await accounts.getAccount(att.accountId);
          const p = await participants.getParticipant(att.participantId);
          const giveBack = att.status === 'booked' ? credit.creditForSession(att, now) : null;
          rows.push({
            participantId: att.participantId, sessionDate: att.sessionDate,
            name: p ? [p.firstName, p.lastName].filter(Boolean).join(' ') : att.participantId,
            accountId: att.accountId, accountEmail: account ? account.email : null,
            groupId: att.groupId, status: att.status, payment: att.payment,
            // When they joined the queue for this evening. The order the waiting
            // table is read in, and it survives the claim, so "waited since
            // Tuesday" is still true on the booking it became.
            waitingSince: att.waitingSince || null,
            startsAt: att.frozen.startsAt, history: att.history,
            // ⚠ WHAT CANCELLING WOULD CREDIT, RIGHT NOW, from the same pure
            // function the cancellation itself will use — the rule the family's
            // own screen has always followed, so what is offered is what
            // happens. `null` on anything that is not a live booking, because
            // there is nothing there to give back. It costs no read: the record
            // is already in hand and creditForSession() opens no store.
            cancelCredit: giveBack ? giveBack.credit : null,
            // ⚠ AND WHY IT IS THAT FIGURE. A zero has to say why it is a zero —
            // the family area's own rule — and here the reader is the admin who
            // is about to answer the family's question about it. `too-late`,
            // `started` and `nothing paid at all` are three different
            // conversations and the figure alone cannot tell them apart.
            cancelReason: giveBack ? giveBack.reason : null
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
          // ⚠ THE QUEUE IS ITS OWN LIST, exactly as it is on the course roster,
          // and for the same reason: nothing in a register row applies to
          // somebody waiting. They hold no seat, owe nothing, have no attendance
          // to mark and are not in the room the count above is about. Mixed in,
          // the one row with nothing to do about it sat between two that had —
          // with Present and No-show offered against a seat they do not hold.
          register: rows.filter((r) => r.status !== 'waiting'),
          // Join order, which is the only order a queue has. Oldest first.
          waiting: rows.filter((r) => r.status === 'waiting')
            .sort((a, b) => String(a.waitingSince || '').localeCompare(String(b.waitingSince || '')))
        });
      }

      // ⚠ WHAT BECAME OF WHAT WE WROTE TO THIS FAMILY.
      //
      // Asked for as the only way to tell "never sent" from "bounced" from
      // "delivered and ignored" when a family says they never received
      // something — and those three need opposite responses, which is the
      // sentence _email-log.js opens with. Every send has been recorded since
      // that module was written and the delivery webhook has been updating the
      // statuses ever since, and NOTHING HAS EVER READ ANY OF IT. A record
      // nobody can see answers no question at all.
      //
      // ⚠ IT IS ITS OWN REQUEST, not part of `queue` or `register`. Those two
      // draw the screen; this does not — a roster is readable and workable while
      // the mail line is still filling in — and it is the largest single piece of
      // work either screen could do: a prefix listing plus a read per message for
      // every address on the roster. Folded into the load, the table itself would
      // wait for it, on a function with ten seconds. That is the opposite trade
      // from `dashboard` and `registerPanel`, and for the opposite reason: those
      // consolidate calls the screen cannot draw without.
      //
      // ⚠ THE ADDRESSES COME FROM THE ACTIVITY, NEVER FROM THE REQUEST. A list of
      // addresses in the body would make this a reader for any address's mail on
      // the site, typed by hand. Here the server need not trust anything: the
      // screen's scope is one roster, so the roster is what it derives. It reads
      // the REGISTRATIONS for both kinds of activity, because an evening booking
      // always has a registration behind it — openRegistration() is what creates
      // one — so that list is the superset either screen needs.
      //
      // `access` gates it, the same axis that already prints every one of these
      // addresses on the row above.
      case 'mail': {
        const activity = await published(body.slug);
        if (!activity) return json(404, { error: 'No such activity.' });
        const regs = await store.forActivity(activity.activityId);
        const ids = [];
        for (const reg of regs) if (reg.accountId && ids.indexOf(reg.accountId) === -1) ids.push(reg.accountId);
        // ⚠ BOUNDED, AND THE BOUND IS REPORTED. An unbounded read here is an
        // admin watching a line never arrive; a silent truncation is worse,
        // because the rows left out would read as families we never wrote to —
        // which is the one wrong answer this screen exists to prevent. So the cap
        // is named in the response and the screen says which addresses it did not
        // reach.
        const capped = ids.length > MAX_MAIL_ADDRESSES;
        const use = capped ? ids.slice(0, MAX_MAIL_ADDRESSES) : ids;
        const found = await accounts.getAccounts(use);
        const emails = use.map((id) => (found[id] || {}).email).filter(Boolean);
        const byEmail = await emailLog.listForRecipients(emails);
        // One row per message, flattened to what a screen shows. The status and
        // the template label come from the module that owns both, so the roster
        // cannot invent a word for a state or print a raw template name — which
        // is what it did for 'registration-terms-changed' until that template was
        // given a line in the table.
        const out = {};
        Object.keys(byEmail).forEach((addr) => {
          const bag = byEmail[addr];
          out[addr] = {
            read: bag.read,
            total: bag.total,
            messages: bag.entries.map((e) => ({
              template: e.template,
              label: emailLog.templateLabel(e.template),
              subject: e.subject || null,
              lang: e.lang || null,
              status: e.status,
              final: emailLog.FINAL.indexOf(e.status) !== -1,
              sentAt: e.sentAt,
              statusUpdatedAt: e.statusUpdatedAt,
              sentBy: e.sentBy,
              manual: !!e.manual,
              error: e.error || null,
              // Whether this message was about the activity whose roster is
              // open. By ID: the slug beside it is the spelling at the time and
              // is a label only, exactly as the frozen slug on a registration is.
              thisActivity: !!(e.relatedActivityId && e.relatedActivityId === activity.activityId),
              relatedSlug: e.relatedSlug || null
            }))
          };
        });
        return json(200, {
          ok: true,
          activity: { slug: activity.slug, activityId: activity.activityId },
          mail: out,
          perRecipient: emailLog.MAIL_PER_RECIPIENT,
          addressesRead: use.length,
          addressesTotal: ids.length,
          capped: capped
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

      // ⚠ ONE EVENING, CANCELLED ON A FAMILY'S BEHALF — the other half of a
      // capability the family has had since Phase 7 and the admin had not.
      //
      // A family can cancel their own Tuesday from their own page. An admin
      // could cancel the whole REGISTRATION, which on a drop-in releases every
      // evening ahead of it, and could do nothing at all about one of them. So
      // a family who rang and asked for Tuesday to come off was answered either
      // by being told to go and press it themselves, or by an admin ending the
      // registration and re-creating it. Same shape as markAttendance before the
      // register screen existed, and recordSessionPayment before the money panel
      // did: the mechanism written, tested, and reachable from one side only.
      //
      // It goes through cancelOneSession(), which is the family's own path — so
      // the deadline, the ledger-before-the-record ordering, the payment stamp
      // and this evening's queue being told are all still written once.
      //
      // ⚠ ON `booked` AND NOTHING ELSE, and each refusal is its own sentence.
      // An `attended` evening happened; a `cancelled` one run through again
      // would credit twice into a ledger that cannot be edited; and a `waiting`
      // row holds no seat and owes nothing, so there is nothing to give back —
      // which is why the evening's waiting table has no controls on it.
      case 'cancelSession': {
        if (!canCancel(session)) {
          return json(403, { error: 'Your role may approve but not cancel' });
        }
        const att = await attendance.getAttendance(
          body.participantId, body.activityId, body.sessionDate);
        if (!att) return json(404, { error: 'No such booking.' });
        if (att.status === 'waiting') {
          return json(409, { error: 'This family is waiting for this evening rather than ' +
                                    'holding a seat on it, so there is nothing to cancel.' });
        }
        if (att.status !== 'booked') {
          return json(409, { error: 'This booking is ' + att.status + '.' });
        }

        // ⚠ THE FIGURE ON THE SCREEN MUST STILL BE THE FIGURE THAT IS WRITTEN,
        // and it is REQUIRED rather than checked when offered.
        //
        // The term cancellation learned this with days between its boundaries:
        // a panel opened at 23:59 and sent at 00:01 straddles one, and the
        // family is told a number nobody credited them. Here the deadline is
        // HOURS before a start time, so the straddle is not an edge case — an
        // admin with the register open through the afternoon will cross one.
        //
        // Optional-in-syntax is the trap this codebase already met with the
        // clock argument to creditFor(): five call sites omitted it and every
        // screen lied. A caller that cannot say what it is about to credit has
        // no business cancelling, and the figure is on the row it pressed.
        const want = credit.creditForSession(att, Date.now()).credit;
        if (body.expectCreditCents === undefined || body.expectCreditCents === null) {
          return json(400, { error: 'Send the credit this was shown as earning, so it can be ' +
                                    'checked against what will actually be written.' });
        }
        if (Number(body.expectCreditCents) !== want) {
          return json(409, {
            error: 'What cancelling this evening credits has changed since the register was ' +
                   'loaded. Re-open it and check the figure.',
            reason: 'credit-moved', creditCents: want
          });
        }

        const done = await cancelOneSession(att, {
          by: session.email, source: 'admin',
          note: body.note ? String(body.note).slice(0, 500) : null,
          historyNote: 'cancelled by an admin'
        });

        // After the record, never before — the money rule wins over the email
        // rule — and with the figure the ENTRY recorded rather than the one
        // predicted above. The REGISTRATION is what the message is built from:
        // an attendance row knows the date and the participant id and nothing
        // about what to call either of them.
        let emailed = null;
        const account = await accounts.getAccount(att.accountId);
        const reg = await store.getRegistration(att.participantId, att.activityId);
        if (account && reg) {
          emailed = await mail.sendSessionCancelled(reg, account, att.sessionDate,
            (done.entry && done.entry.amountCents) || 0);
        }
        await recordAudit(session, 'registrations.cancelSession',
          body.participantId + '__' + body.activityId + '__' + body.sessionDate, 'ok',
          { detail: (done.entry ? 'credited ' + done.entry.amountCents + 'c' : 'no credit') +
                    (body.note ? ' \u00b7 ' + body.note : '') });
        return json(200, { ok: true, session: done.session, credit: done.credit,
                           entry: done.entry, emailed: emailed });
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
      // payment on the record — one action, because doing either alone leaves
      // the two disagreeing about the same euros.
      //
      // ⚠ A TERM OR ONE EVENING, decided by `sessionDate`, exactly as the
      // family's own `useCredit` decides it. _spend-credit.js has handled
      // `kind: 'session'` since the family could spend their own credit at all —
      // it writes the ledger line with `basis.sessionDate` so a family read it
      // back six weeks later knows WHICH evening — and the admin half simply
      // never asked for it. A family who rings and asks somebody to do it for
      // them was answered by a screen that could settle their term and not
      // their Tuesday.
      //
      // ONE SPENDER, two callers, and that is what stops the two disagreeing
      // about the same euros: the cap at what is owed, the cap at what is held,
      // the ledger-before-the-record ordering and the part-payment rule are all
      // written once. What the two callers legitimately differ on is the AMOUNT.
      // A family's is decided server-side — `spendable(record, balance)`, the
      // smaller of the two — because a client that names its own figure is a
      // client that can name somebody else's balance. An admin names one,
      // because part of a debt is a real thing to settle at a desk, and
      // spendCredit() refuses anything past either cap.
      case 'applyCredit': {
        if (!canCancel(session)) return json(403, { error: 'Your role may not move credit' });
        const onDate = body.sessionDate ? String(body.sessionDate) : null;
        const record = onDate
          ? await attendance.getAttendance(body.participantId, body.activityId, onDate)
          : await store.getRegistration(body.participantId, body.activityId);
        if (!record) {
          return json(404, { error: onDate ? 'No such booking.' : 'No such registration.' });
        }
        let done;
        try {
          done = await spend.spendCredit({
            record: record, kind: onDate ? 'session' : 'registration',
            cents: body.amountCents, by: session.email, note: body.note || null
          });
        } catch (err) {
          const code = err.reason === 'amount' ? 400 : 409;
          return json(code, { error: err.message, reason: err.reason,
                              balanceCents: err.balanceCents, owedCents: err.owedCents });
        }
        await recordAudit(session, 'registrations.applyCredit',
          body.participantId + '__' + body.activityId + (onDate ? '__' + onDate : ''),
          'ok', { detail: done.spentCents + 'c' });
        // Under the key the caller's own screen reads. `session` and
        // `registration` are the two names every other action on this handler
        // already uses for the two records, so the client needs no third branch.
        return json(200, Object.assign({ ok: true, entry: done.entry,
                                         balanceCents: done.balanceCents },
          onDate ? { session: done.record } : { registration: done.record }));
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
