// /api/account-registrations — what a signed-in guardian may do about places.
//
// Actions: dashboard | activity | registration | submit | cancel | sessions |
//          bookSession | bookAndPay | paySession | cancelSession | rescheduleSession |
//          bundles | buyBundle | pay
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
const spend = require('./_spend-credit');
const { cancelAndCredit } = require('./_registration-cancel');
const attendance = require('./_session-attendance');
const B = require('./_bundle');
const groups = require('./_activity-groups');
const bundleStore = require('./_bundle-store');
const checkout = require('./_checkout');
const E = require('./_family-errors');
const facts = require('./_activity-facts');
const terms = require('./_cancellation-terms');
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
const waitlist = require('./_waitlist');

const json = (statusCode, payload) => ({
  statusCode,
  // no-store on every response. These carry a child's name, and the frozen
  // block carries a date of birth.
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  body: JSON.stringify(payload)
});

// ⚠ EVERY REFUSAL IS IN THE READER'S LANGUAGE — _family-errors.js holds all
// three, and js/member-session.js already sends which one on every request.
// Only the wire-level strings stay English: a non-POST, a body that is not
// JSON, an action that does not exist. A family cannot reach any of them.
//
// This file renders the price rows, the facts card and the session table in the
// page's language already; a refusal is a display string like the rest of them,
// and it was the one class that stayed English — which is the class somebody
// most needs to be able to read.
const refuse = (lang) => (status, key, extra, params) =>
  json(status, E.body(key, lang, extra, params));

// READ FROM GITHUB, NEVER FROM THE DEPLOYED BUNDLE. The bundle trails a save by
// about a minute, and an activity whose capacity or age range changed a moment
// ago must not be registered against under its old terms. Same rule the
// optimistic-locking check already follows.
async function published(slug) {
  if (!slug) return null;
  const raw = await readJson('activities/' + slug + '.json');
  return raw ? migrate(raw) : null;
}

// ⚠ THE SAME READ, FOR SCREENS ONLY — AND THE SPLIT IS THE WHOLE POINT.
//
// The activity page was three API calls, each one a GitHub round trip for the
// same file, and the register panel was three more. A short cache collapses
// them. The argument for it was "this is only display data, and the money paths
// verify everything fresh anyway" — which was NOT true when it was made: one
// `published()` served the ten call sites in this file, and six of them write.
//
// So it is true by construction now rather than by assumption. TWO FUNCTIONS:
//
//   published()           booking, paying, buying, moving, submitting — every
//                         path that freezes terms onto a record or opens a
//                         Checkout. Never cached, ever.
//   publishedForDisplay() the four read-only actions. Cached.
//
// A test pins which actions call which, because the failure mode of getting it
// wrong is a family charged a price that was edited ten seconds ago, and
// nothing about that looks wrong until somebody compares two receipts.
//
// TEN SECONDS. It covers the burst a single page load makes and an immediate
// redraw after it, which is all it needs to; an admin who edits a price and
// reloads the page they are looking at sees the change within one breath. The
// number to compare it against is not zero — it is the ~60s the deployed bundle
// already trails a save by, which is what the uncached read exists to beat.
//
// Cached as a STRING and parsed per call, so a caller that mutates what it got
// back cannot poison the next reader. Per container, so it empties on its own
// and there is nothing to invalidate.
const DISPLAY_TTL_MS = 10000;
const displayCache = new Map();

async function publishedForDisplay(slug, now) {
  if (!slug) return null;
  const at = now == null ? Date.now() : now;
  const hit = displayCache.get(slug);
  if (hit && at - hit.at < DISPLAY_TTL_MS) {
    return hit.json === null ? null : JSON.parse(hit.json);
  }
  const value = await (reader || published)(slug);
  displayCache.set(slug, { at: at, json: value === null ? null : JSON.stringify(value) });
  return value;
}

// The one seam this file has, and it exists for the same reason _email.js and
// _stripe.js have theirs: "it caches" and "it expires" are two claims, and only
// the first is visible in the source. A test drives the reader and counts.
let reader = null;

// ⚠ THE CANCELLATION TERMS, QUOTED FROM THE FUNCTION THAT WILL FREEZE THEM.
//
// A family was asked to commit — months of attendance and several hundred euros
// — and told nothing at all about getting out of it. The cutoffs existed, were
// frozen per group, and were first mentioned by the refusal that applied them.
//
// So the panel says them BEFORE the button, and it says them from
// freezeCancellation(), which is literally the function whose output submit() is
// about to store on the record. Not a second reading of the activity: the same
// one, one moment early. Whatever this quotes is what gets frozen.
//
// ⚠ AND IT IS ASKED PER GROUP, because the cutoffs are. resolveCutoffs() answers
// from the calendar the group is actually sold — two groups under the equal-hours
// rule can meet four times and six, so there is no single third session and no
// single default. Quoting one group's dates under a picker offering two is the
// same class of mistake as the schedule tag a listing card drops when the groups
// disagree, and it is worse here because the number is a deadline about money.
// The lines are only hoisted to the panel when EVERY group says the same thing;
// otherwise each option carries its own and the select swaps them.
function termsForGroup(activity, groupId, lang) {
  if ((activity.type || 'course') === 'dropin') {
    return terms.termsFor({
      type: 'dropin',
      sessionCancelHours: ((activity.registration || {}).sessionCancelHours)
    }, lang);
  }
  return terms.termsFor({
    type: 'course',
    cancellation: credit.freezeCancellation(activity, groupId),
    // The panel cannot know whether THIS participant has already paid the
    // yearly fee — the waiver is answered from that child's own registrations
    // and nobody has been picked yet. So the line appears whenever the activity
    // charges a fee at all, which is the question the panel can honestly ask.
    hasFee: Number(((activity.facts || {}).price || {}).registrationFee) > 0
  }, lang);
}

function termsAcross(activity, lang) {
  const list = groups.groupList(activity);
  const per = (list.length ? list : [{ groupId: null }])
    .map((g) => ({ groupId: g.groupId, lines: termsForGroup(activity, g.groupId, lang) }));
  const first = JSON.stringify(per[0].lines);
  return { agreed: per.every((x) => JSON.stringify(x.lines) === first) ? per[0].lines : null, per: per };
}

// What the registration form needs, and nothing it does not. It is deliberately
// a COUNT and never a list: how many places are left is public-ish information,
// who is in them is not.
function activityView(activity, report, lang) {
  const t = termsAcross(activity, lang);
  return {
    activityId: activity.activityId,
    // What cancelling this will be worth, said before the button rather than by
    // the refusal that applies it. Null only when the groups disagree, in which
    // case every option below carries its own.
    cancellationTerms: t.agreed,
    cancellationTermsTitle: terms.titleFor(lang),
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
    // ⚠ ONE GROUP IS NOT A CHOICE, AND THIS ASKS THE COUNT. Both of these keyed
    // off `report.named`, which was the opt-in list of named groups and was null
    // unless somebody had made one — so "are there named groups" and "is a
    // choice being offered" were the same question. They stopped being the same
    // the day every activity got at least one group, and both answers went
    // wrong at once, silently:
    //
    //   · the register panel drew a Group select with ONE blank option on it,
    //     asking a family to choose between one unnamed thing;
    //   · `full` became permanently false, because a one-group activity always
    //     has a `named` row — so a full course never said so.
    //
    // `offersAChoice()` is the rule written down once, in the module that owns
    // it. The same mistake is why submissionErrors() asks the count rather than
    // whether anybody typed a name.
    full: activity.type !== 'dropin' && !R.hasRoom(report, null) && !groups.offersAChoice(activity),
    groups: groups.offersAChoice(activity) && report.named
      ? report.named.map((g) => ({
          groupId: g.groupId,
          name: g.name,
          label: facts.namedGroupLine({ name: g.name, capacity: g.capacity }, lang || 'he'),
          capacity: g.capacity,
          left: g.left,
          full: g.left != null && g.left <= 0,
          cancellationTerms: (t.per.filter((x) => x.groupId === g.groupId)[0] || {}).lines || null
        }))
      : null
  };
}

