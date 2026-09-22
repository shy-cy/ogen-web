// What this defends against:
//
// An activity had ONE calendar — `facts.duration.sessionDates` — and named
// groups that could only differ in SIZE. Beginners on Mondays and Advanced on
// Wednesdays is the ordinary shape of a community centre's term, and for it that
// single list was right for at most one of the two groups.
//
// The visible half was bad: every family in the other group read a session table
// of dates they do not attend, and a schedule line naming a weekday they do not
// come on.
//
// ⚠ THE INVISIBLE HALF WAS MONEY. Prorated credit is sessions remaining over
// sessions TOTAL, frozen at submission. Frozen off the wrong group's calendar it
// produces a figure that is wrong and entirely plausible — nobody checks a
// credit that looks reasonable, and the two families who could tell never
// compare receipts. The same wrongness reaches a drop-in's bookable evenings, a
// bundle's covered dates, and the shortfall the nightly pass credits back.
//
// So every reader that knows its group resolves through _activity-groups.js, and
// the two that are group-BLIND say so out loud: whether an activity has finished
// (the union — it is over when the LAST group is over), and the check-in codes
// on the wall (one per evening, whoever is in the room).
//
// THREE RULES CARRY IT:
//
//   1. A forgotten argument is LOUD, but only where it is ambiguous.
//      calendarFor(activity) throws on a per-group activity and answers on every
//      other, so the ordinary activity is untouched and the dangerous case
//      cannot return a plausible wrong list.
//   2. Every group is sold the same number of HOURS. Refused on save, because
//      there is one fullPrice and it buys the same teaching whichever group a
//      family picks. Groups may cut that time up differently — six two-hour
//      meetings and twelve one-hour ones are both twelve hours — and the "(N
//      sessions x M lessons)" qualifier is then suppressed, because it describes
//      one group's term and there is no single true version of it.
//   3. `schedule` and `sessionDates` on a group are STRUCTURE, and nothing a
//      restricted role sends can reach them — for a session without full access
//      the whole structured fact is taken from the STORED record.
//
// ⚠ AND THE ONE THING THIS FOUND AND COULD NOT FIX IS FIXED NOW. A role
// permitted to edit only Russian could not translate "Advanced": group names
// lived inside facts.groupSize, and LANG_SUBKEYS merges a sub-key of a FACT, not
// a sub-key of one ITEM in a list. mergeGroups() is that per-item merge — the
// name and the word half of each group's facts merge per language, and the
// capacity, the calendar and the membership of the list come from the stored
// record. Pinned below.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');
const G = require('../netlify/functions/_activity-groups');
const F = require('../netlify/functions/_activity-facts');
const C = require('../netlify/functions/_credit');
const A = require('../netlify/functions/_activity-autocomplete');
const { migrate } = require('../netlify/functions/_activity-migrate');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');

// Two groups, four dates each, on different weekdays. Mondays and Wednesdays in
// October 2026.
const MON = ['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02'];
const WED = ['2026-10-14', '2026-10-21', '2026-10-28', '2026-11-04'];
const rows = (list) => list.map((d) => ({ date: d, status: 'scheduled' }));

function activity(over) {
  return migrate(Object.assign({
    slug: 'hebrew', activityId: 'act-0000000000000001', type: 'course',
    // An explicit late cutoff, so the assertions below are about PRORATION
    // rather than about the hard cutoff — which now resolves per group and is
    // pinned separately.
    registration: { cancellationPolicy: { mode: 'prorated', cancellationCutoffDate: '2026-12-31' } },
    facts: {
      schedule: { frequency: 'weekly', sessions: [{ day: 1, time: '16:00' }] },
      duration: { startDate: '2026-10-12', endDate: '2026-11-04', sessionMinutes: 90, sessionDates: [] },
      price: { registrationFee: 50, fullPrice: 300 },
      groupSize: { named: [
        { groupId: 'g-beg', name: { he: 'מתחילים', en: 'Beginners', ru: 'Начинающие' }, capacity: 8,
          schedule: { frequency: 'weekly', sessions: [{ day: 1, time: '16:00' }] },
          sessionDates: rows(MON) },
        { groupId: 'g-adv', name: { he: 'מתקדמים', en: 'Advanced', ru: 'Продвинутые' }, capacity: 6,
          schedule: { frequency: 'weekly', sessions: [{ day: 3, time: '17:30' }] },
          sessionDates: rows(WED) }
      ] }
    }
  }, over || {}));
}

