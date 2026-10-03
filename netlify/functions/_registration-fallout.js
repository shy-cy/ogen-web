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
const credit = require('./_credit');
const LISTING = require('./_activity-listing');
const REM = require('./_reminders');
const facts = require('./_activity-facts');

const same = (a, b) => String(a === undefined ? null : a) === String(b === undefined ? null : b);

// The two dates as an ADMIN set them: a date, the string "none", or null meaning
// nobody ever configured one. All three are distinct and `same()` keeps them so —
// switching a cutoff off is a change, and so is switching it back to computed.
function storedCutoffs(activity) {
  const reg = (activity && activity.registration) || {};
  const policy = reg.cancellationPolicy || {};
  // ⚠ THE CLOSING DATE IS THE LAST STEP'S BOUNDARY NOW, and it is read off the
  // STORED schedule rather than the resolved one — exactly as this always read
  // the stored field. resolveTiers() computes a default from the group's calendar
  // when nobody set one, so comparing resolved dates would read an excluded
  // holiday or a postponed start as a policy change and mail every family several
  // times a term. tiersOf() translates a legacy record without resolving it.
  return { fee: reg.registrationFeeCutoffDate,
           cancel: REG.closingBoundary(REG.tiersOf(policy)) };
}

// ⚠ THE SHAPE OF THE SCHEDULE, WITHOUT THE CLOSING DATE OR THE FEE.
//
// Those two propagate; the percentages and the steps above the last one do not —
// they are what a family agreed to, in the same way the price and the mode always
// were, and rewriting them after acceptance is the unfair-terms problem this file
// already discusses. So a changed shape is REPORTED rather than applied, and this
// is the key the two sides are compared by.
function shapeKey(tiers) {
  const list = Array.isArray(tiers) ? tiers : [];
  return list.map((t, i) => (i === list.length - 1
    ? String(t.percent)
    : String(t.percent) + '@' + String(t.until == null ? '' : t.until))).join(' | ');
}

// Cheap pre-check, off the stored records: is there any point reading the
// registrations to find out who is on an older schedule?
function scheduleShapeMoved(previous, activity) {
  if (!previous) return false;
  const of = (a) => shapeKey(REG.tiersOf(((a && a.registration) || {}).cancellationPolicy));
  return of(previous) !== of(activity);
}

// How many live registrations hold a schedule this publish did NOT bring them
// onto — compared per group, because the last boundary resolves per group, and
// compared after the closing date has been carried across so a moved date is not
// counted as a different shape.
function olderSchedules(activity, regs) {
  const want = {};
  const shapeFor = (gid) => {
    const k = String(gid || '');
    if (want[k] === undefined) want[k] = shapeKey(REG.resolveTiers(activity, gid || null));
    return want[k];
  };
  return (regs || []).filter((r) => r && R.LIVE_STATUSES.indexOf(r.status) !== -1)
    .filter((r) => {
      const frozen = (r.frozen || {}).cancellation;
      if (!frozen) return false;
      return shapeKey(credit.tiersFrom(frozen)) !== shapeFor(r.groupId);
    }).length;
}

// ⚠ THE PAYMENT MODE MOVED, AND NOTHING ON ANY RECORD MOVES WITH IT.
//
// A listing switched to or from Test changes which Stripe configuration the
// activity's FUTURE payments run through, and every registration already taken
// keeps the mode frozen on it — deliberately, because money already taken was
// real or was not, and a publish cannot make it retrospectively the other. That
// is the freeze doing its job and it is also invisible: from the form an admin has
// just changed how this activity is paid for, and the families already on it are
// the one group the change does not reach.
//
// So it is COUNTED AND NAMED, exactly as a rewritten refund schedule is. Nothing
// is rewritten and nothing is emailed: a family's own payments go on working
// through the keys they were sold under, which is the correct outcome and not one
// anybody needs telling about. What an admin needs is to know that switching a
// live activity to Test does not turn its outstanding debts into rehearsals — and
// therefore that a rehearsal wants a fresh activity rather than a repurposed one.
function paymentModeMoved(previous, activity) {
  if (!previous) return false;
  return LISTING.paymentModeOf(previous) !== LISTING.paymentModeOf(activity);
}

// How many live registrations still answer to the mode they were sold in. Read
// off the FROZEN block, which is the only place the answer is.
const onOldMode = (activity, regs) => (regs || [])
  .filter((r) => r && R.LIVE_STATUSES.indexOf(r.status) !== -1)
  .filter((r) => LISTING.modeOfRecord(r) !== LISTING.paymentModeOf(activity))
  .length;

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
  // The closing date a family currently holds, whichever shape their block is in:
  // the last step's boundary, or the single field a record written before the
  // schedule carries. closingOf() is the one translation.
  const heldClose = credit.closingOf(frozen);
  if (same(frozen.registrationFeeCutoffDate, want.registrationFeeCutoffDate) &&
      same(heldClose, want.cancellationCutoffDate)) return null;
  return {
    was: {
      registrationFeeCutoffDate: frozen.registrationFeeCutoffDate,
      cancellationCutoffDate: heldClose
    },
    now: {
      registrationFeeCutoffDate: want.registrationFeeCutoffDate,
      cancellationCutoffDate: want.cancellationCutoffDate
    }
  };
}