// ⚠ THE TWO PAY-PER-SESSION PAYLOADS, BUILT ONCE EACH.
//
// The activity page used to make three calls for one screen — the registration,
// then the evenings, then the bundles — and each was a GitHub round trip for the
// same file. It makes one now, and these are what let it: the combined call and
// the two narrow ones return the SAME shape because they run the same function.
//
// The narrow ones did not go away, and should not: booking, cancelling and
// moving all redraw one panel, and re-fetching the whole page to repaint a table
// is the trade in the other direction.
async function sessionsPayload(activity, participantId, now) {
  const reg = await store.getRegistration(participantId, activity.activityId);
  const all = await attendance.forActivity(activity.activityId);
  const mine = {};
  all.filter((a) => a.participantId === participantId)
     .forEach((a) => { mine[a.sessionDate] = a; });

  return {
    // Booking needs an approved registration behind it. The registration is the
    // "may come" decision and an admin makes it once; this does not quietly
    // become a second way in.
    mayBook: !!reg && reg.status === 'approved',
    registrationStatus: reg ? reg.status : null,
    // ⚠ THIS PARTICIPANT'S OWN EVENINGS. Where the groups keep their own
    // calendars, offering a Beginners family the Advanced dates offers them a
    // room they are not counted in — and the price frozen for one of those
    // dates would be frozen off the wrong timetable. `reg` may be null, which is
    // a family looking before they have registered: they see the activity's own
    // list, because nobody knows yet which group they will choose.
    sessions: attendance.bookableDates(activity, reg ? (reg.groupId || null) : groups.ANY)
      .map((date) => {
      const cap = R.capacityForDate(activity, all, date);
      const own = mine[date] || null;
      // The price this evening WOULD cost, frozen off the same timetable the
      // booking will use — so the group travels here too, or the screen quotes
      // a start time from the other group's calendar and the late-price window
      // is measured against it.
      const frozen = own ? own.frozen
        : credit.freezeSession(activity, date, null,
            { bookedAt: now, groupId: reg ? (reg.groupId || null) : groups.ANY });
      return {
        date: date,
        // ⚠ THE PRICE AN EVENING WOULD COST, from the SAME function that freezes
        // it at booking and with the same `bookedAt` — or a screen offering the
        // standard price would take the late one, on an activity where those
        // differ. A booked evening quotes what it actually froze, never a
        // recomputed figure: an admin raising the price must not change what was
        // already agreed.
        priceCents: own
          ? (own.payment.owedCents || 0)
          : Math.max(0, Math.round(Number(frozen.perSessionPrice || 0) * 100)),
        priceBasis: frozen.priceBasis || null,
        // ⚠ AND WHAT IT USUALLY COSTS, so a late price can say why it is not the
        // figure on the price card. €10.00 under a card reading €7 with nothing
        // explaining it reads as a mistake, and a family cannot tell which of
        // the two is the error. The standard figure is the explanation, so it
        // travels beside the one being charged rather than being looked up by a
        // screen that would have to know the shape of facts.price.
        standardPriceCents: Math.max(0, Math.round(
          Number(((activity.facts || {}).price || {}).perSessionPrice || 0) * 100)),
        startsAt: frozen.startsAt || null,
        // Booking a date that has gone is not a thing to offer. It is a flag
        // rather than a filter because the registration page lists the whole
        // term, past evenings included, and only the register panel needs them
        // gone.
        past: credit.past(date, now),
        left: cap.left, capacity: cap.capacity, full: cap.left != null && cap.left <= 0,
        status: own ? own.status : null,
        owedCents: own ? own.payment.owedCents : null,
        paidCents: own ? own.payment.paidCents : null,
        // What cancelling would do, from the SAME function the server will
        // apply — so what is shown is what happens.
        cancellation: own ? cancellationView(credit.creditForSession(own, now),
                                            own.payment.paidCents) : null
      };
    })
    ,
    // ⚠ WHAT THIS FAMILY OWES ACROSS THEIR EVENINGS, which is the only money a
    // drop-in registration has.
    //
    // owedCentsFor() bills the yearly fee and, for a COURSE, the term price — so
    // a drop-in registration owes nothing, correctly, and the cost card drew
    // "still to pay €0.00" under a row reading "cost per session €7" while an
    // unpaid evening sat in the table below it. Every figure on it was true and
    // the card was about a term this activity does not have.
    //
    // Summed here rather than in the browser for the reason every other figure
    // is: a screen adding up money is a second implementation, and the one that
    // drifts is the one a family reads out to an admin.
    totals: (function () {
      const held = Object.keys(mine).map((d) => mine[d])
        .filter((a) => a.status === 'booked' || a.status === 'attended');
      const sum = (f) => held.reduce((n, a) => n + (Number(a.payment[f]) || 0), 0);
      const owed = sum('owedCents');
      const paid = sum('paidCents');
      const credited = sum('creditedCents');
      return {
        booked: held.length,
        owedCents: owed, paidCents: paid, creditedCents: credited,
        outstandingCents: Math.max(0, owed - paid - credited)
      };
    })()
  };
}

