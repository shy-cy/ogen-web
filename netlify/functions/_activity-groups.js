// _activity-groups.js — which calendar and which schedule a named group has.
//
// PURE. No stores, no network, no clock. Everything here reads a record and
// answers a question about it.
//
// ⚠ WHY THIS FILE EXISTS. An activity had ONE calendar —
// `facts.duration.sessionDates` — and two named groups that could only differ in
// size. Beginners on Mondays and Advanced on Wednesdays is the ordinary case at
// a community centre, and for it that single list was right for at most one of
// the two. Every family in the other group read a session table of dates they do
// not attend, and — worse, because it is money — a cancellation was prorated
// against a denominator that was not theirs.
//
// So a named group may carry its own `schedule` and its own `sessionDates`, and
// everything that reads a calendar AND knows which group it is about comes
// through here instead of reaching into the record.
//
// ⚠ THE DANGEROUS FAILURE IS A FORGOTTEN ARGUMENT, not a wrong one. A reader
// that forgets to say which group would silently get the activity's list, which
// on a per-group activity is a plausible wrong answer — the exact shape of bug
// that surfaces as two families comparing receipts. So `calendarFor()` THROWS
// when a per-group activity is asked without a group, rather than falling back.
// A caller that genuinely has no group says so with `ANY`, which is honest and
// greppable.
//
// ⚠ EVERY GROUP MEETS THE SAME NUMBER OF TIMES. That is enforced on save —
// see validateGroupCalendars() — and it is what keeps the rest of the site
// truthful: `fullPrice` is one number, the price card's "(N sessions × M
// lessons)" qualifier is one sentence, and proration's denominator is one count.
// Groups differ in WHEN they meet, not in HOW MANY times. An admin who builds
// otherwise is refused with both counts named, because the alternative is a page
// that quotes one group's term to the other group's family.

// ⚠ REQUIRES NOTHING, and that is deliberate rather than incidental. The obvious
// import is _activity-facts, for namedGroups() and pick() — but the rendering
// side has to ask THIS module which schedule a group is on, so importing it here
// would make a cycle. The two functions borrowed are four lines between them,
// and four duplicated lines beat an import cycle or a resolver written twice.
const ANY = '*';

// facts.namedGroups(), inlined: a named group is one with an id.
const namedOf = (activity) => {
  const f = (((activity || {}).facts) || {}).groupSize || {};
  return (Array.isArray(f.named) ? f.named : []).filter((g) => g && g.groupId);
};

// facts.pick() for one language, used only to name a group in a refusal an
// admin reads. English, because the admin is in English.
const nameOf = (bag) => {
  if (typeof bag === 'string') return bag.trim();
  if (!bag) return '';
  return String(bag.en || bag.he || bag.ru || '').trim();
};

const durationOf = (activity) => (((activity || {}).facts) || {}).duration || {};

const rowsOf = (v) => (Array.isArray(v) ? v : []);

// The groups that actually carry a calendar of their own. A named group with
// none falls back to the activity's, which is right: naming two groups is not
// by itself a claim that they meet at different times.
function groupsWithCalendars(activity) {
  return namedOf(activity).filter((g) => rowsOf(g.sessionDates).length);
}

// The groups that carry a SCHEDULE of their own — the sentence "Mondays, 16:00"
// is built from. Separate from the calendar question: an activity can name when
// each group meets without anybody having generated the dates yet, and the card
// should say so the moment it is typed.
function groupsWithSchedules(activity) {
  return namedOf(activity).filter(
    (g) => g.schedule && rowsOf(g.schedule.sessions).length);
}

// Does this activity keep more than one calendar at all?
function hasGroupCalendars(activity) {
  return groupsWithCalendars(activity).length > 0;
}

function groupById(activity, groupId) {
  return namedOf(activity).filter((g) => g.groupId === groupId)[0] || null;
}

// ⚠ THE ONE RESOLVER. Every reader that knows its group comes through here.
//
// `groupId` may be null on a per-group activity for exactly one reason: a
// registration taken while the activity was still pooled carries no group. Those
// read the activity's calendar, which is the only honest answer — nobody knows
// which group they are in, and inventing one would put a family on a list of
// dates they were never promised.
function calendarFor(activity, groupId) {
  // ⚠ LOUD EXACTLY WHERE IT MATTERS AND SILENT EVERYWHERE ELSE. On an activity
  // with no per-group calendars there is one answer and no argument to forget,
  // so `undefined` is simply the activity's list. The moment an admin gives the
  // groups their own dates, a caller that never learned to thread the group
  // through starts returning a plausible wrong calendar — so that is the moment
  // it throws instead. The check costs nothing and cannot fire on the ordinary
  // activity, which is what makes it safe to leave in.
  if (groupId === undefined) {
    if (hasGroupCalendars(activity)) {
      throw new Error('calendarFor: this activity keeps a calendar per group — ' +
        'pass the groupId, or ANY when there is genuinely no group');
    }
    return rowsOf(durationOf(activity).sessionDates);
  }
  if (groupId === ANY || groupId === null) return rowsOf(durationOf(activity).sessionDates);
  const group = groupById(activity, groupId);
  const own = group && rowsOf(group.sessionDates);
  return own && own.length ? own : rowsOf(durationOf(activity).sessionDates);
}

