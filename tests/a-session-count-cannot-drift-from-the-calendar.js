// What this defends against:
//
// hebrew4kids says ten sessions, weekly on Wednesdays, 14 Oct to 23 Dec 2026.
// Enumerate that span and you get ELEVEN Wednesdays; the tenth falls on 16 Dec,
// a week before the stated end date. Both numbers are in the record, both are
// editable, and nothing reads them against each other, so the disagreement has
// been sitting there invisibly.
//
// Today it costs nothing. Under prorated cancellation it is money: the
// denominator (sessionCount) and the calendar (sessionDates) would disagree, and
// a family would be credited for a session that either did or did not happen.
//
// So the calendar wins and the count is DERIVED from it. This suite pins that,
// and pins the two things that make a derived count safe: exclusions survive a
// regeneration (a holiday the admin removed must not quietly come back), and
// only scheduled rows are ever counted.

const H = require('./_helpers');
const S = require('../netlify/functions/_activity-sessions');

const WED = 3, SUN = 0, TUE = 2, FRI = 5;
const weekly = (o) => S.enumerate(Object.assign({ frequency: 'weekly' }, o));

console.log('[the discrepancy this module exists to expose]');
const h4k = weekly({ sessions: [{ day: WED }], startDate: '2026-10-14', endDate: '2026-12-23' });
H.eq(h4k.length, 11, 'the span holds eleven Wednesdays, not the ten the record claims');
H.eq(h4k[0], '2026-10-14', 'first is the start date, which is itself a Wednesday');
H.eq(h4k[9], '2026-12-16', 'the tenth falls a week before the stated end');
H.eq(h4k[10], '2026-12-23', 'and the eleventh is the stated end');

console.log('\n[each frequency enumerates the dates it claims]');
H.eq(JSON.stringify(S.enumerate({ frequency: 'one-time', startDate: '2026-10-14' })),
     '["2026-10-14"]', 'one-time is the start date, and needs no weekday');
H.eq(weekly({ sessions: [{ day: WED }], startDate: '2026-10-14', endDate: '2026-11-04' }).join(','),
     '2026-10-14,2026-10-21,2026-10-28,2026-11-04', 'weekly steps seven days');
H.eq(S.enumerate({ frequency: 'biweekly', sessions: [{ day: WED }],
                   startDate: '2026-10-14', endDate: '2026-11-25' }).join(','),
     '2026-10-14,2026-10-28,2026-11-11,2026-11-25', 'biweekly steps fourteen');
H.eq(S.enumerate({ frequency: 'twice-weekly', sessions: [{ day: WED }, { day: SUN }],
                   startDate: '2026-10-14', endDate: '2026-10-25' }).join(','),
     '2026-10-14,2026-10-18,2026-10-21,2026-10-25',
     'twice-weekly interleaves both days in date order, not day by day');
H.eq(S.enumerate({ frequency: 'custom', sessions: [{ day: WED }],
                   startDate: '2026-10-14', endDate: '2026-12-23' }).length, 0,
     'custom is whatever the admin typed, so it enumerates nothing');

console.log('\n[monthly names a week of the month, and clamps rather than spilling]');
H.eq(S.enumerate({ frequency: 'monthly', sessions: [{ day: TUE }], weekOfMonth: 2,
                   startDate: '2026-10-01', endDate: '2026-12-31' }).join(','),
     '2026-10-13,2026-11-10,2026-12-08', 'the second Tuesday of each month');
H.eq(S.enumerate({ frequency: 'monthly', sessions: [{ day: FRI }], weekOfMonth: 'last',
                   startDate: '2026-10-01', endDate: '2026-12-31' }).join(','),
     '2026-10-30,2026-11-27,2026-12-25', 'last Friday of each month');
// February 2026 has exactly four Sundays. Asking for a fifth must not roll into March.
const fifth = S.enumerate({ frequency: 'monthly', sessions: [{ day: SUN }], weekOfMonth: 5,
                            startDate: '2026-02-01', endDate: '2026-02-28' });
H.eq(fifth.join(','), '2026-02-22',
     'a fifth Sunday that does not exist clamps to the last one, and stays inside the month');

console.log('\n[an exclusion survives the calendar being regenerated]');
// This is the one that would silently lose money: change the end date, the
// calendar regenerates, and a holiday the admin removed quietly returns.
const before = S.mergeExclusions(['2026-10-14', '2026-10-21', '2026-10-28'], []);
H.eq(before.filter((r) => r.status === 'scheduled').length, 3, 'everything starts scheduled');
before[1].status = 'excluded';
const after = S.mergeExclusions(['2026-10-14', '2026-10-21', '2026-10-28', '2026-11-04'], before);
H.eq(after.length, 4, 'the regenerated calendar is longer');
H.eq(after[1].status, 'excluded', 'and 21 Oct is STILL excluded');
H.eq(after[3].status, 'scheduled', 'while the newly added date is not');
const shrunk = S.mergeExclusions(['2026-10-14'], before);
H.eq(shrunk.length, 1, 'a date that no longer occurs simply goes away with its exclusion');

console.log('\n[only scheduled rows are counted, published, or paid for]');
const cal = S.mergeExclusions(h4k, []);
cal[4].status = 'excluded';
H.eq(S.sessionCount(cal), 10, 'excluding one of eleven derives ten');
H.eq(S.scheduled(cal).length, 10, 'and the filter agrees with the count');
H.ok(S.scheduled(cal).every((r) => r.status !== 'excluded'), 'no excluded row escapes the filter');
H.eq(S.sessionCount([]), 0, 'an unscheduled activity counts zero rather than throwing');

console.log('\n[dates are arithmetic, not local time]');
// Europe/Nicosia leaves DST on 25 Oct 2026. Going through a local Date here is
// how a session silently moves a day; these must stay Wednesdays across it.
const dst = weekly({ sessions: [{ day: WED }], startDate: '2026-10-21', endDate: '2026-11-04' });
H.eq(dst.join(','), '2026-10-21,2026-10-28,2026-11-04', 'the DST boundary changes nothing');
H.ok(dst.every((d) => S.isoWeekday(d) === WED), 'every generated date is still a Wednesday');
H.eq(S.parseISO('2026-02-30'), null, 'an impossible date is rejected, not rolled into March');
H.eq(S.parseISO('not-a-date'), null, 'and so is nonsense');
H.eq(S.enumerate({ frequency: 'weekly', sessions: [{ day: WED }], startDate: '' }).length, 0,
     'no start date enumerates nothing rather than guessing today');
H.eq(S.enumerate({ frequency: 'weekly', sessions: [], startDate: '2026-10-14', endDate: '2026-12-23' }).length, 0,
     'a weekly activity with no weekday enumerates nothing');
H.eq(S.enumerate({ frequency: 'weekly', sessions: [{ day: WED }], startDate: '2026-10-14' }).length, 0,
     'and neither an end date nor a limit means there is no bound to stop at');

console.log('\n[a limit caps the calendar, for a record that still carries a count]');
H.eq(weekly({ sessions: [{ day: WED }], startDate: '2026-10-14', endDate: '2026-12-23', limit: 10 }).length,
     10, 'ten requested, ten returned');
H.eq(weekly({ sessions: [{ day: WED }], startDate: '2026-10-14', limit: 3 }).join(','),
     '2026-10-14,2026-10-21,2026-10-28', 'a limit alone is enough of a bound');

H.done();