// ⚠ ONE SHAPE FOR "WHAT WOULD CANCELLING DO", BECAUSE THERE WERE TWO.
//
// _credit.js answers this question twice, for two different things, and the two
// answers were handed to the client under different key names:
//
//   creditFor()        -> { guardianMayCancel, feeCredit, courseCredit, total }
//   creditForSession() -> { mayCancel, credit, deadline }
//
// Both are correct in their own module: a term's credit is a fee part plus a
// course part and the total is their sum, where one evening has a single figure
// and nothing to split. What was not correct is that the FAMILY'S SCREEN reads
// one shape. creditNote() asks for `.credit`, which exists on a session and has
// never existed on a registration — so `undefined > 0` was false and the
// confirmation dialog said "this cancellation earns no credit back" on EVERY
// registration, whatever was owed back.
//
// It is the worst place on the site for that sentence to be wrong. It is the
// last thing somebody reads before an action that cannot be undone, it is about
// money, and it was confidently backwards: a family owed €330 was told they
// would get nothing, which either stops a cancellation that should happen or
// makes one happen under a false account of what it costs. Nothing errored, and
// the ledger was right the whole time — only the sentence was wrong.
//
// Adapted HERE rather than renamed in _credit.js. The two modules' own names
// carry meaning that would be lost by flattening: `total` is the SUM of two
// parts a ledger entry has to itemise, and `guardianMayCancel` says which of
// the two callers is being refused. This is the boundary where a rule module
// becomes a payload, which is the same place plainLabel() decodes an entity for
// the same reason: JSON is not the thing that produced it.
// ⚠ AND WHY A ZERO IS A ZERO, because the dialog said "no credit" and stopped.
//
// A family was asked to confirm something that cannot be undone, told they would
// get nothing back, and given no account of it — so the sentence read as a
// penalty whatever the actual reason, and the commonest reason by far is the
// gentlest one: nothing has been paid yet, so there is nothing to give back.
// Reported as "we need to explain also in the popup why no credit will be
// returned".
//
// The reason is already computed. _credit.js has returned one on every answer
// since it was written, and cancellationView() passed it through to a client
// that never read it — the same shape as `priceBasis` sitting unread in the
// sessions payload while a late price explained nothing.
//
// ⚠ "NOTHING PAID" COMES FIRST, BEFORE ANY DEADLINE. Both can be true at once —
// an unpaid evening cancelled after its window — and "the window has closed"
// then implies money was lost when none ever moved. The kinder sentence is also
// the more accurate one, so it wins.
function whyNoCredit(c, credit, paidCents) {
  if (credit > 0) return null;
  if (!(paidCents > 0)) return 'nothing-paid';
  // ⚠ SECOND, AND BEFORE EVERY DEADLINE, for the same reason 'nothing-paid' is
  // first: the deadline sentences all imply that something was lost by being
  // late, and this zero is not that. Everything paid here was the yearly fee,
  // and the fee stays paid because another term of this year is still
  // registered. It reaches this line only when the fee was the whole of what
  // was paid — with course money in it the credit is not zero.
  if (c.feeHeldElsewhere) return 'fee-held';
  // A drop-in registration credits nothing by design: there was no upfront
  // commitment to unwind, and what money there is sits on the evenings.
  if (c.reason === 'per-session') return 'per-session';
  if (c.reason === 'too-late') return 'too-late';
  if (c.reason === 'started') return 'started';
  if (c.reason === 'cancellation-closed') return 'closed';
  // Paid, inside the cancellation window, and still nothing back: everything
  // paid so far was the registration fee, and the fee answers to its OWN date,
  // which has passed. The one case where the two thresholds come apart.
  return 'past-cutoff';
}

function cancellationView(c, paidCents) {
  if (!c) return null;
  const credit = c.credit !== undefined ? c.credit : c.total;
  return {
    // A guardian's own button. creditForSession() never refuses one — an evening
    // is always cancellable and past the deadline simply earns nothing — so the
    // two arrive at the same meaning from different defaults.
    //
    // `!== undefined` rather than `||`, here and below: a genuine `false` and a
    // genuine `0` are answers, and reading either as missing would fall through
    // to the other shape's field and report the wrong one.
    mayCancel: c.mayCancel !== undefined ? c.mayCancel : c.guardianMayCancel !== false,
    // THE ONE FIGURE A FAMILY IS SHOWN. A term's is the sum of its two parts; an
    // evening's is the whole of it.
    credit: credit,
    reason: c.reason || null,
    // Null whenever there IS credit — the figure is its own explanation, and a
    // sentence under it would be explaining something nobody asked about.
    whyNothing: whyNoCredit(c, credit, paidCents),
    // ⚠ THIS ONE IS SHOWN EVEN WHEN THERE IS CREDIT, which is the exception to
    // the line above and the whole point of it. A family who paid €350 and is
    // offered €300 back is looking at a figure that does NOT explain itself,
    // and the missing €50 is the one they will write in about. `false` on an
    // evening's answer, which has no fee in it at all.
    feeHeldElsewhere: !!c.feeHeldElsewhere,
    // Only one of these is ever set, and each is named by what it is: the
    // instant one evening stops being creditable, and the date a whole term did.
    deadline: c.deadline == null ? null : c.deadline,
    closedOn: c.closedOn == null ? null : c.closedOn
  };
}