console.log('[a group keeps its own schedule and its own dates, across a save]');
const act = activity();
const named = act.groups;
H.eq(named.length, 2, 'the named groups became the activity\'s groups');
H.eq(named[0].facts.duration.sessionDates.map((r) => r.date).join(' '), MON.join(' '),
  'Beginners keeps its Mondays');
H.eq(named[1].facts.schedule.sessions[0].day, 3, 'and Advanced its Wednesday');
// normaliseGroups() runs on every read and every save, so a key it does not name
// is deleted by the next write — which is exactly how sessionDates was lost
// before it was listed on the duration shape.
H.eq(JSON.stringify(migrate(act).groups), JSON.stringify(named),
  'and a second pass through migrate changes nothing');

console.log('\n[the resolver answers per group, and is loud where it cannot]');
H.eq(G.calendarFor(act, 'g-beg').map((r) => r.date).join(' '), MON.join(' '), 'Beginners resolves to Mondays');
H.eq(G.calendarFor(act, 'g-adv').map((r) => r.date).join(' '), WED.join(' '), 'Advanced to Wednesdays');
// A place taken while the activity was still pooled carries no group. On an
// activity with a CHOICE there is no honest single answer, so it reads the union
// — inventing a group would put a family on dates nobody promised them.
H.eq(G.calendarFor(act, null).length, 8, 'a registration with no group reads every evening, not one group\'s');
H.eq(G.calendarFor(act, G.ANY).length, 8, 'and so does a caller that says ANY');
// ⚠ THE ONE THAT MATTERS: a reader that never learned to thread the group.
let threw = null;
try { G.calendarFor(act); } catch (e) { threw = e.message; }
H.ok(threw && /more than one group/.test(threw),
  'a forgotten group THROWS rather than returning a plausible wrong list');
// And is silent on the ordinary activity, which is every activity on the site:
// one group, one calendar, no argument to forget.
const plain = migrate({
  slug: 'plain', activityId: 'act-0000000000000002', type: 'course',
  facts: {
    schedule: { frequency: 'weekly', sessions: [{ day: 3, time: '16:00' }] },
    duration: { startDate: '2026-10-12', endDate: '2026-11-04', sessionMinutes: 90, sessionDates: rows(WED) },
    price: { registrationFee: 50, fullPrice: 300 }
  }
});
H.eq(G.calendarFor(plain).length, 4, 'an activity with one group needs no argument and gets no throw');
H.eq(G.offersAChoice(plain), false, 'and offers no choice, so no family is ever asked');
H.eq(G.offersAChoice(act), true, 'while two groups is a choice, which is the only thing that decides it');

console.log('\n[how many times a family meets is ONE number, not the union]');
H.eq(G.sessionCountOf(act, 'g-beg'), 4, 'four, not eight — the union would quote every family double their term');
H.eq(G.unionDates(act).length, 8, 'while the union is all eight, for the readers that want every evening');
H.eq(G.durationFor(act, 'g-beg').sessionDates.length, 4,
  'and the duration fact hands the counters that group\'s list');
// ⚠ WHERE IT SURFACES: the price card's qualifier. Counted off the union it
// would quote "(8 sessions x 2 lessons)" for a 300 EUR term every family
// attends four times — the term itself, restated wrongly, on the card a family
// decides from.
H.eq(F.priceRows(act.facts.price, 'en', G.pricingDuration(act))[1].note, '(4 sessions × 2 lessons)',
  'the price qualifier counts one group\'s sessions, not both groups\' dates');
