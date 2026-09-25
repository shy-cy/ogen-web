// What publishing an activity does to the registrations already on it.
//
// Publishing has always been a page-rendering job: validate, render three
// languages, commit, rebuild the listing. Two of the things an admin changes on
// that form are not page content at all — they are facts about the people
// already registered — and neither one reached them.
//
// ⚠ 1. A CHANGED CUTOFF DATE NOW GOVERNS THE REGISTRATIONS ALREADY TAKEN.
//
// Reported as "if we change the cut-off date it should be a new update to the
// rules, and those that registered before should get an email that updates them
// on this change." Before this, the cutoffs were frozen at submission and
// nothing could move them, so an admin who changed one had changed it for
// nobody currently registered — and was told so by no screen. That the freeze
// was deliberate is exactly why it was confusing: the activity said 30
// September, the family's page said 24 September, and both were correct.
//
// ⚠ IT MOVES IN BOTH DIRECTIONS, WHICH WAS ASKED FOR AND IS THE RISKY HALF.
// A LATER cutoff gives a family more time than they agreed to, which nobody
// will object to. An EARLIER one takes credit rights away from somebody who has
// already accepted the old terms — and under EU unfair-terms law (93/13/EEC as
// implemented in Cyprus) a non-negotiated consumer term changed unilaterally
// after acceptance is liable to be unenforceable AGAINST the consumer, whatever
// this code writes. The narrower rule — apply it only when it helps them — was
// offered and declined, so the direction is not filtered here. What the code can
// do instead is make it impossible to do quietly: every affected family is
// emailed the new terms, the old dates stay in the registration's own history,
// and the publish response says how many records moved.
//
// ⚠ ONLY THE TWO CUTOFF DATES, and only when the STORED field moved.
//
// The frozen block also carries the mode and the whole session calendar, and
// neither is touched. A calendar edit is the ordinary business of running a term
// — excluding a holiday, adding a week — and re-terming the room on every one of
// them would mail a family about nothing, several times a term.
//
// The trigger is therefore the stored field rather than the resolved date.
// `resolveCutoffs()` computes a default from the group's calendar when nobody
// set one, so comparing resolved dates would make an excluded holiday look like
// a policy change — which is the same silent re-evaluation `basisChanged()`
// exists to refuse. An admin edits the field, or presses Recompute, which writes
// the field. Then the value APPLIED is the resolved one, per group, so clearing
// a date back to null correctly hands each group its own computed default.
//
// ⚠ 2. RAISING A GROUP'S CAPACITY OPENS PLACES, AND THE QUEUE IS NOW TOLD.
//
// Reported alongside it: "if a group has a limit of 3, we have 2 on the waiting
// list, we change the cap to 5 — what happens?" Places appeared the instant the
// publish landed, because capacity is counted and never decremented, and that is
// the half that already worked. Nobody was told. A freed place was announced
// from five events — a family's cancellation, an admin's, a rejection, a
// cancelled evening, the expiry sweep — and every one of them lives in the
// registrations domain. Raising a limit is the sixth, and it is the only one
// that happens on the activities form.
//
// It is decided by asking hasRoom() twice against the SAME registrations, with
// the old capacity and the new one, rather than by comparing the two numbers. A
// cap raised from 3 to 4 with five people registered is still full, and a
// comparison of numbers would announce a place that does not exist.
//
// ⚠ BEST EFFORT, AFTER THE COMMIT, AND LOUD WHEN IT FAILS. The files are in git
// by the time this runs and cannot be taken back, so nothing here may throw the
// publish away. Both halves are idempotent — the terms compare frozen against
// resolved, the announcement compares room against room — so a failure is
// finished by the next publish rather than left half applied.
//
// It opens no store of its own, so it does not arm the legal gate; the stores it
// writes through do.

const store = require('./_registration-store');
const accounts = require('./_account-store');
const mail = require('./_registration-email');
const waitlist = require('./_waitlist');
const groups = require('./_activity-groups');
const REG = require('./_activity-registration');
const R = require('./_registration');

const same = (a, b) => String(a === undefined ? null : a) === String(b === undefined ? null : b);

// The two dates as an ADMIN set them: a date, the string "none", or null meaning
// nobody ever configured one. All three are distinct and `same()` keeps them so —
// switching a cutoff off is a change, and so is switching it back to computed.
function storedCutoffs(activity) {
  const reg = (activity && activity.registration) || {};
  const policy = reg.cancellationPolicy || {};
  return { fee: reg.registrationFeeCutoffDate, cancel: policy.cancellationCutoffDate };
}

// Did an admin touch either field? A first publish has nothing to have moved
// from, and nothing agreed to move: `previous` is null and the answer is no.
function cutoffFieldsMoved(previous, activity) {
  if (!previous) return false;
  const was = storedCutoffs(previous);
  const now = storedCutoffs(activity);
  return !same(was.fee, now.fee) || !same(was.cancel, now.cancel);
}

// Which groups went from having no room to having some. Both reports are built
// from ONE read of the registrations, so the only thing that can differ between
// them is the capacity that was just published.
function roomOpened(previous, activity, regs, now) {
  if (!previous) return [];
  if ((activity && activity.type) === 'dropin') return [];
  const before = R.capacityReport(previous, regs, now);
  const after = R.capacityReport(activity, regs, now);
  return groups.groupList(activity)
    .filter((g) => !R.hasRoom(before, g.groupId) && R.hasRoom(after, g.groupId))
    .map((g) => ({ groupId: g.groupId, name: g.name || null }));
}