async function bundlesPayload(activity, participantId, now) {
  const held = await bundleStore.forParticipant(participantId, activity.activityId);
  // Which group's evenings this family is being offered. A participant with no
  // registration yet is looking before they have chosen, so they see the
  // activity's own calendar — the same answer sessionsPayload() gives.
  const reg = await store.getRegistration(participantId, activity.activityId);
  const gid = reg ? (reg.groupId || null) : groups.ANY;
  const mine = {};
  (await attendance.forParticipant(participantId, activity.activityId))
    .forEach((a) => { mine[a.sessionDate] = a; });

  // WHERE EACH MOVEABLE ENTRY MAY GO, computed from the same function the server
  // will apply when the move is asked for — so a date offered is a date that
  // will be accepted. A client guessing the list would offer a full evening, or
  // one outside the window that was sold.
  const taken = Object.keys(mine).filter((d) => R.holdsASeat(mine[d]));
  return {
    offers: B.bundlesAvailable(activity, now, gid).map((b) => ({
      bundleId: b.bundleId, entries: b.entries, pricePerEntry: b.pricePerEntry,
      validityDays: b.validityDays,
      totalCents: Math.round(Number(b.pricePerEntry) * 100) * b.entries,
      coveredDates: B.coverageFor(activity, b, now, gid)
    })),
    held: held.map((b) => {
      const view = B.bundleView(b, mine, now);
      view.rows.forEach((row) => {
        if (row.mayReschedule) row.targets = B.rescheduleTargets(b, activity, row.date, now, taken);
      });
      return view;
    })
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
// ⚠ `waitlist` SAYS WHAT TO DO IF IT IS FULL, not what to do. A family pressing
// "join the waiting list" on an activity where a place has appeared in the
// meantime wants the place, so they get it — the flag chooses between a refusal
// and a queue, and never between a place and a queue.
//
// ⚠ AND CLAIMING IS NOT AN ACTION. Whether this is somebody taking a place off
// the waiting list is read from the record that is already there, rather than
// from anything the client sends: a family who was queueing and is now
// registering IS claiming, by definition. So there is no claim endpoint to
// forget, no flag a hostile client can set to buy itself the ordinary 45-day
// hold, and the emailed link can simply point at the page with the Register
// button already on it.
async function openRegistration({ activity, participant, accountId, groupId, waitlist }) {
  // ⚠ KEYS, NOT SENTENCES. This function has no language — it is called from
  // two actions and knows nothing about who is reading — so it names the
  // refusal and the handler renders it. `errors` still travels whole, because
  // a form showing every problem at once beats one showing them one at a time.
  const errors = R.submissionErrors(activity, participant, groupId);
  if (errors.length) return { status: 400, key: errors[0], extra: { errors: errors } };

  const existing = await store.getRegistration(participant.participantId, activity.activityId);
  if (existing && R.holdsASpot(existing)) return { reg: existing, already: true };
  const claiming = R.isWaiting(existing);

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
  const full = activity.type !== 'dropin' && !R.hasRoom(report, groupId);
  if (full && !waitlist) {
    // ⚠ THE REFUSAL NOW OFFERS SOMETHING. It used to be the end of the road, and
    // the comment here said why: a waiting list has to choose who gets a freed
    // place, tell them, and give them a deadline, and none of that was decided.
    // It is now — everyone waiting is told, and the first to come back takes it.
    return {
      status: 409, key: 'activity-full',
      extra: { full: true, capacity: report.capacity, canWaitlist: !claiming }
    };
  }

  const reg = R.newRegistration({
    activity: activity, participant: participant, accountId: accountId, groupId: groupId,
    // THIS PARTICIPANT'S OWN registrations, and nothing else. The fee is scoped
    // to one participant, one activity, one academic year, so the waiver is
    // answerable from a prefix scan of their own key space — no sibling lookup,
    // no account aggregate, no ledger.
    priorRegistrations: await store.forParticipant(participant.participantId),
    waiting: full,
    // ⚠ RE-FROZEN, WHICH IS THE POINT OF RUNNING THIS BUILDER AGAIN. A waiting
    // entry froze a price when they joined the queue, and joining a queue is not
    // agreeing to a price — so a family who waited from September to December is
    // quoted December's terms at the moment they are actually offered a place.
    // The fee waiver and the age check are re-decided here too, for the same
    // reason: they are facts about the day a place was taken.
    claim: claiming && !full
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

// ⚠ A CONFIRMED ADDRESS, FOR EVERYTHING — ONE RULE, ONE PLACE, NO PARAMETER.
//
// It used to take a `type` and stand aside for a drop-in, on the argument that a
// term is a considered commitment that can carry a minute of friction while a
// walk-up is decided and paid for in one sitting. That argument is about
// convenience, and QA answered it with the one that is not:
//
//     "Don't we need to confirm the account before being able to register to a
//      drop in? Now, I was able to register and pay for a drop in before the
//      account is approved."
//
// We store a MINOR'S NAME AND DATE OF BIRTH against that address, in the EU, and
// then send the booking, the receipt, every reminder and every later message
// about that child to it. None of that is worth less because the class is on
// Tuesday rather than for a term. An address nobody has shown they can read is
// an address we cannot reach a family on, and the first time that matters is
// the first time something goes wrong.
//
// ⚠ THE PARAMETER IS GONE RATHER THAN ALWAYS-PASSED, and that is the point of
// the edit rather than a tidy-up. A rule with a type in it is a rule each call
// site can get wrong — and one already had none at all, because `bookAndPay`
// sat behind a line refusing everything that was not a drop-in, so the check
// would have been unreachable. With no parameter there is nothing to get wrong
// and nothing to leave out, and a call site added tomorrow inherits the rule
// instead of remembering it.
//
// Returning a key or null keeps the branches reading as a list of refusals;
// the caller renders it and keeps `reason: 'email-unverified'`, which the client
// branches on to put the resend button in front of the person.
function verificationRefusal(me) {
  return me.emailVerifiedAt ? null : 'email-unverified';
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
// ⚠ `siblings` IS THIS PARTICIPANT'S OTHER REGISTRATIONS, and it decides money.
//
// Cancelling a term does not hand back the yearly fee while another term of that
// year is still standing on it — see feeHeldByLiveTerm() — and this row draws
// the cancel button AND the figure beside it. Omitted, the flag reads false and
// the screen promises €50 the ledger will not write, which is the exact failure
// the clock argument below already caused once.
//
// It is a parameter rather than a scan inside because the dashboard has the rows
// in hand already: one list per participant, and asking again per registration
// would be a read per row of a screen built to be one call.
function regRow(reg, participant, lang, activity, siblings) {
  // ⚠ THE CLOCK IS THE CALLER'S TO SUPPLY, AND EVERY CALLER HAD FORGOTTEN.
  //
  // _credit.js never asks what time it is — that is its whole contract, and it
  // is what makes the same record and the same instant give the same figure a
  // year later. The cost is that `creditFor(reg)` with no second argument does
  // not mean "now": `past(date, undefined)` is FALSE and `hasStarted(starts,
  // undefined)` is FALSE, so every threshold reads as not yet reached.
  //
  // So this row was built from the most generous answer the function can give,
  // always: the hard cutoff never passed, the fee cutoff never passed, the
  // course never started. A family past every deadline was shown a cancel button
  // and promised the whole of what they had paid — and cancelAndCredit(), which
  // DOES pass a timestamp, then wrote nothing to the ledger. The screen and the
  // record disagreed by the entire amount, in the one place this file promises
  // they cannot: "what is offered is what happens".
  const now = Date.now();
  const owed = credit.creditFor(reg, now,
    { feeHeldElsewhere: R.feeHeldByLiveTerm(reg, siblings) });
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
    // ⚠ NO ageFlag AND NO REASON, AND THAT IS THE POINT.
    //
    // Both were sent here for a release, so the family's waiting block could say
    // "the age is outside the range this activity states". The rule behind it is
    // right — autoApproves() stands aside on a stated range that is not
    // positively satisfied — and the sentence was wrong: it lands on a parent as
    // a verdict on their child, at the moment they have just signed up, over a
    // flag that is advisory and a decision no person has taken yet.
    //
    // The reason belongs on the admin queue and is already there, with the
    // numbers, from `reg.ageFlag` read by admin-registrations.js. Sending it to
    // this payload as well would be an invitation to render it again — the
    // family's screen is given the state and not our reasons for it, which is
    // the same rule that has `pending` and `approved` share one pill.
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
    cancellation: cancellationView(owed, reg.payment.paidCents),
    // ⚠ THE TERMS AS FROZEN, NOT AS THE ACTIVITY NOW READS THEM. The whole
    // reason freezeCancellation() runs at submission is that an admin switching
    // a course from flat to prorated in March must not change what a January
    // family agreed to — so a footnote rebuilt from the live activity would
    // quietly re-quote the new policy at the old family, which is that rule
    // broken by the one screen written to explain it.
    // ⚠ A DROP-IN'S WINDOW IS NOT FROZEN HERE AND MUST NOT BE. The rule is
    // hours before ONE evening's start, and it is frozen onto each attendance
    // record as `cancelHours` at the moment that evening is booked — so the
    // registration-level sentence is about evenings not booked yet, which will
    // freeze from the activity as it stands then. Copying it onto the
    // registration would be a second place the same number lives, and the two
    // would disagree the first time an admin changed it. With no published
    // activity to ask there is no honest figure, and null is the generous
    // reading every blank in _credit.js takes.
    cancellationTerms: terms.termsFor({
      type: reg.frozen.type || 'course',
      cancellation: reg.frozen.cancellation,
      // Decided here rather than in a clockless module: creditFor() has already
      // said whether the window is shut, and the sentence has to agree with the
      // button it sits under.
      closed: owed.reason === 'cancellation-closed',
      sessionCancelHours: ((activity || {}).registration || {}).sessionCancelHours,
      // Here the waiver IS decided: the fee was billed on this registration or
      // it was not, and `feeCharged` says which. Absent reads as charged, the
      // same tri-state splitPaid() reads, because every record written before
      // the waiver existed was charged.
      hasFee: reg.frozen.price.feeCharged !== false &&
              Number(reg.frozen.price.registrationFee) > 0
    }, lang),
    cancellationTermsTitle: terms.titleFor(lang)
  };
}

exports._internal = {
  publishedForDisplay,
  DISPLAY_TTL_MS,
  _setReader: (fn) => { reader = fn; displayCache.clear(); }
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    return json(400, { error: 'Body must be JSON' });
  }

  const found = await sessions.authenticate(body);
  if (!found) return json(401, E.body('not-signed-in', E.readerLang(body)));
  const me = found.account;
  // ⚠ THE LANGUAGE ON SCREEN, NOT THE ONE ON THE ACCOUNT.
  //
  // Everything this file renders for a person to read right now — the named
  // groups, the facts card, the price rows, the session table, the language
  // Stripe Checkout opens in and the tree it returns to — is about the page they
  // are looking at. The account's `preferredLanguage` is about messages that
  // arrive LATER and out of context, which is a different question with a
  // different right answer, and it stays where it belongs: the mail module reads
  // it off the account and nothing here passes it one.
  //
  // A family reading the Hebrew page was being offered English group names to
  // choose between, because somebody had once picked English as a preference.
  //
  // The client sends it on every request; an absent or unknown value falls back
  // to the preference, so an older tab and a direct API call still answer in
  // something rather than in nothing.
  // One resolver, shared with the other two family endpoints so the three
  // cannot answer the same request in different languages.
  const lang = E.readerLang(body, me);
  const no = refuse(lang);

  const mustGuard = async (participantId) => {
    if (!participantId) return null;
    if (!(await guardians.isGuardian(participantId, me.accountId))) return null;
    return participants.getParticipant(participantId);
  };

  try {
    switch (body.action) {
      // --- what is on offer ------------------------------------------------
      case 'activity': {
        const activity = await publishedForDisplay(body.slug);
        if (!activity) return no(404, 'no-such-activity');
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
        if (!participant) return no(404, 'no-such-participant');
        const activity = await publishedForDisplay(body.slug);
        if (!activity) return no(404, 'no-such-activity');
        if (activity.type !== 'dropin') {
          return no(400, 'term-not-by-session');
        }
        return json(200, Object.assign({ ok: true },
          await sessionsPayload(activity, participant.participantId, Date.now())));
      }

      case 'bookSession': {
        const participant = await mustGuard(body.participantId);
        if (!participant) return no(404, 'no-such-participant');
        const activity = await published(body.slug);
        if (!activity) return no(404, 'no-such-activity');
        const bad = attendance.validate(activity, body.sessionDate);
        if (bad) return no(400, bad);

        const reg = await store.getRegistration(participant.participantId, activity.activityId);
        if (!reg || reg.status !== 'approved') {
          return no(409, 'need-approved-registration');
        }
        const existing = await attendance.getAttendance(
          participant.participantId, activity.activityId, body.sessionDate);
        if (existing && R.holdsASeat(existing)) {
          return no(409, 'evening-already-booked', { status: existing.status });
        }
        // ⚠ CLAIMING IS READ OFF THE RECORD, NOT OFF THE REQUEST. A family who
        // was in this evening's queue and is now booking it IS taking a place
        // that opened, by definition — so there is no claim action to forget and
        // no flag a hostile client can leave out to buy itself an ordinary,
        // open-ended hold on a seat other families are queueing for.
        const claiming = !!existing && existing.status === 'waiting';

        // The room on THAT evening, not the term. Counted, never decremented —
        // so a cancellation frees the place the moment it is written.
        const all = await attendance.forActivity(activity.activityId, body.sessionDate);
        const cap = R.capacityForDate(activity, all, body.sessionDate);
        if (cap.left != null && cap.left <= 0) {
          if (body.waitlist !== true || claiming) {
            return no(409, 'evening-full', { full: true, canWaitlist: !claiming });
          }
          // In the queue for this evening. No seat, nothing owed, and no price
          // frozen — late pricing means the only honest moment to fix a price
          // is when a place is actually taken.
          const queued = attendance.newAttendance({
            activity: activity, participantId: participant.participantId,
            accountId: me.accountId, groupId: reg.groupId, sessionDate: body.sessionDate,
            waiting: true
          });
          if (existing) queued.history = (existing.history || []).concat(queued.history);
          await attendance.saveAttendance(queued);
          await mail.sendWaiting(reg, me, body.sessionDate);
          return json(200, { ok: true, attendance: queued, waiting: true });
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
          bundle: !!from, bundleId: from ? from.bundleId : null,
          // ⚠ A SEAT TAKEN OFF THE QUEUE IS HELD ONLY UNTIL IT IS PAID FOR. The
          // whole reason this evening had a queue is that seats were being held
          // and not paid for, so handing the claimer an open-ended hold would
          // rebuild the problem one layer down. Never past the session's start.
          claimUntil: claiming
            ? R.sessionClaimDeadline((credit.freezeSession(activity, body.sessionDate, null,
                { groupId: reg.groupId }) || {}).startsAt, Date.now())
            : null
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
        if (!participant) return no(404, 'no-such-participant');
        const activity = await published(body.slug);
        if (!activity) return no(404, 'no-such-activity');
        if (activity.type !== 'dropin') {
          return no(400, 'term-not-by-session');
        }
        // ⚠ AND THIS IS THE CALL SITE THAT DID NOT EXIST. The line above refuses
        // everything that is not a drop-in, and while the gate stood aside for a
        // drop-in that made the check unreachable — so the one flow with no
        // confirmed address was also the one flow that wrote a child's name and
        // date of birth and then took money. It asks now, before anything is
        // opened, so a refusal leaves no record behind.
        {
          const refusal = verificationRefusal(me);
          if (refusal) return no(403, refusal, { reason: 'email-unverified' });
        }

        const wanted = Array.isArray(body.sessionDates) ? body.sessionDates.map(String) : [];
        const dates = wanted.filter((d, i) => wanted.indexOf(d) === i).sort();
        if (!dates.length) return no(400, 'choose-a-date', { reason: 'no-dates' });
        if (dates.length > checkout.MAX_SESSION_LINES) {
          return no(400, 'too-many-dates', { reason: 'too-many' },
                    { max: checkout.MAX_SESSION_LINES });
        }
        for (const d of dates) {
          const bad = attendance.validate(activity, d);
          if (bad) return no(400, bad);
        }

        const opened = await openRegistration({
          activity: activity, participant: participant,
          accountId: me.accountId, groupId: body.groupId || null
        });
        if (opened.status) return no(opened.status, opened.key, opened.extra);
        const reg = opened.reg;

        // ⚠ AN ACTIVITY THAT DOES NOT AUTO-APPROVE STOPS HERE, and stops before
        // any money moves. `pending` means an admin wants to look at this — an
        // age outside the stated range, or auto-approve switched off — and
        // booking evenings against a place that may be refused would mean an
        // immediate refund and a family wondering what happened. Nothing is
        // booked, nothing is charged, and the message that explains the wait is
        // the one that already exists for exactly this case.
        if (reg.status !== 'approved') {
          if (opened.created) await mail.sendReceived(reg, me, (activity.registration || {}).sessionCancelHours);
          return json(200, {
            ok: true, awaitingApproval: true, status: reg.status,
            registration: regRow(reg, participant, lang, null,
                                 await store.forParticipant(participant.participantId))
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
          return no(409, 'dates-gone', { reason: 'unavailable', refused: refused });
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
        if (!participant) return no(404, 'no-such-participant');
        const activity = await published(body.slug);
        if (!activity) return no(404, 'no-such-activity');
        const reg = await store.getRegistration(participant.participantId, activity.activityId);
        if (!reg || reg.status !== 'approved') {
          return no(409, 'need-approved-registration', { reason: 'not-approved' });
        }
        const att = await attendance.getAttendance(
          participant.participantId, activity.activityId, body.sessionDate);
        if (!att) return no(404, 'evening-not-booked');

        // Today this always passes: an attendance record exists only for a
        // drop-in, because both booking paths refuse anything else. The call is
        // here anyway rather than a comment saying so — if a course ever becomes
        // payable by the session, the rule follows it instead of being a thing
        // somebody has to remember.
        const refusal = verificationRefusal(me);
        if (refusal) return no(403, refusal, { reason: 'email-unverified' });

        let session;
        try {
          session = await checkout.createSessionCheckout(att, activity.title, lang, me.email);
        } catch (err) {
          if (err && err.reason === 'nothing-due') {
            return no(409, 'nothing-due-session', { reason: 'nothing-due' });
          }
          console.error('account-registrations: Stripe session failed:', err && err.message);
          return no(502, 'checkout-failed');
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
        if (!participant) return no(404, 'no-such-participant');
        const activity = await publishedForDisplay(body.slug);
        if (!activity) return no(404, 'no-such-activity');
        if (activity.type !== 'dropin') {
          return no(400, 'bundles-dropin-only');
        }
        return json(200, Object.assign({ ok: true },
          await bundlesPayload(activity, participant.participantId, Date.now())));
      }

      case 'buyBundle': {
        const participant = await mustGuard(body.participantId);
        if (!participant) return no(404, 'no-such-participant');
        const activity = await published(body.slug);
        if (!activity) return no(404, 'no-such-activity');
        if (activity.type !== 'dropin') {
          return no(400, 'bundles-dropin-only');
        }

        const now = Date.now();

        // Buying entries to an activity nobody may attend is a purchase that
        // cannot be used, so this registers too — the same one-step shape the
        // booking flow has, and the same stop when a person still has to decide.
        const opened = await openRegistration({
          activity: activity, participant: participant,
          accountId: me.accountId, groupId: body.groupId || null
        });
        if (opened.status) return no(opened.status, opened.key, opened.extra);
        const reg = opened.reg;
        if (reg.status !== 'approved') {
          if (opened.created) await mail.sendReceived(reg, me, (activity.registration || {}).sessionCancelHours);
          return json(200, { ok: true, awaitingApproval: true, status: reg.status });
        }

        // ⚠ THE OFFER IS RE-DECIDED HERE, from the activity, at this instant,
        // and AFTER the registration — because which bundles can be honoured is
        // a question about THIS FAMILY'S CALENDAR. Where the groups keep their
        // own dates, "the next five sessions" is a different list per group, so
        // a bundle offered against one group's timetable and sold to somebody in
        // the other covers evenings they cannot attend — which the nightly pass
        // would then read as a shortfall WE caused and credit back.
        //
        // `reg.groupId` rather than `body.groupId`: a family already registered
        // in one group is in that group whatever the request says.
        //
        // The client sends an id and nothing else — never a price, never an
        // entry count — so a bundle the admin has since removed, or one this
        // group's calendar can no longer cover, is refused rather than sold.
        const gid = reg.groupId || null;
        const offer = B.bundlesAvailable(activity, now, gid)
          .filter((b) => b.bundleId === String(body.bundleId || ''))[0];
        if (!offer) {
          return no(409, 'bundle-unavailable', { reason: 'unavailable' });
        }

        const coveredDates = B.coverageFor(activity, offer, now, gid);
        let session;
        try {
          session = await checkout.createBundleCheckout({
            activity: activity, bundle: offer, coveredDates: coveredDates,
            participantId: participant.participantId, accountId: me.accountId,
            groupId: gid, purchasedAt: now, lang: lang, email: me.email,
            participantName: [participant.firstName, participant.lastName].filter(Boolean).join(' ')
          });
        } catch (err) {
          console.error('account-registrations: bundle checkout failed:', err && err.message);
          return no(502, 'checkout-failed');
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
        if (!participant) return no(404, 'no-such-participant');
        const activity = await published(body.slug);
        if (!activity) return no(404, 'no-such-activity');
        const bad = attendance.validate(activity, body.toDate);
        if (bad) return no(400, bad);

        const att = await attendance.getAttendance(
          participant.participantId, activity.activityId, body.fromDate);
        if (!att) return no(404, 'no-such-booking');

        const now = Date.now();
        const may = B.mayReschedule(att, now);
        if (!may.may) {
          // The three reasons are three keys. mayReschedule() already named
          // which one it is; this only turns that name into a sentence.
          const why = may.reason === 'too-late' ? 'session-too-late-to-move'
                    : may.reason === 'not-a-bundle-entry' ? 'not-a-bundle-entry'
                    : 'session-cannot-move';
          return no(409, why, { reason: may.reason, deadline: may.deadline || null });
        }

        const held = await bundleStore.forParticipant(participant.participantId, activity.activityId);
        const bundle = held.filter((b) => b.bundleId === att.frozen.bundleId &&
                                          (b.usedDates || []).indexOf(body.fromDate) !== -1)[0];
        if (!bundle) return no(409, 'bundle-not-found');

        const mine = await attendance.forParticipant(participant.participantId, activity.activityId);
        const taken = mine.filter((a) => R.holdsASeat(a)).map((a) => a.sessionDate);
        const targets = B.rescheduleTargets(bundle, activity, body.fromDate, now, taken);
        if (targets.indexOf(body.toDate) === -1) {
          return no(409, 'not-a-move-target', { reason: 'not-a-target', targets: targets });
        }

        const all = await attendance.forActivity(activity.activityId, body.toDate);
        const cap = R.capacityForDate(activity, all, body.toDate);
        if (cap.left != null && cap.left <= 0) {
          return no(409, 'session-full', { full: true });
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

      // ⚠ SPENDING CREDIT, WHICH A FAMILY COULD NOT DO.
      //
      // Cancelling in time has written a line in the ledger since Phase 5, the
      // dashboard has shown a balance since Phase 6, and there was no action
      // anywhere that turned it back into a paid place. "It comes back as
      // credit" was true and useless: an admin could apply it from the Roster
      // and the family whose money it was could not.
      //
      // One action for both kinds of debt, because it is one question — "put
      // some of what I am holding against this" — and the two records carry the
      // same payment vocabulary. `sessionDate` is what says which.
      //
      // ⚠ THE AMOUNT IS DECIDED HERE, never taken from the request. A client
      // that names its own figure is a client that can name somebody else's
      // balance, and there is nothing useful to choose anyway: what can be spent
      // is the smaller of what is owed and what is held, and any other number is
      // either a leftover debt or credit deleted.
      case 'useCredit': {
        const participant = await mustGuard(body.participantId);
        if (!participant) return no(404, 'no-such-participant');

        const record = body.sessionDate
          ? await attendance.getAttendance(participant.participantId, body.activityId, body.sessionDate)
          : await store.getRegistration(participant.participantId, body.activityId);
        if (!record) return no(404, 'no-such-registration');

        // ⚠ SPENDING CREDIT IS PAYING, SO IT ASKS WHAT PAYING ASKS.
        //
        // This branch had neither gate, and both holes were reported from one
        // session: an account whose address was never confirmed settled a term
        // with credit, and a registration still WAITING FOR AN ADMIN was settled
        // with credit — on a card where the pay button was correctly withheld
        // for exactly those two reasons, with the credit button sitting directly
        // above it.
        //
        // That is this codebase's own "two doors, one payment" lesson arriving
        // by a third door. _checkout.js exists because the button and the
        // emailed link must charge the same thing on the same terms; credit
        // settles the same debt on the same record and writes the same
        // `payment.status`, so it is a payment whatever it is called — the only
        // difference is which pocket it comes out of.
        //
        // ⚠ THE ADDRESS GATE IS OUTSIDE THIS BRANCH AND THE APPROVAL GATE IS
        // INSIDE IT, because they are about different things.
        //
        // The address is about whether we can reach this family at all, which is
        // true of an evening exactly as it is of a term — it used to sit inside
        // the branch on the reasoning that "an attendance record exists only for
        // a drop-in, which never asks for a confirmed address", and a drop-in
        // asks now. The approval gate stays inside: a booked evening is already
        // a booking rather than a request somebody may still refuse.
        const refusal = verificationRefusal(me);
        if (refusal) return no(403, refusal, { reason: 'email-unverified' });
        if (!body.sessionDate) {
          if (!checkout.isPayable(record)) {
            return no(409, 'not-approved-for-payment',
                      { reason: 'not-approved', status: record.status }, { status: record.status });
          }
        }
        // The account that OWES is the one credited, and it need not be this
        // one: a second guardian can book an evening on a participant somebody
        // else registered. Spending another account's credit is not something a
        // guardian link authorises.
        if (record.accountId !== me.accountId) {
          return no(403, 'credit-not-yours', { reason: 'not-your-debt' });
        }

        const balance = await ledger.balanceFor(me.accountId);
        const cents = spend.spendable(record, balance);
        if (!(cents > 0)) {
          return no(409, balance > 0 ? 'nothing-outstanding' : 'no-credit',
                    { reason: balance > 0 ? 'nothing-due' : 'no-credit', balanceCents: balance });
        }

        let done;
        try {
          done = await spend.spendCredit({
            record: record, kind: body.sessionDate ? 'session' : 'registration',
            cents: cents, by: me.accountId, note: 'applied by the account holder'
          });
        } catch (err) {
          const code = err.reason === 'amount' ? 400 : 409;
          return json(code, { error: err.message, reason: err.reason });
        }
        return json(200, { ok: true, spentCents: done.spentCents,
                           balanceCents: done.balanceCents, entry: done.entry });
      }

      case 'cancelSession': {
        const participant = await mustGuard(body.participantId);
        if (!participant) return no(404, 'no-such-participant');
        const att = await attendance.getAttendance(
          body.participantId, body.activityId, body.sessionDate);
        if (!att) return no(404, 'no-such-booking');
        if (att.status === 'cancelled') return json(200, { ok: true, session: att });
        if (att.status !== 'booked') {
          return no(409, 'evening-already-happened');
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
        // ⚠ THIS EVENING'S QUEUE, NOT THE ACTIVITY'S. Waiting for Tuesday says
        // nothing about Thursday — the room is per date and so is the list.
        await waitlist.seatOpened(att.activityId, att.sessionDate);
        return json(200, { ok: true, session: next, credit: owed, entry: entry,
                           balance: await ledger.balanceFor(me.accountId) });
      }

      // --- this account's registrations ------------------------------------
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
      // ⚠ THE WHOLE DASHBOARD, IN ONE CALL.
      //
      // It was four: `me` to authenticate, then the participant count, then the
      // registrations, then the credit balance — three of which are the same
      // question asked of three functions. Two of them already lived here, and
      // the third is one prefix scan that does not need a function of its own.
      //
      // `me` stays separate on purpose: boot() has to know WHO this is before it
      // can decide which screen to draw, so it is the one call that cannot be
      // folded into the others without inverting the order the page renders in.
      case 'dashboard': {
        // The same walk `list` does, and it is the only one available: a
        // registration is keyed by participant, so "this account's" means "every
        // participant it guards". The ids come back from a key scan without a
        // blob being opened.
        const ids = await guardians.participantIdsFor(me.accountId);
        // ⚠ ALL OF THEM AT ONCE, AND THE LEDGER ALONGSIDE.
        //
        // This was a `for` loop awaiting two reads per participant and then the
        // ledger after all of it — so a family with three people paid about
        // fifteen network round trips end to end, in series, every time the
        // dashboard opened. None of them needs anything from the one before it:
        // the ids are already in hand, and the balance is about the ACCOUNT and
        // has nothing to do with the participants at all.
        //
        // Promise.all over a map rather than pushing as they land, so the rows
        // stay in the order the ids came back in — a dashboard whose list
        // reshuffles between two loads reads as a screen that cannot be trusted.
        const [people, entries] = await Promise.all([
          Promise.all(ids.map(async (id) => {
            // The same list, handed to every row: the fee question is about this
            // participant's OTHER registrations, and they are already here.
            const [p, regs] = await Promise.all([
              participants.getParticipant(id), store.forParticipant(id)
            ]);
            return regs.map((reg) => regRow(reg, p, lang, null, regs));
          })),
          ledger.entriesFor(me.accountId)
        ]);
        const rows = [].concat.apply([], people);
        return json(200, {
          ok: true,
          // A COUNT, not the people. The dashboard tile shows a number and links
          // to the page that lists them; sending names here would be sending a
          // child's name to a screen that does not display it.
          participantCount: ids.length,
          registrations: rows,
          balanceCents: ledger.balanceOf(entries),
          currency: ledger.CURRENCY,
          entries: entries
        });
      }

      case 'registration': {
        const participant = await mustGuard(body.participantId);
        if (!participant) return no(404, 'no-such-participant');
        const reg = await store.getRegistration(body.participantId, body.activityId);
        if (!reg) return no(404, 'no-such-registration');
        // One prefix scan, for the fee question the cancel button turns on.
        const siblings = await store.forParticipant(body.participantId);

        const index = (await readJson('activities/activities-index.json')) || [];
        const entry = index.filter((a) => a.activityId === reg.activityId)[0] || null;
        const activity = entry ? await publishedForDisplay(entry.slug) : null;

        // An activity can be unpublished after somebody registered for it. The
        // registration is still real and still shows its frozen terms; there is
        // simply nothing current to say about when and where.
        const report = activity ? R.capacityReport(activity, await store.forActivity(reg.activityId)) : null;
        const L = LABELS[lang] || LABELS.he;
        return json(200, {
          ok: true,
          registration: regRow(reg, participant, lang, activity, siblings),
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
          }) : null,
          // ⚠ EVERYTHING THIS SCREEN NEEDS, IN ONE CALL.
          //
          // A drop-in page was three round trips — this, then the evenings, then
          // the bundles — and each read the same activity file from GitHub. They
          // are built here from the copy already in hand.
          //
          // Absent on a course and absent when the activity is gone, rather than
          // empty: the client draws those panels only for a drop-in, and an empty
          // object would be a claim that there are no evenings rather than that
          // the question does not arise.
          // What this account is holding, so the page that shows a debt can also
          // show the thing that settles it. It was on the dashboard only, which
          // is not where anybody is standing when they owe something.
          balanceCents: await ledger.balanceFor(me.accountId),
          perSession: activity && activity.type === 'dropin'
            ? Object.assign(
                await sessionsPayload(activity, participant.participantId, Date.now()),
                await bundlesPayload(activity, participant.participantId, Date.now()))
            : null
        });
      }

      // --- ask for a place --------------------------------------------------
      case 'submit': {
        const participant = await mustGuard(body.participantId);
        if (!participant) return no(404, 'no-such-participant');
        const activity = await published(body.slug);
        if (!activity) return no(404, 'no-such-activity');

        // ⚠ NOTHING IS REGISTERED FOR FROM AN ADDRESS NOBODY HAS PROVED.
        //
        // The gate used to sit at payment, three doors down, and that was the
        // wrong place for it in both directions. A family registered, waited
        // days for an admin to answer, opened the email saying they had a
        // place — and met the wall there, after the commitment rather than
        // before it. Friction discovered late reads as a system that changed
        // its mind.
        //
        // And it let us store a MINOR'S NAME AND DATE OF BIRTH against an
        // address nobody has shown they can read. That is the stronger half of
        // the argument and it has nothing to do with money: the registration
        // itself is the thing the address has to be good for, because the
        // confirmation, the approval, the expiry apology and every later
        // message about that child go to it. This project's most careful rule
        // is about exactly that record.
        //
        // There used to be a drop-in exemption here and it is gone — see
        // verificationRefusal(), which no longer takes a type. The friction
        // argument for it was real and was about convenience; this one is about
        // a child's record, and a walk-up on Tuesday stores exactly the same
        // record a term does.
        //
        // The gates further down STAY. They are not made redundant by this one:
        // a registration taken before today sits on an unverified account
        // already, and the client is hostile by assumption. What changes is
        // that they now almost never fire.
        const refusal = verificationRefusal(me);
        if (refusal) return no(403, refusal, { reason: 'email-unverified' });

        const opened = await openRegistration({
          activity: activity, participant: participant,
          accountId: me.accountId, groupId: body.groupId || null,
          // Only ever chooses between a refusal and a queue. With room, the
          // family gets the place whatever this says.
          waitlist: body.waitlist === true
        });
        if (opened.status) return no(opened.status, opened.key, opened.extra);
        if (opened.already) {
          return no(409, opened.reg.status === 'approved'
                      ? 'already-has-a-place' : 'already-registered-waiting',
                    { status: opened.reg.status });
        }

        const reg = opened.reg;
        // Best effort, and after the write. An email that fails must not undo a
        // registration that succeeded.
        if (R.isWaiting(reg)) await mail.sendWaiting(reg, me, null);
        else if (reg.status === 'approved') await mail.sendApproved(reg, me, (activity.registration || {}).sessionCancelHours);
        else await mail.sendReceived(reg, me, (activity.registration || {}).sessionCancelHours);
        return json(200, { ok: true, registration: reg, waiting: R.isWaiting(reg) });
      }

      // --- leave the queue ---------------------------------------------------
      //
      // ⚠ NOT A CANCELLATION, and it deliberately does not go through
      // cancelAndCredit(). Nothing was ever owed, paid or held, so there is no
      // credit to work out, no ledger line to write and no place to give back —
      // running the money path over a record that has never had any money on it
      // would be asking four questions whose answers are all nought.
      //
      // The record is marked `cancelled` rather than deleted, because deleting
      // it would take the history with it and an admin looking at a family who
      // waited, left, and came back a month later should be able to see all
      // three. `cancelled` with nothing paid is invisible to the fee waiver —
      // feeStandsOn() asks what was actually paid and not given back — so it
      // cannot quietly buy anybody a waived registration fee.
      case 'leaveWaitlist': {
        const participant = await mustGuard(body.participantId);
        if (!participant) return no(404, 'no-such-participant');
        const reg = await store.getRegistration(body.participantId, body.activityId);
        if (!reg) return no(404, 'no-such-registration');
        if (!R.isWaiting(reg)) return no(409, 'already-in-status', null, { status: reg.status });
        const next = R.transition(reg, {
          status: 'cancelled', by: me.accountId, source: 'guardian',
          note: 'left the waiting list', now: Date.now()
        });
        await store.saveRegistration(next);
        return json(200, { ok: true, registration: next });
      }

      // --- give a place back ------------------------------------------------
      case 'cancel': {
        const participant = await mustGuard(body.participantId);
        if (!participant) return no(404, 'no-such-participant');
        const reg = await store.getRegistration(body.participantId, body.activityId);
        if (!reg) return no(404, 'no-such-registration');
        if (reg.status === 'cancelled') return json(200, { ok: true, registration: reg });
        if (reg.status !== 'pending' && reg.status !== 'approved') {
          return no(409, 'already-in-status', null, { status: reg.status });
        }

        // ⚠ THERE IS NO creditFor() CALL HERE ANY MORE. One stood here to feed
        // the 409 below, and when that refusal was deleted the variable was left
        // behind reading nothing — a computation of money with no consumer,
        // which is the shape somebody later wires up believing it was load
        // bearing. cancelAndCredit() works out the figure, and it is the only
        // caller that writes.

        // ⚠ THE HARD CUTOFF GOVERNS ENTITLEMENT AND NOTHING ELSE, and a 409
        // refusing the family stood here.
        //
        // It read as a punishment for being late rather than as a rule about
        // money: a family who has decided not to come back was told they could
        // not say so, on a screen whose only other option is to keep a place
        // they do not want — which also keeps it from the next family. The
        // per-evening path has always allowed it and simply credited nothing,
        // and the two halves of one policy must not disagree. `whyNoCredit()`
        // sends `closed` so the dialog says, before anything is confirmed, that
        // the window shut and nothing comes back.
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

        // ⚠ AFTER THE WRITE, AND IT CANNOT FAIL THE ACTION. The place is already
        // free — capacity is counted, so it opened the instant `cancelled` was
        // written — and this only tells the people who asked to be told.
        await waitlist.placeOpened(reg.activityId);

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
      // 1. A CONFIRMED ADDRESS. The rule and the whole argument live in
      //    verificationRefusal() above, which asks one question of one field and
      //    takes no type — so this branch needs to open nothing to apply it.
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
        if (!participant) return no(404, 'no-such-participant');

        const reg = await store.getRegistration(body.participantId, body.activityId);
        if (!reg) return no(404, 'no-such-registration');

        const refusal = verificationRefusal(me);
        if (refusal) return no(403, refusal, { reason: 'email-unverified' });

        // ONE LIST, BOTH DOORS — see isPayable() in _checkout.js, which the
        // emailed pay link reads too. Approved only: `pending` means a person
        // still has something to decide, and money must not move against a place
        // nobody has agreed to give. What a pending family sees on the card is
        // the waiting block, not silence.
        if (!checkout.isPayable(reg)) {
          return no(409, 'not-approved-for-payment',
                    { reason: 'not-approved', status: reg.status }, { status: reg.status });
        }

        // ONE BUILDER, TWO DOORS. The emailed pay link charges the same
        // registration with no session at all, so the session itself — the
        // amount, the currency, the metadata, the descriptor, the return URL —
        // is built in _checkout.js and nowhere else. Two copies would be two
        // copies that can drift, and the way that drift surfaces is a family
        // charged a figure nobody on this side can explain.
        const due = checkout.dueCents(reg);
        if (!(due > 0)) {
          return no(409, 'nothing-due-registration', { reason: 'nothing-due' });
        }

        let session;
        try {
          session = await checkout.createCheckout(reg, lang, me.email);
        } catch (err) {
          console.error('account-registrations: Stripe session failed:', err && err.message);
          return no(502, 'checkout-failed');
        }

        return json(200, { ok: true, url: session.url, amountCents: due });
      }

      default:
        return json(400, { error: `Unknown action "${body.action}"` });
    }
  } catch (err) {
    console.error('[account-registrations] ' + (err && err.stack || err));
    return no(500, 'server-error');
  }
};