// ⚠ AND IT DISAPPEARS THE MOMENT THE GROUPS GENUINELY DIFFER. Under the
// equal-HOURS rule two groups can meet four times for 90 minutes and six times
// for 60 — the same six hours, priced the same, and no single true "(N x M)".
// The figure survives because it is right for everybody; the sentence does not.
const cut = activity();
cut.groups[1].facts.duration = Object.assign({}, cut.groups[1].facts.duration, {
  sessionMinutes: 60, sessionDates: rows(WED.concat(['2026-11-11', '2026-11-18']))
});
H.eq(G.validateGroups(cut).length, 0, 'four 90-minute meetings and six 60-minute ones are both six hours');
const cutRows = F.priceRows(cut.facts.price, 'en', G.pricingDuration(cut));
H.eq(cutRows[1].note, '', 'so the qualifier is suppressed rather than quoting one group at the other');
H.eq(cutRows[1].value, '300 €', 'while the price itself is unchanged, because the teaching is');

console.log('\n[⚠ the credit is frozen against the family\'s OWN calendar]');
// The whole point. Freeze both groups on the same activity and they must differ.
const beg = C.freezeCancellation(act, 'g-beg');
const adv = C.freezeCancellation(act, 'g-adv');
H.eq(beg.sessionStartsAt.length, 4, 'Beginners freezes four sessions');
H.eq(adv.sessionStartsAt.length, 4, 'Advanced freezes four');
H.ok(beg.sessionStartsAt[0] !== adv.sessionStartsAt[0],
  'and they are DIFFERENT instants — the same activity, two timetables');
// 16:00 Monday 12 Oct vs 17:30 Wednesday 14 Oct, both Nicosia. The times come
// from each group's own schedule, not the activity's.
H.eq(new Date(beg.sessionStartsAt[0]).toISOString(), '2026-10-12T13:00:00.000Z',
  'Beginners meet at 16:00 Nicosia on the Monday');
H.eq(new Date(adv.sessionStartsAt[0]).toISOString(), '2026-10-14T14:30:00.000Z',
  'Advanced at 17:30 on the Wednesday — the group\'s schedule, not the activity\'s');
// And the arithmetic downstream differs because of it. On 20 October, Beginners
// have held two of four and Advanced one of four.
const on = Date.parse('2026-10-20T12:00:00Z');
const owed = (frozen) => C.creditFor({
  payment: { paidCents: 35000 },
  frozen: { price: { registrationFee: 50, fullPrice: 300 }, cancellation: frozen }
}, on).courseCredit;
H.eq(owed(beg), 15000, 'Beginners: two of four left, 150 EUR');
H.eq(owed(adv), 22500, 'Advanced: three of four left, 225 EUR');
H.ok(owed(beg) !== owed(adv),
  '⚠ 75 EUR apart on the same day, on the same activity — which is the figure ' +
  'one calendar would have got wrong for one of them, plausibly and silently');

// ⚠ AND THE HARD CUTOFF ITSELF RESOLVES PER GROUP. Left unconfigured it is the
// date of session ceil(30% x count), which for Beginners is their second Monday
// and for Advanced their second Wednesday. One activity-level default would have
// held one of the two groups to the other's date — and it would have looked
// perfectly reasonable on both receipts.
const open2 = activity({ registration: { cancellationPolicy: { mode: 'prorated' } } });
H.eq(C.freezeCancellation(open2, 'g-beg').cancellationCutoffDate, '2026-10-19',
  'Beginners are held to their own second session');
H.eq(C.freezeCancellation(open2, 'g-adv').cancellationCutoffDate, '2026-10-21',
  'and Advanced to theirs, two days later');
// A date an admin actually typed wins for everybody, which is what makes this a
// DEFAULT rather than a formula that re-evaluates behind their back.
H.eq(C.freezeCancellation(act, 'g-beg').cancellationCutoffDate, '2026-12-31',
  'a typed cutoff governs every group, because somebody decided it');

console.log('\n[the page shows both, rather than one of them]');
const line = (lang) => F.scheduleText(act, lang);
H.eq(line('en'), 'Beginners: Mondays, 16:00\nAdvanced: Wednesdays, 17:30',
  'the schedule fact names each group, one per line');