// --- applying it -----------------------------------------------------------

// One live registration, re-termed if its own group's dates have moved. Returns
// the pair of dates it changed to, or null when there was nothing to do.
function reterm(activity, reg) {
  const frozen = (reg.frozen || {}).cancellation;
  // Nothing was ever frozen here, so there is nothing to bring forward. A
  // waitlisted record is excluded a level up for the same reason: its terms are
  // rebuilt the moment a place is actually taken.
  if (!frozen) return null;
  const want = REG.resolveCutoffs(activity, reg.groupId || null);
  if (same(frozen.registrationFeeCutoffDate, want.registrationFeeCutoffDate) &&
      same(frozen.cancellationCutoffDate, want.cancellationCutoffDate)) return null;
  return {
    was: {
      registrationFeeCutoffDate: frozen.registrationFeeCutoffDate,
      cancellationCutoffDate: frozen.cancellationCutoffDate
    },
    now: {
      registrationFeeCutoffDate: want.registrationFeeCutoffDate,
      cancellationCutoffDate: want.cancellationCutoffDate
    }
  };
}

// ⚠ THE OLD DATES GO IN THE HISTORY, NOT JUST THE NEW ONES. A family who was
// quoted 24 September and is now held to 20 September will ask, and "the record
// says 20" is not an answer. It is written by hand rather than through
// transition(), because the status has not changed — and a record whose history
// says `approved` twice reads as an approval that happened twice.
function noteChange(reg, change, iso) {
  const say = (c) => [c.cancellationCutoffDate, c.registrationFeeCutoffDate]
    .map((v) => (v == null ? 'computed' : String(v))).join(' / ');
  return (reg.history || []).concat([{
    iso: iso,
    action: 'terms-changed',
    by: 'system',
    note: 'cancellation / fee cutoff ' + say(change.was) + ' -> ' + say(change.now)
  }]);
}

async function applyCutoffChange(activity, previous, regs, opts) {
  const out = { moved: false, changed: 0, emailed: 0, failed: [] };
  if (!cutoffFieldsMoved(previous, activity)) return out;
  out.moved = true;

  const now = (opts && opts.now) != null ? opts.now : Date.now();
  const iso = new Date(now).toISOString();
  const hours = ((activity.registration || {}).sessionCancelHours);

  for (const reg of regs.filter((r) => r && R.LIVE_STATUSES.indexOf(r.status) !== -1)) {
    try {
      const change = reterm(activity, reg);
      if (!change) continue;
      const next = JSON.parse(JSON.stringify(reg));
      next.frozen.cancellation.registrationFeeCutoffDate = change.now.registrationFeeCutoffDate;
      next.frozen.cancellation.cancellationCutoffDate = change.now.cancellationCutoffDate;
      next.isoUpdated = iso;
      next.history = noteChange(reg, change, iso);
      // The record first. An email about terms that were never written is worse
      // than terms nobody was told about, which is the state this leaves behind
      // on a mail failure and is exactly where the site already was.
      await store.saveRegistration(next);
      out.changed++;
      const account = await accounts.getAccount(next.accountId);
      if (account && account.email &&
          await mail.sendTermsChanged(next, account, hours)) out.emailed++;
    } catch (err) {
      out.failed.push(reg.participantId + '__' + reg.activityId + ': ' + err.message);
    }
  }
  return out;
}

async function announceNewRoom(activity, previous, regs, opts) {
  const out = { groups: [], told: 0, failed: [] };
  const now = (opts && opts.now) != null ? opts.now : Date.now();
  for (const g of roomOpened(previous, activity, regs, now)) {
    try {
      const said = await waitlist.placeOpened(activity.activityId, g.groupId);
      out.groups.push({ groupId: g.groupId, name: g.name, waiting: said.waiting });
      out.told += said.told;
    } catch (err) {
      out.failed.push(g.groupId + ': ' + err.message);
    }
  }
  return out;
}

// The one entry point a publish calls. ONE read of the registrations decides both
// halves, because reading it twice is how the count in one answer comes to
// disagree with the other. placeOpened() then does its own read when there is
// actually somebody to tell — it is the shared announcer and its four other
// callers have no list in hand, and that is a read per REOPENED GROUP rather than
// per publish.
async function afterPublish(activity, previous, opts) {
  if (!activity || !activity.activityId) return null;
  const needsTerms = cutoffFieldsMoved(previous, activity);
  const needsRoom = roomOpenedPossible(previous, activity);
  if (!needsTerms && !needsRoom) return null;
  const regs = await store.forActivity(activity.activityId);
  return {
    terms: await applyCutoffChange(activity, previous, regs, opts),
    room: await announceNewRoom(activity, previous, regs, opts)
  };
}

// Cheap pre-check so an ordinary publish — a reworded summary, a new photograph
// — costs no store read at all. It asks whether any group's capacity FIGURE
// moved; whether that actually opened a place is roomOpened()'s question, and it
// needs the registrations to answer.
function roomOpenedPossible(previous, activity) {
  if (!previous) return false;
  if ((activity && activity.type) === 'dropin') return false;
  const was = {};
  groups.groupList(previous).forEach((g) => { was[g.groupId] = g.capacity; });
  return groups.groupList(activity).some((g) => !same(was[g.groupId], g.capacity));
}

module.exports = {
  afterPublish,
  applyCutoffChange, announceNewRoom,
  storedCutoffs, cutoffFieldsMoved, roomOpened, roomOpenedPossible, reterm
};