// The schedule FACT for a group — the sentence "Mondays, 16:00" is built from.
// Same fallback: a group with none reads the activity's.
function scheduleFor(activity, groupId) {
  if (groupId !== ANY && groupId !== null && groupId !== undefined) {
    const group = groupById(activity, groupId);
    const own = group && group.schedule;
    if (own && rowsOf(own.sessions).length) return own;
  }
  return (((activity || {}).facts) || {}).schedule || {};
}

const scheduledRows = (rows) => rowsOf(rows).filter((r) => r && r.date && r.status !== 'excluded');

// HOW MANY TIMES A FAMILY MEETS, which is one number for the whole activity
// because validateGroupCalendars() refuses anything else. Read from a group when
// there are per-group calendars, so the union never inflates it: ten Mondays
// plus ten Wednesdays is twenty dates and ten meetings for everybody.
//
// This is what the price qualifier and the duration fact count, and getting it
// from the union instead would have quoted every family double their term.
function sessionCountOf(activity) {
  const withOwn = groupsWithCalendars(activity);
  if (withOwn.length) return scheduledRows(withOwn[0].sessionDates).length;
  return scheduledRows(durationOf(activity).sessionDates).length;
}

// Every date the activity meets on, across all groups, merged and sorted. This
// is the right list for the group-BLIND readers and only for those: whether the
// activity has finished, and which evenings need a check-in code on the wall.
//
// A date held by two groups collapses to one row, and a date any group still
// holds counts as scheduled — an exclusion on one group's calendar says nothing
// about the other's.
function unionDates(activity) {
  const lists = [durationOf(activity).sessionDates].concat(
    groupsWithCalendars(activity).map((g) => g.sessionDates));
  const byDate = Object.create(null);
  lists.forEach((rows) => rowsOf(rows).forEach((r) => {
    if (!r || !r.date) return;
    const seen = byDate[r.date];
    if (!seen) { byDate[r.date] = Object.assign({}, r); return; }
    if (seen.status === 'excluded' && r.status !== 'excluded') byDate[r.date] = Object.assign({}, r);
  }));
  return Object.keys(byDate).sort().map((d) => byDate[d]);
}

// ⚠ THE DURATION FACT, WITH A CALENDAR SOMETHING CAN COUNT.
//
// `facts.duration.sessionDates` is the activity's own calendar and is EMPTY on
// an activity whose groups keep their own — there is no single list, which is
// the whole point. But half a dozen things downstream count it: how many
// sessions the term has, the academic hours behind the price per lesson, the
// "(N sessions × M lessons)" qualifier, the 30%-through cutoff default.
//
// They all want the same number, and by the rule above every group HAS the same
// number. So rather than threading a group through six more signatures, this
// hands them a duration fact carrying one group's list. Any group will do,
// because a differing count is refused on save — which is the thing that makes
// this safe rather than convenient.
function durationOf_(activity) {
  const base = durationOf(activity);
  const withOwn = groupsWithCalendars(activity);
  if (!withOwn.length) return base;
  return Object.assign({}, base, { sessionDates: withOwn[0].sessionDates });
}

// ⚠ REFUSED ON SAVE: groups that meet a different number of times.
//
// It is not a limitation being worked around, it is the shape of the data. One
// `fullPrice`, one "(N sessions × M lessons)" qualifier, one denominator for
// prorated credit — a model that cannot price two different session counts must
// not publish a page that implies it can. An admin who needs that has two
// activities, which the site already supports and which `seriesId` already links
// for the registration fee.
//
// Only groups that HAVE their own calendar are compared. A group falling back to
// the activity's is by definition meeting the same number of times as it.
function validateGroupCalendars(activity) {
  const errors = [];
  const withOwn = groupsWithCalendars(activity);
  if (!withOwn.length) return errors;

  const counts = withOwn.map((g) => ({
    name: nameOf(g.name) || g.groupId,
    count: scheduledRows(g.sessionDates).length
  }));
  const first = counts[0];
  counts.slice(1).forEach((c) => {
    if (c.count !== first.count) {
      errors.push(`"${first.name}" meets ${first.count} times and "${c.name}" meets ${c.count}. ` +
        'Groups can meet on different days, but not a different number of times — one term ' +
        'price and one session count are quoted to every family. If they genuinely differ, ' +
        'make them two activities in the same series.');
    }
  });

  // A group with a calendar while another named group has none is the same
  // problem wearing a different hat: the one without falls back to the
  // activity's list, which was written for nobody in particular.
  const named = namedOf(activity);
  if (withOwn.length && withOwn.length !== named.length) {
    const missing = named.filter((g) => !rowsOf(g.sessionDates).length)
      .map((g) => `"${nameOf(g.name) || g.groupId}"`).join(', ');
    errors.push(`${missing} has no calendar of its own while another group does. ` +
      'Give every group its own dates, or none of them.');
  }
  return errors;
}

module.exports = {
  ANY,
  calendarFor, scheduleFor, sessionCountOf, unionDates,
  groupsWithCalendars, groupsWithSchedules, hasGroupCalendars, groupById,
  namedGroups: namedOf, durationFor: durationOf_,
  validateGroupCalendars
};
