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
const B = require('./_bundle');
const bundleStore = require('./_bundle-store');
const checkout = require('./_checkout');
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
    // Which shape of panel to draw, and it is the ONLY thing this view says
    // about the dates. A drop-in's register panel asks `sessions` for them,
    // because it needs each date's price and each date's room and whether THIS
    // participant already has it — none of which an activity-level view can
    // answer. A three-date preview lived here for a day and was a second,
    // poorer source for the same question.
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

// ONE PLACE A REGISTRATION IS CREATED, called by `submit` and by the drop-in's
// one-step `bookAndPay`. Two copies would be two places the fee waiver, the
// capacity rule and the carried-forward history could quietly drift apart.
//
// It returns the record rather than a response, because the two callers answer
// differently about the ONE case they genuinely disagree on: a registration
// that already holds a place is a refusal to `submit` and is simply the
// registration to book against for `bookAndPay`.
async function openRegistration({ activity, participant, accountId, groupId }) {
  const errors = R.submissionErrors(activity, participant, groupId);
  if (errors.length) return { status: 400, payload: { error: errors[0], errors: errors } };

  const existing = await store.getRegistration(participant.participantId, activity.activityId);
  if (existing && R.holdsASpot(existing)) return { reg: existing, already: true };

  // ⚠ A DROP-IN REGISTRATION IS NOT CAPPED BY THE SIZE OF THE ROOM.
  //
  // For a course the two are the same question: a place is held for the whole
  // term, so registrations and seats are one count. For a drop-in they are not.
  // The room holds twenty on Tuesday; forty families can be registered and eight
  // turn up. Counting registrations against the room refused the twenty-first
  // family from ever registering, on an activity that was never more than half
  // full on the night — and the refusal read as "this activity is full", which
  // was untrue of every actual evening.
  //
  // The capacity that matters for a drop-in is per date, and it is checked where
  // it belongs: in bookSession and in bookAndPay.
  const regs = await store.forActivity(activity.activityId);
  const report = R.capacityReport(activity, regs);
  if (activity.type !== 'dropin' && !R.hasRoom(report, groupId)) {
    // No waitlist yet. The design flagged one and did not build it: a waitlist
    // has to choose who gets a freed place, tell them, and give them a deadline
    // before it moves on again, and none of that is decided. Today the place is
    // simply gone and the next submission takes it, first come.
    return { status: 409, payload: { error: 'This activity is full.', full: true, capacity: report.capacity } };
  }

  const reg = R.newRegistration({
    activity: activity, participant: participant, accountId: accountId, groupId: groupId,
    // THIS PARTICIPANT'S OWN registrations, and nothing else. The fee is scoped
    // to one participant, one activity, one academic year, so the waiver is
    // answerable from a prefix scan of their own key space — no sibling lookup,
    // no account aggregate, no ledger.
    priorRegistrations: await store.forParticipant(participant.participantId)
  });

  // A record already existed for this pair — rejected, expired or cancelled —
  // and the key is one per participant per activity, so the new request lands in
  // the same blob. ITS HISTORY IS CARRIED FORWARD rather than overwritten: a
  // refusal is something that happened, and an admin looking at a second request
  // should be able to see the first.
  if (existing) reg.history = (existing.history || []).concat(reg.history);

  await store.saveRegistration(reg);
  return { reg: reg, created: true };
}

// ⚠ WHICH PAYMENTS NEED A CONFIRMED ADDRESS — ONE RULE, ONE PLACE.
//
// A COURSE DOES; A DROP-IN DOES NOT, and the split is the friction each one can
// carry rather than a difference in how much we trust the payer.
//
// A term is a considered decision: hundreds of euros, months of attendance, a
// place an admin has agreed to. Asking somebody to click a link in their inbox
// first costs them a minute, once, on a commitment they are already taking
// seriously — and it means the receipt, the reminders and every later message
// about that money reach an address somebody has proved is theirs.
//
// A drop-in is a walk-up: "we will come on Tuesday", chosen and paid for in one
// sitting, often by a family who signed up minutes earlier. The gate refused
// exactly that flow, every time, and it was the only flow it ever refused.
//
// It is a SINGLE function because the alternative is the condition written at
// three call sites, where the third gets it wrong or is added later without it.
// Returning a response or null keeps the branches reading as a list of refusals.
//
// ⚠ A MISSING TYPE READS AS `course`, WHICH INVERTS THIS FILE'S USUAL RULE.
// Every blank in _credit.js resolves towards the family; this one resolves
// towards the gate. The reason is what a blank actually means here: a record
// written before `type` existed, which was a course, because drop-ins did not
// exist either. And the errors are not symmetric — guessing drop-in skips a gate
// somebody asked for, guessing course costs one verification email.
function verificationRefusal(me, type) {
  if (type === 'dropin') return null;
  if (me.emailVerifiedAt) return null;
  return json(403, {
    error: 'Please confirm your email address before paying.',
    reason: 'email-unverified'
  });
}

