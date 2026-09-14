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
// It carries an assumption worth naming, because it constrains a system that
// does not exist yet: THE PAYMENT FLOW MUST BILL THE REGISTRATION FEE FIRST.
// That is how it already works in practice — the fee is what secures the place —
// but when payments are built, that ordering stops being a description of what
// happens and becomes a requirement.
function splitPaid(paidCents, feeEur) {
  const paid = Math.max(0, Math.round(Number(paidCents) || 0));
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

  const { fee, course } = splitPaid(payment.paidCents, price.registrationFee);
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
  const split = splitPaid(((reg && reg.payment) || {}).paidCents, price.registrationFee);
  return {
    at: new Date(ms(now)).toISOString(),
    mode: C.mode || 'flat',
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
function freezeCancellation(activity, resolveSessionInstant) {
  const reg = (activity && activity.registration) || {};
  const policy = reg.cancellationPolicy || {};
  const duration = ((activity && activity.facts) || {}).duration || {};
  const times = ((activity && activity.facts) || {}).schedule || {};
  const resolve = typeof resolveSessionInstant === 'function'
    ? resolveSessionInstant
    : (date, time) => resolveLocal(date, time, TZ);

  // Only the sessions that are actually happening. An excluded date never enters
  // the frozen list, which is what lets creditFor() stay ignorant of exclusions.
  const rows = (Array.isArray(duration.sessionDates) ? duration.sessionDates : [])
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
  splitPaid, share, past, endOfDay, resolveLocal, parseDateParts,
  sessionInstants, hasStarted, remaining, ms
};
