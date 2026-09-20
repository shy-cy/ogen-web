// What a cancellation credits.
//
// PURE, and deliberately the purest thing in this project: creditFor() reads one
// registration and one timestamp. No activity lookup, no GitHub call, no live
// schedule, no store, and no Date.now(). That is not a style preference — it is
// the direct consequence of the policy being FROZEN onto the registration at
// submission, which is itself the answer to a question about fairness.
//
// An admin who switches an activity from flat to prorated in March, or moves a
// cutoff date, must not change what a family who registered in January is owed.
// Those are the terms somebody agreed to before paying. So the mode, both cutoff
// dates and the session list are copied onto the registration beside the price
// that is already frozen there for the same reason — and once they are, the
// calculation cannot reach anything that might have changed since.
//
// Two properties fall out of that, and both matter more than the purity itself:
//
//   - It is testable with no fixtures, no stores and no network, which is why
//     this is written FIRST, before anything depends on it.
//   - Re-run against the same record and the same timestamp a year later it
//     returns the same figure. A family that paid 350 and was credited 150 will
//     ask why, possibly months afterwards, and "the system calculated it" is not
//     an answer. basisFor() below is what lets the ledger say where a number
//     came from, reproducibly.
//
// The escape hatch, when the frozen terms are not what somebody deserves, is the
// ledger's own: an admin posts an explicit, attributed, audited adjustment.
// Never a quiet reinterpretation of what the terms meant.
//
// Nothing here opens a store or names a person, so it does not arm the legal
// gate — see tests/registration-waits-for-real-legal-pages.js. The ledger it
// feeds is Phase 5 proper and does hold personal data.

// Ogen's session times are local wall clock in Cyprus. Every cutoff date is
// evaluated as the END of that day here, and every session instant is resolved
// in the same zone before it is frozen.
//
// Nothing else in this repository has ever named a time zone, so this is new
// ground rather than an existing convention. The ICS builder in _email.js takes
// instants and emits UTC precisely so it does NOT have to know one; resolving a
// wall-clock time to an instant is the caller's job, and for a credit the caller
// is this file.
// The only require in this file, and it is pure: which calendar and which
// schedule a named group has. It opens no store, reads no clock and does not
// change the rule this module opens with — one record and one timestamp in, the
// same figure out a year later.
const groups = require('./_activity-groups');

const TZ = 'Asia/Nicosia';

