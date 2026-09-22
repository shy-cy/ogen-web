// _activity-groups.js — a group is the unit, and this is the one place that says so.
//
// PURE. No stores, no network, no clock. Everything here reads a record and
// answers a question about it. It REQUIRES NOTHING, deliberately: the rendering
// side has to ask this module which value a group carries, so importing
// _activity-facts here would be a cycle. The two helpers borrowed from it are
// four lines between them, and four duplicated lines beat an import cycle.
//
// ⚠ WHY THIS FILE CHANGED SHAPE. An activity used to BE the thing that had an
// age range, a teacher, a room and a timetable, and "named groups" were an
// optional list that could differ in size and, later, in when they met.
// Everything else was one answer for everybody — so an activity running a
// Hebrew-speaking group with Dorit on Thursdays and a Russian-speaking group
// with Anat on Sundays could not say so. It published one age range, one
// language, one teacher list and one room for two classes that shared none of
// them.
//
// So the list came first. `activity.groups[]` is not optional and not a
// sub-field of `facts.groupSize`: every activity has at least one group, and a
// group carries its own facts. What stays on the activity is what genuinely IS
// one answer — the price, the words, the picture, the search metadata.
//
// ⚠ ONE GROUP IS NOT A CHOICE. The family is asked which group they want when,
// and only when, there are TWO OR MORE. With one, the group is assigned, its
// name is not published, and the page renders exactly as it did before any of
// this existed. That is what keeps naming a group a promise to a family rather
// than a side effect of the data model — see offersAChoice().
//
// ⚠ EQUAL TOTAL INSTRUCTIONAL HOURS. Groups may meet a different number of times
// for a different length — six two-hour meetings and twelve one-hour ones are
// both twelve hours — but the TOTAL has to match, because there is one
// `fullPrice` for the activity and it buys the same teaching whichever group a
// family picks. Refused on save by validateGroups(), naming both groups and both
// totals. This REPLACES the old rule that every group met the same number of
// times, which was strictly stronger and refused a shape Ogen actually runs.

const ANY = '*';

// ⚠ WHICH FACTS BELONG TO A GROUP AND WHICH TO THE ACTIVITY. The split lives
// here rather than in _activity-facts.js because this module is the one nothing
// else depends on — facts requires groups, migrate requires both, and a list
// that has to be imported from the module that imports it is a cycle.
//
// A fact is per-group when two classes under one banner can honestly differ on
// it. Price cannot: one figure buys the activity, whichever group you join.
const GROUP_FACTS = ['ages', 'schedule', 'duration',
                     'instructionLanguage', 'prerequisites', 'location', 'address'];
// groupSize is what is LEFT of the old fact: the free-text override for the
// grouping sentence. The counts and the per-group capacities moved onto the
// groups themselves, where they belong.
const ACTIVITY_FACTS = ['groupSize', 'price'];

const isGroupFact = (key) => GROUP_FACTS.indexOf(key) !== -1;

// facts.pick() for one language, inlined — used to name a group in a refusal an
// admin reads. English, because the admin is in English.
const nameOf = (bag) => {
  if (typeof bag === 'string') return bag.trim();
  if (!bag) return '';
  return String(bag.en || bag.he || bag.ru || '').trim();
};