H.ok(/מתחילים: ימי שני/.test(line('he')), 'in Hebrew');
H.ok(/Начинающие: по понедельникам/.test(line('ru')), 'and Russian');
// `.sidebar-facts span` is already white-space:pre-line and several facts are
// more than one line, so this needed no new markup and no new CSS.
H.ok(/white-space:\s*pre-line/.test(read('shared.css')), 'which the existing fact styling already renders');
const tables = F.sessionTables(act, 'en');
H.eq(tables.length, 2, 'and there are two session tables');
H.eq(tables[0].title, 'Beginners', 'each captioned with its group');
H.eq(tables[0].rows[0].date, '12 October', 'showing that group\'s own dates');
H.eq(tables[1].rows[0].date, '14 October', 'and the other group\'s its own');
// The single-calendar page renders exactly as it did — one table, no caption
// suffix, which is every published page on the site today.
const one = F.sessionTables(plain, 'en');
H.eq(one.length, 1, 'an activity with one calendar still has one table');
H.eq(one[0].title, null, 'with no group name on it');

console.log('\n[the two group-blind readers say so]');
// An activity is over when the LAST group is over. Reading one calendar would
// archive the page — and rewrite it live — while the other group still meets.
H.eq(A.lastSessionDate(act), '2026-11-04', 'the last session is the union\'s last, not one group\'s');
const auto = read('netlify/functions/_activity-autocomplete.js');
H.ok(/groups\.unionDates\(activity\)/.test(auto), 'autocompletion reads the union, and says why');
const admin = read('netlify/functions/admin-registrations.js');
H.ok(/attendance\.bookableDates\(activity, groups\.ANY\)/.test(admin),
  'and the codes on the wall pass ANY explicitly rather than omitting it');

console.log('\n[groups may differ in when and how often, never in how many hours]');
H.eq(G.validateGroups(act).length, 0, 'two groups of four 90-minute meetings are fine');
const uneven = activity();
uneven.groups[1].facts.duration.sessionDates = rows(WED.slice(0, 3));
const errs = G.validateGroups(uneven);
H.eq(errs.length, 1, 'six hours against four and a half is refused');
H.ok(/"Beginners" totals 6 hours of teaching and "Advanced" totals 4h 30min/.test(errs[0]),
  'naming both groups and both totals');
H.ok(/two activities in the same series/.test(errs[0]),
  'and pointing at the thing that DOES express it, which the site already supports');
// A group nobody can work the hours out for is the same problem: it cannot be
// checked against the others, on an activity where the rest have been filled in.
const half = activity();
half.groups[1].facts.duration.sessionDates = [];
half.groups[1].facts.duration.sessionMinutes = null;
H.ok(/has no session length or session count while another/.test(G.validateGroups(half)[0] || ''),
  'and so is half a configuration');
// A NAME once there is a choice, because that is what a family picks by.
const unnamed = activity();
unnamed.groups[1].name = { he: '', en: '', ru: '' };
H.ok(/Group 2 has no name/.test(G.validateGroups(unnamed).join(' ')),
  'a second group with no name is refused — an unnamed option is a question nobody can answer');
H.eq(G.validateGroups(plain).length, 0,
  'while ONE group needs no name, because nothing is published and nobody is asked');
H.ok(/GROUPS\.validateGroups\(activity\)/.test(read('netlify/functions/activities-admin.js')),
  'validate() calls it, so this is refused on SAVE rather than found on a page');

console.log('\n[a bundle is sold against the buyer\'s own evenings]');
const api = read('netlify/functions/account-registrations.js');
H.ok(/B\.bundlesAvailable\(activity, now, gid\)/.test(api), 'the offer is decided per group');
H.ok(/groupId: groupId \|\| null,/.test(read('netlify/functions/_bundle-store.js')),
  'and the group is FROZEN on the bundle, like its entries and its price');
H.ok(/const gid = \(bundle \|\| \{\}\)\.groupId \|\| null;/.test(read('netlify/functions/_bundle.js')),
  'so reconcile() refills from the calendar it was sold against');
// ⚠ The shortfall gate is per bundle, not per activity: asked of the activity, a
// Beginners bundle would be told the term is still running because Advanced meet
// next week, and a credit that family is owed would never be written.
H.ok(/B\.datesAhead\(activity, at, bundle\.groupId \|\| null\)/.test(read('netlify/functions/_registration-sweep.js')),
  'and the nightly shortfall is judged against that family\'s own timetable');