// ⚠ WRITTEN INTO THE SHAPE THE RECORD IS ALREADY IN, never converted to the other
// one. A block frozen before the schedule existed keeps its single field and
// moves that; one frozen with steps moves its LAST step's boundary. Converting a
// legacy block to steps here would be this publish rewriting the structure of
// terms a family agreed to, which is the one thing it is not allowed to do.
function writeClosing(frozen, date) {
  if (Array.isArray(frozen.tiers) && frozen.tiers.length) {
    frozen.tiers[frozen.tiers.length - 1].until = date;
  } else {
    frozen.cancellationCutoffDate = date;
  }
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
      writeClosing(next.frozen.cancellation, change.now.cancellationCutoffDate);
      // ⚠ THE EXPLANATION TRAVELS WITH THE DATES IT EXPLAINS. It is one statement
      // about one policy, and a note frozen against a date that has just moved is
      // a justification for a deadline this family no longer holds. Note the
      // deliberate limit: a note edited ON ITS OWN does not propagate, because the
      // trigger is the two dates and mailing every family to say a sentence was
      // reworded is noise. It reaches them the next time a date moves.
      const bag = ((activity.registration || {}).cancellationPolicy || {}).note;
      next.frozen.cancellation.note = (bag && !REG.noteIsEmpty(bag)) ? bag : null;
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

// ⚠ 3. A SESSION THAT MOVES REACHES THE CALENDAR THE DAY IT MOVES.
//
// The foundation was already here and it was the WHEN that was missing. The UID
// is stable across the approval invite and every reminder, and buildIcs() raises
// a SEQUENCE whenever the record is saved — so a moved session has always
// reached a family's calendar correctly, on the evening before the class. A
// family who had rearranged a Tuesday found out on the Monday, and anybody who
// looked at their calendar in between read a date we already knew was wrong.
//
// Nothing is written to any record here, which is what makes this the simplest
// of the three halves: the calendar is the activity's and the family holds a
// copy of it, so there is no frozen block to re-term and no capacity to re-count.
// It is a message and an attachment.
const MOVED_CAP = 40;

// Everyone who should hear that a session moved, as one entry per ACCOUNT with
// every move that concerns them.
//
// ⚠ THE RECIPIENTS ARE LOOKED UP ON THE OLD DATE, which matters for exactly one
// shape and matters completely there. On a course a registration is not dated,
// so old and new are the same question. On a drop-in a booking is keyed by the
// evening — `att-<pid>__<aid>__<date>` — so the people to tell are booked on the
// date that is going AWAY, and asking about the new one finds an empty evening
// and tells nobody, silently, in the one case where somebody is about to turn up
// on the wrong day.
//
// ⚠ ONE EMAIL PER ACCOUNT, NOT PER GROUP. A household with two children in two
// groups of one activity is one family reading one schedule, and two near
// identical messages about one publish is what teaches them to filter us — the
// same rule the reminder keeps for two children in one class. The group line is
// then dropped when their moves span more than one, because a name that is right
// for at most half of what is listed under it is worse than no name: the listing
// card drops its schedule tag for the same reason.
async function movedRecipients(activity, moves, sweep) {
  const byAccount = new Map();
  const seen = new Map();
  const dropin = (activity && activity.type) === 'dropin';
  for (const m of moves) {
    // Memoised: a course asks once per group, a drop-in once per evening, and
    // neither asks twice for an answer it already has.
    const key = dropin ? m.groupId + '__' + m.was.date : String(m.groupId);
    if (!seen.has(key)) {
      seen.set(key, await sweep.peopleFor(activity,
        { date: m.was.date, groupId: m.groupId }));
    }
    for (const person of seen.get(key)) {
      const got = byAccount.get(person.accountId) ||
        { person: person, moves: [], names: [], groupIds: [] };
      got.moves.push(m);
      person.names.forEach((n) => { if (got.names.indexOf(n) === -1) got.names.push(n); });
      if (got.groupIds.indexOf(m.groupId) === -1) got.groupIds.push(m.groupId);
      byAccount.set(person.accountId, got);
    }
  }
  // Stable order, so a run is reproducible and a test can read it back.
  return Array.from(byAccount.values())
    .sort((a, b) => String(a.person.accountId).localeCompare(String(b.person.accountId)));
}

async function announceMovedSessions(activity, previous, opts) {
  const out = { moved: 0, told: 0, deferred: 0, failed: [] };
  const now = (opts && opts.now) != null ? opts.now : Date.now();
  // ⚠ THE ACTIVITY-LEVEL SWITCH GOVERNS THIS AND THE FAMILY'S OWN DOES NOT.
  // Switched off, this activity has never put an entry in anybody's calendar, so
  // there is nothing of ours to correct. A FAMILY who turned their reminders off
  // asked not to be told about classes they already know about; a class moving is
  // not that, and the unsubscribe link promises in three languages that other
  // messages are unaffected. A rehearsal reminds nobody, as everywhere else.
  if (!REM.isLive(activity) || !REM.remindersOn(activity)) return out;
  const moves = REM.movedSessions(previous, activity, now);
  if (!moves.length) return out;
  out.moved = moves.length;

  // ⚠ REQUIRED LAZILY, inside the one branch that can need it, for the reason
  // this whole module is required lazily from the publish: it pulls in the
  // attendance store, the guardian store and the bundle reconciler, and an
  // ordinary publish needs none of them.
  const sweep = require('./_registration-sweep');
  const people = await movedRecipients(activity, moves, sweep);
  const capped = people.slice(0, MOVED_CAP);
  out.deferred = people.length - capped.length;

  await sweep.mapCapped(capped, 8, async (p) => {
    try {
      const account = await accounts.getAccount(p.person.accountId);
      if (!account || !account.email) return;
      const l = ((account.profile || {}).preferredLanguage) || 'he';
      const sessions = p.moves.map((m) => m.session);
      const ics = mail.sessionsIcs(activity, sessions, l);
      const one = p.groupIds.length === 1 && groups.offersAChoice(activity)
        ? facts.pick(p.moves[0].groupName, l) : '';
      const ok = await mail.sendSessionsMoved(p.person.reg, account, {
        names: p.names.slice().sort(),
        moves: mail.movesFor(p.moves, l),
        groupName: one,
        hasIcs: !!ics,
        ics: ics
      });
      if (ok) out.told++;
      else out.failed.push(p.person.accountId + ': send-failed');
    } catch (err) {
      out.failed.push(p.person.accountId + ': ' + ((err && err.message) || String(err)));
    }
  });
  // ⚠ AN OVERFLOW IS NAMED, never silently dropped. Unlike the nightly pass this
  // does not run again tomorrow — a publish happens once — so a family past the
  // cap is a family nobody tells unless an admin reads this and writes to them.
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
  // ⚠ A CHANGED SCHEDULE IS NOT A CHANGED CUTOFF, and it still has to be counted.
  // Editing a percentage moves nothing onto anybody — that is the decision — so
  // `needsTerms` stays false and this would have read no registrations and said
  // nothing at all. An admin who has just rewritten a refund schedule needs to be
  // told how many families are still on the old one, or the choice not to
  // propagate is a choice nobody can see.
  const needsShape = scheduleShapeMoved(previous, activity);
  const needsMode = paymentModeMoved(previous, activity);
  // ⚠ PURE, SO IT IS THE PRE-CHECK AS WELL AS THE ANSWER. Comparing two
  // calendars opens no store, so a publish that moved nothing — a reworded
  // summary, a new photograph — pays an array walk and no read at all, which is
  // the discipline roomOpenedPossible() and the series candidate set both follow.
  const movedNow = (opts && opts.now) != null ? opts.now : Date.now();
  const needsSessions = REM.movedSessions(previous, activity, movedNow).length > 0;
  if (!needsTerms && !needsRoom && !needsShape && !needsMode && !needsSessions) return null;
  const regs = await store.forActivity(activity.activityId);
  const terms = await applyCutoffChange(activity, previous, regs, opts);
  // Counted AFTER the dates have been carried across, off the records as they now
  // stand, so a moved closing date is not reported as a different schedule.
  const fresh = terms.changed ? await store.forActivity(activity.activityId) : regs;
  return {
    terms: terms,
    room: await announceNewRoom(activity, previous, regs, opts),
    sessions: needsSessions
      ? await announceMovedSessions(activity, previous,
          Object.assign({}, opts, { now: movedNow }))
      : null,
    schedule: needsShape ? { older: olderSchedules(activity, fresh) } : null,
    mode: needsMode
      ? { from: LISTING.paymentModeOf(previous), to: LISTING.paymentModeOf(activity),
          kept: onOldMode(activity, fresh) }
      : null
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
  afterPublish, paymentModeMoved, onOldMode,
  applyCutoffChange, announceNewRoom, announceMovedSessions, movedRecipients, MOVED_CAP,
  storedCutoffs, cutoffFieldsMoved, roomOpened, roomOpenedPossible, reterm,
  shapeKey, scheduleShapeMoved, olderSchedules, writeClosing
};