// facts.num(), inlined. 0 is a real answer; '' and null are not.
const num = (value) => {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const rowsOf = (v) => (Array.isArray(v) ? v : []);
const scheduledRows = (rows) => rowsOf(rows).filter((r) => r && r.date && r.status !== 'excluded');

const factsOf = (activity) => (((activity || {}).facts) || {});

// --- the list --------------------------------------------------------------

// Every group on the activity. After migrate() this is never empty; before it —
// a fixture built by hand, a record read straight off disk — it can be, and the
// resolvers below fall back to the activity's own facts for exactly that case.
// That fallback is what lets a record be migrated on read rather than in a
// migration nobody can run twice.
function groupList(activity) {
  return rowsOf((activity || {}).groups).filter((g) => g && g.groupId);
}

function groupById(activity, groupId) {
  return groupList(activity).filter((g) => g.groupId === groupId)[0] || null;
}

// ⚠ THE COUNT DECIDES WHETHER A FAMILY IS ASKED, not whether the groups are
// named. A single group may be named — an admin can call it whatever they like —
// and a one-option picker is still not a choice. Two or more and the name is
// required on save, because now it is the thing a family picks by.
function offersAChoice(activity) {
  return groupList(activity).length > 1;
}

// The group a registration carrying no groupId belongs to.
//
// ⚠ THIS IS WHY A FULL CLASS DOES NOT REPORT AS EMPTY. Every registration taken
// while an activity was pooled carries `groupId: null`. The moment migrate()
// gives that activity its one group, a capacity check that bucketed by groupId
// would find the group row at zero and the twenty existing registrations filed
// under "unassigned" — an activity that is full reading as empty, with nothing
// erroring. With exactly one group there is only one honest answer, so null
// resolves to it. With two or more there is not, and null stays unassigned
// exactly as it does today.
function soleGroup(activity) {
  const list = groupList(activity);
  return list.length === 1 ? list[0] : null;
}

// Resolve a groupId to a group, or null when there is no single answer.
// `undefined` and `null` both mean "not stated"; ANY means "deliberately not
// stated", and the two are told apart only where it decides money — see
// calendarFor().
function resolveGroup(activity, groupId) {
  if (groupId === ANY) return null;
  if (groupId == null) return soleGroup(activity);
  return groupById(activity, groupId);
}

// --- the one fact resolver -------------------------------------------------

const groupFacts = (group) => ((group || {}).facts) || {};

// ⚠ EVERY READER THAT KNOWS ITS GROUP COMES THROUGH HERE.
//
// A group carries the COMPLETE fact after migration — not a patch over the
// activity's — so there is no per-fact "is this empty" judgement to get wrong.
// The fall-through to the activity's own facts exists for one case and says so:
// a record that has not been through migrate() yet.
function factFor(activity, key, groupId) {
  if (!isGroupFact(key)) return factsOf(activity)[key] || {};
  const group = resolveGroup(activity, groupId);
  if (group) return groupFacts(group)[key] || {};
  return factsOf(activity)[key] || {};
}

// The same fact for every group, in order. This is what the rendering side
// aggregates over — "do they agree, and if not what do they each say".
function factAcross(activity, key) {
  const list = groupList(activity);
  if (!list.length) return [{ group: null, value: factsOf(activity)[key] || {} }];
  return list.map((g) => ({ group: g, value: groupFacts(g)[key] || {} }));
}

// --- calendars and schedules -----------------------------------------------

const durationOfGroup = (group) => groupFacts(group).duration || {};

// ⚠ A FORGOTTEN ARGUMENT IS LOUD, AND ONLY WHERE IT IS AMBIGUOUS.
//
// On an activity with one group there is one answer and no argument to forget.
// The moment there are two, a caller that never learned to thread the group
// through starts returning a plausible wrong calendar — which is the exact shape
// of bug that surfaces as two families comparing receipts — so that is the
// moment it throws instead.
//
// `null` is its own case and is NOT an error: a registration taken while the
// activity was still pooled carries no group, and on a single-group activity it
// resolves to that group. On a multi-group activity it reads the union, because
// inventing a group would put a family on dates nobody promised them.
//
// `ANY` is the honest answer for a caller with genuinely no group — the check-in
// codes on the wall, the listing of every evening an activity runs — and it
// means the UNION. It used to mean the activity's own list, which after the move
// to groups is empty; the union is what those callers always wanted.
function calendarFor(activity, groupId) {
  if (groupId === undefined && offersAChoice(activity)) {
    throw new Error('calendarFor: this activity has more than one group — pass the ' +
      'groupId, or ANY when there is genuinely no group');
  }
  if (groupId === ANY) return unionDates(activity);
  const group = resolveGroup(activity, groupId);
  if (group) return rowsOf(durationOfGroup(group).sessionDates);
  if (groupList(activity).length) return unionDates(activity);
  return rowsOf((factsOf(activity).duration || {}).sessionDates);
}

// The schedule FACT for a group — the sentence "Mondays, 16:00" is built from.
// ANY, or a group that cannot be resolved on a multi-group activity, reads the
// FIRST group's: the only caller in that position wants a wall-clock start time
// to fall back on, and a time from one group beats no time at all.
function scheduleFor(activity, groupId) {
  const group = resolveGroup(activity, groupId) || groupList(activity)[0];
  if (group) return groupFacts(group).schedule || {};
  return factsOf(activity).schedule || {};
}

// The duration FACT for a group. Same discipline as calendarFor: a forgotten
// argument on a multi-group activity throws rather than answering for one group.
function durationFor(activity, groupId) {
  if (groupId === undefined && offersAChoice(activity)) {
    throw new Error('durationFor: this activity has more than one group — pass the ' +
      'groupId, or ANY when there is genuinely no group');
  }
  const group = resolveGroup(activity, groupId) || (groupId === ANY ? groupList(activity)[0] : null);
  if (group) return durationOfGroup(group);
  if (groupList(activity).length) {
    return Object.assign({}, durationOfGroup(groupList(activity)[0]),
                         { sessionDates: unionDates(activity) });
  }
  return factsOf(activity).duration || {};
}

// HOW MANY TIMES ONE FAMILY MEETS. Per group now, because groups may genuinely
// differ in session count under the equal-hours rule.
function sessionCountOf(activity, groupId) {
  const duration = durationFor(activity, groupId);
  const rows = scheduledRows(duration.sessionDates);
  return rows.length ? rows.length : (num(duration.sessionCount) || 0);
}

// Every date the activity meets on, across all groups, merged and sorted. The
// right list for the group-BLIND readers and only for those: whether the
// activity has finished, and which evenings need a check-in code on the wall.
//
// A date held by two groups collapses to one row, and a date any group still
// holds counts as scheduled — an exclusion on one group's calendar says nothing
// about the other's.
function unionDates(activity) {
  const lists = groupList(activity).map((g) => durationOfGroup(g).sessionDates);
  if (!lists.length) lists.push((factsOf(activity).duration || {}).sessionDates);
  const byDate = Object.create(null);
  lists.forEach((rows) => rowsOf(rows).forEach((r) => {
    if (!r || !r.date) return;
    const seen = byDate[r.date];
    if (!seen) { byDate[r.date] = Object.assign({}, r); return; }
    if (seen.status === 'excluded' && r.status !== 'excluded') byDate[r.date] = Object.assign({}, r);
  }));
  return Object.keys(byDate).sort().map((d) => byDate[d]);
}

// --- hours, which is what the price is sold against -------------------------

// Total instructional minutes for one group: how many times it meets, times how
// long a meeting is. Null when either half is missing — half the data produces a
// number that is worse than none, the same rule pricePerHour() already follows.
function totalMinutesOfGroup(group) {
  const duration = durationOfGroup(group);
  const rows = scheduledRows(duration.sessionDates);
  const count = rows.length ? rows.length : num(duration.sessionCount);
  const minutes = num(duration.sessionMinutes);
  if (count == null || minutes == null || count <= 0 || minutes <= 0) return null;
  return count * minutes;
}

const sameDurationShape = (a, b) => {
  const countOf = (d) => {
    const rows = scheduledRows(d.sessionDates);
    return rows.length ? rows.length : num(d.sessionCount);
  };
  return countOf(a) === countOf(b) && num(a.sessionMinutes) === num(b.sessionMinutes);
};

// ⚠ THE DURATION THE PRICE IS COMPUTED FROM, and the one place the equal-hours
// rule pays for itself.
//
// Because every group's total is equal, ANY group's (count × minutes) gives the
// right number of academic hours — so the per-hour figure needs no aggregation
// and no new argument. What it does NOT give is the "(N sessions × M lessons)"
// qualifier, which is a claim about one group's term: on an activity whose
// groups meet six times and twelve times, printing either is telling half the
// families the wrong shape of course. `qualify: false` suppresses it, and the
// price rows are otherwise unchanged.
function pricingDuration(activity) {
  const list = groupList(activity);
  if (!list.length) return factsOf(activity).duration || {};
  const first = durationOfGroup(list[0]);
  if (list.length === 1) return first;
  const agree = list.every((g) => sameDurationShape(durationOfGroup(g), first));
  return agree ? first : Object.assign({}, first, { qualify: false });
}

// --- teachers, by reference --------------------------------------------------

// ⚠ TEACHERS ARE REFERENCED, NOT COPIED. The roster stays at the activity root
// and a group names which of them it has. The reason is the image pipeline: an
// uploaded photo is `<slug>-teachers-<id>-<hash8>.png`, and imagePathsOf(),
// retiredImages and the stale-image cleanup all key off that one list. Nesting
// the list inside each group multiplies every one of them, and a teacher taking
// both groups would upload their face twice and get two files under two names.
//
// An empty list means the whole roster, which is what every migrated activity
// gets: "this group is taught by whoever teaches this activity" is the truthful
// starting point, and an admin narrows it per group from there.
function teachersFor(activity, groupId) {
  const roster = rowsOf((activity || {}).teachers);
  const group = resolveGroup(activity, groupId);
  const ids = rowsOf(group && group.teacherIds);
  if (!group || !ids.length) return roster;
  // Filtered against the roster rather than trusted: an id pointing at a teacher
  // who has since been removed is an orphan, and rendering a blank credit is
  // worse than rendering one fewer.
  return roster.filter((t) => t && ids.indexOf(t.id) !== -1);
}

// --- capacity ----------------------------------------------------------------

// How many places the activity has in total: the sum of its groups' capacities.
// Null means UNCAPPED, deliberately not zero — a blank must never read as a
// restriction, and defaulting a missing number to zero would silently refuse
// every registration for an activity nobody had finished setting up.
//
// One group with no capacity makes the whole activity uncapped, because a sum
// missing one of its terms is not a sum.
function totalCapacity(activity) {
  const list = groupList(activity);
  if (!list.length) return null;
  const caps = list.map((g) => num(g.capacity)).filter((c) => c != null && c > 0);
  return caps.length === list.length ? caps.reduce((a, b) => a + b, 0) : null;
}

// --- validation ---------------------------------------------------------------

// ⚠ REFUSED ON SAVE. Three rules, each one a thing the rest of the site assumes.
function validateGroups(activity) {
  const errors = [];
  const list = groupList(activity);
  if (!list.length) {
    errors.push('An activity needs at least one group. Add one on the Schedule panel.');
    return errors;
  }

  // A NAME IS REQUIRED ONCE THERE IS A CHOICE, and not before. With one group
  // the name is never published and never asked for, so leaving it blank is the
  // ordinary case. With two, it is the thing a family picks by, and an unnamed
  // option on a registration form is a question nobody can answer.
  if (list.length > 1) {
    list.forEach((g, i) => {
      if (!nameOf(g.name)) {
        errors.push(`Group ${i + 1} has no name. Once an activity has more than one group, ` +
          'a family chooses between them by name — so every group needs one, in at least one language.');
      }
    });
  }

  // EQUAL TOTAL INSTRUCTIONAL HOURS. One fullPrice buys the activity, so what it
  // buys has to be the same whichever group a family joins. Groups may differ in
  // how that time is cut up — six two-hour meetings and twelve one-hour ones are
  // both twelve hours — and may not differ in how much of it there is.
  const totals = list.map((g) => ({ name: nameOf(g.name) || g.groupId, minutes: totalMinutesOfGroup(g) }));
  const known = totals.filter((t) => t.minutes != null);
  if (known.length) {
    const first = known[0];
    known.slice(1).forEach((t) => {
      if (t.minutes !== first.minutes) {
        errors.push(`"${first.name}" totals ${hoursLabel(first.minutes)} of teaching and ` +
          `"${t.name}" totals ${hoursLabel(t.minutes)}. Groups can meet a different number of ` +
          'times for a different length, but the total has to match — there is one price for ' +
          'the activity and it buys the same teaching whichever group a family picks. If they ' +
          'genuinely differ, make them two activities in the same series.');
      }
    });
    // Half a configuration is the same problem wearing a different hat: a group
    // whose hours cannot be worked out is a group nobody can check against the
    // others, on an activity where the rest have been filled in.
    const unknown = totals.filter((t) => t.minutes == null).map((t) => `"${t.name}"`);
    if (unknown.length) {
      errors.push(`${unknown.join(', ')} has no session length or session count while another ` +
        'group does, so the totals cannot be compared. Fill in every group, or none of them.');
    }
  }
  return errors;
}

// "12 hours" / "12 hours 30 min", for a refusal an admin reads. Plain minutes
// would be right and unreadable: 720 and 540 are harder to compare at a glance
// than 12 and 9.
function hoursLabel(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h}h ${m}min` : `${h} hours`;
}

module.exports = {
  ANY, GROUP_FACTS, ACTIVITY_FACTS, isGroupFact,
  groupList, groupById, offersAChoice, soleGroup, resolveGroup,
  factFor, factAcross,
  calendarFor, scheduleFor, durationFor, sessionCountOf, unionDates,
  totalMinutesOfGroup, pricingDuration,
  teachersFor, totalCapacity,
  validateGroups,
  // Kept under the old name for the readers that only ever wanted "the groups".
  namedGroups: groupList
};