// ⚠ WHICH BUNDLE PAYS FOR EACH DATE, ALLOCATED ACROSS THE WHOLE SELECTION.
//
// spendableFor() answers for one date, and asking it per date in a loop hands
// the SAME entry out twice: it re-reads the store, which has not been written
// yet, so a family booking four evenings against a bundle with one entry left
// would get four free ones.
//
// So the records are loaded once and marked in memory as they are allocated —
// covers() then sees each spend when it decides the next date. Nothing is
// written here; the caller writes the attendance first and the bundles after,
// because a crash between the two must cost US a free session rather than cost
// the family an entry.
function allocateEntries(held, dates) {
  const spend = {};
  dates.forEach((date) => {
    const b = held.filter((x) => B.covers(x, date))[0];
    if (!b) return;
    b.usedDates = (b.usedDates || []).concat([date]).sort();
    spend[date] = b;
  });
  return spend;
}

// The bundles an allocation actually touched, stamped and saved. Called after
// the attendance records are safely written.
async function commitEntries(spend, accountId, note) {
  const seen = [];
  Object.keys(spend).forEach((date) => {
    const b = spend[date];
    if (seen.indexOf(b) === -1) seen.push(b);
    b.history = (b.history || []).concat([{
      iso: new Date().toISOString(), action: 'entry-spent', by: accountId, note: note || date
    }]);
  });
  for (const b of seen) {
    b.status = B.statusAfter(b, 0);
    await bundleStore.saveBundle(b);
  }
  return seen;
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

        const now = Date.now();
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
            const frozen = own ? own.frozen : credit.freezeSession(activity, date, null, { bookedAt: now });
            return {
              date: date,
              // ⚠ THE PRICE AN EVENING WOULD COST, from the SAME function that
              // freezes it at booking and with the same `bookedAt` — or a screen
              // offering the standard price would take the late one, on an
              // activity where those differ. A booked evening quotes what it
              // actually froze, never a recomputed figure: an admin raising the
              // price must not change what was already agreed.
              priceCents: own
                ? (own.payment.owedCents || 0)
                : Math.max(0, Math.round(Number(frozen.perSessionPrice || 0) * 100)),
              priceBasis: frozen.priceBasis || null,
              startsAt: frozen.startsAt || null,
              // Booking a date that has gone is not a thing to offer. It is a
              // flag rather than a filter because the registration page lists
              // the whole term, past evenings included, and only the register
              // panel needs them gone.
              past: credit.past(date, now),
              left: cap.left, capacity: cap.capacity, full: cap.left != null && cap.left <= 0,
              status: own ? own.status : null,
              owedCents: own ? own.payment.owedCents : null,
              paidCents: own ? own.payment.paidCents : null,
              // What cancelling would do, from the SAME function the server will
              // apply — so what is shown is what happens.
              cancellation: own ? credit.creditForSession(own, now) : null
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

        // ⚠ AN ENTRY IS SPENT BEFORE A PRICE IS CHARGED. A bundle covering this
        // date freezes the evening at zero and the family owes nothing for it —
        // that is what they bought. The lookup is by date, so a bundle that does
        // not cover this one is simply not found and the standard price applies.
        const held = await bundleStore.forParticipant(participant.participantId, activity.activityId);
        const spend = allocateEntries(held, [body.sessionDate]);
        const from = spend[body.sessionDate] || null;

        const att = attendance.newAttendance({
          activity: activity, participantId: participant.participantId,
          accountId: me.accountId, groupId: reg.groupId, sessionDate: body.sessionDate,
          bundle: !!from, bundleId: from ? from.bundleId : null
        });
        // A re-booking after a cancellation lands on the same key, so the earlier
        // history is carried forward rather than overwritten — the same rule a
        // re-requested registration follows.
        if (existing) att.history = (existing.history || []).concat(att.history);
        // THE BOOKING FIRST, THE BUNDLE SECOND. A crash between them costs us a
        // free session; the other order costs the family an entry they paid for.
        await attendance.saveAttendance(att);
        await commitEntries(spend, me.accountId);
        return json(200, { ok: true, session: att, fromBundle: !!from });
      }

      // ⚠ REGISTERING FOR A DROP-IN IS ONE STEP, NOT THREE.
      //
      // A drop-in was being run through the course's shape: register for the
      // activity, wait, then come back and book evenings, then find a way to pay
      // for each. That is the machinery a term needs — a place held for months,
      // an admin deciding who gets it, a price agreed up front — and a drop-in
      // has none of it. You are choosing to come on Tuesday. The registration
      // still exists underneath, because it is what carries the guardian link,
      // the frozen terms and the admin's ability to say no, but a family should
      // never have to know that: they pick who and which evenings, and pay.
      //
      // So this action does all of it, and the ORDER is the careful part.
      //
      //   1. everything that can refuse, refuses BEFORE anything is written —
      //      the dates are validated, and every chosen evening is checked for
      //      room together. A family choosing four dates and being given three
      //      plus a charge is worse than being asked to choose again.
      //   2. THE BOOKINGS ARE WRITTEN, THEN THE CHARGE IS MADE. If Checkout
      //      fails we hold evenings that are booked and unpaid, which the family
      //      can see and settle from their own page. The other order takes money
      //      for a place that might not exist.
      //
      // Over-capacity is still REPORTED rather than prevented: two families can
      // pass the check in the same few hundred milliseconds, and there is no
      // atomic increment to stop them. That is the rule everywhere here.
      case 'bookAndPay': {
        const participant = await mustGuard(body.participantId);
        if (!participant) return json(404, { error: NOT_YOURS });
        const activity = await published(body.slug);
        if (!activity) return json(404, { error: 'No such activity.' });
        if (activity.type !== 'dropin') {
          return json(400, { error: 'This activity is booked for the whole term, not by the session.' });
        }
        // No verificationRefusal() call, and not because it was forgotten: the
        // line above has already refused everything that is not a drop-in, so
        // the check would be unreachable. This is the flow the gate used to
        // block — sign up, register, pay, in one sitting.

        const wanted = Array.isArray(body.sessionDates) ? body.sessionDates.map(String) : [];
        const dates = wanted.filter((d, i) => wanted.indexOf(d) === i).sort();
        if (!dates.length) return json(400, { error: 'Choose at least one date.', reason: 'no-dates' });
        if (dates.length > checkout.MAX_SESSION_LINES) {
          return json(400, {
            error: 'Up to ' + checkout.MAX_SESSION_LINES + ' dates can be paid for at once.',
            reason: 'too-many'
          });
        }
        for (const d of dates) {
          const bad = attendance.validate(activity, d);
          if (bad) return json(400, { error: bad });
        }

        const opened = await openRegistration({
          activity: activity, participant: participant,
          accountId: me.accountId, groupId: body.groupId || null
        });
        if (opened.status) return json(opened.status, opened.payload);
        const reg = opened.reg;

        // ⚠ AN ACTIVITY THAT DOES NOT AUTO-APPROVE STOPS HERE, and stops before
        // any money moves. `pending` means an admin wants to look at this — an
        // age outside the stated range, or auto-approve switched off — and
        // booking evenings against a place that may be refused would mean an
        // immediate refund and a family wondering what happened. Nothing is
        // booked, nothing is charged, and the message that explains the wait is
        // the one that already exists for exactly this case.
        if (reg.status !== 'approved') {
          if (opened.created) await mail.sendReceived(reg, me);
          return json(200, {
            ok: true, awaitingApproval: true, status: reg.status,
            registration: regRow(reg, participant)
          });
        }

        const now = Date.now();
        const all = await attendance.forActivity(activity.activityId);
        const mine = {};
        all.filter((a) => a.participantId === participant.participantId)
           .forEach((a) => { mine[a.sessionDate] = a; });

        const refused = [];
        dates.forEach((d) => {
          if (credit.past(d, now)) return refused.push({ date: d, reason: 'past' });
          if (mine[d] && R.holdsASeat(mine[d])) return refused.push({ date: d, reason: 'already-booked' });
          const cap = R.capacityForDate(activity, all, d);
          if (cap.left != null && cap.left <= 0) refused.push({ date: d, reason: 'full' });
        });
        if (refused.length) {
          return json(409, {
            error: 'Some of those evenings are no longer available.',
            reason: 'unavailable', refused: refused
          });
        }

        // Entries are allocated across the WHOLE selection in one pass — see
        // allocateEntries. A family with three entries left choosing five dates
        // pays for two of them, and the other three are already bought.
        const held = await bundleStore.forParticipant(participant.participantId, activity.activityId);
        const spend = allocateEntries(held, dates);

        const bookedAt = new Date(now).toISOString();
        const booked = [];
        for (const d of dates) {
          const from = spend[d] || null;
          const att = attendance.newAttendance({
            activity: activity, participantId: participant.participantId,
            accountId: me.accountId, groupId: reg.groupId, sessionDate: d,
            bookedAt: bookedAt, bundle: !!from, bundleId: from ? from.bundleId : null
          });
          // A re-booking after a cancellation lands on the same key, so the
          // earlier history is carried forward rather than overwritten — the
          // same rule a re-requested registration follows.
          if (mine[d]) att.history = (mine[d].history || []).concat(att.history);
          await attendance.saveAttendance(att);
          booked.push(att);
        }

        // Every booking is safely written, so the entries can be marked spent.
        await commitEntries(spend, me.accountId);

        const rows = booked.map((a) => ({
          date: a.sessionDate, owedCents: a.payment.owedCents, priceBasis: a.frozen.priceBasis
        }));
        const owing = booked.filter((a) => (a.payment.owedCents || 0) - (a.payment.paidCents || 0) > 0);
        // Free evenings exist: a bundle entry freezes the price at zero. There is
        // nothing to pay for and nothing to open, and saying so beats sending a
        // family to a payment page for €0.00.
        if (!owing.length) {
          return json(200, { ok: true, booked: rows, url: null, nothingDue: true,
                             activityId: activity.activityId });
        }

        let session;
        try {
          session = await checkout.createSessionsCheckout(owing, activity.title, lang, me.email);
        } catch (err) {
          console.error('account-registrations: Stripe session failed:', err && err.message);
          // THE EVENINGS ARE BOOKED. Reporting this as a failure would be a lie
          // in the direction that costs a family their place — they would book
          // again and hold two. The refusal is about the payment only, and their
          // own page carries the button to try it again.
          return json(200, { ok: true, booked: rows, url: null, paymentFailed: true,
                             activityId: activity.activityId });
        }
        return json(200, { ok: true, booked: rows, url: session.url,
                           activityId: activity.activityId });
      }

      // ⚠ PAYING FOR ONE EVENING, which a family simply could not do.
      //
      // `pay` reads a REGISTRATION, and a drop-in registration owes nothing:
      // owedCentsFor() charges the yearly fee and, for a course, the term price.
      // All the money on a pay-per-session activity sits on the attendance
      // record for each evening — so booking one created a debt with no way to
      // settle it, and the family area offered no button because there was no
      // action behind it.
      //
      // The same gate as `pay`, for the same reason: an approved registration
      // behind the booking. Approval is the "may come" decision and is made
      // once; this must not quietly become a second way in.
      case 'paySession': {
        const participant = await mustGuard(body.participantId);
        if (!participant) return json(404, { error: NOT_YOURS });
        const activity = await published(body.slug);
        if (!activity) return json(404, { error: 'No such activity.' });
        const reg = await store.getRegistration(participant.participantId, activity.activityId);
        if (!reg || reg.status !== 'approved') {
          return json(409, { error: 'You need an approved registration for this activity first.',
                             reason: 'not-approved' });
        }
        const att = await attendance.getAttendance(
          participant.participantId, activity.activityId, body.sessionDate);
        if (!att) return json(404, { error: 'That evening is not booked.' });

        // Today this always passes: an attendance record exists only for a
        // drop-in, because both booking paths refuse anything else. The call is
        // here anyway rather than a comment saying so — if a course ever becomes
        // payable by the session, the rule follows it instead of being a thing
        // somebody has to remember.
        const refusal = verificationRefusal(me, activity.type);
        if (refusal) return refusal;

        let session;
        try {
          session = await checkout.createSessionCheckout(att, activity.title, lang, me.email);
        } catch (err) {
          if (err && err.reason === 'nothing-due') {
            return json(409, { error: 'There is nothing outstanding on that evening.',
                               reason: 'nothing-due' });
          }
          console.error('account-registrations: Stripe session failed:', err && err.message);
          return json(502, { error: 'Could not start the payment. Please try again.' });
        }
        return json(200, { ok: true, url: session.url });
      }

      // --- bundles -----------------------------------------------------------
      //
      // What is on offer, and what this participant already holds. The offer
      // list is the STRICT one: a bundle the calendar ahead cannot cover in full
      // is absent rather than shown smaller or shown with a warning. Auto-sizing
      // it at the point of sale would mean a family choosing "10 sessions" and
      // being charged for something with a different name.
      case 'bundles': {
        const participant = await mustGuard(body.participantId);
        if (!participant) return json(404, { error: NOT_YOURS });
        const activity = await published(body.slug);
        if (!activity) return json(404, { error: 'No such activity.' });
        if (activity.type !== 'dropin') {
          return json(400, { error: 'Bundles are for pay-per-session activities.' });
        }
        const now = Date.now();
        const held = await bundleStore.forParticipant(participant.participantId, activity.activityId);
        const mine = {};
        (await attendance.forParticipant(participant.participantId, activity.activityId))
          .forEach((a) => { mine[a.sessionDate] = a; });

        // WHERE EACH MOVEABLE ENTRY MAY GO, computed from the same function the
        // server will apply when the move is asked for — so a date offered is a
        // date that will be accepted. A client guessing the list would offer a
        // full evening, or one outside the window that was sold.
        const taken = Object.keys(mine).filter((d) => R.holdsASeat(mine[d]));
        const views = held.map((b) => {
          const view = B.bundleView(b, mine, now);
          view.rows.forEach((row) => {
            if (row.mayReschedule) {
              row.targets = B.rescheduleTargets(b, activity, row.date, now, taken);
            }
          });
          return view;
        });

        return json(200, {
          ok: true,
          offers: B.bundlesAvailable(activity, now).map((b) => ({
            bundleId: b.bundleId, entries: b.entries, pricePerEntry: b.pricePerEntry,
            validityDays: b.validityDays,
            totalCents: Math.round(Number(b.pricePerEntry) * 100) * b.entries,
            coveredDates: B.coverageFor(activity, b, now)
          })),
          held: views
        });
      }

      case 'buyBundle': {
        const participant = await mustGuard(body.participantId);
        if (!participant) return json(404, { error: NOT_YOURS });
        const activity = await published(body.slug);
        if (!activity) return json(404, { error: 'No such activity.' });
        if (activity.type !== 'dropin') {
          return json(400, { error: 'Bundles are for pay-per-session activities.' });
        }

        // ⚠ THE OFFER IS RE-DECIDED HERE, from the activity, at this instant.
        // The client sends an id and nothing else — never a price, never an
        // entry count — so a bundle the admin has since removed or that the
        // calendar can no longer cover is refused rather than sold.
        const now = Date.now();
        const offer = B.bundlesAvailable(activity, now)
          .filter((b) => b.bundleId === String(body.bundleId || ''))[0];
        if (!offer) {
          return json(409, { error: 'That bundle is not available at the moment.', reason: 'unavailable' });
        }

        // Buying entries to an activity nobody may attend is a purchase that
        // cannot be used, so this registers too — the same one-step shape the
        // booking flow has, and the same stop when a person still has to decide.
        const opened = await openRegistration({
          activity: activity, participant: participant,
          accountId: me.accountId, groupId: body.groupId || null
        });
        if (opened.status) return json(opened.status, opened.payload);
        const reg = opened.reg;
        if (reg.status !== 'approved') {
          if (opened.created) await mail.sendReceived(reg, me);
          return json(200, { ok: true, awaitingApproval: true, status: reg.status });
        }

        const coveredDates = B.coverageFor(activity, offer, now);
        let session;
        try {
          session = await checkout.createBundleCheckout({
            activity: activity, bundle: offer, coveredDates: coveredDates,
            participantId: participant.participantId, accountId: me.accountId,
            purchasedAt: now, lang: lang, email: me.email,
            participantName: [participant.firstName, participant.lastName].filter(Boolean).join(' ')
          });
        } catch (err) {
          console.error('account-registrations: bundle checkout failed:', err && err.message);
          return json(502, { error: 'Could not start the payment. Please try again.' });
        }
        // NOTHING IS WRITTEN. The bundle does not exist until Stripe says it was
        // paid for — see settleBundle in stripe-webhook.js.
        return json(200, { ok: true, url: session.url, coveredDates: coveredDates });
      }

      // ⚠ MOVING ONE EVENING, WHICH IS NOT CANCELLING AND REBOOKING.
      //
      // Cancelling a bundle entry and booking another date would work on any
      // ordinary evening and is wrong here: the cancellation credits nothing (a
      // bundle entry is frozen at zero), so the entry would be spent and gone,
      // and the family would be charged the standard price for the replacement.
      // A move keeps the entry and relocates it.
      //
      // Twenty-four hours, fixed. Inside that window there is no move at all and
      // the entry is spent exactly as a no-show spends it — the family has told
      // us too late for the place to be offered to anybody else.
      case 'rescheduleSession': {
        const participant = await mustGuard(body.participantId);
        if (!participant) return json(404, { error: NOT_YOURS });
        const activity = await published(body.slug);
        if (!activity) return json(404, { error: 'No such activity.' });
        const bad = attendance.validate(activity, body.toDate);
        if (bad) return json(400, { error: bad });

        const att = await attendance.getAttendance(
          participant.participantId, activity.activityId, body.fromDate);
        if (!att) return json(404, { error: 'No such booking.' });

        const now = Date.now();
        const may = B.mayReschedule(att, now);
        if (!may.may) {
          return json(409, {
            error: may.reason === 'too-late'
              ? 'That session is too close to its start to be moved.'
              : may.reason === 'not-a-bundle-entry'
                ? 'Only a session paid for from a bundle can be moved.'
                : 'That session cannot be moved.',
            reason: may.reason, deadline: may.deadline || null
          });
        }

        const held = await bundleStore.forParticipant(participant.participantId, activity.activityId);
        const bundle = held.filter((b) => b.bundleId === att.frozen.bundleId &&
                                          (b.usedDates || []).indexOf(body.fromDate) !== -1)[0];
        if (!bundle) return json(409, { error: 'That session is not on a bundle we can find.' });

        const mine = await attendance.forParticipant(participant.participantId, activity.activityId);
        const taken = mine.filter((a) => R.holdsASeat(a)).map((a) => a.sessionDate);
        const targets = B.rescheduleTargets(bundle, activity, body.fromDate, now, taken);
        if (targets.indexOf(body.toDate) === -1) {
          return json(409, { error: 'That date is not one this bundle can move to.',
                             reason: 'not-a-target', targets: targets });
        }

        const all = await attendance.forActivity(activity.activityId, body.toDate);
        const cap = R.capacityForDate(activity, all, body.toDate);
        if (cap.left != null && cap.left <= 0) {
          return json(409, { error: 'That session is full.', full: true });
        }

        // ORDER: the new booking, then the old one, then the bundle.
        //
        // A failure after the first leaves the family holding two evenings on
        // one entry, which is visible on their own page and costs them nothing.
        // Cancelling first and failing would take the evening away and give
        // nothing back, which is the same failure pointing at the family.
        const existing = await attendance.getAttendance(
          participant.participantId, activity.activityId, body.toDate);
        const moved = attendance.newAttendance({
          activity: activity, participantId: participant.participantId,
          accountId: me.accountId, groupId: att.groupId, sessionDate: body.toDate,
          bookedAt: new Date(now).toISOString(), bundle: true, bundleId: bundle.bundleId
        });
        moved.history = (existing ? (existing.history || []) : [])
          .concat([{ iso: new Date(now).toISOString(), action: 'moved-in',
                     by: me.accountId, note: 'from ' + body.fromDate }])
          .concat(moved.history.slice(1));
        await attendance.saveAttendance(moved);

        const released = attendance.transition(att, {
          status: 'cancelled', by: me.accountId, note: 'moved to ' + body.toDate
        });
        await attendance.saveAttendance(released);

        const after = B.afterReschedule(bundle, body.fromDate, body.toDate);
        bundle.usedDates = after.usedDates;
        bundle.coveredDates = after.coveredDates;
        bundle.history = (bundle.history || []).concat([{
          iso: new Date(now).toISOString(), action: 'rescheduled', by: me.accountId,
          note: body.fromDate + ' → ' + body.toDate
        }]);
        bundle.status = B.statusAfter(bundle, 0);
        await bundleStore.saveBundle(bundle);

        const byDate = {};
        (await attendance.forParticipant(participant.participantId, activity.activityId))
          .forEach((a) => { byDate[a.sessionDate] = a; });
        return json(200, { ok: true, session: moved, bundle: B.bundleView(bundle, byDate, now) });
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

        const opened = await openRegistration({
          activity: activity, participant: participant,
          accountId: me.accountId, groupId: body.groupId || null
        });
        if (opened.status) return json(opened.status, opened.payload);
        if (opened.already) {
          return json(409, {
            error: opened.reg.status === 'approved'
              ? 'This participant already has a place in this activity.'
              : 'There is already a request for this participant, waiting for an answer.',
            status: opened.reg.status
          });
        }

        const reg = opened.reg;
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

        // AFTER THE LEDGER, NEVER BEFORE, and with no review panel. The email
        // rule is that a send never blocks the action it accompanies; the money
        // rule is the opposite, and the money rule is the one that decides the
        // ORDER. A credit not written is money lost with nobody able to tell; a
        // message not sent leaves a person who can ask.
        //
        // The figure comes from the ENTRY that was just written, never from a
        // second call to creditFor(). Two computations of one number is how an
        // email and a ledger come to disagree, and the family reads the email.
        //
        // Nobody reviews this one because nobody is at a screen: the person who
        // pressed cancel is the person it is about. The admin's cancellation
        // goes through a panel, which is the only difference between the two.
        await mail.sendCancelled(done.registration, me,
          (done.entry && done.entry.amountCents) || 0);

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
      // 1. A COURSE NEEDS A CONFIRMED ADDRESS; A DROP-IN DOES NOT. The rule and
      //    the whole argument live in verificationRefusal() above, and the one
      //    thing to know here is that it is decided from the FROZEN type on the
      //    record rather than from the activity, which this branch never opens.
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

        const reg = await store.getRegistration(body.participantId, body.activityId);
        if (!reg) return json(404, { error: 'No such registration.' });

        // THE FROZEN TYPE, not the activity's current one. It is what the family
        // registered under, and it is read from the record already in hand —
        // this branch never opens the activity at all.
        const refusal = verificationRefusal(me, (reg.frozen && reg.frozen.type) || 'course');
        if (refusal) return refusal;

        if (reg.status !== 'approved') {
          return json(409, {
            error: 'This registration is ' + reg.status + '. Only an approved place can be paid for.',
            reason: 'not-approved', status: reg.status
          });
        }

        // ONE BUILDER, TWO DOORS. The emailed pay link charges the same
        // registration with no session at all, so the session itself — the
        // amount, the currency, the metadata, the descriptor, the return URL —
        // is built in _checkout.js and nowhere else. Two copies would be two
        // copies that can drift, and the way that drift surfaces is a family
        // charged a figure nobody on this side can explain.
        const due = checkout.dueCents(reg);
        if (!(due > 0)) {
          return json(409, { error: 'There is nothing outstanding on this registration.', reason: 'nothing-due' });
        }

        let session;
        try {
          session = await checkout.createCheckout(reg, lang, me.email);
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