// A cutoff that has been deliberately switched off. Same three-state value the
// activity carries — a date, 'none', or null — so past() gains one line and
// nothing else in the system has to learn that a switch exists.
const OFF = 'none';

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// A real calendar date, as epoch milliseconds at UTC midnight, or null.
//
// The pattern alone is not enough: "2026-02-30" matches it, and Date.UTC rolls
// it forward into March rather than refusing it — so a deadline nobody could
// have meant would silently become the 2nd of March. Round-tripping is what
// rejects it, and it is the same check _activity-sessions.js already makes.
function parseDateParts(value) {
  const m = ISO_RE.exec(String(value || '').trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return { y: y, mo: mo, d: d };
}

// Accepts a Date, an epoch, or an ISO string, and returns epoch milliseconds.
// Registrations are JSON, so a frozen instant arrives as a number or a string
// depending on who wrote it, and a comparison against a string is a comparison
// that silently does the wrong thing.
function ms(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

// The UTC offset in force at a given instant, in that zone. Derived from Intl
// rather than from a table, because a table of Cyprus DST transitions is a thing
// that goes stale without telling anyone.
function offsetAt(utcMs, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const p = {};
  dtf.formatToParts(new Date(utcMs)).forEach((x) => { p[x.type] = x.value; });
  // Some ICU versions render midnight as hour 24 under hour12:false.
  const asIfUTC = Date.UTC(+p.year, +p.month - 1, +p.day, (+p.hour) % 24, +p.minute, +p.second);
  return asIfUTC - utcMs;
}

// The last instant of a calendar day in a zone: 23:59:59.999 local.
//
// END of the day, not midnight at its start. Comparing against the start would
// cost a family the whole of the last day, silently — and comparing in UTC would
// move the deadline by the two or three hours Cyprus runs ahead, so a
// cancellation at 01:00 local on the final day would be refused as late. Both
// mistakes point the same way, against the family, which is how they survive
// review.
//
// The offset is applied twice because the first guess can land on the wrong side
// of a DST transition; the second pass is computed from an instant already
// inside the correct day.
function endOfDay(iso, tz) {
  const p = parseDateParts(iso);
  if (p == null) return null;
  // Whole seconds while the offset is being resolved, and the milliseconds added
  // back afterwards. formatToParts has no millisecond field, so an instant
  // carrying .999 comes back truncated and the derived offset is a second short
  // — which lands the "end" of the day a second into the next one. Small enough
  // to look like a rounding artefact, and it is a deadline.
  const base = Date.UTC(p.y, p.mo - 1, p.d, 23, 59, 59, 0);
  const first = base - offsetAt(base, tz || TZ);
  return (base - offsetAt(first, tz || TZ)) + 999;
}

// THE GENEROUS DEFAULT IS NOT A SPECIAL CASE — it is this one line.
//
// All three dates default to null, and every null resolves the way that favours
// the family: no fee cutoff means the fee is always creditable, no cancellation
// cutoff means cancellation never closes. That is a property of this helper
// rather than three branches elsewhere, so there is nowhere for a fourth date to
// be added later and get the default wrong.
//
// The direction is the point. A missing date is an activity somebody did not
// finish configuring, and reading a blank as "the cutoff has passed" means
// keeping a family's money on the strength of an empty field. It is the same
// rule capacity already follows, where a missing group size means uncapped
// rather than zero: a blank must never be read as a restriction.
function past(date, now) {
  if (date == null || date === OFF) return false;
  const end = endOfDay(date, TZ);
  if (end == null) return false;
  const t = ms(now);
  return t != null && t > end;
}

// Fee first, capped at the frozen fee; whatever remains is the course.
//
// DERIVED, not stored. Two fields — paidFeeCents and paidCourseCents — were the
// obvious alternative and are the wrong choice: they introduce an invariant
// across three numbers, that they must sum to paidCents, on a store with no
// transaction to hold it. A broken invariant in a money field is the kind of bug
// that is discovered by a family rather than by a test.
//
// It carries an assumption worth naming, because it constrains the payment flow:
// THE PAYMENT FLOW MUST BILL THE REGISTRATION FEE FIRST. That is how it already
// works in practice — the fee is what secures the place — but once payments
// exist that ordering stops being a description and becomes a requirement.
//
// `feeCharged` IS THE THIRD ARGUMENT, AND IT HAS TO BE, because the fee is
// charged once a year per participant per activity: a child returning for the
// spring term of the same course is not billed it again. On that registration
// NOTHING PAID IS FEE, so taking it off the top would credit back the first €50
// of a course payment as a fee — inflating the fee credit and deflating the
// course credit, which are governed by different dates and different rules, so
// the total moves too.
//
// It is a tri-state on purpose. `false` means the fee was waived on this
// registration; `true` means it was billed; ABSENT means a record written before
// the waiver existed, which is every registration taken so far — and for those
// "charged" is not a default, it is the fact. So absent reads as charged and
// nothing already stored changes meaning.
function splitPaid(paidCents, feeEur, feeCharged) {
  const paid = Math.max(0, Math.round(Number(paidCents) || 0));
  if (feeCharged === false) return { fee: 0, course: paid };
  const feeTotal = Math.max(0, Math.round((Number(feeEur) || 0) * 100));
  const fee = Math.min(paid, feeTotal);
  return { fee: fee, course: paid - fee };
}

// FLAT IS PRORATION WITH A FIXED RATIO. One division, one guard and one rounding
// rule, rather than two formulas that can round differently — which is exactly
// the kind of difference nobody notices until two families compare receipts.
//
// Rounded UP: half a cent has to go somewhere, and it goes to the family.
function share(cents, num, den) {
  if (!(den > 0) || !(num > 0)) return 0;
  if (num >= den) return cents;
  return Math.ceil((cents * num) / den);
}

// The sessions this registration froze, as instants, in order. Only sessions
// that are actually HAPPENING are ever frozen here — an excluded date never
// enters the list — so nothing below has to know that exclusions exist, and a
// holiday cannot skew a credit.
function sessionInstants(C) {
  return (Array.isArray(C && C.sessionStartsAt) ? C.sessionStartsAt : [])
    .map(ms)
    .filter((t) => t != null)
    .sort((a, b) => a - b);
}

const hasStarted = (starts, now) => starts.length > 0 && ms(now) != null && ms(now) >= starts[0];
// Counted by START time, so cancelling at nine in the morning on a session day
// still counts that session as remaining. The family has not had it yet.
const remaining = (starts, now) => starts.filter((t) => t > ms(now)).length;

// The credit a cancellation earns, in integer cents.
//
// Three thresholds, and the important thing is that they are NOT one timeline.
// The registration fee has its own date and answers to nothing else; the course
// portion answers to the first session and to the hard cutoff. The fee's cutoff
// can sit before registration even closes, or after the course has ended, so
// drawing them on a shared axis would imply an ordering that does not exist.
//
//   Course   100% before the first session
//            50%, or remaining / total, after it — flat or prorated
//            0%  after cancellationCutoffDate
//
//   Fee      100% before registrationFeeCutoffDate
//            0%   after it, wherever that date happens to fall
function creditFor(reg, now) {
  const frozen = (reg && reg.frozen) || {};
  const C = frozen.cancellation || {};
  const price = frozen.price || {};
  const payment = (reg && reg.payment) || {};

  // A DROP-IN NEVER REACHES THE COURSE ARITHMETIC BELOW, and this guard is what
  // makes "creditFor() is not called for a drop-in" a property of the code
  // rather than a rule every call site has to remember.
  //
  // It matters because the course path would answer, and answer WRONG. A
  // drop-in has no cancellation policy, so the frozen block carries mode 'flat'
  // and both cutoffs null — and every null in this file resolves towards the
  // family. The fee would come back at 100% and the "course" at 50%, for an
  // activity where the fee is a once-a-year joining fee and there is no course
  // to prorate. Nobody would have seen a wrong number; they would have seen a
  // plausible one.
  //
  // Cancelling a drop-in REGISTRATION credits nothing, because there was no
  // upfront commitment to unwind: a family that stops coming has cancelled
  // nothing and simply owes nothing further. What is creditable is a single
  // booked session, and that is creditForSession() below.
  if (frozen.type === 'dropin') {
    return {
      guardianMayCancel: true,
      feeCredit: 0, courseCredit: 0, total: 0,
      reason: 'per-session'
    };
  }

  const { fee, course } = splitPaid(payment.paidCents, price.registrationFee, price.feeCharged);
  const starts = sessionInstants(C);

  // 1. The hard cutoff answers for everything, and comes first.
  //
  // It governs ENTITLEMENT, not the ability to end a registration. An admin
  // cancellation still goes through after this date and credits nothing: a child
  // has to be removable for a safety or eligibility reason in week nine, and a
  // policy about money must not be the thing that prevents it. What is refused
  // here is the guardian's own cancel button.
  if (past(C.cancellationCutoffDate, now)) {
    return {
      guardianMayCancel: false,
      feeCredit: 0, courseCredit: 0, total: 0,
      reason: 'cancellation-closed',
      closedOn: C.cancellationCutoffDate
    };
  }

  // 2. The fee is judged on its OWN date, whatever the course is doing.
  const feeCredit = past(C.registrationFeeCutoffDate, now) ? 0 : fee;

  // 3. The course: has it started, and then which mode.
  //
  // The denominator is the LENGTH OF THE FROZEN LIST, not a separate count
  // field. This project has had a typed session count disagreeing with its own
  // calendar since before any of this was built, and the one place that
  // disagreement would have decided money is here.
  let courseCredit;
  if (!hasStarted(starts, now)) courseCredit = course;
  else if (C.mode === 'prorated') courseCredit = share(course, remaining(starts, now), starts.length);
  else courseCredit = share(course, 1, 2);

  return {
    guardianMayCancel: true,
    feeCredit: feeCredit,
    courseCredit: courseCredit,
    total: feeCredit + courseCredit,
    reason: !hasStarted(starts, now) ? 'not-started'
          : C.mode === 'prorated' ? 'prorated'
          : 'flat'
  };
}

// What the ledger records ALONGSIDE the number.
//
// A family credited 150 out of 350 will ask why. The entry therefore carries the
// mode, both dates, sessions remaining over sessions total, and the two figures
// that were added together — so the answer is in the record rather than in
// somebody's memory of what the policy used to be.
//
// Under the frozen policy this is also reproducible: creditFor() re-run against
// the same registration and the same timestamp returns the same figure a year
// later, which a live-policy design could not promise.
function basisFor(reg, now) {
  const C = ((reg && reg.frozen) || {}).cancellation || {};
  const price = ((reg && reg.frozen) || {}).price || {};
  const starts = sessionInstants(C);
  const result = creditFor(reg, now);
  const split = splitPaid(((reg && reg.payment) || {}).paidCents, price.registrationFee, price.feeCharged);
  return {
    at: new Date(ms(now)).toISOString(),
    mode: C.mode || 'flat',
    // Whether the fee was billed on THIS registration, so a family asking why
    // their spring credit is smaller than their autumn one has the answer in the
    // record rather than in somebody's memory of the waiver rule.
    feeCharged: price.feeCharged !== false,
    registrationFeeCutoffDate: C.registrationFeeCutoffDate == null ? null : C.registrationFeeCutoffDate,
    cancellationCutoffDate: C.cancellationCutoffDate == null ? null : C.cancellationCutoffDate,
    sessionsTotal: starts.length,
    sessionsRemaining: remaining(starts, now),
    started: hasStarted(starts, now),
    paidCents: split.fee + split.course,
    paidFeeCents: split.fee,
    paidCourseCents: split.course,
    feeCredit: result.feeCredit,
    courseCredit: result.courseCredit,
    total: result.total,
    reason: result.reason,
    timezone: TZ
  };
}

// What to FREEZE onto a registration at submission. Kept here, beside the
// function that reads it, so the two shapes cannot drift — the whole design
// rests on creditFor() needing nothing but this block.
//
// `resolveSessionInstant` converts one scheduled date plus a wall-clock time
// into an instant. It is a parameter rather than a built-in because the caller
// is the one that knows which zone the times were written in — the same
// reasoning that keeps the ICS builder free of a time zone.
// ⚠ `groupId` IS THE SECOND ARGUMENT AND IT DECIDES MONEY. Prorated credit is
// sessions remaining over sessions TOTAL, and on an activity where Beginners
// meet on Mondays and Advanced on Wednesdays those are two different lists. The
// old signature had nowhere to say which, so it froze the activity's calendar —
// right for at most one of the two groups, and wrong in the direction nobody
// checks, because the figure it produces is perfectly plausible.
//
// calendarFor() throws rather than guessing when a per-group activity is asked
// without a group, so a call site that never learned to thread it fails loudly
// instead of quietly crediting the wrong amount. On an activity with one
// calendar nothing changes and nothing can throw.
function freezeCancellation(activity, groupId, resolveSessionInstant) {
  const reg = (activity && activity.registration) || {};
  const policy = reg.cancellationPolicy || {};
  const times = groups.scheduleFor(activity, groupId);
  const resolve = typeof resolveSessionInstant === 'function'
    ? resolveSessionInstant
    : (date, time) => resolveLocal(date, time, TZ);

  // Only the sessions that are actually happening. An excluded date never enters
  // the frozen list, which is what lets creditFor() stay ignorant of exclusions.
  const rows = groups.calendarFor(activity, groupId)
    .filter((r) => r && r.date && r.status !== 'excluded');
  const defaultTime = ((times.sessions || [])[0] || {}).time || '';

  return {
    mode: policy.mode === 'prorated' ? 'prorated' : 'flat',
    registrationFeeCutoffDate: reg.registrationFeeCutoffDate == null
      ? null : reg.registrationFeeCutoffDate,
    cancellationCutoffDate: policy.cancellationCutoffDate == null
      ? null : policy.cancellationCutoffDate,
    sessionStartsAt: rows
      .map((r) => resolve(r.date, r.time || defaultTime))
      .filter((t) => t != null)
      .sort((a, b) => a - b)
  };
}

// --- one session, and the only rule it has -----------------------------------

// ALL OR NOTHING, and deliberately so. A single evening has nothing to be part
// of, so there is nothing to prorate: proration divides sessions remaining by
// sessions total, and for one session that is 1/1 or 0/1, which is a boolean
// wearing a fraction's clothes.
//
//   sessionCancelHours = 24   cancel 24h or more before it starts -> full credit
//                             later than that                     -> nothing
//   sessionCancelHours = null always creditable until it begins
//
// Null is the generous reading, the same direction every other blank in this
// file resolves in: a missing number is an activity nobody finished configuring,
// and reading a blank as "the deadline has passed" would keep a family's money
// on the strength of an empty field.
//
// It reuses the ledger, the credit-never-refund rule, and the Asia/Nicosia
// resolution the cutoffs use. Only the arithmetic is smaller — and note it is
// hours before a START TIME rather than the end of a day, because a session is a
// moment and a cutoff date is a day.
function creditForSession(att, now) {
  const frozen = (att && att.frozen) || {};
  const payment = (att && att.payment) || {};
  const paid = Math.max(0, Math.round(Number(payment.paidCents) || 0));
  const startsAt = ms(frozen.startsAt);
  // NO Date.now() — THE CALLER PASSES THE MOMENT IN. That is the whole contract
  // of this module: it reads one record and one timestamp and nothing else, so
  // re-running it a year later against the same pair returns the same figure. A
  // test asserts the file never asks what time it is, and it caught this
  // function reaching for a fallback clock.
  //
  // An unknown moment therefore reads as "nothing has passed yet", exactly as
  // past(null) does for the course cutoffs — the same direction every blank here
  // resolves in.
  const at = ms(now);

  // No resolvable start is the same generous answer: something is misconfigured,
  // and that is not the family's doing.
  if (startsAt == null) {
    return { mayCancel: true, credit: paid, reason: 'no-start-time' };
  }
  const hours = frozen.cancelHours;
  const deadline = hours == null ? startsAt : startsAt - (Number(hours) * 3600 * 1000);

  if (at == null || at < deadline) {
    return { mayCancel: true, credit: paid, reason: 'in-time', deadline: deadline };
  }
  // Past the deadline the session is still CANCELLABLE — a family can always say
  // they are not coming, and an admin can always take somebody off a register.
  // What is refused is the money, which is the same split the course cutoff
  // makes between entitlement and the ability to act.
  return { mayCancel: true, credit: 0, reason: hours == null ? 'started' : 'too-late', deadline: deadline };
}

// What to freeze onto one booked session, beside the function that reads it, for
// the same reason freezeCancellation() sits beside creditFor(): the two shapes
// cannot drift, and the answer stays reproducible a year later.
//
// `resolveSessionInstant` is a parameter for the same reason it is there — the
// caller knows which zone the wall-clock times were written in.
// ⚠ `opts` CARRIES THE MOMENT OF BOOKING, AND NOTHING IN HERE ASKS FOR IT.
//
// Late pricing is a comparison against a start time, so it needs to know when
// the booking happened — and this file's whole contract is that it never asks
// what time it is. `opts.bookedAt` is passed in, absent reads as "not late",
// and the same booking re-frozen a year from now produces the same price.
// Reading a blank as late would charge the higher figure in exactly the case
// nobody can check.
//
// `opts.bundle` short-circuits both: an entry was bought in advance at a fixed
// rate, which is what a bundle IS, so the evening costs nothing further and
// late pricing cannot apply to it however late it is booked.
// `opts.groupId` for the same reason freezeCancellation() takes one: which
// evenings exist, and at what time, is a per-group question the moment the
// groups keep their own calendars. It rides on opts rather than becoming a
// fifth positional argument, beside `bookedAt` and the bundle it is already
// carrying.
function freezeSession(activity, sessionDate, resolveSessionInstant, opts) {
  const reg = (activity && activity.registration) || {};
  const times = groups.scheduleFor(activity, (opts || {}).groupId);
  const resolve = typeof resolveSessionInstant === 'function'
    ? resolveSessionInstant
    : (date, time) => resolveLocal(date, time, TZ);

  // ONLY A SESSION THAT IS ACTUALLY HAPPENING has a start time. A date the
  // calendar does not hold — or one that is excluded — freezes `null` rather
  // than a plausible instant built from the default time, which would make a
  // booking for a date the activity does not meet on look perfectly well formed.
  // Same rule freezeCancellation() follows, where an excluded date never enters
  // the frozen list at all.
  const row = groups.calendarFor(activity, (opts || {}).groupId)
    .filter((r) => r && r.date === sessionDate && r.status !== 'excluded')[0] || null;
  const defaultTime = ((times.sessions || [])[0] || {}).time || '';
  const startsAt = row ? resolve(sessionDate, row.time || defaultTime) : null;
  const sessionPrice = priceForSession(activity, startsAt, opts);

  return {
    type: 'dropin',
    sessionDate: sessionDate,
    startsAt: startsAt,
    // Null means "creditable until it starts", and absent must not become 0 —
    // zero hours and no rule are the same answer here, but only by accident, and
    // a later edit to either would separate them.
    cancelHours: reg.sessionCancelHours == null ? null : Number(reg.sessionCancelHours),
    perSessionPrice: sessionPrice.price,
    // WHICH price this is, frozen beside the figure. A number with no basis is
    // a number nobody can explain to a family six weeks later, and "why was I
    // charged 10 and she was charged 12" is the question this answers.
    priceBasis: sessionPrice.basis,
    bundleId: (opts && opts.bundleId) || null,
    currency: 'EUR'
  };
}

// The standard price, the late price, or nothing at all.
//
// ONE FUNCTION, so the figure a screen shows and the figure a booking charges
// cannot disagree — the same reason there is exactly one checkout builder.
//
// The cutoff is HOURS BEFORE A START TIME rather than the end of a day, because
// a session is a moment where a cancellation cutoff is a day. It reuses the
// instant already resolved above, so there is no second idea here of when a
// session begins.
function priceForSession(activity, startsAt, opts) {
  const price = ((activity || {}).facts || {}).price || {};
  const standard = price.perSessionPrice == null ? null : Number(price.perSessionPrice);
  if (opts && opts.bundle) return { price: 0, basis: 'bundle' };

  const late = price.lateDropIn || {};
  const bookedAt = ms((opts || {}).bookedAt);
  if (!late.enabled || late.price == null || startsAt == null || bookedAt == null) {
    return { price: standard, basis: 'standard' };
  }
  const hours = Number(late.hoursBefore);
  // No usable cutoff is not "late from the beginning of time" — it is a rule
  // nobody finished configuring, and it resolves towards the family like every
  // other blank here.
  if (!Number.isFinite(hours) || hours < 0) return { price: standard, basis: 'standard' };

  const cutoff = startsAt - hours * 60 * 60 * 1000;
  return bookedAt >= cutoff
    ? { price: Number(late.price), basis: 'late' }
    : { price: standard, basis: 'standard' };
}

// One local wall-clock date and time in a zone, as an instant. Same two-pass
// offset correction as endOfDay, for the same DST reason.
function resolveLocal(iso, time, tz) {
  const p = parseDateParts(iso);
  if (p == null) return null;
  const hm = /^(\d{1,2}):(\d{2})$/.exec(String(time || '').trim());
  const h = hm ? +hm[1] : 0;
  const min = hm ? +hm[2] : 0;
  const base = Date.UTC(p.y, p.mo - 1, p.d, h, min, 0, 0);
  const first = base - offsetAt(base, tz || TZ);
  return base - offsetAt(first, tz || TZ);
}

module.exports = {
  TZ, OFF,
  creditFor, basisFor, freezeCancellation,
  creditForSession, freezeSession,
  splitPaid, share, past, endOfDay, resolveLocal, parseDateParts, priceForSession,
  sessionInstants, hasStarted, remaining, ms
};