console.log('\n[it is structure, so a translator cannot move it]');
const adminFn = read('netlify/functions/activities-admin.js');
const subkeys = /const LANG_SUBKEYS = \{[\s\S]*?\};/.exec(adminFn);
H.ok(subkeys, 'LANG_SUBKEYS is readable');
H.ok(!/schedule|sessionDates/.test(subkeys[0]),
  'neither the schedule nor the calendar is a translatable sub-key');
// And the merge's own shape is what enforces it: for a restricted role the
// whole structured fact comes from the STORED record, so nothing a
// Russian-only session sends can reach a group's timetable at all.
H.ok(/const incFact = full \? REG\.keepUndrawnFactKeys\(key, cur, inc, out\.type\) : cur;/.test(adminFn),
  'a role without full access has its structure taken from the stored record, not its request');
// ⚠ THE PER-ITEM MERGE, which is what the note at the top of this file said was
// missing. The name merges per language; the capacity, the facts and the
// MEMBERSHIP of the list do not.
H.ok(/function mergeGroups\(baseGroups, incomingGroups, full, mergeLang\)/.test(adminFn),
  'groups merge through their own function');
H.ok(/const skeleton = \(full \? incoming : current\)/.test(adminFn),
  'and a restricted role cannot add, remove or reorder a group');
H.ok(/name: mergeLang\(cur\.name, inc\.name\)/.test(adminFn),
  'while the name is words, and merges per language like every other sentence');
H.ok(/capacity: full \? /.test(adminFn), 'and the capacity beside it is structure');

console.log('\n[the admin can reach it, which is the half a pure module never has]');
const adminJs = read('js/activities-admin.js');
// ⚠ ONE SCHEDULE SYSTEM. There were three placements for one job — the
// activity's frequency and day/time rows inline in the Schedule panel, its
// calendar inline in Duration, a group's on a sub-page — and that is how the
// tick-means-excluded bug came to be worded two different ways. Every owner of
// a timetable, the activity included, opens the same sub-page now.
H.ok(/function openOwnerPage\(groupId\)/.test(adminJs), 'an owner opens its own screen');
H.ok(/text: 'Schedule & dates \\u2192'/.test(adminJs), 'from a button on the one list of who meets when');
H.ok(/function drawOwnerPage/.test(adminJs), 'which draws the schedule and the calendar');
H.ok(/function scheduleRowBox\(opts\)/.test(adminJs), 'built from ONE row builder');
H.ok(/function sessionCalendarBox\(opts\)/.test(adminJs), 'and ONE calendar editor');
H.ok(/prefix: GROUP_PREFIX/.test(adminJs), 'namespaced so nothing collides');
H.ok(/action: 'sessions'/.test(adminJs.slice(adminJs.indexOf('function generateOwnerSessions'))),
  'and generated by the same server action, for every owner');
// ⚠ AND THE FIRST ROW IS NOT A GROUP. Naming groups puts a picker on the
// registration form, the name on the page, the roster and every receipt, and
// switches capacity from groups x maxPerGroup to the sum of the named ones. An
// activity with one class offers no choice, so it names nothing — which is why
// this is a UI change and not a data change.
H.ok(/\{ groupId: null, label: 'Everyone' \}/.test(adminJs),
  'the activity itself is row 0, and is not a named group');
H.ok(/function primeScheduleModel/.test(adminJs),
  'and the model is primed before any panel draws, because the list reads facts the ' +
  'panels after it used to load');
// ⚠ The read-back trap, in its newest costume: NOTHING about an owner is drawn
// on the main form any more — not the schedule, not the calendar, not a group's
// name or its places — so a save that walked the DOM would clear all of it.
const reads = adminJs.slice(adminJs.indexOf('function readFacts'));
H.ok(/var sch = S\.schedule \|\| \{\};/.test(reads),
  'the schedule is saved from the model, not read back off a form it is not on');
H.ok(/sessionDates: S\.sessionDates/.test(reads), 'and the calendar');
H.ok(/return S\.namedGroups \|\| \[\];/.test(adminJs), 'and the groups');
H.ok(/commitOwnerEdit\(\);\s*\n\s*var facts = readFacts\(\);/.test(adminJs),
  'and an owner left open is committed on save, so what is on screen is what is stored');

H.done();
