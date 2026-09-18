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
const attendance = require('./_session-attendance');
const S = require('./_stripe');
const { SITE } = require('./_email-shell');
const facts = require('./_activity-facts');
const { LABELS } = require('./_activity-template');

// LABELS is authored for an HTML TEMPLATE, so "When &amp; where" is correct
// there and wrong here — JSON is not HTML, and the client sets textContent, so
// the entity would reach a family's screen literally. Decoded at the one point
// the two worlds meet rather than in LABELS itself, which still has a template
// to feed.
const plainLabel = (s) => String(s || '')
  .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n))
  .replace(/&amp;/g, '&');
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
    // A drop-in has no term-level "places left" to report: the number that means
    // anything is per evening, and the sessions action answers it per date.
    capacity: activity.type === 'dropin' ? null : report.capacity,
    taken: activity.type === 'dropin' ? null : report.taken,
    left: activity.type === 'dropin' ? null : report.left,
    perSession: activity.type === 'dropin',
    full: activity.type !== 'dropin' && !R.hasRoom(report, null) && !report.named,
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

// ONE ROW SHAPE, built once. The list and the single-registration view are two
// views of the same record, and two builders would drift — the one the family
// reads on a dashboard would stop agreeing with the one they read on the page
// they opened from it.
function regRow(reg, participant) {
  return {
    participantId: reg.participantId,
    participantName: participant
      ? [participant.firstName, participant.lastName].filter(Boolean).join(' ')
      : reg.frozen.participantName,
    activityId: reg.activityId,
    slug: reg.frozen.activitySlugAtSubmission,
    title: reg.frozen.activityTitle,
    type: reg.frozen.type || 'course',
    groupId: reg.groupId,
    groupName: reg.frozen.groupName,
    status: reg.status,
    // The DERIVED answer, not the stored status. A pending registration whose
    // deadline passed an hour ago is already not holding a place, whether or not
    // the nightly sweep has run.
    holdsASpot: R.holdsASpot(reg),
    submittedAt: reg.submittedAt,
    expiresAt: reg.expiresAt,
    // What this registration is billed, and whether the yearly fee was part of
    // it. A family looking at a second term should be able to see that it is 300
    // rather than 350, and why.
    owedCents: reg.payment.owedCents,
    paidCents: reg.payment.paidCents,
    creditedCents: reg.payment.creditedCents,
    feeCharged: reg.frozen.price.feeCharged,
    feeYear: reg.frozen.feeYear,
    registrationFee: reg.frozen.price.registrationFee,
    fullPrice: reg.frozen.price.fullPrice,
    perSessionPrice: reg.frozen.price.perSessionPrice,
    // What cancelling would do, computed from the terms frozen onto this
    // registration — so the answer shown is the answer that will be applied, and
    // both come from the same function.
    cancellation: credit.creditFor(reg)
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

      // --- pay-per-session ---------------------------------------------------
      //
      // A drop-in registration means "this child may come". Which evenings they
      // are coming to is a separate, smaller decision, taken one at a time.

      // The evenings on offer, how full each is, and which this participant has
      // already booked. A COUNT per date, never a list of who.
      case 'sessions': {
        const participant = await mustGuard(body.participantId);
        if (!participant) return json(404, { error: NOT_YOURS });
        const activity = await published(body.slug);
        if (!activity) return json(404, { error: 'No such activity.' });
        if (activity.type !== 'dropin') {
          return json(400, { error: 'This activity is booked for the whole term, not by the session.' });
        }
        const reg = await store.getRegistration(participant.participantId, activity.activityId);
        const all = await attendance.forActivity(activity.activityId);
        const mine = {};
        all.filter((a) => a.participantId === participant.participantId)
           .forEach((a) => { mine[a.sessionDate] = a; });

        return json(200, {
          ok: true,
          // Booking needs an approved registration behind it. The registration
          // is the "may come" decision and an admin makes it once; this endpoint
          // does not quietly become a second way in.
          mayBook: !!reg && reg.status === 'approved',
          registrationStatus: reg ? reg.status : null,
          sessions: attendance.bookableDates(activity).map((date) => {
            const cap = R.capacityForDate(activity, all, date);
            const own = mine[date] || null;
            return {
              date: date,
              left: cap.left, capacity: cap.capacity, full: cap.left != null && cap.left <= 0,
              status: own ? own.status : null,
              owedCents: own ? own.payment.owedCents : null,
              paidCents: own ? own.payment.paidCents : null,
              // What cancelling would do, from the SAME function the server will
              // apply — so what is shown is what happens.
              cancellation: own ? credit.creditForSession(own, Date.now()) : null
            };
          })
        });
      }

      case 'bookSession': {
        const participant = await mustGuard(body.participantId);
        if (!participant) return json(404, { error: NOT_YOURS });
        const activity = await published(body.slug);
        if (!activity) return json(404, { error: 'No such activity.' });
        const bad = attendance.validate(activity, body.sessionDate);
        if (bad) return json(400, { error: bad });

        const reg = await store.getRegistration(participant.participantId, activity.activityId);
        if (!reg || reg.status !== 'approved') {
          return json(409, { error: 'You need an approved registration for this activity first.' });
        }
        const existing = await attendance.getAttendance(
          participant.participantId, activity.activityId, body.sessionDate);
        if (existing && R.holdsASeat(existing)) {
          return json(409, { error: 'That evening is already booked.', status: existing.status });
        }

        // The room on THAT evening, not the term. Counted, never decremented —
        // so a cancellation frees the place the moment it is written.
        const all = await attendance.forActivity(activity.activityId, body.sessionDate);
        const cap = R.capacityForDate(activity, all, body.sessionDate);
        if (cap.left != null && cap.left <= 0) {
          return json(409, { error: 'That evening is full.', full: true });
        }

        const att = attendance.newAttendance({
          activity: activity, participantId: participant.participantId,
          accountId: me.accountId, groupId: reg.groupId, sessionDate: body.sessionDate
        });
        // A re-booking after a cancellation lands on the same key, so the earlier
        // history is carried forward rather than overwritten — the same rule a
        // re-requested registration follows.
        if (existing) att.history = (existing.history || []).concat(att.history);
        await attendance.saveAttendance(att);
        return json(200, { ok: true, session: att });
      }

      case 'cancelSession': {
        const participant = await mustGuard(body.participantId);
        if (!participant) return json(404, { error: NOT_YOURS });
        const att = await attendance.getAttendance(
          body.participantId, body.activityId, body.sessionDate);
        if (!att) return json(404, { error: 'No such booking.' });
        if (att.status === 'cancelled') return json(200, { ok: true, session: att });
        if (att.status !== 'booked') {
          return json(409, { error: 'That evening has already happened.' });
        }

        // ALL OR NOTHING. In time, the payment becomes credit; after the
        // deadline, nothing — and the booking is released either way, because a
        // family can always say they are not coming. The same split between
        // entitlement and the ability to act that the course cutoff makes.
        const owed = credit.creditForSession(att, Date.now());
        let entry = null;
        if (owed.credit > 0) {
          // Ledger first, for the reason it is always first here: a credit not
          // written is money lost with nobody able to tell.
          entry = await ledger.append({
            accountId: att.accountId, type: 'credit', amountCents: owed.credit,
            reason: 'registration-cancelled-by-guardian',
            relatedRegistrationKey: R.key(att.participantId, att.activityId),
            basis: { perSession: true, sessionDate: att.sessionDate,
                     startsAt: att.frozen.startsAt, cancelHours: att.frozen.cancelHours,
                     paidCents: att.payment.paidCents, reason: owed.reason },
            createdBy: me.accountId
          });
        }
        const next = attendance.transition(att, { status: 'cancelled', by: me.accountId });
        next.payment = Object.assign({}, next.payment, {
          creditedCents: (next.payment.creditedCents || 0) + owed.credit,
          creditedToAccountId: owed.credit > 0 ? att.accountId : next.payment.creditedToAccountId,
          status: owed.credit > 0 ? 'credited' : next.payment.status
        });
        await attendance.saveAttendance(next);
        return json(200, { ok: true, session: next, credit: owed, entry: entry,
                           balance: await ledger.balanceFor(me.accountId) });
      }

      // --- this account's registrations ------------------------------------
      case 'list': {
        const ids = await guardians.participantIdsFor(me.accountId);
        const out = [];
        for (const id of ids) {
          const p = await participants.getParticipant(id);
          for (const reg of await store.forParticipant(id)) out.push(regRow(reg, p));
        }
        return json(200, { ok: true, registrations: out });
      }

      // --- one registration, in full ----------------------------------------
      //
      // What the family area's activity page shows: the registration, the
      // activity's PUBLIC facts, and what it costs. One call rather than three,
      // because the three would have to agree about which activity they were
      // describing and one of them would be reading a stale slug.
      //
      // ⚠ RESOLVED BY activityId, NEVER BY THE FROZEN SLUG.
      // `frozen.activitySlugAtSubmission` is audit only — if it disagrees with
      // the activity's slug today, that is a rename working, and following it
      // would open the wrong record or none at all.
      case 'registration': {
        const participant = await mustGuard(body.participantId);
        if (!participant) return json(404, { error: NOT_YOURS });
        const reg = await store.getRegistration(body.participantId, body.activityId);
        if (!reg) return json(404, { error: 'No such registration.' });

        const index = (await readJson('activities/activities-index.json')) || [];
        const entry = index.filter((a) => a.activityId === reg.activityId)[0] || null;
        const activity = entry ? await published(entry.slug) : null;

        // An activity can be unpublished after somebody registered for it. The
        // registration is still real and still shows its frozen terms; there is
        // simply nothing current to say about when and where.
        const report = activity ? R.capacityReport(activity, await store.forActivity(reg.activityId)) : null;
        const L = LABELS[lang] || LABELS.he;
        return json(200, {
          ok: true,
          registration: regRow(reg, participant),
          activity: activity ? Object.assign(activityView(activity, report, lang), {
            // THE SAME ROWS THE PUBLIC PAGE SHOWS, from the one place a fact
            // becomes text. isPubliclyVisible() keeps its exact current meaning
            // and its only caller: the members-only address is filtered out here
            // as it is everywhere, and the authenticated view that would serve
            // it is still not built.
            facts: facts.sidebarGroups(activity, lang).map((g) => ({
              key: g.key,
              heading: plainLabel(L['g' + g.key.charAt(0).toUpperCase() + g.key.slice(1)]),
              facts: g.facts.map((f) => ({ key: f.key, label: plainLabel(L[f.key]), value: f.value }))
            })),
            // Rows, never a total. The registration fee is charged once a year
            // and the course fee once a semester, so their sum is a figure
            // nobody is ever billed.
            priceRows: facts.factPriceRows(activity, lang),
            sessionRows: facts.sessionRows((activity.facts || {}).duration, lang)
          }) : null
        });
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

        // ⚠ A DROP-IN REGISTRATION IS NOT CAPPED BY THE SIZE OF THE ROOM.
        //
        // For a course the two are the same question: a place is held for the
        // whole term, so registrations and seats are one count. For a drop-in
        // they are not. The room holds twenty on Tuesday; forty families can be
        // registered and eight turn up. Counting registrations against the room
        // refused the twenty-first family from ever registering, on an activity
        // that was never more than half full on the night — and the refusal read
        // as "this activity is full", which was untrue of every actual evening.
        //
        // The capacity that matters for a drop-in is per date, and it is checked
        // where it belongs: in bookSession.
        const regs = await store.forActivity(activity.activityId);
        const report = R.capacityReport(activity, regs);
        if (activity.type !== 'dropin' && !R.hasRoom(report, groupId)) {
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
          entry: done.entry,
          // Null for a course. On a drop-in it is the evenings that were
          // released, each with what it earned — so a family sees the per-session
          // credits rather than one figure that came from nowhere.
          sessions: done.sessions,
          balance: await ledger.balanceFor(me.accountId)
        });
      }

      // What this account is owed, and every line behind it. Summed from the
      // entries rather than read off a cached total: two representations of one
      // number on a store with no transaction is how a balance quietly stops
      // matching its own history.
      // --- paying for a place -----------------------------------------------
      //
      // TWO GATES, AND BOTH ARE ABOUT NOT TAKING MONEY WE SHOULD NOT HAVE.
      //
      // 1. THE ACCOUNT MUST BE VERIFIED. This is the first place in the whole
      //    system that enforces `emailVerifiedAt` — until now it has been
      //    stored, shown as a banner, and acted on by nothing. Payment is the
      //    right place to start: a receipt, and every later message about money,
      //    goes to an address nobody has proved belongs to this person. It is
      //    not a dead end — the dashboard already carries a resend button — so
      //    the refusal names the reason and the client can act on it.
      //
      // 2. THE REGISTRATION MUST BE APPROVED. A `pending` registration is a
      //    request that may still be refused, and taking money for a place that
      //    might not exist means an immediate refund and a family wondering what
      //    happened. How it reached `approved` is irrelevant — auto-approval and
      //    an admin pressing the button produce the same status, which is the
      //    point of the status being the single source of truth.
      //
      // The amount is `owedCents - paidCents`, computed HERE and never accepted
      // from the client: an amount in a request body is an amount somebody can
      // edit. Stripe's own figure is then the authority on the way back in —
      // see stripe-webhook.js.
      case 'pay': {
        const participant = await mustGuard(body.participantId);
        if (!participant) return json(404, { error: NOT_YOURS });

        if (!me.emailVerifiedAt) {
          return json(403, {
            error: 'Please confirm your email address before paying.',
            reason: 'email-unverified'
          });
        }

        const reg = await store.getRegistration(body.participantId, body.activityId);
        if (!reg) return json(404, { error: 'No such registration.' });
        if (reg.status !== 'approved') {
          return json(409, {
            error: 'This registration is ' + reg.status + '. Only an approved place can be paid for.',
            reason: 'not-approved', status: reg.status
          });
        }

        const owed = (reg.payment && reg.payment.owedCents) || 0;
        const paid = (reg.payment && reg.payment.paidCents) || 0;
        const due = owed - paid;
        if (!(due > 0)) {
          return json(409, { error: 'There is nothing outstanding on this registration.', reason: 'nothing-due' });
        }

        // The FROZEN title, not the activity's current one: a rename must not
        // change what a family sees on the payment they are making.
        const title = (reg.frozen && facts.pick(reg.frozen.activityTitle, lang)) || 'Ogen';
        const base = lang === 'he' ? '' : '/' + lang;
        // `p` and `a` — the spelling the PAGE reads. Spelled out in full this
        // returned a family who had just paid to "that registration was not
        // found", which is the worst moment on the site to be told that.
        const back = SITE + base + '/account/activity'
          + '?p=' + encodeURIComponent(reg.participantId)
          + '&a=' + encodeURIComponent(reg.activityId) + '#pay';

        let session;
        try {
          session = await S.stripe().checkout.sessions.create({
            mode: 'payment',
            customer_email: me.email,
            // Stripe Checkout has no Hebrew; 'auto' falls back to English.
            locale: lang === 'en' ? 'en' : 'auto',
            line_items: [{
              quantity: 1,
              price_data: {
                currency: 'eur',
                unit_amount: due,
                product_data: {
                  name: title,
                  description: (reg.frozen && reg.frozen.participantName) || undefined
                }
              }
            }],
            success_url: back + '&paid=1',
            cancel_url: back,
            // Tagged on the SESSION and mirrored onto the PaymentIntent. The
            // account is shared with another organisation, so an untagged
            // object is indistinguishable from theirs — and a session-only tag
            // is invisible on the PaymentIntent a dispute arrives attached to.
            metadata: S.meta({
              ogen_kind: 'registration',
              participant_id: reg.participantId,
              activity_id: reg.activityId,
              registration: 'reg-' + reg.participantId + '__' + reg.activityId,
              activity_slug: reg.frozen && reg.frozen.activitySlugAtSubmission
            }),
            payment_intent_data: {
              statement_descriptor_suffix: S.STATEMENT_DESCRIPTOR_SUFFIX,
              metadata: S.meta({
                ogen_kind: 'registration',
                participant_id: reg.participantId,
                activity_id: reg.activityId
              })
            }
          });
        } catch (err) {
          console.error('account-registrations: Stripe session failed:', err && err.message);
          return json(502, { error: 'Could not start the payment. Please try again.' });
        }

        return json(200, { ok: true, url: session.url, amountCents: due });
      }

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
